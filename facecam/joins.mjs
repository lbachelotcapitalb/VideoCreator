#!/usr/bin/env node
// ============================================================================
// facecam/joins.mjs — RÉGULATEUR ANTI-SUR-DÉCOUPE (contrôle du plan AVANT rendu).
// Consigne du monteur : pas de recherche de perfection stricte, elle crée 3 effets
// pervers. Ce module les MESURE sur une EDL et alerte, sans rien couper :
//   (a) segments TROP COURTS  -> « accumulation de cuts courts »
//   (b) SAUT DE POSE au raccord -> « mes positions contrastées varient vite »
//       (pose de tête + centre du visage de part et d'autre du joint, mediapipe)
//   (c) densité de cuts        -> nb de raccords par minute gardée
// Verdict : un raccord n'est propre que s'il l'est à l'oreille (silence, géré par
// refine/render) ET à l'œil (pose continue). Rapport + JSON, JAMAIS destructif :
// le plan reste gelé, c'est toi qui arbitres.
//
// Usage: node facecam/joins.mjs <edl.json|edl.refined.json> [--minseg 1.2] [--jump 25]
//   --minseg : durée (s) en dessous de laquelle un segment est « trop court »
//   --jump   : degrés cumulés (|Δyaw|+|Δpitch|+|Δroll|) au-delà desquels ça saute
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { listClips, resolveRushDir } from './lib.mjs';

const ENGINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PY = path.join(ENGINE, '.venv-vision', 'bin', 'python');
const POSE = path.join(ENGINE, 'facecam', 'pose_at.py');

const argv = process.argv.slice(2);
const edlPath = argv.find((a) => !a.startsWith('--'));
if (!edlPath) { console.error('usage: node facecam/joins.mjs <edl.json> [--minseg 1.2] [--jump 25]'); process.exit(1); }
const gf = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? parseFloat(argv[i + 1]) : d; };
const MIN_SEG = gf('--minseg', 1.2);     // segment plus court = micro-fragment
const JUMP_DEG = gf('--jump', 25);       // degrés cumulés = saut de pose franc
const JUMP_POS = gf('--pos', 0.05);      // décalage du centre du visage (normalisé)
const MIN_GAIN = gf('--gain', 0.3);      // gain mini pour PROPOSER un regroupement (d)
const EDGE = 0.15;                       // on sonde à 0.15 s du bord du segment

const edl = JSON.parse(fs.readFileSync(edlPath, 'utf8'));
const rushDir = resolveRushDir(edl.rushDir);
const fileOf = Object.fromEntries(listClips(rushDir).map((c) => [c.id, c.file]));

// --- 1) instants à sonder : fin de chaque span + début du suivant --------------
const need = new Map();                  // clip -> Set(temps)
const want = (clip, t) => { if (!need.has(clip)) need.set(clip, new Set()); need.get(clip).add(+t.toFixed(2)); };
edl.spans.forEach((sp) => { want(sp.clip, sp.a + EDGE); want(sp.clip, Math.max(sp.a, sp.b - EDGE)); });

// --- 2) une seule passe mediapipe PAR CLIP (batch) ----------------------------
const poses = new Map();                 // `${clip}@${t}` -> pose
for (const [clip, ts] of need) {
  const file = fileOf[clip];
  if (!file) continue;
  const list = [...ts].sort((a, b) => a - b);
  try {
    const out = execFileSync(PY, [POSE, file, list.join(',')], { maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    for (const p of JSON.parse(out).poses) poses.set(`${clip}@${(+p.t).toFixed(2)}`, p);
  } catch { /* clip illisible -> joints non mesurés, signalé plus bas */ }
}
const poseAt = (clip, t) => poses.get(`${clip}@${(+t).toFixed(2)}`);

// --- 3) analyse : segments courts + sauts de pose aux raccords -----------------
const short = [], jumps = [], unmeasured = [];
let keptTotal = 0, nCuts = 0;
edl.spans.forEach((sp, i) => {
  const dur = (sp.b - sp.a) - (sp.cuts || []).reduce((s, [c0, c1]) => s + (c1 - c0), 0);
  keptTotal += dur;
  nCuts += 1 + (sp.cuts || []).length;                      // le joint + les cuts internes
  if (dur < MIN_SEG) short.push({ i, clip: sp.clip, label: sp.label || '', dur: +dur.toFixed(2) });
  const next = edl.spans[i + 1];
  if (!next) return;
  const pEnd = poseAt(sp.clip, Math.max(sp.a, sp.b - EDGE));
  const pStart = poseAt(next.clip, next.a + EDGE);
  if (!pEnd?.face || !pStart?.face) { unmeasured.push({ i, from: sp.label || sp.clip, to: next.label || next.clip }); return; }
  const dAng = Math.abs(pEnd.yaw - pStart.yaw) + Math.abs(pEnd.pitch - pStart.pitch) + Math.abs(pEnd.roll - pStart.roll);
  const dPos = Math.hypot(pEnd.cx - pStart.cx, pEnd.cy - pStart.cy);
  const cost = dAng / JUMP_DEG + dPos / JUMP_POS;           // 1 = seuil ; >1 = ça saute
  jumps.push({ i, from: `${sp.clip}${sp.label ? ' ' + sp.label : ''}`, to: `${next.clip}${next.label ? ' ' + next.label : ''}`,
    sameClip: sp.clip === next.clip, dAng: +dAng.toFixed(1), dPos: +dPos.toFixed(4), cost: +cost.toFixed(2) });
});

// --- 4) rapport ---------------------------------------------------------------
const flagged = jumps.filter((j) => j.cost > 1).sort((a, b) => b.cost - a.cost);
const cutsPerMin = keptTotal ? (nCuts / (keptTotal / 60)) : 0;
console.log(`RÉGULATEUR — ${edl.spans.length} spans · ${keptTotal.toFixed(1)}s gardés · ${nCuts} raccords (${cutsPerMin.toFixed(1)}/min)\n`);

console.log(`(a) SEGMENTS TROP COURTS (< ${MIN_SEG}s) : ${short.length}`);
short.forEach((s) => console.log(`    ⚠ #${s.i} ${s.clip} ${s.label} — ${s.dur}s`));
if (!short.length) console.log('    ✓ aucun micro-fragment');

console.log(`\n(b) SAUTS DE POSE au raccord (seuil ${JUMP_DEG}° cumulés / ${JUMP_POS} de décalage) : ${flagged.length}/${jumps.length}`);
flagged.slice(0, 10).forEach((j) => console.log(
  `    ⚠ #${j.i}→${j.i + 1} ${j.from} → ${j.to}${j.sameClip ? '' : '  [prises différentes]'}  coût ${j.cost}  (Δangle ${j.dAng}° · Δcentre ${j.dPos})`));
if (!flagged.length) console.log('    ✓ aucun saut franc — les raccords passent à l\'œil');
if (unmeasured.length) console.log(`    (${unmeasured.length} raccord(s) non mesuré(s) : visage absent au point de sonde)`);

// --- (d) ALLERS-RETOURS entre prises : A-B-A impose DEUX sauts là où un
// regroupement (A-A-B) n'en laisse qu'un. C'est le motif le plus rentable, car
// il ne change AUCUN contenu — juste l'ordre — et un réordonnancement se rend en
// re-concat (~1 min, zéro ré-encodage). Coûts hypothétiques calculés depuis les
// poses DÉJÀ mesurées : aucune passe mediapipe supplémentaire.
const coutEntre = (spA, spB) => {                     // fin de A -> début de B
  const pe = poseAt(spA.clip, Math.max(spA.a, spA.b - EDGE));
  const ps = poseAt(spB.clip, spB.a + EDGE);
  if (!pe?.face || !ps?.face) return null;
  const dAng = Math.abs(pe.yaw - ps.yaw) + Math.abs(pe.pitch - ps.pitch) + Math.abs(pe.roll - ps.roll);
  const dPos = Math.hypot(pe.cx - ps.cx, pe.cy - ps.cy);
  return +(dAng / JUMP_DEG + dPos / JUMP_POS).toFixed(2);
};
const allersRetours = [];
for (let i = 0; i + 2 < edl.spans.length; i++) {
  const [A, B, C] = [edl.spans[i], edl.spans[i + 1], edl.spans[i + 2]];
  if (A.clip !== C.clip || A.clip === B.clip) continue;          // motif A-B-A seulement
  const actuel = [coutEntre(A, B), coutEntre(B, C)];
  const alt = [coutEntre(A, C), coutEntre(C, B)];                // ordre A-C-B (on groupe la prise A)
  if (actuel.includes(null) || alt.includes(null)) continue;
  const gain = +((actuel[0] + actuel[1]) - (alt[0] + alt[1])).toFixed(2);
  // ⚠ Un gain n'est PAS acquis : grouper la prise rend A→C bon marché mais peut rendre
  // C→B pire (mesuré sur v11 : 1,55 → 1,68, donc REFUSÉ). On ne propose que si ça paie.
  if (gain > MIN_GAIN) allersRetours.push({ i, A: `${A.clip} ${A.label || ''}`.trim(), B: `${B.clip} ${B.label || ''}`.trim(),
    C: `${C.clip} ${C.label || ''}`.trim(), actuel: +(actuel[0] + actuel[1]).toFixed(2), alt: +(alt[0] + alt[1]).toFixed(2), gain });
}
allersRetours.sort((a, b) => b.gain - a.gain);
console.log(`\n(d) ALLERS-RETOURS entre prises (A-B-A) qu'un regroupement allégerait : ${allersRetours.length}`);
allersRetours.slice(0, 6).forEach((r) => console.log(
  `    ↔ #${r.i}-${r.i + 2}  ${r.A} → ${r.B} → ${r.C}\n        grouper la prise (ordre A-C-B) : coût ${r.actuel} → ${r.alt}  (gain ${r.gain})`));
if (!allersRetours.length) console.log('    ✓ aucun aller-retour coûteux — les prises sont déjà groupées');
else console.log(`    ⚠ un réordonnancement change le SENS : vérifier référents + doublons (coherence.mjs) AVANT.\n`
  + `      Le rendu, lui, est quasi gratuit (re-concat des segs, aucun ré-encodage).`);

const worst = jumps.length ? Math.max(...jumps.map((j) => j.cost)) : 0;
console.log(`\n(c) DENSITÉ : ${cutsPerMin.toFixed(1)} raccords/min` +
  (cutsPerMin > 20 ? '  ⚠ élevé (risque « haché »)' : '  ✓ raisonnable'));
console.log(`\nVERDICT : ${short.length === 0 && flagged.length === 0 ? '✅ plan LISSE (cohérence préservée)'
  : `⚠ ${short.length} micro-segment(s) · ${flagged.length} saut(s) — arbitrer avant rendu (cohérence > perfection)`}`);

const outPath = edlPath.replace(/\.json$/, '') + '.joins.json';
fs.writeFileSync(outPath, JSON.stringify({ minSeg: MIN_SEG, jumpDeg: JUMP_DEG, jumpPos: JUMP_POS,
  keptTotal: +keptTotal.toFixed(1), nCuts, cutsPerMin: +cutsPerMin.toFixed(1), worstCost: +worst.toFixed(2),
  short, jumps, unmeasured, allersRetours }, null, 1));
console.log(`→ ${outPath}`);
