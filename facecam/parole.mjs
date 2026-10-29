#!/usr/bin/env node
// ============================================================================
// facecam/parole.mjs — LE GARDE DE LA PAROLE. Contrôle un master facecam RENDU,
// span par span, sur les trois défauts que le monteur a dû signaler à la main le 05/09 :
//   (a) une RELANCE laissée      — « en fait elle est… en fait elle est construite sur… »
//   (b) un « EUHHH » long laissé — « et donc de ce fait euhhh bah l'État a voulu »
//   (c) une QUEUE tronquée       — « dont les Hui » coupé, « c'est ancienne dynas… »
//   (d) un BLANC DE TÊTE         — le span s'ouvre AVANT que le monteur n'attaque sa phrase
//       (18/09 : « tu mets un plan très court inutile avant que je commence à parler »)
//
// ⭐ POURQUOI IL NE LIT PAS LA TRANSCRIPTION DU FICHIER (le piège du 05/09)
// Relire le transcript du rendu ne peut PAS marcher, et ce n'est pas une question
// de modèle : whisper DÉDUPLIQUE deux prises identiques consécutives. Mesuré sur
// `relief-rues-superposees` — la fenêtre entière rend UNE phrase, les deux bursts
// transcrits séparément en rendent DEUX. Le défaut est invisible dans l'objet même
// qu'on relit. Donc ici on ne transcrit JAMAIS une fenêtre qui contient plusieurs
// bursts : on découpe d'abord au SILENCE (mesure), on transcrit chaque morceau SEUL,
// et on compare les morceaux entre eux.
// Même motif que « un instrument qui déduplique ne peut pas prouver une absence ».
//
// ⭐ ET IL BLOQUE. `render.mjs` l'appelle et REFUSE de livrer s'il mord (MONTAGE_NO_PAROLE=1
// désarme). Une leçon écrite dans un README dépend de ma discipline ; celle-ci vit dans
// le goulot par lequel tout master doit passer. Une exception se DÉCLARE et se CHIFFRE
// dans l'EDL (`_reserves_parole`), jamais en baissant un seuil.
//
// Usage: node facecam/parole.mjs <master.mp4> [--carte <carte.json>] [--edl <edl.json>]
//                                [--span <label>] [--json out.json]
// Sortie: tableau par span ; code 1 s'il reste un défaut non déclaré.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { silencesAutour, borneCoupeUnMot } from './lib.mjs';
import { fileURLToPath } from 'node:url';
import { MODEL_BIG } from '../store.mjs';   // chemins du moteur et du store : un seul endroit

const ENGINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PY = path.join(ENGINE, '.venv-vision', 'bin', 'python');
const PAROLE_PY = path.join(ENGINE, 'facecam', 'parole.py');
const VAD_PY = path.join(ENGINE, 'facecam', 'overlays', 'vad.py');
const BIG = MODEL_BIG;

const argv = process.argv.slice(2);
const master = argv.find((a) => !a.startsWith('--'));
if (!master) { console.error('usage: node facecam/parole.mjs <master.mp4> [--carte c.json] [--edl e.json] [--span label] [--json out]'); process.exit(2); }
const gf = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const onlySpan = gf('--span', null);
const jsonOut = gf('--json', null);

// ---- seuils (softcodés ; un seuil se change en connaissance de cause, jamais pour faire passer un cas)
const S = {
  burstNoise: '-26dB', burstMin: 0.15, burstKeep: 0.18,  // découpe au silence
  echoWords: 4,        // nb de mots de tête comparés entre deux bursts voisins
  echoRatio: 0.75,     // part de ces mots qui doit se retrouver pour crier « relance »
  euhMin: 0.30,        // durée mini d'une voyelle tenue pour être un défaut
  queueMiss: 2,        // nb de mots de contenu manquants en queue avant de crier
  // ⭐ BLANC DE TÊTE toléré, en secondes. Ce chiffre n'est PAS choisi : il est DÉRIVÉ des
  // verdicts du monteur sur le master du 17/09. Mesuré bloc par bloc sur le master facecam
  // rendu (fenêtre = le span, cf. `airDeTete`) : il a signalé F11 (0,92 s), F12 (1,84 s),
  // F13 (1,24 s) et F18 (1,28 s) ; il a laissé passer F06 (0,18 s), F16, F01 et F05 (0,00 s).
  // La frontière observée est donc entre 0,18 et 0,92 — 0,30 s la place au plus près du
  // défaut sans condamner ce que le monteur accepte. *Un seuil qui ne vient pas d'une mesure est
  // un seuil qu'on rebaissera au premier cas gênant.*
  airMax: 0.30,
};
const QUEUE_MIN_S = 0.25;  // ...ET il faut au moins autant de SON après la borne (sinon c'est une divergence de lecture, pas une coupe)
const FILLER = new Set(['euh', 'euhh', 'euhhh', 'heu', 'hein', 'bah', 'ben', 'mmh', 'hum', 'mm', 'hm', 'ah', 'oh', '']);

const sh = (c) => execSync(c, { maxBuffer: 1 << 28 }).toString();
const WORK = `${process.env.TMPDIR || '/tmp'}/parole-${process.pid}`;
fs.mkdirSync(WORK, { recursive: true });
const norm = (t) => (t || '').toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[.,!?…"'’«»\-:;()]/g, ' ').split(/\s+/).filter(Boolean);

// --- transcription d'UNE fenêtre, seule. Cache par (wav, a, b).
const memo = new Map();
function say(wav, a, b) {
  const key = `${wav}|${a.toFixed(3)}|${b.toFixed(3)}`;
  if (memo.has(key)) return memo.get(key);
  const out = `${WORK}/t`;
  try {
    sh(`ffmpeg -y -v error -ss ${a.toFixed(3)} -to ${b.toFixed(3)} -i "${wav}" -ac 1 -ar 16000 "${out}.wav"`);
    sh(`whisper-cli -m "${BIG}" -l fr -otxt -of "${out}" "${out}.wav" >/dev/null 2>&1`);
  } catch { memo.set(key, ''); return ''; }
  let txt = '';
  try { txt = fs.readFileSync(`${out}.txt`, 'utf8').replace(/\s+/g, ' ').trim(); } catch {}
  memo.set(key, txt);
  return txt;
}

// --- découpe d'un wav en bursts, par la VÉRITÉ DES SILENCES (pas par les mots)
//
// ⭐⭐ ET CES SILENCES SE MESURENT DANS LA BANDE VOCALE, PAS AU LARGE (18/09).
// C'est la seconde moitié de la raison pour laquelle la relance de `disneylandisation-
// patrimoine` est passée. `silencedetect` mesure l'énergie LARGE : sur un rush tourné dans
// la rue, le fond de salle ne descend jamais sous −26 dB, donc la pause de 0,36 s qui sépare
// la fausse prise de la reprise n'est PAS vue — les deux takes tombent dans UN seul burst,
// et whisper, qui déduplique, n'en rend qu'une phrase. Mesuré sur la source du span 24 :
// `silencedetect` trouve 5 silences et aucun à l'endroit de la reprise ; `vad.py`, qui
// mesure 300-3400 Hz au régime dense, l'y trouve.
// *Une sonde se réfute avec la grandeur qu'elle mesure* — leçon écrite le 01/09 pour les
// sous-titres, jamais portée ici. « Qui d'autre a la même forme ? » avait une réponse.
//
// ⚠ Et si vad.py ne répond pas, on ne retombe PAS en silence sur l'ancienne découpe : on
// lève, l'appelant déclare NON MESURÉ et le garde échoue. Un repli muet vers un instrument
// qu'on vient de réfuter est exactement la façon dont un garde redevient un décor.
function burstsVocal(wav) {
  const out = sh(`"${PY}" "${VAD_PY}" --iles "${wav}"`).trim();
  const I = Object.values(JSON.parse(out))[0] || [];
  return I.map(([a, b]) => [a, b]).filter(([a, b]) => b - a >= S.burstKeep);
}
function bursts(wav, dur) {
  let out = '';
  try {
    out = sh(`ffmpeg -hide_banner -nostats -i "${wav}" -af "silencedetect=noise=${S.burstNoise}:d=${S.burstMin}" -f null - 2>&1`);
  } catch (e) { out = (e.stdout || '') + (e.stderr || ''); }
  const sil = []; let cur = null;
  for (const line of String(out).split('\n')) {
    let m = line.match(/silence_start:\s*(-?[\d.]+)/); if (m) cur = { s: Math.max(0, +m[1]) };
    m = line.match(/silence_end:\s*([\d.]+)/); if (m && cur) { cur.e = +m[1]; sil.push(cur); cur = null; }
  }
  const seg = []; let pos = 0;
  for (const s of sil) { if (s.s > pos + 0.05) seg.push([pos, s.s]); pos = Math.max(pos, s.e); }
  if (dur > pos + 0.05) seg.push([pos, dur]);
  return seg.filter(([a, b]) => b - a >= S.burstKeep);
}

// --- (a) RELANCE : le burst i est-il une amorce de ce que dit le burst i+1 ?
// Test de PRÉFIXE, jamais de similarité globale : « des Kazakhs, des Russes… » suivi de
// « des Coréens, des Turcs » se ressemble beaucoup sans être une relance.
// ⚠⚠ ET LE TEST DE PRÉFIXE NE SUFFIT PAS (18/09, le défaut que le monteur a dû signaler lui-même).
// Sur `disneylandisation-patrimoine` il dit « plutôt rester dans la ville. » puis repart
// « plus de rester dans la ville, mais ça permet quand même… ». C'est une reprise, et le
// test de préfixe passe à côté pour deux raisons à la fois : les deux bursts n'ont AUCUN
// premier mot commun (« plutôt » / « plus »), et le second est cinq fois plus long, donc
// toute mesure de ressemblance GLOBALE s'effondre aussi.
// Ce qui signe une relance n'est ni le début ni la ressemblance : c'est que **la QUEUE du
// burst avorté est REDITE au début du burst suivant**. On cherche donc la plus longue suite
// de mots qui termine l'un et réapparaît en tête de l'autre.
// *Un proxy choisi sur un exemple ne couvre que la forme de cet exemple.*
const MOTS_VIDES = new Set(['et','donc','alors','mais','en','fait','du','de','la','le','les',
  'un','une','a','c','est','qui','que','ce','ca','on','il','elle','y','au','aux','des','d','l']);
function redite(a, b, nmin = 3, fen = 6) {
  for (let L = Math.min(a.length, 12); L >= nmin; L--) {
    const queue = a.slice(-L);
    for (let p = 0; p <= Math.min(fen, Math.max(0, b.length - L)); p++) {
      if (queue.every((w, k) => b[p + k] === w)) {
        // au moins un mot PLEIN, sinon « et de la » suffirait à crier
        if (queue.some((w) => !MOTS_VIDES.has(w))) return { n: L, mots: queue.join(' '), pos: p };
      }
    }
  }
  return null;
}
function isEcho(prev, next) {
  const a = norm(prev), b = norm(next);
  if (a.length < 2) return null;
  // (1) le test historique : même AMORCE.
  // ⚠⚠ SANS CONTRAINTE DE LONGUEUR (20/09, le défaut que le monteur a dû signaler DEUX fois).
  // La version d'avant exigeait `b.length >= a.length`, c'est-à-dire que la fausse prise
  // soit la PLUS COURTE des deux. Sur `rushs-perdus` (span 28 de l'EP3) c'est l'inverse :
  // il part long, s'emmêle (« … des monuments principaux de la vie, donc la », 4,98 s),
  // puis reprend plus SERRÉ (« … des monuments principaux », 2,66 s). La contrainte
  // désarmait donc le test exactement dans le cas où il devait mordre, et le garde est
  // sorti VERT sur un master livré. Le test (2) ne rattrapait rien : la queue de la fausse
  // prise (« de la vie donc la ») n'est pas redite en tête de la reprise.
  // Or les 7 PREMIERS MOTS sont identiques — « j'ai malheureusement perdu pas mal de rushs ».
  // *Un proxy choisi sur un exemple ne couvre que la forme de cet exemple* : c'est le DÉFAUT
  // cherché qui décide du test, et une relance ne dit nulle part laquelle des deux prises est
  // la plus longue. Le filtre reste `echoRatio` sur `echoWords` mots de tête, dans les deux sens.
  {
    const n = Math.min(S.echoWords, a.length);
    const head = a.slice(0, n), bhead = b.slice(0, Math.max(n, Math.min(b.length, n + 3)));
    let hit = 0;
    for (let i = 0; i < n; i++) if (bhead.includes(head[i])) hit++;
    const r = hit / n;
    if (r >= S.echoRatio) return { ratio: +r.toFixed(2), mots: head.join(' '), via: 'amorce' };
  }
  // (2) le test neuf : la FIN du burst avorté est REDITE au début du suivant
  if (b.length >= 3) {
    const r = redite(a, b);
    if (r) return { ratio: null, mots: r.mots, via: 'redite', n: r.n, pos: r.pos };
  }
  return null;
}

// --- (d) BLANC DE TÊTE : combien de temps avant que la parole n'attaque, dans le span RENDU.
// ⭐ POURQUOI CETTE DIMENSION MANQUAIT (18/09). Le garde savait déjà dire « la borne a coupe
// un mot » (teteTronquee) — c'est-à-dire qu'elle est trop TARD. Il ne savait pas dire qu'elle
// est trop TÔT. Les deux défauts sont opposés et aucun test ne couvrait le second : sur le
// master du 17/09 le garde est sorti VERT sur les quatre spans que le monteur a signalés à la main.
// *Un critère vert ne couvre que la dimension qu'il regarde* — et celle-ci n'était regardée
// par personne.
//
// ⚠ LA MESURE NE SE REFAIT PAS ICI. L'attaque de voix se mesure dans la bande 300-3400 Hz au
// régime dense (`vad.py`), jamais à un RMS large qui confond la voix et l'ambiance de rue —
// c'est la leçon du 01/09, payée en cinq blocs recalés pour rien. La règle vit donc en UN
// exemplaire, dans vad.py, comme `borneCoupeUnMot` vit en un exemplaire dans lib.mjs.
//
// ⚠ ET LA FENÊTRE FAIT PARTIE DE LA MESURE. Les seuils de vad.py sont relatifs au p95 du
// fichier qu'on lui donne : la même tête mesurée sur le span rend 0,14 s, et 0,38 s sur une
// fenêtre de 8 s. On déclare donc la convention — **le wav du span, celui-là même que le
// garde découpe déjà** — et le seuil ci-dessus n'a de sens qu'avec elle.
// ⚠⚠ ET CE N'EST PAS UN ONSET (19/09). La v1 rendait le début de la 1re île, c'est-à-dire
// un onset — calé sur un pic tenu, donc toujours en retard, et arrêté par la moindre pause
// intra-phrase. Résultat : 4 spans déclarés à 0,32-0,44 s de blanc alors que la voix y
// attaque à 0,00 s, 4 réserves posées dans l'EDL pour rien, et un remède `a → a + air` qui
// aurait effacé leur premier mot. `vad.air_de_tete` mesure désormais le plus long SILENCE
// AVÉRÉ devant la parole et rend AUSSI l'instant où ce creux finit : le remède pointe donc
// un silence mesuré, il ne s'additionne plus.
// Cas connus rejouables : `node facecam/overlays/vad-cas.mjs`.
function airDeTete(wav) {
  const out = sh(`"${PY}" "${VAD_PY}" --tete "${wav}"`).trim();
  const v = Object.values(JSON.parse(out))[0];
  if (v === null || v === undefined) return null;   // aucune parole trouvée → NON MESURÉ
  return typeof v === 'number' ? { air: v, fin: v } : v;
}

// début de l'ÉNONCÉ qui contient l'instant t : fin du dernier silence avéré avant lui.
// La règle vit en UN exemplaire, dans vad.py (bande vocale), comme tout le reste.
function debutDeSouffle(wav, t) {
  const out = sh(`"${PY}" "${VAD_PY}" --souffle "${wav}" ${t.toFixed(3)}`).trim();
  return +Object.values(JSON.parse(out))[0];
}

// --- (b) EUH : plage spectralement stable (parole.py, mesure) PUIS transcrite SEULE.
// La mesure ne peut pas halluciner ; la transcription d'une fenêtre < 1 s ne peut pas
// fabriquer une phrase. Éprouvé le 05/09 sur 7 plages d'un même bloc : seule celle du
// vrai « euh » rend un filler, les 6 autres rendent des mots.
// ⚠ UNE PLAGE STABLE PRISE AU MILIEU D'UN MOT SE TRANSCRIT AUSSI « euh » (06/09).
// Isoler 0,49 s au milieu de « par soucis de sécurité » rend « Euh... » — la fenêtre est
// trop courte pour porter un mot, donc whisper rend le son. Le second étage seul ne
// suffit donc pas : il faut que la plage soit BORDÉE d'une pause, ce qu'une voyelle
// tenue au milieu d'un débit n'est jamais. Troisième signal, mesuré comme les deux autres.
// *Un test composite ne vaut que si CHAQUE étage peut dire non pour une raison différente.*
function borde(sils, r, tol = 0.15) {
  return sils.some((s) => Math.abs(s.s - r.b) <= tol || Math.abs(s.e - r.a) <= tol);
}
function euhs(wav, dur) {
  // ⚠ un détecteur qui échoue en SILENCE annonce « 0 euh » : ici on LÈVE, et le span
  // devient NON MESURÉ (défaut bloquant), au lieu de passer pour propre.
  let runs = [];
  runs = JSON.parse(sh(`"${PY}" "${PAROLE_PY}" "${wav}" --min ${S.euhMin} --json`).trim() || '[]');
  const sils = silencesAutour(wav, 0, dur, 0);
  const found = [];
  for (const r of runs) {
    if (!borde(sils, r) && r.b < dur - 0.15 && r.a > 0.15) continue;   // au milieu du débit : c'est une syllabe
    const txt = say(wav, Math.max(0, r.a - 0.05), r.b + 0.05);
    const w = norm(txt);
    const pur = w.length === 0 || w.every((x) => FILLER.has(x));
    if (pur) found.push({ ...r, txt: txt || '(rien)' });
  }
  return found;
}

// --- (c) QUEUE : le span rendu finit-il sur le même mot que son îlot SOURCE ?
// La carte de map.mjs a transcrit l'îlot entier avant toute coupe : c'est la seule
// référence de ce qui aurait dû être dit. Une coupe VOULUE se déclare dans l'EDL.
function tailLoss(islandText, renderedText) {
  const src = norm(islandText), got = norm(renderedText);
  if (!src.length || !got.length) return null;
  const last = got[got.length - 1];
  let at = -1;
  for (let i = src.length - 1; i >= 0; i--) if (src[i] === last) { at = i; break; }
  if (at < 0) return null;                     // mots trop divergents : on ne conclut pas
  const missing = src.slice(at + 1).filter((w) => w.length > 1);
  return missing.length >= S.queueMiss ? { manque: missing.join(' ') } : null;
}

// --- (d) BORNE DANS LA PAROLE — le test vit dans lib.mjs, en UN exemplaire.
// ⭐ Il en existait deux (ici et dans sweep.mjs) avec des paramètres différents : deux
// bornes posées et validées par sweep étaient déclarées fautives ici. Une règle qui vit
// en deux endroits finit par se contredire, et personne ne le voit.
// ⚠⚠ LES DEUX BORNES NE SE JUGENT PAS AVEC LE MÊME TEST, ET CE N'EST PAS UN DÉTAIL DE
// SEUIL. Appliqué aux deux, le test de silence a crié sur 9 spans sur 44 — et son remède
// (« a → premier silence suivant ») aurait supprimé des PHRASES ENTIÈRES.
// Cause : `refine` avance `a` par probe incrémental jusqu'au premier mot de CONTENU, donc
// elle tombe VOLONTAIREMENT dans la parole — elle coupe « Donc », « Et donc », « Alors ».
// Une borne dans la parole n'est donc un défaut que si elle coupe un mot EN DEUX.
//   · `b` : jamais reculée exprès → le test de silence vaut (lib.mjs, partagé avec sweep) ;
//   · `a` : test DIRECT de troncature — le premier mot rendu doit être le même qu'en
//     élargissant la fenêtre en amont. S'il change, on a coupé dedans.
// *Un proxy qui vaut pour une borne ne vaut pas pour l'autre : c'est le DÉFAUT qu'on
// cherche qui décide du test, pas la symétrie du code.*
// ⚠ « Bon » rejoint la liste le 19/09 : c'est une amorce comme « Alors » ou « Voilà »,
// et `refine` la retire exprès sur `beijing-capitale`. Sans elle, le test ci-dessous
// crierait sur un span propre.
const STRIP = new Set(['et', 'donc', 'alors', 'mais', 'voila', 'euh', 'bah', 'ben', 'puis',
  'enfin', 'or', 'ainsi', 'du', 'coup', 'bon', 'ok', 'voila']);

// ⭐⭐ LA DIMENSION QUI MANQUAIT — LA BORNE `a` QUI MANGE LE DÉBUT DE LA PHRASE (19/09).
// le monteur, sur le bloc badge F06 : « tu as coupé des paroles ». Mesuré sur la source, il avait
// raison deux fois : `agences-francaises` rendait « construit avec des agences françaises »
// pour « dont certains qui ont été co-construits… » (la borne coupe DANS le mot), et
// `france-pionniere` rendait « pionnière en matière d'écoquartier » pour « puisque la France
// est pionnière… ». Le garde est sorti VERT sur les deux.
//
// Pourquoi il ne pouvait pas les voir : son test de tête élargissait de **0,35 s au plus**,
// et cherchait un seul mot changé. Ici il manque 1,48 s et 0,64 s de phrase — la fenêtre
// était plus petite que le défaut. *Un instrument ne voit pas ce qui ne tient pas dans sa
// fenêtre, et son silence ne prouve alors rien.*
//
// Trois étages, chacun capable de dire non pour une raison différente :
//  ① OÙ S'ARRÊTER — `debut_de_souffle` (vad.py, bande vocale) : on élargit jusqu'au dernier
//    silence avéré, jamais plus loin. C'est ce qui empêche d'entrer dans la fausse prise que
//    `refine` a volontairement sautée (mesuré : 19 spans sur 44 ont une amorce ou une reprise
//    en amont ; sans cette borne, on crierait sur tous).
//  ② ALIGNER PAR LA QUEUE — les deux fenêtres finissent au MÊME instant, donc leurs fins se
//    correspondent. On ne compare pas mot à mot depuis le début : whisper n'est pas monotone
//    et rend « construit » ici, « construits » là. Comparaison tolérante sur les 4 premières
//    lettres, alignement par le plus long suffixe commun.
//  ③ NE COMPTER QUE LE CONTENU — `refine` retire les amorces EXPRÈS. Perdre « Bon, » ou
//    « donc » n'est pas une coupe ; perdre « certains », « France » ou « puisque » en est une.
function memeMot(x, y) {
  return x === y || (x.length > 3 && y.length > 3 && x.slice(0, 4) === y.slice(0, 4));
}
function teteAmputee(file, a, b, souffle) {
  const amont = Math.max(0, souffle);
  if (a - amont < 0.10) return null;                // rien à élargir : rien à prouver
  const fin = Math.min(b, a + 3.0);
  if (fin - a < 0.20) return null;
  const serre = norm(say(file, a, fin));
  const large = norm(say(file, amont, fin));
  if (!serre.length || !large.length) return null;
  // ② plus long suffixe commun (tolérant)
  let k = 0;
  while (k < serre.length && k < large.length
         && memeMot(serre[serre.length - 1 - k], large[large.length - 1 - k])) k++;
  if (k < 2) return null;                           // trop divergent : on ne conclut pas
  const manque = large.slice(0, large.length - k);
  // ④ ET CE QU'ON « RÉCUPÉRERAIT » PEUT ÊTRE UNE FAUSSE PRISE (19/09, éprouvé sur
  // `disneylandisation-patrimoine`). Là, en amont de `a`, le monteur dit « donc je suis plutôt
  // resté dans la ville » PUIS se reprend « plutôt rester dans la ville, mais ça permet… ».
  // Élargir rend bien des mots de contenu — et les rendre serait un DÉFAUT, pas une
  // réparation : c'est précisément la relance que `refine` a sautée. Le signe qui les
  // sépare : une amputation perd des mots qu'on ne redit pas, une fausse prise REDIT ce
  // qu'on a gardé. Si la tête de ce qu'on garde réapparaît dans ce qu'on aurait perdu,
  // le défaut appartient à la dimension RELANCE, pas à celle-ci.
  // *Deux dimensions qui se disputent le même cas se contredisent tôt ou tard : on
  // désigne le propriétaire au lieu de crier deux fois.*
  const tete = serre.slice(0, 3);
  if (tete.length >= 2) {
    for (let p = 0; p + tete.length <= manque.length; p++) {
      if (tete.every((w, j) => memeMot(w, manque[p + j]))) return null;   // fausse prise
    }
  }
  const perdus = manque.filter((w) => w.length > 1 && !STRIP.has(w) && !MOTS_VIDES.has(w) && !FILLER.has(w));
  if (!perdus.length) return null;
  return { perdus, amont, manque: manque.join(' '), garde: serre.join(' ') };
}

function bornesFautives(file, a, b, souffle) {
  const bad = [];
  const sils = silencesAutour(file, a, b);
  const r = borneCoupeUnMot(sils, b);
  if (r) bad.push({ borne: 'b', t: b, proche: r.apres, ecart: r.ecart });
  const h = teteAmputee(file, a, b, souffle);
  if (h) bad.push({ borne: 'a', t: a, tete: h });
  return bad;
}

// ============================ marche ========================================
const manifest = JSON.parse(fs.readFileSync(master.replace(/\.mp4$/i, '.spans.json'), 'utf8'));
const spans = manifest.spans || manifest;
const cartePath = gf('--carte', null);
const carte = cartePath ? JSON.parse(fs.readFileSync(cartePath, 'utf8')) : null;
const edlPath = gf('--edl', null);
const edl = edlPath ? JSON.parse(fs.readFileSync(edlPath, 'utf8')) : null;
const reserves = new Set((edl && edl._reserves_parole) || []);
const FPS = 30000 / 1001;

// îlot source d'un span : celui de la carte qui le contient (pour le contrôle de queue)
function island(sp) {
  if (!carte) return null;
  const cl = (carte.clips || []).find((c) => c.id === sp.clip);
  if (!cl) return null;
  return (cl.islands || []).find((i) => i.a <= sp.a + 0.35 && i.b >= sp.b - 0.35) || null;
}

const rushDir = (carte && carte.rushDir) || (edl && edl.rushDir) || null;
const fileOfClip = (id) => {
  if (!rushDir) return null;
  const name = edl && edl.clips && edl.clips[id];
  if (name) return `${rushDir}/${name}`;
  const cl = carte && (carte.clips || []).find((c) => c.id === id);
  return cl ? `${rushDir}/${cl.name}.MP4` : null;
};

const defauts = [];
console.log(`GARDE PAROLE — ${spans.length} span(s) du master ${path.basename(master)}`);
console.log(`(la transcription du fichier entier DÉDUPLIQUE les relances : on découpe au silence et on transcrit chaque burst SEUL)\n`);

for (const sp of spans) {
  if (onlySpan && sp.label !== onlySpan) continue;
  const dur = sp.frames / FPS;
  const wav = `${WORK}/${sp.i}_${sp.label}.wav`.replace(/[^\w./-]/g, '_');
  sh(`ffmpeg -y -v error -ss ${sp.t.toFixed(3)} -t ${dur.toFixed(3)} -i "${master}" -ac 1 -ar 16000 "${wav}"`);

  const bs = bursts(wav, dur).map(([a, b]) => ({ a, b, txt: say(wav, a, b) }));
  const local = [];

  // ⭐⭐ LA RELANCE SE CHERCHE SUR LA SOURCE, PAS SUR LE RENDU (18/09). C'est la cause
  // exacte pour laquelle ce garde est sorti VERT sur la relance que le monteur a dû signaler à la
  // main dans `disneylandisation-patrimoine`. Mesuré : dans la SOURCE, la fausse prise
  // (« plutôt rester dans la ville. ») et la reprise sont séparées par 0,36 s de silence,
  // donc la découpe les sépare. Dans le RENDU, `render.mjs` a comprimé ce silence sous le
  // seuil de découpe (silTarget 0,16 s < burstMin 0,15… et le résidu mesuré tombe à 0,02 s) :
  // les deux prises deviennent UN SEUL burst, et whisper — qui DÉDUPLIQUE — en rend une
  // seule phrase. Le défaut disparaît de l'objet qu'on inspecte.
  // *Le remède d'un défaut (serrer les silences) aveugle le garde d'un autre.* On regarde
  // donc là où les bursts existent encore : la source.
  // ⚠ Si la source est introuvable, la dimension est NON MESURÉE — pas propre.
  let bsRel = bs;
  {
    const srcRel = fileOfClip(sp.clip);
    if (srcRel && fs.existsSync(srcRel)) {
      const wsrc = `${WORK}/src_${sp.i}.wav`;
      sh(`ffmpeg -y -v error -ss ${sp.a.toFixed(3)} -to ${sp.b.toFixed(3)} -i "${srcRel}" -ac 1 -ar 16000 "${wsrc}"`);
      try {
        bsRel = burstsVocal(wsrc).map(([a, b]) => ({ a, b, txt: say(wsrc, a, b) }));
      } catch (e) {
        local.push({ type: 'non-mesure', a: 0, b: 0,
          quoi: `découpe en bursts par la BANDE VOCALE indisponible (${String(e.message).split('\n')[0]}) `
              + `— la découpe large ne sépare pas deux prises sur un rush bruyant`,
          remede: 'réparer vad.py / le venv avant de livrer' });
        bsRel = [];
      }
    } else {
      local.push({ type: 'non-mesure', a: 0, b: 0,
        quoi: 'RELANCE NON MESURÉE — rush source introuvable, le rendu ne peut pas la montrer '
            + '(silences comprimés + whisper déduplique)',
        remede: 'passer --carte / --edl pour résoudre le rush source' });
    }
  }
  for (let i = 0; i + 1 < bsRel.length; i++) {
    const e = isEcho(bsRel[i].txt, bsRel[i + 1].txt);
    if (e) local.push({ type: 'relance', a: bsRel[i].a, b: bsRel[i].b, quoi: `« ${bsRel[i].txt} » ${e.via === 'redite' ? `— redite de ${e.n} mots : « ${e.mots} »` : `— même amorce : « ${e.mots} »`}`,
      remede: `a → ${(sp.a + bsRel[i + 1].a).toFixed(3)} (source)`, ratio: e.ratio, via: e.via, redit: e.mots });
  }
  let euhList = null;
  try { euhList = euhs(wav, dur); }
  catch (e) { local.push({ type: 'non-mesure', a: 0, b: 0, quoi: `détecteur de voyelle tenue INDISPONIBLE (${String(e.message).split('\n')[0]})`, remede: 'réparer parole.py avant de livrer' }); euhList = []; }
  for (const e of euhList) {
    if (e.dur >= S.euhMin) local.push({ type: 'euh', a: e.a, b: e.b, quoi: `${e.dur.toFixed(2)}s « ${e.txt} »`,
      remede: e.b > dur - 0.5 ? `b → ${(sp.a + e.a).toFixed(3)} (queue)` : `cut interne [${e.a.toFixed(2)}–${e.b.toFixed(2)}]` });
  }
  // (d) BLANC DE TÊTE — et il BLOQUE, y compris quand il ne sait pas mesurer.
  try {
    const r = airDeTete(wav);
    if (r === null) {
      local.push({ type: 'non-mesure', a: 0, b: 0,
        quoi: 'BLANC DE TÊTE NON MESURÉ — aucune île de parole trouvée dans ce span',
        remede: 'vérifier le wav du span avant de livrer' });
    } else if (r.air > S.airMax) {
      // ⚠ le remède pointe la FIN DU CREUX MESURÉ, pas `a + air`. La forme arithmétique,
      // appliquée telle quelle le 18/09, supprimait des mots dans 4 cas sur 8 : elle
      // supposait que tout ce qui précède l'attaque est du silence, ce qui est faux dès
      // que l'onset est mal daté. Ici on ne déplace `a` que jusqu'où le silence est MESURÉ.
      local.push({ type: 'air', a: 0, b: r.air,
        quoi: `${r.air.toFixed(2)}s de blanc avéré avant la parole (toléré ${S.airMax.toFixed(2)}s)`,
        remede: `a → ${(sp.a + r.fin).toFixed(3)} (source, fin du creux mesuré), puis re-transcrire avant/après` });
    }
  } catch (e) {
    // ⚠ une dimension qu'on ne sait pas mesurer se DÉCLARE et fait ÉCHOUER. Si vad.py
    // ne tourne pas (venv absent, numpy manquant), le garde doit crier — sinon on le
    // désarme par simple omission, et il devient un décor qui dit toujours oui.
    local.push({ type: 'non-mesure', a: 0, b: 0,
      quoi: `mesure du BLANC DE TÊTE INDISPONIBLE (${String(e.message).split('\n')[0]})`,
      remede: 'réparer vad.py / le venv avant de livrer' });
  }

  // ⚠ la queue ne se juge pas sur les MOTS seuls : deux passes de whisper lisent le même
  // son différemment (« sur les choses » / « ce genre de choses ») et le contrôle criait
  // alors pour 0,02 s. Il faut que du TEMPS manque vraiment — mesuré sur 4 alertes : une
  // seule portait sur du son coupé (0,61 s), les trois autres sur 0,02–0,05 s.
  // *Une divergence de transcription n'est pas une perte de contenu.*
  const isl = island(sp);
  if (isl && bs.length && isl.b - sp.b > QUEUE_MIN_S) {
    const t = tailLoss(isl.text, bs[bs.length - 1].txt);
    if (t) local.push({ type: 'queue', a: dur, b: dur,
      quoi: `manque « ${t.manque} » (${(isl.b - sp.b).toFixed(2)}s de son après la borne)`,
      remede: `b → jusqu'à ${isl.b} (îlot source)` });
  }

  const src = fileOfClip(sp.clip);
  if (src && fs.existsSync(src)) {
    // ① la borne d'élargissement se mesure AVANT de transcrire : elle fait partie de la mesure.
    let souffle = sp.a;
    try {
      const R0 = Math.max(0, sp.a - 3.0);
      const wsf = `${WORK}/sf_${sp.i}.wav`;
      sh(`ffmpeg -y -v error -ss ${R0.toFixed(3)} -to ${sp.b.toFixed(3)} -i "${src}" -ac 1 -ar 16000 "${wsf}"`);
      souffle = R0 + debutDeSouffle(wsf, sp.a - R0);
    } catch (e) {
      local.push({ type: 'non-mesure', a: 0, b: 0,
        quoi: `DÉBUT D'ÉNONCÉ NON MESURÉ (${String(e.message).split('\n')[0]}) — la borne « a ampute la phrase » ne peut pas être jugée`,
        remede: 'réparer vad.py / le venv avant de livrer' });
    }
    for (const bd of bornesFautives(src, sp.a, sp.b, souffle)) {
      local.push({ type: 'borne', a: bd.borne === 'a' ? 0 : dur, b: bd.borne === 'a' ? 0 : dur,
        quoi: bd.tete ? `borne a = ${bd.t.toFixed(3)} ampute le début de la phrase : « ${bd.tete.manque} » manque `
                        + `(gardé : « ${bd.tete.garde} »)`
                       : `borne b = ${bd.t.toFixed(3)} tombe DANS la parole à ${bd.ecart}s du silence le plus proche (mot coupé)`,
        remede: bd.tete ? `a → ${bd.tete.amont.toFixed(3)} (début de l'énoncé mesuré), puis re-transcrire avant/après`
                        : (bd.proche ? `b → ${bd.proche.toFixed(3)} (1er silence mesuré après)` : `replacer b sur un silence mesuré`) });
    }
  }

  const dec = local.filter((d) => reserves.has(`${sp.label}:${d.type}`));
  const dur_ = local.filter((d) => !reserves.has(`${sp.label}:${d.type}`));
  const tag = dur_.length ? '⛔' : (dec.length ? '·' : '✓');
  console.log(`${tag} [${String(sp.i).padStart(2)}] ${sp.clip} ${sp.label}  (${dur.toFixed(2)}s, ${bs.length} burst(s))`);
  for (const d of dur_) { console.log(`      ⛔ ${d.type.toUpperCase()} @${d.a.toFixed(2)}s — ${d.quoi}`); console.log(`         → ${d.remede}`); }
  for (const d of dec) console.log(`      · ${d.type} déclaré en réserve dans l'EDL — ${d.quoi}`);
  for (const d of dur_) defauts.push({ span: sp.label, i: sp.i, clip: sp.clip, ...d });
}

if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ master, defauts, seuils: S }, null, 1));
console.log(`\nVERDICT : ${defauts.length ? `⛔ ${defauts.length} défaut(s) — ` : '✓ '}`
  + (defauts.length ? `${defauts.filter(d=>d.type==='relance').length} relance · ${defauts.filter(d=>d.type==='euh').length} euh · ${defauts.filter(d=>d.type==='queue').length} queue · ${defauts.filter(d=>d.type==='borne').length} borne · ${defauts.filter(d=>d.type==='air').length} blanc de tête · ${defauts.filter(d=>d.type==='non-mesure').length} NON MESURÉ`
                    : 'aucune relance, aucun euh long, aucune queue tronquée, aucun blanc de tête'));
try { fs.rmSync(WORK, { recursive: true, force: true }); } catch {}
process.exit(defauts.length ? 1 : 0);
