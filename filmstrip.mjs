#!/usr/bin/env node
// filmstrip.mjs — PELLICULE par rush pour la curation « récit intelligent ».
//
// But : donner à Claude de quoi VOIR l'intérieur d'un plan (pas juste une vignette),
// pour décider où COUPER (tilt vers le haut déjà vu, va-et-vient, retour répété…) et
// repérer les répétitions ENTRE plans. Une image par ~1 s, le TEMPS gravé sur chaque
// cellule → Claude peut dire « R07 : garder 0–6 s, couper le tilt 6–9 s ».
//
// Usage :
//   node filmstrip.mjs                 → tous les rushes du jour actif (Réglages/jour.txt)
//   node filmstrip.mjs 0.5             → pas de 0,5 s (plus fin, pour caler une coupe)
//   node filmstrip.mjs 1 R07           → un seul rush (par numéro catalogue)
//
// Produit ~/Library/Application Support/Montage/catalogue/strips/R##_strip.jpg
// (numérotation R## IDENTIQUE à catalogue.mjs : même scope-jour, même ordre chrono).

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { INBOX } from './store.mjs';   // chemins du store : un seul endroit

const HOME = process.env.HOME;
const LIB = INBOX;
const OUT = path.join(HOME, 'Library', 'Application Support', 'Montage', 'catalogue', 'strips');
const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.avi', '.mkv', '.webm']);

// ── Arguments ────────────────────────────────────────────────────────────────
//   node filmstrip.mjs                    → pellicule ENTIÈRE, 1 image/s
//   node filmstrip.mjs 0.5                → pas de 0,5 s
//   node filmstrip.mjs 1 R07              → un seul rush
//   node filmstrip.mjs --fin              → mode QUEUE : les 1,5 dernières secondes, 1 image/0,1 s
//   node filmstrip.mjs --fin=2 --pas=0.05 R15
//
// MODE QUEUE (--fin, ajouté le 29/07) — pourquoi il existe :
//   le monteur, jour 20 R15 : « petit accroc caméra à identifier et à enlever sur la fin ». Ce n'était pas
//   une secousse (deshake mesure ≤ 2 px sur tout le plan, la mesure ne voit RIEN) : c'était un
//   travelling avant qui finit par faire SORTIR le sujet du cadre — le panier de baozi entier à
//   1,70 s, coupé par le bord à 1,90 s. Ce défaut-là (STYLE §E-bis) n'est outillé nulle part :
//   toute la chaîne mesure du DÉPLACEMENT, jamais l'entrée d'un sujet dans le bord du cadre.
//   En attendant une vraie sonde, ce mode rend la vérification manuelle quasi gratuite — et c'est
//   lui qui produira les cas d'étalonnage dont cette sonde aura besoin.
//   L'horodatage gravé est ABSOLU dans le rush (grâce à -copyts) : le chiffre lu se colle tel quel
//   dans plan.txt (`R15 0-1.8`).
const ARGV = process.argv.slice(2);
const finArg = ARGV.find((a) => /^--fin(=|$)/.test(a));
const pasArg = ARGV.find((a) => /^--pas=/.test(a));
const POS = ARGV.filter((a) => !a.startsWith('--'));
const FIN = finArg ? (parseFloat((finArg.split('=')[1] || '')) || 1.5) : null;  // fenêtre de queue (s)
const STEP = FIN
  ? Math.max(0.05, parseFloat((pasArg || '').split('=')[1]) || 0.1)
  : Math.max(0.25, parseFloat(POS.find((a) => /^\d*\.?\d+$/.test(a))) || 1.0);
const ONLY = (POS.find((a) => /^R\d{1,3}$/i.test(a)) || '').toUpperCase();  // ex. R07 (optionnel)
const COLS = 6;

// scope-jour, ALIGNÉ sur le moteur/catalogue (Réglages/jour.txt : YYYY-MM-DD…)
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
    if (ta && tb) return ta.localeCompare(tb);
    return fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs;
  });
if (!files.length) { console.error('Aucun rush pour ce jour dans', LIB); process.exit(1); }

fs.mkdirSync(OUT, { recursive: true });

function dur(file) {
  const o = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=nw=1:nk=1', file], { encoding: 'utf8' }).stdout || '';
  return parseFloat(o) || 0;
}

let made = 0;
files.forEach((file, i) => {
  const id = `R${String(i + 1).padStart(2, '0')}`;
  if (ONLY && id !== ONLY) return;
  const d = dur(file);
  if (d <= 0) { console.error(`${id} : durée nulle, sauté`); return; }
  // Mode QUEUE : on ne couvre que les FIN dernières secondes (départ jamais négatif).
  const span = FIN ? Math.min(FIN, d) : d;
  const start = FIN ? Math.max(0, d - span) : 0;
  const n = Math.max(1, Math.ceil(span / STEP));
  const rows = Math.ceil(n / COLS);
  const fps = (1 / STEP).toFixed(4);
  // fps=1/STEP → une image tous les STEP s ; le pts APRÈS fps reflète la seconde source
  // → drawtext '%{pts}' = l'horodatage réel du plan (ce que Claude cite pour couper).
  // scale à 360 de large, timecode gravé, puis mosaïque chrono COLS×rows.
  const vf = `fps=${fps},scale=360:-1:force_original_aspect_ratio=decrease`
    + `,drawtext=text='%{pts\\:hms}':x=6:y=6:fontsize=22:fontcolor=yellow:box=1:boxcolor=black@0.72:borderw=1`
    + `,tile=${COLS}x${rows}:padding=6:margin=6:color=0x111111`;
  const out = path.join(OUT, FIN ? `${id}_fin.jpg` : `${id}_strip.jpg`);
  // -copyts + -ss EN ENTRÉE : le pts gravé reste l'horodatage ABSOLU du rush (sans copyts il
  // repartirait de 0 et le chiffre lu serait inutilisable tel quel dans plan.txt).
  const seek = FIN ? ['-copyts', '-ss', start.toFixed(3)] : [];
  const r = spawnSync('ffmpeg', ['-y', ...seek, '-i', file, '-vf', vf, '-frames:v', '1', '-q:v', '3', out],
    { encoding: 'utf8' });
  if (fs.existsSync(out)) {
    made++;
    const scope = FIN ? `queue ${start.toFixed(1)}→${d.toFixed(1)}s` : `${d.toFixed(0)}s`;
    console.log(`${id}  ${scope}  → ${n} images (${COLS}×${rows}, pas ${STEP}s)  ${path.basename(out)}`);
  } else {
    console.error(`${id} : échec ffmpeg\n${(r.stderr || '').split('\n').slice(-4).join('\n')}`);
  }
});
console.log(`\n${made} pellicule(s) → ${OUT}`);
