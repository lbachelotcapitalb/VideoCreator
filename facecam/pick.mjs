#!/usr/bin/env node
// ============================================================================
// facecam/pick.mjs — SÉLECTION PONDÉRÉE de la meilleure prise par sujet refait.
// Maillon « garde la meilleure » : pour chaque sujet à ≥2 prises (carte des
// sujets de subjects.mjs), note chaque occurrence par un SCORE pondéré et
// désigne la meilleure — remplace le ★ provisoire (« l'îlot le plus long »).
// Signaux :
//   VIDÉO (score_video.py, mediapipe, offline) : face_ratio, head_stability,
//     eyes_open, gaze, (mouth) — prouvés discriminants (prise ratée → face bas).
//   TEXTE (depuis la carte) : complétude (nb mots relatif) + anti-filler (densité).
// Pondération λ SOFTCODÉE (WEIGHTS) — défaut raisonnable, à calibrer sur retours le monteur.
// N'écrit PAS l'EDL : il éclaire le choix (Claude/toi tranches en la voyant). Le
// rendu reste refine.mjs → render.mjs. NE score QUE les sujets refaits (les prises
// uniques n'ont rien à départager).
//
// Usage: node facecam/pick.mjs <carte.subjects.json>
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { listClips, resolveRushDir } from './lib.mjs';

const ENGINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PY = path.join(ENGINE, '.venv-vision', 'bin', 'python');
const SCORER = path.join(ENGINE, 'facecam', 'score_video.py');

const subjPath = process.argv[2];
if (!subjPath) { console.error('usage: node facecam/pick.mjs <carte.subjects.json>'); process.exit(1); }
const cartePath = subjPath.replace(/\.subjects\.json$/, '.json');
const rushDir = resolveRushDir(JSON.parse(fs.readFileSync(cartePath, 'utf8')).rushDir);
const fileOf = Object.fromEntries(listClips(rushDir).map((c) => [c.name, c.file]));
const subj = JSON.parse(fs.readFileSync(subjPath, 'utf8'));

// poids softcodés (somme = 1). Vidéo domine (juge de paix visuel), texte complète.
const WEIGHTS = { face: 0.28, gaze: 0.20, stability: 0.14, eyesOpen: 0.10, complete: 0.16, fluent: 0.12 };
const FILLER = new Set(['euh', 'euhh', 'heu', 'hein', 'bah', 'ben', 'voila', 'voilà', 'quoi', 'donc',
  'enfin', 'disons', 'mmh', 'hum', 'bon', 'ok', 'ouais', 'genre']);
const norm = (t) => (t || '').toLowerCase().replace(/[.,!?…"'’«»\-]/g, ' ').split(/\s+/).filter(Boolean);

function videoSignals(file, a, b) {
  try {
    // stdio: stderr ignoré → coupe le bruit GL/XNNPACK de mediapipe (n'affecte pas le résultat)
    const out = execFileSync(PY, [SCORER, file, String(a), String(b), '0.3'],
      { maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    return JSON.parse(out.trim().split('\n').pop()).signals;
  } catch (e) { return null; }
}

let scoredSubjects = 0;
for (const s of subj.subjects) {
  if (s.nOcc < 2) continue;
  scoredSubjects++;
  const maxWords = Math.max(...s.occurrences.map((o) => norm(o.text).length));
  for (const o of s.occurrences) {
    const file = fileOf[o.rush];
    const v = (file && videoSignals(file, o.a, o.b)) || { face_ratio: 0, head_stability: 0, eyes_open_ratio: 0, gaze_ratio: 0 };
    const words = norm(o.text);
    const complete = maxWords ? words.length / maxWords : 0;
    const fillerDensity = words.length ? words.filter((w) => FILLER.has(w)).length / words.length : 1;
    const fluent = 1 - Math.min(1, fillerDensity * 4);           // 25% filler → 0
    o.signals = { ...v, complete: +complete.toFixed(2), fluent: +fluent.toFixed(2) };
    o.score = +(
      WEIGHTS.face * v.face_ratio + WEIGHTS.gaze * v.gaze_ratio +
      WEIGHTS.stability * v.head_stability + WEIGHTS.eyesOpen * v.eyes_open_ratio +
      WEIGHTS.complete * complete + WEIGHTS.fluent * fluent
    ).toFixed(3);
  }
  // classe par score ; garde la trace de l'ancien ★ (le plus long) pour comparaison
  const byLong = [...s.occurrences].sort((a, b) => b.dur - a.dur)[0];
  s.occurrences.sort((a, b) => b.score - a.score);
  s.best = s.occurrences[0];
  s.bestByLength = { rush: byLong.rush, a: byLong.a, b: byLong.b };
  s.pickChanged = !(byLong.a === s.best.a && byLong.rush === s.best.rush);
}

const outPath = subjPath.replace(/\.subjects\.json$/, '') + '.scored.json';
fs.writeFileSync(outPath, JSON.stringify(subj, null, 1));

console.log(`SÉLECTION PONDÉRÉE — ${scoredSubjects} sujet(s) refait(s) noté(s)\n`);
for (const s of subj.subjects) {
  if (s.nOcc < 2) continue;
  console.log(`▸ « ${s.label} » — ${s.nOcc} prises${s.pickChanged ? '   ⚠ choix ≠ « le plus long »' : ''}`);
  s.occurrences.forEach((o, i) => {
    const g = o.signals;
    console.log(`   ${i === 0 ? '★ MEILLEURE' : '           '} score ${o.score}  ${o.rush} @${o.a}-${o.b}s`);
    console.log(`             face ${g.face_ratio} · regard ${g.gaze_ratio} · stable ${g.head_stability} · complet ${g.complete} · fluide ${g.fluent}  «${o.text.slice(0, 60)}»`);
  });
  console.log('');
}
console.log(`→ ${outPath}  (poids softcodés dans pick.mjs ; ajustables sur ton retour)`);
