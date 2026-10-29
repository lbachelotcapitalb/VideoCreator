// toc.mjs — régénère la TABLE DES MATIÈRES de STYLE.md (avec les VRAIS numéros de ligne) dans INDEX.md.
//   node toc.mjs           → réécrit le bloc entre <!-- TOC:STYLE --> et <!-- /TOC:STYLE -->
//   node toc.mjs --check   → sortie 1 si la TOC d'INDEX.md a dérivé (à lancer après toute édition de STYLE)
//
// POURQUOI : STYLE.md fait ~13k tokens. On ne le lit JAMAIS en entier — on ouvre la section utile avec
// `Read STYLE.md offset=<ligne> limit=<n>`. Cette TOC est donc l'outil de sniping du skill : si ses
// numéros de ligne dérivent (constaté le 25/07 : « Curation » annoncée l. 56, réellement l. 102), le
// sniping envoie dans le décor et la session relit tout. D'où : générée, jamais tenue à la main.
//
// Les intitulés « pour… » sont la seule partie ÉCRITE À LA MAIN (ci-dessous) : ils portent le jugement
// « à quoi ça sert », que le titre de section ne dit pas toujours. Une section sans hint sort quand même.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ⚠ fileURLToPath obligatoire : `new URL(...).pathname` rend « Application%20Support » (ENOENT).
const DIR = path.dirname(fileURLToPath(import.meta.url));
// Dépôt de travail : docs à la racine. Dépôt publié : rangées dans docs/.
const DOCS = fs.existsSync(path.join(DIR, 'STYLE.md')) ? DIR : path.join(DIR, 'docs');
const STYLE = path.join(DOCS, 'STYLE.md');
const INDEX = path.join(DOCS, 'INDEX.md');
const CHECK = process.argv.includes('--check');
const BEG = '<!-- TOC:STYLE -->';
const END = '<!-- /TOC:STYLE -->';

// clé = sous-chaîne du titre (insensible à la casse) → à quoi la section sert
const HINTS = [
  ['Doctrine du monteur', 'règles non négociables (tenir la substance, durée=mouvement, curation)'],
  ['Leçons de session', '⭐ méta-piège : une heuristique calibrée NUIT s\'inverse le JOUR'],
  ['Curation', 'ce qui se COUPE à l\'œil (tilts, va-et-vient, dutch, sujets coupés)'],
  ['Hautes lumières', 'dompter façade/bateau lavé (courbe S, flag `hi`)'],
  ['Filtre ADAPTATIF', 'principe du warmth adaptatif (région-driven)'],
  ['Saturation ADAPTATIVE', 'boost des plans ternes, gaté par la chaleur'],
  ['Anti-bloom', 'resserrer les halos néon (flag `glow`)'],
  ['Directions Artistiques', 'table des looks sélectionnables'],
  ['LUT filmiques', 'générer / sélectionner / doser une LUT, court-circuit adaptatif'],
  ['Lit musical', 'musique sous l\'ambiance côté moteur (cf. MUSIQUE.md pour musique.mjs)'],
  ['Cut d\'intro', '`couper.txt` — l\'alternative sèche au ramp'],
  ['Speed-ramp', '`ramp.txt` — intro « retour sur terre »'],
  ['Détection fixe', '`motionScore`, seuil et cap'],
  ['Cibles chiffrées', '(vide — à remplir depuis les références)'],
  ['Socle générique', 'fondamentaux à confirmer/remplacer par les références'],
  ['Journal d\'apprentissage', 'ce qu\'on a appris des vidéos de référence'],
  ['la vidéo de référence', 'la référence disséquée (ce que le monteur aime : rythme, respiration, grade)'],
  ['Deux niveaux de rendu', '`qualite.txt` = brouillon | final'],
  ['Recadrage sujet-aware', 'crop 16:9 auto sur formats mélangés'],
  ['Playbook opérateur', '⭐ procédure autonome complète (8 étapes détaillées)'],
  ['Bibliothèque de filtres', 'doctrine de filters.mjs'],
  ['Roadmap', 'crans faits / à venir + verdicts (expo, denoise, deband, LUT)'],
];

// ⚠ un `|` non échappé (ex. « qualite.txt = brouillon | final ») AJOUTE une colonne et casse la table.
const esc = (s) => s.replace(/\|/g, '\\|');
const short = (t) => {
  const full = t.replace(/^⭐\s*/, '').trim();
  let s = full.split(' — ')[0].trim();                  // couper au tiret cadratin…
  if (s.length < 11) s = full;                          // …sauf si ça ne laisse qu'un moignon (ex. une date)
  // la coupe peut laisser une parenthèse ouverte (« Cibles chiffrées (à remplir… ») → tout jeter à partir d'elle
  if ((s.match(/\(/g) || []).length > (s.match(/\)/g) || []).length) s = s.slice(0, s.lastIndexOf('(')).trim();
  s = s.replace(/\s*\([^()]*\)\s*$/, '').trim();        // « (le monteur 17/07) » en fin de titre
  if (s.length > 64) s = s.slice(0, 61).replace(/\s+\S*$/, '') + '…';  // couper sur un mot, pas au milieu
  return esc(s);
};

const lines = fs.readFileSync(STYLE, 'utf8').split('\n');
const rows = [];
lines.forEach((l, i) => {
  const m = /^(#{2,3})\s+(.+?)\s*$/.exec(l);
  if (!m) return;
  const title = short(m[2]);
  const hint = HINTS.find(([k]) => m[2].toLowerCase().includes(k.toLowerCase()))?.[1] || '';
  rows.push(`| ${m[1] === '##' ? `**${title}**` : title} | ${esc(hint)} | ${i + 1} |`);
});

const block = [
  BEG,
  `_Généré par \`node toc.mjs\` — ne pas éditer à la main. ${rows.length} sections, STYLE.md = ${lines.length} lignes._`,
  '_Usage : `Read STYLE.md offset=<ligne> limit=60` — **jamais** le fichier entier._',
  '',
  '| Ouvrir STYLE §… | pour… | ligne |',
  '|---|---|---|',
  ...rows,
  END,
].join('\n');

const idx = fs.readFileSync(INDEX, 'utf8');
const i0 = idx.indexOf(BEG); const i1 = idx.indexOf(END);
if (i0 < 0 || i1 < 0) { console.error(`✗ marqueurs ${BEG} / ${END} absents de INDEX.md`); process.exit(2); }
const current = idx.slice(i0, i1 + END.length);
const drift = current !== block;

if (CHECK) {
  console.log(drift ? '✗ TOC de STYLE.md DÉRIVÉE dans INDEX.md → node toc.mjs' : `✅ TOC à jour (${rows.length} sections)`);
  process.exit(drift ? 1 : 0);
}
if (!drift) { console.log(`✅ TOC déjà à jour (${rows.length} sections)`); process.exit(0); }
fs.writeFileSync(INDEX, idx.slice(0, i0) + block + idx.slice(i1 + END.length));
console.log(`✅ TOC régénérée dans INDEX.md — ${rows.length} sections, numéros de ligne recalculés`);
