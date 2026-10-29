#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// catalogue.mjs — numérote TOUS les rushes et en fait un index visuel partagé.
//
// But : un référentiel commun. Quand Claude dit « R07 », le monteur voit exactement le
// même plan (vignette numérotée). Numérotation auto R01..RNN en ordre chronologique.
//
//   node catalogue.mjs [dossier]     (défaut : « ~/Movies/Montage/Landscape Rush/Déposer les rushes ici »)
//
// Produit ~/Library/Application Support/Montage/catalogue/ :
//   • index_N.jpg    — grilles de vignettes NUMÉROTÉES (Read → on voit R01..RNN)
//   • CATALOGUE.md   — table : R## | fichier | heure | durée | format
//   • catalogue.json — données (pour la curation ensuite)
// 100% local. Ne modifie aucun rush.
// ═══════════════════════════════════════════════════════════════════════════
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import { INBOX } from './store.mjs';   // chemins du store : un seul endroit

const HOME = os.homedir();
const LIB = process.argv[2] || INBOX;
const OUT = path.join(HOME, 'Library', 'Application Support', 'Montage', 'catalogue');
const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.avi', '.mkv', '.webm']);

// scoping par jour, ALIGNÉ sur le moteur (Réglages/jour.txt : YYYY-MM-DD / YYYYMMDD /
// DD/MM/YYYY, une par ligne). Prioritaire : 2e argument CLI. Vide → tous les jours.
// → catalogue et montage voient EXACTEMENT le même sous-ensemble, sans symlink.
function normJour(l) {
  let m;
  if ((m = l.match(/^(\d{4})-?(\d{2})-?(\d{2})$/))) return m[1] + m[2] + m[3];
  if ((m = l.match(/^(\d{2})\/(\d{2})\/(\d{4})$/))) return m[3] + m[2] + m[1];
  return l.replace(/\D/g, '');
}
function readJours() {
  const cli = process.argv[3];
  if (cli) return cli.split(',').map((s) => normJour(s.trim())).filter((d) => d.length === 8);
  try {
    return fs.readFileSync(path.join(HOME, 'Movies', 'Montage', 'Réglages', 'jour.txt'), 'utf8')
      .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
      .map(normJour).filter((d) => d.length === 8);
  } catch { return []; }
}
const JOURS = readJours();

if (!fs.existsSync(LIB)) { console.error('Dossier introuvable :', LIB); process.exit(1); }
const files = fs.readdirSync(LIB)
  .filter((f) => !f.startsWith('.') && !f.startsWith('._') && VIDEO_EXT.has(path.extname(f).toLowerCase()))
  .filter((f) => !JOURS.length || (() => { const m = f.match(/(\d{8})/); return m && JOURS.includes(m[1]); })())
  .map((f) => path.join(LIB, f))
  // ordre chronologique : le nom DJI contient l'horodatage ; sinon mtime
  .sort((a, b) => {
    const ta = (path.basename(a).match(/(\d{14})/) || [])[1] || '';
    const tb = (path.basename(b).match(/(\d{14})/) || [])[1] || '';
    if (ta && tb) return ta.localeCompare(tb);
    return fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs;
  });
if (!files.length) { console.error('Aucun rush dans', LIB); process.exit(1); }

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

function probe(file, entries) {
  return (spawnSync('ffprobe', ['-v', 'error', '-of', 'default=nw=1', '-show_entries', entries, file],
    { encoding: 'utf8' }).stdout || '');
}

const rows = [];
files.forEach((file, i) => {
  const num = String(i + 1).padStart(2, '0');   // R01, R02…
  const id = `R${num}`;
  const dur = parseFloat((probe(file, 'format=duration').match(/duration=([\d.]+)/) || [])[1] || 0);
  const wh = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
    'stream=width,height', '-of', 'default=nw=1', file], { encoding: 'utf8' }).stdout || '';
  const W = +(wh.match(/width=(\d+)/) || [])[1] || 0, H = +(wh.match(/height=(\d+)/) || [])[1] || 0;
  // pas de « : » dans le libellé (casse drawtext) → mots : large / carré / vertical
  const fmt = W && H ? (Math.abs(W / H - 1) < 0.1 ? 'carré' : W > H ? 'large' : 'vertical') : '?';
  const ts = (path.basename(file).match(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/) || []);
  const heure = ts.length ? `${ts[4]}:${ts[5]}:${ts[6]}` : '';
  const jour = ts.length ? `${ts[3]}/${ts[2]}` : '';
  // vignette au milieu du plan, étiquetée avec le NUMÉRO (gros) + durée
  const thumb = path.join(OUT, `t_${num}.jpg`);
  const label = `${id}  ${dur.toFixed(0)}s  ${fmt}`;
  spawnSync('ffmpeg', ['-v', 'error', '-ss', (dur / 2).toFixed(1), '-i', file, '-frames:v', '1',
    '-vf', `scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,scale=360:203,`
      + `drawtext=text='${label}':x=8:y=8:fontsize=34:fontcolor=yellow:box=1:boxcolor=black@0.75:borderw=1`,
    '-y', thumb], { stdio: ['ignore', 'ignore', 'ignore'] });
  rows.push({ id, file: path.basename(file), jour, heure, dur: +dur.toFixed(1), format: fmt, thumb });
});

// grilles visuelles (4 colonnes) — hstack par ligne, vstack des lignes
const COLS = 4;
const thumbs = rows.map((r) => r.thumb).filter((t) => fs.existsSync(t));
const pages = [];
const PER_PAGE = 16;   // 4x4 par page pour rester lisible
for (let p = 0; p * PER_PAGE < thumbs.length; p++) {
  const slice = thumbs.slice(p * PER_PAGE, (p + 1) * PER_PAGE);
  const rowFiles = [];
  for (let r = 0; r * COLS < slice.length; r++) {
    const cells = slice.slice(r * COLS, (r + 1) * COLS);
    const rowOut = path.join(OUT, `page${p}_row${r}.jpg`);
    if (cells.length === 1) { fs.copyFileSync(cells[0], rowOut); }
    else {
      const args = [];
      cells.forEach((c) => { args.push('-i', c); });
      args.push('-filter_complex', `hstack=${cells.length}`, '-y', rowOut);
      spawnSync('ffmpeg', ['-v', 'error', ...args], { stdio: ['ignore', 'ignore', 'ignore'] });
    }
    if (fs.existsSync(rowOut)) rowFiles.push(rowOut);
  }
  const pageOut = path.join(OUT, `index_${p + 1}.jpg`);
  if (rowFiles.length === 1) fs.copyFileSync(rowFiles[0], pageOut);
  else {
    const args = [];
    rowFiles.forEach((r) => { args.push('-i', r); });
    // pad chaque ligne à la même largeur avant vstack
    const fc = rowFiles.map((_, i) => `[${i}]scale=1440:-1[r${i}]`).join(';')
      + ';' + rowFiles.map((_, i) => `[r${i}]`).join('') + `vstack=${rowFiles.length}`;
    args.push('-filter_complex', fc, '-y', pageOut);
    spawnSync('ffmpeg', ['-v', 'error', ...args], { stdio: ['ignore', 'ignore', 'ignore'] });
  }
  if (fs.existsSync(pageOut)) pages.push(pageOut);
}

// CATALOGUE.md + json
const md = ['# Catalogue des rushes — référentiel partagé', '',
  `${rows.length} rushes · numérotation R01..R${String(rows.length).padStart(2, '0')} (ordre chronologique)`,
  '', '| N° | Fichier | Jour | Heure | Durée | Format |', '|---|---|---|---|---|---|',
  ...rows.map((r) => `| **${r.id}** | ${r.file} | ${r.jour} | ${r.heure} | ${r.dur}s | ${r.format} |`),
  '', `Index visuel : ${pages.map((p) => path.basename(p)).join(', ')}`].join('\n');
fs.writeFileSync(path.join(OUT, 'CATALOGUE.md'), md + '\n');
fs.writeFileSync(path.join(OUT, 'catalogue.json'), JSON.stringify(rows, null, 2));
// nettoie les intermédiaires
fs.readdirSync(OUT).filter((f) => /^(t_|page\d)/.test(f)).forEach((f) => fs.rmSync(path.join(OUT, f)));

console.log(`${rows.length} rushes catalogués → R01..R${String(rows.length).padStart(2, '0')}`);
console.log(`Index : ${pages.map((p) => path.basename(p)).join(', ')}`);
console.log(`→ ${OUT}`);
