#!/usr/bin/env node
// ============================================================================
// facecam/overlays/suggest.mjs — LIRE LE SCRIPT ET PROPOSER L'HABILLAGE
//
// Étape OBLIGATOIRE du premier traitement facecam (cf. SKILL.md) : dès qu'un
// vlog parlé est rendu, on analyse son script et on SORT DES PROPOSITIONS
// d'éléments visuels. On ne produit RIEN sans validation du monteur.
//
// Ce script ne « décide » pas : il repère les MOMENTS qui méritent un overlay et
// dit POURQUOI, pour que Claude rédige des propositions sourcées par-dessus.
// Les motifs viennent de ce qui a marché sur le vlog Chine (25/07) :
//
//   DOUTE      « je n'ai pas la date », « je crois », « je pense que » → LE meilleur
//              emplacement : il pose la question à voix haute, l'overlay répond.
//   RESSENTI   « on sent que », « j'estime », « on remarque » → une donnée sourcée
//              transforme l'impression en fait.
//   CHIFFRE    un nombre PRONONCÉ est déjà dans les sous-titres → ⚠️ NE PAS le
//              répéter : chercher la comparaison ou l'ordre de grandeur national.
//   GÉO        énumération de lieux → carte (muette si les noms sont dits).
//   ÉPOQUE     « années 80 », « coloniale », « concession » → timeline datée.
//   COMPARE    « plus cher que », « comme la Thaïlande » → barres comparées.
//   SUPERLATIF « énormément », « le plus » → chiffre d'ordre de grandeur.
//
// Usage : node suggest.mjs <script.json>        (sortie whisper -oj du RENDU)
//         node suggest.mjs <video.mp4> --model large-v3   (transcrit d'abord)
//         [--json out.json]
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODELS = path.join(HERE, '..', '..', 'models');
const a = process.argv.slice(2);
const opt = (n, d) => { const i = a.indexOf(n); if (i < 0) return d; const v = a[i + 1]; a.splice(i, 2); return v; };
const outJson = opt('--json', null);
const model = opt('--model', 'large-v3');
const src = a[0];
if (!src) { console.error('usage: suggest.mjs <script.json|video.mp4> [--model large-v3] [--json out.json]'); process.exit(1); }

let segs;
if (/\.json$/i.test(src)) {
  segs = JSON.parse(fs.readFileSync(src, 'utf8')).transcription || [];
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'suggest-'));
  const wav = path.join(tmp, 'a.wav');
  execFileSync('ffmpeg', ['-v', 'error', '-i', src, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-y', wav]);
  execFileSync('whisper-cli', ['-m', path.join(MODELS, `ggml-${model}.bin`), '-f', wav, '-l', 'fr', '-oj', '-of', path.join(tmp, 'a')],
    { stdio: ['ignore', 'ignore', 'ignore'] });
  segs = JSON.parse(fs.readFileSync(path.join(tmp, 'a.json'), 'utf8')).transcription || [];
  fs.rmSync(tmp, { recursive: true, force: true });
}

const NUM_WORDS = '(?:zéro|un|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|quinze|vingt|trente|quarante|cinquante|soixante|cent|cents|mille|million|millions|milliard|milliards|demi|moitié)';
const MOTIFS = [
  { tag: 'DOUTE', poids: 5, re: /\b(je n'ai pas la date|j'ai pas la date|je (?:ne )?sais pas|je crois|je pense que|il me semble|de mémoire|à peu près|je dirais)\b/i,
    quoi: "il pose la question à voix haute → l'overlay RÉPOND (date, chiffre, schéma)" },
  { tag: 'RESSENTI', poids: 4, re: /\b(on sent que|j'estime|on remarque|vous allez (?:très vite )?remarquer|on a l'impression|c'est agréable|ça fait du bien|j'ai l'impression)\b/i,
    quoi: 'impression subjective → une DONNÉE SOURCÉE la transforme en fait' },
  { tag: 'ÉPOQUE', poids: 4, re: /\b(années? (?:\d{2,4}|quatre-vingt|soixante|septante)|coloniale?|concession|historique|époque|dynastie|au (?:XIX|XX)e?|siècle)\b/i,
    quoi: 'TIMELINE datée (+ tracé sur plan si c'.concat("'est un lieu)") },
  { tag: 'COMPARE', poids: 3, re: /\b(plus (?:cher|faible|élevé|développé)|moins (?:cher|de)|similaire à|comme (?:la|le|en) [A-ZÉ]|par rapport à|qu'en Europe|que la France)\b/i,
    quoi: 'BARRES COMPARÉES (deux valeurs qui se remplissent), jamais un seul chiffre nu' },
  { tag: 'GÉO', poids: 3, re: /\b(Chine|Shanghai|Pékin|Xiamen|Hong ?Kong|Macao|Shenzhen|Chongqing|Mongolie|Vietnam|Thaïlande|Laos|Malaisie|Singapour|Japon|Corée|Taïwan|Philippines|Asie|Europe|Paris|France)\b/,
    quoi: 'CARTE — muette si les noms sont déjà dits (formes + surbrillance, zéro texte)' },
  { tag: 'CHIFFRE', poids: 2, re: new RegExp(`(\\d+(?:[.,]\\d+)?\\s*(?:%|euros?|€|km|kilomètres?|centimes?|heures?|jours?|mois|ans?|000)|\\b${NUM_WORDS}\\s+(?:mille|cents?|millions?|euros?|heures?|kilomètres?|pour ?cent)\\b)`, 'i'),
    quoi: '⚠️ chiffre PRONONCÉ = déjà dans les sous-titres → NE PAS le répéter ; chercher le chiffre national, la comparaison ou l’ordre de grandeur' },
  { tag: 'SUPERLATIF', poids: 2, re: /\b(énormément|beaucoup de|le plus|la plus|très très|extrêmement|des tonnes de|partout)\b/i,
    quoi: "ordre de grandeur chiffré (il dit « beaucoup », l'overlay dit combien)" },
];

const hits = [];
for (const s of segs) {
  const txt = (s.text || '').trim(); if (!txt) continue;
  const t = (s.offsets?.from ?? 0) / 1000;
  const tags = MOTIFS.filter((m) => m.re.test(txt));
  if (!tags.length) continue;
  hits.push({ t, txt, poids: tags.reduce((a, m) => a + m.poids, 0), tags: tags.map((m) => ({ tag: m.tag, quoi: m.quoi })) });
}
hits.sort((x, y) => y.poids - x.poids || x.t - y.t);

const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(2).padStart(5, '0')}`;
console.log(`${segs.length} segments analysés · ${hits.length} moments à overlay potentiel`);
console.log(`\nRÈGLES (rappel, elles ne sont pas négociables) :`);
console.log(`  · on PROPOSE, on ne produit pas : le monteur valide chaque élément visuel.`);
console.log(`  · zéro doublon avec les sous-titres : un mot ou un chiffre déjà prononcé ne se réaffiche pas.`);
console.log(`  · un chiffre affiché est une affirmation → source citée + validation avant burn.\n`);
for (const h of hits.slice(0, +opt('--top', 40))) {
  console.log(`[${mmss(h.t)}] (${h.poids}) ${h.tags.map((x) => x.tag).join('+')}`);
  console.log(`   « ${h.txt} »`);
  for (const x of h.tags) console.log(`   → ${x.quoi}`);
}
if (outJson) { fs.writeFileSync(outJson, JSON.stringify({ n: segs.length, hits }, null, 1)); console.log(`\n→ ${outJson}`); }
