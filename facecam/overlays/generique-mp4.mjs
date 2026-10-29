#!/usr/bin/env node
// ============================================================================
// facecam/overlays/generique-mp4.mjs — le générique de fin, de la SPEC au MP4.
//
// POURQUOI CE FICHIER EXISTE (31/07). Le générique du VLOG #01 avait été monté à
// la main : `generique.mjs` → HTML, `capture.mjs` → PNG, puis une commande ffmpeg
// tapée dans le terminal. Résultat : au moment de le refaire en 4K, cette commande
// n'existait plus nulle part — ni dans le repo, ni dans la restitution. Une chaîne
// qu'on ne peut pas rejouer n'est pas une chaîne, c'est un souvenir.
//
// Usage : node facecam/overlays/generique-mp4.mjs <spec.json> --out <fichier.mp4>
//                [--dsf 1|2] [--fps 30] [--garder]
//
// ⭐ `--dsf 2` = LE 4K. La composition reste écrite en repère 1920×1080 (le spec
// porte `map`, `titleY`, `labelSize`… dans ce repère) et Chrome la rend à 2× les
// pixels. Tout est vectoriel — GeoJSON et polices — donc le PNG de 3840×2160 est
// NATIF. Passer la composition elle-même en 3840×2160 obligerait à re-arbitrer
// chaque coordonnée du spec, et combiné à `--dsf 2` sortirait du 7680×4320.
//
// La piste audio est un `anullsrc` MUET : c'est ce qui rend le concat avec le vlog
// trivial (sans flux audio, le concat audio trouerait) et ça laisse `musique.mjs`
// seul maître du son qui passe dessus.
// 100 % offline.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REGLAGES = path.join(process.env.HOME, 'Movies', 'Montage', 'Réglages');
const lire = (f, d) => { try { return fs.readFileSync(path.join(REGLAGES, f), 'utf8').trim(); } catch { return d; } };

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); if (i < 0) return d; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const out = opt('--out', null);
const fps = Number(opt('--fps', 30));
const garder = argv.includes('--garder');
const specPath = argv.find((a) => !a.startsWith('--'));
if (!specPath || !out) {
  console.error('usage: generique-mp4.mjs <spec.json> --out <x.mp4> [--dsf 1|2] [--fps 30] [--garder]');
  process.exit(1);
}
// défaut du dsf : la DÉFINITION courante (1080 → 1, 2160 → 2), surchargeable.
const DEF = /2160|4k/i.test(lire('definition.txt', '1080')) ? 2160 : 1080;
const dsf = Number(opt('--dsf', DEF === 2160 ? 2 : 1));
const QUALITE = /final/i.test(lire('qualite.txt', 'brouillon')) ? 'final' : 'brouillon';
const W = 1920 * dsf, H = 1080 * dsf;

const run = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'], maxBuffer: 1 << 28 });

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'generique-'));
const html = path.join(work, 'composition.html');
const frames = path.join(work, 'frames');

console.log(`· composition (repère 1920×1080, rendue à dsf ${dsf} → ${W}×${H})`);
run(process.execPath, [path.join(HERE, 'generique.mjs'), specPath, '--out', html]);

const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
const dur = spec.duration;
console.log(`· capture ${Math.round(dur * fps)} frames à ${fps} fps`);
run(process.execPath, [path.join(HERE, 'capture.mjs'), html, '0', String(dur),
  '--dir', frames, '--fps', String(fps), '--dsf', String(dsf)]);

const n = fs.readdirSync(frames).filter((f) => f.endsWith('.png')).length;
const want = Math.round(dur * fps);
if (n !== want) { console.error(`✗ ${n} PNG au lieu de ${want} — capture incomplète.`); process.exit(1); }

// preset : `slow` en 1080p, `medium` en 2160p (mesuré, cf. VENC() dans monte.mjs).
const VENC = QUALITE === 'final'
  ? ['-c:v', 'libx264', '-preset', dsf > 1 ? 'medium' : 'slow', '-crf', '16', '-pix_fmt', 'yuv420p']
  : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p'];

console.log(`· encodage ${QUALITE} → ${out}`);
fs.mkdirSync(path.dirname(out), { recursive: true });
run('ffmpeg', ['-y', '-v', 'error',
  '-framerate', String(fps), '-i', path.join(frames, '%05d.png'),
  '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
  '-map', '0:v:0', '-map', '1:a:0', '-shortest',
  '-vf', `fps=${fps},format=yuv420p,setsar=1`, ...VENC,
  '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2',
  '-video_track_timescale', '15360', '-movflags', '+faststart', out]);

if (garder) console.log(`  (intermédiaires gardés : ${work})`);
else fs.rmSync(work, { recursive: true, force: true });
console.log(`\n✓ ${out}  ·  ${W}×${H} · ${want} images · ${fps} fps · piste muette`);
