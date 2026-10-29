#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// analyse-reference.mjs — apprendre d'une vidéo BIEN montée (référence du monteur).
//
// le monteur dépose une vidéo qu'il trouve réussie ; on en tire un PROFIL chiffré et
// objectif (durée des plans, rythme des coupes, dynamique par plan, audio) que
// le moteur pourra viser. C'est l'inverse de critique.mjs (qui juge NOTRE sortie) :
// ici on mesure une RÉFÉRENCE pour en apprendre.
//
//   node analyse-reference.mjs <video>            (ou un dossier « Références/ »)
//
// Produit ~/Library/Application Support/Montage/references/<nom>/ :
//   • profil.json   — distribution des durées de plan, coupes/min, dynamique, audio
//   • planche.jpg   — 30 images (Claude la Read → comprend le style à l'œil)
//   • coupes.jpg    — une image à chaque coupe (juge les transitions/raccords)
//   • rapport.txt   — lecture humaine + ce qu'on en retient pour le moteur
//
// Les chiffres SEULS ne font pas un style : ils cadrent la discussion. C'est en
// regardant la planche + en lisant le rapport que Claude enrichit STYLE.md.
// 100% local, aucun réseau. La vidéo de référence n'est pas modifiée.
// ═══════════════════════════════════════════════════════════════════════════
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';

const HOME = os.homedir();
const REFDIR = path.join(HOME, 'Library', 'Application Support', 'Montage', 'references');

const arg = process.argv[2];
if (!arg) { console.error('Usage : node analyse-reference.mjs <video|dossier>'); process.exit(1); }
// un dossier → on prend la première vidéo dedans
let target = arg;
try {
  if (fs.statSync(arg).isDirectory()) {
    const v = fs.readdirSync(arg).find((f) => /\.(mp4|mov|m4v|mkv|webm)$/i.test(f) && !f.startsWith('.'));
    if (!v) { console.error('Aucune vidéo dans ce dossier.'); process.exit(1); }
    target = path.join(arg, v);
  }
} catch { console.error('Introuvable :', arg); process.exit(1); }

function ff(args) { return spawnSync('ffmpeg', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); }
function probe(entries) {
  return (spawnSync('ffprobe', ['-v', 'error', '-of', 'default=nw=1', '-show_entries', entries, target],
    { encoding: 'utf8' }).stdout || '');
}

const dur = parseFloat((probe('format=duration').match(/duration=([\d.]+)/) || [])[1] || 0);
const wh = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
  'stream=width,height', '-of', 'default=nw=1', target], { encoding: 'utf8' }).stdout || '';
const W = +(wh.match(/width=(\d+)/) || [])[1] || 0, H = +(wh.match(/height=(\d+)/) || [])[1] || 0;
const hasAudio = /codec_type=audio/.test(probe('stream=codec_type'));

const name = path.basename(target).replace(/\.[^.]+$/, '').replace(/[^0-9A-Za-z_-]+/g, '_');
const dir = path.join(REFDIR, name);
fs.mkdirSync(dir, { recursive: true });

// ── coupes → durées de plan (le cœur : COMBIEN DE TEMPS un plan est tenu) ──────
const sc = ff(['-hide_banner', '-i', target, '-vf', "select='gt(scene,0.35)',metadata=print",
  '-an', '-f', 'null', '-']).stderr || '';
const cuts = [...sc.matchAll(/pts_time:([\d.]+)/g)].map((m) => +m[1]);
const bounds = [0, ...cuts, dur];
const shots = [];
for (let i = 0; i < bounds.length - 1; i++) { const d = bounds[i + 1] - bounds[i]; if (d > 0.05) shots.push(d); }
const sorted = [...shots].sort((a, b) => a - b);
const q = (p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : null;
const cutsPerMin = dur > 0 ? (cuts.length / dur) * 60 : 0;
// histogramme grossier des durées de plan
const buckets = { '<1s': 0, '1-2s': 0, '2-4s': 0, '4-8s': 0, '>8s': 0 };
for (const d of shots) buckets[d < 1 ? '<1s' : d < 2 ? '1-2s' : d < 4 ? '2-4s' : d < 8 ? '4-8s' : '>8s']++;

// TODO dynamique par plan (statique/contemplatif vs animé) → lève le « combien de
// temps tenir » de façon fiable. mpdecimate donnait 0 (parse), à refaire via flux
// optique ou différence d'images échantillonnée. Métrique retirée tant que fausse.

// ── audio : musique (continu, fort) vs parole/ambiance ────────────────────────
let lufs = null, music = null;
if (hasAudio) {
  const eb = ff(['-hide_banner', '-i', target, '-af', 'ebur128=peak=true', '-f', 'null', '-']).stderr || '';
  lufs = parseFloat((eb.match(/I:\s*(-?[\d.]+)\s*LUFS/g) || []).pop()?.match(/(-?[\d.]+)/)?.[1] ?? NaN);
  music = !isNaN(lufs) && lufs > -20;   // une bande musicale posée est en général forte et constante
}

// ── planches : régulière (style) + aux coupes (raccords) ──────────────────────
ff(['-y', '-i', target, '-vf', `fps=${(30 / Math.max(dur, 1)).toFixed(4)},scale=320:-1,tile=6x5`,
  '-frames:v', '1', path.join(dir, 'planche.jpg')]);
if (cuts.length) {
  const sel = cuts.slice(0, 24).map((t) => `eq(n\\,${Math.round(t * 30)})`).join('+');
  ff(['-y', '-i', target, '-vf', `select='${sel}',scale=320:-1,tile=6x4`,
    '-frames:v', '1', '-vsync', '0', path.join(dir, 'coupes.jpg')]);
}

const profil = {
  reference: target, genere: new Date().toISOString(),
  duree_s: +dur.toFixed(1), resolution: `${W}x${H}`, ratio: +(W / H).toFixed(2),
  plans: shots.length, coupes_par_min: +cutsPerMin.toFixed(1),
  plan_median_s: q(0.5) ? +q(0.5).toFixed(1) : null,
  plan_court_s: q(0.1) ? +q(0.1).toFixed(1) : null,
  plan_long_s: q(0.9) ? +q(0.9).toFixed(1) : null,
  distribution: buckets,
  audio_LUFS: isNaN(lufs) ? null : lufs, musique_probable: music,
};
fs.writeFileSync(path.join(dir, 'profil.json'), JSON.stringify(profil, null, 2));

const rap = [
  `RÉFÉRENCE — ${path.basename(target)}`,
  `${dur.toFixed(0)}s · ${W}x${H} (ratio ${(W / H).toFixed(2)}) · ${shots.length} plans`,
  `RYTHME : ${cutsPerMin.toFixed(1)} coupes/min · plan médian ${q(0.5)?.toFixed(1)}s (court ${q(0.1)?.toFixed(1)}s → long ${q(0.9)?.toFixed(1)}s)`,
  `distribution des plans : ${Object.entries(buckets).map(([k, v]) => `${k}:${v}`).join('  ')}`,
  hasAudio ? `AUDIO : ${isNaN(lufs) ? '?' : lufs + ' LUFS'} → ${music ? 'musique posée probable' : 'ambiance/parole probable'}` : 'AUDIO : aucun',
  '',
  `Planches : ${path.join(dir, 'planche.jpg')}`,
  cuts.length ? `          ${path.join(dir, 'coupes.jpg')}` : '',
  '',
  'À EN TIRER (Claude, en regardant la planche) : combien de temps les plans sont tenus,',
  'l’ordre (établissement large → détails → clôture ?), les raccords (sur mouvement ? cut franc ?),',
  'le rôle de la musique, la part de plans larges vs serrés. → consigner dans STYLE.md.',
].filter(Boolean).join('\n');
fs.writeFileSync(path.join(dir, 'rapport.txt'), rap + '\n');
console.log(rap);
console.log(`\n→ ${dir}`);
