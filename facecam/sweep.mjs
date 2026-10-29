#!/usr/bin/env node
// ============================================================================
// facecam/sweep.mjs — BALAYAGE D'UNE BORNE DE SPAN : un INSTRUMENT, pas un verdict.
//
// Pourquoi il existe : le balayage a servi SIX fois le 02/08 (HK 102,80 · GZ 36,40 ·
// GZ 114,90 · HK 274,20 au 1ᵉʳ lot, puis HK 55,35 · HK 241,30 en 2ᵉ passe) — et il
// n'existait nulle part. À chaque fois, refait à la main en shell dans un dossier de
// `.wav`/`.txt` jetables. Doctrine du SKILL : « une chaîne qu'on ne peut pas rejouer
// n'est pas une chaîne. »
//
// Ce qu'il fait : N bornes candidates → RE-TRANSCRIPTION `large-v3` de chacune → un
// tableau `borne · ce qu'on entendrait · verdict`. Il DISQUALIFIE ce qui est
// mesurablement mauvais ; il n'élit rien tout seul.
//
// Quand l'employer (les deux cas vécus) :
//   • `relances.mjs` a laissé une SCORIE (« …Hong Kong, / et donc moi quand j'entends
//     Hong Kong… ») : trop courte pour son détecteur, très audible.
//   • `refine.mjs` a bougé une borne et la re-transcription montre un mot mangé en
//     queue (« la partie tech », « hyper touristiques ») → balayer `b`.
//
// ⭐ POURQUOI IL N'ÉLIT PAS — ET COMMENT ON L'A APPRIS (02/08, à l'écriture).
// La 1ʳᵉ version élisait « la plus grande borne qui garde la phrase entière », en
// comparant chaque candidate à une transcription de RÉFÉRENCE du span entier. Validée
// sur un cas connu (HK, réponse humaine `a` 239,26 → 241,30), elle a proposé
// **243,180 : 3,9 s de contenu réel coupé**. Deux causes, toutes deux instructives :
//   ① « la plus grande borne » est une règle de MAXIMISATION. Toute coupe plus longue
//      reste un suffixe valide de la référence : rien ne l'arrête avant la borne dure.
//      Le geste demandé n'est pas de couper le plus possible, c'est d'enlever CE QUI SE
//      REDIT. La bonne règle est minimale, pas maximale.
//   ② whisper N'EST PAS MONOTONE : la fenêtre commençant 2 s PLUS TARD a rendu 26 mots
//      contre 25 à la « référence », qui avait avalé son propre début. Comparer deux
//      transcriptions de fenêtres différentes est un sol qui bouge — la référence
//      rejetait la bonne réponse et validait la mauvaise.
// Conclusion, cohérente avec la leçon du jour (« quand un garde-fou repose sur un modèle
// génératif, lui adjoindre une mesure qui ne peut pas halluciner ») : ici la mesure non
// falsifiable est le SILENCE, pas le texte. Le texte s'AFFICHE pour que l'humain tranche.
//
// Les deux tests qui DISQUALIFIENT (aucun ne lit le CONTENU du texte) :
//   ① BORNE DURE — la coupe ne peut pas dépasser `--marge` (45 % du span). Sur le cas
//      fautif, c'est le seul garde-fou qui avait tenu — et il laissait passer 45 %.
//   ② SILENCE — la borne doit tomber dans un silence détecté (silencedetect −24 dB, le
//      seuil qui exclut la respiration) à ±0,06 s. Une borne posée DANS la parole coupe
//      un mot : ça se lit au signal, sans jamais demander son avis à un modèle.
//
// Élire demande une intention EXPLICITE :
//   --motif "<mots>"   le motif à faire disparaître de la TÊTE (typiquement la queue du
//                      span précédent : c'est l'écho ENTRE spans, angle mort déclaré de
//                      relances.mjs) → élit la PLUS PETITE coupe éligible qui l'enlève.
//   --prendre <t>      tu as lu le tableau et tu choisis. ① et ② s'appliquent quand même.
// Sans l'un des deux : aucune élection, aucune écriture. Le doute par défaut = ne rien couper.
//
// Usage:
//   node facecam/sweep.mjs <edl.json|edl.refined.json> --span <idx|label>
//        [--borne a|b] [--sens dedans|dehors] [--n 12] [--marge 0.45] [--motif "…"]
//        [--prendre 241.30] [--apply]
//   --sens dehors : la borne RECULE (a plus tôt, b plus tard) — pour RENDRE un mot coupé.
//                   Les deux tests (borne dure, silence) s'appliquent à l'identique.
// ============================================================================
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { MODEL_BIG } from '../store.mjs';   // chemins du moteur et du store : un seul endroit
import { listClips, resolveRushDir, fmt } from './lib.mjs';

const BIG = MODEL_BIG;

const args = process.argv.slice(2);
const edlPath = args[0];
if (!edlPath || edlPath.startsWith('--')) {
  console.error('usage: node facecam/sweep.mjs <edl.json> --span <idx|label> [--borne a|b] [--sens dedans|dehors] [--n 12] [--marge 0.45] [--motif "…"] [--prendre <t>] [--apply]');
  process.exit(1);
}
// ⚠ getf, pas args[indexOf+1] : sans le flag, indexOf vaut -1 et args[0] (= le chemin de
// l'EDL) serait lu comme valeur → NaN, et les bornes seraient calculées EN SILENCE sur du
// NaN. Le piège a été payé deux fois le 02/08 (relances.mjs, lumieres.mjs).
const getf = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const SPANSEL = getf('--span', null);
const BORNE = getf('--borne', 'a');
// --sens dehors : la borne RECULE (a plus tôt / b plus tard). Cas vécu le 18/09 sur
// « unesco-tenues-traditionnelles » : une borne posée pour supprimer de l'air mordait
// ensuite dans « patrimoine ». Sans ce sens, la seule sortie était de reposer la borne
// À LA MAIN — c'est-à-dire de sortir de l'instrument au moment où on en a le plus besoin.
const SENS = getf('--sens', 'dedans');
const N = +getf('--n', 12);
const MARGE = +getf('--marge', 0.45);
const MOTIF = getf('--motif', null);
const PRENDRE = getf('--prendre', null);
const APPLY = args.includes('--apply');
if (SPANSEL === null) { console.error('⚠ --span <idx|label> est obligatoire (le balayage porte sur UNE borne)'); process.exit(1); }
if (BORNE !== 'a' && BORNE !== 'b') { console.error('⚠ --borne vaut a (début) ou b (fin)'); process.exit(1); }
if (SENS !== 'dedans' && SENS !== 'dehors') { console.error('⚠ --sens vaut dedans (on rogne) ou dehors (on rend du contenu)'); process.exit(1); }
const DEHORS = SENS === 'dehors';
if (MOTIF && PRENDRE) { console.error("⚠ --motif et --prendre sont deux façons de trancher : n'en donner qu'une"); process.exit(1); }

const edl = JSON.parse(fs.readFileSync(edlPath, 'utf8'));
const rushDir = resolveRushDir(edl.rushDir);
const WORK = `${rushDir}/.facecam_work/sweep`; fs.mkdirSync(WORK, { recursive: true });

// table clips : celle de l'EDL fait foi (les ids cN sont des index de DOSSIER, pas des
// identifiants — doctrine « un identifiant dérivé d'un ordre n'est pas un identifiant »).
const clips = {};
if (edl.clips) for (const [id, name] of Object.entries(edl.clips)) clips[id] = `${rushDir}/${name}`;
else for (const c of listClips(rushDir)) clips[c.id] = c.file;

// ── sélection du span : index numérique, ou fragment de label ───────────────────────────
let idx = -1;
if (/^\d+$/.test(SPANSEL)) idx = +SPANSEL;
else {
  const hits = edl.spans.map((s, i) => [i, s]).filter(([, s]) => (s.label || '').toLowerCase().includes(SPANSEL.toLowerCase()));
  if (hits.length === 1) idx = hits[0][0];
  else if (hits.length > 1) { console.error(`⚠ « ${SPANSEL} » désigne ${hits.length} spans : ${hits.map(([i, s]) => `[${i}] ${s.label}`).join(' · ')}`); process.exit(1); }
}
const sp = edl.spans[idx];
if (!sp) { console.error(`⚠ span « ${SPANSEL} » introuvable`); process.exit(1); }
const file = clips[sp.clip];
if (!file || !fs.existsSync(file)) { console.error(`⚠ rush introuvable pour ${sp.clip}`); process.exit(1); }

const norm = (s) => s.toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // \u… ÉCHAPPÉ : écrire la classe en
  .replace(/[^a-z0-9' ]/g, ' ').replace(/\s+/g, ' ')  // diacritiques littéraux casse la
  .trim();                                            // regex à l'écriture (vécu 02/08)
const HALLUC = /amara|sous-titres r|merci d'avoir|abonnez|bruit de porte/i;

// cache par (clip, bornes) : un balayage se rejoue et les fenêtres se recoupent d'un tour
// à l'autre. Le coût du large-v3 décide si on balaye une fois ou trois.
function tx(a, b) {
  // ⚠ le `.replace` ne porte QUE sur le nom de fichier : l'appliquer au chemin complet
  // transforme « /.facecam_work/ » en « /pfacecam_work/ » et ffmpeg n'a plus de dossier
  // où écrire (« Error opening output ») — payé à l'écriture, 02/08.
  const tag = `${sp.clip}_${a.toFixed(3)}_${b.toFixed(3)}`.replace(/\./g, 'p');
  const base = `${WORK}/${tag}`;
  if (!fs.existsSync(`${base}.txt`)) {
    execSync(`ffmpeg -y -v error -ss ${a} -to ${b} -i "${file}" -ac 1 -ar 16000 "${base}.wav"`);
    execSync(`whisper-cli -m "${BIG}" -l fr -otxt -of "${base}" "${base}.wav" >/dev/null 2>&1`);
  }
  try { return fs.readFileSync(`${base}.txt`, 'utf8').replace(/\s+/g, ' ').trim(); } catch { return ''; }
}
const mots = (t) => (HALLUC.test(t) ? '' : norm(t)).split(' ').filter(Boolean);

// ── LA MESURE QUI NE PEUT PAS HALLUCINER : où est le silence ────────────────────────────
function silences(a, b) {
  const ss = Math.max(0, a - 0.5), to = b + 0.5;
  let out = '';
  try {
    out = execSync(`ffmpeg -nostats -ss ${ss} -to ${to} -i "${file}" -vn -af "silencedetect=n=-24dB:d=0.08" -f null - 2>&1`,
      { encoding: 'utf8', maxBuffer: 1 << 28 });
  } catch (e) { out = String(e.stdout || '') + String(e.stderr || ''); }
  const sil = []; let cur = null;
  for (const m of out.matchAll(/silence_(start|end): (-?[\d.]+)/g)) {
    if (m[1] === 'start') cur = ss + parseFloat(m[2]);
    else if (cur !== null) { sil.push([cur, ss + parseFloat(m[2])]); cur = null; }
  }
  if (cur !== null) sil.push([cur, to]);
  return sil;
}
const dur = sp.b - sp.a;
const lim = MARGE * dur;
// la fenêtre de mesure doit COUVRIR le périmètre balayé, sinon les frontières de silence
// du côté « dehors » n'existent pas comme candidates et le balayage ne voit rien.
const SIL = silences(DEHORS && BORNE === 'a' ? Math.max(0, sp.a - lim) : sp.a,
                     DEHORS && BORNE === 'b' ? sp.b + lim : sp.b);
const dansLeSilence = (t) => SIL.some(([s0, s1]) => t >= s0 - 0.06 && t <= s1 + 0.06);

// ── candidates : le balayage régulier + toutes les frontières de silence ────────────────
const cands = [];
const pas = (k) => (lim * k) / N;
for (let k = 1; k <= N; k++) cands.push(
  BORNE === 'a' ? (DEHORS ? sp.a - pas(k) : sp.a + pas(k))
                : (DEHORS ? sp.b + pas(k) : sp.b - pas(k)));
for (const [s0, s1] of SIL) for (const t of [s0, s1, (s0 + s1) / 2]) cands.push(t);
if (PRENDRE) cands.push(+PRENDRE);
const ord = [...new Set(cands.map(t => +t.toFixed(3)))]
  .filter(t => BORNE === 'a'
    ? (DEHORS ? (t < sp.a - 0.05 && t >= sp.a - lim && t >= 0) : (t > sp.a + 0.05 && t <= sp.a + lim))
    : (DEHORS ? (t > sp.b + 0.05 && t <= sp.b + lim) : (t < sp.b - 0.05 && t >= sp.b - lim)))
  // de la plus PRUDENTE (près de la borne actuelle) à la plus gourmande, dans les deux sens
  .sort((x, y) => (BORNE === 'a') === DEHORS ? y - x : x - y);

console.log(`BALAYAGE — [${idx}] ${sp.label || '(sans label)'}  ${sp.clip}  ${fmt(sp.a)} → ${fmt(sp.b)}  (${dur.toFixed(2)}s)`);
console.log(`borne « ${BORNE} » · sens ${SENS} · ${ord.length} candidates · borne dure : ≤ ${(MARGE * 100).toFixed(0)} % du span · ${SIL.length} silence(s) mesuré(s)`);
console.log(`tel quel : ${mots(tx(sp.a, sp.b)).slice(0, 20).join(' ')}…\n`);

const motifMots = MOTIF ? mots(MOTIF) : null;
const teteContient = (W, m) => {                       // le motif est-il dans les ~8 premiers mots ?
  const head = W.slice(0, Math.min(8, W.length));
  for (let i = 0; i + m.length <= head.length; i++) {
    let bad = 0;
    for (let k = 0; k < m.length; k++) if (head[i + k] !== m[k]) bad++;
    if (bad <= Math.floor(m.length / 4)) return true;
  }
  return false;
};

const lignes = [];
for (const t of ord) {
  const W = mots(BORNE === 'a' ? tx(t, sp.b) : tx(sp.a, t));
  const coupe = Math.abs(t - sp[BORNE]) / dur;
  const sil = dansLeSilence(t);
  const eligible = sil && W.length >= 3;
  const motifParti = motifMots ? !teteContient(W, motifMots) : null;
  lignes.push({ t, W, coupe, sil, eligible, motifParti });
  const verdict = !sil ? '⛔ borne DANS la parole (mot tronqué probable)'
    : W.length < 3 ? '⛔ il ne resterait presque rien'
      : motifMots ? (motifParti ? '✅ éligible · motif parti' : '·  éligible · motif encore là')
        : '·  éligible';
  console.log(`  ${BORNE} = ${t.toFixed(3)}  (${DEHORS ? '+' : '−'}${(coupe * 100).toFixed(0)} % · ${W.length} mots)  ${verdict}`);
  console.log(`      ${W.slice(0, 16).join(' ')}${W.length > 16 ? '…' : ''}`);
}

// ── ÉLECTION : jamais implicite ─────────────────────────────────────────────────────────
let choisie = null;
if (PRENDRE) {
  const l = lignes.find(x => Math.abs(x.t - (+PRENDRE)) < 0.002);
  if (!l) { console.log(`\n⚠ ${PRENDRE} est hors du périmètre balayé (borne dure ${(MARGE * 100).toFixed(0)} %) — élargir --marge, et le dire dans la restitution`); process.exit(1); }
  if (!l.eligible) { console.log(`\n⛔ ${PRENDRE} tombe DANS la parole : refusé (c'est la mesure, pas un avis)`); process.exit(1); }
  choisie = l;
  console.log(`\n→ CHOISIE (--prendre) : ${BORNE} ${sp[BORNE]} → ${l.t.toFixed(3)}`);
} else if (motifMots) {
  choisie = lignes.find(x => x.eligible && x.motifParti) || null;   // la PLUS PETITE coupe qui l'enlève
  if (!choisie) console.log(`\n→ aucune candidate éligible ne fait disparaître « ${MOTIF} » de la tête. On ne touche pas à la borne.`);
  else console.log(`\n→ ÉLUE (plus petite coupe qui enlève « ${MOTIF} ») : ${BORNE} ${sp[BORNE]} → ${choisie.t.toFixed(3)}  ` +
    `(−${Math.abs(choisie.t - sp[BORNE]).toFixed(2)} s, ${(choisie.coupe * 100).toFixed(0)} % du span)`);
} else {
  console.log(`\n→ AUCUNE ÉLECTION. Le balayage instruit, il ne tranche pas : whisper n'est pas monotone,`);
  console.log(`   et « couper le plus possible » n'est pas le geste demandé (cf. l'en-tête de ce fichier).`);
  console.log(`   Relancer avec --motif "<les mots à faire disparaître>" ou --prendre <borne> --apply.`);
  process.exit(0);
}
if (!choisie) process.exit(0);
console.log(`   ${choisie.W.join(' ')}`);

if (!APPLY) { console.log(`\n(relancer avec --apply pour l'écrire dans l'EDL)`); process.exit(0); }
const was = sp[BORNE];
sp[BORNE] = +choisie.t.toFixed(3);
sp._sweep = `balayage ${BORNE} : ${was} → ${sp[BORNE]} (${ord.length} candidates, borne dans le silence` +
  (MOTIF ? `, motif « ${MOTIF} » enlevé)` : ', choix explicite)');
fs.writeFileSync(edlPath, JSON.stringify(edl, null, 1));
console.log(`\n→ écrit dans ${edlPath}`);
