#!/usr/bin/env node
// nus.mjs — AMORCER les manifestes d'un épisode : rendre en NU des journées déjà validées,
// dont le plan de coupe ne vit plus que dans les PROJETS ARCHIVÉS.
//
// POURQUOI IL EXISTE, ET POURQUOI CE N'EST PAS `revlog.mjs`. `revlog.mjs` re-rend un épisode
// DÉJÀ monté à partir de `vlog/parts-<JJ-MM>.json` : il suppose les manifestes existants.
// Avant le premier merge d'un épisode, ils n'existent pas — et `Réglages/plan.txt` est
// ÉCRASÉ à chaque journée, donc les 11 plans de coupe validés d'un lot ne sont plus nulle
// part sous forme de réglage. Ils sont en revanche archivés en entier, plan.txt + jour.txt
// compris, dans `projects/<stamp>/` (déposé par `monte.mjs` à chaque rendu). Cet outil part
// de là, rend chaque journée en NU, et INSTALLE `vlog/parts-<JJ-MM>.json`.
// Après lui, tout le reste de la chaîne (grade, qualité, 4K) repasse par `revlog.mjs`.
//
//   node nus.mjs --dry                        # ce qui serait rendu, et depuis quel projet
//   node nus.mjs --jours 21-07,22-07          # un sous-ensemble
//   node nus.mjs                              # toutes les journées listées ci-dessous
//
// LE CHOIX DU PROJET. Par jour ciblé (`jour.txt` de l'archive), on prend le projet le PLUS
// RÉCENT : c'est celui qui a produit le master retenu, puisqu'un master n'est remplacé que
// par un rendu postérieur. Ce choix n'est pas cru sur parole — il est CONTRÔLÉ deux fois :
//   · le nombre de plans rendus doit valoir celui du plan archivé ;
//   · la durée du rendu NU doit valoir celle du master badgé de la journée (à 0,5 s près :
//     les repères ne changent pas la durée, seul l'arrondi conteneur bouge).
//
// ⚠️ GARDE « LE R## EST UN INDEX, PAS UN IDENTIFIANT » (31/07). `monte.mjs` attribue
// `rid = i+1` sur l'inbox SCOPÉE AU JOUR : déposer un rush du même jour décale tout ce qui
// suit, et le plan archivé désignerait d'AUTRES fichiers, en silence. Le projet archivé porte
// la liste de ses rushs — on la compare à celle du rendu, et on n'installe rien en cas d'écart.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { STORE, REGLAGES, JOURS as DIR_JOURS } from './store.mjs';

const M = path.dirname(fileURLToPath(import.meta.url));
const VLOGDIR = path.join(M, 'vlog');
const PROJECTS = path.join(M, 'projects');
const COULISSES = path.join(STORE, '.coulisses');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
const DRY = has('--dry');
const ONLY = (val('--jours') || '').split(',').map((s) => s.trim()).filter(Boolean);

const say = (s = '') => console.log(s);
const RUN = (cmd, args, opts = {}) => spawnSync(cmd, args, { cwd: M, encoding: 'utf8', ...opts });
const dur = (f) => Number(JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries',
  'format=duration', '-of', 'json', f], { maxBuffer: 1 << 26 }).toString()).format.duration);

// ---- 1) inventaire des projets archivés, le plus récent gagne ------------------
function projets() {
  const par = new Map();
  for (const st of fs.readdirSync(PROJECTS).sort()) {
    const d = path.join(PROJECTS, st);
    const fj = path.join(d, 'jour.txt'), fp = path.join(d, 'plan.txt');
    if (!fs.existsSync(fj) || !fs.existsSync(fp)) continue;
    const ymd = fs.readFileSync(fj, 'utf8').trim().replace(/-/g, '');
    if (!/^\d{8}$/.test(ymd)) continue;
    const nb = fs.readFileSync(fp, 'utf8').split('\n')
      .filter((l) => /^\s*R\d+/.test(l.split('#')[0])).length;
    if (!nb) continue;                                  // un projet sans plan ne monte rien
    const j = `${ymd.slice(6, 8)}-${ymd.slice(4, 6)}`;   // JJ-MM
    par.set(j, { j, ymd, stamp: st, dir: d, nb });       // trié par nom = par date : le dernier écrase
  }
  return par;
}

// le master BADGÉ de la journée, pour le contrôle de durée (le plus récent de son jour)
function masterDe(j) {
  if (!fs.existsSync(DIR_JOURS)) return null;
  const re = new RegExp(`^Montage JOUR ${j} `);
  const c = fs.readdirSync(DIR_JOURS).filter((f) => re.test(f) && /\.mp4$/i.test(f))
    .map((f) => ({ f, t: fs.statSync(path.join(DIR_JOURS, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  return c.length ? path.join(DIR_JOURS, c[0].f) : null;
}

const par = projets();
const jours = [...par.keys()]
  .filter((j) => !ONLY.length || ONLY.includes(j))
  .sort((a, b) => { const [ja, ma] = a.split('-'), [jb, mb] = b.split('-'); return (ma - mb) || (ja - jb); });
if (!jours.length) { console.error('✖ aucun projet archivé ne correspond'); process.exit(1); }

say(`▶ masters NUS : ${jours.length} journée(s)`);
for (const j of jours) {
  const p = par.get(j);
  const m = masterDe(j);
  say(`   ${j}  ${p.stamp}  ${String(p.nb).padStart(3)} plans  → ${m ? path.basename(m) : '⚠ aucun master badgé pour contrôler'}`);
}
if (DRY) { say('\n--dry : rien rendu. Les Réglages seraient sauvegardés dans .coulisses/ puis restaurés.'); process.exit(0); }

// ---- 2) snapshot des Réglages (restauré quoi qu'il arrive) ---------------------
const REGS = ['jour.txt', 'plan.txt', 'reperes.txt', 'musique.txt'];
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const snap = path.join(COULISSES, `reglages-avant-nus-${stamp}`);
fs.mkdirSync(snap, { recursive: true });
for (const f of REGS) {
  const s = path.join(REGLAGES, f);
  if (fs.existsSync(s)) fs.copyFileSync(s, path.join(snap, f));
}
say(`   · Réglages sauvegardés → ${path.relative(STORE, snap)}`);

// ---- 3) une journée = un rendu nu + un manifeste ------------------------------
let ok = true;
const bilan = [];
try {
  for (const j of jours) {
    const p = par.get(j);
    say(`\n══════════ ${j} ══════════`);
    fs.copyFileSync(path.join(p.dir, 'plan.txt'), path.join(REGLAGES, 'plan.txt'));
    fs.writeFileSync(path.join(REGLAGES, 'jour.txt'), `${p.ymd.slice(0, 4)}-${p.ymd.slice(4, 6)}-${p.ymd.slice(6, 8)}\n`);
    fs.writeFileSync(path.join(REGLAGES, 'reperes.txt'), 'off');   // ni badge R## ni timecode
    fs.writeFileSync(path.join(REGLAGES, 'musique.txt'), 'off');   // 11 lits = 11 démarrages

    const r = RUN('node', ['monte.mjs'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const sortie = `${r.stdout || ''}${r.stderr || ''}`;
    sortie.split('\n').filter((l) => /cache segments|terminé en/.test(l)).forEach((l) => say('  ' + l.trim()));
    if (r.status !== 0) { console.error(`✖ ${j} : monte.mjs a échoué`); ok = false; break; }

    // ⚠️ « ✅ terminé » et pas « monté → » : monte.mjs réécrit le fichier après (02/08).
    const mFin = sortie.match(/✅ terminé[^\n]*→ (.+\.mp4)/);
    if (!mFin) { console.error(`✖ ${j} : impossible de lire le fichier rendu dans la sortie`); ok = false; break; }
    const rendu = mFin[1].trim();

    const neuf = JSON.parse(fs.readFileSync(path.join(VLOGDIR, 'parts-last.json'), 'utf8'));
    if (neuf.length !== p.nb) {
      console.error(`✖ ${j} : ${p.nb} plans au plan archivé, ${neuf.length} rendus — on n'installe pas`);
      ok = false; break;
    }
    // garde « index ≠ identifiant » : les rushs du rendu doivent être ceux du projet archivé
    const attendus = JSON.parse(fs.readFileSync(path.join(p.dir, 'project.json'), 'utf8'))
      .clips.map((c) => path.basename(c.file));
    const derive = neuf.filter((n) => !attendus.includes(n.rush))
      .map((n) => `  ✗ R${String(n.rid).padStart(2, '0')} → « ${n.rush} » absent du projet ${p.stamp}`);
    if (derive.length) {
      console.error(`\n✖ ${j} : ${derive.length} plan(s) ne retombent pas sur les rushs du projet archivé.`);
      console.error(derive.slice(0, 8).join('\n'));
      console.error("  → le R## est l'INDEX du rush dans l'inbox scopée au jour : l'inbox a changé.");
      ok = false; break;
    }
    // contrôle de durée contre le master badgé (les repères ne changent pas la durée)
    const dn = dur(rendu), mb = masterDe(j), dm = mb ? dur(mb) : null;
    const ecart = dm === null ? null : dn - dm;
    if (ecart !== null && Math.abs(ecart) > 0.5) {
      console.error(`✖ ${j} : nu ${dn.toFixed(2)} s contre master badgé ${dm.toFixed(2)} s (${ecart >= 0 ? '+' : ''}${ecart.toFixed(2)}) — ce n'est pas le même montage`);
      ok = false; break;
    }
    fs.copyFileSync(path.join(VLOGDIR, 'parts-last.json'), path.join(VLOGDIR, `parts-${j}.new.json`));
    bilan.push({ j, plans: neuf.length, dn, dm, ecart });
    say(`  plans ${neuf.length} ✔ · rushs conformes ✔ · nu ${dn.toFixed(2)} s`
      + (dm === null ? ' (pas de master badgé à comparer)' : ` vs badgé ${dm.toFixed(2)} s (${ecart >= 0 ? '+' : ''}${ecart.toFixed(2)}) ✔`));
  }
} finally {
  for (const f of REGS) {
    const s = path.join(snap, f);
    if (fs.existsSync(s)) fs.copyFileSync(s, path.join(REGLAGES, f));
  }
  RUN('node', ['numeroter.mjs']);   // l'invariant de numérotation suit le jour actif
  say(`\n   · Réglages restaurés : jour=${fs.readFileSync(path.join(REGLAGES, 'jour.txt'), 'utf8').trim()}`
    + ` reperes=${fs.readFileSync(path.join(REGLAGES, 'reperes.txt'), 'utf8').trim()}`
    + ` musique=${fs.readFileSync(path.join(REGLAGES, 'musique.txt'), 'utf8').trim()}`);
}

// ---- 4) installation en bloc (rien de partiel) --------------------------------
const neufs = jours.map((j) => path.join(VLOGDIR, `parts-${j}.new.json`)).filter((f) => fs.existsSync(f));
if (!ok) {
  neufs.forEach((f) => fs.rmSync(f, { force: true }));
  console.error('\n✖ échec : aucun manifeste installé (les .new.json ont été retirés)');
  process.exit(1);
}
for (const j of jours) fs.renameSync(path.join(VLOGDIR, `parts-${j}.new.json`), path.join(VLOGDIR, `parts-${j}.json`));

const tot = bilan.reduce((a, b) => a + b.dn, 0);
say(`\n✓ ${bilan.length} manifeste(s) installé(s) · ${bilan.reduce((a, b) => a + b.plans, 0)} plans · ${Math.floor(tot / 60)}:${(tot % 60).toFixed(2).padStart(5, '0')} de paysage nu`);
say('✅ terminé — la suite passe par vlog.mjs (assemblage) puis revlog.mjs (re-rendus)');
