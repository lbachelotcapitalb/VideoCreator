#!/usr/bin/env node
// lecture.mjs — GABARIT DE LECTURE d'un jour de rushs (le chaînon qui manquait).
//
// POURQUOI (consigne le monteur 27/07) : « il est important que tu cernes et écrives ce que montre et
// comment évolue chaque rush pour mieux décider ». Aucune décision de coupe ne se prend sans que le
// contenu ait été lu et ÉCRIT — sinon on retombe dans la mesure aveugle.
//
// ⚠️ REFONDU LE 29/07 après l'audit du jour 16/07 — le premier vrai test en aveugle (fiche écrite
// AVANT les verdicts du monteur). Résultat : 19 % de fenêtres bien placées, moins bien qu'une règle
// aveugle. La cause n'était PAS le manque d'information (pellicules + mesures + 40 blocs écrits)
// mais le formulaire lui-même : « montre / évolue / durée » fait décrire le plan, pas décider.
// le monteur, 29/07 : « il n'y a pas de règle intérieur ou pas, simplement bien comprendre un rush doit
// permettre de sélectionner une timeline pertinente, quand commence-t-elle et quand doit-elle se
// finir ». Le formulaire pose donc désormais SES deux questions, dans SON ordre :
//   1. qu'est-ce qui est filmé ASSUMÉ ici ?  → si rien : cut, et il n'y a pas de fenêtre à chercher
//   2. sur quel intervalle est-ce que ça TIENT ? → l'entrée et la sortie, chacune justifiée
//
// Ce script ne décide rien et ne regarde rien : il pose le FORMULAIRE (un bloc par rush, aucun
// rush oublié en silence — cf. la leçon « amputation silencieuse » du 18/07) et y injecte les
// mesures déjà disponibles. C'est Claude qui le REMPLIT après avoir lu les pellicules
// (`filmstrip.mjs`) et la planche-contact, puis en déduit `plan.txt`.
//
//   node lecture.mjs            → Réglages/lecture-<jour>.md (n'écrase jamais un fichier rempli)
//   node lecture.mjs --force    → régénère le gabarit à neuf
//
// 100 % offline, instantané (aucun décodage vidéo : les mesures viennent de curate.mjs).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INBOX, STORE } from './store.mjs';   // chemins du store : un seul endroit

const ENG = path.dirname(fileURLToPath(import.meta.url));
const RUSH = INBOX;
const REG = path.join(STORE, 'Réglages');
const FORCE = process.argv.includes('--force');
const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.avi', '.mkv', '.webm']);

function readJours() {
  try {
    return fs.readFileSync(path.join(REG, 'jour.txt'), 'utf8')
      .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
      .map((l) => l.replace(/\D/g, '')).filter((d) => d.length === 8);
  } catch { return []; }
}
const jours = readJours();
if (!jours.length) { console.error('Réglages/jour.txt ne cible aucun jour — scoper d\'abord.'); process.exit(1); }

const files = fs.readdirSync(RUSH)
  .filter((f) => !f.startsWith('.') && !f.startsWith('._') && VIDEO_EXT.has(path.extname(f).toLowerCase()))
  .filter((f) => { const m = f.match(/(\d{8})/); return m && jours.includes(m[1]); })
  .sort((a, b) => ((a.match(/(\d{14})/) || [])[1] || '').localeCompare((b.match(/(\d{14})/) || [])[1] || ''))
  .map((f, i) => ({ id: `R${String(i + 1).padStart(2, '0')}`, file: f }));
if (!files.length) { console.error(`Aucun rush pour ${jours.join(', ')}.`); process.exit(1); }

const dur = (f) => parseFloat((spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
  '-of', 'default=nw=1:nk=1', path.join(RUSH, f)], { encoding: 'utf8' }).stdout || '').trim()) || 0;

// mesures déjà calculées par curate.mjs (facultatif — le gabarit marche sans)
const mesures = {};
try {
  for (const l of fs.readFileSync(path.join(ENG, 'catalogue/curation.md'), 'utf8').split('\n')) {
    const m = l.match(/^\|\s*(R\d+)\s*\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|/);
    if (m) mesures[m[1]] = { cam: m[4].trim(), cap: m[5].trim() };
  }
} catch { /* pas de curation.md → gabarit nu */ }

const jour = `${jours[0].slice(0, 4)}-${jours[0].slice(4, 6)}-${jours[0].slice(6)}`;
const out = path.join(REG, `lecture-${jour}.md`);
if (fs.existsSync(out) && !FORCE) {
  console.log(`⚠️  ${out} existe déjà (rempli ?) — relancer avec --force pour l'écraser.`);
  process.exit(0);
}

const L = [];
L.push(`# Lecture des rushs — ${jour}`);
L.push('');
L.push('Rempli par Claude APRÈS avoir regardé les pellicules (`node filmstrip.mjs 1 R##`) et la');
L.push('planche-contact. Sert de base à `plan.txt` : un rush sans lecture ne se coupe pas, et un rush');
L.push('coupé garde ici sa raison écrite.');
L.push('');
L.push('## Question 1 — qu\'est-ce qui est filmé ASSUMÉ ici ? (décide le cut)');
L.push('');
L.push('le monteur, 29/07 : « si on filme assumé le haut des tours okay ; si on filme pas le sol mais juste');
L.push('au-dessus sans mettre réellement en valeur un building = mal filmé, on cut ».');
L.push('');
L.push('Ce n\'est **pas** une affaire de règle de composition — ne pas l\'interpréter ainsi. C\'est :');
L.push('**un sujet est-il désigné, et le cadre s\'y engage-t-il ?** Une caméra restée à hauteur d\'yeux');
L.push('sur ce qui se trouvait là = cadre SUBI = cut, même si l\'image est nette, stable et jolie.');
L.push('Ça se juge sur UNE image — donc c\'est le premier tri, avant toute mesure.');
L.push('');
L.push('> **Si la réponse est « rien » → décision : CUT, et on ne cherche PAS de fenêtre.**');
L.push('> Passer au rush suivant. C\'est le seul enchaînement qui économise du temps à bon droit.');
L.push('');
L.push('## Question 2 — sur quel intervalle est-ce que ça TIENT ? (décide le in/out)');
L.push('');
L.push('**Il n\'y a AUCUNE règle de position** — ni « intérieur », ni « début », ni « fin » (le monteur, 29/07 ;');
L.push('la règle « fenêtre intérieure » du 27/07 a été supprimée le 29/07, elle plaçait 1 fenêtre sur 16).');
L.push('L\'entrée est l\'instant où le sujet devient lisible/désigné ; la sortie, l\'instant où ça se défait');
L.push('(on passe devant, on lève la caméra, la parole démarre, le sujet est épuisé). Les deux se lisent');
L.push('DANS le rush et s\'écrivent avec leur raison. La durée est le RÉSULTAT, jamais le point de départ.');
L.push('');
L.push('Repères de durée — indicatifs, à ne pas appliquer contre ce que dit le plan :');
L.push('');
L.push('| durée | quand |');
L.push('|---|---|');
L.push('| **court** (1,5-2,5 s) | le plan montre une chose, elle se lit d\'un coup d\'œil |');
L.push('| **+long** (3-4 s) | il faut un instant pour lire le cadre (profondeur, plusieurs plans) |');
L.push('| **long** (5 s) | quelque chose SE PASSE et on veut le voir aboutir |');
L.push('| **très long** (6-7 s) | le sujet est fort et il ÉVOLUE : le plan raconte une petite scène |');
L.push('| **hors barème** | le plan PARLE (voix intelligible) ou CLÔT la journée — 16/07 : R02 22 s, R40 14,6 s |');
L.push('');
L.push('Le plafond de 7 s vaut pour du B-roll muet. Un plan narré échappe au barème : sur le 16/07,');
L.push('le monteur garde R02 entier (22 s) parce que sa voix y est « compréhensible, visionnable ». Le critère');
L.push('est l\'intelligibilité, pas la présence de voix.');
L.push('');
for (const { id, file } of files) {
  const D = dur(file);
  const m = mesures[id];
  L.push(`## ${id} — ${D.toFixed(1)} s`);
  L.push(`<!-- ${file}${m ? ` · caméra : ${m.cam} · garder ≤ ${m.cap}` : ''} -->`);
  L.push('- **assumé** : quel sujet est désigné, et comment le cadre s\'y engage — ou `RIEN` (→ CUT, on s\'arrête là)');
  L.push('- **entrée** : à … s, parce que ');
  L.push('- **sortie** : à … s, parce que ');
  L.push('- **dans la journée** : déjà vu ailleurs ? redondant avec R## ? ');
  L.push('- **décision** : CUT | `R## a-b` (… s)');
  L.push('');
}
fs.writeFileSync(out, L.join('\n'));
console.log(`→ gabarit de lecture (${files.length} rushs) : ${out}`);
