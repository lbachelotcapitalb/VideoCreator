#!/usr/bin/env node
// ============================================================================
// capacites.mjs — LE MANIFESTE DES COMPÉTENCES, et sa garde.
//
//   node capacites.mjs                → la liste lisible (« qu'est-ce que je sais faire ? »)
//   node capacites.mjs --chaine A     → une seule chaîne
//   node capacites.mjs --json         → le manifeste enrichi (prérequis MESURÉS) → Bande de montage
//   node capacites.mjs --skill        → RÉÉCRIT la table de routage de SKILL.md entre les balises
//   node capacites.mjs --skill --check→ sortie 1 si la table de SKILL.md a dérivé du manifeste
//   node capacites.mjs --check        → la garde (voir plus bas). Sortie 1 si défaut.
//   node capacites.mjs --self-test    → CONTRÔLE POSITIF : casse le manifeste en mémoire et
//                                       vérifie que --check le VOIT. Un check qui ne sait pas
//                                       voir un défaut n'est pas une preuve d'absence de défaut.
//
// POURQUOI CE FICHIER (10/09). Trois endroits disaient ce que la stack sait faire — la table de
// routage du SKILL, ce que la Bande de montage affiche, et ce que je réponds de mémoire. Trois
// listes tenues à la main dérivent, et la plus vieille ment sans prévenir. Ici : UNE source, trois
// rendus GÉNÉRÉS. Et une doctrine qu'aucun code ne charge ne protège de rien — d'où la garde.
// 100 % local, zéro dépendance.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const MANIFESTE = path.join(ROOT, 'capacites.json');
const SKILL = path.join(ROOT, 'SKILL.md');
const BALISE_DEB = '<!-- CAPACITES:TABLE -->';
const BALISE_FIN = '<!-- /CAPACITES:TABLE -->';

const BINAIRES = ['ffmpeg', 'ffprobe', 'whisper-cli', 'aubioonset', 'aubiotrack', 'aubiopitch'];

export function charger() { return JSON.parse(fs.readFileSync(MANIFESTE, 'utf8')); }

// Retire les commentaires — ligne entière ET fin de ligne. Sans la seconde, un « import X; // voir
// monte.mjs » fabriquait une dépendance d'exécution qui n'existe pas.
function sansCommentaires(src) {
  return src.split('\n')
    .map((l) => l.replace(/(^|\s)(\/\/|#).*$/, '$1'))
    .filter((l) => l.trim())
    .join('\n');
}

// ---- résolution des imports locaux (une chaîne, c'est aussi ce qu'elle importe) -----------
function importsLocaux(rel, vus = new Set()) {
  const abs = path.join(ROOT, rel);
  if (vus.has(rel) || !fs.existsSync(abs)) return vus;
  vus.add(rel);
  if (!rel.endsWith('.mjs')) return vus;   // un .py est SCANNÉ, mais on ne suit pas ses imports
  const src = fs.readFileSync(abs, 'utf8');
  for (const m of src.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
    const cible = path.relative(ROOT, path.resolve(path.dirname(abs), m[1]));
    importsLocaux(cible, vus);
  }
  // ⚠️ une chaîne, ce n'est pas seulement ce qu'elle IMPORTE : plusieurs outils LANCENT un autre
  // script du dépôt en sous-processus (revlog → monte, subs-blocs → subs). Sans cette passe, leurs
  // prérequis mesurés tombaient à zéro et le manifeste promettait une chaîne sans ffmpeg.
  const code = sansCommentaires(src);
  for (const f of scriptsDuDepot()) {
    if (f === rel || !/\.(mjs|py)$/.test(f)) continue;
    // Une simple MENTION du nom ne prouve rien (un message d'aide cite « monte.mjs » sans le lancer) :
    // on n'accepte le maillon que s'il est cité dans un APPEL (spawn/exec/fork/'node'/python3). Un
    // simple « node monte.mjs » dans un message d'aide ne compte pas : c'est ce qui faisait hériter
    // brief.mjs — dont l'en-tête dit « zéro ffmpeg » — de whisper-cli et d'aubio.
    const base = path.basename(f).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(spawn\\w*|exec\\w*|fork|['"\`]node['"\`]|python3|\\.venv-vision)[^\\n]{0,200}?${base}`, 's');
    if (re.test(code)) importsLocaux(f, vus);
  }
  return vus;
}

// ---- quels binaires un fichier invoque VRAIMENT (commentaires retirés) -------------------
// LIMITE ASSUMÉE : la mesure est au niveau du FICHIER. Importer un module qui appelle ffmpeg
// quelque part suffit à déclarer ffmpeg, même si la fonction concernée n'est jamais appelée
// (etat.mjs importe store.mjs pour un chemin, et hérite de la purge qui, elle, lance arbo).
// Conservateur par construction : mieux vaut annoncer un prérequis de trop qu'un de moins —
// une compétence annoncée prête qui ne l'est pas ment au milieu d'un rendu.
function binairesInvoques(rel) {
  // Ce fichier-ci NOMME les binaires (la constante BINAIRES) sans en invoquer aucun. Le scanner
  // ne sait pas distinguer nommer d'appeler : sans cette exclusion, tout script qui importe le
  // manifeste (la Bande de montage depuis le 10/09) héritait des six binaires de la liste.
  if (rel === 'capacites.mjs') return new Set();
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return new Set();
  return new Set(BINAIRES.filter((b) => sansCommentaires(fs.readFileSync(abs, 'utf8')).includes(b)));
}

export function binairesDeLaChaine(cap) {
  const out = new Set();
  for (const s of cap.scripts) for (const f of importsLocaux(s)) for (const b of binairesInvoques(f)) out.add(b);
  return out;
}

// ---- tous les scripts du dépôt, hors sauvegardes ------------------------------------------
// git d'abord (il connaît le suivi), le disque en repli. Le repli n'est PAS un luxe : sur une
// copie téléchargée en zip, git échoue — et la version d'avant rendait alors une liste VIDE,
// donc « 0 script, tous référencés ✅ ». Un total nul annoncé comme un succès est le pire des
// verdicts : il valide un dépôt qu'on n'a pas regardé.
let _cacheScripts = null;
let _sourceScripts = 'inconnue';
function scriptsDuDepot() {
  if (_cacheScripts) return _cacheScripts;
  try {
    _cacheScripts = execFileSync('git', ['ls-files', '*.mjs', '*.py'],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n').filter(Boolean);
    _sourceScripts = 'git';
    // git peut RÉUSSIR et ne rien rendre : un dossier ignoré (.public/) à l'intérieur d'un dépôt
    // répond « 0 fichier suivi » alors qu'il en porte 70. Un inventaire vide dans un dossier
    // plein est un signal, pas un résultat — on repasse par le disque.
    if (_cacheScripts.length === 0) throw new Error('inventaire git vide');
  } catch {
    _cacheScripts = [];
    const marcher = (d, base = '') => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const rel = base ? `${base}/${e.name}` : e.name;
        if (/^(node_modules|\.git|\.venv.*|models|cache|work|projects)$/.test(e.name)) continue;
        if (e.isDirectory()) marcher(path.join(d, e.name), rel);
        else if (/\.(mjs|py)$/.test(e.name)) _cacheScripts.push(rel);
      }
    };
    marcher(ROOT);
    _sourceScripts = 'disque';
  }
  _cacheScripts = _cacheScripts.filter((f) => !f.includes('.bak') && !f.includes('node_modules') && !f.startsWith('.venv'));
  return _cacheScripts;
}
export function sourceScripts() { scriptsDuDepot(); return _sourceScripts; }

// ═══════════════════════════════════════════════════════════════════════════
// LA GARDE
// ═══════════════════════════════════════════════════════════════════════════
export function verifier(man) {
  const defauts = [];
  const avert = [];
  const ids = new Set();

  for (const c of man.capacites) {
    const ou = `capacité « ${c.id} »`;
    if (ids.has(c.id)) defauts.push(`${ou} : identifiant en double`);
    ids.add(c.id);
    if (!man.chaines[c.chaine]) defauts.push(`${ou} : chaîne « ${c.chaine} » inconnue`);
    for (const champ of ['titre', 'resume', 'cmd', 'entree', 'sortie', 'statut']) {
      if (!c[champ]) defauts.push(`${ou} : champ « ${champ} » vide`);
    }
    if (!c.declencheurs?.length) defauts.push(`${ou} : aucun déclencheur`);
    if (!c.scripts?.length) defauts.push(`${ou} : aucun script`);

    for (const s of c.scripts || []) {
      if (!fs.existsSync(path.join(ROOT, s))) defauts.push(`${ou} : le script « ${s} » n'existe pas`);
    }
    if (c.doc && !fs.existsSync(path.join(ROOT, c.doc))) defauts.push(`${ou} : le doc « ${c.doc} » n'existe pas`);

    // le premier mot exécutable de `cmd` doit exister (node X / python3 X / venv X)
    const cible = (c.cmd || '').match(/(?:^|\s)((?:facecam\/|\.venv-vision\/)?[\w./-]+\.(?:mjs|py))/);
    if (cible && !fs.existsSync(path.join(ROOT, cible[1]))) {
      defauts.push(`${ou} : la commande pointe vers « ${cible[1] }», absent du dépôt`);
    }

    // contrôle croisé des prérequis : déclaré ⟷ réellement invoqué dans la chaîne
    const reels = binairesDeLaChaine(c);
    for (const b of reels) {
      if (!(c.bin || []).includes(b)) defauts.push(`${ou} : « ${b} » est invoqué par la chaîne mais n'est pas déclaré dans bin[]`);
    }
    for (const b of (c.bin || [])) {
      if (!reels.has(b)) avert.push(`${ou} : « ${b} » déclaré mais introuvable dans le source (appel indirect ?)`);
    }
  }

  // aucun script du dépôt ne doit être orphelin
  const references = new Set(man.internes || []);
  for (const c of man.capacites) for (const s of c.scripts || []) references.add(s);
  for (const f of scriptsDuDepot()) {
    if (!references.has(f)) defauts.push(`script orphelin : « ${f} » n'est référencé par aucune capacité et n'est pas déclaré interne`);
  }
  for (const i of (man.internes || [])) {
    if (!fs.existsSync(path.join(ROOT, i))) defauts.push(`interne « ${i} » : le fichier n'existe pas`);
  }

  return { defauts, avert };
}

// ═══════════════════════════════════════════════════════════════════════════
// LE CONTRÔLE POSITIF — un check qui ne sait pas VOIR un défaut ne prouve rien
// ═══════════════════════════════════════════════════════════════════════════
function selfTest() {
  const base = charger();
  const cas = [
    ['script fantôme', (m) => { m.capacites[0].scripts.push('facecam/nexiste-pas.mjs'); }],
    ['doc fantôme', (m) => { m.capacites[0].doc = 'DOC-QUI-NEXISTE-PAS.md'; }],
    ['identifiant en double', (m) => { m.capacites.push({ ...m.capacites[0] }); }],
    ['chaîne inconnue', (m) => { m.capacites[0].chaine = 'Z'; }],
    ['champ vide', (m) => { m.capacites[0].resume = ''; }],
    ['prérequis non déclaré', (m) => { m.capacites.find((c) => c.id === 'facecam-rendu').bin = []; }],
    ['script orphelin', (m) => { m.internes = (m.internes || []).filter((i) => i !== 'store.mjs');
                                 for (const c of m.capacites) c.scripts = c.scripts.filter((s) => s !== 'store.mjs'); }],
  ];
  const socle = new Set(verifier(base).defauts);
  let ko = 0;
  console.log('CONTRÔLE POSITIF — chaque défaut injecté doit être VU :\n');
  for (const [nom, casser] of cas) {
    const m = JSON.parse(JSON.stringify(base));
    casser(m);
    const { defauts } = verifier(m);
    // ⚠️ un défaut PRÉEXISTANT ferait passer n'importe quel cas pour « vu » : on n'accepte que
    // les défauts NOUVEAUX, apparus à cause de l'injection.
    const nouveaux = defauts.filter((d) => !socle.has(d));
    const vu = nouveaux.length > 0;
    if (!vu) ko++;
    console.log(`  ${vu ? '✅ vu   ' : '❌ AVEUGLE'}  ${nom}${vu ? `  → « ${nouveaux[0].slice(0, 66)}… »` : ''}`);
  }
  const sain = verifier(base).defauts.length === 0;
  console.log(`\n  ${sain ? '✅' : '❌'} contrôle négatif : le manifeste intact passe`);
  if (!sain) ko++;
  console.log(ko === 0 ? '\n✅ la garde sait voir les 7 défauts, et ne crie pas sur un manifeste sain.'
                       : `\n❌ ${ko} cas non détectés — la garde est partiellement aveugle.`);
  return ko === 0 ? 0 : 1;
}

// ═══════════════════════════════════════════════════════════════════════════
// RENDUS
// ═══════════════════════════════════════════════════════════════════════════
function dispo(bin) {
  try { execFileSync('which', [bin], { stdio: 'ignore' }); return true; } catch { return false; }
}

function enrichi(man) {
  const cache = new Map();
  const test = (b) => { if (!cache.has(b)) cache.set(b, dispo(b)); return cache.get(b); };
  const venv = fs.existsSync(path.join(ROOT, '.venv-vision/bin/python'));
  return {
    ...man,
    capacites: man.capacites.map((c) => {
      const manquants = (c.bin || []).filter((b) => !test(b));
      if ((c.py || []).length && !venv) manquants.push('environnement python vision');
      return { ...c, pret: manquants.length === 0, manquants };
    }),
  };
}

function texte(man, filtre) {
  const e = enrichi(man);
  const out = [];
  for (const [cle, ch] of Object.entries(man.chaines)) {
    if (filtre && filtre !== cle) continue;
    const caps = e.capacites.filter((c) => c.chaine === cle);
    if (!caps.length) continue;
    out.push(`\n━━ ${cle} · ${ch.titre.toUpperCase()} — ${ch.sous_titre}`);
    for (const c of caps) {
      const marque = c.pret ? (c.vedette ? '★' : '·') : '⚠';
      out.push(`  ${marque} ${c.titre}`);
      out.push(`      ${c.cmd}`);
      out.push(`      dis-le comme ça : « ${c.declencheurs.slice(0, 3).join(' » · « ')} »`);
      if (!c.pret) out.push(`      ⚠ manque : ${c.manquants.join(', ')}`);
    }
  }
  const prets = e.capacites.filter((c) => c.pret).length;
  out.push(`\n${prets}/${e.capacites.length} compétences prêtes sur cette machine  ·  ★ = entrée principale d'une chaîne`);
  return out.join('\n');
}

function tableSkill(man) {
  const l = [BALISE_DEB, '', '<!-- GÉNÉRÉ par `node capacites.mjs --skill` depuis capacites.json — NE PAS ÉDITER À LA MAIN -->', ''];
  for (const [cle, ch] of Object.entries(man.chaines)) {
    const caps = man.capacites.filter((c) => c.chaine === cle);
    if (!caps.length) continue;
    l.push(`### ${cle} · ${ch.titre} — ${ch.sous_titre}`, '');
    l.push('| le monteur dit… | Tu lances | Ce que ça rend | Doc |');
    l.push('|---|---|---|---|');
    for (const c of caps) {
      const dec = c.declencheurs.slice(0, 3).map((d) => `« ${d} »`).join(' · ');
      const gate = c.gate ? ` 🛑 ${c.gate.split('—')[0].trim()}` : '';
      l.push(`| ${dec} | \`${c.cmd}\`${gate} | ${c.sortie} | ${c.doc || '—'} |`);
    }
    l.push('');
  }
  l.push(BALISE_FIN);
  return l.join('\n');
}

function ecrireSkill(man, seulementVerifier) {
  const src = fs.readFileSync(SKILL, 'utf8');
  const i = src.indexOf(BALISE_DEB); const j = src.indexOf(BALISE_FIN);
  if (i < 0 || j < 0) {
    console.error(`❌ balises absentes de SKILL.md. Poser ${BALISE_DEB} et ${BALISE_FIN} à l'endroit voulu.`);
    return 1;
  }
  const neuf = src.slice(0, i) + tableSkill(man) + src.slice(j + BALISE_FIN.length);
  if (seulementVerifier) {
    const ok = neuf === src;
    console.log(ok ? '✅ la table de routage de SKILL.md est à jour.'
                   : '❌ la table de routage de SKILL.md a DÉRIVÉ du manifeste → `node capacites.mjs --skill`');
    return ok ? 0 : 1;
  }
  fs.writeFileSync(SKILL, neuf);
  console.log(`✅ table de routage régénérée dans SKILL.md (${man.capacites.length} compétences).`);
  return 0;
}

// ═══════════════════════════════════════════════════════════════════════════
const args = process.argv.slice(2);
// ⚠️ le dépôt vit sous « Application Support » : l'URL est ENCODÉE (%20) alors que argv[1] ne l'est
// pas. Comparer les deux en l'état rendait ce bloc mort — le script se lançait et n'imprimait RIEN.
// Lancé directement, ou seulement importé ? Comparer les chemins BRUTS ne suffit pas : l'URL du
// module est encodée (%20 sous « Application Support ») et /tmp est un lien vers /private/tmp.
// Les deux pièges ont rendu ce bloc MUET — le script tournait et n'imprimait rien.
const lanceDirectement = (() => {
  try {
    return fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(process.argv[1] || '');
  } catch { return false; }
})();
if (lanceDirectement) {
  const man = charger();
  let code = 0;
  if (args.includes('--self-test')) code = selfTest();
  else if (args.includes('--skill')) code = ecrireSkill(man, args.includes('--check'));
  else if (args.includes('--check')) {
    const { defauts, avert } = verifier(man);
    for (const a of avert) console.log(`⚠️  ${a}`);
    for (const d of defauts) console.log(`❌ ${d}`);
    const n = scriptsDuDepot().length;
    if (defauts.length) console.log(`\n❌ ${defauts.length} défaut(s).`);
    else if (n === 0) console.log('⚠️  manifeste sans défaut, mais AUCUN script inventorié : '
      + 'l\'orphelinat n\'a donc été vérifié sur rien. Ne pas lire ça comme un dépôt sain.');
    else console.log(`✅ manifeste sain : ${man.capacites.length} compétences, ${n} scripts tous référencés `
      + `(inventaire par ${sourceScripts()})${avert.length ? ` — ${avert.length} avertissement(s)` : ''}.`);
    code = defauts.length ? 1 : 0;
  } else if (args.includes('--json')) console.log(JSON.stringify(enrichi(man), null, 2));
  else {
    const i = args.indexOf('--chaine');
    console.log(texte(man, i >= 0 ? args[i + 1] : null));
  }
  process.exit(code);
}
