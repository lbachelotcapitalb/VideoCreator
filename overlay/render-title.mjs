// Rend une carte-titre HTML animée (WAAPI) en PNG à alpha, frame par frame,
// via un Chrome DÉJÀ installé (aucun téléchargement). 100% offline.
// Usage: node render-title.mjs <htmlPath> <outDir> <fps> <durS> <titre> <sousTitre>
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const [, , htmlPath, outDir, fpsA, durA, title = 'CHINE', subtitle = 'JOUR 1'] = process.argv;
const fps = Number(fpsA) || 30;
const dur = Number(durA) || 3.6;

// Chrome existant : env OVERLAY_CHROME sinon candidats connus
const CANDIDATES = [
  process.env.OVERLAY_CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  path.join(process.env.HOME, 'Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell'),
].filter(Boolean);
const exe = CANDIDATES.find((p) => fs.existsSync(p));
if (!exe) { console.error('Aucun Chrome trouvé'); process.exit(2); }

fs.mkdirSync(outDir, { recursive: true });
for (const f of fs.readdirSync(outDir)) if (f.endsWith('.png')) fs.rmSync(path.join(outDir, f));

const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--force-color-profile=srgb', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await page.goto('file://' + htmlPath);
await page.evaluate(([t, s]) => window.setContent(t, s), [title, subtitle]);

const N = Math.round(fps * dur);
for (let i = 0; i < N; i++) {
  const tms = (i / fps) * 1000;
  await page.evaluate((tm) => window.seek(tm), tms);
  await page.screenshot({ path: path.join(outDir, `f_${String(i).padStart(4, '0')}.png`), omitBackground: true });
}
await browser.close();
console.log(`OK ${N} frames → ${outDir} (chrome: ${path.basename(exe)})`);
