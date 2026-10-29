// arbo.mjs — pose, répare et vérifie l'ARBORESCENCE CANONIQUE du store (~/Movies/Montage).
//   node arbo.mjs                  → PLAN (dry-run) : dit ce qu'il ferait, ne touche à RIEN
//   node arbo.mjs --apply          → applique le plan
//   node arbo.mjs --check          → vérifie seulement (sortie 1 si dérive) — utilisable en cron/CI
//   node arbo.mjs --purge          → applique la RÉTENTION (N/N-1) : les rendus périmés → CORBEILLE
//   node arbo.mjs --purge-journees → ÉTEND la rétention aux masters de `Journées/`, par JOUR
//                                    (hors du --purge ordinaire : c'est la matière du final)
//   node arbo.mjs --store <chemin> → cible un autre store (nouvelle machine, test)
//
// POURQUOI : le store du monteur doit rester lisible SANS lui. La règle tient en une phrase (le monteur,
// 31/07) : **un dossier de RUSH ne contient que des rushes ; tout ce que le moteur PRODUIT vit
// sous « Vidéos finies »**. Et le technique (EDL, cartes json, backups) reste hors du champ de
// vision, dans `.coulisses/` (masqué).
//
//   Vidéos finies/  VLOG ….mp4   = les ÉPISODES, le livrable qu'on regarde
//                   Journées/    = les masters de journée, matière du final — JAMAIS purgés
//                   Tests/       = les rendus datés d'itération — rétention N/N-1
//
// Cet outil est la reproduction MÉCANIQUE de la réorg : sur un store neuf il la pose, sur un store
// en vrac il la répare, sur un store conforme il ne fait rien (idempotent).
//
// GARDE-FOU : `--apply` ne SUPPRIME jamais rien (mkdir/mv seulement). `--purge` ne supprime pas
// non plus : il met à la CORBEILLE, donc le monteur peut revenir en arrière tant qu'il ne la vide pas.
// Un fichier dont l'outil ne sait rien est laissé où il est et signalé — jamais deviné, jamais jeté.
//
// POURQUOI --purge EXISTE (31/07) : la rétention « garder N et N-1 » était une consigne écrite,
// donc suspendue à un réflexe humain. Résultat mesuré ce jour-là : 13 rendus de test empilés
// (782 Mo) et 4 épisodes dont 2 périmés (2,35 Go). Une règle que rien n'exécute n'est pas une
// règle, c'est un vœu.
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const CHECK = args.includes('--check');
const PURGE = args.includes('--purge');
// `Journées/` reste HORS du --purge ordinaire (contrat : c'est la matière du final). Le jour où
// le monteur demande le ménage des masters périmés, ce flag EXPLICITE l'ouvre — et il applique la même
// rétention N/N-1, mais par LIGNÉE = LE JOUR (`Montage JOUR 22-07 …`). Un pool global jetterait
// tous les jours sauf deux : c'est exactement le bug facecam du 02/08, un cran plus haut.
const PURGE_JOURS = args.includes('--purge-journees');
const KEEP = 2;                              // rétention : N et N-1 (cf. STYLE §purge)
const iStore = args.indexOf('--store');
const STORE = iStore >= 0 ? path.resolve(args[iStore + 1])
  : (process.env.MONTAGE_STORE || path.join(process.env.HOME, 'Movies', 'Montage'));

// ---- SPEC (softcodée : ajouter une 3ᵉ source = ajouter une entrée ici, rien d'autre) -------------
const INBOX = 'Déposer les rushes ici';      // même nom dans CHAQUE source (le geste du monteur est le même)
// « Vidéos finies » = les rendus D'ÉPISODE. Depuis le 30/07 (le monteur), elle ne reçoit plus seulement
// le rendu final validé : elle reçoit AUSSI les rendus VLOG agrégés, ceux qui précèdent
// immédiatement le final. Raison : un VLOG mergé n'est pas un rendu de journée, il n'a rien à
// faire au milieu des 24 « Montage JOUR … » de « Landscape Rush » — c'est l'objet qu'on regarde,
// qu'on annote et qu'on itère, il doit être là où on le cherche.
const FINAL = 'Vidéos finies';
const JOURS = path.join(FINAL, 'Journées');  // masters de journée — JAMAIS purgés
const TESTS = path.join(FINAL, 'Tests');     // rendus datés d'itération — rétention N/N-1
const ELEMENTS = path.join(FINAL, 'Éléments'); // pièces réutilisables (générique…) — jamais purgées
const COUL = '.coulisses';                   // masqué (dot) : hors du champ de vision
// ⚠️ CHANGEMENT DU 31/07 : `render` ne veut plus dire « remonte à la racine de la source ».
// Un dossier de rush ne contient QUE des rushes (+ son inbox). Ce que le moteur produit part
// sous « Vidéos finies », dans le sous-dossier que dit `dest`.
const SOURCES = [
  // dir    = dossier de la source ; legacy = anciens emplacements de ses rushes (avant réorg)
  // render = motif d'un RENDU trouvé dans la source ; dest = où il doit atterrir
  { dir: 'Landscape Rush', legacy: ['Déposer les rushes ici', 'Landscape Rush 2'],
    render: /^Montage JOUR /i, dest: JOURS },
  // ⚠️ `VLOG_…` (underscore) N'EST PAS un rendu : c'est le master facecam, une SOURCE. Il reste.
  { dir: 'Facecam Rush', legacy: ['facecamrush', 'Facecam rush'], render: null, dest: null },
];
const TEST_RENDER = /^Montage \d{4}-\d{2}-\d{2}/i;                       // rendu de TEST daté → coulisses
// Rendu VLOG AGRÉGÉ → « Vidéos finies ». L'espace après VLOG est ce qui le distingue du master
// facecam `VLOG_Chine_facecam_v12.mp4` (underscore), qui reste, lui, une source dans Facecam Rush.
const VLOG_RENDER = /^VLOG .+\.(mp4|mov|m4v)$/i;
// pièce réutilisable, produite une fois puis greffée : elle n'est ni un test ni un épisode.
const ELEMENT = /^(GENERIQUE|GÉNÉRIQUE|CARTON|INTRO|OUTRO|MAQUETTE)[\b_ -]/i;
// master facecam dérushé : c'est une SOURCE du merge (vlog.mjs le lit), il reste dans sa source —
// mais ses versions s'empilent (v10, v11, v12…), donc la rétention N/N-1 s'y applique aussi.
// `_4K` (ou tout autre suffixe de définition) après le `_vNN` : sans lui, les masters
// facecam 4K échappaient à la rétention N/N-1 et s'empilaient à 1,2 Go pièce (31/07).
const FACECAM_MASTER = /^VLOG_.+_v\d+(_\w+)?\.(mp4|mov|m4v)$/i;
const TECH = /(^carte.*\.json$|\.edl\.json$|\.edl\.refined\.json$|\.EDL\.md$)/i;  // technique facecam
const BACKUP = /\.bak[-.]|\.BACKUP$|\.SAVED/i;                            // sauvegardes de config
const ANNEXES = ['Musiques', 'Références (inspiration)', 'Réglages'];
const COUL_SUB = { tech: 'facecam', tests: 'anciens rendus de test', backups: 'backups' };
const VIDEO = /\.(mp4|mov|m4v|avi|mkv|webm)$/i;

// ---- plan ---------------------------------------------------------------------------------------
const plan = [];
const S = (...p) => path.join(STORE, ...p);
const rel = (p) => path.relative(STORE, p) || '.';
const exists = (p) => fs.existsSync(p);
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const ls = (p) => { try { return fs.readdirSync(p); } catch { return []; } };

function mkdir(p, why) { if (!exists(p)) plan.push({ kind: 'mkdir', to: p, why }); }
function move(from, to, why) {
  if (!exists(from) || path.resolve(from) === path.resolve(to)) return;
  plan.push({ kind: 'move', from, to, why });
}

// 1) squelette : les deux sources + leur inbox, la sortie finale, les annexes, les coulisses
for (const s of SOURCES) { mkdir(S(s.dir), 'source'); mkdir(S(s.dir, INBOX), 'inbox de la source'); }
mkdir(S(FINAL), 'les ÉPISODES (rendus VLOG agrégés + final validé)');
mkdir(S(JOURS), 'masters de journée — matière du final, jamais purgés');
mkdir(S(TESTS), 'rendus de test datés — rétention N/N-1 (arbo.mjs --purge)');
mkdir(S(ELEMENTS), 'pièces réutilisables (générique de fin, cartons) — jamais purgées');
for (const a of ANNEXES) mkdir(S(a), 'annexe');
for (const k of Object.values(COUL_SUB)) mkdir(S(COUL, k), 'coulisses (masqué)');

// 2) inbox EFFECTIVE de chaque source : la canonique si elle existe, sinon l'ancien emplacement.
//    On trie son contenu AVANT de la déplacer (sinon les chemins du plan seraient périmés au moment
//    du rename du dossier parent → il aurait fallu une 2ᵉ passe).
const effective = SOURCES.map((s) => {
  const canon = S(s.dir, INBOX);
  if (isDir(canon)) return { s, dir: canon, legacy: null };
  const old = s.legacy.map((l) => S(l)).find((p) => isDir(p) && path.resolve(p) !== path.resolve(canon));
  return { s, dir: old || canon, legacy: old };
});

// 3) dans chaque inbox : ce qui n'est pas un rush remonte (rendu) ou part en coulisses (technique)
for (const { s, dir } of effective) {
  for (const f of ls(dir)) {
    if (f.startsWith('.')) continue;                               // .facecam_work reste avec ses rushes
    // TECH d'ABORD : `vlog_chine.edl.json` et `VLOG_….EDL.md` matchent aussi le motif de rendu (/^VLOG_/i)
    // → sans cet ordre, l'EDL remonterait à la racine de la source au lieu d'aller en coulisses.
    if (TECH.test(f)) move(path.join(dir, f), S(COUL, COUL_SUB.tech, f), 'technique → coulisses');
    else if (VIDEO.test(f) && s.render && s.render.test(f)) move(path.join(dir, f), S(s.dest, f), `rendu → ${s.dest}`);
    else if (VIDEO.test(f) && TEST_RENDER.test(f)) move(path.join(dir, f), S(TESTS, f), 'rendu de test → Vidéos finies/Tests');
  }
}

// 4) puis seulement : l'ancien dossier de rushes prend sa place canonique
for (const { s, legacy } of effective) {
  if (!legacy) continue;
  const canon = S(s.dir, INBOX);
  if (!exists(canon) || ls(canon).length === 0) move(legacy, canon, `rushes ${s.dir} : ancien emplacement`);
  else for (const f of ls(legacy)) move(path.join(legacy, f), path.join(canon, f), `rushes ${s.dir} : fusion`);
}

// 5) tri À L'INTÉRIEUR de « Vidéos finies » : l'ÉPISODE reste à la racine (c'est l'objet qu'on
//    regarde et qu'on itère), le master de journée descend dans `Journées/`, le rendu daté dans
//    `Tests/`. Une vidéo qui ne ressemble à aucun des cas = présumée rendu FINAL validé (posé à
//    la main par le monteur) → on n'y touche pas, on la signale seulement. Ce n'est pas une dérive.
const finals = [];
for (const f of ls(S(FINAL))) {
  if (f.startsWith('.') || isDir(S(FINAL, f))) continue;
  if (VLOG_RENDER.test(f)) { finals.push(f); continue; }              // à sa place
  if (ELEMENT.test(f) && VIDEO.test(f)) move(S(FINAL, f), S(ELEMENTS, f), 'élément réutilisable → Éléments/');
  else if (VIDEO.test(f) && /^Montage JOUR /i.test(f)) move(S(FINAL, f), S(JOURS, f), 'master de journée → Journées/');
  else if (TEST_RENDER.test(f)) move(S(FINAL, f), S(TESTS, f), 'rendu de test → Tests/');
  else if (VIDEO.test(f)) finals.push(f);
}
// 5-ter) et l'inverse : un master ou un test égaré dans le mauvais sous-dossier
for (const f of ls(S(TESTS))) {
  if (VIDEO.test(f) && /^Montage JOUR /i.test(f)) move(S(TESTS, f), S(JOURS, f), 'master de journée → Journées/');
  else if (VLOG_RENDER.test(f)) move(S(TESTS, f), S(FINAL, f), 'épisode → racine de Vidéos finies');
}
for (const f of ls(S(JOURS))) {
  if (TEST_RENDER.test(f)) move(S(JOURS, f), S(TESTS, f), 'rendu de test → Tests/');
  else if (VLOG_RENDER.test(f)) move(S(JOURS, f), S(FINAL, f), 'épisode → racine de Vidéos finies');
}

// 5-bis) VIDER LES SOURCES DE TOUT RENDU. C'est la règle du 31/07 : un dossier de rush ne
//    contient que des rushes et son inbox. Épisode → racine, master de journée → Journées/,
//    rendu daté → Tests/. (Avant, les masters de journée vivaient ICI : d'où l'empilement.)
for (const s of SOURCES) {
  for (const f of ls(S(s.dir))) {
    if (f.startsWith('.') || isDir(S(s.dir, f))) continue;
    if (ELEMENT.test(f) && VIDEO.test(f)) move(S(s.dir, f), S(ELEMENTS, f), 'élément réutilisable → Vidéos finies/Éléments');
    else if (VLOG_RENDER.test(f)) move(S(s.dir, f), S(FINAL, f), 'épisode → Vidéos finies');
    else if (VIDEO.test(f) && s.render && s.render.test(f)) move(S(s.dir, f), S(s.dest, f), 'master de journée → Vidéos finies/Journées');
    else if (VIDEO.test(f) && TEST_RENDER.test(f)) move(S(s.dir, f), S(TESTS, f), 'rendu de test → Vidéos finies/Tests');
  }
}

// 6) technique éparpillée à la racine du store ou d'une source + backups de config
for (const dir of [STORE, ...SOURCES.map((s) => S(s.dir))]) {
  for (const f of ls(dir)) {
    const p = path.join(dir, f);
    if (isDir(p) || f.startsWith('.')) continue;
    if (TECH.test(f)) move(p, S(COUL, COUL_SUB.tech, f), 'technique → coulisses');
  }
}
for (const f of ls(S('Réglages'))) {
  if (BACKUP.test(f)) move(S('Réglages', f), S(COUL, COUL_SUB.backups, f), 'backup de config → coulisses');
}

// ---- sortie -------------------------------------------------------------------------------------
console.log(`store : ${STORE}`);
if (!plan.length) console.log('✅ arborescence CONFORME (rien à faire)');
else {
  console.log(`${APPLY ? 'APPLIQUE' : 'PLAN (dry-run — relancer avec --apply)'} : ${plan.length} opération(s)`);
  for (const op of plan) {
    console.log(op.kind === 'mkdir'
      ? `  + mkdir  ${rel(op.to)}/                     (${op.why})`
      : `  → mv     ${rel(op.from)}\n           ↳ ${rel(op.to)}   (${op.why})`);
  }
}
if (finals.length) {
  console.log(`\nℹ « ${FINAL} » contient ${finals.length} vidéo(s) d'épisode — laissées en place :`);
  finals.forEach((f) => console.log(`   · ${f}   ${VLOG_RENDER.test(f) ? '(rendu VLOG agrégé)' : '(présumée FINALE validée ; si ce n\'en est pas une, la ranger à la main)'}`));
}

// contrôle de cohérence moteur : les constantes de chemin suivent-elles la spec ?
if (iStore < 0) {
  const ENGINE = process.env.MONTAGE_HOME || path.dirname(fileURLToPath(import.meta.url));
  const legacy = [];
  // (arbo.mjs s'exclut : c'est LUI qui porte la spec, ses littéraux ne sont pas une dérive)
  for (const f of ls(ENGINE).filter((x) => /\.(mjs|sh)$/.test(x) && !/\.bak/.test(x) && x !== 'arbo.mjs' && x !== 'store.mjs')) {
    let src = ''; try { src = fs.readFileSync(path.join(ENGINE, f), 'utf8'); } catch { continue; }
    // un script qui FABRIQUE un chemin de rendu au lieu de l'importer de store.mjs = la dérive
    // qui a produit l'empilement du 31/07 : sept littéraux, une seule modif oubliée suffit.
    const fabrique = /join\([^)]*['"`](Landscape Rush|Facecam Rush|Vidéos finies)/.test(src)
      || /['"`]Landscape Rush\/Déposer/.test(src);
    if (fabrique && !/from '\.\/store\.mjs'/.test(src)) legacy.push(f);
  }
  if (legacy.length) {
    console.log(`\n⚠ moteur DÉSALIGNÉ — ces scripts fabriquent un chemin de store au lieu de l'importer : ${legacy.join(', ')}`);
    console.log('   Les chemins vivent dans store.mjs (TESTS / JOURS / FINAL / INBOX). Un dossier de rush ne contient que des rushes.');
  }
}

if (APPLY) {
  for (const op of plan) {
    if (op.kind === 'mkdir') { fs.mkdirSync(op.to, { recursive: true }); continue; }
    fs.mkdirSync(path.dirname(op.to), { recursive: true });
    // la cible peut être le dossier vide qu'on vient de créer à l'étape 1 → on l'ôte avant le rename
    if (isDir(op.to) && ls(op.to).length === 0) fs.rmdirSync(op.to);
    fs.renameSync(op.from, op.to);
  }
  console.log(`\n✅ appliqué (${plan.length} opération(s)) — aucune suppression, uniquement mkdir/mv`);
}
// ---- RÉTENTION (--purge) : ce qui empêche l'empilement de revenir --------------------------------
// On ne supprime pas : on met à la CORBEILLE (osascript → Finder), donc c'est réversible tant que
// le monteur ne la vide pas. `Journées/` n'est jamais touché : c'est la matière du final.
function toTrash(files) {
  if (!files.length) return;
  const items = files.map((p) => `POSIX file ${JSON.stringify(p)}`).join(', ');
  execFileSync('osascript', ['-e', `tell application "Finder" to delete {${items}}`]);
}
// `vlog/work` vit dans le MOTEUR, pas dans le store — c'est précisément pourquoi arbo l'ignorait.
const WORK = path.join(path.dirname(fileURLToPath(import.meta.url)), 'vlog', 'work');
// La taille d'un DOSSIER n'est pas dans son `stat` : sans ça le bilan en Go annoncerait 0 pour
// `norm/` (7,2 Go) et le dry-run mentirait sur ce qu'il s'apprête à faire.
function poids(p) {
  const st = fs.statSync(p);
  if (!st.isDirectory()) return st.size;
  let t = 0;
  for (const f of fs.readdirSync(p)) { try { t += poids(path.join(p, f)); } catch { /* lien mort */ } }
  return t;
}
function byRecent(dir, re) {
  return ls(dir).filter((f) => !f.startsWith('.') && VIDEO.test(f) && (!re || re.test(f)))
    .map((f) => ({ f, p: path.join(dir, f), m: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
}

// ⭐ UNE DÉFINITION DÉDUITE D'UN NOM N'EST PAS UNE DÉFINITION (01/09). `fusion.mjs` sort les
// masters facecam 4K sous le nom `VLOG_<Ville>_facecam_v9.mp4`, SANS suffixe `_4K` (il résout
// `VLOG_<Sujet>_facecam_v<N>.mp4` et n'accepte pas de suffixe) : ils tombaient donc dans la
// lignée **1080p** et érodaient le N/N-1 des vrais 1080p. Même famille que « un identifiant
// dérivé d'un ordre n'est pas un identifiant » — la définition se LIT dans le fichier, le nom
// n'est qu'un repli quand la mesure échoue. Et le repli **se dit** : un garde-fou silencieux est
// indiscernable d'un garde-fou débranché.
const _defCache = new Map();
let _defReplis = 0;
function defReelle(p, replinom) {
  if (_defCache.has(p)) return _defCache.get(p);
  let d = null;
  try {
    const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=width', '-of', 'default=nw=1:nk=1', p], { encoding: 'utf8' });
    const w = parseInt(String(out).trim().split('\n')[0], 10);
    if (Number.isFinite(w) && w > 0) d = w >= 2560 ? '4k' : '1080';
  } catch { /* ffprobe absent du PATH, ou fichier illisible */ }
  if (!d) { d = replinom; _defReplis++; }
  _defCache.set(p, d);
  return d;
}
function ditLesReplis() {
  if (_defReplis) console.log(`\n⚠️  définition NON mesurée pour ${_defReplis} fichier(s) (ffprobe injoignable) : lignées déduites du NOM, donc un rendu 4K sans suffixe retombe dans la lignée 1080p. Relancer avec ffprobe dans le PATH.`);
}
if (PURGE || PURGE_JOURS) {
  const lots = [
    // filtré sur TEST_RENDER : un élément réutilisable rangé par erreur ici ne doit pas
    // disparaître parce qu'il est vieux. La rétention ne mord que sur les rendus DATÉS.
    { quoi: `rendus de test (${rel(S(TESTS))})`, l: byRecent(S(TESTS), TEST_RENDER) },
    // ⚠️ ÉPISODES : lignée = **ÉPISODE × DÉFINITION**, exactement pour la raison écrite juste en
    // dessous pour le facecam — et le pool global a mordu pour de vrai le 30/08. Au rendu du
    // « VLOG Chine 02 », les trois fichiers en présence étaient « Chine 01 (master 31-07) »,
    // « Chine 01 (master 4K 31-07) » et le 02 tout neuf : un N/N-1 global garde les 2 plus
    // RÉCENTS et a mis à la corbeille le **master 1080p de l'épisode 01**, un livrable fini.
    // Deux épisodes différents ne se remplacent pas l'un l'autre, pas plus qu'un 1080p et un 4K :
    // ce qui borne une rétention, c'est ce qui rend deux fichiers CONCURRENTS, jamais la date.
    //
    // ⭐⭐ ET L'ÉTAGE N'EST PAS UNE GÉNÉRATION (20/09). Le nu, le sous-titré et le
    // sous-titré + générique sont trois ÉTAGES du MÊME livrable, pas trois versions
    // successives : chacun se fabrique À PARTIR du précédent, donc aucun ne remplace
    // l'autre. Comptés dans une seule lignée, chaque étage ajouté POUSSAIT un vrai
    // livrable dehors — et le 20/09 la purge désignait très exactement les deux masters
    // que le monteur avait nommément protégés, parce qu'ils étaient les plus ANCIENS de quatre.
    // `masters-proteges.txt` empêchait le dégât ; il ne corrigeait pas la définition.
    // Même réflexe que 4K vs 1080 et que SUJET pour le facecam : ce qui borne une
    // rétention, c'est ce qui rend deux fichiers CONCURRENTS. Deux fichiers ne sont
    // concurrents que s'ils sont au MÊME étage — alors seule la date les départage.
    ...(() => {
      const tous = byRecent(S(FINAL), VLOG_RENDER);
      const parLignee = new Map();
      for (const x of tous) {
        //  « VLOG Chine 01 (master 4K 31-07).mp4 » → série « VLOG Chine 01 », définition « 4k »
        const m = x.f.match(/^(VLOG .+?)\s*\((.*)\)\.[^.]+$/i);
        const serie = m ? m[1].trim() : x.f.replace(/\.[^.]+$/, '');
        const dans = m ? m[2] : '';
        const def = defReelle(x.p, /\b4k\b/i.test(dans) ? '4k' : '1080');
        // L'ÉTAGE = ce que dit le parenthésé une fois retirés la DATE (= la génération,
        // le seul axe sur lequel deux fichiers se remplacent) et la DÉFINITION (qui borne
        // déjà la lignée à côté). Ce qui reste nomme le PRODUIT : « master »,
        // « master sous-titré », « master sous-titré + générique », « merge + générique »…
        // Un master sans date (« master final 4K ») garde l'étage « master final » et se
        // départage alors sur la mtime, ce qui est exactement la règle N/N-1.
        const etage = dans
          .replace(/\b\d{2}-\d{2}\b/g, ' ')
          .replace(/\b4k\b/gi, ' ')
          .replace(/\s*\+\s*/g, ' + ')
          .replace(/\s+/g, ' ').trim().toLowerCase() || 'master';
        const cle = `${serie}\u0000${def}\u0000${etage}`;
        if (!parLignee.has(cle)) parLignee.set(cle, { serie, def, etage, l: [] });
        parLignee.get(cle).l.push(x);
      }
      return [...parLignee.values()].map(({ serie, def, etage, l }) => ({
        quoi: `épisodes ${serie} ${def === '4k' ? '4K' : '1080p'} — étage « ${etage} » (${rel(S(FINAL))})`,
        l,
      }));
    })(),
    // ⚠️ La rétention des masters facecam est PAR LIGNÉE, et une lignée = **SUJET × DÉFINITION**.
    //
    // Définition (31/07) : depuis le master 4K, `VLOG_…_v11.mp4` et `VLOG_…_v11_4K.mp4` coexistent ;
    // un N/N-1 global garderait les deux fichiers 4K (les plus récents) et jetterait la paire 1080p,
    // c'est-à-dire la SOURCE du master 1080p qui sert encore de référence.
    //
    // ⭐ SUJET (02/08) : depuis « une ville = un rendu », il n'y a plus UN master facecam par version
    // mais SIX (`VLOG_Xiamen_…`, `VLOG_HongKong_…`, …). Groupés ensemble, les 6 v3 fraîchement rendus
    // se retrouvaient dans un seul pool de 20 fichiers et le N/N-1 gardait **les 2 fichiers les plus
    // récents, point** — donc `--purge --apply` aurait mis QUATRE des six livrables du jour à la
    // corbeille. Le bug n'était pas dans le tri, il était dans la définition de la lignée : le jour
    // où un artefact se met à exister en N exemplaires PARALLÈLES, une rétention « les 2 plus
    // récents » cesse de vouloir dire « N et N-1 » et se met à vouloir dire « les 2 derniers finis ».
    // Réflexe : ce qui borne une rétention, c'est ce qui rend deux fichiers CONCURRENTS — ici le
    // sujet et la définition, jamais la seule date.
    ...(() => {
      const tous = byRecent(S('Facecam Rush'), FACECAM_MASTER);
      const parLignee = {};
      for (const x of tous) {
        const m = x.f.match(/^VLOG_(.+?)_v\d+(?:_(\w+))?\.[^.]+$/i);
        const sujet = (m ? m[1] : x.f).replace(/_facecam$/i, '');   // « HongKong », « Chine », …
        const def = defReelle(x.p, (m && m[2] ? m[2] : '1080').toLowerCase());
        (parLignee[`${sujet}\0${def}`] ||= []).push(x);
      }
      return Object.entries(parLignee).map(([k, l]) => {
        const [sujet, d] = k.split('\0');
        return { quoi: `masters facecam ${sujet} ${d === '1080' ? '1080p' : d.toUpperCase()} (${rel(S('Facecam Rush'))})`, l };
      });
    })(),
    // Journées/ : n'entre dans la purge QUE sur --purge-journees. Lignée = le JOUR — deux masters
    // ne sont concurrents que s'ils racontent la MÊME journée ; « 22-07 (bornes) » et « 27-07
    // (coupes) » ne se remplacent pas l'un l'autre. (Leçon du 02/08 sur les lignées facecam.)
    ...(PURGE_JOURS ? (() => {
      const parJour = {};
      for (const x of byRecent(S(JOURS), /^Montage JOUR /i)) {
        const m = x.f.match(/^Montage JOUR\s+(\S+)/i);
        (parJour[m ? m[1] : x.f] ||= []).push(x);
      }
      return Object.entries(parJour)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([jour, l]) => ({ quoi: `masters de journée ${jour} (${rel(S(JOURS))})`, l }));
    })() : []),
    // ⭐ RÉTENTION PAR NATURE, ET DANS LE MOTEUR (01/09). `vlog/work` pesait **20 Go** et AUCUN
    // outil ne le purgeait : `arbo.mjs` ne connaissait que le STORE. C'est exactement le motif déjà
    // payé deux fois ici — *une règle qui dépend de ma discipline plutôt que d'un outil finira
    // violée* — sauf qu'ici il n'y avait même pas de règle, juste un dossier qui grossit.
    //
    // Ces intermédiaires ne se classent PAS en N/N-1 : il n'y a pas de générations concurrentes,
    // il y a des natures. Certains se refabriquent en une commande, d'autres sont des RÉFÉRENCES
    // (`_raw_a.m4a` sert d'étalon à `gate.py`). D'où une **liste blanche de ce qu'on jette**,
    // jamais une liste noire de ce qu'on garde : le jour où un artefact neuf apparaît dans ce
    // dossier, il doit être GARDÉ par défaut, pas jeté par oubli.
    ...(() => {
      if (!fs.existsSync(WORK)) return [];
      // ⚠️ ffmpeg vivant = une chaîne EN COURS : ces fichiers sont sa matière, on ne touche à rien.
      // (Le garde ne peut pas viser `vlog.mjs` lui-même : c'est LUI qui nous appelle en dernier geste.)
      let occupe = false;
      try { occupe = !!execFileSync('pgrep', ['-x', 'ffmpeg'], { encoding: 'utf8' }).trim(); } catch { /* pgrep sort 1 si rien */ }
      if (occupe) { console.log(`\n· intermédiaires ${rel(WORK)} : un ffmpeg TOURNE — lot sauté (sa matière est en cours d'usage)`); return []; }
      const jetables = ['norm', '_raw_v.mp4', 'fusion'];   // refabricables ; `_raw_a.m4a` NE L'EST PAS (étalon gate.py)
      const l = jetables.map((f) => ({ f, p: path.join(WORK, f) })).filter((x) => fs.existsSync(x.p))
        .map((x) => ({ ...x, m: 0, o: poids(x.p) }));
      return l.length ? [{ quoi: `intermédiaires refabricables de ${rel(WORK)}`, l, garde: 0 }] : [];
    })(),
  ];
  // ⛡ MASTERS PROTÉGÉS — lus dans `masters-proteges.txt` (dépôt, donc versionné et
  // transportable). Ce garde existe parce que les deux masters prouvés de l'EP3 étaient à UN
  // RENDU de la corbeille : la lignée 1080 comptait 4 fichiers (nu · sous-titré · sous-titré +
  // générique · le master de la veille), la rétention garde les 2 plus RÉCENTS, donc elle
  // désignait pile les deux plus ANCIENS — ceux que le monteur avait nommément protégés. Et
  // `purgeApresRendu()` lance `--apply --purge`, le balayage GLOBAL, en dernier geste de
  // monte/vlog/facecam-render : le défaut ne se serait pas vu venir.
  // ⚠️ Le nu, le sous-titré et le sous-titré+générique ne sont pas trois GÉNÉRATIONS mais trois
  // ÉTAGES du même livrable. Ce garde n'y change rien — il empêche seulement que la définition
  // coûte un master. *Corriger le symptôme en le disant reste mieux que le corriger en silence.*
  // ⚠️ La liste se lit SANS filet : un `catch` muet rendrait un Set vide, donc un garde
  // DÉSARMÉ qui imprimerait « 0 épargné » exactement comme un garde qui n'a rien à épargner.
  // Fichier absent = aucune protection déclarée, et on le DIT. Fichier illisible = on plante,
  // parce qu'on ne jette pas 1,1 Go sur une liste qu'on n'a pas réussi à lire.
  const LISTE = path.join(process.env.MONTAGE_HOME || path.dirname(fileURLToPath(import.meta.url)),
    'masters-proteges.txt');
  let PROTEGES;
  if (!fs.existsSync(LISTE)) {
    console.log(`   ⛡ aucune liste de protection (${path.basename(LISTE)} absent)`);
    PROTEGES = new Set();
  } else {
    PROTEGES = new Set(fs.readFileSync(LISTE, 'utf8')
      .split('\n').map((x) => x.trim()).filter((x) => x && !x.startsWith('#')));
  }
  let n = 0, octets = 0, nProteges = 0;
  for (const { quoi, l, garde } of lots) {
    // `garde` (0 par défaut hérité de KEEP) : un lot de NATURE n'a pas de génération à conserver.
    const k = garde ?? KEEP;
    const vieux = l.slice(k);
    console.log(`\n· ${quoi} : ${l.length} fichier(s), on garde les ${Math.min(k, l.length)} plus récent(s)`);
    for (const x of l.slice(0, k)) console.log(`   ✓ gardé    ${x.f}`);
    const jetables = [];
    for (const x of vieux) {
      if (PROTEGES.has(x.f)) {
        nProteges++;
        console.log(`   ⛡ PROTÉGÉ  ${x.f}   (masters-proteges.txt — jamais jeté)`);
        continue;
      }
      const o = x.o ?? poids(x.p); octets += o; n++;
      jetables.push(x.p);
      console.log(`   → corbeille ${x.f}   (${(o / 1e6).toFixed(0)} Mo)`);
    }
    if (APPLY) toTrash(jetables);
  }
  console.log(`\n${APPLY ? '✅ ' + n + ' fichier(s) à la corbeille' : 'PURGE (dry-run — ajouter --apply)'}`
    + ` — ${(octets / 1e9).toFixed(2)} Go` + (APPLY ? ' récupérables tant que la corbeille n\'est pas vidée' : ''));
  // Un garde silencieux est indiscernable d'un garde débranché : il parle même à zéro.
  console.log(`   ⛡ ${nProteges} fichier(s) épargné(s) par masters-proteges.txt`);
  ditLesReplis();
  console.log(PURGE_JOURS
    ? `   « ${rel(S(JOURS))} » PURGÉ sur demande explicite (--purge-journees), rétention N/N-1 par JOUR.`
    : `   « ${rel(S(JOURS))} » n'est jamais purgé (matière du final) — --purge-journees pour l'ouvrir.`);
}


if (CHECK) process.exit(plan.length ? 1 : 0);   // une vidéo finale présente n'est PAS une dérive
