#!/usr/bin/env node
// ============================================================================
// facecam/overlays/mot-litigieux.mjs — TRANCHER UNE GRAPHIE SUR LE SIGNAL,
//                                       OU REFUSER DE TRANCHER
//
// POURQUOI CE FICHIER EXISTE (20/09). le monteur : « écoute les 4 secondes avant de trancher,
// c'est ma parole, pas le sens qui décide. » Je ne peux pas écouter. J'ai donc improvisé
// un instrument — faire transcrire la plage par TROIS modèles whisper sur 29 fenêtres de
// découpe et compter les voix — et j'ai livré son verdict comme s'il venait du signal :
// « small et turbo rendent -agneux 28 fois sur 29, large-v3 est l'isolé, donc relief
// montagneux ». La correction est partie dans le master.
//
// ⭐⭐ LA FAUTE N'EST PAS LE VERDICT, C'EST QUE J'AI DISQUALIFIÉ L'INSTRUMENT QUI AVAIT
// DES TÉMOINS ET GARDÉ CELUI QUI N'EN AVAIT AUCUN. La même heure, j'avais écarté mon
// analyse acoustique parce que ses formants échouaient sur leurs propres témoins — c'était
// juste. Puis j'ai fait reposer la décision sur un vote inter-modèles à qui je n'ai JAMAIS
// donné de témoin. Un instrument sans contrôle n'est pas « moins sûr », il est MUET : on
// ne sait même pas dans quel sens il se trompe.
//
// Le témoin, une fois posé, a démoli le vote en deux commandes :
//   ① sur « les massifs montagneux de l'ouest de la CHINE » (vérité connue, même locuteur),
//      large-v3 rend « de l'ouest de la FRANCE ». Le modèle SUBSTITUE un mot fréquent à ce
//      qui est dit. C'est exactement le mode de défaillance que le vote devait exclure.
//   ② amorcé (`--prompt`) avec l'une ou l'autre graphie, les 3 modèles RENDENT L'AMORCE sur
//      la plage litigieuse — dans les deux sens. Sur le témoin F07, au contraire, les 3
//      RÉSISTENT à la mauvaise amorce. L'instrument sait donc mordre ; sur cette plage-ci
//      l'acoustique ne contraint rien.
//
// D'où la règle que ce fichier MÉCANISE, parce qu'écrite en prose elle n'a rien empêché :
//   **« montagneux » après « relief » est le mot PLAUSIBLE. Un modèle de langue qui le
//   produit fait son métier de modèle de langue — ce n'est pas une écoute.** Compter les
//   voix de plusieurs modèles ne corrige pas ce biais, ça le MOYENNE : ils partagent le
//   même prior français. *Un vote entre instruments corrélés n'est pas une mesure
//   indépendante, c'est le même instrument plus fort.*
//
// CE QUE FAIT CE SCRIPT — le test à deux sens, et rien d'autre :
//   Pour chaque candidat, on AMORCE le décodeur avec une phrase qui le contient, puis on
//   regarde ce qui ressort. Trois issues, et deux d'entre elles sont des refus :
//     · le modèle RÉSISTE à l'amorce fausse et revient au même candidat  → ce candidat
//     · le modèle REND l'amorce quelle qu'elle soit                       → INDÉCIDABLE
//     · les modèles se contredisent entre eux                             → INDÉCIDABLE
//
// ⛔ ET IL REFUSE DE RENDRE UN VERDICT SANS TÉMOIN QUI MORD. `--temoin` est OBLIGATOIRE :
//    une plage du MÊME locuteur dont on connaît la réponse, amorcée avec le leurre. Si
//    l'instrument ne résiste pas là où il devrait, il n'a pas le droit de parler ici. C'est
//    la leçon du 01/09 (« un instrument dont on n'a pas vérifié qu'il voit quelque chose ne
//    prouve pas une absence ») appliquée à un instrument qui, lui, parle beaucoup.
//
// ⚠️ INDÉCIDABLE EST UNE RÉPONSE, ET C'EST SOUVENT LA BONNE. Elle renvoie la décision à
//    le monteur avec l'extrait à écouter. Sortie 2 dans ce cas — pour qu'un appelant ne puisse pas
//    confondre « je n'ai pas tranché » avec « j'ai tranché pour le premier candidat ».
//
// Usage :
//   node facecam/overlays/mot-litigieux.mjs <bloc.wav> \
//        --candidats "relief montagneux|relais fontaineux" \
//        --temoin <temoin.wav> --temoin-vrai "massifs montagneux" \
//                              --temoin-leurre "massifs fontaineux" \
//        [--t0 <s> --t1 <s>] [--contexte "phrase qui entoure le mot"] \
//        [--modeles small,large-v3-turbo,large-v3] [--extrait <sortie.wav>]
//
// Sorties : 0 = tranché · 2 = INDÉCIDABLE · 1 = le témoin ne mord pas, instrument récusé.
// ============================================================================

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));   // jamais new URL().pathname : %20
const MODELS = path.join(HERE, '..', '..', 'models');
const CACHE_MODELS = path.join(os.homedir(), '.cache', 'whisper');

const a = process.argv.slice(2);
const opt = (k, d = null) => { const i = a.indexOf(k); return i >= 0 && a[i + 1] ? a[i + 1] : d; };
const wav = a[0] && !a[0].startsWith('--') ? a[0] : null;

const candidats = (opt('--candidats', '') || '').split('|').map((s) => s.trim()).filter(Boolean);
const temoinWav = opt('--temoin', null);
const temoinVrai = opt('--temoin-vrai', null);
const temoinLeurre = opt('--temoin-leurre', null);
const contexte = opt('--contexte', '');
const t0 = opt('--t0', null), t1 = opt('--t1', null);
const extrait = opt('--extrait', null);
const modeles = (opt('--modeles', 'small,large-v3-turbo,large-v3')).split(',').map((s) => s.trim());

if (!wav || candidats.length < 2 || !temoinWav || !temoinVrai || !temoinLeurre) {
  console.error('usage: mot-litigieux.mjs <bloc.wav> --candidats "a|b" --temoin <t.wav> --temoin-vrai "…" --temoin-leurre "…"');
  console.error('  --temoin est OBLIGATOIRE : un instrument sans contrôle n\'a pas le droit de rendre un verdict.');
  process.exit(1);
}

const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();

function modelPath(name) {
  for (const p of [path.join(MODELS, `ggml-${name}.bin`),
                   path.join(CACHE_MODELS, `ggml-${name}.bin`),
                   path.join(CACHE_MODELS, `ggml-${name}-q5_0.bin`),
                   path.join(MODELS, `ggml-${name}-q5_0.bin`)]) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'litige-'));
function trancheWav(src, from, to) {
  if (from == null && to == null) return src;
  const out = path.join(tmp, `s-${Math.random().toString(36).slice(2)}.wav`);
  const args = ['-v', 'error', '-y'];
  if (from != null) args.push('-ss', String(from));
  args.push('-i', src);
  if (to != null) args.push('-to', String(Number(to) - Number(from ?? 0)));
  args.push('-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', out);
  execFileSync('ffmpeg', args);
  return out;
}

// L'amorce place le candidat dans une phrase PLAUSIBLE : amorcer avec un mot nu ne biaise
// presque rien, et le test perdrait son pouvoir. On veut le biais MAXIMAL, pour que
// « résiste quand même » signifie quelque chose.
const amorce = (c) => contexte ? contexte.replace(/\{\}/g, c) : `Voici ce qui est dit : ${c}. La suite enchaîne normalement.`;

function transcrire(mdl, f, prompt) {
  try {
    return execFileSync('whisper-cli',
      ['-m', mdl, '-f', f, '-l', 'fr', '-nt', '-np', '--prompt', prompt],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).replace(/\s+/g, ' ').trim();
  } catch { return ''; }
}

// Quel candidat le texte rendu contient-il ? (null si aucun, 'ambigu' si plusieurs)
function lequel(texte, liste) {
  const n = norm(texte);
  const vus = liste.filter((c) => n.includes(norm(c)));
  return vus.length === 1 ? vus[0] : (vus.length ? 'ambigu' : null);
}

// ── ① LE TÉMOIN — l'instrument doit RÉSISTER au leurre, sinon il est récusé ────────────
console.log('\n══════ MOT LITIGIEUX — test à deux sens ══════\n');
console.log(`  candidats : ${candidats.map((c) => `« ${c} »`).join('  vs  ')}\n`);
console.log('  ① TÉMOIN — vérité connue, amorcé avec le LEURRE. L\'instrument doit y résister.');

const dispo = [];
for (const nom of modeles) {
  const mdl = modelPath(nom);
  if (!mdl) { console.log(`     ${nom.padEnd(16)} modèle introuvable — écarté`); continue; }
  dispo.push({ nom, mdl });
}
if (!dispo.length) { console.error('\n  ⛔ aucun modèle disponible.'); process.exit(1); }

const tw = trancheWav(temoinWav, opt('--temoin-t0', null), opt('--temoin-t1', null));
let resistent = 0;
for (const { nom, mdl } of dispo) {
  const r = transcrire(mdl, tw, amorce(temoinLeurre));
  const v = lequel(r, [temoinVrai, temoinLeurre]);
  const ok = v === temoinVrai;
  if (ok) resistent++;
  console.log(`     ${nom.padEnd(16)} amorcé « ${temoinLeurre} »  →  ${(v ?? '(ni l\'un ni l\'autre)').padEnd(24)} ${ok ? '✅ résiste' : '❌ suit l\'amorce'}`);
}
console.log(`     → ${resistent}/${dispo.length} résistent au leurre`);
if (resistent < 2) {
  console.log('\n══════ ⛔ INSTRUMENT RÉCUSÉ ══════');
  console.log('  Le témoin ne mord pas : l\'instrument suit son amorce là où la vérité est connue.');
  console.log('  Il n\'a donc rien à dire sur la plage litigieuse. Aucun verdict rendu.');
  process.exit(1);
}

// ── ② LE LITIGE — chaque candidat est amorcé à son tour ────────────────────────────────
const w = trancheWav(wav, t0, t1);
if (extrait) { fs.copyFileSync(w, extrait); }
console.log('\n  ② LITIGE — chaque candidat amorcé à son tour. Rendre l\'amorce = ne rien mesurer.');
const table = [];
for (const { nom, mdl } of dispo) {
  const ligne = { nom, rendus: [] };
  for (const c of candidats) ligne.rendus.push(lequel(transcrire(mdl, w, amorce(c)), candidats));
  table.push(ligne);
  const cols = ligne.rendus.map((r, i) => `amorce «${candidats[i]}» → ${(r ?? '(aucun)')}`).join('  |  ');
  console.log(`     ${nom.padEnd(16)} ${cols}`);
}

// Un modèle TRANCHE s'il rend le même candidat quelle que soit l'amorce.
const verdicts = table.map((l) => {
  const u = [...new Set(l.rendus)];
  return (u.length === 1 && u[0] && u[0] !== 'ambigu') ? u[0] : null;
});
const fermes = verdicts.filter(Boolean);
const distincts = [...new Set(fermes)];

console.log('');
if (!fermes.length) {
  console.log('══════ ⚖️  INDÉCIDABLE ══════');
  console.log('  Tous les modèles RENDENT L\'AMORCE, dans les deux sens : sur cette plage,');
  console.log('  l\'acoustique ne contraint pas le résultat. Ce n\'est pas un verdict faible,');
  console.log('  c\'est une ABSENCE de verdict — et compter des fenêtres ici ne mesurerait que');
  console.log('  le prior qui domine chaque découpe.');
  console.log(`\n  → la décision appartient au monteur.${extrait ? `  Extrait à écouter : ${extrait}` : ''}`);
  process.exit(2);
}
if (distincts.length > 1) {
  console.log('══════ ⚖️  INDÉCIDABLE ══════');
  console.log(`  Les modèles tranchent mais ne s'accordent pas : ${distincts.map((d) => `« ${d} »`).join(' vs ')}.`);
  console.log(`\n  → la décision appartient au monteur.${extrait ? `  Extrait : ${extrait}` : ''}`);
  process.exit(2);
}
console.log('══════ ✅ TRANCHÉ ══════');
console.log(`  « ${distincts[0]} »  —  ${fermes.length}/${dispo.length} modèle(s) y reviennent MALGRÉ l'amorce contraire,`);
console.log(`  et le témoin mord (${resistent}/${dispo.length}). C'est le signal qui contraint, pas le prior.`);
process.exit(0);
