// probe.mjs — OUTIL PERMANENT de mesure par plan (remplace les scripts de mesure jetables).
//   node probe.mjs            → mesure les plans de Réglages/plan.txt
//   node probe.mjs R03 R16    → mesure ces plans-là
// Sort : chaleur globale, chaleur+satu de la zone brillante, indice de DORURE (= le gate warmth),
// dose colorbalance qui en résulte, SATAVG/YAVG/YLOW, et le look actif (DA/LUT). Une seule
// extraction de frames partagée (grid) + un signalstats → léger. 100 % offline.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { measurePlate, plateWarmth, plateBrightZone, adaptiveWarmth, adaptiveSaturation, adaptiveBlackpoint } from './filters.mjs';
import { INBOX, STORE } from './store.mjs';   // chemins du store : un seul endroit

const ENG = path.dirname(fileURLToPath(import.meta.url));
const RUSH = INBOX;
const REG = path.join(STORE, 'Réglages');
const cat = JSON.parse(fs.readFileSync(path.join(ENG, 'catalogue/catalogue.json'), 'utf8'));
const byId = Object.fromEntries(cat.map((c) => [c.id, c.file]));

// look actif (info) : lut.txt > DA.txt.lut > DA grade
function activeLook() {
  try { const l = fs.readFileSync(path.join(REG, 'lut.txt'), 'utf8').split('\n')[0].trim(); if (l) return `LUT ${l}`; } catch {}
  try { const da = fs.readFileSync(path.join(REG, 'DA.txt'), 'utf8').split('\n')[0].trim(); if (da) return `DA ${da}`; } catch {}
  return '(défaut)';
}

let ids = process.argv.slice(2).filter((a) => /^R\d+/i.test(a)).map((a) => a.toUpperCase());
if (!ids.length) {
  try {
    ids = fs.readFileSync(path.join(REG, 'plan.txt'), 'utf8').split('\n')
      .map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => l.split(/\s+/)[0]);
  } catch { ids = Object.keys(byId); }
}

console.log(`look actif : ${activeLook()}   (sous LUT → l'adaptatif est court-circuité)`);
console.log('R##  | globW | regW  | rSat | DORURE | warmth dose | SATAVG | YAVG  | YLOW | sat/blk frag');
console.log('-----|-------|-------|------|--------|-------------|--------|-------|------|-------------');
for (const id of ids) {
  const f = byId[id];
  if (!f) { console.log(`${id.padEnd(4)} introuvable`); continue; }
  const file = path.join(RUSH, f);
  const gw = plateWarmth(file), bz = plateBrightZone(file), m = measurePlate(file);
  const idx = bz ? bz.warmth * bz.sat / 100 : null;
  const wFrag = adaptiveWarmth(file), sFrag = adaptiveSaturation(file), bFrag = adaptiveBlackpoint(file);
  const bm = wFrag ? wFrag.match(/bm=([-\d.]+)/)[1] : '—';
  const p = (v, n = 5) => String(v == null ? '?' : (+v).toFixed(1)).padStart(n);
  console.log(`${id.padEnd(4)} | ${p(gw)} | ${p(bz?.warmth)} | ${p(bz?.sat, 4)} | ${p(idx, 6)} | ${String(bm).padStart(11)} | `
    + `${p(m?.SATAVG, 6)} | ${p(m?.YAVG)} | ${p(m?.YLOW, 4)} | ${(sFrag + bFrag) || '(rien)'}`);
}
