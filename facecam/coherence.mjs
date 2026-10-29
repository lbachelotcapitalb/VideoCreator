#!/usr/bin/env node
// ============================================================================
// facecam/coherence.mjs — CONTRÔLE DU SENS (le pendant « compréhension » de
// joins.mjs, qui lui contrôle la forme). Automatise deux règles apprises à la
// dure (cf. README §Obstacles) :
//
//  (a) FANTÔMES — whisper peut inventer une phrase PLAUSIBLE sur du silence
//      (« amorce plausible » : la pire hallucination, aucun marqueur repérable).
//      Ici on mesure l'ÉNERGIE DE PAROLE réelle de chaque îlot (silencedetect,
//      1 passe par clip) : du texte sans énergie = texte probablement inventé.
//      Garde-fou pour subjects.mjs/pick.mjs qui consomment les transcripts en aveugle.
//
//  (b) RÉFÉRENTS — un bloc techniquement parfait peut être INCOMPRÉHENSIBLE si
//      son sujet n'est jamais nommé (cas vécu : 1,5 min sur Shanghai sans dire
//      « Shanghai », le rush ouvrant sur « C'est évidemment une ville à faire »).
//      Un PRONOM EN TÊTE de span est le signal d'alerte → on le remonte, avec les
//      noms propres déjà posés avant, pour arbitrer. Se corrige par réordonnancement.
//
// Ne coupe rien, ne réécrit rien : rapport + JSON, tu arbitres (plan gelé).
//
// Usage: node facecam/coherence.mjs <carte.json> [--edl <edl.json>] [--minspeech 0.15]
//   sans --edl : contrôle (a) sur tous les îlots de la carte.
//   avec --edl : + contrôle (b) sur l'ordre RÉEL du montage.
// ============================================================================
import fs from 'node:fs';
import { listClips, resolveRushDir, detectSilences } from './lib.mjs';

const argv = process.argv.slice(2);
const cartePath = argv.find((a) => !a.startsWith('--'));
if (!cartePath) { console.error('usage: node facecam/coherence.mjs <carte.json> [--edl <edl.json>]'); process.exit(1); }
const gf = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const edlPath = gf('--edl', null);
const MIN_SPEECH = parseFloat(gf('--minspeech', '0.15'));   // part d'énergie de parole mini

const carte = JSON.parse(fs.readFileSync(cartePath, 'utf8'));
const rushDir = resolveRushDir(carte.rushDir);
const fileOf = Object.fromEntries(listClips(rushDir).map((c) => [c.id, c.file]));

// ---- (a) FANTÔMES : énergie de parole réelle par îlot -----------------------
// 1 seule passe silencedetect par clip (-vn, rapide) ; on recoupe les silences
// avec chaque îlot pour en déduire la part réellement sonore.
const phantoms = [], thin = [];
let nIslands = 0;
for (const c of carte.clips || []) {
  const file = fileOf[c.id];
  if (!file || !(c.islands || []).length) continue;
  let sil = [];
  try { sil = detectSilences(file, { noise: '-30dB', d: 0.10 }); } catch { continue; }
  for (const isl of c.islands) {
    if (!(isl.text || '').trim()) continue;
    nIslands++;
    const dur = isl.b - isl.a;
    // durée de silence recouvrant l'îlot
    let silent = 0;
    for (const s of sil) {
      const o = Math.min(isl.b, s.e) - Math.max(isl.a, s.s);
      if (o > 0) silent += o;
    }
    const speech = dur > 0 ? Math.max(0, 1 - silent / dur) : 0;
    const rec = { clip: c.id, rush: c.name, i: isl.i, a: isl.a, b: isl.b, dur: +dur.toFixed(1),
      speech: +speech.toFixed(2), text: (isl.text || '').slice(0, 90) };
    if (speech < MIN_SPEECH) phantoms.push(rec);
    else if (speech < 0.4) thin.push(rec);
  }
}

// ---- (b) RÉFÉRENTS : pronom en tête de span, antécédent nommé ? -------------
const PRONOM = /^(c'est|c’est|ce|cet|cette|ces|ça|ca|celui|celle|ceux|il|ils|elle|elles|on|y|lui|leur|leurs|là-bas|la-bas|là|eux|en fait il)\b/i;
// nom propre = mot capitalisé qui n'ouvre pas la phrase (heuristique offline)
function propres(text) {
  const out = new Set();
  const phrases = (text || '').split(/[.!?…]+/);
  for (const p of phrases) {
    const toks = p.trim().split(/\s+/).filter(Boolean);
    toks.forEach((w, i) => {
      const clean = w.replace(/[^A-Za-zÀ-ÿ'’-]/g, '');
      if (i > 0 && clean.length >= 3 && /^[A-ZÀ-Þ]/.test(clean)) out.add(clean);
    });
  }
  return out;
}
const refIssues = [];
let spansChecked = 0;
if (edlPath) {
  const edl = JSON.parse(fs.readFileSync(edlPath, 'utf8'));
  // texte de chaque span : depuis la carte (îlots recouvrant [a,b])
  const textOf = (sp) => {
    const c = (carte.clips || []).find((x) => x.id === sp.clip);
    if (!c) return '';
    return (c.islands || []).filter((i) => i.b > sp.a && i.a < sp.b).map((i) => i.text || '').join(' ').trim();
  };
  const vus = new Set();
  edl.spans.forEach((sp, idx) => {
    const t = textOf(sp);
    if (!t) return;
    spansChecked++;
    const head = t.replace(/^[^A-Za-zÀ-ÿ]+/, '');
    const ouvrePronom = PRONOM.test(head);
    const propresIci = propres(t);
    const nommeSonSujet = propresIci.size > 0;
    if (ouvrePronom && !nommeSonSujet) {
      refIssues.push({ idx, clip: sp.clip, label: sp.label || '', head: head.slice(0, 70),
        anteriors: [...vus].slice(-6) });
    }
    propresIci.forEach((p) => vus.add(p));
  });
}

// ---- rapport ---------------------------------------------------------------
console.log(`CONTRÔLE DU SENS — ${nIslands} îlots mesurés${edlPath ? ` · ${spansChecked} spans d'EDL` : ''}\n`);

console.log(`(a) FANTÔMES — texte SANS énergie de parole (< ${MIN_SPEECH}) : ${phantoms.length}`);
phantoms.forEach((p) => console.log(`    ⛔ ${p.clip}[${p.i}] ${p.a}-${p.b}s  parole ${p.speech}  « ${p.text} »`));
if (!phantoms.length) console.log('    ✓ aucun texte fantôme — tous les îlots portent de la vraie parole');
if (thin.length) {
  console.log(`    (${thin.length} îlot(s) à parole clairsemée 0.15–0.4 — à re-transcrire seuls avant d'agir dessus)`);
  thin.slice(0, 5).forEach((p) => console.log(`      · ${p.clip}[${p.i}] ${p.a}-${p.b}s parole ${p.speech} « ${p.text.slice(0, 60)} »`));
}

if (edlPath) {
  console.log(`\n(b) RÉFÉRENTS — spans ouvrant sur un PRONOM sans nommer leur sujet : ${refIssues.length}/${spansChecked}`);
  refIssues.forEach((r) => {
    console.log(`    ⚠ span #${r.idx} ${r.clip} ${r.label}\n        ouvre par « ${r.head}… »`);
    console.log(`        noms posés avant : ${r.anteriors.length ? r.anteriors.join(', ') : '(aucun)'}`);
  });
  if (!refIssues.length) console.log('    ✓ chaque bloc nomme son sujet');
  console.log(`\n    → un pronom en tête n'est pas fatal SI le référent vient d'être posé juste avant.`);
  console.log(`      Se corrige par RÉORDONNANCEMENT (re-concat des segs, ~1 min, aucun ré-encodage).`);
}

const verdict = phantoms.length === 0 && refIssues.length === 0;
console.log(`\nVERDICT : ${verdict ? '✅ sens vérifié (pas de fantôme, référents posés)'
  : `⚠ ${phantoms.length} fantôme(s) · ${refIssues.length} référent(s) à arbitrer`}`);

const outPath = cartePath.replace(/\.json$/, '') + '.coherence.json';
fs.writeFileSync(outPath, JSON.stringify({ minSpeech: MIN_SPEECH, nIslands, phantoms, thin, refIssues }, null, 1));
console.log(`→ ${outPath}`);
