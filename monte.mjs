#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
//  Montage vidéo autonome — 100% local (whisper.cpp + ffmpeg), hors-ligne.
//  Déclenché par le watcher : dès que des rushes sont déposés et que le dépôt
//  est stable, il transcrit, coupe les temps morts, sélectionne, assemble,
//  sous-titre, exporte la vidéo finie et notifie. le monteur ne fait que déposer.
//
//  Pipeline : rushes → (whisper) transcript → EDL heuristique (offline)
//             → ffmpeg coupe+assemble → (whisper) sous-titres du montage
//             → burn captions → export 1080p → "Landscape Rush" + notif.
// ═══════════════════════════════════════════════════════════════════════════
import { execFileSync, execFileSync as run, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { hiTame, deBloom, adaptiveColor, measurePlate } from './filters.mjs';
import { TESTS, purgeApresRendu } from './store.mjs';   // chemins du store : un seul endroit

const HOME = os.homedir();
// Vrai emplacement des dossiers utilisateur = ~/Movies/Montage (lisible par launchd,
// hors Bureau protégé par TCC). « ~/Desktop/Montage » est un lien vers ici → pour
// l'utilisateur c'est « sur le Bureau », mais le service ne touche jamais au Bureau.
const STORE = path.join(HOME, 'Movies', 'Montage');
const INBOX = path.join(STORE, 'Landscape Rush/Déposer les rushes ici');   // bibliothèque stable : les rushes y RESTENT
// sortie : « Vidéos finies/Tests » — un dossier de RUSH ne contient que des rushes (le monteur 31/07).
// Le chemin vient de store.mjs : le changer ici seulement recréerait la dispersion qu'on vient de payer.
const OUT = TESTS;
// dossier musique résilient au renommage (le monteur 25/07 : « Musique (optionnel) » → « Musiques »)
const MUSIC = ['Musiques', 'Musique (optionnel)'].map((n) => path.join(STORE, n))
  .find((p) => fs.existsSync(p)) || path.join(STORE, 'Musiques');
// dossier de rangement des petits fichiers de réglage → garde le dossier Montage propre
const REGLAGES = path.join(STORE, 'Réglages');
// moteur (script/modèle/logs) dans Application Support = lançable par launchd
const ENGINE = path.join(HOME, 'Library', 'Application Support', 'Montage');
const MODEL = path.join(ENGINE, 'models', 'ggml-small.bin');
const WORK = path.join(ENGINE, 'work');
const LOG = path.join(ENGINE, 'montage.log');
const LOCK = path.join(ENGINE, '.lock');
// ---- cache de segments (rendu incrémental) ----------------------------------
// Chaque plan (rush + ranges + grade + flags + badge + qualité) est encodé UNE fois
// puis réutilisé tel quel aux passages suivants : une retouche sur 5 plans ne re-encode
// que ces 5-là, pas les 34. PERSISTE entre les runs (≠ WORK, vidé à chaque run).
// Invalidation : bump `CACHE_VER` après tout changement du pipeline d'encodage d'un
// segment (VENC, FIT, grade, ridTag…) ; ou `Réglages/cache.txt` = off pour désactiver.
const CACHE = path.join(ENGINE, 'cache');
const CACHE_VER = 'v1';
// ~12 Go : au-delà, purge des plus vieux. Monté de 4 à 12 Go le 31/07 pour le master 4K —
// les 97 segments d'un épisode pèsent ~3 Go en 3840×2160 (contre ~0,8 Go en 1080p), donc le
// plafond de 4 Go se serait déclenché PENDANT le run, cache brouillon + cache 4K cohabitant.
// C'est exactement l'incident du 31/07 (« segment purgé du cache », 40 min perdues).
const CACHE_MAX_BYTES = 12 * 1024 * 1024 * 1024;
const cacheOn = () => {
  try { return !/^\s*off\s*$/im.test(fs.readFileSync(path.join(REGLAGES, 'cache.txt'), 'utf8')); }
  catch { return true; }
};
// clé d'un segment : tout ce qui détermine sa sortie SANS avoir à mesurer le plan
// (cropPan/adaptatif sont déterministes du contenu du fichier → captés par taille+mtime).
function segKey(file, from, to, extra) {
  const st = fs.statSync(file);
  return crypto.createHash('sha1').update([
    CACHE_VER, path.basename(file), st.size, Math.round(st.mtimeMs),
    from.toFixed(3), to.toFixed(3), JSON.stringify(extra),
  ].join('|')).digest('hex').slice(0, 16);
}
function touchCache(p) { try { const t = new Date(); fs.utimesSync(p, t, t); } catch {} }
// ⚠️ CORRIGÉ LE 31/07 — le tri était `b.mtime - a.mtime` (« plus récents d'abord ») alors que la
// boucle supprime EN PARTANT DU DÉBUT : la purge effaçait donc les segments LES PLUS RÉCENTS,
// c'est-à-dire ceux qu'on venait d'encoder, et gardait les plus vieux. Panne silencieuse et
// invisible tant que le cache reste sous le plafond. Elle s'est déclenchée au premier gros
// re-encodage (changement de recette de grade JOUR → les 97 plans du VLOG recalculés, cache pile
// à 4 Go) : 88 des 97 segments neufs supprimés à la volée, 3,96 Go d'ORPHELINS périmés conservés,
// et `vlog.mjs` s'arrête sur « segment purgé du cache ». Le tri part maintenant du PLUS VIEUX —
// et comme un cache-hit fait un `touchCache()`, c'est un vrai LRU : ce qui sert reste.
function pruneCache() {
  try {
    const files = fs.readdirSync(CACHE).filter((f) => f.endsWith('.mp4'))
      .map((f) => { const s = fs.statSync(path.join(CACHE, f)); return { f, size: s.size, mtime: s.mtimeMs }; })
      .sort((a, b) => a.mtime - b.mtime);   // plus VIEUX d'abord — ce sont eux qu'on supprime
    let tot = files.reduce((a, x) => a + x.size, 0);
    for (const x of files) { if (tot <= CACHE_MAX_BYTES) break; fs.rmSync(path.join(CACHE, x.f), { force: true }); tot -= x.size; }
  } catch {}
}

// ---- réglages montage -------------------------------------------------------
const TARGET_MAX_MIN = 15;        // durée cible max de la vidéo finie
const GAP_SILENCE = 1.0;          // gap sans parole (s) considéré temps mort
const PAD = 0.35;                 // marge autour d'un segment parlé (s)
const BROLL_MAX = 6;              // durée gardée d'un plan sans parole (s)
// Plancher de PERCEPTIBILITÉ : sous ce seuil, un rush est un déclenchement ACCIDENTEL du
// DJI (départ/arrêt maladroit, objectif encore obstrué) — aucun plan lisible, imperceptible
// en montage. On l'écarte AVANT la timeline (cf. §rejet dans main). Calibré 20/07 : R01 0,30s
// (paroi bois) / R02 0,37s (objectif obstrué) passaient faute de garde-fou ; le plus court
// plan VOULU du jour = 2,57s → marge ×2,5. Sauté si un plan.txt curé est présent (tri à l'œil).
const MIN_SHOT_PERCEPTIBLE = 1.0; // s
// ---- DÉFINITION DE SORTIE (`Réglages/definition.txt` = 1080 | 2160) ---------
// Défaut 1080 : c'est la définition de TRAVAIL, celle qui rend une itération en minutes.
// `2160` sort du 3840×2160 natif — les rushs sont en 4K (sauf 15-16/07, carrés 3072²
// → crop 16:9 = 3072×1728, encore au-dessus du 1080p), donc le 1080p était un choix du
// pipeline, pas une limite de la matière. On PARAMÈTRE au lieu de remplacer : un 4K en
// dur ferait payer 20× chaque rendu d'itération.
// ⚠️ La définition entre dans la clé de cache des segments (cf. segKey/extra), sinon un
// rendu 4K resservirait des segments 1080p en silence — et SEULEMENT quand elle vaut
// 2160 (même ruse que `mute`/`rep`/`bat`), sans quoi tout le cache existant serait jeté.
const DEFINITION_FILE = path.join(REGLAGES, 'definition.txt');
function readDefinition() {
  try { return /2160|4k/i.test(fs.readFileSync(DEFINITION_FILE, 'utf8')) ? 2160 : 1080; }
  catch { return 1080; }
}
const DEF = readDefinition();
const VID_W = DEF === 2160 ? 3840 : 1920, VID_H = DEF === 2160 ? 2160 : 1080, FPS = 30;
// Cadre en remplissant puis en recadrant au centre : une source carrée (mode
// pleine-capteur de la Pocket 3, 3072x3072) est faite pour être recadrée après
// coup. Un pad la mettrait en boîte avec 44% de noir. Une source déjà en 16:9
// passe par ce filtre sans rien perdre.
// `pan` (optionnel) = {x,y} : décale la fenêtre de crop vers le SUJET (cf. cropPan).
// Sans pan → crop centré (comportement d'origine, inchangé pour du vrai 16:9).
const FIT = (pan, file) => `scale=${VID_W}:${VID_H}:force_original_aspect_ratio=increase`
  + `,crop=${VID_W}:${VID_H}${pan ? `:${pan.x}:${pan.y}` : ''}${gradeFor(file)},fps=${FPS},format=yuv420p`;

// ---- grade cinéma optionnel (déposer `grade.txt` à la racine) ----------------
// Look filmique CHAUD à FAIBLE contraste appris de la référence du monteur (la chaîne de référence) :
// noirs relevés + hautes lumières adoucies + biais ambre + saturation retenue.
// Off par défaut ; s'applique à TOUS les modes via FIT(). Mesuré/validé dans STYLE.md.
const GRADE_FILE = path.join(REGLAGES, 'grade.txt');
// Grade LOOK STUDIO calé NUIT. La 1re version (apprise de la chaîne de référence, qui filme de JOUR)
// éclaircissait (gamma 1,03) et relevait les noirs → sur la matière NUIT du monteur, image
// lavée/laiteuse « cheap », lumières blanches trop puissantes (retour le monteur). Corrigé :
// noirs profonds (0,02), expo baissée (gamma 0,92), hautes lumières domptées (top ~0,88)
// + un peu de contraste pour la profondeur → la nuit reste nuit, les lumières ressortent.
// On garde le biais chaud et la saturation retenue.
// Épaule haute (genou à 0,82) : ne clampe QUE le très haut (sources cramées : lampadaires,
// panneaux lumineux → gris au lieu de blanc dur) en gardant les néons/mi-hautes vifs.
// ⚠️ une source cramée à la PRISE DE VUE (boule blanche + halo) ne se récupère pas — le
// grade l'atténue, le halo reste dans la source.
const GRADE_LOOKSTUDIO = "curves=r='0/0.02 0.5/0.45 0.82/0.70 1/0.73'"
  + ":g='0/0.02 0.5/0.44 0.82/0.68 1/0.71':b='0/0.03 0.5/0.40 0.82/0.63 1/0.66'"
  + ",eq=saturation=0.95:contrast=1.04:gamma=0.92"
  + ",colorbalance=rm=0.05:bm=-0.04:rh=0.03:bh=-0.06";

// Batch JOUR de LOOK STUDIO (18/07). La courbe NUIT ci-dessus crushe les noirs (0→0,02) et
// baisse l'expo (gamma 0,92) → sur du plein jour couvert ça plombe l'image. Le batch JOUR
// garde des noirs NATURELS (pas de crush), ouvre un peu les ombres muddy (gamma 1,02),
// redonne du peps à une lumière plate (sat 1,10 · contraste 1,05), et réchauffe légèrement le
// gris-bleu de l'overcast. Sélection AUTO par luminance du plan (cf. gradeFor) : > DAY_YAVG = JOUR.
// ÉPAULE hautes lumières (MAJ 20/07, dosage « légère » validé par le monteur) : la version d'avant
// POUSSAIT les blancs (0,75→0,78 · 1→0,97, sans genou) → en plein jour le ciel et les surfaces
// lavées CRAMAIENT (retour jour 20 : « trop de lumière blanche », diffus, pas que R13/R14). On
// tient les mids (0,72→0,72) puis on ROULE le haut par un genou (0,9→0,83 · 1→0,93) : le ciel
// bleu + les nuages reviennent, les bouts d'allée cramés se domptent, SANS perdre le côté aéré
// (sat/expo jour inchangés). Le cramé PONCTUEL restant (surface lavée franche) → flag hi/hi2.
//
// JAUNI DOUX + LÉGER CONTRASTE (31/07, variante « A2 » validée par le monteur sur grille 3 plans).
// Demande : « un peu d'effet jauni / contraste, lumière blanche un peu moins puissante ».
// ⚠️ LE PIÈGE, mesuré avant de choisir : jaunir GLOBALEMENT (retirer du bleu jusque dans les
// hautes lumières, `bh` négatif) fait virer LE CIEL au vert-jaune — testé, l'écart est franc à
// l'œil sur les deux plans extérieurs de la grille. L'ambre doit donc vivre dans les OMBRES et
// les MEDIUMS (`bs`/`bm`), et les hautes garder leur bleu (`bh` = 0) : le béton, la végétation
// et la nourriture se réchauffent, le ciel reste un ciel.
//   · ambre  : rs 0,05 · rm 0,07 · gm 0,03 · bs −0,07 · bm −0,10   (bh tenu à 0)
//   · contraste 1,05 → 1,08 (« léger », demandé tel quel) · gamma 1,02 → 1,01
//   · blancs : genou descendu 0,9→0,81 · 1→0,90 (était 0,83 / 0,93) = la « lumière blanche
//     moins puissante » ; la courbe bleue n'est plus écrasée dans le haut (0,9→0,765 · 1→0,885).
// Effet mesuré sur les 3 plans de la grille : axe rouge V +1,5 · axe bleu U −1,0, ciel intact.
const GRADE_LOOKSTUDIO_DAY = "curves=r='0/0.00 0.25/0.28 0.72/0.73 0.9/0.81 1/0.90'"
  + ":g='0/0.00 0.25/0.265 0.72/0.715 0.9/0.79 1/0.89':b='0/0.00 0.25/0.24 0.72/0.665 0.9/0.765 1/0.885'"
  + ",eq=saturation=1.10:contrast=1.08:gamma=1.01"
  + ",colorbalance=rs=0.05:bs=-0.07:rm=0.07:gm=0.03:bm=-0.10:rh=0.02:bh=0.00";
const DAY_YAVG = 90;   // YAVG moyen du plan au-delà duquel on bascule sur le batch JOUR
// SIGNATURE des recettes de grade → entre dans la clé de cache (cf. segKey/extra). Sans elle,
// éditer une constante GRADE_* NE changeait PAS la clé (extra ne portait que le LABEL de DA) →
// le cache resservait des segments à l'ANCIEN grade (piège vécu 20/07 : l'épaule jour ne
// s'appliquait pas au re-render). Ici, toute modif d'une recette invalide le cache toute seule.
const GRADE_SIG = crypto.createHash('sha1').update([GRADE_LOOKSTUDIO, GRADE_LOOKSTUDIO_DAY].join('¦')).digest('hex').slice(0, 8);

// ═══ DIRECTIONS ARTISTIQUES (DA) — presets sélectionnables (déposer `DA.txt`) ══
// Une DA regroupe un LOOK (grade) + une INTENTION de rythme. le monteur en choisit une par
// montage. Registre extensible : ajouter une entrée = une nouvelle DA disponible.
//   « LOOK STUDIO » = 1re DA, consolidée depuis la réf. la chaîne de référence + la doctrine
//   du monteur : vlog de voyage, grade filmique chaud à faible contraste, on TIENT les
//   plans-mouvement (couper vite = tournis) et on laisse respirer les plans fixes.
const DA_FILE = path.join(REGLAGES, 'DA.txt');
// LUT filmiques .cube : dossier `Réglages/LUTs/` (généré par make-luts.mjs, 100 % offline).
// Une DA peut porter `lut:'<fichier>.cube'` = le look est cette LUT (via lut3d) au lieu d'un
// grade codé. `lut.txt` (1re ligne = nom d'un .cube du dossier) applique n'importe quelle LUT
// déposée — DROP-IN : une vraie LUT tierce marche pareil. Une LUT DÉFINIT la palette → la
// chaîne adaptative (warmth/sat/point-noir) est court-circuitée quand une LUT est active
// (hi/glow, correctifs, restent). Cf. STYLE.md §LUT filmiques.
const LUT_DIR = path.join(REGLAGES, 'LUTs');
const LUT_FILE = path.join(REGLAGES, 'lut.txt');
const DA = {
  'look studio': {
    label: 'LOOK STUDIO',
    desc: 'Vlog de voyage : filmique chaud, batch JOUR (doux, ciel maîtrisé) ou NUIT (noirs profonds, hautes domptées) auto selon la luminance du plan ; plans-mouvement tenus.',
    grade: GRADE_LOOKSTUDIO,
    holdMovement: true,   // durée du plan pilotée par le mouvement de caméra
  },
  'nuit cine': {
    label: 'Nuit ciné (LUT)',
    desc: 'LUT filmique nuit : noirs profonds bleu-cyan, lumières ville chaudes, néons punchy. Alternative graduée au LOOK STUDIO.',
    lut: 'nuit_cine.cube',
    holdMovement: true,
  },
  'cine teal orange': {
    label: 'Ciné teal-orange (LUT)',
    desc: 'LUT blockbuster : ombres cyan, chairs/hautes orangées, contraste saturé et punchy.',
    lut: 'cine_teal_orange.cube',
    holdMovement: true,
  },
  'kodak warm': {
    label: 'Kodak chaud (LUT)',
    desc: 'LUT film chaud nostalgique : WB chaud, mids jaune-vert, hautes crème.',
    lut: 'kodak_warm.cube',
    holdMovement: true,
  },
  brut: {
    label: 'Brut',
    desc: 'Aucun grade, plans gardés entiers. Le rendu neutre par défaut.',
    grade: null,
    holdMovement: false,
  },
};
// DOSAGE d'une LUT : mélange chaque entrée vers l'IDENTITÉ à (1−intensité). Une LUT à 0.6 lit
// souvent plus naturel qu'à fond. Génère un .cube dosé en cache (une fois par (nom, intensité)).
function dosedCube(srcPath, intensity) {
  const cacheDir = path.join(LUT_DIR, '.cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const out = path.join(cacheDir, `${path.basename(srcPath, '.cube')}@${intensity.toFixed(2)}.cube`);
  if (fs.existsSync(out)) return out;
  const lines = fs.readFileSync(srcPath, 'utf8').split('\n');
  let N = 0; const dosed = [];
  const data = [];
  for (const l of lines) {
    const s = l.trim();
    if (/^LUT_3D_SIZE/i.test(s)) { N = parseInt(s.split(/\s+/)[1], 10); dosed.push(s); }
    else if (/^[\d.]/.test(s)) data.push(s);
    else dosed.push(s);                                   // headers TITLE/DOMAIN_*
  }
  data.forEach((s, j) => {
    const [r, g, b] = s.split(/\s+/).map(Number);
    const ri = j % N, gi = Math.floor(j / N) % N, bi = Math.floor(j / (N * N)); // rouge = plus rapide
    const idR = ri / (N - 1), idG = gi / (N - 1), idB = bi / (N - 1);           // identité au point
    const mix = (id, v) => (id + (v - id) * intensity).toFixed(6);
    dosed.push(`${mix(idR, r)} ${mix(idG, g)} ${mix(idB, b)}`);
  });
  fs.writeFileSync(out, dosed.join('\n') + '\n');
  return out;
}
// LUT active = lut.txt (drop-in prioritaire, format « nom [intensité] ») sinon `lut` de la DA
// (avec `lutIntensity` optionnel). Renvoie le chemin absolu du .cube (dosé si intensité < 1), ou null.
function activeLut() {
  let name = null, intensity = 1;
  try {
    const toks = fs.readFileSync(LUT_FILE, 'utf8').split('\n')[0].trim().split(/\s+/);
    if (toks[0]) { name = toks[0]; if (toks[1] && !isNaN(+toks[1])) intensity = +toks[1]; }
  } catch { /* pas de lut.txt */ }
  if (!name) { const da = readDA(); if (da && da.lut) { name = da.lut; if (da.lutIntensity != null) intensity = da.lutIntensity; } }
  if (!name) return null;
  const file = path.join(LUT_DIR, name.endsWith('.cube') ? name : `${name}.cube`);
  if (!fs.existsSync(file)) return null;
  intensity = Math.max(0, Math.min(1, intensity));
  return intensity >= 0.999 ? file : dosedCube(file, intensity);
}
function readDA() {
  try {
    // 1re ligne entière, minuscules, espaces compactés (« LOOK STUDIO » → « look studio »)
    const k = fs.readFileSync(DA_FILE, 'utf8').split('\n')[0].trim().toLowerCase().replace(/\s+/g, ' ');
    return DA[k] ? { key: k, ...DA[k] } : null;
  } catch { return null; }
}
let _grade = null;
function gradeChain() {
  if (_grade === null) {
    const lut = activeLut();
    if (lut) {
      _grade = `,lut3d='${lut}'`;                       // LUT active = le look (remplace le grade codé)
    } else {
      const da = readDA();
      // priorité : grade de la DA active ; sinon toggle grade.txt manuel ; sinon rien
      const g = da ? da.grade : (fs.existsSync(GRADE_FILE) ? GRADE_LOOKSTUDIO : null);
      _grade = g ? `,${g}` : '';
    }
  }
  return _grade;
}

// Grade PAR PLAN : quand le look actif est le grade codé LOOK STUDIO, on choisit le batch
// JOUR ou NUIT selon la luminance mesurée du plan (mémoire du monteur : « LOOK STUDIO a un batch
// jour et un batch nuit »). LUT active / grade manuel / pas de grade → inchangé (global).
const _gradeCache = new Map();
function gradeFor(file) {
  const base = gradeChain();                     // '' | ',lut3d…' | ',<GRADE_LOOKSTUDIO>'
  if (!file || base !== `,${GRADE_LOOKSTUDIO}`) return base;
  if (_gradeCache.has(file)) return _gradeCache.get(file);
  // le VERROU DE SCÈNE prime sur la mesure du plan (cf. §Scènes ci-dessous) ; sans verrou,
  // on retombe sur la mesure isolée du plan.
  const day = _sceneDay.has(file) ? _sceneDay.get(file) : dayByItself(file);
  const g = `,${day ? GRADE_LOOKSTUDIO_DAY : GRADE_LOOKSTUDIO}`;
  _gradeCache.set(file, g);
  return g;
}
function dayByItself(file) {
  const m = measurePlate(file);
  return !!(m && m.YAVG !== null && m.YAVG > DAY_YAVG);
}

// ---- VERROU DE SCÈNE sur le batch JOUR/NUIT (le monteur, 30/07) ---------------------
// LE DÉFAUT CORRIGÉ : `gradeFor` votait PLAN PAR PLAN sur une mesure continue (YAVG) avec un
// seuil SEC à 90. Deux plans du MÊME LIEU filmés à 1 min 40 d'intervalle — 18/07 R02 (YAVG
// 95,5) et R03 (88,1) — tombaient de part et d'autre du seuil et recevaient deux étalonnages
// opposés : R02 en JOUR (noirs naturels, sat 1,10) et R03 en NUIT (noirs écrasés, gamma 0,92,
// réchauffement). Au raccord, ça saute aux yeux. Le moteur n'avait aucune notion de SCÈNE : il
// traitait deux plans consécutifs du même endroit comme des étrangers.
//
// LA RÈGLE, choisie par le monteur : verrouiller par BANDE DE PLANS CONSÉCUTIFS, et seulement ceux qui
// se suivent vraiment. Une bande se coupe quand l'écart de TOURNAGE entre deux rushs consécutifs
// dépasse SCENE_GAP_MIN. Toute la bande reçoit alors UN seul batch, décidé à la médiane.
//
// LE SEUIL EST MESURÉ, pas rond : sur les 90 raccords des 6 journées du VLOG #01, la
// distribution des écarts est franchement bimodale (18 raccords < 1 min, 26 > 20 min) et son
// CREUX tombe sur la tranche 8-12 min (4 raccords seulement). 10 min est donc la vallée entre
// « on est encore sur la même scène » et « on a changé d'endroit ». Sur le 18/07 ça découpe
// exactement {R02,R03} (les robots) · {R05} · {R06,R07,R08} (le campus).
//
// L'horodatage vient du NOM du rush (`DJI_YYYYMMDDHHMMSS`), jamais de la mtime — une copie de
// fichier réécrit la mtime, pas le nom (règle déjà posée pour le scope du jour). Un rush dont
// le nom ne porte pas d'horodatage forme sa PROPRE bande : on ne devine pas.
const SCENE_GAP_MIN = 10;
const _sceneDay = new Map();        // file → true (JOUR) | false (NUIT), décidé par la bande
const _sceneForced = new Set();     // fichiers dont la bande CONTREDIT leur mesure isolée
function rushStamp(file) {
  const m = path.basename(file).match(/(\d{8})(\d{6})/);
  if (!m) return null;
  const [, d, t] = m;
  return Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8),
    +t.slice(0, 2), +t.slice(2, 4), +t.slice(4, 6));
}
function lockSceneBatches(files, log = () => {}) {
  if (gradeChain() !== `,${GRADE_LOOKSTUDIO}`) return;    // LUT ou grade manuel → rien à verrouiller
  const bands = [];
  for (const f of files) {
    const st = rushStamp(f);
    const last = bands[bands.length - 1];
    const contigu = last && st !== null && last.stamp !== null
      && (st - last.stamp) / 60000 <= SCENE_GAP_MIN;
    if (contigu) { last.files.push(f); last.stamp = st; }
    else bands.push({ files: [f], stamp: st });
  }
  for (const b of bands) {
    const ys = b.files.map((f) => { const m = measurePlate(f); return m && m.YAVG !== null ? m.YAVG : null; })
      .filter((y) => y !== null).sort((a, b2) => a - b2);
    if (!ys.length) continue;
    // MÉDIANE et pas moyenne : un seul plan très clair (un mur blanc, un écran LED) ne doit pas
    // faire basculer toute une scène — c'est exactement le genre d'accident qu'on corrige ici.
    const med = ys.length % 2 ? ys[(ys.length - 1) / 2] : (ys[ys.length / 2 - 1] + ys[ys.length / 2]) / 2;
    const day = med > DAY_YAVG;
    const forces = b.files.filter((f) => dayByItself(f) !== day);
    b.files.forEach((f) => { _sceneDay.set(f, day); if (dayByItself(f) !== day) _sceneForced.add(f); });
    if (b.files.length > 1) {
      log(`  scène ${b.files.length} plans → batch ${day ? 'JOUR' : 'NUIT'} (médiane YAVG ${med.toFixed(1)})`
        + (forces.length ? `  ⟲ ${forces.length} plan(s) réaligné(s) : ${forces.map((f) => path.basename(f).slice(0, 12)).join(', ')}` : ''));
    }
  }
}

// ---- score de MOUVEMENT DE CAMÉRA d'un plan (0 = fixe, >3 = pano/marche) -------
// Astuce : on réduit à une vignette 48x27 → le mouvement d'objets locaux (un passant)
// se moyenne et disparaît, mais le déplacement de la CAMÉRA décale toute l'image et
// subsiste. On mesure l'énergie de différence inter-images. Calibré : plan verrouillé
// ~0,7-0,9 ; plans du monteur (filmés en mouvement) 2-6,6. Seuil fixe/mouvement = 1,5.
const MOTION_STATIC = 1.5;
function motionScore(file) {
  try {
    const r = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-vf',
      'scale=48:27,tblend=all_mode=difference,signalstats,metadata=print', '-an', '-f', 'null', '-'],
      { encoding: 'utf8', maxBuffer: 48 * 1024 * 1024 });
    const ys = [...(r.stderr || '').matchAll(/signalstats\.YAVG=([\d.]+)/g)].map((m) => +m[1]);
    if (!ys.length) return null;
    return ys.reduce((a, b) => a + b, 0) / ys.length;
  } catch { return null; }
}

// ---- encodeur : matériel (VideoToolbox, M1) si dispo, sinon CPU (libx264) ----
// Gain typique 3-5× sur Apple Silicon. Repli automatique si indisponible.
let _venc = null;
function VENC() {
  if (_venc) return _venc;
  let hw = false;
  try {
    hw = /h264_videotoolbox/.test(
      execFileSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch { hw = false; }
  // Deux niveaux (déposer `qualite.txt` = brouillon | final) :
  //  • brouillon (défaut) : encodeur matériel M1 rapide → on cadre/juge le montage vite.
  //  • final : libx264 CRF 16 preset slow → VRAIE qualité (videotoolbox est mou : c'était
  //    la « perte de qualité » ressentie). Une seule génération (segments → concat copy).
  // PRESET EN FINAL — `slow` en 1080p, `medium` en 2160p. Mesuré le 31/07 sur un plan
  // témoin (6 s de DJI_20260719074341, CRF 16, 3840×2160) : `slow` coûte 1,7× le temps
  // (12,0 s contre 7,0 s) pour +0,08 dB de PSNR (44,82 contre 44,74), +0,00015 de SSIM
  // (0,987935 contre 0,987781) et un fichier RIGOUREUSEMENT du même poids (30,595 Mo
  // contre 30,603 Mo). À 4K, le gain de `slow` est sous le seuil du perceptible et sous
  // le bruit de mesure : on paie le double pour rien. En 1080p on garde `slow` (le débit
  // y est 4× plus contraint, l'analyse supplémentaire y sert encore).
  _venc = readQuality() === 'final'
    ? ['-c:v', 'libx264', '-preset', DEF === 2160 ? 'medium' : 'slow', '-crf', '16', '-pix_fmt', 'yuv420p']
    : hw
      ? ['-c:v', 'h264_videotoolbox', '-b:v', '12M', '-tag:v', 'avc1']
      : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23'];
  return _venc;
}
const QUALITY_FILE = path.join(REGLAGES, 'qualite.txt');
function readQuality() {
  try {
    return /final/i.test(fs.readFileSync(QUALITY_FILE, 'utf8')) ? 'final' : 'brouillon';
  } catch { return 'brouillon'; }
}

// ---- PROXY DE TRAVAIL (brouillon seulement) — repères pour itérer par la parole -
// le monteur juge le brouillon puis dit « raccourcis R07 » / « à 1:23 fais X ». Deux repères
// gravés UNIQUEMENT en brouillon (le final reste propre, sans habillage) :
//  • badge R## par plan (coin haut-gauche) = MÊME numéro que les planches catalogue
//    (le `rid` est l'index chrono jour-scopé, identique à catalogue.mjs).
//  • timecode global courant (coin bas-droite) = horloge de la vidéo montée.
// drawtext sans fontfile : la police par défaut (fontconfig du build homebrew-ffmpeg)
// suffit — c'est déjà ce qu'utilise catalogue.mjs.
// Interrupteur INDÉPENDANT de la qualité (`Réglages/reperes.txt` = off). Sert au
// montage MERGÉ vlog : on veut des masters de jour en brouillon (rapide) mais NUS,
// parce que la renumérotation R## et le timecode sont regravés sur la timeline
// fusionnée — deux badges superposés seraient illisibles.
const REPERES_FILE = path.join(REGLAGES, 'reperes.txt');
function reperesOn() {
  try { return !/^\s*(off|non|0)\s*$/im.test(fs.readFileSync(REPERES_FILE, 'utf8')); }
  catch { return true; }
}
function ridTag(rid) {
  if (readQuality() === 'final' || !reperesOn() || !rid) return '';
  // tailles/marges au PRORATA de la définition (K=1 en 1080p, 2 en 2160p) : un badge de
  // 46 px sur du 3840×2160 serait illisible, et le repère ne sert qu'à ça.
  const K = VID_H / 1080;
  return `,drawtext=text='R${String(rid).padStart(2, '0')}':x=${Math.round(16 * K)}:y=${Math.round(14 * K)}:fontsize=${Math.round(46 * K)}`
    + `:fontcolor=yellow:box=1:boxcolor=black@0.78:borderw=${Math.round(2 * K)}`;
}
// ---- FILTRES COLORIMÉTRIQUES → bibliothèque `filters.mjs` ----------------------
// hiTame (hautes lumières), adaptiveWarmth/Saturation/Blackpoint/Exposure (adaptatifs
// mesure→règle), deBloom (anti-bloom) et le catalogue LOOKS (réglages classiques dosables)
// vivent désormais dans filters.mjs — mesure consolidée (un seul passage signalstats),
// source unique, réutilisable. Importés en tête de fichier. `adaptiveColor(file)` = la
// chaîne warmth → saturation → point-noir. Voir STYLE.md §Bibliothèque de filtres.
// Passe finale : incruste le timecode courant sur toute la vidéo. En brouillon
// uniquement, non destructif (repli = on garde le rendu sans timer plutôt que rien).
function stampTimecode(file) {
  if (readQuality() === 'final' || !reperesOn()) return false;
  const tmp = path.join(WORK, `tc_${path.basename(file)}`);
  try {
    const K = VID_H / 1080;
    const tc = `drawtext=text='%{pts\\:hms}':x=w-tw-${Math.round(16 * K)}:y=h-th-${Math.round(14 * K)}:fontsize=${Math.round(40 * K)}`
      + `:fontcolor=white:box=1:boxcolor=black@0.6:borderw=${Math.round(1 * K)}`;
    sh('ffmpeg', ['-y', '-i', file, '-vf', tc, ...VENC(), '-c:a', 'copy', tmp],
      { stdio: ['ignore', 'ignore', 'ignore'] });
    if (fs.existsSync(tmp)) { fs.renameSync(tmp, file); return true; }
  } catch { /* garder le rendu sans timer */ }
  return false;
}

// ---- PLAN DE COUPE CURÉ (Réglages/plan.txt) — rendu par keep-ranges ----------
// Claude regarde les pellicules (filmstrip.mjs), décide quoi garder/couper par plan,
// et l'écrit ici. Le moteur EXÉCUTE ce plan gelé, sans coupe mécanique ni whisper :
// la VISION = Claude (online) ; le RENDU reste offline (idempotent, reproductible).
// Format, une ligne par plan gardé (ordre du fichier = ordre du montage) :
//   R07              → garder le rush R07 ENTIER
//   R03 2.5-11       → garder 2,5 s à 11 s
//   R12 0-3 7-11     → deux morceaux du même rush (le mort du milieu est jeté)
//   R25 3-6 muet     → plan gardé mais SON COUPÉ (silence à la place, la piste reste)
//   # commentaire    → ignoré (aussi en fin de ligne)
// R## = numéro catalogue (index chrono jour-scopé), le MÊME que les planches. Un rush
// non listé est écarté. Présence du fichier ⇒ on force le mode ambiance sur ce plan.
const PLAN_FILE = path.join(REGLAGES, 'plan.txt');
// ⚠️ `plan.txt` est ÉCRASÉ à chaque jour et ses lignes ne sont que des `R##` : rien, dans le
// fichier, ne dit POUR QUEL JOUR il a été écrit. Si on re-scope `jour.txt` sans le réécrire, le
// moteur applique les fenêtres de l'ancien jour aux rushes du nouveau — `R03 0-3.0` du 16/07
// devient une coupe sur un rush du 20/07 qui n'a rien à voir. Ça ne PLANTE pas : ça sort un
// montage propre, plausible et faux (panne silencieuse, vécue le 29/07 — le store est resté dans
// cet état une quinzaine de minutes). D'où l'en-tête ci-dessous, lue par planDeclaredDay() :
//     # jour: 20260720          (ou 2026-07-20 / 20-07-2026 — même tolérance que jour.txt)
// Le contrôle vit dans assertPlanMatchesDay() : DIVERGENCE = arrêt net ; en-tête ABSENTE =
// avertissement seulement (tous les plan.txt antérieurs au 29/07 en sont dépourvus, on ne casse
// pas l'historique).
function planDeclaredDay() {
  try {
    if (!fs.existsSync(PLAN_FILE)) return null;
    for (const raw of fs.readFileSync(PLAN_FILE, 'utf8').split('\n')) {
      const m = raw.match(/^\s*#\s*jour\s*[:=]\s*(.+?)\s*$/i);
      if (!m) continue;
      const v = m[1].trim();
      let d;
      if ((d = v.match(/^(\d{4})-?(\d{2})-?(\d{2})$/))) return d[1] + d[2] + d[3];
      if ((d = v.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/))) return d[3] + d[2] + d[1];
      const raw8 = v.replace(/\D/g, '');
      return raw8.length === 8 ? raw8 : null;
    }
    return null;
  } catch { return null; }
}
// Rend { ok, level, msg }. `level` : 'ok' | 'warn' (en-tête absente) | 'stop' (divergence).
function checkPlanDay() {
  const jours = readJours();
  const declared = planDeclaredDay();
  if (!jours.length) return { ok: true, level: 'ok', msg: null };   // pas de scope → rien à vérifier
  if (!declared) {
    return { ok: true, level: 'warn',
      msg: `plan.txt ne déclare aucun jour (« # jour: ${jours[0]} » en tête) — impossible de vérifier `
         + `qu'il a bien été écrit pour ${jours.join(', ')}. Vérifie-le à l'œil avant de te fier au rendu.` };
  }
  if (jours.includes(declared)) return { ok: true, level: 'ok', msg: null };
  return { ok: false, level: 'stop',
    msg: `plan.txt a été écrit pour le jour ${declared}, or jour.txt cible ${jours.join(', ')}.\n`
       + `       Les R## d'un jour ne désignent PAS les mêmes rushes qu'un autre : monter ainsi produirait\n`
       + `       un montage plausible mais FAUX. Réécris plan.txt pour ${jours.join(', ')} (ou corrige\n`
       + `       l'en-tête « # jour: » si c'est elle qui est périmée), puis relance.` };
}
function readPlan() {
  try {
    if (!fs.existsSync(PLAN_FILE)) return null;
    const out = [];
    for (const raw of fs.readFileSync(PLAN_FILE, 'utf8').split('\n')) {
      const l = raw.replace(/#.*$/, '').trim();
      if (!l) continue;
      const m = l.match(/^R?(\d{1,3})\b(.*)$/i);
      if (!m) continue;
      const rid = parseInt(m[1], 10);
      const rest = m[2].trim();
      let ranges = null;   // null = rush entier
      let hi = 0;          // 0 = pas de domptage ; 1 = `hi` ; 2 = `hi2`
      let glow = false;    // flag `glow` = anti-bloom (resserre le bruit de lumière)
      let mute = false;    // flag `muet` = son du rush remplacé par du silence
      if (rest) {
        const rangeToks = [];
        for (const tok of rest.split(/\s+/)) {
          if (/^hi2$/i.test(tok)) { hi = 2; continue; }
          if (/^hi$/i.test(tok)) { hi = Math.max(hi, 1); continue; }
          if (/^glow$/i.test(tok)) { glow = true; continue; }
          if (/^(muet|mute)$/i.test(tok)) { mute = true; continue; }
          rangeToks.push(tok);
        }
        ranges = rangeToks.map((tok) => {
          const mm = tok.match(/^(\d+(?:[.,]\d+)?)[-–](\d+(?:[.,]\d+)?)$/);
          return mm ? [parseFloat(mm[1].replace(',', '.')), parseFloat(mm[2].replace(',', '.'))] : null;
        }).filter(Boolean);
        if (!ranges.length) ranges = null;
      }
      out.push({ rid, ranges, hi, glow, mute });
    }
    return out.length ? out : null;
  } catch { return null; }
}
const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.avi', '.mkv', '.webm']);

// ---- utilitaires ------------------------------------------------------------
const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
function log(msg) {
  const line = `[${now()}] ${msg}\n`;
  fs.appendFileSync(LOG, line);
  process.stdout.write(line);
}
function sh(cmd, args, opts = {}) {
  return run(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 28, ...opts });
}
function notify(title, message) {
  try {
    const esc = (s) => String(s).replace(/["\\]/g, '\\$&');
    sh('osascript', ['-e', `display notification "${esc(message)}" with title "${esc(title)}"`]);
  } catch {}
}
function ffprobeDuration(file) {
  const out = sh('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=nw=1:nk=1', file]).trim();
  return parseFloat(out) || 0;
}

// ---- recadrage intelligent (sujet-aware) : n'importe quel format → 16:9 ------
// Les rushes mélangent 16:9 (rue) et 1:1 carré (skylines du Bund) — et toutes les
// vidéos passées font pareil. Le FIT « cover » recadrait au CENTRE : sur un carré il
// gardait la bande médiane et JETAIT le sujet (skyline en bas, sous un grand ciel noir
// mort). Solution auto, sans réglage : on mesure où est l'ÉNERGIE de l'image et on cale
// la fenêtre 16:9 dessus. Full-frame, zéro barre. Marche pour tout format (portrait,
// 4:3, ultrawide) : slack vertical → on choisit y ; slack horizontal → on choisit x.
// Un vrai 16:9 n'a aucun slack → pan nul (crop d'avant, strictement inchangé).
// Métrique = TEXTURE (gradient), invariante à la lumière : le bâti/les néons sont TEXTURÉS,
// le ciel (sombre lisse la nuit, clair nuageux le jour) l'est moins → la fenêtre suit la
// ville, pas le vide, JOUR comme NUIT. (L'ancienne pondération par luminance s'inversait le jour.)
const _panCache = new Map();
function ffprobeWH(file) {
  try {
    const out = sh('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]).trim();
    const [w, h] = out.split(',').map((n) => parseInt(n, 10));
    return [w || 0, h || 0];
  } catch { return [0, 0]; }
}
function energyProfile(file, axis, N) {
  const dur = ffprobeDuration(file);
  const times = dur > 0 ? [0.25, 0.5, 0.75].map((f) => (dur * f).toFixed(2)) : ['0'];
  const acc = new Float64Array(N);
  let got = 0;
  for (const t of times) {
    let buf;
    try {
      buf = spawnSync('ffmpeg', ['-v', 'error', '-ss', t, '-i', file, '-frames:v', '1',
        '-vf', `scale=${N}:${N},format=gray`, '-f', 'rawvideo', '-'],
        { maxBuffer: 8 * N * N }).stdout;
    } catch { continue; }
    if (!buf || buf.length < N * N) continue;
    got++;
    for (let i = 0; i < N; i++) {
      let lum = 0, grad = 0;
      for (let j = 0; j < N; j++) {
        const idx = axis === 'row' ? i * N + j : j * N + i;
        const v = buf[idx];
        lum += v;
        if (j > 0) {
          const p = axis === 'row' ? i * N + (j - 1) : (j - 1) * N + i;
          grad += Math.abs(v - buf[p]);
        }
      }
      // TEXTURE (gradient) seulement — invariant à la lumière (18/07). L'ancien terme de
      // luminance brute (`lum/N`) suivait la ville la NUIT (ciel sombre) mais s'inversait le
      // JOUR : un ciel couvert clair+nuageux est LUMINEUX et texturé → il gagnait, la fenêtre
      // montait sur le ciel (y=0, sujet coupé). Le détail fin de la ville > celui des nuages
      // dans les deux cas → le gradient seul cale la fenêtre sur le bâti/skyline, jour comme nuit.
      void lum;
      acc[i] += grad / N;
    }
  }
  return got ? acc : null;
}
function bestWindow(prof, win) {
  const N = prof.length;
  let sum = 0;
  for (let i = 0; i < win; i++) sum += prof[i];
  let best = sum, bi = 0;
  for (let s = 1; s <= N - win; s++) {
    sum += prof[s + win - 1] - prof[s - 1];
    if (sum > best) { best = sum; bi = s; }
  }
  return bi;
}
// pan {x,y,note} pour le crop du FIT, ou null (= centre, comportement d'avant).
function cropPan(file) {
  if (_panCache.has(file)) return _panCache.get(file);
  let pan = null;
  try {
    const [W, H] = ffprobeWH(file);
    if (W && H) {
      const s = Math.max(VID_W / W, VID_H / H);
      const sw = Math.round(W * s), sh2 = Math.round(H * s);
      const slackX = sw - VID_W, slackY = sh2 - VID_H;
      if (slackX > 1 || slackY > 1) {
        const N = 64;
        const axis = slackY >= slackX ? 'row' : 'col';
        const prof = energyProfile(file, axis, N);
        if (prof) {
          if (axis === 'row') {
            const win = Math.max(1, Math.round(N * (VID_H / sh2)));
            const start = bestWindow(prof, win);
            const y = Math.min(slackY, Math.max(0, Math.round((start / N) * sh2)));
            pan = { x: Math.round(slackX / 2), y, note: `↕ y=${y}/${slackY}` };
          } else {
            const win = Math.max(1, Math.round(N * (VID_W / sw)));
            const start = bestWindow(prof, win);
            const x = Math.min(slackX, Math.max(0, Math.round((start / N) * sw)));
            pan = { x, y: Math.round(slackY / 2), note: `↔ x=${x}/${slackX}` };
          }
        }
      }
    }
  } catch { pan = null; }
  _panCache.set(file, pan);
  return pan;
}
function ensureDirs() {
  for (const d of [INBOX, OUT, MUSIC, REGLAGES, WORK, CACHE, PROJECTS, path.dirname(MODEL)]) fs.mkdirSync(d, { recursive: true });
}
// horodatage (YYYYMMDDHHMMSS) extrait du nom DJI ; sinon null. Source d'ordre FIABLE :
// la mtime ment dès qu'un rush est recopié (ex. re-vidage de carte → tous les fichiers
// prennent la date du jour, ce qui scramble le récit). Le nom porte l'heure de captation.
function fileStamp(p) {
  const m = path.basename(p).match(/(\d{14})/);
  return m ? m[1] : null;
}
// scoping par jour : réglage `jour.txt` (une date par ligne : YYYY-MM-DD, YYYYMMDD ou
// DD/MM/YYYY). Vide/absent → tous les jours. Sert quand plusieurs jours de rushes sont
// déposés et qu'on ne veut monter qu'un jour précis, SANS déplacer ni masquer de fichiers.
const JOUR_FILE = path.join(REGLAGES, 'jour.txt');
function readJours() {
  try {
    return fs.readFileSync(JOUR_FILE, 'utf8').split('\n')
      .map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
      .map((l) => {
        let m;
        if ((m = l.match(/^(\d{4})-?(\d{2})-?(\d{2})$/))) return m[1] + m[2] + m[3];
        if ((m = l.match(/^(\d{2})\/(\d{2})\/(\d{4})$/))) return m[3] + m[2] + m[1];
        return l.replace(/\D/g, '');
      }).filter((d) => d.length === 8);
  } catch { return []; }
}
function listRushes() {
  if (!fs.existsSync(INBOX)) return [];
  const jours = readJours();
  return fs.readdirSync(INBOX)
    .filter((f) => !f.startsWith('.') && VIDEO_EXT.has(path.extname(f).toLowerCase()))
    .map((f) => path.join(INBOX, f))
    .map((p) => ({ p, st: fileStamp(p), mtime: fs.statSync(p).mtimeMs }))
    // scope jour actif → ne garde que les dates ciblées (nom fiable ; sans horodatage on écarte)
    .filter((x) => !jours.length || (x.st && jours.includes(x.st.slice(0, 8))))
    // ordre chronologique = horodatage du NOM (robuste aux recopies) ; repli mtime sinon
    .sort((a, b) => (a.st && b.st ? a.st.localeCompare(b.st) : a.mtime - b.mtime))
    .map((x) => x.p);
}

// ---- whisper : transcript horodaté d'un fichier -----------------------------
function transcribe(videoOrWav, tag) {
  const wav = path.join(WORK, `${tag}.wav`);
  // extraction audio 16 kHz mono (format attendu par whisper.cpp)
  // pas de piste audio (plan muet) → pas de parole, on ne plante pas
  try {
    sh('ffmpeg', ['-y', '-i', videoOrWav, '-ar', '16000', '-ac', '1', '-vn', wav],
      { stdio: ['ignore', 'ignore', 'ignore'] });
  } catch { return []; }
  if (!fs.existsSync(wav)) return [];
  const base = path.join(WORK, `${tag}`);
  // -oj = sortie JSON structurée ; langue auto ; -nt = pas de timestamps dans le texte
  sh('whisper-cli', ['-m', MODEL, '-f', wav, '-oj', '-of', base, '-l', 'auto'],
    { stdio: ['ignore', 'ignore', 'ignore'] });
  const jf = `${base}.json`;
  if (!fs.existsSync(jf)) return { segs: [], lang: null };
  let j;
  try { j = JSON.parse(fs.readFileSync(jf, 'utf8')); } catch { return { segs: [], lang: null }; }
  const segs = (j.transcription || []).map((s) => {
    const from = (s.offsets?.from ?? 0) / 1000;
    const to = (s.offsets?.to ?? 0) / 1000;
    return { from, to, text: (s.text || '').trim() };
  }).filter((s) => s.to > s.from && s.text);
  // langue détectée : sert à repérer la VOIX du monteur (français net) vs les
  // hallucinations en langue exotique sur du bruit de rue (cf. mode ambiance).
  return { segs, lang: j.result?.language || null };
}

// ---- nettoyage transcript : vire les hallucinations de whisper sur silence --
// Sur du bruit (rue, foule, vent), whisper recrache le boilerplate de fin de
// vidéo YouTube appris à l'entraînement — et avec `-l auto` il le fait dans une
// langue tirée au hasard : du coréen et du japonais sont sortis de rushes de
// Shanghai. La liste couvre donc les langues, pas seulement FR/EN.
const HALLUCINATIONS = [
  /sous-titres?\s+r[ée]alis[ée]s?\s+par/i, /amara\.org/i, /sous-titrage/i,
  /merci d('|’)avoir regard/i, /thanks?\s+for\s+watching/i, /abonnez-vous/i,
  /please\s+subscribe/i, /(hope\s+to\s+)?see\s+you\s+(again|next)/i,
  /subscribe\s+to\s+my\s+channel/i, /like\s+and\s+subscribe/i,
  /구독|좋아요/,                       // coréen : « abonnez-vous » / « likez »
  /ご視聴|ありがとうございました|チャンネル登録/,  // japonais : « merci d'avoir regardé »
  /请订阅|谢谢观看|字幕由/,             // chinois : « abonnez-vous » / « merci »
  /gracias\s+por\s+ver/i, /danke\s+f[üu]rs\s+zuschauen/i,
  /^\s*[\[(♪].*[\])♪]\s*$/, /^\s*(www\.|http)/i, /^[\s.·…-]*$/,
];
// Plages SILENCIEUSES réelles du fichier (énergie audio, pas d'IA) : sert à
// démasquer les hallucinations de whisper, qui « entend » des phrases sur du vide.
function silentRanges(file) {
  try {
    const r = spawnSync('ffmpeg', ['-hide_banner', '-i', file,
      '-af', 'silencedetect=noise=-40dB:d=0.35', '-f', 'null', '-'], { encoding: 'utf8' });
    const txt = r.stderr || '';
    const ranges = []; let start = null;
    for (const m of txt.matchAll(/silence_(start|end):\s*(-?[\d.]+)/g)) {
      if (m[1] === 'start') start = parseFloat(m[2]);
      else if (start !== null) { ranges.push([start, parseFloat(m[2])]); start = null; }
    }
    if (start !== null) ranges.push([start, Infinity]);
    return ranges;
  } catch { return []; }
}
function silentFraction(seg, ranges) {
  const len = seg.to - seg.from;
  if (len <= 0) return 1;
  let sil = 0;
  for (const [a, b] of ranges) {
    const o = Math.min(seg.to, b) - Math.max(seg.from, a);
    if (o > 0) sil += o;
  }
  return sil / len;
}

function cleanSegs(segs, duration, file) {
  let kept = segs.filter((s) => {
    const t = (s.text || '').trim();
    if (t.length < 2) return false;
    return !HALLUCINATIONS.some((re) => re.test(t));
  });
  // garde-fou décisif : un segment posé à >75% sur du silence réel est une
  // hallucination, pas de la parole. Sans ça, un plan muet passe pour du parlé
  // et le mode BEAT ne se déclenche jamais.
  if (file && kept.length) {
    const ranges = silentRanges(file);
    if (ranges.length) kept = kept.filter((s) => silentFraction(s, ranges) <= 0.75);
  }
  const speech = kept.reduce((a, s) => a + (s.to - s.from), 0);
  // couverture parlée négligeable → c'est en réalité un plan sans parole (B-roll)
  if (speech < 2.0 && speech < duration * 0.12) return [];
  return kept;
}

// ---- EDL heuristique (offline) : quels bouts garder, dans quel ordre --------
// Parlé : on garde les segments (fusionnés, avec marge), on jette les temps morts.
// Sans parole (B-roll) : on garde un extrait borné.
function buildEDL(clips) {
  const edl = []; // {file, from, to}
  for (const c of clips) {
    if (c.segs.length === 0) {
      // B-roll : garder le début, borné
      const keep = Math.min(c.duration, BROLL_MAX);
      if (keep > 0.8) edl.push({ file: c.file, from: 0, to: keep, broll: true });
      continue;
    }
    // fusionner segments parlés proches (gap < GAP_SILENCE) + marge
    let cur = null;
    for (const s of c.segs) {
      const from = Math.max(0, s.from - PAD);
      const to = Math.min(c.duration, s.to + PAD);
      if (cur && from - cur.to <= GAP_SILENCE) {
        cur.to = to;
      } else {
        if (cur) edl.push(cur);
        cur = { file: c.file, from, to, broll: false };
      }
    }
    if (cur) edl.push(cur);
  }
  // cap durée cible : si trop long, on rogne d'abord les B-roll puis les plus longs
  let total = edl.reduce((a, e) => a + (e.to - e.from), 0);
  const capS = TARGET_MAX_MIN * 60;
  if (total > capS) {
    // 1) raccourcir les B-roll
    for (const e of edl) {
      if (total <= capS) break;
      if (e.broll && e.to - e.from > 2.5) {
        const cut = Math.min(e.to - e.from - 2.5, total - capS);
        e.to -= cut; total -= cut;
      }
    }
    // 2) rogner proportionnellement le reste si encore trop long
    if (total > capS) {
      const factor = capS / total;
      for (const e of edl) {
        const len = e.to - e.from;
        e.to = e.from + len * factor;
      }
    }
  }
  return edl.filter((e) => e.to - e.from >= 0.5);
}

// ---- découpe chaque segment (ré-encodé uniforme) puis concatène -------------
function assemble(edl, outFile) {
  const parts = [];
  edl.forEach((e, i) => {
    const seg = path.join(WORK, `seg_${String(i).padStart(4, '0')}.mp4`);
    sh('ffmpeg', ['-y',
      '-ss', e.from.toFixed(3), '-to', e.to.toFixed(3), '-i', e.file,
      // normalisation : même résolution/fps/codec pour un concat sûr
      '-vf', FIT(),
      ...VENC(),
      '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2',
      seg], { stdio: ['ignore', 'ignore', 'ignore'] });
    if (fs.existsSync(seg)) parts.push(seg);
  });
  if (!parts.length) throw new Error('aucun segment produit');
  const listFile = path.join(WORK, 'concat.txt');
  fs.writeFileSync(listFile, parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'));
  sh('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listFile,
    '-c', 'copy', outFile], { stdio: ['ignore', 'ignore', 'ignore'] });
  return outFile;
}

// ---- capacité d'incrustation de ce ffmpeg (libass) — sondé une fois ---------
let _canBurn = null;
function canBurnSubs() {
  if (_canBurn !== null) return _canBurn;
  try {
    const filters = sh('ffmpeg', ['-hide_banner', '-filters'], { stdio: ['ignore', 'pipe', 'ignore'] });
    _canBurn = /(^|\s)ass\s/m.test(filters) && /(^|\s)subtitles\s/m.test(filters);
  } catch { _canBurn = false; }
  return _canBurn;
}

// ---- sous-titres karaoké mot-par-mot (style du projet) --------------------------
// whisper au mot (-ml 1 -sow -ojf) → ASS avec surlignage \k progressif :
// base blanche, mot « prononcé » qui se remplit en violet #7C3AED, contour sombre.
const ASS_VIOLET = '&H00ED3A7C';   // #7C3AED — sung/fill (format ASS = &HAABBGGRR)
const ASS_WHITE  = '&H00FFFFFF';   // à venir
const ASS_OUTLINE = '&H64000000';  // contour sombre semi-transparent
function transcribeWords(videoOrWav, tag) {
  const wav = path.join(WORK, `${tag}_w.wav`);
  sh('ffmpeg', ['-y', '-i', videoOrWav, '-ar', '16000', '-ac', '1', '-vn', wav],
    { stdio: ['ignore', 'ignore', 'ignore'] });
  const base = path.join(WORK, `${tag}_w`);
  // -ml 1 = un token par segment ; -sow = coupe au mot ; -ojf = JSON avec offsets
  sh('whisper-cli', ['-m', MODEL, '-f', wav, '-ml', '1', '-sow', '-ojf', '-of', base, '-l', 'auto'],
    { stdio: ['ignore', 'ignore', 'ignore'] });
  const jf = `${base}.json`;
  if (!fs.existsSync(jf)) return [];
  let j; try { j = JSON.parse(fs.readFileSync(jf, 'utf8')); } catch { return []; }
  return (j.transcription || [])
    .map((s) => ({ from: (s.offsets?.from ?? 0) / 1000, to: (s.offsets?.to ?? 0) / 1000, text: (s.text || '').trim() }))
    .filter((w) => w.text && w.to > w.from && !HALLUCINATIONS.some((re) => re.test(w.text)));
}
function assTime(s) {
  const cs = Math.max(0, Math.round(s * 100));
  const h = Math.floor(cs / 360000), m = Math.floor((cs % 360000) / 6000);
  const sec = Math.floor((cs % 6000) / 100), c = cs % 100;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}
function buildKaraokeASS(words, outPath) {
  // regroupe en lignes lisibles : ≤5 mots, ≤3 s, coupe sur gros silence ou ponctuation
  const lines = []; let cur = [];
  const flush = () => { if (cur.length) { lines.push(cur); cur = []; } };
  for (const w of words) {
    if (cur.length) {
      const gap = w.from - cur[cur.length - 1].to;
      if (cur.length >= 5 || w.to - cur[0].from > 3.0 || gap > 0.8) flush();
    }
    cur.push(w);
    if (/[.!?…]$/.test(w.text)) flush();
  }
  flush();
  const fontSize = Math.round(VID_H * 0.052), marginV = Math.round(VID_H * 0.10);
  const head =
`[Script Info]
ScriptType: v4.00+
PlayResX: ${VID_W}
PlayResY: ${VID_H}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,${fontSize},${ASS_VIOLET},${ASS_WHITE},${ASS_OUTLINE},&H00000000,-1,0,0,0,100,100,0,0,1,3,0,2,80,80,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;
  const events = lines.map((grp) => {
    const start = grp[0].from, end = grp[grp.length - 1].to + 0.15;
    let prevEnd = start, body = '';
    grp.forEach((w, i) => {
      const kcs = Math.max(1, Math.round((w.to - prevEnd) * 100)); // gap + durée → fill synchro voix
      prevEnd = w.to;
      let t = w.text.replace(/[{}]/g, '');
      if (i === 0) t = t.replace(/^[,;:.!?…·\s-]+/, ''); // strip ponctuation parasite en tête de ligne
      body += `{\\k${kcs}}${t} `;
    });
    return `Dialogue: 0,${assTime(start)},${assTime(end)},Default,,0,0,0,,${body.trim()}`;
  }).filter((e) => !/,,$/.test(e));
  fs.writeFileSync(outPath, head + '\n' + events.join('\n') + '\n');
  return events.length;
}

// ---- sous-titres du montage final (re-transcription pour timings exacts) ----
// Dégradé : incrustation (libass) → piste intégrée (mov_text) → sans sous-titres.
// Ne jette JAMAIS : une vidéo sans sous-titres vaut mieux qu'un montage perdu.
function captionize(inFile, outFile) {
  let segs;
  try { segs = transcribe(inFile, 'final'); } catch { segs = []; }
  if (!segs.length) { fs.copyFileSync(inFile, outFile); return { outFile, mode: 'aucun' }; }
  const srt = path.join(WORK, 'final.srt');
  const ts = (s) => {
    const h = String(Math.floor(s / 3600)).padStart(2, '0');
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const sec = String(Math.floor(s % 60)).padStart(2, '0');
    const ms = String(Math.floor((s % 1) * 1000)).padStart(3, '0');
    return `${h}:${m}:${sec},${ms}`;
  };
  fs.writeFileSync(srt, segs.map((s, i) =>
    `${i + 1}\n${ts(s.from)} --> ${ts(s.to)}\n${s.text}\n`).join('\n'));

  // 1) incrustation karaoké mot-par-mot si libass présent
  if (canBurnSubs()) {
    try {
      const words = transcribeWords(inFile, 'final');
      const assPath = path.join(WORK, 'final.ass');
      const n = words.length ? buildKaraokeASS(words, assPath) : 0;
      if (n > 0) {
        sh('ffmpeg', ['-y', '-i', inFile,
          '-vf', `ass='${assPath.replace(/'/g, "\\'")}'`,
          ...VENC(),
          '-c:a', 'copy', outFile], { stdio: ['ignore', 'ignore', 'ignore'] });
        return { outFile, mode: 'karaoké incrusté' };
      }
    } catch { /* on tombe sur la piste intégrée */ }
  }
  // 2) piste de sous-titres intégrée (mov_text) — universel, sans libass
  try {
    sh('ffmpeg', ['-y', '-i', inFile, '-i', srt,
      '-map', '0:v', '-map', '0:a', '-map', '1',
      '-c:v', 'copy', '-c:a', 'copy', '-c:s', 'mov_text',
      '-metadata:s:s:0', 'language=fra', outFile], { stdio: ['ignore', 'ignore', 'ignore'] });
    return { outFile, mode: 'piste intégrée' };
  } catch { /* dernier recours : sans sous-titres */ }
  // 3) sans sous-titres
  fs.copyFileSync(inFile, outFile);
  return { outFile, mode: 'aucun' };
}

// ═══ MODE B — montage paysages calé sur le beat (aubio) ══════════════════════
const MUSIC_EXT = new Set(['.mp3', '.m4a', '.wav', '.aac', '.flac', '.ogg', '.aif', '.aiff']);
// ---- forçage manuel du mode (déposer `mode.txt` à la racine) ----------------
// L'auto-détection s'appuie sur whisper pour savoir s'il y a de la parole. Sur des
// rushes de rue, elle se trompe : whisper « entend » les passants (ou hallucine),
// le montage part en mode parlé et incruste des sous-titres sur de l'ambiance.
// Aucune heuristique ne sépare de façon fiable « le monteur parle à la caméra » d'une
// foule qui parle — donc on laisse la main. Valeurs : rythme | beat | parle | auto.
const MODE_FILE = path.join(REGLAGES, 'mode.txt');
function readMode() {
  try {
    const v = fs.readFileSync(MODE_FILE, 'utf8').trim().toLowerCase().split(/\s|\n/)[0];
    if (v === 'ville') return 'ambiance';   // synonyme naturel
    return ['rythme', 'beat', 'parle', 'ambiance', 'auto'].includes(v) ? v : 'auto';
  } catch { return 'auto'; }
}
// ---- exclusion manuelle de rushes (déposer `exclure.txt`, un nom par ligne) --
// Sert surtout au mode AMBIANCE : virer les plans parlés que le monteur ne veut pas, sans
// dépendre d'une détection auto fragile. Correspondance sur le nom (sous-chaîne).
const EXCLUDE_FILE = path.join(REGLAGES, 'exclure.txt');
function readExclude() {
  try {
    return fs.readFileSync(EXCLUDE_FILE, 'utf8').split('\n')
      .map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
      // un nom de fichier n'a pas d'espace → on ne garde que le 1er token : ainsi un
      // commentaire en fin de ligne (« DJI_… # note ») ne casse plus la sous-chaîne.
      .map((l) => l.split(/\s+/)[0]);
  } catch { return []; }
}
const RHYTHM_SHOT = 2.4;     // durée d'un plan quand aucune musique ne donne le tempo
// ---- Mode AMBIANCE (B-roll enchaîné) : réglages -----------------------------
// Philosophie : respecter la SUBSTANCE de chaque plan. On garde chaque plan
// d'ambiance entier, dans l'ordre, on ne le fragmente pas. On ne rogne QUE le mort
// certain (noir franc, image figée) — jamais un plan tenu volontairement.
const AMB_DEAD_MIN = 2.5;    // durée mini d'un temps mort pour le couper (s)
const AMB_MIN_KEEP = 1.5;    // durée mini d'un morceau gardé après découpe (s)
const AMB_MAX_EDGE = 0.35;   // on ne rogne jamais plus de 35% d'un plan par les bords
const AMB_LUFS = -14, AMB_TP = -1;  // normalisation audio finale (cible YouTube)
const BEAT_MIN_SHOT = 0.5;   // durée mini d'un plan (évite le clignotement)
const BEAT_MAX_SHOT = 2.2;   // durée maxi (subdivise si le beat est lent)

function pickMusic() {
  // `Réglages/musique.txt` = off → aucun lit musical côté moteur. Nécessaire quand la
  // musique est posée PLUS TARD sur la timeline finale (musique.mjs plan) : un lit par
  // jour, concaténé, donnerait 6 démarrages de morceau au lieu d'une carte cohérente.
  try {
    if (/^\s*(off|non|0|aucune)\s*$/im.test(fs.readFileSync(path.join(REGLAGES, 'musique.txt'), 'utf8'))) return null;
  } catch { /* pas de fichier = comportement historique */ }
  if (!fs.existsSync(MUSIC)) return null;
  const f = fs.readdirSync(MUSIC)
    .filter((x) => !x.startsWith('.') && MUSIC_EXT.has(path.extname(x).toLowerCase()))
    .sort();
  return f.length ? path.join(MUSIC, f[0]) : null;
}
// temps forts (s) via aubiotrack ; passe par un wav pour être robuste aux formats
function detectBeats(musicFile) {
  const wav = path.join(WORK, 'music.wav');
  try {
    sh('ffmpeg', ['-y', '-i', musicFile, '-ar', '44100', '-ac', '1', wav],
      { stdio: ['ignore', 'ignore', 'ignore'] });
  } catch { return []; }
  let out = '';
  try { out = sh('aubiotrack', ['-i', wav], { stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return []; }
  return out.split('\n').map((s) => parseFloat(s.trim())).filter((x) => !isNaN(x) && x > 0);
}
// grille de coupes sur la timeline musicale, bornée [minShot, maxShot]
function buildBeatSegments(beats, montageDur) {
  const pts = [...new Set([0, ...beats.filter((b) => b > 0.05 && b < montageDur), montageDur])]
    .sort((a, b) => a - b);
  const cuts = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    if (pts[i] - cuts[cuts.length - 1] >= BEAT_MIN_SHOT) cuts.push(pts[i]);
  }
  if (cuts[cuts.length - 1] < montageDur - 0.05) cuts.push(montageDur);
  const segs = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    let a = cuts[i]; const b = cuts[i + 1];
    while (b - a > BEAT_MAX_SHOT) { segs.push(BEAT_MAX_SHOT); a += BEAT_MAX_SHOT; }
    if (b - a >= 0.2) segs.push(b - a);
  }
  return segs; // liste de durées de plans (s)
}
// remplit chaque plan-beat avec un bout de rush, en tournant sur les plans et en
// avançant une tête de lecture par rush → on parcourt la matière, coupes franches.
function assembleBeat(clips, segDurs, musicFile, outFile) {
  const pool = clips.map((c) => ({ file: c.file, dur: c.duration, head: 0 })).filter((c) => c.dur > 0.3);
  if (!pool.length) throw new Error('aucun plan exploitable pour le montage beat');
  const vf = FIT();
  // sans musique déposée, on garde l'ambiance propre à chaque plan plutôt que de
  // rendre un montage muet
  const keepAmbience = !musicFile;
  const parts = [];
  let pi = 0;
  segDurs.forEach((need, i) => {
    // cherche un plan avec assez de rab devant sa tête ; sinon reboucle (reset tête)
    let clip = null;
    for (let t = 0; t < pool.length; t++) {
      const c = pool[pi % pool.length]; pi++;
      if (c.head + need <= c.dur + 0.05) { clip = c; break; }
    }
    if (!clip) { clip = pool.reduce((m, c) => (c.dur > m.dur ? c : m), pool[0]); clip.head = 0; }
    const from = Math.min(clip.head, Math.max(0, clip.dur - need));
    const to = Math.min(clip.dur, from + need);
    clip.head = to; // avance → le prochain passage sur ce plan montre un autre bout
    const seg = path.join(WORK, `bseg_${String(i).padStart(4, '0')}.mp4`);
    try {
      sh('ffmpeg', ['-y', '-ss', from.toFixed(3), '-to', to.toFixed(3), '-i', clip.file,
        '-vf', vf, ...VENC(),
        ...(keepAmbience
          ? ['-map', '0:v:0', '-map', '0:a:0?', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2']
          : ['-an']),
        seg],
        { stdio: ['ignore', 'ignore', 'ignore'] });
      if (fs.existsSync(seg)) parts.push(seg);
    } catch { /* plan illisible → on saute */ }
  });
  if (!parts.length) throw new Error('aucun plan-beat produit');
  const listFile = path.join(WORK, 'beat_concat.txt');
  fs.writeFileSync(listFile, parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'));
  if (keepAmbience) {
    sh('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', outFile],
      { stdio: ['ignore', 'ignore', 'ignore'] });
    return outFile;
  }
  const silent = path.join(WORK, 'beat_silent.mp4');
  sh('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', silent],
    { stdio: ['ignore', 'ignore', 'ignore'] });
  // colle la musique, coupe à la plus courte (montage ou musique)
  sh('ffmpeg', ['-y', '-i', silent, '-i', musicFile, '-map', '0:v', '-map', '1:a', '-shortest',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', outFile],
    { stdio: ['ignore', 'ignore', 'ignore'] });
  return outFile;
}

// ═══ MODE AMBIANCE — B-roll enchaîné (plans de ville tenus, dans l'ordre) ═════
// Chaque plan est gardé ENTIER, à la suite, dans l'ordre chronologique. On ne
// fragmente pas, on ne saute pas d'un plan à l'autre pour y revenir. On ne rogne
// que le mort CERTAIN (noir franc = caméra baissée/couverte, image figée = gimbal
// arrêté) — jamais un plan tenu volontairement (skyline, panoramique lent…).

// Temps morts d'un plan : noir franc (YAVG<10, échantillonné à 4 Hz) + gel d'image
// (freezedetect). Fusionnés en intervalles [a,b]. Ne juge PAS l'intérêt du plan.
function deadRanges(file, dur) {
  const dead = [];
  // 1) noir franc
  try {
    const r = spawnSync('ffmpeg', ['-hide_banner', '-i', file,
      '-vf', 'fps=4,signalstats,metadata=print', '-an', '-f', 'null', '-'],
      { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    const txt = r.stderr || '';
    const times = [...txt.matchAll(/pts_time:([\d.]+)/g)].map((m) => +m[1]);
    const ys = [...txt.matchAll(/lavfi\.signalstats\.YAVG=([\d.]+)/g)].map((m) => +m[1]);
    let start = null;
    for (let i = 0; i < ys.length; i++) {
      if (ys[i] < 10 && start === null) start = times[i] ?? 0;
      else if (ys[i] >= 10 && start !== null) { dead.push([start, times[i] ?? dur]); start = null; }
    }
    if (start !== null) dead.push([start, dur]);
  } catch { /* pas d'analyse → aucun mort détecté, on garde tout */ }
  // 2) image figée
  try {
    const r = spawnSync('ffmpeg', ['-hide_banner', '-i', file,
      '-vf', `freezedetect=n=-60dB:d=${AMB_DEAD_MIN}`, '-an', '-f', 'null', '-'],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    const txt = r.stderr || '';
    let fs0 = null;
    for (const m of txt.matchAll(/freeze_(start|end):\s*(-?[\d.]+)/g)) {
      if (m[1] === 'start') fs0 = parseFloat(m[2]);
      else if (fs0 !== null) { dead.push([fs0, parseFloat(m[2])]); fs0 = null; }
    }
    if (fs0 !== null) dead.push([fs0, dur]);
  } catch { /* idem */ }
  // fusion des intervalles qui se chevauchent
  dead.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [a, b] of dead) {
    if (merged.length && a <= merged[merged.length - 1][1] + 0.1) {
      merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], b);
    } else merged.push([a, b]);
  }
  return merged;
}

// À partir des temps morts, quels bouts GARDER. Bords : rognés seulement si morts
// (et jamais plus de AMB_MAX_EDGE du plan). Milieu : un mort ≥ AMB_DEAD_MIN est
// coupé, le reste est recollé. Les morceaux < AMB_MIN_KEEP sont écartés.
function keepRanges(dur, dead) {
  const maxEdge = dur * AMB_MAX_EDGE;
  let head = 0, tail = dur;
  for (const [a, b] of dead) {           // rogne la tête si le mort touche 0
    if (a <= head + 0.15 && b > head) head = Math.min(b, maxEdge);
  }
  for (let i = dead.length - 1; i >= 0; i--) {  // rogne la queue si le mort touche la fin
    const [a, b] = dead[i];
    if (b >= tail - 0.15 && a < tail) tail = Math.max(a, dur - maxEdge);
  }
  // morts internes ≥ seuil → points de coupe
  const cuts = dead.filter(([a, b]) => a > head + 0.1 && b < tail - 0.1 && (b - a) >= AMB_DEAD_MIN);
  const keep = [];
  let cur = head;
  for (const [a, b] of cuts) { if (a - cur >= 0.2) keep.push([cur, a]); cur = b; }
  if (tail - cur >= 0.2) keep.push([cur, tail]);
  return keep.filter(([a, b]) => (b - a) >= AMB_MIN_KEEP);
}

const AMB_STATIC_CAP = 5;   // durée max d'un plan FIXE (il n'a pas besoin d'être tenu)

// ---- speed-ramp d'intro « retour sur terre » (déposer `ramp.txt`) ------------
// Quand un plan commence par un déplacement de caméra long avant d'arriver au
// sujet (ex. le haut d'un building puis descente vers la rue), on ACCÉLÈRE cette
// descente en DÉCÉLÉRANT (rapide en haut → ralenti à l'arrivée) plutôt qu'un cut :
// on montre quand même le building, effet « retour sur terre ». L'ambiance de la
// rue arrive à l'atterrissage (intro muette → son au point de pose = renforce l'effet).
// ramp.txt : une ligne « <bout-du-nom-de-fichier> <secondes-jusqu-à-la-pose> ».
const RAMP_FILE = path.join(REGLAGES, 'ramp.txt');
// décélération sur l'intro (rapide → lent), avec une queue DOUCE vers 1× (dernier
// palier proche de la vitesse normale = atterrissage sans à-coup sur le corps).
const RAMP_SPEEDS = [9, 6, 4, 2.6, 1.7, 1.15];
function rampSettle(file) { return lookupSeconds(RAMP_FILE, file); }
// cut d'intro sec (couper.txt) : le plan démarre à la seconde donnée, sans effet.
const CUT_FILE = path.join(REGLAGES, 'couper.txt');
function readCutStart(file) { return lookupSeconds(CUT_FILE, file); }
// lit un fichier « <bout-du-nom> <secondes> » et renvoie les secondes pour ce fichier.
function lookupSeconds(listFile, file) {
  try {
    for (const l of fs.readFileSync(listFile, 'utf8').split('\n')) {
      const t = l.trim(); if (!t || t.startsWith('#')) continue;
      const m = t.match(/^(.*\S)\s+([\d.]+)\s*$/);
      if (m && path.basename(file).includes(m[1])) return parseFloat(m[2]);
    }
  } catch { /* fichier absent */ }
  return 0;
}
// Produit UN segment : l'intro rampée (muette), FIT+grade appliqués, CFR 30 fps + son
// silencieux (pour un concat homogène avec le corps qui, lui, garde l'ambiance).
// Le corps normal démarre à `settle` (géré par la boucle des ranges).
function rampSegments(file, settle, ci, pan, rid) {
  const step = settle / RAMP_SPEEDS.length;
  const slices = [];
  RAMP_SPEEDS.forEach((k, i) => {
    const a = step * i, b = step * (i + 1);
    // ORDRE CRUCIAL : setpts (accélération) AVANT le fps final → tranche CFR 30 fps
    // propre. setpts APRÈS fps casse la timeline au concat. Tranches MUETTES (-an) :
    // anullsrc+`-shortest` pendant l'encodage setpts donnait 6 fps (saccade vécue) →
    // le son silencieux est ajouté en UNE passe séparée après concat.
    // même recadrage sujet-aware que le corps du plan (cohérence intro↔corps).
    // badge R## (brouillon) après format pour que l'intro rampée porte le même repère.
    const vfRamp = `scale=${VID_W}:${VID_H}:force_original_aspect_ratio=increase`
      + `,crop=${VID_W}:${VID_H}${pan ? `:${pan.x}:${pan.y}` : ''}${gradeFor(file)},setpts=PTS/${k},fps=${FPS},format=yuv420p`
      + ridTag(rid);
    const seg = path.join(WORK, `rampslice_${String(ci).padStart(3, '0')}_${i}.mp4`);
    try {
      sh('ffmpeg', ['-y', '-ss', a.toFixed(3), '-to', b.toFixed(3), '-i', file, '-an',
        '-vf', vfRamp, ...VENC(), seg], { stdio: ['ignore', 'ignore', 'ignore'] });
      if (fs.existsSync(seg)) slices.push(seg);
    } catch { /* tranche illisible → on saute */ }
  });
  if (!slices.length) return [];
  const lst = path.join(WORK, `ramp_${ci}_list.txt`);
  fs.writeFileSync(lst, slices.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'));
  const mute = path.join(WORK, `ramp_${ci}_mute.mp4`);
  const intro = path.join(WORK, `ramp_${ci}_intro.mp4`);
  try {
    sh('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', lst, '-c', 'copy', mute],
      { stdio: ['ignore', 'ignore', 'ignore'] });
    // video finie + anullsrc infini + -shortest → coupe à la vidéo (là, -shortest est sûr)
    sh('ffmpeg', ['-y', '-i', mute, '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
      '-shortest', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2', intro],
      { stdio: ['ignore', 'ignore', 'ignore'] });
    return fs.existsSync(intro) ? [intro] : slices;
  } catch { return slices; }
}

function assembleAmbiance(clips, outFile) {
  const da = readDA();
  const holdMovement = da ? da.holdMovement : false;
  const parts = [];
  // MANIFESTE des segments (work/amb_parts.json) — même ORDRE que `parts`. Il dit quel
  // fichier encodé correspond à quel R## et à quelle fenêtre source. C'est ce qui permet
  // à un assemblage AVAL (vlog.mjs : bandes landscape entrelacées avec le facecam) de
  // recoller des plans EXACTS sans re-couper au timecode dans le master du jour.
  const manifest = [];
  const useCache = cacheOn();
  const daLabel = da ? da.label : '';
  const lutLabel = (() => { const L = activeLut(); return L ? (typeof L === 'string' ? L : JSON.stringify(L)) : ''; })();
  const quality = readQuality();
  const reperes = reperesOn();
  let nHit = 0, nEnc = 0;
  // AVANT d'encoder quoi que ce soit : verrouiller le batch JOUR/NUIT par scène. Les plans
  // arrivent ici dans l'ordre du tournage, ce qui est exactement l'ordre dont la règle a besoin.
  lockSceneBatches(clips.map((c) => c.file), log);
  clips.forEach((c, ci) => {
    // recadrage sujet-aware + FIT + domptage hi + adaptatif palette + anti-bloom + badge.
    // Coûteux (cropPan/adaptatif MESURENT le plan) → calculés PARESSEUSEMENT : sur un
    // cache-hit on ne les calcule pas du tout (c'est là tout le gain). Mémoïsés au 1er miss.
    let _pan = null, _vf = null, _ready = false;
    const ensureVf = () => {
      if (_ready) return;
      _pan = cropPan(c.file);
      // Sous une LUT, la LUT DÉFINIT la palette → on court-circuite l'adaptatif (hi/glow restent).
      const adj = activeLut() ? '' : adaptiveColor(c.file);
      _vf = FIT(_pan, c.file) + hiTame(c.hi) + adj + deBloom(c.glow) + ridTag(c.rid);
      _ready = true;
    };
    let ranges, tag;
    if (c.curated) {
      // PLAN GELÉ : les keep-ranges de Claude, exécutés TELS QUELS. Aucune coupe morte,
      // aucun capping mouvement, aucune intro auto — la décision est déjà prise à l'œil.
      ranges = (c.planRanges && c.planRanges.length ? c.planRanges : [[0, c.duration]])
        .map(([a, b]) => [Math.max(0, a), Math.min(c.duration, b)])
        .filter(([a, b]) => b - a > 0.2);
      if (!ranges.length) ranges = [[0, c.duration]];
      tag = `curé ${ranges.map(([a, b]) => `${a.toFixed(1)}–${b.toFixed(1)}`).join(' ')}`;
    } else {
      ranges = keepRanges(c.duration, deadRanges(c.file, c.duration));
      if (!ranges.length) ranges = [[0, c.duration]];   // rien de sûr à couper → plan entier
      // Durée pilotée par le MOUVEMENT (règle du monteur) : un plan MOUVEMENT se tient
      // entier (couper court = tournis) ; un plan FIXE peut être resserré (façon la chaîne de référence).
      tag = 'entier';
      if (holdMovement) {
        const m = motionScore(c.file);
        if (m !== null && m < MOTION_STATIC) {
          const head = ranges[0][0], tail = ranges[ranges.length - 1][1];
          if (tail - head > AMB_STATIC_CAP) {
            const from = head + (tail - head - AMB_STATIC_CAP) / 2;
            ranges = [[from, from + AMB_STATIC_CAP]];   // fenêtre centrale, plan resserré
            tag = `FIXE ${m.toFixed(1)} → cappé ${AMB_STATIC_CAP}s`;
          } else tag = `fixe ${m.toFixed(1)}`;
        } else if (m !== null) tag = `mouvement ${m.toFixed(1)} → tenu`;
      }
      // intro : soit CUT sec (couper.txt, le plan démarre à la seconde donnée), soit
      // SPEED-RAMP (ramp.txt). Le cut est prioritaire — c'est le « juste au début du
      // no-speed » sans effet. (Ignorés en plan curé.)
      const cut = readCutStart(c.file);
      const settle = cut > 0 ? 0 : rampSettle(c.file);
      if (cut > 0) {
        ranges = ranges.map(([a, b]) => [Math.max(a, cut), b]).filter(([a, b]) => b - a >= AMB_MIN_KEEP);
        tag += ` + intro coupée à ${cut}s`;
      } else if (settle > 0) {
        ensureVf();   // l'intro rampée a besoin du pan
        const intro = rampSegments(c.file, settle, ci, _pan, c.rid);
        parts.push(...intro);
        intro.forEach((f) => manifest.push({ file: f, rid: c.rid, rush: path.basename(c.file), kind: 'ramp' }));
        ranges = ranges.map(([a, b]) => [Math.max(a, settle), b]).filter(([a, b]) => b - a >= AMB_MIN_KEEP);
        tag += ` + intro rampée ${settle}s→${(settle / RAMP_SPEEDS.length * RAMP_SPEEDS.reduce((s, k) => s + 1 / k, 0)).toFixed(1)}s`;
      }
    }
    let localHit = 0, localEnc = 0;
    ranges.forEach(([from, to], ri) => {
      // clé cache : rush + range + flags + grade + badge + qualité (PAS besoin de mesurer)
      // `mute` n'entre dans la clé QUE s'il est vrai : sinon on ajouterait un champ à
      // TOUS les segments déjà en cache (la clé est un hash du JSON) et on les jetterait.
      // MÊME RUSE pour `rep` : le badge R## est brûlé DANS le segment, donc repères off/on
      // donnent deux images différentes pour la même clé — sans ce champ, un rendu « nu »
      // resservait les segments BADGÉS du cache (bug silencieux, l'image seule le dirait).
      // ⚠ `bat` : le batch JOUR/NUIT n'est plus déterminé par le SEUL contenu du fichier depuis
      // le verrou de scène — il dépend des plans VOISINS. La clé doit donc le porter, sinon un
      // plan réaligné par sa scène ressort du cache avec son ANCIEN étalonnage, en silence.
      // Même ruse que `mute`/`rep` : le champ n'entre dans la clé QUE pour les plans que la
      // scène CONTREDIT — les autres gardent leur clé, donc tout le cache existant survit.
      const key = segKey(c.file, from, to,
        { hi: c.hi || 0, glow: !!c.glow, da: daLabel, gsig: GRADE_SIG, lut: lutLabel, q: quality, rid: c.rid, cur: !!c.curated, ...(c.mute ? { mute: 1 } : {}), ...(reperes ? {} : { rep: 0 }), ...(_sceneForced.has(c.file) ? { bat: _sceneDay.get(c.file) ? 'J' : 'N' } : {}), ...(DEF === 2160 ? { def: 2160 } : {}) });
      const cached = path.join(CACHE, `seg_${key}.mp4`);
      if (useCache && fs.existsSync(cached)) {   // déjà rendu → réutilisé tel quel
        parts.push(cached);
        manifest.push({ file: cached, rid: c.rid, rush: path.basename(c.file), from, to, kind: 'plan' });
        touchCache(cached); localHit++; nHit++; return;
      }
      ensureVf();
      const seg = path.join(WORK, `amb_${String(ci).padStart(3, '0')}_${ri}.mp4`);
      try {
        // flag `muet` : on garde la piste audio DU RUSH et on la multiplie par 0. Surtout
        // PAS une 2e entrée anullsrc + `-shortest` : l'encodeur rendait alors 3,114 s d'audio
        // pour 3,000 s de vidéo (mesuré), et ces 114 ms par plan muet décalent tout l'aval
        // du concat. Ici la piste garde exactement la durée de la vidéo, comme les autres.
        const silent = !!c.mute;
        sh('ffmpeg', ['-y', '-ss', from.toFixed(3), '-to', to.toFixed(3), '-i', c.file,
          '-vf', _vf, ...VENC(),
          ...(silent ? ['-af', 'volume=0'] : []),
          '-map', '0:v:0', '-map', '0:a:0?', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2',
          seg], { stdio: ['ignore', 'ignore', 'ignore'] });
        if (fs.existsSync(seg)) {
          if (useCache) { try { fs.copyFileSync(seg, cached); } catch {} }
          const partFile = useCache && fs.existsSync(cached) ? cached : seg;
          parts.push(partFile);
          manifest.push({ file: partFile, rid: c.rid, rush: path.basename(c.file), from, to, kind: 'plan' });
          localEnc++; nEnc++;
        }
      } catch { /* morceau illisible → on saute */ }
    });
    if (_ready && _pan && _pan.note) tag += ` + recadré sujet ${_pan.note}`;
    const kept = ranges.reduce((a, [x, y]) => a + (y - x), 0);
    const note = localHit && !localEnc ? ' ♻ réutilisé' : localHit ? ` ♻ ${localHit}/${localHit + localEnc} en cache` : '';
    log(`    · ${path.basename(c.file)} : ${kept.toFixed(1)}s / ${c.duration.toFixed(1)}s [${tag}]${note}`);
  });
  if (useCache) { log(`  · cache segments : ${nHit} réutilisé(s), ${nEnc} (re)calculé(s)`); pruneCache(); }
  if (!parts.length) throw new Error('aucun plan d’ambiance produit');
  // manifeste : seulement s'il couvre TOUS les segments (sinon il mentirait sur l'ordre)
  try {
    if (manifest.length === parts.length) {
      const txt = JSON.stringify(manifest, null, 1);
      fs.writeFileSync(path.join(WORK, 'amb_parts.json'), txt);
      // ⚠ `work/` est VIDÉ par cleanWork() en fin de run : la copie utile est celle-ci,
      // hors de work/ (c'est elle que lit vlog.mjs, via vlog/parts-<jour>.json).
      const vd = path.join(ENGINE, 'vlog'); fs.mkdirSync(vd, { recursive: true });
      fs.writeFileSync(path.join(vd, 'parts-last.json'), txt);
    }
  } catch { /* le manifeste est un bonus, jamais un motif d'échec du montage */ }
  const listFile = path.join(WORK, 'amb_concat.txt');
  fs.writeFileSync(listFile, parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'));
  const raw = path.join(WORK, 'amb_raw.mp4');
  sh('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', raw],
    { stdio: ['ignore', 'ignore', 'ignore'] });
  if (!normalizeAudio(raw, outFile)) fs.copyFileSync(raw, outFile);  // au pire, le montage brut
  return outFile;
}

// loudnorm DEUX passes : passe 1 mesure, passe 2 applique en linéaire → niveau ET
// vrai pic (inter-échantillon) exacts. Le single-pass dynamique dépassait la cible
// (batch #1 : +1 dBFS). Renvoie false si la mesure échoue (repli = pas de normalisation).
function normalizeAudio(inFile, outFile) {
  try {
    const r = spawnSync('ffmpeg', ['-hide_banner', '-i', inFile, '-map', '0:a:0',
      '-af', `loudnorm=I=${AMB_LUFS}:TP=${AMB_TP}:LRA=11:print_format=json`, '-f', 'null', '-'],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    const m = (r.stderr || '').match(/\{[\s\S]*?\}/);
    if (!m) return false;
    const j = JSON.parse(m[0]);
    sh('ffmpeg', ['-y', '-i', inFile, '-c:v', 'copy', '-af',
      `loudnorm=I=${AMB_LUFS}:TP=${AMB_TP}:LRA=11:measured_I=${j.input_i}:measured_TP=${j.input_tp}`
      + `:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true`,
      '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', outFile],
      { stdio: ['ignore', 'ignore', 'ignore'] });
    return fs.existsSync(outFile);
  } catch { return false; }
}

// ---- musique de fond en mode PARLÉ, baissée sous la voix (ducking) ----------
// Sans ça, une musique déposée n'est utilisée qu'en mode beat et ignorée en vlog.
function mixMusicUnderSpeech(finalPath, musicFile) {
  const tmp = path.join(WORK, 'mixed.mp4');
  try {
    sh('ffmpeg', ['-y', '-i', finalPath, '-i', musicFile,
      '-filter_complex',
      '[1:a]aloop=loop=-1:size=2e9,volume=0.18[m];' +
      '[m][0:a]sidechaincompress=threshold=0.03:ratio=8:attack=5:release=400[md];' +
      '[0:a][md]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]',
      '-map', '0:v', '-map', '[a]',
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', tmp],
      { stdio: ['ignore', 'ignore', 'ignore'] });
    if (fs.existsSync(tmp)) { fs.renameSync(tmp, finalPath); return true; }
  } catch { /* pas de musique plutôt qu'un montage perdu */ }
  return false;
}

// ---- LIT MUSICAL sous un montage d'AMBIANCE (musique = lit, ambiance de rue duckée dessous) ----
// Terrain préparé (le monteur 17/07) : dès qu'un morceau est déposé dans « Musique (optionnel) », un montage
// d'ambiance curé le pose en lit. ≠ mode BEAT (pas de coupe sur le beat : la doctrine tient les plans) ;
// ≠ mixMusicUnderSpeech (là la VOIX est reine). Ici la MUSIQUE porte, l'ambiance passe en texture,
// sidechain-duckée sous elle, puis le tout re-normalisé à AMB_LUFS. Non destructif (repli = sans lit).
function mixMusicBed(finalPath, musicFile) {
  const tmp = path.join(WORK, 'bed.mp4');
  try {
    sh('ffmpeg', ['-y', '-i', finalPath, '-i', musicFile,
      '-filter_complex',
      '[1:a]aloop=loop=-1:size=2e9,volume=0.9[bed];' +               // musique = lit (porte le mix)
      '[0:a]volume=0.5[amb];' +                                       // ambiance de rue abaissée (texture)
      '[amb][bed]sidechaincompress=threshold=0.03:ratio=6:attack=8:release=350[ambd];' + // duckée sous la musique
      '[bed][ambd]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mix];' +
      `[mix]loudnorm=I=${AMB_LUFS}:TP=${AMB_TP}:LRA=11[a]`,           // re-cale le lit au niveau cible
      '-map', '0:v', '-map', '[a]',
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', tmp],
      { stdio: ['ignore', 'ignore', 'ignore'] });
    if (fs.existsSync(tmp)) { fs.renameSync(tmp, finalPath); return true; }
  } catch { /* pas de lit plutôt qu'un montage perdu */ }
  return false;
}

// ═══ MODE C — carte-titre d'intro animée (optionnelle, 100% offline) ═════════
// Si un fichier `titre.txt` est déposé à la racine (ligne 1 = titre, ligne 2 = sous-
// titre), on incruste une intro animée : HTML rendu par un Chrome DÉJÀ installé
// (look riche), sinon repli ASS/libass (léger). Sans titre.txt → on ne touche à rien.
const TITLE_FILE = path.join(REGLAGES, 'titre.txt');
const OVERLAY_DIR = path.join(ENGINE, 'overlay');
const TITLE_DUR = 3.6;
const NODE_BIN = process.execPath;

function readTitle() {
  try {
    if (!fs.existsSync(TITLE_FILE)) return null;
    const lines = fs.readFileSync(TITLE_FILE, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
    if (!lines.length) return null;
    return { title: lines[0].slice(0, 40), subtitle: (lines[1] || '').slice(0, 40) };
  } catch { return null; }
}
function buildTitleASS(title, subtitle) {
  const clean = (s) => (s || '').replace(/[{}\\]/g, '');
  const T = clean(title), S = clean(subtitle);
  const tf = Math.round(VID_H * 0.14), sf = Math.round(VID_H * 0.048);
  const end = `0:00:0${TITLE_DUR.toFixed(2)}`;
  const head =
`[Script Info]
ScriptType: v4.00+
PlayResX: ${VID_W}
PlayResY: ${VID_H}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Ttl,Arial,${tf},&H00FFFFFF,&H00FFFFFF,${ASS_OUTLINE},&H00000000,-1,0,0,0,100,100,2,0,1,4,0,5,0,0,0,1
Style: Sub,Arial,${sf},${ASS_VIOLET},${ASS_VIOLET},${ASS_OUTLINE},&H00000000,-1,0,0,0,100,100,8,0,1,3,0,5,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;
  const ev = [`Dialogue: 0,0:00:00.20,${end},Ttl,,0,0,0,,{\\pos(${VID_W / 2},${Math.round(VID_H * 0.46)})\\fad(450,500)\\t(0,550,\\fscx112\\fscy112)\\t(550,950,\\fscx100\\fscy100)}${T}`];
  if (S) ev.push(`Dialogue: 0,0:00:00.55,${end},Sub,,0,0,0,,{\\pos(${VID_W / 2},${Math.round(VID_H * 0.57)})\\fad(500,500)}${S}`);
  return head + '\n' + ev.join('\n') + '\n';
}
// applique l'intro sur finalPath (remplace en place). Renvoie 'html' | 'ass' | null.
function applyIntroTitle(finalPath) {
  const t = readTitle();
  if (!t) return null;
  const tmp = path.join(WORK, 'titled.mp4');
  // 1) HTML animé via Chrome existant
  try {
    const framesDir = path.join(OVERLAY_DIR, 'frames');
    sh(NODE_BIN, [path.join(OVERLAY_DIR, 'render-title.mjs'), path.join(OVERLAY_DIR, 'title.html'),
      framesDir, String(FPS), String(TITLE_DUR), t.title, t.subtitle],
      { stdio: ['ignore', 'ignore', 'ignore'] });
    if (fs.existsSync(path.join(framesDir, 'f_0000.png'))) {
      sh('ffmpeg', ['-y', '-i', finalPath, '-framerate', String(FPS), '-i', path.join(framesDir, 'f_%04d.png'),
        '-filter_complex', '[1:v]format=rgba[ov];[0:v][ov]overlay=0:0:eof_action=pass:format=auto[v]',
        '-map', '[v]', '-map', '0:a?', ...VENC(),
        '-pix_fmt', 'yuv420p', '-c:a', 'copy', tmp], { stdio: ['ignore', 'ignore', 'ignore'] });
      if (fs.existsSync(tmp)) { fs.renameSync(tmp, finalPath); return 'html'; }
    }
  } catch { /* repli ASS */ }
  // 2) repli ASS/libass
  try {
    if (!canBurnSubs()) return null;
    const assPath = path.join(WORK, 'title.ass');
    fs.writeFileSync(assPath, buildTitleASS(t.title, t.subtitle));
    sh('ffmpeg', ['-y', '-i', finalPath, '-vf', `ass='${assPath.replace(/'/g, "\\'")}'`,
      ...VENC(), '-c:a', 'copy', tmp],
      { stdio: ['ignore', 'ignore', 'ignore'] });
    if (fs.existsSync(tmp)) { fs.renameSync(tmp, finalPath); return 'ass'; }
  } catch { /* pas de titre plutôt qu'un échec */ }
  return null;
}

// ═══ PROJET PERSISTANT — permet d'ITÉRER sans relancer l'analyse ═════════════
// Chaque montage laisse : transcript.txt (lisible), edl.json (ÉDITABLE) et
// project.json. Claude Code réécrit edl.json puis `node monte.mjs --render`
// refabrique la vidéo en quelques secondes (Whisper n'est PAS relancé).
const PROJECTS = path.join(ENGINE, 'projects');

function saveProject(stamp, data) {
  const dir = path.join(PROJECTS, stamp);
  fs.mkdirSync(dir, { recursive: true });
  const { edl, ...meta } = data;
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(meta, null, 2));
  // instantané du plan + jour AYANT produit ce rendu → la visionneuse reconstruit
  // sa bande exacte quand le monteur rouvre ce montage précis (pas juste le dernier).
  try { if (fs.existsSync(PLAN_FILE)) fs.copyFileSync(PLAN_FILE, path.join(dir, 'plan.txt')); } catch {}
  try { fs.copyFileSync(path.join(REGLAGES, 'jour.txt'), path.join(dir, 'jour.txt')); } catch {}
  if (edl) fs.writeFileSync(path.join(dir, 'edl.json'), JSON.stringify(edl, null, 2));
  const txt = data.clips.map((c) =>
    `### ${path.basename(c.file)}  (${c.duration.toFixed(1)}s)\n` +
    (c.segs.length
      ? c.segs.map((s) => `[${s.from.toFixed(1)} → ${s.to.toFixed(1)}] ${s.text}`).join('\n')
      : '(aucune parole — plan d\'ambiance)')
  ).join('\n\n');
  fs.writeFileSync(path.join(dir, 'transcript.txt'), txt + '\n');
  return dir;
}

function latestProject() {
  if (!fs.existsSync(PROJECTS)) return null;
  const d = fs.readdirSync(PROJECTS).filter((x) => !x.startsWith('.')).sort();
  return d.length ? d[d.length - 1] : null;
}

// Re-rend une vidéo depuis un edl.json (éventuellement modifié). Ne touche ni
// aux rushes ni aux transcripts → itération en secondes.
function renderFromProject(stampArg) {
  ensureDirs();
  const st = (!stampArg || stampArg === 'latest') ? latestProject() : stampArg;
  if (!st) { log('aucun projet à re-rendre'); return; }
  const dir = path.join(PROJECTS, st);
  const pj = path.join(dir, 'project.json'), ej = path.join(dir, 'edl.json');
  if (!fs.existsSync(pj)) { log(`projet introuvable : ${st}`); return; }
  const proj = JSON.parse(fs.readFileSync(pj, 'utf8'));
  if (!fs.existsSync(ej)) { log(`projet « ${st} » en mode ${proj.mode} : pas d'EDL, re-rendu non supporté`); return; }
  const edl = JSON.parse(fs.readFileSync(ej, 'utf8'));
  const missing = [...new Set(edl.map((e) => e.file))].filter((f) => !fs.existsSync(f));
  if (missing.length) { log(`❌ rushes introuvables : ${missing.map((m) => path.basename(m)).join(', ')}`); return; }
  cleanWork();
  let v = 2; while (fs.existsSync(path.join(OUT, `Montage ${st} v${v}.mp4`))) v++;
  const finalName = `Montage ${st} v${v}.mp4`;
  const finalPath = path.join(OUT, finalName);
  const dur = edl.reduce((a, e) => a + (e.to - e.from), 0);
  log(`▶ re-rendu ${st} : ${edl.length} plans, ${(dur / 60).toFixed(1)} min → ${finalName}`);
  try {
    const raw = path.join(WORK, 'montage_raw.mp4');
    assemble(edl, raw);
    const cap = captionize(raw, finalPath);
    log(`  · sous-titres : ${cap.mode}`);
    if (proj.music && fs.existsSync(proj.music) && mixMusicUnderSpeech(finalPath, proj.music)) {
      log(`  · musique mixée (${path.basename(proj.music)})`);
    }
    const tm = applyIntroTitle(finalPath);
    if (tm) log(`  · intro titrée : ${tm}`);
    log(`✅ nouvelle version → ${finalPath}`);
    notify('🎬 Nouvelle version prête', finalName);
    cleanWork();
  } catch (e) {
    log(`❌ re-rendu échoué : ${e.message}`);
  }
}

// ---- orchestration ----------------------------------------------------------
function cleanWork() { fs.rmSync(WORK, { recursive: true, force: true }); fs.mkdirSync(WORK, { recursive: true }); }

async function main() {
  ensureDirs();
  // verrou anti-double-exécution
  if (fs.existsSync(LOCK)) {
    const age = Date.now() - fs.statSync(LOCK).mtimeMs;
    if (age < 3 * 3600 * 1000) { log('déjà en cours, on sort'); return; }
    fs.rmSync(LOCK, { force: true }); // verrou périmé
  }
  // 0) numérotation-dans-le-nom : à CHAQUE passage on préfixe R## (badge) au nom des
  //    rushes du jour actif, et on contrôle/corrige au cas où (idempotent). Ne touche
  //    pas le stamp DJI → l'ordre R## reste identique. Jamais bloquant pour le rendu.
  try {
    const r = sh(NODE_BIN, [path.join(ENGINE, 'numeroter.mjs')]);
    const last = (r || '').trim().split('\n').pop();
    if (last) log(`  · numérotation des rushes : ${last}`);
  } catch (e) { log(`  · numérotation ignorée (${e.message})`); }

  const rushes = listRushes();
  if (!rushes.length) { log('rien à monter'); return; }
  fs.writeFileSync(LOCK, String(process.pid));
  const t0 = Date.now();
  try {
    log(`▶ montage de ${rushes.length} rush(s)`);
    { const j = readJours(); if (j.length) log(`  · jour(s) ciblé(s) (jour.txt) : ${j.join(', ')}`); }
    log(`  · qualité : ${readQuality() === 'final' ? 'FINALE (libx264 CRF16, lent)' : 'brouillon (rapide)'}`);
    const _da = readDA();
    if (_da) log(`  · DA « ${_da.label} » : ${_da.desc}`);
    else if (gradeChain()) log('  · grade cinéma actif (grade.txt) : filmique chaud, faible contraste');
    notify('🎬 Montage lancé', `${rushes.length} rush(s) en cours…`);
    cleanWork();

    // 0) plan de coupe curé ? Si Réglages/plan.txt existe, on EXÉCUTE ce plan gelé :
    //    pas de whisper (curation déjà faite à l'œil), pas de coupe mécanique.
    const plan = readPlan();
    if (plan) {
      // Garde-fou anti-panne-silencieuse : le plan a-t-il bien été écrit pour le jour scopé ?
      const chk = checkPlanDay();
      if (chk.level === 'warn') log(`  ⚠️  ${chk.msg}`);
      if (!chk.ok) {
        log(`  ⛔ ARRÊT — plan.txt / jour.txt incohérents :\n       ${chk.msg}`);
        throw new Error(`plan.txt écrit pour ${planDeclaredDay()}, jour.txt cible ${readJours().join(', ')}`);
      }
      log(`  · PLAN DE COUPE curé (plan.txt) : ${plan.length} plan(s) → transcription sautée`);
    }

    // 1) transcription de chaque rush (sautée si plan curé : inutile)
    let clips = [];
    rushes.forEach((file, i) => {
      const duration = ffprobeDuration(file);
      // rid = numéro catalogue R## (index chrono jour-scopé, +1) : listRushes() a
      // EXACTEMENT l'ordre/scope de catalogue.mjs → R## affiché == R## des planches.
      if (plan) { clips.push({ file, duration, segs: [], lang: null, rid: i + 1 }); return; }
      log(`  · analyse ${path.basename(file)} (${duration.toFixed(0)}s)`);
      const tr = transcribe(file, `r${i}`);
      const segs = cleanSegs(tr.segs, duration, file);
      log(`    ${segs.length} segment(s) parlé(s)${tr.lang ? ` [${tr.lang}]` : ''}`);
      clips.push({ file, duration, segs, lang: tr.lang, rid: i + 1 });
    });

    // 1b) REJET des déclenchements ACCIDENTELS : un rush sous le plancher de perceptibilité
    //     ne porte aucun plan lisible (erreur de record). Il ne doit jamais atteindre la
    //     timeline. On garde le rid (numéro catalogue R##) sur les survivants → planches OK.
    //     Sauté si plan.txt curé (le monteur a déjà trié à l'œil : sa liste fait foi).
    if (!plan) {
      const before = clips.length;
      clips = clips.filter((c) => {
        if (c.duration > 0 && c.duration < MIN_SHOT_PERCEPTIBLE) {
          log(`  · REJET R${String(c.rid).padStart(2, '0')} : ${c.duration.toFixed(2)}s < ${MIN_SHOT_PERCEPTIBLE}s → déclenchement accidentel (imperceptible), écarté du montage`);
          return false;
        }
        return true;
      });
      if (clips.length < before) log(`  · ${before - clips.length} rush(s) accidentel(s) écarté(s) ; ${clips.length} conservé(s)`);
    }

    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const finalName = `Montage ${stamp}.mp4`;
    const finalPath = path.join(OUT, finalName);

    // 2) choix du mode : paysages (peu/pas de parole) + une musique déposée → calé sur le beat ;
    //    sinon talking-head (EDL coupe temps morts + sous-titres karaoké).
    const totalDur = clips.reduce((a, c) => a + c.duration, 0);
    const totalSpeech = clips.reduce((a, c) => a + c.segs.reduce((s, x) => s + (x.to - x.from), 0), 0);
    const music = pickMusic();
    const forced = readMode();
    if (forced !== 'auto') log(`  · mode forcé par mode.txt : ${forced}`);

    // exclusion des plans avec la voix du monteur (pas voulue en montage d'ambiance).
    // Deux sources, en union : (1) exclure.txt manuel ; (2) auto — whisper détecte du
    // FRANÇAIS avec de la vraie parole = c'est le monteur qui parle (l'ambiance de rue chinoise
    // ne produit que des hallucinations en langue exotique, jamais du français tenu).
    const excl = readExclude();
    const isManual = (c) => excl.some((e) => path.basename(c.file).includes(e));
    const isOwnVoice = (c) => /^fr/i.test(c.lang || '') && c.segs.length > 0;
    // Avec un plan curé : ambClips = les rushes LISTÉS, dans l'ordre du plan, avec
    // leurs keep-ranges (curated). Sinon : filtre voix/manuel comme avant.
    const byRid = new Map(clips.map((c) => [c.rid, c]));
    const ambClips = plan
      ? plan.map((e) => {
          const c = byRid.get(e.rid);
          if (!c) { log(`  · plan : R${String(e.rid).padStart(2, '0')} introuvable (hors scope jour ?) → ignoré`); return null; }
          return { ...c, curated: true, planRanges: e.ranges, hi: e.hi, glow: e.glow, mute: e.mute };
        }).filter(Boolean)
      : clips.filter((c) => {
          if (isManual(c)) { log(`  · écarté (exclure.txt) : ${path.basename(c.file)}`); return false; }
          if (isOwnVoice(c)) { log(`  · écarté (voix FR détectée) : ${path.basename(c.file)}`); return false; }
          return true;
        });

    const ambianceMode = !!plan || forced === 'ambiance';
    const noSpeech = forced !== 'auto'
      ? forced === 'rythme' || forced === 'beat'
      : totalDur > 0 && totalSpeech < Math.max(3, totalDur * 0.10);
    const beatMode = !!music && noSpeech && forced !== 'rythme' && !ambianceMode;
    // Des rushes de paysage/ville n'ont que de l'ambiance : lancer le mode parlé
    // dessus ferait halluciner whisper et couperait sur du bruit de foule. Sans
    // musique pour donner le tempo, on coupe sur une grille régulière.
    const rhythmMode = !ambianceMode && noSpeech && !beatMode;
    let outDur, edlUsed = null;

    if (ambianceMode) {
      // 3D) montage d'ambiance : plans entiers enchaînés, morts sûrs rognés
      log(`  · mode AMBIANCE (B-roll enchaîné, ${ambClips.length} plan(s))`);
      if (!ambClips.length) throw new Error('aucun plan d’ambiance (tout exclu ?)');
      assembleAmbiance(ambClips, finalPath);
      // lit musical si un morceau est déposé (sinon ambiance seule, comportement actuel)
      if (music && mixMusicBed(finalPath, music)) log(`  · lit musical posé (${path.basename(music)}, ambiance duckée dessous)`);
      outDur = ffprobeDuration(finalPath);
      log(`  · monté → ${finalName}`);
    } else if (beatMode || rhythmMode) {
      // 3B) montage calé sur le beat, ou coupes régulières à défaut de musique
      let montageDur, segDurs;
      if (beatMode) {
        log(`  · mode BEAT (musique : ${path.basename(music)}, parole ${totalSpeech.toFixed(0)}s / ${totalDur.toFixed(0)}s)`);
        const beats = detectBeats(music);
        log(`    ${beats.length} beat(s) détecté(s)`);
        if (beats.length < 4) throw new Error('trop peu de beats — musique inexploitable');
        montageDur = Math.min(ffprobeDuration(music), totalDur, TARGET_MAX_MIN * 60);
        segDurs = buildBeatSegments(beats, montageDur);
      } else {
        log(`  · mode RYTHME (aucune musique, parole ${totalSpeech.toFixed(0)}s / ${totalDur.toFixed(0)}s → ambiance conservée)`);
        montageDur = Math.min(totalDur, TARGET_MAX_MIN * 60);
        segDurs = [];
        for (let t = 0; t + RHYTHM_SHOT <= montageDur; t += RHYTHM_SHOT) segDurs.push(RHYTHM_SHOT);
        if (!segDurs.length) segDurs.push(Math.max(0.5, montageDur));
      }
      log(`    ${segDurs.length} plan(s) sur ${(montageDur / 60).toFixed(1)} min`);
      assembleBeat(clips, segDurs, beatMode ? music : null, finalPath);
      outDur = ffprobeDuration(finalPath);
      log(`  · monté → ${finalName}`);
    } else {
      // 3A) talking-head : EDL → assemblage → sous-titres karaoké
      const edl = buildEDL(clips);
      edlUsed = edl;
      outDur = edl.reduce((a, e) => a + (e.to - e.from), 0);
      log(`  · EDL : ${edl.length} plans, ${(outDur / 60).toFixed(1)} min`);
      if (!edl.length) throw new Error('EDL vide');
      const raw = path.join(WORK, 'montage_raw.mp4');
      assemble(edl, raw);
      log('  · assemblé');
      const cap = captionize(raw, finalPath);
      log(`  · sous-titres : ${cap.mode} → ${finalName}`);
      if (music && mixMusicUnderSpeech(finalPath, music)) {
        log(`  · musique de fond mixée sous la voix (${path.basename(music)})`);
      }
    }

    // 4) intro titrée optionnelle (titre.txt déposé)
    const titleMode = applyIntroTitle(finalPath);
    if (titleMode) log(`  · intro titrée : ${titleMode}`);

    // 4bis) PROXY DE TRAVAIL (brouillon) : timecode global courant gravé sur toute la
    //   vidéo → le monteur peut itérer en citant un temps (« à 1:23 »). En ambiance, chaque
    //   plan porte déjà son badge R##. Le final (qualite=final) ne reçoit aucun habillage.
    if (stampTimecode(finalPath)) {
      log(`  · brouillon repéré : timecode global${ambianceMode ? ' + badges R## par plan' : ''}`);
    }

    // 5) BIBLIOTHÈQUE STABLE : les rushes RESTENT dans INBOX (on ne les déplace plus).
    //    le monteur dépose tout une fois, on source/curate/re-rend depuis là sans ré-importer.
    //    (jamais supprimés — c'était le rôle de l'archivage, désormais inutile.)

    // 5bis) projet persistant : transcripts + EDL pointant vers les rushes en place.
    const remap = (p) => p;
    const pdir = saveProject(stamp, {
      stamp,
      mode: ambianceMode ? 'D (ambiance)' : beatMode ? 'B (beat)' : rhythmMode ? 'RYTHME' : 'A (parlé)',
      da: (readDA() || {}).key || null,
      music: music || null,
      out: finalPath,
      clips: clips.map((c) => ({ file: remap(c.file), duration: c.duration, segs: c.segs })),
      edl: edlUsed ? edlUsed.map((e) => ({ ...e, file: remap(e.file) })) : null,
    });
    log(`  · projet → ${pdir}`);

    const mins = ((Date.now() - t0) / 60000).toFixed(1);
    log(`✅ terminé en ${mins} min → ${finalPath}`);
    notify('🎬 Ta vidéo est prête', `${finalName} (${(outDur / 60).toFixed(1)} min)`);
    cleanWork();
  } catch (e) {
    log(`❌ ÉCHEC : ${e.message}`);
    notify('⚠️ Montage échoué', 'Rushes conservés. Voir .engine/montage.log');
  } finally {
    fs.rmSync(LOCK, { force: true });
  }
}

// ---- entrée CLI -------------------------------------------------------------
//   node monte.mjs              → monte les rushes déposés (daemon)
//   node monte.mjs --render     → re-rend le dernier projet depuis son edl.json
//   node monte.mjs --render <stamp>
const argv = process.argv.slice(2);
if (argv[0] === '--render') { renderFromProject(argv[1]); purgeApresRendu(); }
else main().then(purgeApresRendu);
