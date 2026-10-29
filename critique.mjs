#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// critique.mjs — sonde objective d'un montage rendu, pour la boucle d'amélioration.
//
// Ne juge PAS le goût (ça, c'est l'œil de Claude sur la planche-contact) : il
// mesure ce qu'une machine mesure de façon fiable et hors-ligne, pour que la
// critique s'appuie sur des chiffres et pas sur une impression.
//
//   node critique.mjs [chemin.mp4]     (défaut : dernier rendu dans « Landscape Rush »)
//
// Produit ~/Library/Application Support/Montage/critique/<stamp>/ :
//   • planche.jpg   — 24 images régulières (Claude la Read → juge cadrage/récit/diversité)
//   • cuts.jpg      — une image à chaque coupe détectée (juge les transitions)
//   • signals.json  — bandes noires, loudness LUFS/peak, longueur moyenne de plan,
//                     luminance par échantillon (démasque les plans quasi-noirs)
//   • rapport.txt   — lecture humaine des signaux + drapeaux d'alerte
// Aucun réseau, aucune écriture hors de ce dossier. Le montage n'est pas modifié.
// ═══════════════════════════════════════════════════════════════════════════
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import { TESTS } from './store.mjs';   // chemins du store : un seul endroit

const HOME = os.homedir();
const OUT = TESTS;                      // dernier rendu de test (cf. store.mjs)
const CRIT = path.join(HOME, 'Library', 'Application Support', 'Montage', 'critique');

// ---- cible : argument, sinon le .mp4 le plus récent des « Landscape Rush » ----
function latestRender() {
  if (!fs.existsSync(OUT)) return null;
  const f = fs.readdirSync(OUT)
    .filter((x) => x.toLowerCase().endsWith('.mp4') && !x.startsWith('.'))
    .map((x) => ({ x, m: fs.statSync(path.join(OUT, x)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  return f.length ? path.join(OUT, f[0].x) : null;
}
const target = process.argv[2] || latestRender();
if (!target || !fs.existsSync(target)) {
  console.error('Aucun montage à critiquer. Passe un chemin .mp4 ou rends-en un d’abord.');
  process.exit(1);
}

function ff(args) {
  return spawnSync('ffmpeg', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}
function probe(file, entries) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', entries, '-of', 'default=nw=1', file], { encoding: 'utf8' });
  return r.stdout || '';
}

const dur = parseFloat((probe(target, 'format=duration').match(/duration=([\d.]+)/) || [])[1]
  || (spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of',
      'default=nw=1', target], { encoding: 'utf8' }).stdout.match(/duration=([\d.]+)/) || [])[1]
  || 0);
const wh = probe(target, 'stream=width,height');
const width = +(wh.match(/width=(\d+)/) || [])[1] || 0;
const height = +(wh.match(/height=(\d+)/) || [])[1] || 0;

const stamp = path.basename(target).replace(/\.mp4$/i, '').replace(/[^0-9A-Za-z_-]+/g, '_');
const dir = path.join(CRIT, stamp);
fs.mkdirSync(dir, { recursive: true });

// mode du montage (si le projet persistant existe) → adapte les seuils : en AMBIANCE
// les plans tenus longtemps sont VOULUS, on ne les flague pas comme « traînants ».
let mode = null;
try {
  const projStamp = path.basename(target).replace(/^Montage /, '').replace(/\.mp4$/i, '');
  mode = JSON.parse(fs.readFileSync(path.join(HOME, 'Library', 'Application Support',
    'Montage', 'projects', projStamp, 'project.json'), 'utf8')).mode || null;
} catch { /* pas de projet → seuils génériques */ }
const isAmbiance = /ambiance/i.test(mode || '');

// ── 1) bandes noires (letterbox/pillarbox) sur la SORTIE : on ne doit plus en avoir
const cd = ff(['-hide_banner', '-i', target, '-vf', 'cropdetect=round=2:reset=0',
  '-frames:v', '300', '-f', 'null', '-']).stderr || '';
const crops = [...cd.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)].map((m) => m.slice(1).map(Number));
const lastCrop = crops.length ? crops[crops.length - 1] : [width, height, 0, 0];
const letterbox = lastCrop[0] < width - 4 || lastCrop[1] < height - 4;

// ── 2) loudness intégrée (EBU R128) — cohérence de niveau + saturation
const eb = ff(['-hide_banner', '-i', target, '-af', 'ebur128=peak=true', '-f', 'null', '-']).stderr || '';
const lufs = parseFloat((eb.match(/I:\s*(-?[\d.]+)\s*LUFS/g) || []).pop()?.match(/(-?[\d.]+)/)?.[1] ?? NaN);
const peak = parseFloat((eb.match(/Peak:\s*(-?[\d.]+)\s*dBFS/g) || []).pop()?.match(/(-?[\d.]+)/)?.[1] ?? NaN);

// ── 3) coupes détectées → longueur moyenne de plan (rythme)
const sc = ff(['-hide_banner', '-i', target, '-vf', "select='gt(scene,0.4)',metadata=print",
  '-an', '-f', 'null', '-']).stderr || '';
const cutTimes = [...sc.matchAll(/pts_time:([\d.]+)/g)].map((m) => +m[1]);
const nShots = cutTimes.length + 1;
const avgShot = dur / nShots;

// ── 4) luminance échantillonnée (1/s) — démasque les plans quasi-noirs (nuit ratée)
const ss = ff(['-hide_banner', '-i', target, '-vf', 'fps=1,signalstats,metadata=print',
  '-an', '-f', 'null', '-']).stderr || '';
const yavg = [...ss.matchAll(/lavfi\.signalstats\.YAVG=([\d.]+)/g)].map((m) => +m[1]);
const darkFrac = yavg.length ? yavg.filter((y) => y < 16).length / yavg.length : 0;
const medianY = yavg.length ? [...yavg].sort((a, b) => a - b)[Math.floor(yavg.length / 2)] : null;

// ── 5) planches-contact : régulière (récit) + aux coupes (transitions)
const nTiles = 24, cols = 6, rows = 4;
ff(['-y', '-i', target, '-vf', `fps=${(nTiles / Math.max(dur, 1)).toFixed(4)},scale=320:-1,tile=${cols}x${rows}`,
  '-frames:v', '1', path.join(dir, 'planche.jpg')]);
if (cutTimes.length) {
  const sel = cutTimes.slice(0, 24).map((t) => `eq(n\\,${Math.round(t * 30)})`).join('+');
  ff(['-y', '-i', target, '-vf', `select='${sel}',scale=320:-1,tile=6x4`,
    '-frames:v', '1', '-vsync', '0', path.join(dir, 'cuts.jpg')]);
}

// ── drapeaux d'alerte (seuils volontairement prudents pour de la nuit urbaine) ──
const flags = [];
if (letterbox) flags.push(`BANDES NOIRES en sortie (crop ${lastCrop[0]}x${lastCrop[1]}) — le cadrage n'a pas rempli l'image`);
// Le vrai pic mesuré sur de l'AAC (lossy) sied naturellement vers 0 : le codec
// réintroduit du pic inter-échantillon après le limiteur. On ne flague donc que
// la vraie saturation (nettement > 0), pas ce résidu de codec.
if (!isNaN(peak) && peak > 0.5) flags.push(`AUDIO sature (peak ${peak} dBFS) — vraie saturation`);
if (!isNaN(lufs) && lufs > -12) flags.push(`AUDIO fort (${lufs} LUFS) — YouTube normalise vers -14`);
if (!isNaN(lufs) && lufs < -20) flags.push(`AUDIO faible (${lufs} LUFS)`);
if (darkFrac > 0.25) flags.push(`${Math.round(darkFrac * 100)}% des images quasi-noires (YAVG<16) — plans sous-exposés ?`);
if (avgShot < 0.8) flags.push(`plans très courts (${avgShot.toFixed(2)}s) — risque de clignotement`);
// en ambiance, tenir les plans est le but ; on n'alerte que si c'est vraiment interminable
if (avgShot > (isAmbiance ? 18 : 6)) flags.push(`plans longs (${avgShot.toFixed(1)}s) — rythme peut traîner`);
if (dur < 20) flags.push(`montage court (${dur.toFixed(0)}s)`);

const signals = {
  cible: target, genere: new Date().toISOString(),
  duree_s: +dur.toFixed(1), resolution: `${width}x${height}`,
  bandes_noires: letterbox, crop_detecte: lastCrop.join(':'),
  loudness_LUFS: isNaN(lufs) ? null : lufs, peak_dBFS: isNaN(peak) ? null : peak,
  coupes: cutTimes.length, plans: nShots, plan_moyen_s: +avgShot.toFixed(2),
  luminance_mediane: medianY, fraction_quasi_noir: +darkFrac.toFixed(3),
  drapeaux: flags,
};
fs.writeFileSync(path.join(dir, 'signals.json'), JSON.stringify(signals, null, 2));

const rap = [
  `CRITIQUE — ${path.basename(target)}`,
  `durée ${dur.toFixed(0)}s · ${width}x${height} · ${nShots} plans · plan moyen ${avgShot.toFixed(2)}s`,
  `audio : ${isNaN(lufs) ? '?' : lufs + ' LUFS'} / peak ${isNaN(peak) ? '?' : peak + ' dBFS'}`,
  `luminance médiane ${medianY ?? '?'} · quasi-noir ${Math.round(darkFrac * 100)}%`,
  `bandes noires : ${letterbox ? 'OUI ⚠' : 'non'}`,
  '',
  flags.length ? 'DRAPEAUX :\n' + flags.map((f) => '  ⚠ ' + f).join('\n') : 'Aucun drapeau objectif.',
  '',
  `Planches : ${path.join(dir, 'planche.jpg')}`,
  cutTimes.length ? `          ${path.join(dir, 'cuts.jpg')}` : '',
  '',
  'À JUGER À L’ŒIL (la machine ne sait pas) : récit (établissement→détails→clôture),',
  'diversité des angles, plans redondants, cadrage (trop de ciel ?), respiration.',
].filter(Boolean).join('\n');
fs.writeFileSync(path.join(dir, 'rapport.txt'), rap + '\n');
console.log(rap);
console.log(`\n→ ${dir}`);
