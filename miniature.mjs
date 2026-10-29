#!/usr/bin/env node
// ============================================================================
// miniature.mjs — LA VIGNETTE D'UN ÉPISODE (image fixe, pas une vidéo)
//
// Sort une image 4K (3840×2160) tirée d'un plan du film, avec le titre gravé
// dans la TYPO MAISON — celle du carton de ville de `vlog.mjs` : Bebas Neue,
// couleur d'accent du profil, ombre portée, idéogrammes en PingFang. Rien n'est réinventé
// ici : une miniature qui n'a pas la typo du film n'est pas la miniature du film.
//
// POURQUOI un script et pas trois commandes dans le terminal (garde-fou 31/07,
// « une chaîne qu'on ne peut pas rejouer n'est pas une chaîne ») : il y aura une
// miniature par épisode, et chacune redemande les mêmes gestes — extraire la
// frame SANS ré-encoder tout, mesurer où poser le texte, vérifier qu'il tient
// sur le fond. Le troisième geste est celui qu'on saute quand on improvise.
//
// D'OÙ VIENT L'IMAGE. Par défaut du MASTER, pas du rush : le master porte déjà
// le grade (DA LOOK STUDIO) et le crop du film. Prendre le rush brut donnerait une
// vignette qui ne ressemble pas à la vidéo qu'elle annonce. `--brut` force
// quand même la source rush, pour un cas où le master n'existe pas encore.
//
// CE QUI EST MESURÉ, jamais jugé à l'œil (doctrine des overlays) :
//   1. la bande la plus CALME de l'image (densité de contours par bande) → où poser le titre ;
//   2. le CONTRASTE réel sous le texte — part du fond plus claire que l'accent, au pire
//      cas dans la boîte de texte. Même critère que le carton de ville : seuil ~15 %.
//   3. la LARGEUR réelle du texte rendu (Bebas est condensée : la deviner, c'est
//      livrer un titre à 40 % ou à 110 % du cadre). Rendu-puis-mesuré, pas estimé.
//
// Usage :
//   node miniature.mjs "<source.mp4>" --t <sec> --titre "Shanghai" [--hanzi 上海]
//        [--titre "SUD DE|LA CHINE"] [--interligne 0.86]
//        [--pos auto|haut|centre|bas] [--largeur 0.62] [--out "<fichier.jpg>"]
//        [--def 2160] [--scrim] [--dry]
//
// Sortie : Vidéos finies/Éléments/  (pièce réutilisable, jamais purgée) —
//   « MINIATURE <nom> 4K.jpg »  + la version 1280×720 que YouTube demande à l'upload.
// 100 % local/offline.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ELEMENTS } from './store.mjs';
import { ACCENT_FFMPEG, ACCENT_LUM_GRIS } from './profil.mjs';   // l'identité visuelle vit dans le profil

const ENGINE = path.dirname(fileURLToPath(import.meta.url));
const WORK = path.join(ENGINE, 'work', 'miniature');

// ---- typo maison : STRICTEMENT celle du carton de ville (vlog.mjs §6-bis) ------------------
const FONT_TITRE = path.join(ENGINE, 'facecam/assets/fonts/BebasNeue-Regular.ttf');
const FONT_CJK = '/System/Library/Fonts/PingFang.ttc';
const ACCENT_PROFIL = ACCENT_FFMPEG;
const ACCENT_PROFIL_LUM = ACCENT_LUM_GRIS;   // seuil de contraste, cf. profil/defaut.json
const SEUIL_CONTRASTE = 15;    // % du fond plus clair que l'accent au-delà duquel le titre se noie

// ---- arguments ------------------------------------------------------------------------------
const argv = process.argv.slice(2);
const opt = (name, def = null) => {
  const i = argv.indexOf(name);
  if (i < 0) return def;
  const v = argv[i + 1];
  argv.splice(i, 2);
  return v;
};
const flag = (name) => { const i = argv.indexOf(name); if (i < 0) return false; argv.splice(i, 1); return true; };

const DRY = flag('--dry');
const SCRIM = flag('--scrim');
const BRUT = flag('--brut');
const T = parseFloat(opt('--t', '0'));
const TITRE = opt('--titre');
// ⭐ TITRE MULTI-LIGNE (01/09) : `--titre "SUD DE|LA CHINE"`. Un `drawtext` unique avec des `\n`
// aligne les lignes À GAUCHE dans le bloc — sur une vignette centrée, ça se voit tout de suite.
// Chaque ligne est donc gravée par SON PROPRE drawtext, chacune recentrée sur `(w-tw)/2`.
const LIGNES = String(TITRE ?? '').split('|').map((x) => x.trim()).filter(Boolean);
const INTERLIGNE = parseFloat(opt('--interligne', '0.86'));   // pas vertical, en corps de police
const HANZI = opt('--hanzi');
const POS = opt('--pos', 'auto');
const LARGEUR = parseFloat(opt('--largeur', '0.62'));   // largeur cible du titre, en fraction du cadre
const DEF = parseInt(opt('--def', '2160'), 10);
let OUT = opt('--out');
const SRC = argv[0];

if (!SRC || !TITRE) {
  console.error('usage: node miniature.mjs "<source.mp4>" --t <sec> --titre "Shanghai" [--hanzi 上海]\n'
    + '                            [--pos auto|haut|centre|bas] [--largeur 0.62] [--out x.jpg] [--scrim] [--dry]');
  process.exit(2);
}
if (!fs.existsSync(SRC)) { console.error(`✗ source introuvable : ${SRC}`); process.exit(1); }
if (!fs.existsSync(FONT_TITRE)) { console.error(`✗ police maison absente : ${FONT_TITRE}`); process.exit(1); }

const W = Math.round(DEF * 16 / 9), H = DEF;
const K = DEF / 1080;                       // même facteur d'échelle que vlog.mjs : la typo est RELATIVE au cadre
OUT ||= path.join(ELEMENTS, `MINIATURE ${LIGNES.join(' ')} ${DEF >= 2160 ? '4K' : DEF + 'p'}.jpg`);

// ---- utilitaires ------------------------------------------------------------------------------
const sh = (bin, args) => execFileSync(bin, args, { encoding: 'utf8', maxBuffer: 1 << 28 });
const ff = (args) => sh('ffmpeg', ['-y', '-v', 'error', ...args]);
const probe = (f, entries) =>
  sh('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', `stream=${entries}`,
    '-of', 'default=nw=1:nk=1', f]).trim().split('\n');

// mesure d'image déléguée à python/cv2 (le venv vision du repo, déjà utilisé par freespace/gate)
const PY = path.join(ENGINE, '.venv-vision/bin/python');
const mesure = (script) => {
  const f = path.join(WORK, '_mesure.py');
  fs.writeFileSync(f, script);
  return JSON.parse(sh(PY, [f]).trim());
};

fs.mkdirSync(WORK, { recursive: true });

// ---- 1) la frame ------------------------------------------------------------------------------
const [sw, sh_] = probe(SRC, 'width,height');
const dur = parseFloat(probe(SRC, 'duration')[0] || '0');
console.log(`source   : ${path.basename(SRC)}  ${sw}×${sh_}${dur ? `  (${dur.toFixed(2)}s)` : ''}${BRUT ? '  [RUSH BRUT — pas de grade]' : ''}`);
if (dur && T >= dur) { console.error(`✗ t=${T}s dépasse la durée de la source (${dur.toFixed(2)}s)`); process.exit(1); }

const FRAME = path.join(WORK, 'frame.png');
// -ss AVANT -i = seek rapide ; la frame est décodée telle quelle puis mise à la définition
// cible en lanczos. Pas de ré-encodage du film : on ne touche qu'une image.
ff(['-ss', String(T), '-i', SRC, '-frames:v', '1',
  '-vf', `scale=${W}:${H}:flags=lanczos`, '-pix_fmt', 'rgb24', FRAME]);
// ⚠️ `exit 0` n'est pas une preuve (garde-fou 31/07) : on vérifie la SORTIE, pas le code retour.
if (!fs.existsSync(FRAME) || fs.statSync(FRAME).size < 10000) {
  console.error('✗ frame vide — le -ss est probablement au-delà du dernier keyframe utile'); process.exit(1);
}

// ---- 2) où est le calme ? (mesure, jamais à l'œil) --------------------------------------------
// Trois bandes horizontales. On note chacune par sa densité de contours : un titre posé sur
// une façade saturée de climatiseurs est illisible même bien contrasté.
const bandes = mesure(`
import cv2, numpy as np, json
im = cv2.imread(${JSON.stringify(FRAME)})
H, W = im.shape[:2]
g  = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
ed = cv2.Canny(cv2.GaussianBlur(g,(5,5),0), 60, 160)
out = {}
for nom, (a, b) in {"haut":(0.06,0.34), "centre":(0.36,0.64), "bas":(0.66,0.94)}.items():
    y0, y1 = int(a*H), int(b*H)
    sg, se = g[y0:y1], ed[y0:y1]
    out[nom] = {"y0": y0, "y1": y1,
                "contours": round(100*float(se.mean())/255, 2),
                "lum": round(float(sg.mean()), 1),
                "plus_clair_que_accent": round(100*float((sg > ${ACCENT_PROFIL_LUM}).mean()), 1)}
print(json.dumps(out))
`);
console.log('\nbandes   :  (densité de contours = agitation du fond ; plus bas = plus calme)');
for (const [nom, b] of Object.entries(bandes))
  console.log(`  ${nom.padEnd(7)} contours ${String(b.contours).padStart(5)} %   lum ${String(b.lum).padStart(5)}   plus clair que l'accent ${String(b.plus_clair_que_accent).padStart(5)} %`);

const choisie = POS === 'auto'
  ? Object.entries(bandes).sort((a, b) => a[1].contours - b[1].contours)[0][0]
  : POS;
if (!bandes[choisie]) { console.error(`✗ --pos ${POS} inconnu (haut|centre|bas|auto)`); process.exit(1); }
console.log(`  → bande retenue : ${choisie}${POS === 'auto' ? ' (la plus calme)' : ' (imposée)'}`);

// ---- 3) la taille du titre : RENDUE puis MESURÉE, jamais estimée -------------------------------
// Bebas Neue est une condensée : à taille égale, « SHANGHAI » et « HONG KONG » n'occupent pas
// la même largeur. On rend le texte seul, on mesure sa boîte, on en déduit la taille exacte
// qui donne la largeur voulue. Une règle de trois sur une police, ça se vérifie.
const REF = 200;
// Chaque ligne est mesurée SÉPARÉMENT : c'est la plus LARGE qui fixe le corps, sinon un titre de
// deux lignes déborde du cadre dès que la seconde est plus longue que la première.
const boxes = LIGNES.map((txt, i) => {
  const png = path.join(WORK, `probe${i}.png`);
  ff(['-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}`, '-frames:v', '1',
    '-vf', `drawtext=fontfile='${FONT_TITRE}':text='${txt.toUpperCase()}':x=(w-tw)/2:y=(h-th)/2:fontsize=${REF}:fontcolor=white`,
    png]);
  return mesure(`
import cv2, numpy as np, json
im = cv2.imread(${JSON.stringify(png)}, cv2.IMREAD_GRAYSCALE)
ys, xs = np.where(im > 40)
print(json.dumps({"w": int(xs.max()-xs.min()+1), "h": int(ys.max()-ys.min()+1)}))
`);
});
const refW = Math.max(...boxes.map((x) => x.w));
const FS = Math.round(REF * (LARGEUR * W) / refW);
const larg = boxes.map((x) => Math.round(x.w * FS / REF));
const hauts = boxes.map((x) => Math.round(x.h * FS / REF));
const titreW = Math.max(...larg);
const PAS = Math.round(FS * INTERLIGNE);
const titreH = hauts[0] + PAS * (LIGNES.length - 1) + (hauts[hauts.length - 1] - hauts[0] > 0 ? hauts[hauts.length - 1] - hauts[0] : 0);
console.log(`\ntitre    : « ${LIGNES.map((l) => l.toUpperCase()).join(' / ')} »  Bebas Neue ${FS} px`
  + `${LIGNES.length > 1 ? `  ·  ${LIGNES.length} lignes, pas ${PAS} px` : ''}`);
LIGNES.forEach((l, i) => console.log(`  ligne ${i + 1} : « ${l.toUpperCase()} »  ${larg[i]}×${hauts[i]} px  `
  + `(${(100 * larg[i] / W).toFixed(1)} % de la largeur${i === larg.indexOf(titreW) ? ', c\'est elle qui fixe le corps' : ''})`));
console.log(`  bloc    : ${titreW}×${titreH} px  (cible de largeur ${(100 * LARGEUR).toFixed(0)} %)`);

// ---- 4) placement ------------------------------------------------------------------------------
const b = bandes[choisie];
const hanziFS = Math.round(FS * 0.30);
const blocH = titreH + (HANZI ? Math.round(hanziFS * 1.5) : 0);
// Le bloc se centre sur la bande, PUIS se recale dans le cadre : à 62 % de largeur le titre
// est haut de ~26 % du cadre, et centrer sur la bande « haut » le ferait sortir par le haut.
// Une marge de sûreté de 4 % évite aussi le rognage des lecteurs qui recadrent la vignette.
const MARGE = Math.round(0.04 * H);
const yTitre = Math.max(MARGE, Math.min(H - blocH - MARGE,
  Math.round((b.y0 + b.y1) / 2 - blocH / 2)));
const yHanzi = yTitre + titreH + Math.round(hanziFS * 0.55);
const x0 = Math.round((W - titreW) / 2), x1 = x0 + titreW;

// ---- 5) contraste RÉEL sous la boîte de texte (le critère du carton de ville) -------------------
const contraste = mesure(`
import cv2, numpy as np, json
im = cv2.imread(${JSON.stringify(FRAME)})
g  = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
box = g[${yTitre}:${yTitre + blocH}, ${x0}:${x1}]
print(json.dumps({"clair": round(100*float((box > ${ACCENT_PROFIL_LUM}).mean()), 1),
                  "lum": round(float(box.mean()), 1)}))
`);
const ko = contraste.clair > SEUIL_CONTRASTE;
console.log(`contraste: sous le texte, ${contraste.clair} % du fond est plus clair que l'accent `
  + `(seuil ${SEUIL_CONTRASTE} %) → ${ko ? '⚠ le titre se noie' : 'OK'}${ko && !SCRIM ? '  — relancer avec --scrim' : ''}`);
if (SCRIM) console.log('  scrim : voile sombre dégradé sous la bande de titre (--scrim)');

if (DRY) { console.log('\n--dry : rien d\'écrit.'); process.exit(0); }

// ---- 6) gravure -------------------------------------------------------------------------------
// Même recette que le carton : accent + ombre portée noire. L'ombre est ce qui fait tenir la typo
// sur un fond quelconque ; le scrim n'arrive qu'en renfort, quand la mesure le réclame.
const vf = [];
if (SCRIM) {
  // voile sombre limité à la bande de titre, bords fondus — jamais un bandeau franc
  const sy0 = Math.max(0, yTitre - Math.round(0.10 * H)), sh2 = Math.round(blocH + 0.20 * H);
  vf.push(`drawbox=x=0:y=${sy0}:w=${W}:h=${sh2}:color=black@0.42:t=fill`);
}
// une passe par ligne, chacune RECENTRÉE : un seul drawtext à `\n` alignerait tout à gauche.
LIGNES.forEach((txt, i) => vf.push(
  `drawtext=fontfile='${FONT_TITRE}':text='${txt.toUpperCase()}':x=(w-tw)/2:y=${yTitre + i * PAS}`
  // ombre au PRORATA de la typo : le carton porte 4 px pour 150 px de corps, on garde le ratio
  + `:fontsize=${FS}:fontcolor=${ACCENT_PROFIL}:shadowcolor=black@0.8:shadowx=0:shadowy=${Math.round(FS * 4 / 150)}`));
if (HANZI) vf.push(`drawtext=fontfile='${FONT_CJK}':text='${HANZI}':x=(w-tw)/2:y=${yHanzi}`
  + `:fontsize=${hanziFS}:fontcolor=${ACCENT_PROFIL}:shadowcolor=black@0.8:shadowx=0:shadowy=${Math.round(2 * K * 2)}`);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
ff(['-i', FRAME, '-vf', vf.join(','), '-q:v', '2', OUT]);

// YouTube plafonne la miniature d'upload à 2 Mo / 1280×720 minimum : on livre aussi ce format,
// pour ne pas avoir à redimensionner à la main au moment de publier.
const OUT_YT = OUT.replace(/\.jpg$/i, ' (upload 1280).jpg');
ff(['-i', OUT, '-vf', 'scale=1280:720:flags=lanczos', '-q:v', '3', OUT_YT]);

// ---- 7) preuve : on mesure la SORTIE, pas le code retour ----------------------------------------
for (const f of [OUT, OUT_YT]) {
  const [w, h] = probe(f, 'width,height');
  const ko2 = fs.statSync(f).size / 1e6;
  console.log(`\n✓ ${path.basename(f)}  ${w}×${h}  ${ko2.toFixed(2)} Mo${ko2 > 2 ? '  ⚠ > 2 Mo (limite YouTube)' : ''}`);
  console.log(`  ${f}`);
}
