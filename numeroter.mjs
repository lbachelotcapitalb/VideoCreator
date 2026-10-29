#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// numeroter.mjs — préfixe le NUMÉRO R## (celui des badges du montage) dans le
// nom de fichier de chaque rush du JOUR ACTIF, pour que le monteur retrouve « R07 » à
// l'œil dans le Finder / la bibliothèque.
//
//   node numeroter.mjs           → applique (renomme ce qui doit l'être)
//   node numeroter.mjs --dry     → aperçu seulement, ne renomme rien
//
// DOCTRINE (demande le monteur 19/07) : « à chaque passage, renommer chaque rush pour
// refléter la numérotation ; après coup, ne pas renommer — juste CONTRÔLER au cas
// où ça n'aurait pas été fait ou qu'il y ait eu des changements. » → ce script est
// IDEMPOTENT : un rush déjà correctement préfixé est laissé tel quel (compté
// « ok »), seuls les écarts (nouveau rush, ordre changé, préfixe périmé) sont
// corrigés.
//
// GARDE-FOUS
//  • Le stamp DJI (14 chiffres) est CONSERVÉ dans le nom → la numérotation R##
//    (dérivée du tri chronologique de ce stamp, cf. monte.listRushes) reste stable.
//  • Numérotation JOUR-SCOPÉE (Réglages/jour.txt) : R## repart à R01 par jour, comme
//    les badges. INVARIANT : seuls les rushes du jour ciblé portent un préfixe ; les
//    fichiers d'un AUTRE jour qui traîneraient avec un vieux préfixe sont DÉ-préfixés
//    (le numéro n'a de sens que dans le jour qu'on monte).
//  • Contenu jamais touché ; réversible (ré-exécuter après avoir vidé jour.txt rend
//    tous les fichiers à leur nom DJI d'origine).
// ═══════════════════════════════════════════════════════════════════════════
import fs from 'fs';
import path from 'path';
import os from 'os';
import { INBOX } from './store.mjs';   // chemins du store : un seul endroit

const HOME = os.homedir();
const MONT = path.join(HOME, 'Movies', 'Montage');
// (INBOX vient de store.mjs)
const REGLAGES = path.join(MONT, 'Réglages');
const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.avi', '.mkv', '.webm']);
const PREFIX_RE = /^R\d{2,3}_/;               // notre préfixe : R02_ , R14_ …
const DRY = process.argv.includes('--dry');

// scope jour — IDENTIQUE à monte.readJours() / catalogue.readJours()
function readJours() {
  try {
    return fs.readFileSync(path.join(REGLAGES, 'jour.txt'), 'utf8').split('\n')
      .map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
      .map((l) => {
        let m;
        if ((m = l.match(/^(\d{4})-?(\d{2})-?(\d{2})$/))) return m[1] + m[2] + m[3];
        if ((m = l.match(/^(\d{2})\/(\d{2})\/(\d{4})$/))) return m[3] + m[2] + m[1];
        return l.replace(/\D/g, '');
      }).filter((d) => d.length === 8);
  } catch { return []; }
}
// stamp = 14 chiffres du nom, cherché APRÈS avoir retiré notre préfixe (sinon un
// préfixe numérique pourrait masquer le vrai stamp)
const strip = (name) => name.replace(PREFIX_RE, '');
const stampOf = (name) => (strip(name).match(/(\d{14})/) || [])[1] || null;

if (!fs.existsSync(INBOX)) { console.error('Dossier introuvable :', INBOX); process.exit(1); }
const jours = readJours();

const all = fs.readdirSync(INBOX)
  .filter((f) => !f.startsWith('.') && !f.startsWith('._') && VIDEO_EXT.has(path.extname(f).toLowerCase()))
  .map((f) => ({ name: f, st: stampOf(f), mtime: fs.statSync(path.join(INBOX, f)).mtimeMs }));

const inScope = (x) => !jours.length || (x.st && jours.includes(x.st.slice(0, 8)));
// ordre chronologique = stamp du nom (repli mtime) — MÊME tri que monte.listRushes()
const active = all.filter(inScope)
  .sort((a, b) => (a.st && b.st ? a.st.localeCompare(b.st) : a.mtime - b.mtime));
const others = all.filter((x) => !inScope(x));

// plan de renommage
const ops = [];
active.forEach((x, i) => {
  const rid = `R${String(i + 1).padStart(2, '0')}`;
  const target = `${rid}_${strip(x.name)}`;
  if (x.name !== target) ops.push({ from: x.name, to: target, kind: 'num', rid });
});
// dé-préfixe les fichiers hors-scope qui traînent avec un vieux R##_
others.forEach((x) => {
  if (PREFIX_RE.test(x.name)) ops.push({ from: x.name, to: strip(x.name), kind: 'strip' });
});

// exécution (avec garde anti-collision)
let renamed = 0, skipped = 0;
for (const op of ops) {
  const dst = path.join(INBOX, op.to);
  if (fs.existsSync(dst)) { console.error(`⚠ collision, ignoré : ${op.to}`); continue; }
  if (DRY) { console.log(`  ${op.kind === 'strip' ? '– ' : `${op.rid} `}${op.from}  →  ${op.to}`); }
  else fs.renameSync(path.join(INBOX, op.from), dst);
  renamed++;
}
skipped = active.length - active.filter((x, i) =>
  ops.some((o) => o.kind === 'num' && o.from === x.name)).length;

const scopeLbl = jours.length ? jours.join(', ') : 'tous les jours';
console.log(`\nJour(s) actif(s) : ${scopeLbl} — ${active.length} rushes (R01..R${String(active.length).padStart(2, '0')})`);
console.log(DRY
  ? `[--dry] ${ops.length} renommage(s) à faire, ${skipped} déjà OK.`
  : `${renamed} renommé(s), ${skipped} déjà OK${others.length ? `, ${ops.filter(o => o.kind === 'strip').length} dé-préfixé(s) (autres jours)` : ''}.`);
