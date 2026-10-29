#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// vlog.mjs — ASSEMBLE UNE VIDÉO VLOG : bandes LANDSCAPE (chronologiques, jour par
// jour) entrelacées avec des blocs FACECAM (sujets entiers, jamais coupés en deux).
//
// Pourquoi un outil à part : `monte.mjs` monte UNE journée de B-roll ; `facecam/render.mjs`
// monte UNE prise parlée. Le mariage des deux sur une seule timeline est une 3ᵉ opération
// (elle ne re-monte rien, elle ORDONNE des morceaux déjà validés) — cf. MUSIQUE.md
// « mariage facecam + landscape sur 1 timeline = finalité ».
//
//   node vlog.mjs                       → lit Réglages/vlog.txt, rend LA vidéo (musique posée)
//   node vlog.mjs --dry                 → écrit seulement le plan (aucun encodage)
//   node vlog.mjs --plan <fichier>      → autre EDL que Réglages/vlog.txt
//   node vlog.mjs --nu                  → assemblage SANS musique (débogage seulement)
//
// UN SEUL LIVRABLE (le monteur, 30/07 : « à chaque rendu agrégé tu me sors 2 vidéos, j'en veux qu'une
// seule, la vraie, avec le lit musical »). L'assemblage muet est un INTERMÉDIAIRE : il est écrit
// dans `vlog/work/`, consommé par `musique.mjs plan --structure`, puis SUPPRIMÉ. Le fichier de
// « Vidéos finies » est donc toujours le bon, et il n'y a plus de suffixe ♪ à décoder.
//
// GARANTIE D'EXACTITUDE : une bande landscape n'est PAS recoupée au timecode dans le
// master du jour (le timecode dérive). Elle est reconstruite à partir des SEGMENTS
// encodés par monte.mjs (manifeste `vlog/parts-<jour>.json`) → frontières exactes.
// Le facecam, lui, est découpé aux frontières de sujets mesurées (vlog/sujets.json).
//
// GARANTIE DE SYNCHRO (30/07) : vidéo et audio sont concaténés SÉPARÉMENT, et l'audio de
// chaque morceau est recadré à la durée EXACTE de sa vidéo avant d'être abouté (cf. §5).
// Le concat démuxer `-c copy` sur les deux flux à la fois accumulait jusqu'à 0,2 s de
// décalage lèvres/son en fin de film, sans que la durée totale ne le montre.
//
// Le rendu porte une NUMÉROTATION GLOBALE regravée (R001…, F01…) + le timecode : c'est
// ce qui permet au monteur d'itérer (« raccourcis R042 », « à 7:12 »). Les masters de jour
// doivent donc être rendus NUS (`Réglages/reperes.txt` = off).
//
// DEUX NIVEAUX DE RENDU, même contrat que `monte.mjs` (`Réglages/qualite.txt`) — 31/07 :
//   · brouillon : encodeur matériel M1 + badges R###/F## + timecode → on ITÈRE.
//   · final     : libx264 CRF 16 preset slow, AUCUN repère gravé → c'est le MASTER publiable.
// Les CARTONS DE VILLE ne sont PAS des repères : ils font partie du film, ils restent dans
// les deux modes. `Réglages/reperes.txt` = off éteint les repères sans passer en final.
// ⚠ le final ne vaut que si les SEGMENTS du cache ont eux aussi été rendus en final :
// `node revlog.mjs` avec `qualite.txt` = final refait la chaîne entière sans re-couper.
//
// GÉNÉRIQUE DE FIN : directive `GENERIQUE <fichier>` dans l'EDL → le générique est un
// MORCEAU de la timeline (badge GEN), pas un overlay ni un concat posé après coup : il passe
// par le même NORM + concat séparé v/a, donc il ne peut pas introduire de dérive A/V.
// `OUTRO <secondes>` impose la durée du fondu musical de sortie (il doit tomber sur lui).
// 100 % local, aucun appel réseau.
// ═══════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
// ⚠ `new URL(import.meta.url).pathname` rend un chemin POURCENT-ENCODÉ : le moteur vit sous
// « Application Support », donc on obtiendrait « Application%20Support » et tous les chemins
// dérivés seraient introuvables. fileURLToPath décode.
import { fileURLToPath } from 'node:url';
import { STORE, purgeApresRendu } from './store.mjs';
import { ACCENT_FFMPEG } from './profil.mjs';   // l'identité visuelle vit dans le profil

const HOME = process.env.HOME;
const ENGINE = path.dirname(fileURLToPath(import.meta.url));
const REGLAGES = path.join(STORE, 'Réglages');
const VLOGDIR = path.join(ENGINE, 'vlog');
const WORK = path.join(VLOGDIR, 'work');
fs.mkdirSync(WORK, { recursive: true });

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry');
const NU = argv.includes('--nu');       // s'arrêter à l'assemblage muet (débogage)
const planPath = (() => { const i = argv.indexOf('--plan'); return i >= 0 ? argv[i + 1] : path.join(REGLAGES, 'vlog.txt'); })();

const sh = (bin, args) => execFileSync(bin, args, { encoding: 'utf8', maxBuffer: 1 << 28 });
const dur = (f) => parseFloat(sh('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).trim());
// durée du FLUX VIDÉO (≠ durée de conteneur) : c'est elle qui fait avancer la timeline au
// concat, et c'est à elle qu'on aligne l'audio de chaque morceau (cf. §5, dérive A/V).
const vdur = (f) => parseFloat(sh('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
  '-show_entries', 'stream=duration', '-of', 'csv=p=0', f]).trim());
// ⚠ 31/07 — la SEULE mesure exacte d'un morceau est son NOMBRE D'IMAGES. Le champ `duration`
// ne dit pas la même chose selon le conteneur : un mp4 rend n/30, un mpegts rend (n−1)/30
// (last_PTS − first_PTS). Faire confiance au champ, c'est ce qui a fabriqué 19 collisions de
// DTS au concat — 19 images à durée nulle, film 0,633 s plus court que sa bande son.
// Toute la chaîne est du CFR 30 (monte.mjs, les blocs facecam et le générique forcent fps=30),
// donc durée = images / 30, point. Un morceau qui n'est pas à 30 fps est une erreur, pas un cas.
const FPS = 30;
const vframes = (f) => {
  const s = JSON.parse(sh('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_packets',
    '-show_entries', 'stream=nb_read_packets,r_frame_rate', '-of', 'json', f])).streams[0];
  const [a, b] = String(s.r_frame_rate).split('/').map(Number);
  const fps = b ? a / b : a;
  if (Math.abs(fps - FPS) > 0.001) throw new Error(`${path.basename(f)} : ${fps} fps — la timeline suppose du CFR ${FPS}`);
  return Number(s.nb_read_packets);
};
// ⚠⚠ 31/08 — LES BORNES DE `sujets.json` SONT DU TEMPS DE CONTENU, `-ss` EST DU TEMPS DE PTS.
// Ce n'est pas la même horloge, et sur le master soudé du #02 elles s'écartaient jusqu'à
// 3,0 images. `fusion.mjs` calcule les frontières en CUMULANT des comptes d'images
// (borne = index ÷ 29,97) ; ffmpeg, lui, garde les images dont le PTS est ≥ `-ss`. Or les
// rendus de ville sont VFR : leur pts prend de l'avance sur l'index à chaque raccord de prise
// (jusqu'à +3,0 images à Hong Kong), et le concat de fusion.mjs remet l'offset à la durée
// EXACTE en images à chaque ville — donc le pts RECULE aux jonctions de ville (mesuré : 3 reculs,
// jusqu'à 2,0 images). Résultat : chaque bloc s'ouvrait 1 à 3 images AVANT sa frontière, donc sur
// la QUEUE de la prise précédente — « un rush inutile pendant quelques centièmes puis le bon rush
// direct » (le monteur, 30/08, sur F05, F07, F10, F19…).
//
// Ce que ce n'était PAS, mesuré avant de corriger : ni la méthode de seek (`-ss` avant `-i` rend
// image pour image la même chose que le seek en sortie), ni les bornes (elles tombent au 0 image
// près sur les coupes réelles du master). C'était l'horloge — et aucune valeur de `-ss` ne peut
// isoler la bonne image quand les pts reculent.
//
// LA PARADE : ne plus adresser le master en SECONDES du tout. La fenêtre se dit en INDEX
// D'IMAGE (`select='between(n,…)'`), on ré-horodate en CFR (`setpts=N/FRAME_RATE/TB`), puis
// `fps=30` comme avant. Un index d'image ne dépend d'aucune horloge. Coût : le décodage part du
// début du master pour chaque bloc (~5 s), au lieu d'un seek. C'est le prix de l'exactitude, et
// il est payé une seule fois par bloc grâce au cache.
// L'AUDIO, lui, est bien en temps de contenu : `fusion.mjs` le reconstruit avec le filtre
// `concat` (donc continu et monotone depuis 0), il se découpe donc en secondes — mesuré.
// ⚠ On ne peut PAS remplacer `fps=30` par un `-r 30` : afficher du 29,97 à 30 fait dériver
// l'image de 0,1 % contre le son, soit ~0,27 s sur les 4 min 30 de facecam de l'épisode.
// fps du CONTENU d'un fichier (le master facecam est en 30000/1001, pas en 30).
const fpsOf = (f) => {
  const [a, b] = String(sh('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
    'stream=r_frame_rate', '-of', 'csv=p=0', f]).trim()).split('/').map(Number);
  return b ? a / b : a;
};
const hms = (t) => {
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return `${String(h).padStart(1, '0')}:${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
};

// lecture d'un réglage — déclarée AVANT l'EDL parce que la DÉFINITION décide de quelles
// lignes de l'EDL font foi (surcharges `*_2160`, cf. plus bas).
const lire = (f, def) => { try { return fs.readFileSync(path.join(REGLAGES, f), 'utf8').trim(); } catch { return def; } };
const DEF = /2160|4k/i.test(lire('definition.txt', '1080')) ? 2160 : 1080;

// ---- 1) lecture de l'EDL -----------------------------------------------------
if (!fs.existsSync(planPath)) { console.error(`✖ EDL introuvable : ${planPath}`); process.exit(1); }
const lines = fs.readFileSync(planPath, 'utf8').split('\n');
let FACECAM = null, SUJETS = path.join(VLOGDIR, 'sujets.json'), OUT = null, TITRE = 'VLOG';
// Plans PAYSAGE où le monteur PARLE (il a gardé la prise POUR le commentaire). Ils sont déclarés
// à la main — aucune heuristique ne les trouve seule : whisper « entend » aussi la foule
// chinoise et hallucine sur le bruit de rue (cf. monte.mjs §détection de voix). Format :
//   PARLE 16-07/R02 16-07/R40
// musique.mjs les lit dans vlog.plan.json (`parle:true`) et leur donne le niveau `voix`.
const PARLE = new Set();
// CARTONS DE VILLE (le monteur, 30/07). Un carton = le nom de la ville en gros, AU CENTRE, à l'arrivée
// dans cette ville — « typo B au milieu de l'écran, Shanghai juste premier rush, on fera ça à
// chaque ville ». UN carton par ville, sur le PREMIER plan qui y arrive, jamais ailleurs : ce
// n'est pas un sous-titrage de lieu, c'est un jalon de récit.
//   CARTON R001 SHANGHAI 上海
//   CARTON R136 HONG_KONG 香港      # nom en deux mots : souligné, jamais d'espace
// (badge du plan porteur · nom · idéogrammes optionnels)
const CARTONS = [];
const CARTON_ORDRE_RESERVES = [];
// ⭐ LE RÉSOLVEUR DE CARTON VIT EN UN SEUL EXEMPLAIRE. Il en existait deux — un pour le
// contrôle d'ordre, un pour la gravure — et rien n'obligeait les deux à désigner le même
// plan. *Quand deux outils résolvent la même chose et se contredisent, l'un des deux ment,
// et on ne le sait jamais tant que la règle vit en deux endroits* (leçon du 06/09, sweep vs
// parole). Ici la conséquence aurait été muette et grave : le garde valide l'ordre sur un
// plan, ffmpeg grave le titre sur un autre.
const memePlan = (r, ref) => {
  const m = String(r.origine || '').match(/^J(\d\d-\d\d)\s+(R\d+)/);
  if (!m) return false;
  const [j, rr] = String(ref).split('/');
  return m[1] === j && m[2].toUpperCase() === String(rr).toUpperCase();
};
const planDuCarton = (c, tl) => (c.ref ? tl.find((r) => memePlan(r, c.ref))
                                       : tl.find((r) => r.badge === c.badge));
// GÉNÉRIQUE DE FIN (le monteur, 31/07) — un PLAN, pas un overlay :
//   GENERIQUE /chemin/vers/GENERIQUE VLOG01 (isolé).mp4
//   OUTRO 8            # le fondu musical doit mourir SUR le générique, pas avant
let GENERIQUE = null, OUTRO = null;
// MUSIQUE_IMPOSE <sec|mm:ss>:<sous-chaîne de piste>[,…] (31/08) — scinde un cue musical à la
// rupture forte la plus proche et pose la piste NOMMÉE sur la seconde moitié. Passé tel quel à
// `musique.mjs plan --impose`. Ça vit dans l'EDL et pas en option de ligne de commande parce
// qu'un choix de morceau fait partie du montage : il doit se rejouer sans qu'on s'en souvienne.
let MUSIQUE_IMPOSE = null;
// MUSIQUE_EXCLURE <sous-chaîne>[,…] (19/09) — RETIRE une piste du vivier, pour tout l'épisode.
// Même raison d'être que MUSIQUE_IMPOSE : un choix de morceau fait partie du montage, donc il
// vit dans l'EDL versionné avec sa justification, jamais en option de ligne de commande qu'on
// oubliera de repasser. *Une régénération rejoue toute la chaîne, options comprises — celles
// qu'on oublie disparaissent en silence.* Passé tel quel à `musique.mjs plan --exclure`.
let MUSIQUE_EXCLURE = null;
// SURCHARGES PAR DÉFINITION (31/07) — `FACECAM_2160`, `GENERIQUE_2160`, `OUT_2160`.
// Un master 4K n'a ni la même source facecam (v12 doit être rejoué en 4K : ses overlays et
// ses sous-titres sont BRÛLÉS), ni le même générique, ni le même nom de sortie. Les écrire
// à la main avant chaque rendu puis les remettre, c'est la garantie d'écraser un jour le
// master 1080p de référence. Ces trois lignes cohabitent donc dans le MÊME EDL, et ne sont
// lues que quand `Réglages/definition.txt` = 2160 : le montage, lui, ne bouge pas d'un iota.
const SURCHARGE = {};
const blocks = [];
for (const raw of lines) {
  const l = raw.replace(/\s+#.*$/, '').trim();
  if (!l || l.startsWith('#')) continue;
  const [kw, ...rest] = l.split(/\s+/);
  if (kw === 'FACECAM') { FACECAM = rest.join(' '); continue; }
  if (kw === 'SUJETS') { SUJETS = rest.join(' '); continue; }
  if (kw === 'OUT') { OUT = rest.join(' '); continue; }
  if (kw === 'TITRE') { TITRE = rest.join(' '); continue; }
  if (kw === 'PARLE') { rest.forEach((tok) => PARLE.add(tok.trim())); continue; }
  // ⚠ le nom est UN token : l'EDL se lit en découpant sur l'espace. Un nom en deux mots
  // s'écrit donc avec un souligné — `CARTON R136 HONG_KONG 香港` — rendu comme une espace.
  // Sans ça « HONG KONG 香港 » ferait un carton « HONG » avec « KONG » en idéogrammes (02).
  // RESERVE_CARTON <Ville> — assume par ÉCRIT qu'un carton tombe après le bloc qui la nomme.
  // Une réserve se déclare et se chiffre dans l'artefact ; on ne baisse jamais le contrôle.
  if (kw === 'RESERVE_CARTON') { CARTON_ORDRE_RESERVES.push(rest.join(' ').replace(/_/g, ' ')); continue; }
  // ⭐⭐ UN CARTON SE RANGE AVEC LE NOM DU PLAN, PAS AVEC SON RANG (18/09, payé le jour même
  // où je citais la règle). `CARTON R166 URUMQI` désigne le 166ᵉ plan du film. En retirant
  // UN plan sur consigne du monteur (« cut R162 »), les deux derniers cartons ont glissé d'un
  // cran — URUMQI est passé de `J20-08 R01` à `J20-08 R02`, ALMATY de `R04` à `R05` — sans
  // le moindre avertissement. C'est exactement « un identifiant dérivé d'un ordre n'est pas
  // un identifiant », et le contrôle de badge ne pouvait rien voir : R166 existait toujours.
  // Forme recommandée : `CARTON 20-08/R01 URUMQI 乌鲁木齐` — jour + rush, stable sous toute
  // coupe. La forme `R###` reste acceptée (anciens EDL) mais elle est SIGNALÉE.
  if (kw === 'CARTON') {
    const ref = rest[0];
    const parNom = /^\d\d-\d\d\/R\d+$/i.test(ref);
    if (!parNom && /^R\d+$/i.test(ref)) {
      console.error(`⚠ CARTON ${ref} désigne un RANG, pas un plan : toute coupe en amont le déplace `
        + `en silence (vécu le 18/09). Préférer « CARTON <jj-mm>/R## ».`);
    }
    CARTONS.push({ badge: parNom ? null : ref, ref: parNom ? ref : null,
      nom: rest[1].replace(/_/g, ' '), hanzi: rest[2] || null });
    continue;
  }
  if (kw === 'GENERIQUE') { GENERIQUE = rest.join(' '); continue; }
  if (kw === 'OUTRO') { OUTRO = rest[0]; continue; }
  if (kw === 'MUSIQUE_IMPOSE') { MUSIQUE_IMPOSE = rest.join(' '); continue; }
  if (kw === 'MUSIQUE_EXCLURE') { MUSIQUE_EXCLURE = rest.join(' '); continue; }
  if (/^(FACECAM|GENERIQUE|OUT)_(1080|2160)$/.test(kw)) { SURCHARGE[kw] = rest.join(' '); continue; }
  if (kw === 'L') { blocks.push({ kind: 'L', jour: rest[0], rids: rest.slice(1) }); continue; }
  if (kw === 'F') { blocks.push({ kind: 'F', sujets: rest }); continue; }
  console.error(`⚠ ligne ignorée : ${raw.trim()}`);
}
// les surcharges de définition écrasent les lignes de base, et SEULEMENT pour la définition
// courante : en 1080p l'EDL se lit exactement comme avant l'ajout de ces lignes.
for (const [k, v] of Object.entries(SURCHARGE)) {
  const [champ, def] = k.split('_');
  if (+def !== DEF) continue;
  if (champ === 'FACECAM') FACECAM = v;
  if (champ === 'GENERIQUE') GENERIQUE = v;
  if (champ === 'OUT') OUT = v;
  console.log(`· surcharge ${DEF}p : ${champ} → ${v}`);
}
if (!OUT) { console.error('✖ pas de ligne OUT dans l\'EDL'); process.exit(1); }

// ---- 2) résolution des sources ----------------------------------------------
const partsCache = {};
function partsOf(jour) {
  if (partsCache[jour]) return partsCache[jour];
  const p = path.join(VLOGDIR, `parts-${jour}.json`);
  if (!fs.existsSync(p)) throw new Error(`manifeste de segments absent : ${p} (rends d'abord le jour ${jour} avec reperes=off)`);
  return (partsCache[jour] = JSON.parse(fs.readFileSync(p, 'utf8')));
}
const sujets = JSON.parse(fs.readFileSync(SUJETS, 'utf8'));   // [{id,label,a,b}]
const sujetById = Object.fromEntries(sujets.map((s) => [s.id, s]));

// ---- 2-bis) LE MASTER FACECAM A-T-IL PASSÉ LE GARDE DE LA PAROLE ? -------------
// ⭐ POURQUOI CET ÉTAGE-CI (18/09). `facecam/parole.mjs` est appelé par `render.mjs`, qui
// sortait en code 1 quand il mordait — mais **le master restait sur le disque**, et ce
// fichier-ci le consommait sans rien demander. Un master recalé pouvait donc devenir
// l'épisode que le monteur regarde, sans que le garde ait jamais tourné dessus. Pire : le master
// du #03 a été rendu AVANT que la dimension « blanc de tête » n'existe, donc il n'a jamais
// pu être contrôlé sur elle.
// *Un refus qui n'empêche pas l'étage suivant de consommer l'objet est un avertissement.*
// Le quitus porte l'EMPREINTE du master : re-rendre le master le périme tout seul, donc on
// ne peut pas faire passer un vieux quitus pour un neuf.
// ⚠ ABSENT = REFUS, jamais « probablement bon ». C'est la différence entre un garde et un
// décor : ce qu'il ne sait pas, il le dit et il bloque.
if (!DRY || fs.existsSync(FACECAM)) {
  const quitus = FACECAM.replace(/\.mp4$/i, '.parole.json');
  const empreinte = (f) => { const st = fs.statSync(f); return (Number(st.size) ^ Math.round(st.mtimeMs)).toString(36).slice(-8); };
  let q = null;
  try { q = JSON.parse(fs.readFileSync(quitus, 'utf8')); } catch {}
  const emp = fs.existsSync(FACECAM) ? empreinte(FACECAM) : null;
  const dit = (m) => { console.error(m); };
  if (!q) {
    dit(`✖ GARDE PAROLE — AUCUN QUITUS pour ${path.basename(FACECAM)}.`);
    dit(`  Ce master n'a pas été contrôlé par facecam/parole.mjs, ou il l'a été avant que le`);
    dit(`  quitus n'existe. On ne livre pas un épisode bâti sur un master non contrôlé.`);
    dit(`  Remède : node facecam/render.mjs <edl.json>  (incrémental : seuls les spans changés`);
    dit(`  se ré-encodent), ou node facecam/parole.mjs "${path.basename(FACECAM)}" --carte … --edl …`);
    dit(`  puis re-rendre. Assumer par écrit : MONTAGE_QUITUS_RESERVE="<pourquoi>".`);
  } else if (q.empreinte !== emp) {
    dit(`✖ GARDE PAROLE — QUITUS PÉRIMÉ : il porte l'empreinte ${q.empreinte}, le master vaut ${emp}.`);
    dit(`  Le master a changé depuis son contrôle. Re-passer le garde avant de livrer.`);
  } else if (q.etat !== 'OK') {
    dit(`✖ GARDE PAROLE — QUITUS EN ÉTAT « ${q.etat} » : ${q.detail || ''}`);
  } else {
    console.log(`  ✓ garde parole : quitus valide (${q.date ? String(q.date).slice(0, 10) : '?'}) — ${q.detail || ''}`);
  }
  if (!q || q.empreinte !== emp || q.etat !== 'OK') {
    const res = process.env.MONTAGE_QUITUS_RESERVE;
    if (!res) process.exit(1);
    console.error(`· RÉSERVE ASSUMÉE sur le garde parole : « ${res} » — elle est écrite dans la sortie,`);
    console.error(`  pas dans un seuil baissé. Elle se relit, donc elle se solde.`);
  }
}

// ---- 2-ter) L'HORLOGE DU MASTER FACECAM SE MESURE, ELLE NE SE SUPPOSE PAS ------
// ⭐ POURQUOI CE REFUS (18/09). Ce fichier découpe l'IMAGE par index (`between(n,…)`, la
// parade du 31/08) mais le SON en secondes (`aselect between(t, n0/fpsSrc, …)`). Les deux
// adressages ne coïncident QUE si le master est vraiment CFR. Mesuré sur
// `VLOG_Chine03_facecam_v1.mp4` : 9 031 images, 0 recul de pts, mais **5 intervalles
// anormaux** et un écart `pts(n) − n/fps` qui grandit de +0,021 s à **+0,376 s** de bout en
// bout. L'image du bloc et le son du bloc ne viennent donc pas du même instant du contenu,
// et l'écart grandit avec le film — « j'ai l'impression que le son est décalé de mes
// paroles » (le monteur, 18/09).
//
// ⚠ CE GARDE NE CORRIGE PAS, IL BLOQUE — et c'est délibéré. Recaler le son sur `pts(n)`
// est la piste évidente ; la corrélation croisée du rendu contre la source laisse un
// résidu qui grandit encore (+0,038 s à +0,146 s), donc **je n'ai pas prouvé que `pts`
// soit le bon donneur d'horloge**. Livrer une correction non prouvée, c'est refaire
// « j'ai corrigé un défaut dans une grandeur voisine et fabriqué le défaut symétrique »
// (31/08, bornes de F36). Tant que ce n'est pas tranché, on refuse de découper à l'aveugle
// et on le DIT. `MONTAGE_HORLOGE_TOL` assume un écart par écrit.
const HORLOGE_TOL = +(process.env.MONTAGE_HORLOGE_TOL || 0.040);   // s — 1 image à 30 fps, arrondi
function verifieHorloge(file, fps) {
  const out = sh('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
    'frame=pts_time', '-of', 'csv=p=0', file]);
  const pts = out.split('\n').map((x) => x.trim().replace(/,$/, '')).filter(Boolean).map(Number);
  // ⚠ un NaN rend TOUTE comparaison fausse, donc un garde qui n'a rien lu se déclare vert
  // en silence (payé le 31/08 sur fusion.mjs : « écart NaN · 0 recul de pts »). On refuse.
  if (!pts.length || pts.some((x) => !Number.isFinite(x))) {
    return { mesure: false, msg: 'aucun pts lisible dans le master facecam' };
  }
  let max = 0, nMax = 0, reculs = 0;
  for (let n = 0; n < pts.length; n++) {
    if (n && pts[n] <= pts[n - 1]) reculs++;
    const e = Math.abs(pts[n] - n / fps);
    if (e > max) { max = e; nMax = n; }
  }
  return { mesure: true, max: +max.toFixed(4), nMax, reculs, frames: pts.length };
}
if (!DRY || fs.existsSync(FACECAM)) {
  const fpsM = DRY ? 30000 / 1001 : fpsOf(FACECAM);
  const h = verifieHorloge(FACECAM, fpsM);
  if (!h.mesure) {
    console.error(`✖ HORLOGE DU MASTER FACECAM — NON MESURÉE : ${h.msg}.`);
    console.error(`  L'image est découpée par INDEX et le son en SECONDES : sans cette mesure,`);
    console.error(`  rien ne dit que les deux désignent le même instant. On ne livre pas à l'aveugle.`);
    process.exit(1);
  }
  console.log(`  horloge du master facecam : ${h.frames} images · ${h.reculs} recul(s) de pts · `
    + `écart max |pts − n/fps| = ${h.max.toFixed(3)}s (image ${h.nMax})`);
  if (h.reculs || h.max > HORLOGE_TOL) {
    console.error(`\n✖ MASTER FACECAM NON CFR — écart max ${h.max.toFixed(3)}s à l'image ${h.nMax}`
      + ` (toléré ${HORLOGE_TOL.toFixed(3)}s)${h.reculs ? `, ${h.reculs} recul(s) de pts` : ''}.`);
    console.error(`  L'image se découpe par index (between(n,…)) et le son en secondes (n/fps) :`);
    console.error(`  sur un master qui dérive, les deux ne pointent pas le même instant du contenu,`);
    console.error(`  et l'écart GRANDIT avec le film. C'est le « son décalé » signalé le 18/09.`);
    console.error(`  Remède : re-souder le master facecam en CFR (fusion.mjs), puis relancer.`);
    console.error(`  Assumer par écrit : MONTAGE_HORLOGE_TOL=<secondes> — une réserve se chiffre.`);
    process.exit(1);
  }
}

// ---- 3) préparation des morceaux --------------------------------------------
// Landscape : les segments existent déjà (cache monte.mjs) → réutilisés TELS QUELS.
// Facecam : découpé aux frontières de sujets, ré-encodé au format des segments
// landscape (30/1 fps, timescale 15360) — sinon le concat démuxer dérive.
// Niveau de rendu : lu dans les Réglages, comme monte.mjs (cf. en-tête).
const QUALITE = /final/i.test(lire('qualite.txt', 'brouillon')) ? 'final' : 'brouillon';
// DÉFINITION DE SORTIE (`Réglages/definition.txt` = 1080 | 2160), même contrat que monte.mjs.
// `DEF` est lue plus haut (§lecture de l'EDL) : les surcharges `*_2160` en dépendent.
// Elle décide de trois choses ici : le `scale=` des morceaux ré-encodés (facecam, générique),
// la taille des habillages gravés (badges, timecode, cartons de ville) et — surtout — le NOM
// des fichiers de travail. ⚠️ Sans le suffixe de nom, un bloc facecam découpé en 1080p serait
// resservi tel quel au rendu 4K : il existe déjà, donc il est réutilisé, en silence (c'est
// exactement le piège de la découpe périmée payé le 30/07). Même ruse que `mute` dans
// monte.mjs : le suffixe n'est posé QUE pour 2160, donc les blocs 1080p déjà là restent valides.
const VID_W = DEF === 2160 ? 3840 : 1920, VID_H = DEF === 2160 ? 2160 : 1080;
const K = VID_H / 1080;                    // facteur d'échelle des habillages gravés
const SCALE = `scale=${VID_W}:${VID_H}`;
// repères = badges + timecode. Éteints d'office en final (un master ne porte pas d'habillage
// de travail), et éteignables à part en brouillon via `Réglages/reperes.txt` = off.
const REPERES = QUALITE !== 'final' && !/off/i.test(lire('reperes.txt', 'on'));
// preset : `slow` en 1080p, `medium` en 2160p — mesuré, cf. le commentaire de VENC() dans
// monte.mjs (à 4K, `slow` coûte 1,7× le temps pour +0,08 dB de PSNR et le même poids).
const VENC = QUALITE === 'final'
  ? ['-c:v', 'libx264', '-preset', DEF === 2160 ? 'medium' : 'slow', '-crf', '16', '-pix_fmt', 'yuv420p']
  : ['-c:v', 'h264_videotoolbox', '-b:v', DEF === 2160 ? '45M' : '12M', '-tag:v', 'avc1'];
console.log(`· qualité ${QUALITE} · définition ${VID_W}×${VID_H} · repères ${REPERES ? 'gravés' : 'AUCUN'}${GENERIQUE ? ' · générique de fin' : ''}`);
const pieces = [];   // { file, kind, badge, origine, label, band }
let nL = 0, nF = 0, nBand = 0;

for (const b of blocks) {
  if (b.kind === 'L') {
    nBand++;
    const parts = partsOf(b.jour);
    for (const rid of b.rids) {
      const n = parseInt(rid.replace(/^R/i, ''), 10);
      const segs = parts.filter((p) => p.rid === n);
      if (!segs.length) throw new Error(`${b.jour} : aucun segment pour ${rid}`);
      segs.forEach((s, i) => {
        // le manifeste pointe le CACHE de monte.mjs, qui se purge au-delà de ~4 Go (plus vieux
        // d'abord). Si un segment a disparu, on le dit au lieu de rendre un montage troué.
        if (!fs.existsSync(s.file)) {
          throw new Error(`${b.jour} ${rid} : segment purgé du cache (${path.basename(s.file)}) — re-rends ce jour avec reperes=off`);
        }
        nL++;
        pieces.push({
          file: s.file, kind: 'L',
          badge: `R${String(nL).padStart(3, '0')}`,
          origine: `J${b.jour} ${rid}${segs.length > 1 ? `.${i + 1}` : ''}`,
          label: s.rush,
          band: nBand,      // n° de bande : les plans d'une bande portent une tendance sonore
          parle: PARLE.has(`${b.jour}/${rid}`),   // plan paysage COMMENTÉ → niveau `voix`
          expected: +(s.to - s.from).toFixed(3),
        });
      });
    }
  } else {
    // un bloc facecam = N sujets CONTIGUS → une seule découpe (pas de raccord interne).
    // Pas de plafond sur N : « un sujet = un bloc, on ne scinde pas un raisonnement »
    // (le monteur 30/07). Le coût de la vie tient en 3 sujets, les prix en 5.
    const ss = b.sujets.map((id) => {
      const s = sujetById[id];
      if (!s) throw new Error(`sujet inconnu : ${id}`);
      return s;
    });
    for (let i = 1; i < ss.length; i++) {
      if (Math.abs(ss[i].a - ss[i - 1].b) > 0.002) {
        throw new Error(`bloc facecam non contigu : ${ss[i - 1].id} finit à ${ss[i - 1].b}, ${ss[i].id} démarre à ${ss[i].a}`);
      }
    }
    const a = ss[0].a, z = ss[ss.length - 1].b;
    nF++;
    // ⚠ les BORNES entrent dans le nom du fichier. Sans elles (jusqu'au 30/07), corriger une
    // frontière dans `sujets.json` ne changeait pas le nom : le fichier existait déjà, il était
    // réutilisé tel quel, et le rendu gardait l'ANCIENNE découpe sans un mot. Vécu en corrigeant
    // la fin de F23 : la coupe demandée par le monteur n'était pas dans le rendu.
    // ⚠ la QUALITÉ entre aussi dans le nom — mais SEULEMENT en final (même ruse que `mute`
    // dans monte.mjs) : sans ça, les blocs encodés en brouillon seraient resservis tels quels
    // au rendu du master, et le CRF 16 ne toucherait jamais le facecam. Le suffixe n'est posé
    // que sur le cas concerné, donc les blocs brouillon déjà là restent valides.
    // Fenêtre en INDEX D'IMAGE du master (cf. l'encadré « deux horloges » en tête de fichier).
    const fpsSrc = DRY ? 30000 / 1001 : fpsOf(FACECAM);
    const n0 = Math.round(a * fpsSrc), n1 = Math.round(z * fpsSrc);
    // ⚠ le nom porte désormais la FENÊTRE D'IMAGES, plus la fenêtre en secondes. Deux raisons,
    // et la première est un garde-fou de cache : la découpe ne dépend plus des seules bornes
    // mais de l'horloge du master, donc les blocs coupés à l'ancienne DOIVENT être réencodés —
    // changer la forme du nom les met hors circuit d'un coup, sans purge à la main. La seconde
    // est qu'un index d'image dit sans ambiguïté ce que le fichier contient.
    // ⚠ …ET LA CLÉ PORTE AUSSI L'EMPREINTE DU MASTER (31/08). La fenêtre d'images ne suffit pas :
    // le contenu d'un bloc dépend AUSSI du fichier facecam. Re-rendre une ville et re-souder
    // change les images sans forcément changer les index — un bloc de cache survivrait alors à
    // une correction demandée, exactement le piège payé le 30/07 avec les bornes. La règle du
    // skill est explicite : « si une décision cesse de dépendre du seul fichier, la clé de cache
    // doit le dire ». Empreinte = taille + date du master, courte et sans lecture du fichier.
    const stM = DRY ? { size: 0, mtimeMs: 0 } : fs.statSync(FACECAM);
    const emp = (Number(stM.size) ^ Math.round(stM.mtimeMs)).toString(36).slice(-6);
    const bornes = `n${n0}-${n1}_${emp}`;
    const qtag = QUALITE === 'final' ? '_final' : '';
    const dtag = DEF === 2160 ? '_4k' : '';
    const out = path.join(WORK, `fc_${String(nF).padStart(2, '0')}_${ss.map((s) => s.id).join('-')}_${bornes}${qtag}${dtag}.mp4`);
    if (!DRY && !fs.existsSync(out)) {
      sh('ffmpeg', ['-y', '-v', 'error', '-i', FACECAM,
        '-vf', `select='between(n\\,${n0}\\,${n1 - 1})',setpts=N/FRAME_RATE/TB,`
          + `fps=30,${SCALE},format=yuv420p,setsar=1`,
        '-af', `aselect='between(t\\,${(n0 / fpsSrc).toFixed(6)}\\,${(n1 / fpsSrc).toFixed(6)})',asetpts=N/SR/TB`,
        ...VENC, '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2',
        '-video_track_timescale', '15360', out]);
      // `exit 0` n'est pas une preuve : on compte les images rendues. Le filtre `fps` ramène
      // (n1−n0) images de 29,97 à du 30, donc on attend ce compte à UNE image près.
      const got = vframes(out);
      const vise = Math.round((n1 - n0) / fpsSrc * FPS);
      if (Math.abs(got - vise) > 1) {
        throw new Error(`${path.basename(out)} : ${got} images rendues, ${vise} attendues `
          + `pour les images ${n0}..${n1 - 1} du master`);
      }
    }
    pieces.push({
      file: out, kind: 'F',
      badge: `F${String(nF).padStart(2, '0')}`,
      origine: ss.map((s) => s.id).join('+'),
      label: ss.map((s) => s.label).join(' + '),
      // attendu = (n1 − n0) images du master ramenées à 30 fps par le filtre `fps` :
      // c'est un compte d'images, pas une différence de bornes (cf. « deux horloges »).
      expected: +((n1 - n0) / fpsSrc).toFixed(3),
    });
  }
}

// ---- 3-bis) GÉNÉRIQUE DE FIN, en QUEUE de timeline ---------------------------
// Greffé comme un MORCEAU (et pas concaténé après coup sur le film fini) : il traverse alors
// le même NORM + concat séparé v/a que tous les autres, donc il ne peut pas décaler le son.
// Ré-encodé au format des segments (30 fps · 1920×1080 · timescale 15360) et à la qualité
// courante ; sa piste muette doit exister — sans flux audio, le concat audio trouerait.
if (GENERIQUE) {
  if (!fs.existsSync(GENERIQUE)) throw new Error(`générique introuvable : ${GENERIQUE}`);
  const qtag = QUALITE === 'final' ? '_final' : '';
  const dtag = DEF === 2160 ? '_4k' : '';
  // ⭐⭐ L'EMPREINTE DU GÉNÉRIQUE ENTRE DANS LA CLÉ (20/09). Elle n'y était pas : la clé ne
  // portait que le NOM du fichier, la qualité et la définition. Or le générique isolé se
  // RE-RÉGÉNÈRE sous le même nom à chaque correction de sa spec — donc un générique corrigé
  // servait quand même l'ANCIEN segment, indéfiniment. Vécu le soir même : le monteur demande de
  // retirer « LA SUITE BIENTÔT », l'isolé 4K est re-rendu et VÉRIFIÉ À L'IMAGE sans la
  // signature… et le film final la porte toujours. *Une preuve prise sur l'artefact
  // INTERMÉDIAIRE ne prouve rien sur le livrable.*
  // La parade existait déjà vingt lignes plus haut, pour le master facecam, depuis le 31/08 —
  // et n'avait jamais été portée ici : « qui d'autre a la même forme ? » avait une réponse.
  // Empreinte = taille ^ date, comme pour le facecam : courte, et sans lire le fichier.
  const stG = DRY ? { size: 0, mtimeMs: 0 } : fs.statSync(GENERIQUE);
  const empG = (Number(stG.size) ^ Math.round(stG.mtimeMs)).toString(36).slice(-6);
  const gen = path.join(WORK, `gen_${path.basename(GENERIQUE, path.extname(GENERIQUE)).replace(/[^\w-]+/g, '_')}_${empG}${qtag}${dtag}.mp4`);
  if (!DRY && !fs.existsSync(gen)) {
    const aStreams = sh('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries',
      'stream=index', '-of', 'csv=p=0', GENERIQUE]).trim();
    const args = ['-y', '-v', 'error', '-i', GENERIQUE];
    if (!aStreams) args.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-map', '0:v:0', '-map', '1:a:0', '-shortest');
    args.push('-vf', `fps=30,${SCALE},format=yuv420p,setsar=1`, ...VENC,
      '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2',
      '-video_track_timescale', '15360', gen);
    sh('ffmpeg', args);
  }
  nBand++;
  pieces.push({
    file: gen, kind: 'L', badge: 'GEN',
    origine: 'Générique de fin', label: path.basename(GENERIQUE, path.extname(GENERIQUE)),
    band: nBand, parle: false, expected: +vdur(GENERIQUE).toFixed(3),
  });
}

// ---- 4) timeline mesurée ------------------------------------------------------
let t = 0;
const timeline = pieces.map((p) => {
  // en --dry les blocs facecam ne sont pas encore découpés : on affiche la durée ATTENDUE
  // (frontières de sujets / fenêtre source) plutôt que 0, sinon le plan mentirait.
  // la durée vient du COMPTE D'IMAGES, pas du champ `duration` du conteneur (cf. vframes).
  // C'est la même valeur qui borne l'audio de ce morceau ET qui est donnée au concat vidéo :
  // les deux flux ne peuvent donc plus raconter deux histoires.
  const n = fs.existsSync(p.file) ? vframes(p.file) : null;
  const d = n === null ? p.expected : n / FPS;
  const row = { ...p, frames: n, t0: t, t1: t + d, dur: d };
  t += d;
  return row;
});
const TOTAL = t;
// une ligne PARLE qui ne désigne aucun plan est une faute de frappe silencieuse : elle
// laisserait la musique passer devant un commentaire sans que rien ne le signale.
const parlesVus = new Set(pieces.filter((p) => p.parle).map((p) => p.origine.replace(/^J/, '').replace(' ', '/')));
for (const k of PARLE) if (!parlesVus.has(k)) console.error(`⚠ PARLE ${k} : aucun plan de ce nom dans l'EDL`);
if (PARLE.size) console.log(`  plans paysage commentés (niveau voix) : ${[...parlesVus].join(' · ') || '—'}`);
// vérifié DÈS le --dry : un carton posé sur un badge inexistant ne doit pas se découvrir
// après 20 min d'encodage.
const cartonsFautifs = [];
for (const c of CARTONS) {
  const p = planDuCarton(c, timeline);
  if (!p) console.error(`✖ CARTON « ${c.nom} » : aucun plan ${c.ref || c.badge} dans l'EDL`);
  else console.log(`  carton « ${c.nom}${c.hanzi ? ' ' + c.hanzi : ''} » sur ${p.badge} (${p.origine}, ${p.dur.toFixed(2)}s)`);
}

// ⭐ ON NOMME LA VILLE AVANT D'EN PARLER — règle du monteur du 18/09, et elle BLOQUE.
// « facecam chengdu après un rush landscape avec le titre jaune "Chengdu", pas avant ;
//  pareil pour les autres endroits, on nomme et place le titre en premier avant d'en parler. »
// Mesuré sur le master du 17/09 : **5 cartons sur 8** tombaient APRÈS le premier bloc qui
// nomme la ville (Chongqing −4,47 s · Chengdu −10,31 s · Pingyao −14,58 s · Datong −8,71 s ·
// Urumqi −11,24 s). le monteur n'en avait vu qu'un ; le contrôle les voit tous.
//
// ⚠ POURQUOI ICI ET PAS DANS LA DOCTRINE. La règle vaut pour la TRAME, donc elle pourrait
// vivre dans VLOG.md — elle y est écrite aussi. Mais une trame se relit, elle ne s'exécute
// pas : le seul passage obligé entre un EDL et un épisode, c'est ce fichier, et le `--dry`
// est l'endroit où le refus coûte 2 secondes au lieu de 20 minutes d'encodage.
//
// ⚠ NON MESURÉ FAIT ÉCHOUER. Si un sujet n'a pas de champ `ville`, on ne peut pas savoir
// quel bloc nomme quoi : on le DIT et on refuse, au lieu de déclarer l'EDL propre.
{
  const sansVille = sujets.filter((x) => !x.ville).map((x) => x.id);
  if (CARTONS.length && sansVille.length) {
    console.error(`✖ ORDRE TITRE→PAROLE NON MESURÉ : ${sansVille.length} sujet(s) sans champ `
      + `« ville » (${sansVille.slice(0, 6).join(' ')}${sansVille.length > 6 ? '…' : ''}). `
      + `Sans lui, impossible de savoir quel bloc nomme quelle ville.`);
    cartonsFautifs.push({ ville: '(non mesuré)', ecart: null });
  }
  const cle = (v) => String(v).toUpperCase().normalize('NFD').replace(/[^A-Z]/g, '');
  // premier bloc F, dans l'ordre du film, dont un sujet porte cette ville
  const premierBloc = {};
  for (const r of timeline) {
    if (r.kind !== 'F') continue;
    for (const id of String(r.origine).split('+')) {
      const v = sujetById[id] && sujetById[id].ville;
      if (!v) continue;
      if (!(cle(v) in premierBloc)) premierBloc[cle(v)] = { t: r.t0, badge: r.badge, sujet: id, ville: v };
    }
  }
  for (const c of CARTONS) {
    const p = planDuCarton(c, timeline);
    if (!p) continue;                       // déjà signalé au-dessus
    const k = Object.keys(premierBloc).find((x) => x.startsWith(cle(c.nom).slice(0, 5))
                                               || cle(c.nom).startsWith(x.slice(0, 5)));
    if (!k) {
      console.error(`✖ CARTON « ${c.nom} » : aucun sujet ne porte cette ville — ORDRE NON MESURÉ`);
      cartonsFautifs.push({ ville: c.nom, ecart: null });
      continue;
    }
    const f = premierBloc[k];
    if (p.t0 >= f.t) {
      cartonsFautifs.push({ ville: c.nom, badge: p.badge, ecart: +(p.t0 - f.t).toFixed(2),
        bloc: f.badge, sujet: f.sujet });
    }
  }
  const tolere = new Set(CARTON_ORDRE_RESERVES);
  const durs = cartonsFautifs.filter((x) => !tolere.has(x.ville));
  for (const x of cartonsFautifs) {
    const msg = x.ecart === null ? 'NON MESURÉ'
      : `carton ${x.ecart.toFixed(2)}s APRÈS le bloc ${x.bloc} (${x.sujet}) qui la nomme`;
    console.error(`${tolere.has(x.ville) ? '·' : '✖'} ORDRE TITRE→PAROLE — ${x.ville} : ${msg}`
      + (tolere.has(x.ville) ? ' [réserve déclarée dans l\'EDL]' : ''));
  }
  if (durs.length) {
    console.error(`\n✖ ${durs.length} carton(s) sur ${CARTONS.length} tombent après le bloc qui `
      + `nomme la ville. Règle du monteur du 18/09 : on nomme et on place le titre AVANT d'en parler.`);
    console.error(`  Remède (décision éditoriale) : avancer le CARTON sur la bande L qui précède `
      + `le bloc, OU déplacer le bloc F après la bande porteuse du carton.`);
    console.error(`  Réserve assumée : ligne « RESERVE_CARTON <Ville> » dans l'EDL — elle se `
      + `déclare et se chiffre, elle ne se contourne pas.`);
    process.exit(1);
  }
  // ⚠ un garde ne s'auto-félicite pas de ce qu'il a toléré. Annoncer « 8/8 » alors que 5
  // cartons ne passent QUE grâce à une réserve, c'est un message faux dans le sens
  // rassurant — la dette doit rester lisible dans la sortie, chiffrée.
  if (CARTONS.length) {
    const ok = CARTONS.length - cartonsFautifs.length;
    console.log(`  ✓ ordre titre→parole : ${ok}/${CARTONS.length} cartons avant le bloc qui nomme la ville`
      + (cartonsFautifs.length ? ` · ${cartonsFautifs.length} en RÉSERVE DÉCLARÉE (dette ouverte)` : ''));
  }
}
// ⭐⭐ UN DRY-RUN N'ÉCRIT PAS SUR UNE ENTRÉE DE MESURE (20/09, dette n°8).
// `vlog.plan.json` n'est pas qu'une sortie de confort : c'est le fichier que
// `subs-controle.mjs` lit pour juger si un sous-titre part avant la parole (bornes `t0`
// des blocs facecam). Or `--dry` l'écrivait PAR-DESSUS le vrai, et son timeline est une
// ESTIMATION — en dry les segments ne sont pas encodés, donc leurs durées se calculent
// (`Math.round((n1-n0)/fpsSrc*FPS)`) au lieu de se mesurer. Écart constaté sur l'EP3 :
// +0,004 s sur F02 jusqu'à +0,098 s sur F22, cumulatif. Conséquence vécue : la réserve
// F08 est sortie à +1,32 s contre 1,293 déclarés, la dimension VOIX a mordu, et j'ai
// cherché une dérive d'horloge dans le moteur pendant que le défaut était dans le
// fichier que je mesurais. *Une simulation qui écrase une mesure laisse une fausse
// vérité qu'aucun garde ne distingue de la vraie.*
// Corrigé par le CHOIX, pas par la compensation : le dry écrit un fichier À LUI, dont le
// NOM dit ce qu'il est, et l'artefact porte `_dry` pour que ses consommateurs puissent le
// refuser même si on le renomme.
const PLAN_OUT = path.join(VLOGDIR, DRY ? 'vlog.plan.dry.json' : 'vlog.plan.json');
fs.writeFileSync(PLAN_OUT, JSON.stringify({
  ...(DRY ? {
    _dry: true,
    _: 'ARTEFACT DE SIMULATION — les durées sont CALCULÉES, pas mesurées (aucun segment '
      + "n'a été encodé). Ne JAMAIS s'en servir pour juger un livrable : subs-controle.mjs "
      + 'le refuse. Le vrai plan est vlog.plan.json, écrit par un run réel.',
  } : {}),
  titre: TITRE, out: OUT, total: TOTAL, pieces: timeline,
}, null, 1));

console.log(`\n${TITRE} — ${timeline.length} morceaux · ${hms(TOTAL)}`);
console.log(`  landscape : ${nL} plans · facecam : ${nF} blocs`);
for (const r of timeline) {
  console.log(`  ${r.badge.padEnd(5)} ${hms(r.t0).padStart(8)} → ${hms(r.t1).padStart(8)} (${r.dur.toFixed(2).padStart(6)}s)  ${r.origine.padEnd(16)} ${r.kind === 'F' ? r.label : ''}`);
}
if (DRY) {
  console.log(`\n(--dry : rien n'a été encodé · plan de SIMULATION → ${path.basename(PLAN_OUT)},`
    + ` durées calculées et non mesurées ; le vrai vlog.plan.json n'a pas été touché)`);
  process.exit(0);
}

// ---- 5) concat SANS DÉRIVE A/V -------------------------------------------------
// ⚠ PIÈGE MESURÉ (retour du monteur, 30/07 : « mes lèvres ne suivent pas la bande son »,
// « le son de R20 déborde sur R21 »). L'ancienne version faisait UN concat démuxer
// `-c copy` sur les deux flux à la fois. Or le démuxer avance CHAQUE FLUX avec SA
// propre durée : quand l'audio d'un morceau ne fait pas exactement la durée de sa
// vidéo (arrondi de trame AAC 21,3 ms vs trame vidéo 33,3 ms), l'écart s'ACCUMULE.
// Mesuré sur le VLOG #01 : −0,205 s en fin de film (audio en avance), soit 6 images
// de désynchro sur un plan parlé — parfaitement visible sur un talking-head, et de
// pire en pire vers la fin. Le total collait (773,57 vs 773,59) : la dérive était
// INVISIBLE sur la durée finale, elle ne se voit qu'en cumulant morceau par morceau.
//
// Correctif : les deux flux sont construits SÉPARÉMENT.
//   · vidéo → concat démuxer `-c copy` (les durées vidéo sont exactes, aucune dérive)
//   · audio → graphe de filtres, chaque piste RECADRÉE À LA DURÉE VIDÉO de son morceau
//     (`apad` puis `atrim`) avant le `concat`. Un morceau ne peut donc plus décaler le suivant.
// 5a) NORMALISER LES TIMESTAMPS avant de concaténer la vidéo.
// 2ᵉ piège mesuré le 30/07, plus gros que le premier : 28 des 112 morceaux ont un flux
// vidéo qui démarre à start_time=0,033 s (une image) au lieu de 0 — séquelle des encodages
// successifs. Le concat démuxer INSÈRE ce décalage comme un trou avant chaque morceau
// concerné : 0,924 s de vidéo en trop sur le film, que l'audio ne suit pas. Cumulé avec la
// dérive de durée, ça faisait jusqu'à ~1,2 s de désynchro en fin de film.
// Le re-mux ci-dessous est une COPIE de flux (pas de ré-encodage) : quelques secondes.
//
// ⚠ 3ᵉ piège, mesuré le 31/07 au PREMIER rendu en `qualite=final` : `-avoid_negative_ts
// make_zero` ne SUPPRIME pas le décalage, il le rend positif. Tant que les segments sortaient
// de VideoToolbox le lead-in était nul ou d'une image ; libx264 preset slow encode avec
// `has_b_frames=2`, donc CHAQUE morceau démarre à start_time=0,066 s (2 images de DTS) et le
// concat démuxer réinsère ces 2 images en trou. Sur 112 morceaux : **+6,4 s de vidéo** que
// l'audio ne suit pas — assez pour que le film entier glisse.
// Parade : passer par MPEG-TS. Le TS n'a ni edit list ni start_time à propager, ffmpeg
// régénère PTS/DTS au remux, et le concat redevient exact quel que soit l'encodeur.
// Mesuré sur 5 morceaux (somme des durées vidéo = 21,700 s) : concat mp4 = 21,898 s
// (+198 ms), concat via .ts = **21,700 s**, start_time 0, 651 images = 21,7 × 30 pile.
const NORM = path.join(WORK, 'norm');
fs.mkdirSync(NORM, { recursive: true });
const normFiles = timeline.map((r, i) => {
  const o = path.join(NORM, `${String(i).padStart(3, '0')}.ts`);
  sh('ffmpeg', ['-y', '-v', 'error', '-i', r.file, '-map', '0:v:0', '-c', 'copy',
    '-bsf:v', 'h264_mp4toannexb', '-f', 'mpegts', o]);
  return o;
});
// ⚠ la directive `duration` n'est PAS décorative : sans elle le démuxer déduit l'offset du
// morceau suivant de ce que le .ts déclare (last_PTS − first_PTS = une image de moins), et les
// deux flux se chevauchent d'une image. Mesuré sur ce film : 19 jonctions en collision de DTS,
// 23 536 images bien présentes mais 19 d'entre elles à durée NULLE → 784,533 s de son contre
// 783,900 s d'image. Avec `duration` = images/30 : 30/1 exact, 0 avertissement, 0 ms d'écart.
const listFile = path.join(WORK, 'concat.txt');
fs.writeFileSync(listFile, normFiles.map((f, i) =>
  `file '${f.replace(/'/g, "'\\''")}'\nduration ${(timeline[i].frames / FPS).toFixed(6)}`).join('\n') + '\n');
const rawV = path.join(WORK, '_raw_v.mp4');
sh('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-an',
  '-video_track_timescale', '15360', '-movflags', '+faststart', rawV]);

// l'audio se construit par paquets : 116 entrées dans UN seul ffmpeg dépasse la limite de
// descripteurs de fichiers du shell. On concatène par lots, puis les lots entre eux.
const CHUNK = 24;
const rawA = path.join(WORK, '_raw_a.m4a');
const chunks = [];
for (let i = 0; i < timeline.length; i += CHUNK) {
  const grp = timeline.slice(i, i + CHUNK);
  const args = ['-y', '-v', 'error'];
  grp.forEach((r) => args.push('-i', r.file));
  // aresample=async=1 : recale les éventuels trous de timestamps AVANT le recadrage.
  const fc = grp.map((r, k) =>
    `[${k}:a]aresample=48000:async=1,apad,atrim=0:${r.dur.toFixed(6)},asetpts=N/SR/TB[a${k}]`).join(';')
    + ';' + grp.map((_, k) => `[a${k}]`).join('') + `concat=n=${grp.length}:v=0:a=1[out]`;
  const cf = path.join(WORK, `_a_${String(chunks.length).padStart(2, '0')}.m4a`);
  args.push('-filter_complex', fc, '-map', '[out]', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', cf);
  sh('ffmpeg', args);
  chunks.push(cf);
}
if (chunks.length === 1) {
  fs.copyFileSync(chunks[0], rawA);
} else {
  // 2ᵉ étage : les lots font chacun une durée EXACTE (somme des durées vidéo), donc ici
  // le concat démuxer ne peut plus dériver — il n'y a qu'un flux.
  const la = path.join(WORK, 'concat_a.txt');
  fs.writeFileSync(la, chunks.map((f) => `file '${f}'`).join('\n') + '\n');
  sh('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', la, '-c', 'copy', rawA]);
}
const dv = dur(rawV), da = dur(rawA);
console.log(`\n· concat → vidéo ${hms(dv)} · audio ${hms(da)} · dérive A/V ${((da - dv) * 1000).toFixed(0)} ms`);
if (Math.abs(da - dv) > 0.10) console.log(`  ⚠ dérive > 100 ms : à investiguer avant de livrer`);

// ---- 6) repères regravés (badge global + origine) + timecode -------------------
// Les badges passent par un ASS (libass avale 150 événements sans broncher, là où 150
// drawtext feraient exploser la chaîne de filtres) ; le timecode reste un drawtext car
// il est DYNAMIQUE (%{pts}).
// ⚠ le filtre `ass=` d'ffmpeg re-parse son argument (`:` sépare les options, l'espace et
// l'apostrophe compliquent la citation) : on écrit donc l'ASS dans un chemin SANS espace ni
// accent, pas dans le store (« Application Support », « Réglages »…). Piège vécu ailleurs.
const ass = path.join(os.tmpdir(), 'vlog-badges.ass');
const esc = (s) => s.replace(/\{/g, '(').replace(/\}/g, ')');
const at = (x) => {
  const h = Math.floor(x / 3600), m = Math.floor((x % 3600) / 60), s = x % 60;
  return `${h}:${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
};
fs.writeFileSync(ass, [
  // PlayRes reste en 1920×1080 MÊME en sortie 2160p, et c'est volontaire : libass met le script
  // à l'échelle de la résolution de sortie et rend le texte en VECTORIEL. Un badge écrit ici en
  // 46 px sort donc à 92 px, net, sur du 3840×2160. « Corriger » les tailles doublerait l'échelle
  // deux fois. Même raison pour les sous-titres karaoké déjà brûlés dans le facecam.
  '[Script Info]', 'ScriptType: v4.00+', 'PlayResX: 1920', 'PlayResY: 1080', 'WrapStyle: 2', '',
  '[V4+ Styles]',
  'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
  'Style: Badge,Arial,46,&H0000FFFF,&H0000FFFF,&H00000000,&HC7000000,1,0,0,0,100,100,0,0,3,3,0,7,16,16,14,1',
  '',
  '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ...timeline.map((r) => `Dialogue: 0,${at(r.t0)},${at(r.t1)},Badge,,0,0,0,,${esc(r.badge)}\\N{\\fs26}${esc(r.origine)}`),
].join('\n') + '\n');

// timecode en HAUT à droite (et pas en bas comme dans monte.mjs) : le bas est occupé par les
// sous-titres karaoké déjà brûlés dans le facecam, dont les lignes les plus larges montent
// jusqu'à ~1720 px — elles passeraient sous le compteur.
const tc = `drawtext=text='%{pts\\:hms}':x=w-tw-${Math.round(16 * K)}:y=${Math.round(14 * K)}:fontsize=${Math.round(40 * K)}`
  + `:fontcolor=white:box=1:boxcolor=black@0.6:borderw=${Math.round(1 * K)}`;
const assF = `ass=${ass}`;

// ---- 6-bis) CARTONS DE VILLE ---------------------------------------------------
// Bebas Neue 150 px, couleur d'accent du profil, CENTRÉ, ombre portée pour tenir sur n'importe quel
// fond (mesuré sur R001 : 5,0 % du fond plus clair que l'accent au pire instant, seuil ~15 %).
// Apparition/disparition en fondu — le monteur a demandé « l'apparition d'une typo jaune », pas un
// carton qui claque. Le fondu se fait à l'alpha, pas au fondu vidéo : le plan continue dessous.
// La police vient du REPO (assets/fonts) ; les idéogrammes de PingFang (police système macOS —
// la chaîne est déjà Mac-only par h264_videotoolbox, cf. INDEX §Fichiers moteur).
const FONT_CARTON = path.join(ENGINE, 'facecam/assets/fonts/BebasNeue-Regular.ttf');
const FONT_CJK = '/System/Library/Fonts/PingFang.ttc';
const ACCENT_PROFIL = ACCENT_FFMPEG;
const FADE = 0.45;                    // durée du fondu, à l'entrée comme à la sortie
// ⚠️ 17/09 — UNE APOSTROPHE DROITE DANS UN NOM DE VILLE CASSE TOUT LE FILTERGRAPH.
// `CARTON R058 XI'AN 西安` produisait `text='XI'AN'` : la quote se referme sur l'apostrophe,
// ffmpeg lit la SUITE de la chaîne comme un nom de filtre et sort « No such filter: '208.783)' ».
// Mesuré sur une image (chaîne à 2 filtres, via execFileSync donc SANS shell) : les deux
// échappements réflexes rendent un carton VIDE sans la moindre erreur — `'XI'\''AN'` et
// `XI\'AN` donnent 254 pixels clairs contre 4 979 pour le témoin « XIAN ». Un carton muet
// qui sort en code 0 est pire que le plantage. La seule forme qui REND est l'apostrophe
// typographique U+2019 (5 136 pixels, glyphe présent dans Bebas Neue) — et c'est la bonne
// typographie. Donc on TRADUIT, on n'échappe pas ; et ce qu'on ne sait pas porter, on le REFUSE.
const txtDraw = (s, quoi) => {
  const t = String(s).replace(/'/g, '\u2019')     // ' droite → ’ typographique (seule forme rendue)
    .replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/%/g, '\\%');
  if (/'/.test(t)) throw new Error(`CARTON ${quoi} : apostrophe non convertible dans « ${s} »`);
  return t;
};
const cartonFilters = CARTONS.map((c) => {
  const p = planDuCarton(c, timeline);
  if (!p) { console.error(`✖ CARTON « ${c.nom} » : aucun plan ${c.ref || c.badge} — le titre ne serait PAS gravé`); process.exit(1); }
  // le carton respire : il n'ouvre pas sur la 1ʳᵉ image et ne colle pas au raccord suivant
  const a = p.t0 + Math.min(0.6, p.dur * 0.18);
  const z = p.t1 - Math.min(0.35, p.dur * 0.10);
  if (z - a < 2 * FADE + 0.3) console.error(`⚠ CARTON ${p.badge} : plan trop court (${p.dur.toFixed(2)}s) pour un fondu propre`);
  const alpha = `if(lt(t,${a.toFixed(3)}),0,if(lt(t,${(a + FADE).toFixed(3)}),(t-${a.toFixed(3)})/${FADE}`
    + `,if(lt(t,${(z - FADE).toFixed(3)}),1,if(lt(t,${z.toFixed(3)}),(${z.toFixed(3)}-t)/${FADE},0))))`;
  // ⚠️ drawtext est en PIXELS DE SORTIE (contrairement à un ASS, que libass met à l'échelle) :
  // les 150 px du carton et les 46 px des idéogrammes se multiplient donc par K, sinon le
  // jalon de récit devient une ligne perdue au milieu d'un cadre 4K. La convention figée
  // (Bebas 150 px / accent / centré / fondu 0,45 s) est bien préservée : elle est RELATIVE au cadre.
  const f = [`drawtext=fontfile='${FONT_CARTON}':text='${txtDraw(c.nom, p.badge)}':x=(w-tw)/2:y=(h-th)/2-${Math.round(40 * K)}`
    + `:fontsize=${Math.round(150 * K)}:fontcolor=${ACCENT_PROFIL}:alpha='${alpha}':shadowcolor=black@0.8:shadowx=0:shadowy=${Math.round(4 * K)}`];
  if (c.hanzi) f.push(`drawtext=fontfile='${FONT_CJK}':text='${txtDraw(c.hanzi, p.badge)}':x=(w-tw)/2:y=(h/2)+${Math.round(72 * K)}`
    + `:fontsize=${Math.round(46 * K)}:fontcolor=${ACCENT_PROFIL}:alpha='${alpha}':shadowcolor=black@0.8:shadowx=0:shadowy=${Math.round(2 * K)}`);
  console.log(`  carton « ${c.nom} » sur ${p.badge} : ${hms(a)} → ${hms(z)} (fondu ${FADE}s)`);
  return f.join(',');
}).filter(Boolean);
// La chaîne de filtres se compose de ce qui est ACTIF : en final il ne reste que les cartons
// (les repères sont de l'habillage de travail, pas du film). Si rien n'est à graver, on ne
// ré-encode pas du tout — une génération de moins sur 13 min de film.
const vfBurn = [...(REPERES ? [assF, tc] : []), ...cartonFilters].join(',');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
// En mode normal l'assemblage muet est un INTERMÉDIAIRE (il part dans work/, il sera supprimé
// après la pose de la musique) : ce qui atterrit dans « Vidéos finies » est le livrable UNIQUE.
const assemblage = NU ? OUT : path.join(WORK, '_assemblage_nu.mp4');
sh('ffmpeg', ['-y', '-v', 'error', '-i', rawV, '-i', rawA,
  '-map', '0:v:0', '-map', '1:a:0',
  ...(vfBurn ? ['-vf', vfBurn, ...VENC] : ['-c:v', 'copy']),
  '-c:a', 'copy', '-shortest', '-movflags', '+faststart', assemblage]);

const d = dur(assemblage);
console.log(`\n· assemblage ${NU ? '(muet, --nu)' : 'muet (intermédiaire)'} → ${hms(d)}` +
  `  (plan attendu ${hms(TOTAL)}, écart ${(d - TOTAL).toFixed(2)}s)`);
console.log(`  plan → ${PLAN_OUT}`);

if (NU) {
  console.log(`\n✓ ${OUT}   ⚠ SANS musique (--nu) — ce n'est pas le livrable`);
} else {
  // ---- 7) musique, dans la même commande -------------------------------------
  // Un seul livrable : `musique.mjs plan --structure` lit la grille de niveaux depuis le plan
  // qu'on vient d'écrire, et rend DIRECTEMENT le fichier de « Vidéos finies ».
  console.log(`\n· musique (plan --structure) …`);
  execFileSync(process.execPath, [path.join(ENGINE, 'musique.mjs'), 'plan', assemblage,
    '--structure', path.join(VLOGDIR, 'vlog.plan.json'), '--out', OUT,
    // avec un générique, la « bande paysage de clôture » n'est plus le bon repère : le fondu
    // doit mourir SUR le générique, pas sur les tours du crépuscule qui le précèdent.
    ...(OUTRO ? ['--outro', String(OUTRO)] : []),
    ...(MUSIQUE_IMPOSE ? ['--impose', MUSIQUE_IMPOSE] : []),
    ...(MUSIQUE_EXCLURE ? ['--exclure', MUSIQUE_EXCLURE] : [])],
    { stdio: 'inherit', maxBuffer: 1 << 28 });
  fs.rmSync(assemblage, { force: true });     // l'intermédiaire ne survit pas au run
  const dm = dur(OUT);
  console.log(`\n✓ ${OUT}`);
  console.log(`  durée=${hms(dm)}  ·  lit musical posé  ·  assemblage muet supprimé`);
}

purgeApresRendu();   // rétention N/N-1 : réflexe du moteur, pas de l'opérateur
