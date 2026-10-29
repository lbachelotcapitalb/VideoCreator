#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// revlog.mjs — RE-RENDRE UN VLOG DÉJÀ MONTÉ, sans retoucher le montage.
//
// À QUOI ÇA SERT. Quand on change quelque chose qui touche l'IMAGE de tous les
// plans — une recette de grade, l'épaule des hautes lumières, un filtre adaptatif —
// le montage lui-même ne bouge pas d'un millimètre : mêmes rushs, mêmes fenêtres,
// mêmes frontières. Ce qu'il faut refaire, c'est la chaîne ① → ③ de `VLOG.md` :
// re-rendre chaque journée en master NU, réinstaller les manifestes, re-merger.
// Six journées à la main, c'est une demi-douzaine d'occasions d'oublier un
// `reperes=off` ou de laisser les Réglages dans l'état de travail.
//
//   node revlog.mjs --dry        → ce qui serait fait (aucun encodage)
//   node revlog.mjs              → tout : journées + vérif + merge + musique
//   node revlog.mjs --jours 15-07,19-07   → seulement ces journées, puis merge
//   node revlog.mjs --no-merge   → journées seulement (débogage)
//
// LA SOURCE DE VÉRITÉ, c'est `vlog/parts-<JJ-MM>.json` : il porte, pour chaque
// plan retenu, le rush et la fenêtre source EXACTE du montage validé. On en
// reconstruit `plan.txt` — donc on ne peut pas « re-couper par accident ».
//
// ⚠️ LE GARDE-FOU QUI JUSTIFIE CE FICHIER (leçon du 31/07, cf. STYLE §purge de
// cache) : entre le rendu d'une journée et le merge, un segment peut DISPARAÎTRE
// du cache (purge au plafond). Le rendu se termine en vert, le manifeste s'écrit,
// et c'est `vlog.mjs` qui découvre le trou dix minutes plus tard. Ici on vérifie
// que les 97 segments existent AVANT d'installer quoi que ce soit, et on refuse
// d'aller plus loin sinon.
// ═══════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// les chemins du store viennent de store.mjs, JAMAIS d'un `path.join` local — c'est cette
// dispersion qui avait fait dériver le store, et `arbo.mjs --check` dénonce tout script qui
// recommence (il m'a repris ici même, le 01/08, sur un « Landscape Rush » écrit en dur).
import { STORE, REGLAGES, LANDSCAPE } from './store.mjs';

const M = path.dirname(fileURLToPath(import.meta.url));
const VLOGDIR = path.join(M, 'vlog');
const COULISSES = path.join(STORE, '.coulisses');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
const DRY = has('--dry');
const NO_MERGE = has('--no-merge');
const ONLY = (val('--jours') || '').split(',').map((s) => s.trim()).filter(Boolean);

const say = (s = '') => console.log(s);
const RUN = (cmd, args, opts = {}) => spawnSync(cmd, args, { cwd: M, encoding: 'utf8', ...opts });

// ---- les journées du vlog, dans l'ordre, depuis les manifestes ---------------
function journees() {
  return fs.readdirSync(VLOGDIR)
    .filter((f) => /^parts-\d{2}-\d{2}\.json$/.test(f))
    .map((f) => f.slice(6, 11))
    .sort((a, b) => {                       // JJ-MM → tri chronologique
      const [ja, ma] = a.split('-'), [jb, mb] = b.split('-');
      return (ma - mb) || (ja - jb);
    })
    .filter((j) => !ONLY.length || ONLY.includes(j));
}

// L'ANNÉE ET LE MOIS viennent du NOM DU RUSH (`DJI_YYYYMMDD…`), jamais d'une
// constante : le jour de tournage est dans le nom, c'est la règle du moteur.
function ymdDe(parts) {
  for (const p of parts) {
    const m = (p.rush || '').match(/(\d{8})\d{6}/);
    if (m) return m[1];
  }
  return null;
}

function planDepuisManifeste(j, parts, ymd) {
  const lignes = [
    `# jour: ${ymd}`,
    '# Plan RECONSTRUIT par revlog.mjs depuis vlog/parts-' + j + '.json',
    '# (fenêtres EXACTES du montage validé — ce fichier ne re-coupe rien).',
    ...parts.map((p) => `R${String(p.rid).padStart(2, '0')} ${p.from.toFixed(2)}-${p.to.toFixed(2)}`),
  ];
  return lignes.join('\n') + '\n';
}

// ---- snapshot / restauration des Réglages ----------------------------------
// DEUX temps de restauration, et ce n'est pas un détail (31/07) :
//  · REGS = ce que le rendu des JOURNÉES bouscule → à remettre dès les journées finies,
//    donc AVANT le merge ;
//  · REGS_RUN = `qualite` et `definition`, qui valent pour TOUT le run, merge compris. Les
//    remettre avant le merge ferait sortir le master en brouillon 1080 — c'est justement
//    pourquoi ils n'étaient pas dans la liste, et pourquoi ils ont été « remis à la main »
//    aux deux masters (31/07 matin puis soir). Une règle qui dépend de la discipline de
//    l'opérateur finit violée : elle est désormais mécanisée, en toute fin de run.
const REGS = ['jour.txt', 'plan.txt', 'reperes.txt', 'musique.txt'];
const REGS_RUN = ['qualite.txt', 'definition.txt'];
function snapshot() {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const dir = path.join(COULISSES, `reglages-avant-revlog-${stamp}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of [...REGS, ...REGS_RUN]) {
    const src = path.join(REGLAGES, f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dir, f));
  }
  return dir;
}
function restaure(dir, liste = REGS) {
  for (const f of liste) {
    const src = path.join(dir, f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(REGLAGES, f));
  }
  if (liste === REGS) RUN('node', ['numeroter.mjs']);   // l'invariant de numérotation suit le jour actif
}
// à appeler en TOUTE FIN de run, quel qu'en soit le sort (succès, échec, ^C).
function restaureRun(dir) {
  restaure(dir, REGS_RUN);
  const lu = (f) => { try { return fs.readFileSync(path.join(REGLAGES, f), 'utf8').trim(); } catch { return '?'; } };
  say(`   · niveau de rendu restauré : qualite=${lu('qualite.txt')} definition=${lu('definition.txt')}`);
}

// ---- le contrôle qui manquait : tout segment référencé existe-t-il ? --------
function segmentsManquants(fichiers) {
  const trous = [];
  for (const f of fichiers) {
    for (const p of JSON.parse(fs.readFileSync(f, 'utf8'))) {
      if (!fs.existsSync(p.file)) trous.push(`${path.basename(f)} R${String(p.rid).padStart(2, '0')} → ${path.basename(p.file)}`);
    }
  }
  return trous;
}

// ═══ déroulé ════════════════════════════════════════════════════════════════
const JOURS = journees();
if (!JOURS.length) { console.error('✖ aucun manifeste vlog/parts-JJ-MM.json — rien à re-rendre'); process.exit(1); }

const plans = Object.fromEntries(JOURS.map((j) => [j, JSON.parse(fs.readFileSync(path.join(VLOGDIR, `parts-${j}.json`), 'utf8'))]));
const total = Object.values(plans).reduce((a, p) => a + p.length, 0);

say(`▶ re-rendu du VLOG : ${JOURS.length} journée(s), ${total} plans`);
for (const j of JOURS) say(`   ${j} : ${plans[j].length} plans  (jour ${ymdDe(plans[j]) || '?'})`);
if (NO_MERGE) say('   · --no-merge : on s\'arrête après les journées');

if (DRY) {
  say('\n--dry : rien n\'a été rendu. Les Réglages seraient sauvegardés dans .coulisses/ puis restaurés.');
  process.exit(0);
}

const snap = snapshot();
say(`   · Réglages sauvegardés → ${path.relative(STORE, snap)}`);

let ok = true;
try {
  for (const j of JOURS) {
    const parts = plans[j];
    const ymd = ymdDe(parts);
    if (!ymd) { console.error(`✖ ${j} : aucun horodatage lisible dans les noms de rush`); ok = false; break; }
    say(`\n══════════ ${j} ══════════`);
    fs.writeFileSync(path.join(REGLAGES, 'plan.txt'), planDepuisManifeste(j, parts, ymd));
    fs.writeFileSync(path.join(REGLAGES, 'jour.txt'), `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}\n`);
    fs.writeFileSync(path.join(REGLAGES, 'reperes.txt'), 'off');   // master NU (cf. VLOG.md ①)
    fs.writeFileSync(path.join(REGLAGES, 'musique.txt'), 'off');
    const r = RUN('node', ['monte.mjs'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const sortie = `${r.stdout || ''}${r.stderr || ''}`;
    sortie.split('\n').filter((l) => /scène .* plans|cache segments|terminé en/.test(l)).forEach((l) => say(l.trim()));
    if (r.status !== 0) { console.error(`✖ ${j} : monte.mjs a échoué`); ok = false; break; }
    const last = path.join(VLOGDIR, 'parts-last.json');
    const neuf = JSON.parse(fs.readFileSync(last, 'utf8'));
    if (neuf.length !== parts.length) {
      console.error(`✖ ${j} : ${parts.length} plans attendus, ${neuf.length} rendus — on n'installe pas`);
      ok = false; break;
    }
    // ⚠️ GARDE « LE R## EST UN INDEX, PAS UN IDENTIFIANT » (31/07). `monte.mjs` attribue
    // `rid = i + 1` sur `listRushes()`, c'est-à-dire l'INDEX du rush dans l'inbox scopée au
    // jour. Ajouter ou retirer un rush DU MÊME JOUR dans l'inbox décale donc tous les R##
    // suivants — et le `plan.txt` que l'on vient de reconstruire depuis le manifeste
    // désignerait d'AUTRES rushs, en silence. C'est exactement le piège payé le 31/07 côté
    // facecam (ids `cN` attribués par ordre alphabétique : 9 segments vides, un rendu de
    // 220 s au lieu de 451,8 s, et le script fini en vert).
    // Ici la parade est gratuite : le manifeste porte AUSSI le NOM du rush. On compare.
    const derive = [];
    for (let k = 0; k < parts.length; k++) {
      if (neuf[k].rush !== parts[k].rush) {
        derive.push(`  ✗ R${String(parts[k].rid).padStart(2, '0')} : le manifeste dit « ${parts[k].rush} », `
          + `le rendu a pris « ${neuf[k].rush} »`);
      }
    }
    if (derive.length) {
      console.error(`\n✖ ${j} : ${derive.length} plan(s) ne retombent PAS sur le même rush — on n'installe pas.`);
      console.error(derive.slice(0, 8).join('\n'));
      console.error(`  → le R## est l'INDEX du rush dans l'inbox scopée au jour : le contenu de`);
      console.error(`     « ${LANDSCAPE} » a changé depuis le montage validé.`);
      console.error(`  → remettre l'inbox dans l'état du montage, ou re-couper la journée.`);
      ok = false; break;
    }
    fs.copyFileSync(last, path.join(VLOGDIR, `parts-${j}.new.json`));
    say(`  plans ${parts.length} → ${neuf.length} ✔  (rushs identiques au manifeste)`);
  }
} finally {
  restaure(snap);
  say(`\n   · Réglages restaurés : jour=${fs.readFileSync(path.join(REGLAGES, 'jour.txt'), 'utf8').trim()}`
    + ` reperes=${fs.readFileSync(path.join(REGLAGES, 'reperes.txt'), 'utf8').trim()}`
    + ` musique=${fs.readFileSync(path.join(REGLAGES, 'musique.txt'), 'utf8').trim()}`);
}
if (!ok) { restaureRun(snap); process.exit(1); }

// ---- GARDE-FOU : les segments existent-ils encore ? -------------------------
const neufs = JOURS.map((j) => path.join(VLOGDIR, `parts-${j}.new.json`));
const trous = segmentsManquants(neufs);
if (trous.length) {
  console.error(`\n✖ ${trous.length} segment(s) référencé(s) ont DISPARU du cache avant le merge :`);
  trous.slice(0, 8).forEach((t) => console.error(`   ${t}`));
  console.error('  → les manifestes ne sont PAS installés (le montage en place reste valide).');
  console.error('  → relancer `node revlog.mjs` : la purge est en LRU, les segments neufs survivent.');
  restaureRun(snap);
  process.exit(1);
}
say(`\n✓ ${total}/${total} segments présents`);

for (const j of JOURS) fs.renameSync(path.join(VLOGDIR, `parts-${j}.new.json`), path.join(VLOGDIR, `parts-${j}.json`));
say(`✓ ${JOURS.length} manifeste(s) installé(s)`);

if (NO_MERGE) { say('· --no-merge : merge non lancé'); restaureRun(snap); process.exit(0); }

say('\n▶ merge + lit musical (vlog.mjs)');
for (const f of fs.existsSync(path.join(VLOGDIR, 'work')) ? fs.readdirSync(path.join(VLOGDIR, 'work')) : []) {
  if (/^_raw/.test(f)) fs.rmSync(path.join(VLOGDIR, 'work', f), { force: true });
}
const v = RUN('node', ['vlog.mjs'], { stdio: 'inherit' });
restaureRun(snap);       // le merge est passé : on repose le niveau de rendu de travail
process.exit(v.status ?? 0);
