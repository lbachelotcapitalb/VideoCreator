#!/usr/bin/env node
// ============================================================================
// facecam/relances.mjs — DÉTECTEUR DE RELANCES À L'INTÉRIEUR D'UN SPAN.
//
// Règle du monteur (02/08) : « je ne veux laisser aucun raté, tu les identifies
// facilement en voyant des répétitions dont la énième finit par dérouler la
// suite sans accroc ». Donc : quand l'ouverture d'un span se répète, la BONNE
// prise est la DERNIÈRE — les précédentes sont des départs avortés.
//
// Pourquoi un outil et pas de l'œil : `refine.mjs` resserre sur la parole, il ne
// sait pas qu'une phrase a été DITE DEUX FOIS. Une règle non mécanisée n'est pas
// tenue (doctrine STYLE) — trois relances sont passées en production le 02/08.
//
// Méthode (aucune lecture de profil d'énergie : deux relances enchaînées forment
// UN SEUL burst, un creux local n'est pas une frontière de mot) :
//   1. bursts de VOIX (silencedetect -24 dB, le seuil qui exclut la respiration) ;
//   2. transcription de chaque burst SÉPARÉMENT (small) — un burst = un bloc fiable ;
//   3. on prend l'ouverture (n premiers mots de contenu du span) et on cherche
//      TOUTES ses occurrences dans la suite des mots, en tolérant 1 mot faux
//      (whisper varie d'une fenêtre à l'autre) ;
//   4. s'il y en a plusieurs → `a` proposé = début du burst de la DERNIÈRE ;
//   5. la proposition est RE-TRANSCRITE en large-v3 et n'est retenue que si le
//      texte obtenu ne contient plus la répétition. Sinon on ne propose rien
//      (le doute par défaut = ne rien couper).
//
// N'ÉCRIT RIEN dans l'EDL : il propose, tu arbitres (--apply pour appliquer).
//
// Usage: node facecam/relances.mjs <edl.json|edl.refined.json> [--n 4] [--apply]
// ============================================================================
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { MODEL_SMALL, MODEL_BIG } from '../store.mjs';   // chemins du moteur et du store : un seul endroit
import { listClips, resolveRushDir } from './lib.mjs';

const SMALL = MODEL_SMALL;
const BIG = MODEL_BIG;

const args = process.argv.slice(2);
const edlPath = args[0];
if (!edlPath) { console.error('usage: node facecam/relances.mjs <edl.json> [--n 4] [--apply]'); process.exit(1); }
// ⚠ getf, pas args[indexOf+1] : sans le flag, indexOf vaut -1 et args[0] (= le chemin
// de l'EDL) serait lu comme valeur → NaN, et `slice(0, NaN)` rend un tableau vide EN SILENCE.
const getf = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const NGRAM = +getf('--n', 4);
const APPLY = args.includes('--apply');

const edl = JSON.parse(fs.readFileSync(edlPath, 'utf8'));
const rushDir = resolveRushDir(edl.rushDir);
const WORK = `${rushDir}/.facecam_work/relances`; fs.mkdirSync(WORK, { recursive: true });

// table clips : celle de l'EDL fait foi (les ids cN sont des index de dossier)
const clips = {};
if (edl.clips) for (const [id, name] of Object.entries(edl.clips)) clips[id] = `${rushDir}/${name}`;
else for (const c of listClips(rushDir)) clips[c.id] = c.file;

// mots vides : ils ne portent pas l'identité d'une ouverture, mais on les garde
// dans la comparaison (« en fait c'est » EST l'ouverture répétée dans les cas du monteur).
const norm = (s) => s.toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // \u… ÉCHAPPÉ : écrire la classe en
  .replace(/[^a-z0-9' ]/g, ' ').replace(/\s+/g, ' ')  // diacritiques littéraux casse la
  .trim();                                            // regex à l'écriture (vécu 02/08)
const HALLUC = /amara|sous-titres r|merci d'avoir|abonnez|bruit de porte/i;

function bursts(file, a, b) {
  const ss = Math.max(0, a - 0.35), to = b + 0.25;
  let out = '';
  try {
    out = execSync(`ffmpeg -nostats -ss ${ss} -to ${to} -i "${file}" -af "silencedetect=n=-24dB:d=0.12" -f null - 2>&1`,
      { encoding: 'utf8', maxBuffer: 1 << 28 });
  } catch (e) { out = String(e.stdout || '') + String(e.stderr || ''); }
  const sil = [];
  let cur = null;
  for (const m of out.matchAll(/silence_(start|end): (-?[\d.]+)/g)) {
    if (m[1] === 'start') cur = ss + parseFloat(m[2]);
    else if (cur !== null) { sil.push([cur, ss + parseFloat(m[2])]); cur = null; }
  }
  if (cur !== null) sil.push([cur, to]);
  // complément des silences, borné à [a,b]
  const bs = []; let p = a;
  for (const [s0, s1] of sil) {
    const c0 = Math.max(a, Math.min(b, s0));
    if (c0 > p + 0.08) bs.push([p, c0]);
    p = Math.max(p, Math.min(b, s1));
  }
  if (b > p + 0.08) bs.push([p, b]);
  return bs;
}

function tx(file, a, b, model, tag) {
  const base = `${WORK}/${tag}`;
  if (!fs.existsSync(`${base}.txt`)) {
    execSync(`ffmpeg -y -v error -ss ${a} -to ${b} -i "${file}" -ac 1 -ar 16000 "${base}.wav"`);
    execSync(`whisper-cli -m "${model}" -l fr -otxt -of "${base}" "${base}.wav" >/dev/null 2>&1`);
  }
  try { return fs.readFileSync(`${base}.txt`, 'utf8').replace(/\s+/g, ' ').trim(); } catch { return ''; }
}

// occurrences (tolérance 1 mot faux) de `open` dans la suite `words`
function occurrences(words, open) {
  const hits = [];
  for (let i = 0; i + open.length <= words.length; i++) {
    let bad = 0;
    for (let k = 0; k < open.length; k++) if (words[i + k] !== open[k]) bad++;
    if (bad <= (open.length >= 4 ? 1 : 0)) hits.push(i);
  }
  // dédoublonne les hits collés (i et i+1 qui matchent tous les deux)
  return hits.filter((h, k) => k === 0 || h - hits[k - 1] > 1);
}

let nProp = 0;
const props = [];
console.log(`RELANCES — ${edl.spans.length} span(s) de ${edlPath.split('/').pop()}\n`);

edl.spans.forEach((sp, idx) => {
  const file = clips[sp.clip];
  if (!file) return;
  const bs = bursts(file, sp.a, sp.b);
  if (bs.length < 2) { console.log(`[${idx}] ${sp.label}  ${bs.length} burst — rien à départager`); return; }
  // ⚠ TOUT en large-v3 ici, y compris les bursts. Le `small` sur un burst court produit du
  // charabia (« on va un combi », « musique quand j'ai eu ») : l'ouverture cherchée était fausse,
  // donc aucune répétition n'était trouvée là où le monteur en entendait quatre (vécu 02/08).
  const words = [], owner = [];
  bs.forEach(([a, b], bi) => {
    const t = tx(file, a, b, BIG, `L_${sp.clip}_${idx}_${bi}`);
    if (HALLUC.test(t)) return;
    for (const w of norm(t).split(' ').filter(Boolean)) { words.push(w); owner.push(bi); }
  });
  if (words.length < 3) { console.log(`[${idx}] ${sp.label}  trop court`); return; }

  // ── DÉTECTION : un faux départ est un burst dont le TEXTE se REDIT juste après ──────────
  // (formulation du monteur : « des répétitions dont la énième finit par dérouler la suite sans
  //  accroc ».) On ne cherche donc pas une ouverture de référence — elle serait elle-même
  //  polluée par le faux départ — mais on teste chaque burst de tête : sa suite de mots
  //  réapparaît-elle dans les ~14 mots qui suivent ? Si oui, c'est une amorce avortée.
  const byBurst = bs.map((_, bi) => words.filter((__, k) => owner[k] === bi));
  const seqOf = (bi) => byBurst[bi];
  const redit = (seq, from) => {                     // seq réapparaît-elle après l'index `from` ?
    const tol = Math.floor(seq.length / 4);          // 1 mot faux toléré tous les 4
    for (let i = from; i <= Math.min(words.length - seq.length, from + 14); i++) {
      let bad = 0;
      for (let k = 0; k < seq.length; k++) if (words[i + k] !== seq[k]) bad++;
      if (bad <= tol) return true;
    }
    return false;
  };
  let cut = 0, why = null, base = 0;
  for (let bi = 0; bi < bs.length - 1; bi++) {
    const seq = seqOf(bi);
    if (!seq.length) { base += seq.length; continue; }
    // un burst d'UN SEUL mot ne compte que s'il est repris tel quel en tête du burst suivant
    // ⚠ TENTÉ ET RETIRÉ (02/08) : une règle « scorie » (burst court dont tous les mots sont sur le
    // point d'être redits) pour attraper le résidu « …Hong Kong, / et donc moi quand j'entends Hong
    // Kong… ». Elle CASCADE — chaque burst suivant redevient éligible — et a proposé de couper 6,2 s
    // sur 8,7. Pire : le garde-fou large-v3 l'a VALIDÉE, parce qu'une fenêtre d'1,5 s laisse whisper
    // reconstruire une phrase plausible (§Obstacles, « l'amorce plausible inventée sur du silence »).
    // Ces résidus-là se coupent au balayage, à la main. Ne pas ré-ajouter sans une vraie parade.
    const ok = seq.length === 1
      ? (seqOf(bi + 1)[0] === seq[0])
      : redit(seq, base + seq.length);
    if (!ok) break;
    cut = bi + 1; why = seq.join(' '); base += seq.length;
  }
  if (!cut) { console.log(`[${idx}] ${sp.label}  ✓ pas de faux départ`); return; }

  const newA = +(bs[cut][0]).toFixed(3);
  if (newA <= sp.a + 0.05) { console.log(`[${idx}] ${sp.label}  ⚠ faux départ détecté mais déjà hors du span`); return; }
  // garde-fou : la proposition est re-transcrite en large-v3, et le premier burst restant ne
  // doit plus se redire. Le doute par défaut = ne rien couper.
  const after = tx(file, newA, sp.b, BIG, `chk_${sp.clip}_${idx}_${cut}`);
  const aw = norm(after).split(' ').filter(Boolean);
  const head = aw.slice(0, Math.min(NGRAM, aw.length));
  // Garde-fou en TROIS points, pas un seul. Le contrôle « la répétition a disparu » ne suffit pas :
  // sur une fenêtre courte whisper REFABRIQUE une phrase entière et valide n'importe quelle coupe.
  // On borne donc aussi ce qu'une proposition a le droit d'enlever — en temps ET en mots.
  const partCoupee = (newA - sp.a) / (sp.b - sp.a);
  const motsRestants = aw.length / Math.max(1, words.length);
  const ok = occurrences(aw, head).length < 2 && aw.length >= 3
    && partCoupee <= 0.45 && motsRestants >= 0.55;
  if (!ok && (partCoupee > 0.45 || motsRestants < 0.55)) {
    console.log(`[${idx}] ${sp.label}\n    ✗ REFUSÉ : la coupe enlèverait ${(partCoupee * 100).toFixed(0)} % du span ` +
      `et il ne resterait que ${(motsRestants * 100).toFixed(0)} % des mots — trop gourmand, à trancher au balayage`);
    return;
  }
  console.log(`[${idx}] ${sp.label}\n    ⛔ faux départ « ${why} »  →  a ${sp.a} → ${newA}  (−${(newA - sp.a).toFixed(2)}s)`);
  console.log(`    ${ok ? '✓' : '✗ REFUSÉ (ça se redit encore)'} large-v3 : ${after.slice(0, 170)}`);
  if (ok) { props.push({ idx, a: newA, was: sp.a, open: why }); nProp++; }
});

console.log(`\n→ ${nProp} proposition(s)${APPLY ? ' — APPLIQUÉES' : ' (relancer avec --apply pour les écrire)'}`);
if (APPLY && nProp) {
  for (const p of props) {
    edl.spans[p.idx].a = p.a;
    edl.spans[p.idx]._relance = `relance coupée : « ${p.open} » disait ${p.was} → ${p.a}`;
  }
  fs.writeFileSync(edlPath, JSON.stringify(edl, null, 1));
  console.log(`→ ${edlPath}`);
}
