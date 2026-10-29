#!/usr/bin/env node
// ============================================================================
// facecam/lumieres.mjs — ÉQUILIBRAGE DE LUMIÈRE ENTRE PRISES FACECAM.
//
// Demande du monteur (02/08) : « il y a des plans sombres et d'autres très lumineux,
// c'est le hasard de la mise au point (…) identifie les plans lumineux et baisse
// un peu les fortes lumières, quitte à avoir une légère ambiance tamisée. »
//
// Le problème est RÉEL et mesurable : les rushs sont tournés à contre-jour devant
// une fenêtre, l'exposition auto du DJI se cale différemment d'une prise à l'autre.
// Enchaîner deux spans écartés de 30 IRE fait un flash au raccord.
//
// Ce que fait l'outil : il MESURE (signalstats, échantillonné) et il ÉCRIT une
// correction par span dans l'EDL (`lum`). Il ne rend rien — c'est `render.mjs` qui
// applique `lum` au moment d'encoder le segment.
//
//   yavg  = luminance moyenne (0-255)
//   yhi   = niveau des HAUTES lumières (YMAX moyen : ce qui brûle)
//
// Correction posée (deux gestes, dosés par la mesure, jamais forfaitaires) :
//   • rolloff des hautes lumières `p` = base + proportionnel à l'excès de yhi ;
//     c'est le geste demandé (« baisser les fortes lumières »), il s'applique à
//     TOUS les plans (la « légère ambiance tamisée » assumée) et plus fort aux
//     plans brûlés ;
//   • rattrapage d'exposition `g` sur les MEDIUMS uniquement, pour ramener chaque
//     span vers la médiane du film — c'est ce qui supprime le flash au raccord,
//     sans toucher le noir (donc sans délaver l'image).
//
// Le résultat est une `curves=all=` à 4 points, bornée : jamais plus de 0,14 de
// rolloff ni 0,10 de gain, pour qu'aucune prise ne se voie « corrigée ».
//
// Usage: node facecam/lumieres.mjs <edl.json|edl.refined.json> [--n 6] [--apply]
//        --n = images échantillonnées par span (défaut 6)   --apply = écrit `lum`
// ============================================================================
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { listClips, resolveRushDir } from './lib.mjs';

const args = process.argv.slice(2);
const edlPath = args[0];
if (!edlPath) { console.error('usage: node facecam/lumieres.mjs <edl.json> [--n 6] [--apply]'); process.exit(1); }
// ⚠ getf, pas args[indexOf+1] : sans le flag, indexOf vaut -1 et args[0] serait lu comme valeur.
const getf = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const NS = +getf('--n', 6);
const APPLY = args.includes('--apply');

// bornes (une correction qui se voit est une correction ratée), en FRACTION de l'échelle
const ROLL_BASE = 0.050;   // tamisé de fond, sur tous les plans
const ROLL_MAX = 0.140;    // rolloff maximum des hautes lumières
// (l'ancien GAIN_MAX unique a été RETIRÉ le 02/08 : depuis que le rattrapage est asymétrique, les
//  deux bornes sont GAIN_MAX_NEG et GAIN_MAX_POS, plus bas. Une constante qui ne borne plus rien
//  mais reste en tête de fichier finit par être lue comme la règle en vigueur.)
const YHI_REF = 0.920;     // au-delà, les hautes lumières sont considérées brûlées
// ⚠ PLAFOND ABSOLU DE LA CIBLE (02/08, 2e passe). Viser la MÉDIANE du film ne corrige rien quand
// la médiane est elle-même trop claire : sur Hong Kong, 8 spans sur 9 étaient groupés entre 53 %
// et 63 %, donc la médiane valait 60,7 % et le plan le plus clair ne descendait que de 1,9 %.
// La cible du rattrapage est désormais `min(médiane, TARGET_ABS)` : on ne vise JAMAIS plus clair
// que ce plafond (les plans clairs descendent pour de bon), et un film déjà sombre garde sa
// médiane (le plafond ne peut qu'assombrir, jamais éclaircir). C'est l'« ambiance tamisée »
// assumée par le monteur (« on peut y aller franchement »).
// ⭐ REMONTÉ à 0.560 puis REMIS à 0.520 (02/08) — et c'est la leçon la plus chère du lot.
// le monteur : « je voulais éclaircir tous les sombres ». J'ai lu ça comme « le niveau général est trop
// tamisé » et j'ai remonté la CIBLE. Résultat mesuré : le plan clair est remonté de 2,2 points
// quand le plan sombre n'en gagnait que 1,4 — j'avais RÉÉCLAIRCI les plans clairs que le monteur m'avait
// fait baisser deux fois. Son rappel : *« c'est l'inverse, on doit converger clair/sombre — j'ai
// demandé à éclaircir le sombre ET assombrir le clair. »*
// ⚠️ La CIBLE fixe le NIVEAU où tout le monde se retrouve ; elle ne fait pas converger. Ce qui
// converge, ce sont les multiplicateurs (DARK_PUSH / LIGHT_PULL) et la forme de la courbe
// (LIFT_HI). Toucher au niveau pour répondre à une demande de convergence, c'est bouger le point
// de rendez-vous au lieu de rapprocher les deux qui doivent s'y rendre. La cible ne se touche donc
// QUE si le monteur parle du niveau général — jamais pour rapprocher deux plans.
const TARGET_ABS = 0.520;
// ⚠ LE RATTRAPAGE EST ASYMÉTRIQUE (02/08, 3e passe). le monteur : « tu peux encore baisser la luminosité
// des rushs CLAIRS uniquement ». Baisser encore TARGET_ABS aurait aussi rogné le RELEVAGE des plans
// sombres (leur gain positif est calculé depuis la même cible) — donc ça n'aurait pas été « clairs
// uniquement ». On ne touche que la BRANCHE NÉGATIVE du gain : un span au-dessus de la cible est
// assombri DARK_PUSH fois plus fort, un span au-dessous garde exactement la courbe d'avant (la
// vérification est faite : les courbes des spans à gain positif sont inchangées au chiffre près).
// Effet proportionnel voulu : plus un plan est clair, plus il descend ; un plan à peine au-dessus
// de la cible ne bouge quasiment pas.
const DARK_PUSH = 1.5;     // multiplicateur du gain NÉGATIF seulement
const GAIN_MAX_NEG = 0.200; // borne propre à l'assombrissement
// ⚠ SYMÉTRIQUE (02/08, 5e passe) — le monteur : « éclaircit un peu les rushs sombres ». Même mécanisme,
// autre branche. Attention au piège mesuré : monter la borne SEULE n'aurait RIEN fait, parce que
// le plan le plus sombre de Hong Kong ne touchait pas la borne (il demandait +12,0 % pour +13,0 %
// autorisés) — ce qui le limitait, c'était la CIBLE, pas le plafond. *Avant de desserrer une borne,
// vérifier qu'elle mord vraiment.* Le levier est donc le multiplicateur, et la borne ne fait que
// lui laisser la place. Un plan à peine sous la cible ne bouge quasiment pas.
const LIGHT_PULL = 1.4;    // multiplicateur du gain POSITIF seulement
const GAIN_MAX_POS = 0.200; // borne propre au relevage
const LIFT_HI = 1.00;      // poids du gain POSITIF au point 0.70 de la courbe (0.45 en négatif)
// ⚠ signalstats rend les valeurs dans la PROFONDEUR DE LA SOURCE : les rushs DJI sont en 10 bits,
// donc YAVG ≈ 620 et YMAX ≈ 950 sur 1023, pas sur 255. Une formule écrite « en 8 bits » saturait
// le rolloff au maximum pour TOUS les plans — la correction ne corrigeait plus rien (vécu 02/08).
// On détecte l'échelle au lieu de la supposer.

const edl = JSON.parse(fs.readFileSync(edlPath, 'utf8'));
const rushDir = resolveRushDir(edl.rushDir);
const clips = {};
if (edl.clips) for (const [id, name] of Object.entries(edl.clips)) clips[id] = `${rushDir}/${name}`;
else for (const c of listClips(rushDir)) clips[c.id] = c.file;

function mesure(file, a, b) {
  const dur = Math.max(0.2, b - a);
  const fps = Math.max(0.5, NS / dur);
  let out = '';
  try {
    out = execSync(`ffmpeg -nostats -ss ${a} -t ${dur.toFixed(3)} -i "${file}" ` +
      `-vf "fps=${fps.toFixed(3)},scale=480:-2,signalstats,metadata=print:key=lavfi.signalstats.YAVG" ` +
      `-f null - 2>&1`, { encoding: 'utf8', maxBuffer: 1 << 28 });
  } catch (e) { out = String(e.stdout || '') + String(e.stderr || ''); }
  const yavg = [...out.matchAll(/YAVG=([\d.]+)/g)].map((m) => +m[1]);
  let out2 = '';
  try {
    out2 = execSync(`ffmpeg -nostats -ss ${a} -t ${dur.toFixed(3)} -i "${file}" ` +
      `-vf "fps=${fps.toFixed(3)},scale=480:-2,signalstats,metadata=print:key=lavfi.signalstats.YMAX" ` +
      `-f null - 2>&1`, { encoding: 'utf8', maxBuffer: 1 << 28 });
  } catch (e) { out2 = String(e.stdout || '') + String(e.stderr || ''); }
  const ymax = [...out2.matchAll(/YMAX=([\d.]+)/g)].map((m) => +m[1]);
  const moy = (x) => (x.length ? x.reduce((s, v) => s + v, 0) / x.length : NaN);
  return { yavg: moy(yavg), yhi: moy(ymax), n: yavg.length };
}

const RAW = edl.spans.map((sp) => mesure(clips[sp.clip], sp.a, sp.b));
// échelle réelle de la source : 10 bits si les hautes lumières dépassent 255
const SCALE = Math.max(...RAW.map((m) => m.yhi)) > 300 ? 1023 : 255;
const M = RAW.map((m) => ({ yavg: m.yavg / SCALE, yhi: m.yhi / SCALE, n: m.n }));
M.forEach((m, i) => {
  const sp = edl.spans[i];
  console.log(`[${String(i).padStart(2)}] ${sp.clip} ${(sp.label || '').padEnd(36)} yavg=${(m.yavg * 100).toFixed(1)}%  hautes=${(m.yhi * 100).toFixed(1)}%  (${m.n} img)`);
});

const med = [...M.map((m) => m.yavg)].sort((x, y) => x - y)[Math.floor(M.length / 2)];
const spread = Math.max(...M.map((m) => m.yavg)) - Math.min(...M.map((m) => m.yavg));
const cible = Math.min(med, TARGET_ABS);
console.log(`\néchelle source : ${SCALE === 1023 ? '10 bits (0-1023)' : '8 bits (0-255)'}  ·  médiane du film : ${(med * 100).toFixed(1)}%  ·  cible retenue : ${(cible * 100).toFixed(1)}%${cible < med ? ` (plafond ${(TARGET_ABS * 100).toFixed(0)} %)` : ''}  ·  écart max ${(spread * 100).toFixed(1)} points`);

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lums = M.map((m, i) => {
  // rolloff : base pour tout le monde + proportionnel à ce qui dépasse YHI_REF (plein sur +8 pts)
  const p = clamp(ROLL_BASE + clamp((m.yhi - YHI_REF) / 0.08, 0, 1) * (ROLL_MAX - ROLL_BASE), ROLL_BASE, ROLL_MAX);
  // gain medium : ramène le span vers la CIBLE (positif = éclaircir un plan sombre)
  // — branche négative (plan CLAIR) poussée par DARK_PUSH, branche positive intacte.
  const ecart = cible - m.yavg;
  const g = ecart < 0
    ? clamp(ecart * DARK_PUSH, -GAIN_MAX_NEG, 0)
    : clamp(ecart * LIGHT_PULL, 0, GAIN_MAX_POS);
  // courbe 4 points : noir intact, medium décalé de g, épaule tirée de p
  // ⭐ LE RELEVAGE MONTE PLUS HAUT DANS LA COURBE QUE L'ASSOMBRISSEMENT (02/08, 7e passe).
  // Constat mesuré : sur HK span 0, un gain de +20 % ne rendait que +7,7 points de luminance
  // moyenne. La raison n'est pas la borne mais la FORME de la courbe — le poids du gain valait
  // 0,85 au point 0.35 et seulement 0,45 au point 0.70, or ce qui fait la moyenne de ce plan,
  // c'est la FENÊTRE (zone haute), pas les ombres. On relevait donc surtout ce qui ne pesait pas.
  // *Corriger une moyenne demande d'agir là où la matière est, pas là où le réglage est commode.*
  // Le poids haut du relevage passe donc à LIFT_HI ; celui de l'assombrissement ne bouge PAS
  // (0.45), donc les plans clairs sont strictement inchangés — vérifiable sur leurs `lum.curve`.
  const wHi = g > 0 ? LIFT_HI : 0.45;
  const p70 = 0.70 + g * wHi - p * 0.55;
  const p100 = clamp(1 - p, 0.5, 1);
  const c = [
    '0/0',
    `0.35/${clamp(0.35 + g * 0.85, 0.02, 0.98).toFixed(4)}`,
    // garde de MONOTONIE : le point 0.70 ne doit jamais rattraper le point 1.0, sinon la courbe
    // s'inverse dans les hautes lumières et l'image se solarise sans que rien ne le signale.
    `0.70/${clamp(p70, 0.02, p100 - 0.01).toFixed(4)}`,
    `1/${p100.toFixed(4)}`,
  ].join(' ');
  const lum = { curve: c, _yavg: +(m.yavg * 100).toFixed(1), _yhi: +(m.yhi * 100).toFixed(1), _roll: +p.toFixed(4), _gain: +g.toFixed(4) };
  console.log(`[${String(i).padStart(2)}] rolloff ${(p * 100).toFixed(1)}%  gain ${(g * 100 >= 0 ? '+' : '')}${(g * 100).toFixed(1)}%  →  ${c}`);
  return lum;
});

if (APPLY) {
  edl.spans.forEach((sp, i) => { sp.lum = lums[i]; });
  edl._lumieres = 'Équilibrage mesuré par facecam/lumieres.mjs : rolloff des hautes lumières + rattrapage d\'exposition vers la médiane du film. render.mjs applique sp.lum.curve.';
  fs.writeFileSync(edlPath, JSON.stringify(edl, null, 1));
  console.log(`\n→ ${edlPath} (lum écrit sur ${edl.spans.length} spans)`);
} else {
  console.log('\n(relancer avec --apply pour écrire `lum` dans l\'EDL)');
}
