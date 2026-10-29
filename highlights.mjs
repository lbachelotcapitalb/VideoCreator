#!/usr/bin/env node
// highlights.mjs — IDENTIFIE les plans aux hautes lumières trop intenses (à dompter).
//
// Pour chaque rush du jour (R## comme catalogue), mesure :
//   • clip%  = pixels quasi-blancs (Y≥250) → cramés DUR (détail perdu à la capture).
//   • bloom% = pixels très clairs (Y≥235) → lumières intenses qui « bavent » (récupérables).
// Puis suggère un flag : rien / `hi` / `hi2`. À reporter dans Réglages/plan.txt (« R15 hi »).
// Source 10-bit DJI → l'essentiel est récupérable ; le rolloff (hiTame) rend la texture.
//
// Usage : node highlights.mjs            (tous les rushes du jour actif)
//         node highlights.mjs R15        (un seul)

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { INBOX } from './store.mjs';   // chemins du store : un seul endroit

const HOME = process.env.HOME;
const LIB = INBOX;
const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.avi', '.mkv', '.webm']);
const ONLY = (process.argv[2] || '').toUpperCase().replace(/[^R0-9]/g, '');

function readJours() {
  try {
    return fs.readFileSync(path.join(HOME, 'Movies', 'Montage', 'Réglages', 'jour.txt'), 'utf8')
      .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
      .map((l) => l.replace(/\D/g, '')).filter((d) => d.length === 8);
  } catch { return []; }
}
const JOURS = readJours();

const files = fs.readdirSync(LIB)
  .filter((f) => !f.startsWith('.') && !f.startsWith('._') && VIDEO_EXT.has(path.extname(f).toLowerCase()))
  .filter((f) => !JOURS.length || (() => { const m = f.match(/(\d{8})/); return m && JOURS.includes(m[1]); })())
  .map((f) => path.join(LIB, f))
  .sort((a, b) => {
    const ta = (path.basename(a).match(/(\d{14})/) || [])[1] || '';
    const tb = (path.basename(b).match(/(\d{14})/) || [])[1] || '';
    return ta && tb ? ta.localeCompare(tb) : fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs;
  });
if (!files.length) { console.error('Aucun rush pour ce jour.'); process.exit(1); }

function dur(file) {
  const o = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=nw=1:nk=1', file], { encoding: 'utf8' }).stdout || '';
  return parseFloat(o) || 0;
}
// fraction (%) de pixels dont Y ≥ seuil, moyennée sur qq frames (masque → YAVG/255).
// ⚠️ INDICATIF SEULEMENT : ce chiffre mesure la CHARGE de hautes lumières, mais NE
// distingue PAS une « surface lavée » (façade/bateau washé = à dompter) de « néons
// vivants » (points brillants texturés = OK, voulus). Un plan très néon (R03) sort plus
// haut qu'un plan à façade lavée (R15) alors que c'est R15 qu'il faut dompter. Le vrai
// repérage = à l'ŒIL (surface large + lisse + brillante = lavée). Ici : juste une alerte.
function brightPct(file, thr, times) {
  let acc = 0, n = 0;
  for (const t of times) {
    const r = spawnSync('ffmpeg', ['-ss', t.toFixed(2), '-i', file, '-frames:v', '1',
      '-vf', `format=gray,lutyuv=y='if(gte(val,${thr}),255,0)',signalstats,metadata=print:key=lavfi.signalstats.YAVG`,
      '-f', 'null', '-'], { encoding: 'utf8' });
    const m = (r.stderr || '').match(/YAVG=([\d.]+)/);
    if (m) { acc += parseFloat(m[1]) / 255 * 100; n++; }
  }
  return n ? acc / n : 0;
}

console.log('R##   clip%(≥250)  bloom%(≥235)   [charge indicative — le tri « surface lavée » reste à l’œil]');
files.forEach((file, i) => {
  const id = `R${String(i + 1).padStart(2, '0')}`;
  if (ONLY && id !== ONLY) return;
  const d = dur(file); if (d <= 0) return;
  const times = [0.3, 0.5, 0.7].map((f) => d * f);
  const clip = brightPct(file, 250, times);
  const bloom = brightPct(file, 235, times);
  console.log(`${id}     ${clip.toFixed(2).padStart(6)}      ${bloom.toFixed(2).padStart(6)}`);
});
console.log('\nRappel : forte charge ≠ à corriger (néons = OK). Regarder le plan : une GRANDE');
console.log('surface claire+lisse (façade, bateau) qui bave → `R## hi` (ou `hi2`) dans plan.txt.');
