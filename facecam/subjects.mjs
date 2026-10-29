#!/usr/bin/env node
// ============================================================================
// facecam/subjects.mjs — CARTE DES SUJETS (vision holistique).
// Met À PLAT les îlots de parole de TOUS les rush (produits par map.mjs), les
// compare, et dresse LA liste des sujets traités — un sujet pouvant avoir été
// REFAIT plusieurs fois, y compris SUR PLUSIEURS RUSH (reprises de prises).
// Pour chaque sujet : toutes ses occurrences (rush + timecode) + une meilleure
// PROVISOIRE. AUCUN cut : c'est la cartographie qui précède l'écriture de l'EDL.
//
// Entrée : la carte JSON de `map.mjs` ({rushDir, clips:[{id,name,islands:[{a,b,text}]}]}).
//   → les îlots (bornés par silencedetect) sont les BLOCS : granularité fiable,
//     contrairement aux gaps entre mots du modèle small qui bunchent.
// Sortie : <carte>.subjects.json + carte lisible.
//
// Regroupement LEXICAL pondéré IDF (reprises = quasi-verbatim ; les mots
// distinctifs pèsent, les génériques s'effacent → pas de faux regroupement).
// Similarité SÉMANTIQUE (mêmes mots différents) = surcouche embeddings/Claude, plus tard.
//
// Usage: node facecam/subjects.mjs <carte.json> [--sim 0.45]
// ============================================================================
import fs from 'node:fs';

const args = process.argv.slice(2);
const cartePath = args.find((a) => !a.startsWith('--'));
if (!cartePath) { console.error('usage: node facecam/subjects.mjs <carte.json> [--sim 0.45]'); process.exit(1); }
const SIM = +(args[args.indexOf('--sim') + 1]) || 0.45;
const carte = JSON.parse(fs.readFileSync(cartePath, 'utf8'));

const STOP = new Set(('a à au aux avec ce ces dans de des du elle en et eux il je la le les leur '
  + 'lui ma mais me même mes moi mon ne nos notre nous on ou où par pas pour qu que qui sa se ses '
  + 'son sur ta te tes toi ton tu un une vos votre vous c d j l m n s t y est sont été être ai as '
  + 'avait cette donc voilà genre chose truc trucs peu près plus très bien fait faire là ça comme '
  + 'quoi vais veux alors enfin ici aussi cest tout tous toute peut').split(/\s+/));
const deburr = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const toks = (t) => deburr((t || '').toLowerCase()).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w));
const tf = (ws) => { const m = new Map(); for (const w of ws) m.set(w, (m.get(w) || 0) + 1); return m; };
function cosine(a, b) { let dot = 0, na = 0, nb = 0;
  for (const [k, v] of a) { na += v * v; if (b.has(k)) dot += v * b.get(k); }
  for (const v of b.values()) nb += v * v;
  return na && nb ? dot / Math.sqrt(na * nb) : 0; }

// 1) à plat : chaque îlot = un bloc candidat {rush, a, b, text}
const blocks = [];
for (const c of carte.clips || [])
  for (const isl of c.islands || [])
    if ((isl.text || '').trim()) blocks.push({ rush: c.name, a: isl.a, b: isl.b, dur: +(isl.b - isl.a).toFixed(1), text: isl.text.trim() });
for (const b of blocks) b.tf = tf(toks(b.text));
const cand = blocks.filter((b) => b.tf.size >= 4);

// 2) IDF : un mot rare (distinctif) pèse, un mot partout s'efface
const N = cand.length || 1;
const df = new Map();
for (const b of cand) for (const k of b.tf.keys()) df.set(k, (df.get(k) || 0) + 1);
const idf = (k) => Math.log((N + 1) / ((df.get(k) || 0) + 0.5));
for (const b of cand) { const w = new Map(); for (const [k, v] of b.tf) w.set(k, v * idf(k)); b.tf = w; }

// 3) clustering single-linkage glouton (regroupe les reprises, cross-rush inclus)
const clusters = [];
for (const b of cand) {
  let best = null, bestSim = SIM;
  for (const c of clusters) { const s = Math.max(...c.members.map((m) => cosine(b.tf, m.tf))); if (s >= bestSim) { bestSim = s; best = c; } }
  (best ? best.members : (clusters.push({ members: [] }), clusters[clusters.length - 1].members)).push(b);
}

// 4) sujets : occurrences + meilleure PROVISOIRE (l'îlot le plus complet = le plus long ;
//    remplacé par le scoreur pondéré audio+vidéo — score_video.py — à l'étape suivante)
const subjects = clusters.map((c) => {
  const occ = c.members.map((m) => ({ rush: m.rush, a: +m.a.toFixed(1), b: +m.b.toFixed(1), dur: m.dur, text: m.text.slice(0, 140) }))
    .sort((x, y) => y.dur - x.dur);
  const freq = new Map();
  for (const m of c.members) for (const [k, v] of m.tf) freq.set(k, (freq.get(k) || 0) + v);
  const label = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map((e) => e[0]).join(' ');
  return { label, nOcc: occ.length, nRush: new Set(occ.map((o) => o.rush)).size, best: occ[0], occurrences: occ };
}).sort((a, b) => b.nOcc - a.nOcc);

const retaken = subjects.filter((s) => s.nOcc >= 2);
const outPath = cartePath.replace(/\.json$/, '') + '.subjects.json';
fs.writeFileSync(outPath, JSON.stringify({ sim: SIM, nSubjects: subjects.length, nRetaken: retaken.length, subjects }, null, 1));

console.log(`CARTE DES SUJETS (holistique) — ${cand.length} îlots sur ${(carte.clips || []).length} rush`);
console.log(`${subjects.length} sujets distincts · ${retaken.length} REFAITS (≥2 prises)\n`);
console.log('=== SUJETS REFAITS (à départager → garder la meilleure) ===');
for (const s of retaken) {
  console.log(`\n▸ « ${s.label} » — ${s.nOcc} prises${s.nRush >= 2 ? `  ⟂ ${s.nRush} rush` : ''}`);
  s.occurrences.forEach((o, i) => console.log(`   ${i === 0 ? '★ + complète' : '  autre    '} ${o.rush} @${o.a}-${o.b}s (${o.dur}s) : ${o.text}`));
}
console.log(`\n→ ${outPath}  (★ = PROVISOIRE = îlot le plus long ; le scoreur pondéré audio+vidéo tranchera)`);
