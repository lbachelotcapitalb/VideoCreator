#!/usr/bin/env node
// ============================================================================
// facecam/overlays/subs.mjs — sous-titres KARAOKÉ accent pour une fenêtre du rendu
//
// Reprend la mécanique éprouvée de `monte.mjs` (buildKaraokeASS : ≤5 mots, ≤3 s,
// coupe sur silence > 0,8 s ou ponctuation ; `\kf` = gap + durée du mot pour que
// le remplissage colle à la voix) avec 3 différences voulues :
//   1. couleur couleur d'accent du profil (au lieu du violet du moteur d'ambiance) ;
//   2. police libre embarquée (Montserrat, OFL) via `fontsdir` — aucune install
//      système, donc reproductible sur une autre machine et hors ligne ;
//   3. LEXIQUE de noms propres : whisper écrit « Chiamen », « Qionqing »,
//      « Petkin »… Un sous-titre affiche du TEXTE : il faut corriger, sinon on
//      brûle une faute dans l'image. Le lexique est par vidéo, dans le spec.
//
// Les timecodes sont RELATIFS à t0 (on transcrit la tranche extraite), donc l'ASS
// se brûle tel quel sur l'extrait rendu — pas de décalage à gérer.
//
// Usage : subs.mjs <video> <t0> <t1> --out <x.ass> [--model small|large-v3]
//                  [--lexique <l.json>] [--fontname "Montserrat ExtraBold"]
//                  [--size 56] [--marginv 108] [--marginlr 200]
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { ACCENT_ASS } from '../../profil.mjs';   // l'identité visuelle vit dans le profil

// fileURLToPath, PAS new URL().pathname : le store est sous « Application Support »
// et pathname rend « Application%20Support » → whisper-cli ne trouve pas le modèle
const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODELS = path.join(HERE, '..', '..', 'models');
const a = process.argv.slice(2);
const opt = (n, d) => { const i = a.indexOf(n); if (i < 0) return d; const v = a[i + 1]; a.splice(i, 2); return v; };
const out = opt('--out', null);
// large-v3 par DÉFAUT : on brûle du TEXTE dans l'image, le phrasé et la ponctuation
// comptent plus que la vitesse (~8 s pour 24 s de parole). `--model small` = repli rapide.
const modelName = opt('--model', 'large-v3');
const lexPath = opt('--lexique', null);
// ⚠️ FONTNAME : libass retombe SILENCIEUSEMENT sur Helvetica si le nom ne matche
// pas — aucune erreur, juste la mauvaise police à l'image. Il faut le nom de
// famille LEGACY qui embarque la graisse (« Montserrat ExtraBold », « Fira Sans
// Black »), pas la famille typographique (« Montserrat » → Helvetica !).
// Seules les graisses standard (Regular/Bold) se demandent par famille + Bold.
// DÉFAUT = Lato Black 58, choisi par le monteur le 25/07 sur planche comparative de 9 polices
// (neutre chaud, discret : il ne vole pas la vedette au panneau Montserrat de la carte).
const FONT = opt('--fontname', 'Lato Black');
const BOLD = +opt('--bold', 0);            // -1 seulement si le fichier EST le Bold de la famille
const SIZE = +opt('--size', 58);
const MARGV = +opt('--marginv', 36);       // 36 = position validée par le monteur (108 → 70 → 48 → 36).
// Plancher : sous ~40 px le texte entre dans la zone de la barre de progression YouTube.
const MARGLR = +opt('--marginlr', 200);
// CACHE de transcription : large-v3 sur 7:30 coûte ~4 min. Itérer sur la MISE EN
// LIGNES (découpage, marges, lexique de fusion) n'a aucune raison de re-payer ça.
const cachePath = opt('--cache', null);
const [video, t0s, t1s] = a;
if (!video || !t0s || !t1s || !out) { console.error('usage: subs.mjs <video> <t0> <t1> --out <x.ass> [--lexique l.json]'); process.exit(1); }
const t0 = parseFloat(t0s), t1 = parseFloat(t1s);
const MODEL = path.join(MODELS, `ggml-${modelName}.bin`);

const ACCENT_PROFIL = ACCENT_ASS;          // dérivé du profil — ASS = &HAABBGGRR (bleu d'abord)
const WHITE = '&H14FFFFFF';       // mot à venir, blanc très légèrement voilé
const OUTLINE = '&H78000000';     // contour sombre semi-transparent
// signatures de NON-PAROLE (whisper hallucine ça sur du silence — cf. README)
const HALLU = [/amara\.org/i, /sous-titr/i, /merci d'avoir regardé/i, /abonnez-vous/i, /radio-canada/i];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'facesubs-'));
let j;
if (cachePath && fs.existsSync(cachePath)) {
  j = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  console.error(`transcription relue du cache (${path.basename(cachePath)}) — whisper non relancé`);
} else {
  const wav = path.join(tmp, 'w.wav');
  execFileSync('ffmpeg', ['-v', 'error', '-ss', String(t0), '-i', video, '-t', String(t1 - t0),
    '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-y', wav]);
  execFileSync('whisper-cli', ['-m', MODEL, '-f', wav, '-l', 'fr', '-ml', '1', '-sow', '-oj', '-of', path.join(tmp, 'w')],
    { stdio: ['ignore', 'ignore', 'ignore'] });
  j = JSON.parse(fs.readFileSync(path.join(tmp, 'w.json'), 'utf8'));
  // le cache porte la transcription BRUTE : lexique et découpage s'appliquent après,
  // donc les corriger ne demande jamais de re-transcrire.
  if (cachePath) fs.writeFileSync(cachePath, JSON.stringify(j));
}

// LEXIQUE : { "mauvaise graphie": "bonne", "_noms": ["Xiamen", …] }
// Les clés explicites d'abord ; puis rattrapage FLOU sur `_noms` — whisper produit
// une bouillie phonétique inépuisable (« Qihongqing », « Pétkin », « Shemen ») qu'on
// ne peut pas énumérer à l'avance. Barre haute (≥ 0,62 de similarité, ≥ 4 lettres,
// et le mot doit déjà « ressembler » à un nom propre) pour ne pas corser un vrai mot.
const lexRaw = lexPath ? JSON.parse(fs.readFileSync(lexPath, 'utf8')) : {};
const NOMS = lexRaw._noms || [];
const lex = Object.fromEntries(Object.entries(lexRaw).filter(([k]) => k !== '_noms'));
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
const fixWord = (w) => {
  const m = w.match(/^([^\p{L}]*)(.*?)([^\p{L}]*)$/u);     // on préserve la ponctuation
  if (!m || !m[2]) return w;
  const core = m[2];
  for (const [bad, good] of Object.entries(lex))
    if (new RegExp('^' + bad + '$', 'i').test(core)) return m[1] + good + m[3];
  if (core.length >= 4) {
    let best = null, bestSim = 0;
    for (const n of NOMS) {
      const sim = 1 - lev(norm(core), norm(n)) / Math.max(core.length, n.length);
      if (sim > bestSim) { bestSim = sim; best = n; }
    }
    // ≥ 0,62 ET (majuscule initiale OU déjà très proche) : « Pétkin »→Pékin oui,
    // un mot courant français ne passe pas la barre face à ces noms
    if (best && bestSim >= 0.62 && (/^\p{Lu}/u.test(core) || bestSim >= 0.8)) return m[1] + best + m[3];
  }
  return w;
};

let words = (j.transcription || [])
  .map((s) => ({ from: (s.offsets?.from ?? 0) / 1000, to: (s.offsets?.to ?? 0) / 1000, text: (s.text || '').trim() }))
  .filter((w) => w.text && w.to > w.from && !HALLU.some((re) => re.test(w.text)))
  .map((w) => ({ ...w, text: fixWord(w.text) }));

// FUSIONS : whisper coupe parfois UN nom en DEUX tokens (« JCD | Go » pour JCDecaux).
// Le lexique agit mot par mot : il est structurellement incapable de réparer ça.
// On fusionne donc la paire en un seul mot (`from` du 1er, `to` du 2nd) avant le
// découpage en lignes. Format : `_fusions: [["JCD","Go","JCDecaux"]]`.
const FUSIONS = (lexRaw._fusions || []).map(([a, b, r]) => [norm(a), norm(b), r]);
if (FUSIONS.length) {
  const bare = (s) => norm(s.replace(/[^\p{L}]/gu, ''));
  const merged = [];
  for (const w of words) {
    const prev = merged[merged.length - 1];
    const hit = prev && FUSIONS.find(([a, b]) => bare(prev.text) === a && bare(w.text) === b);
    // on garde la ponctuation du SECOND token (c'est elle qui clôt le mot)
    if (hit) { prev.text = w.text.replace(/\p{L}+/u, hit[2]); prev.to = w.to; }
    else merged.push({ ...w });
  }
  words = merged;
}

// lignes : ≤5 mots, ≤3 s, coupe sur ponctuation OU sur une micro-pause (0,32 s).
// La micro-pause est le bon signal : elle suit le PHRASÉ réel, alors qu'un simple
// compteur de mots coupe au milieu d'un groupe (« une ville en / fait qui entre »).
const MAXW = +opt('--maxwords', 5), GAP = +opt('--gap', 0.32), MAXD = +opt('--maxdur', 3.0);
// ATOMES : suites de mots qu'on ne coupe JAMAIS en fin de ligne (« Hong | Kong »)
const ATOMES = (lexRaw._atomes || []).map((p) => p.map((s) => norm(s)));
const glued = (prev, w) => ATOMES.some(([a, b]) =>
  norm(prev.text.replace(/[^\p{L}]/gu, '')) === a && norm(w.text.replace(/[^\p{L}]/gu, '')) === b);
// GARDE DE LARGEUR — filet de sécurité pour que la règle « une seule ligne » ne
// dépende pas du hasard du corpus. Table d'avances CALIBRÉE dans Chrome sur la
// police réelle (assets/fonts/widths-<Police>.json) ; à défaut, facteur moyen
// prudent. +4 % de sécurité : c'est l'écart max mesuré entre la somme par
// caractère et la largeur réelle de la ligne (le kerning).
// Sur ce vlog la garde ne se déclenche jamais (plus large = 1 308 px pour 1 520) —
// c'est voulu : elle ne change pas le rythme validé, elle empêche une régression.
// ⚠️ La table vit dans `assets/metrics/`, PAS dans `assets/fonts/` (01/09). `fonts/` est le
// `fontsdir` que libass ÉNUMÈRE : il y trouvait ce JSON, tentait de l'ouvrir comme une police et
// imprimait « Error opening memory font » à chaque burn. Sans effet sur l'image, mais un bruit
// permanent dans les logs finit par masquer un vrai message. *Un dossier passé à un outil tiers
// est son territoire : on n'y range que ce qu'il sait lire.*
const wpath = path.join(HERE, '..', 'assets', 'metrics', `widths-${FONT.replace(/ /g, '-')}.json`);
const CWF = fs.existsSync(wpath) ? JSON.parse(fs.readFileSync(wpath, 'utf8')) : null;
// La calibration se DIT : sans ça, « table absente » et « table chargée » rendent le même silence,
// et la garde de largeur tomberait au facteur moyen sans que personne ne le sache.
console.log(CWF ? `  largeurs calibrées : ${Object.keys(CWF).length} caractères (${path.basename(wpath)})`
                : `  ⚠ pas de table de largeurs pour « ${FONT} » — garde de largeur au facteur moyen 0,55`);
const textW = (s) => (CWF ? [...s].reduce((acc, c) => acc + (CWF[c] ?? 0.55), 0) : s.length * 0.55) * SIZE * 1.04;
const UTILE = 1920 - 2 * MARGLR;
const tropLarge = (grp, w) => textW(grp.map((x) => x.text).join(' ') + ' ' + w.text) > UTILE;

const lines = []; let cur = [];
const flush = () => { if (cur.length) { lines.push(cur); cur = []; } };
for (const w of words) {
  if (cur.length) {
    const prev = cur[cur.length - 1];
    const gap = w.from - prev.to;
    if (!glued(prev, w) && (cur.length >= MAXW || w.to - cur[0].from > MAXD || gap > GAP
        || tropLarge(cur, w))) flush();
  }
  cur.push(w);
  if (/[.!?…]$/.test(w.text)) flush();
}
flush();
// pas de ligne ORPHELINE d'un seul mot : on la recolle à la précédente si elle la suit
for (let i = lines.length - 1; i > 0; i--) {
  const prev = lines[i - 1];
  if (lines[i].length === 1 && lines[i][0].from - prev[prev.length - 1].to < 0.5 && prev.length < MAXW + 1) {
    prev.push(...lines[i]); lines.splice(i, 1);
  }
}

const assTime = (s) => {
  const cs = Math.max(0, Math.round(s * 100));
  return `${Math.floor(cs / 360000)}:${String(Math.floor((cs % 360000) / 6000)).padStart(2, '0')}:` +
         `${String(Math.floor((cs % 6000) / 100)).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
};
const head = `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${FONT},${SIZE},${ACCENT_PROFIL},${WHITE},${OUTLINE},&H00000000,${BOLD},0,0,0,100,100,0.6,0,1,4,2,2,${MARGLR},${MARGLR},${MARGV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;
// ⚠️ UNE SEULE LIGNE À L'ÉCRAN À LA FOIS (consigne du monteur, 25/07). La queue de
// +0,18 s faisait cohabiter 82 % des événements avec le suivant, et libass EMPILE
// les événements simultanés : c'était ça, les « sous-titres sur deux lignes » —
// pas un retour à la ligne. On ne garde donc la queue que s'il reste du silence
// avant la ligne suivante. Ce n'était PAS un problème de largeur : mesurée dans
// Chrome, la ligne la plus large du corpus fait 1 308 px pour 1 520 disponibles.
const TAIL = 0.18, ECART = 0.02;
const events = lines.map((grp, i) => {
  const next = lines[i + 1];
  const start = grp[0].from;
  const end = next ? Math.min(grp[grp.length - 1].to + TAIL, next[0].from - ECART)
                   : grp[grp.length - 1].to + TAIL;
  let prev = start, body = '';
  grp.forEach((w, i) => {
    const kcs = Math.max(1, Math.round((w.to - prev) * 100));
    prev = w.to;
    let t = w.text.replace(/[{}]/g, '');
    if (i === 0) t = t.replace(/^[,;:.!?…·\s-]+/, '');
    // ⚠️ `\kf`, PAS `\k` (01/09). Les deux portent la même durée et les mêmes timecodes —
    // ils ne diffèrent que par la façon de la CONSOMMER. `\k` bascule le mot en accent d'un
    // coup AU DÉBUT de sa prononciation : à l'instant où le monteur attaque « Alors », le mot est
    // déjà entièrement accent, donc lu comme DÉJÀ DIT. `\kf` le remplit de gauche à droite
    // PENDANT qu'il est dit, et n'est plein qu'à la fin du mot. Mesuré sur le #02 : 1 097
    // mots, chacun accent pendant toute sa durée (médiane 0,19 s, p90 0,48 s, max 1,08 s).
    body += `{\\kf${kcs}}${t} `;
  });
  // ⚠️ PLANCHER DE REMPLISSAGE SUR LE PREMIER MOT (01/09). Un `\kf` juste avec une durée
  // absurde produit le défaut du tag faux : whisper donne 0,01 s à « En » et 0,04 s à
  // « aujourd'hui, », et en dessous de ~3 images un remplissage progressif est
  // indiscernable d'une bascule — donc le mot est lu comme DÉJÀ DIT à l'apparition,
  // exactement ce que le monteur a signalé. Mesuré sur le #02 : 52 lignes sur 229 démarraient
  // sous 0,10 s. Le plancher ne vaut que pour le PREMIER mot (le seul dont l'état est lu
  // à l'apparition) et le temps est repris sur les mots SUIVANTS de la même ligne : le
  // total est conservé au centième, donc ni la fin de la ligne ni la suivante ne bougent.
  // Même constante et même règle dans `subs-recale.mjs`, qui répare un ASS déjà produit.
  const KF_MIN_CS = 10;                       // 0,10 s = 3 images à 30 fps
  const tags = [...body.matchAll(/\{\\kf(\d+)\}([^{]*)/g)].map((x) => ({ cs: +x[1], mot: x[2] }));
  if (tags.length >= 2 && tags[0].cs < KF_MIN_CS) {
    let dette = KF_MIN_CS - tags[0].cs;
    tags[0].cs = KF_MIN_CS;
    for (let q = 1; q < tags.length && dette > 0; q++) {
      const pris = Math.min(dette, tags[q].cs - 1);   // jamais en dessous de 1 cs
      if (pris > 0) { tags[q].cs -= pris; dette -= pris; }
    }
    // ligne trop courte pour payer : on n'invente pas de temps, on laisse tel quel
    if (dette === 0) body = tags.map((x) => `{\\kf${x.cs}}${x.mot}`).join('');
  }
  return `Dialogue: 0,${assTime(start)},${assTime(end)},Default,,0,0,0,,${body.trim()}`;
});
fs.writeFileSync(out, head + '\n' + events.join('\n') + '\n');
fs.rmSync(tmp, { recursive: true, force: true });

// MIROIR des polices dans un chemin SANS ESPACE, à côté de l'ASS : `fontsdir` passe
// dans un filtergraph ffmpeg où « Application Support » est un enfer d'échappement.
// On le fait ici pour que la commande de burn soit copiable telle quelle.
const fdir = path.join(path.dirname(path.resolve(out)), 'fonts');
fs.mkdirSync(fdir, { recursive: true });
const src = path.join(HERE, '..', 'assets', 'fonts');
for (const f of fs.readdirSync(src)) {
  if (!f.endsWith('.ttf') || /-var\.ttf$/.test(f)) continue;   // pas de variable : libass rend l'instance par défaut
  const dst = path.join(fdir, f);
  if (!fs.existsSync(dst)) fs.copyFileSync(path.join(src, f), dst);
}
console.log(`polices miroir → ${fdir}`);
console.log(`burn : ffmpeg -ss ${t0} -i <vlog> -filter_complex "ass=filename='${path.resolve(out)}':fontsdir='${fdir}'" …`);
console.log(`${events.length} lignes / ${words.length} mots → ${out}`);
for (const grp of lines) console.log(`  ${grp[0].from.toFixed(2)}-${grp[grp.length - 1].to.toFixed(2)}  ${grp.map((w) => w.text).join(' ')}`);
