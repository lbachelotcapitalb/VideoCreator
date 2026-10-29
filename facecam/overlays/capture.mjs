#!/usr/bin/env node
// ============================================================================
// facecam/overlays/capture.mjs — composition HTML → suite de PNG à ALPHA
//
// Chrome headless piloté par CDP (puppeteer-core), Chrome.app déjà sur le Mac :
// aucun binaire à télécharger, 100% offline. Pour chaque frame on appelle
// window.__seek(t) PUIS on capture → déterministe (aucune animation CSS/rAF,
// donc aucune dérive entre le rendu écran et le rendu fichier).
// On ne capture QUE le rectangle utile (clip) : 4× moins de pixels que le 1080p.
//
// Usage : capture.mjs <composition.html> <t0> <t1> --dir <frames/> [--fps 30000/1001]
//                     [--clip x,y,w,h] [--dsf 1|2]
// Sortie: <dir>/00000.png … + <dir>/meta.json (fps, clip, dsf, t0, n) pour le burn.
//
// ⭐ `--dsf 2` = LA CLÉ DU 4K (31/07). Les cinq moteurs de composition travaillent en repère
// 1920×1080, et les 17 partis pris du monteur (README §PARTIS PRIS) sont calés dessus. Les
// repasser en 3840×2160 reviendrait à re-arbitrer chaque position. À la place on double le
// `deviceScaleFactor` : MÊME mise en page en pixels CSS, 2× les pixels de sortie, et comme
// tout est vectoriel (SVG + polices) le rendu est NATIF, pas un agrandissement.
// Conséquence en aval, et c'est tout : le PNG fait 2× le `clip`, donc le `overlay=X:Y` du
// filtergraph de burn se double lui aussi (`v12_burn.mjs --scale 2`).
// Le `--clip` reste exprimé en coordonnées 1920×1080 — c'est le repère des specs.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const req = createRequire(import.meta.url);
let puppeteer;
// le moteur d'abord (MONTAGE_HOME, sinon le dossier de ce script), puis les emplacements
// historiques : une installation qui ne déclare rien se comporte exactement comme avant.
const RACINE = process.env.MONTAGE_HOME || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
for (const base of [RACINE,
                    path.join(process.env.HOME, 'Library/Application Support/Montage'),
                    path.join(process.env.HOME, 'Movies/Montage/.coulisses/facecam/hf-overlays')]) {
  try { puppeteer = req(path.join(base, 'node_modules', 'puppeteer-core')); break; } catch { }
}
if (!puppeteer) { console.error('puppeteer-core introuvable (npm i puppeteer-core dans Montage/)'); process.exit(1); }

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const a = process.argv.slice(2);
const opt = (n, d) => { const i = a.indexOf(n); if (i < 0) return d; const v = a[i + 1]; a.splice(i, 2); return v; };
const dir = opt('--dir', null);
const fpsStr = opt('--fps', '30000/1001');
const clipStr = opt('--clip', null);
const dsf = Math.max(1, Number(opt('--dsf', 1)) || 1);
const [html, t0s, t1s] = a;
if (!html || !t0s || !t1s || !dir) { console.error('usage: capture.mjs <html> <t0> <t1> --dir <frames/> [--fps] [--clip x,y,w,h] [--dsf 1|2]'); process.exit(1); }
const t0 = parseFloat(t0s), t1 = parseFloat(t1s);
const [fn, fd] = fpsStr.split('/').map(Number);
const fps = fd ? fn / fd : fn;
const clip = clipStr ? (() => { const [x, y, w, h] = clipStr.split(',').map(Number); return { x, y, width: w, height: h }; })() : null;

fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

const n = Math.round((t1 - t0) * fps);
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'shell',
  // ⚠️ `--force-device-scale-factor` doit suivre le dsf demandé : laissé à 1, il se bat avec
  // l'émulation de viewport et on récupère un PNG 2× flou au lieu d'un PNG 2× net.
  args: ['--allow-file-access-from-files', '--hide-scrollbars', `--force-device-scale-factor=${dsf}`,
         '--disable-lcd-text', '--font-render-hinting=none'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: dsf });
await page.goto('file://' + path.resolve(html), { waitUntil: 'load' });
await page.evaluateHandle('document.fonts.ready');

const t = Date.now();
for (let i = 0; i < n; i++) {
  const tc = t0 + i / fps;
  await page.evaluate((x) => window.__seek(x), tc);
  await page.screenshot({
    path: path.join(dir, String(i).padStart(5, '0') + '.png'),
    omitBackground: true, ...(clip ? { clip } : {}), optimizeForSpeed: true,
  });
  if (i % 60 === 0) process.stderr.write(`  frame ${i}/${n} (t=${tc.toFixed(2)})\n`);
}
await browser.close();
fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ html, t0, t1, fps: fpsStr, n, clip, dsf }, null, 1));
console.log(`${n} frames → ${dir}  (${((Date.now() - t) / 1000).toFixed(1)} s, dsf ${dsf})`);
