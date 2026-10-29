// curate.mjs — ASSISTANT DE CURATION (pré-analyse mesurée, ne DÉCIDE pas).
//   node curate.mjs            → analyse les plans du catalogue (scope Réglages/jour.txt)
//   node curate.mjs R03 R16    → ces plans-là
// Exécute la partie MESURABLE de la doctrine (STYLE §Curation / §Mouvement) pour donner un PRÉ-TRI :
//   • profil de MOUVEMENT dans le temps → verdict fixe/mouvement + coupe de QUEUE gratuite → keep-range (FIABLE)
//   • re-prises QUASI-IDENTIQUES (dHash perceptuel + couleur) — PAS la redondance sémantique (même sujet,
//     angles différents : ça, ça reste à l'œil sur la planche-contact). Portée assumée, pas survendue.
// Le reste (point de pose exact, horizon, gens coupés, hi/glow) reste un jugement À L'ŒIL sur les pellicules.
// Sort un rapport dans catalogue/curation.md (+ stdout). 100 % offline.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INBOX, STORE } from './store.mjs';   // chemins du store : un seul endroit

const ENG = path.dirname(fileURLToPath(import.meta.url));
const RUSH = INBOX;
// Catalogue OPTIONNEL (enrichissement/compat) — curate tourne AUSSI sans, directement sur le
// JOUR ACTIF (cf. listDayRushes). Ainsi le critique n'a plus besoin d'un catalogue.json régénéré.
let byId = {};
try {
  const cat = JSON.parse(fs.readFileSync(path.join(ENG, 'catalogue/catalogue.json'), 'utf8'));
  byId = Object.fromEntries(cat.map((c) => [c.id, c]));
} catch { /* pas de catalogue → on s'appuie sur le jour actif */ }

function dur(file) {
  return parseFloat((spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=nw=1:nk=1', file], { encoding: 'utf8' }).stdout || '').trim()) || 0;
}

// ── Rushes du JOUR ACTIF (scope Réglages/jour.txt), R## = ordre chrono +1 ──────
// Même logique que highlights.mjs / monte.mjs → le R## affiché == celui des planches et du
// montage. Rend curate.mjs AUTONOME : plus besoin d'un catalogue.json régénéré pour le jour.
const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.avi', '.mkv', '.webm']);
function readJours() {
  try {
    return fs.readFileSync(path.join(STORE, 'Réglages', 'jour.txt'), 'utf8')
      .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
      .map((l) => l.replace(/\D/g, '')).filter((d) => d.length === 8);
  } catch { return []; }
}
function listDayRushes() {
  if (!fs.existsSync(RUSH)) return [];
  const jours = readJours();
  return fs.readdirSync(RUSH)
    .filter((f) => !f.startsWith('.') && !f.startsWith('._') && VIDEO_EXT.has(path.extname(f).toLowerCase()))
    .filter((f) => !jours.length || (() => { const m = f.match(/(\d{8})/); return m && jours.includes(m[1]); })())
    .sort((a, b) => {
      const ta = (a.match(/(\d{14})/) || [])[1] || '', tb = (b.match(/(\d{14})/) || [])[1] || '';
      return ta && tb ? ta.localeCompare(tb) : fs.statSync(path.join(RUSH, a)).mtimeMs - fs.statSync(path.join(RUSH, b)).mtimeMs;
    })
    .map((f, i) => ({ id: `R${String(i + 1).padStart(2, '0')}`, file: f }));
}

// ── MOUVEMENT dans le temps : vignette 48×27, diff inter-images à 6 img/s → motion(t). ──
const MOT_FPS = 6;
function motionSeries(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-vf',
    `scale=48:27,fps=${MOT_FPS},tblend=all_mode=difference,signalstats,metadata=print`, '-an', '-f', 'null', '-'],
    { encoding: 'utf8', maxBuffer: 64 << 20 });
  const ys = [...(r.stderr || '').matchAll(/signalstats\.YAVG=([\d.]+)/g)].map((m) => +m[1]);
  return ys.map((v, i) => ({ t: i / MOT_FPS, m: v }));   // t en s, m = énergie de mouvement caméra
}
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

// ── DÉTAIL SPATIAL du plan (Sobel) : sert à NORMALISER le mouvement. ──
// Le diff inter-image (motionSeries) n'est PAS invariant à la lumière/au détail : en plein JOUR
// (image claire, trafic, feuillage, foule, façades texturées) il gonfle même à vitesse caméra
// modérée → le seuil brut calibré NUIT sur-flaguait ~37/40 du 16/07 (MÉTA-PIÈGE, cf. STYLE §Leçons 18/07).
// Physique : diff temporel ≈ (vitesse caméra en px) × (gradient spatial de la scène). En divisant le
// mouvement temporel par le DÉTAIL spatial (énergie de bords Sobel), on isole la VITESSE seule —
// invariante au jour/nuit et au détail. Mesuré sur 10 plans 16/07 : brut 8→159 (×20) → ratio 20→83 (×4),
// holds normaux (R26 20, R16 24, marche R07 50 / R09 57) < mouvements trop-rapides (R01/R40 83).
function spatialDetail(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-vf',
    `scale=48:27,fps=${MOT_FPS},format=gray,sobel,signalstats,metadata=print`, '-an', '-f', 'null', '-'],
    { encoding: 'utf8', maxBuffer: 64 << 20 });
  const ys = [...(r.stderr || '').matchAll(/signalstats\.YAVG=([\d.]+)/g)].map((m) => +m[1]);
  return median(ys);   // scalaire par plan : énergie de bords médiane (≈ détail/contraste spatial)
}

// Analyse le profil → verdict + keep-range suggéré. Calibre : STATIC ~1.5 (cf. motionScore).
// `sd` = détail spatial du plan → normalise la médiane de mouvement (invariante jour/nuit).
function analyzeMotion(series, D, sd) {
  if (series.length < 4) return { verdict: 'trop court', keep: null, note: '' };
  const ms = series.map((p) => p.m);
  const med = median(ms), mx = Math.max(...ms);
  const win = (a, b) => { const w = series.filter((p) => p.t >= a && p.t < b).map((p) => p.m); return w.length ? median(w) : 0; };
  const STATIC = 1.5;
  const body = win(Math.min(1, D * 0.2), D * 0.8);       // niveau du corps du plan
  const head = win(0, Math.min(1.2, D * 0.25));
  const tail = win(Math.max(D - 1.5, D * 0.75), D);
  const notes = [];
  let a = 0, b = D;
  // TÊTE : forte au départ puis se pose (tilt/approche d'intro) → démarrer au point de pose
  if (head > Math.max(STATIC, body * 1.8) && head > body + 1) {
    // point de pose = 1er instant où le mouvement retombe durablement sous 1.4×body
    const thr = Math.max(STATIC, body * 1.4);
    for (const p of series) { if (p.t > 0.5 && p.m < thr) { a = Math.round(p.t * 2) / 2; break; } }
    if (a > 0) notes.push(`tête agitée→pose ~${a}s (couper l'intro tilt/approche)`);
  }
  // QUEUE : remonte en fin après un corps plus calme (caméra qu'on relâche/tourne) → couper avant
  if (tail > Math.max(STATIC, body * 1.6) && tail > body + 1 && D > 3) {
    for (let t = D; t > D - 2; t -= 1 / MOT_FPS) { const seg = win(t - 0.4, t); if (seg > body * 1.5) b = Math.round((t - 0.4) * 2) / 2; }
    if (b < D - 0.2) notes.push(`queue agitée dès ~${b}s (mouvement gratuit de fin → couper)`);
  }
  // Plafond de mouvement TOLÉRÉ — sur le RATIO normalisé (mouvement temporel ÷ détail spatial ×100),
  // invariant jour/nuit (cf. spatialDetail). ⭐ DOCTRINE (STYLE §Curation, MAJ 18/07) : la règle DÉCISIVE
  // « plan MOUVEMENT = TENU » PRIME sur ce seuil. Le flag ne repère qu'un pano/mouvement VRAIMENT trop
  // rapide (whip, balayage serré) — à confirmer À L'ŒIL, jamais un couperet ni un motif pour hacher/jeter
  // un jour entier. Calibré 16/07 : holds/marche 20-57 restent silencieux ; seuls R01/R40 (~83, balayage
  // serré / traversée floue) dépassent. Seuil conservateur → il doit sortir RAREMENT, pas sur 37/40.
  const RATIO_STRONG = 70;
  const ratio = sd > 0 ? (med / sd) * 100 : 0;
  const moving = body >= STATIC;
  let verdict;
  if (ratio > RATIO_STRONG) { verdict = `MOUVEMENT TRÈS RAPIDE (ratio ${ratio.toFixed(0)} > ${RATIO_STRONG}) → vérifier à l'œil (tenir si ça révèle du neuf)`; notes.push('vitesse caméra élevée (whip/balayage) — recouper une fenêtre posée SEULEMENT si le mouvement n\'apporte rien ; sinon tenir'); }
  // ⚠️ 27/07 : « TENIR » ne veut plus dire « entier ». Tenir = ne pas hacher le plan en 3 morceaux ;
  // la DURÉE, elle, est bornée par la colonne « garder ≤ » (plafond ordinaire 5 s). Cf. STYLE §Étalonnage.
  else verdict = moving ? `MOUVEMENT (ratio ${ratio.toFixed(0)}) → tenir d'un seul tenant` : `FIXE/posé (ratio ${ratio.toFixed(0)}) → resserrable`;
  const keep = (a > 0 || b < D - 0.2) ? `${a.toFixed(1)}-${b.toFixed(1)}` : (moving ? 'entier' : `0-${Math.min(D, 5).toFixed(1)}`);
  return { verdict, keep, a, b, note: notes.join(' ; ') };
}

// ── Keep-range FINAL : la fenêtre de mouvement, RABOTÉE au plafond de durée (étalonnage 27/07) ──
// Avant le 27/07 ce rapport pouvait conseiller « entier » sur un plan de 28 s : incohérent avec les
// benchmarks du monteur (5 s de plafond ordinaire) et avec la colonne « garder ≤ ». On garde donc la
// fenêtre utile calculée par analyzeMotion (pose de tête / queue gratuite), puis :
//  · si elle dépasse le plafond conseillé, on la CENTRE dessus — faute de mieux, PAS par doctrine :
//    la règle « fenêtre intérieure » du 27/07 a été supprimée le 29/07 (elle plaçait 1 fenêtre sur 16
//    sur le jour 16/07). Il n'y a PAS de règle de position : le in/out se lit dans le rush, pas dans
//    une statistique. Cette colonne est donc une SUGGESTION de durée, jamais un point d'entrée ;
//  · on ne descend jamais sous 1,5 s (plancher perceptible d'un plan d'ambiance).
function cappedKeep(mot, cam, D) {
  const cap = cam && cam.advice ? cam.advice : 5;
  let a = mot.a != null ? mot.a : 0, b = mot.b != null ? mot.b : D;
  if (!(b > a)) { a = 0; b = D; }
  const span = b - a;
  if (span <= cap + 0.2) return { range: `${a.toFixed(1)}-${b.toFixed(1)}`, trimmed: false };
  const want = Math.max(1.5, Math.min(cap, span));
  const from = a + (span - want) / 2;                    // fenêtre CENTRÉE, pas le début du rush
  return { range: `${from.toFixed(1)}-${(from + want).toFixed(1)}`, trimmed: true };
}

// ── MOUVEMENT DE LA **CAMÉRA** (≠ mouvement du SUJET) — étalonnage le monteur 27/07 ──
// LE piège corrigé ici : `motionSeries` (diff inter-image) mesure caméra **+** sujet. Le 18/07,
// R01 et R02 sortaient au même niveau (motionScore 16,6 / 16,1, le plus haut du jour) alors que la
// caméra ne bougeait PAS (9 et 11 px d'amplitude) : ce qui bougeait, c'étaient les robots et l'écran
// LED. Conséquence, le moteur « tenait long » exactement les plans riches et posés qu'il fallait
// resserrer. le monteur ADORE le mouvement du sujet (7 s pour les robots, son plan le plus long) et COUPE
// le mouvement de caméra → il faut les mesurer SÉPARÉMENT. Cf. STYLE §Étalonnage 27/07.
//
// Méthode : `deshake=filename=` sort la translation caméra image par image (colonnes Ori x / Ori y).
// Cumulée → amplitude du recadrage ; dérivée → vitesse ; changements de sens → allers-retours.
// 100 % offline, aucune dépendance neuve (libvidstab n'est PAS dans le ffmpeg brew, deshake si).
// Unités : pixels sur un cadre ramené à 320 de large, échantillonné à 5 img/s.
const CAM_FPS = 5, CAM_W = 320;
function cameraMotion(logFile) {
  try {
    if (!logFile || !fs.existsSync(logFile)) return null;
    const rows = fs.readFileSync(logFile, 'utf8').trim().split('\n').slice(1)
      .map((l) => l.split(',').map(Number)).filter((a) => a.length > 6 && a.every((x) => !isNaN(x)));
    if (rows.length < 6) return null;
    let cx = 0, cy = 0; const X = [], Y = [];
    for (const a of rows) { cx += a[0]; cy += a[3]; X.push(cx); Y.push(cy); }
    const ampl = (v) => Math.max(...v) - Math.min(...v);
    // allers-retours = changements de sens de la trajectoire LISSÉE sur ~1 s (sinon on compte le
    // tremblement de la main, pas l'intention de cadrage). Seuil mort 0,15 px/img = bruit.
    const smooth = (v) => v.map((_, i) => { const w = v.slice(Math.max(0, i - 2), i + 3); return w.reduce((s, x) => s + x, 0) / w.length; });
    const reversals = (v) => {
      const s = smooth(v), d = s.map((x, i) => (i ? x - s[i - 1] : 0)).slice(1);
      let n = 0, prev = 0;
      for (const x of d) { if (Math.abs(x) < 0.15) continue; const sg = Math.sign(x); if (prev && sg !== prev) n++; prev = sg; }
      return n;
    };
    const vmax = Math.max(...rows.map((a) => Math.hypot(a[0], a[3]))) * CAM_FPS;
    return { amplX: ampl(X), amplY: ampl(Y), revX: reversals(X), revY: reversals(Y), vmax };
  } catch { return null; }
}

// ── UN SEUL DÉCODAGE pour les trois mesures ───────────────────────────────────
// Mesuré 27/07 sur un rush de 27,8 s : deshake seul 29,5 s, diff seul 29,7 s, **décodage nu 29,5 s**
// → le coût est ENTIÈREMENT le décodage du 3072² source, les filtres sont gratuits. curate en payait
// déjà DEUX (mouvement + Sobel) ; en ajouter un troisième aurait fait +50 %. On `split` donc le flux
// décodé une fois vers les trois chaînes, chacune écrivant dans SON fichier (`metadata=…:file=`),
// et on garde les chaînes EXACTEMENT identiques (même ordre scale/fps) pour ne pas bouger les seuils
// déjà calibrés. Résultat : 3 décodages → 1, soit curate ~3× plus rapide qu'avant cette passe.
function analysePasses(file) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'curate-'));
  const fMot = path.join(dir, 'motion.txt'), fSob = path.join(dir, 'sobel.txt'), fCam = path.join(dir, 'dsh.log');
  try {
    spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', '-i', file, '-filter_complex',
      `[0:v]split=3[a][b][c];` +
      `[a]scale=48:27,fps=${MOT_FPS},tblend=all_mode=difference,signalstats,metadata=print:file=${fMot}[m];` +
      `[b]scale=48:27,fps=${MOT_FPS},format=gray,sobel,signalstats,metadata=print:file=${fSob},nullsink;` +
      `[c]fps=${CAM_FPS},scale=${CAM_W}:-2,deshake=filename=${fCam},nullsink`,
      '-map', '[m]', '-an', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 8 << 20 });
    const yavg = (f) => { try { return [...fs.readFileSync(f, 'utf8').matchAll(/signalstats\.YAVG=([\d.]+)/g)].map((m) => +m[1]); } catch { return []; } };
    const mot = yavg(fMot).map((v, i) => ({ t: i / MOT_FPS, m: v }));
    return { series: mot, sd: median(yavg(fSob)), cam: cameraMotion(fCam) };
  } catch { return { series: [], sd: 0, cam: null }; }
  finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* rien */ } }
}

// Verdict caméra : DEUX flags seulement, et ils doivent sortir RAREMENT (doctrine : un signal qui
// condamne la moitié d'un batch est suspect). Calibrés sur les 12 rushes étalonnés du 27/07.
//  · PANO TROP RAPIDE — amplitude X ≥ 1 largeur de cadre : le champ est intégralement renouvelé.
//    Seul 15/07 R07 (408 px pour 320) sort. C'est le « mouvement trop rapide » nommé par le monteur.
//  · TILT GRATUIT — ≥ 2 inversions VERTICALES à vitesse FAIBLE : la caméra monte vers du ciel vide
//    puis redescend. C'est le « je cadre très mal haut en bas » (15/07 R06) — et il est INVISIBLE à
//    motionScore (1,7 = « fixe ») parce qu'il est lent : sans cette mesure, on ne peut pas le voir.
// Volontairement PAS de flag « va-et-vient » : sur l'étalonnage il ne se sépare pas proprement de la
// marche tenue (15/07 R14 coupé et 18/07 R03 gardé ont la même signature). Ça reste un appel à l'œil.
function cameraVerdict(cam) {
  if (!cam) return { ok: false, flags: [], advice: null, vmax: null, line: '(non mesuré)' };
  const flags = [];
  if (cam.amplX >= CAM_W) flags.push('PANO TROP RAPIDE');
  if (cam.revY >= 2 && cam.vmax < 60 && cam.amplY >= 20) flags.push('TILT GRATUIT (haut-bas)');
  // Durée gardable CONSEILLÉE (s) — étalonnée sur les benchmarks le monteur du 27/07 : plan courant
  // 1,5-2,5 s, 5 s = plafond ordinaire, 7 s = exception réservée à un SUJET FORT (à l'œil, jamais
  // décidé ici). Plus la caméra bouge, plus la fenêtre gardable est courte.
  const advice = cam.vmax >= 90 ? 2.0 : cam.vmax >= 30 ? 3.0 : 5.0;
  const line = `ampl ${cam.amplX.toFixed(0)}×${cam.amplY.toFixed(0)}px · A-R ${cam.revX}/${cam.revY} · vit ${cam.vmax.toFixed(0)}`;
  return { ok: true, ...cam, flags, advice, line };
}

// ── Signature pour DOUBLONS : une frame mi-plan → dHash perceptuel + signature couleur. ──
// (Horizon-de-travers et hi/clip retirés : détection cheap non fiable — le tilt sortait du bruit
//  (faux + sur R01/R03, raté R04) et clip% en 8×8 s'annule. hi/glow = à l'œil / highlights.mjs.)
function frameSigs(file, D) {
  const t = (D * 0.5).toFixed(2);
  const gray = spawnSync('ffmpeg', ['-v', 'error', '-ss', t, '-i', file, '-frames:v', '1',
    '-vf', 'scale=160:90,format=gray', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 20 }).stdout;
  const rgb = spawnSync('ffmpeg', ['-v', 'error', '-ss', t, '-i', file, '-frames:v', '1',
    '-vf', 'scale=8:8,format=rgb24', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 16 }).stdout;
  if (!gray || gray.length < 160 * 90 || !rgb || rgb.length < 192) return null;
  const at = (x, y) => gray[Math.min(89, y) * 160 + Math.min(159, x)];
  let hash = 0n, bit = 0n;                                // dHash 9×8 (gradient horizontal)
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const gx0 = Math.floor((x) / 9 * 160), gx1 = Math.floor((x + 1) / 9 * 160), gy = Math.floor((y + 0.5) / 8 * 90);
    if (at(gx0, gy) < at(gx1, gy)) hash |= (1n << bit); bit++;
  }
  return { hash, color: Array.from(rgb) };                // couleur = 8×8 RGB moyens
}
const hamming = (a, b) => { let x = a ^ b, c = 0; while (x) { c += Number(x & 1n); x >>= 1n; } return c; };
const colorDist = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2; return Math.sqrt(s / a.length); };

// ── HAUTES LUMIÈRES CRAMÉES par le PLEIN JOUR (ciel / surface lavée) ──────────
// LE discriminant que clip%/bloom% (highlights.mjs) ratait, et qui a laissé passer le
// « surplus de lumière blanche » du 20/07 : CLAIR **+ PÂLE** (faible saturation) = ciel voilé
// / façade lavée → à DOMPTER ; CLAIR **+ SATURÉ** = néon/enseigne coloré → à LAISSER. On
// échantillonne 6 frames, fraction de pixels quasi-blancs & pâles dans la BANDE HAUTE (ciel) +
// voile plein cadre, percentile p75 (capte le cramé TRANSITOIRE — ouverture d'allée, trouée de
// ciel — sans qu'une frame-fluke décide). Calibré 20/07 : offenders francs R11 ~26, R08/R12 ~7,
// R10/R06 ~5 ; propres R03/05/07/13/14/15 < 3. NB : les patches d'allée R13/R14 mesurent BAS
// (petits, en bout de cadre) → eux relèvent surtout de l'épaule du grade JOUR, pas d'un flag.
function blownLoad(file, D) {
  const W = 64, H = 36, topRows = Math.round(H * 0.45);
  const sky = [], haze = [];
  for (let k = 0; k < 6; k++) {
    const t = (D * (k + 0.5) / 6).toFixed(2);
    const buf = spawnSync('ffmpeg', ['-v', 'error', '-ss', t, '-i', file, '-frames:v', '1',
      '-vf', `scale=${W}:${H}`, '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 20 }).stdout;
    if (!buf || buf.length < W * H * 3) continue;
    let s = 0, top = 0, hz = 0, all = 0;
    for (let i = 0; i < W * H; i++) {
      const r = buf[i * 3], g = buf[i * 3 + 1], b = buf[i * 3 + 2];
      const Y = 0.299 * r + 0.587 * g + 0.114 * b;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx > 0 ? (mx - mn) / mx : 0;
      all++; if (((i / W) | 0) < topRows) { top++; if (Y >= 225 && sat < 0.12) s++; }
      if (Y >= 215 && sat < 0.10) hz++;
    }
    if (top) sky.push(s / top * 100);
    if (all) haze.push(hz / all * 100);
  }
  const p75 = (a) => { if (!a.length) return 0; const x = [...a].sort((m, n) => m - n); return x[Math.min(x.length - 1, Math.floor(0.75 * x.length))]; };
  const load = Math.max(p75(sky), p75(haze));       // charge « cramé-PÂLE » robuste (0 = rien)
  const flag = load >= 12 ? 'hi2' : load >= 4.5 ? 'hi' : '';
  return { load, flag };
}

// ── Sélection des plans : JOUR ACTIF en source directe (repli catalogue si présent) ──
const day = listDayRushes();
const dayById = Object.fromEntries(day.map((d) => [d.id, d.file]));
let ids = process.argv.slice(2).filter((a) => /^R\d+/i.test(a)).map((a) => a.toUpperCase());
if (!ids.length) ids = day.length ? day.map((d) => d.id) : Object.keys(byId);
if (!ids.length) { console.error('Aucun rush pour ce jour (Réglages/jour.txt) ni catalogue.'); process.exit(1); }

const rows = [];
for (const id of ids) {
  // fichier : jour actif d'abord, repli catalogue (compat) — nom relatif au dossier de dépôt.
  const fname = dayById[id] || (byId[id] && byId[id].file);
  if (!fname) continue;
  const file = path.join(RUSH, fname);
  const D = dur(file);
  const p = analysePasses(file);                       // 1 décodage → mouvement + Sobel + caméra
  const mot = analyzeMotion(p.series, D, p.sd);
  const cam = cameraVerdict(p.cam);
  const sig = frameSigs(file, D);
  const blown = blownLoad(file, D);
  // Déclenchement ACCIDENTEL : sous le plancher de perceptibilité (cf. monte.mjs
  // MIN_SHOT_PERCEPTIBLE) = erreur de record, imperceptible → REJET franc.
  const accidental = D > 0 && D < 1.0;
  rows.push({ id, D, mot, cam, sig, blown, accidental });
}

// DOUBLONS : clustering union-find sur (dHash proche ET couleur proche)
const parent = Object.fromEntries(rows.map((r) => [r.id, r.id]));
const find = (x) => { while (parent[x] !== x) x = parent[x] = parent[parent[x]]; return x; };
for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
  const a = rows[i], b = rows[j]; if (!a.sig || !b.sig) continue;
  if (hamming(a.sig.hash, b.sig.hash) <= 14 && colorDist(a.sig.color, b.sig.color) <= 26) parent[find(a.id)] = find(b.id);
}
const clusters = {};
for (const r of rows) { const k = find(r.id); (clusters[k] = clusters[k] || []).push(r.id); }
// ⭐ 27/07 : dans un doublon, on garde le plan le plus STABLE — pas le premier, pas le plus long.
// Étalonné sur 15/07 R14 vs R17 : MÊME skyline du Bund, mais R17 a 3 px d'amplitude verticale et
// 11 px/s de vitesse quand R14 en a 105 et 96 (×35 et ×9). le monteur : « on a déjà R17 beaucoup mieux ».
// On ORDONNE donc chaque grappe par vitesse caméra croissante et on nomme le gagnant.
const byIdRow = Object.fromEntries(rows.map((r) => [r.id, r]));
const camOf = (id) => (byIdRow[id] && byIdRow[id].cam.ok ? byIdRow[id].cam : null);
const dupes = Object.values(clusters).filter((g) => g.length > 1)
  .map((g) => [...g].sort((a, b) => {
    const ca = camOf(a), cb = camOf(b);
    if (!ca || !cb) return a.localeCompare(b);
    return (ca.vmax - cb.vmax) || (ca.amplY - cb.amplY);
  }));

// ── Rapport ──
const L = [];
L.push('# Curation — pré-analyse mesurée (INDICATIVE ; décision à l\'œil sur les pellicules)\n');

// REJETS FRANCS en tête : déclenchements accidentels (imperceptibles). monte.mjs les écarte
// déjà tout seul quand il n'y a pas de plan.txt ; ici on les NOMME pour le tri à l'œil.
const rejets = rows.filter((r) => r.accidental);
if (rejets.length) {
  L.push('## ⛔ REJET — déclenchements accidentels (< 1,0s = imperceptible, erreur de record)');
  for (const r of rejets) L.push(`- **${r.id}** (${r.D.toFixed(2)}s) → écarté du montage (aucun plan lisible).`);
  L.push('> Écartés automatiquement par le moteur en mode auto (sans plan.txt). NE PAS les lister dans un plan.txt.\n');
}

// HAUTES LUMIÈRES à dompter : plans au ciel/surface CRAMÉ-PÂLE (≠ néon). → flag hi/hi2 dans plan.txt.
const blowns = rows.filter((r) => r.blown.flag);
if (blowns.length) {
  L.push('## ☀️ HAUTES LUMIÈRES cramées par le jour (ciel/surface lavée, PÂLE ≠ néon) → dompter');
  for (const r of blowns) L.push(`- **${r.id}** — charge cramé-pâle ${r.blown.load.toFixed(1)} → ajouter \`${r.blown.flag}\` (ex. « ${r.id} ${r.blown.flag} » dans plan.txt).`);
  L.push('> Rappel : ceci ne flague QUE le blanc PÂLE (ciel/façade lavée). Le blanc coloré (néon) est laissé.');
  L.push('> Le blanc DIFFUS de plein jour (petits patches, bouts d\'allée type R13/R14) est dompté en amont par');
  L.push('> l\'épaule des hautes lumières du grade JOUR (cf. GRADE_LOOKSTUDIO_DAY), pas forcément par un flag.\n');
}

// MOUVEMENT DE CAMÉRA : le plan ne se TIENT pas. Ce n'est PAS un verdict de cut (recalibré 29/07).
const camFlagged = rows.filter((r) => r.cam.flags.length);
if (camFlagged.length) {
  L.push('## 🎥 MOUVEMENT DE CAMÉRA — « ce plan ne se tient pas » (≠ « à couper »)');
  for (const r of camFlagged) L.push(`- **${r.id}** — ${r.cam.flags.join(' + ')} · ${r.cam.line}`);
  L.push('> ⚠️ **RECALIBRÉ le 29/07 sur les 33 verdicts du 16/07.** Ce flag était libellé « toujours à cut »');
  L.push('> d\'après l\'étalonnage du 27/07. Mesure : sur 9 rushes flagués, **le monteur en a GARDÉ 5** (R12, R13,');
  L.push('> R14, R16, R18) — et le flag n\'a touché **aucun** des 2 rushes qu\'il a lui-même coupés pour');
  L.push('> « trop de mouvement » (R04, R08) : recouvrement nul avec son propre motif.');
  L.push('> **Lire ce flag comme : le plan n\'a aucune plage tenable → en prélever 3 s, pas le jeter.**');
  L.push('> (Les 5 gardés font tous ≤ 3,5 s au montage final.) Le cut, lui, se décide sur `assumé vs subi`,');
  L.push('> qui se juge à l\'image et non à la mesure — cf. STYLE.md §D-bis.');
  L.push('> `PANO TROP RAPIDE` = le champ est renouvelé plus d\'une fois (amplitude ≥ 1 largeur de cadre).');
  L.push('> `TILT GRATUIT` = la caméra monte vers du ciel vide puis redescend — **invisible au motionScore**');
  L.push('> (il le classe « fixe » car c\'est lent).\n');
}

L.push('| R## | durée | mouvement (caméra+sujet) | caméra SEULE | garder ≤ | keep suggéré | cramé-pâle | notes mouvement |');
L.push('|-----|-------|--------------------------|--------------|----------|--------------|------------|-----------------|');
for (const r of rows) {
  const b = r.accidental ? '⛔ REJET' : (r.blown.flag ? `${r.blown.load.toFixed(1)} → ${r.blown.flag}` : `${r.blown.load.toFixed(1)}`);
  const cf = r.cam.flags.length ? ` ⚠️ ${r.cam.flags.join(' + ')}` : '';
  const adv = r.cam.advice ? `${r.cam.advice.toFixed(1)}s` : '—';
  const k = cappedKeep(r.mot, r.cam, r.D);
  L.push(`| ${r.id} | ${r.D.toFixed(1)}s | ${r.mot.verdict} | ${r.cam.line}${cf} | ${adv} | ${k.range}${k.trimmed ? ' ✂' : ''} | ${b} | ${r.mot.note || '—'} |`);
}
L.push('\n> **« caméra SEULE »** = translation du cadre mesurée par `deshake` (ampl. X×Y en px sur un cadre de 320,');
L.push('> allers-retours horizontaux/verticaux, vitesse max px/s). À NE PAS confondre avec la colonne « mouvement »,');
L.push('> qui mesure caméra **+** sujet : le 18/07, les robots faisaient monter cette dernière au plus haut du jour');
L.push('> alors que la caméra était posée — et le moteur « tenait long » un plan qu\'il fallait resserrer.');
L.push('> **« garder ≤ »** = durée conseillée par la vitesse caméra, calée sur les benchmarks le monteur du 27/07 :');
L.push('> plan courant 1,5-2,5 s · **5 s = plafond ordinaire** · 7 s = exception pour un SUJET FORT (décision à l\'œil).');
L.push('\n## Cadrages QUASI-IDENTIQUES (re-prises du même plan — garder le PLUS STABLE)');
if (dupes.length) for (const g of dupes) {
  const c = camOf(g[0]);
  const why = c ? ` (vitesse caméra ${c.vmax.toFixed(0)} px/s, la plus basse de la grappe)` : '';
  L.push(`- **${g[0]}** ← garder${why} · à écarter : ${g.slice(1).map((x) => { const k = camOf(x); return k ? `${x} (vit ${k.vmax.toFixed(0)})` : x; }).join(', ')}`);
}
else L.push('- (aucune re-prise quasi-identique détectée)');
L.push('> Ordre = vitesse caméra croissante. Étalon 15/07 : R17 (vit 11, ampl. verticale 3 px) bat R14 (vit 96,');
L.push('> ampl. 105) sur la MÊME skyline — « on a déjà R17 beaucoup mieux ». Garder le plus stable, pas le premier.');
L.push('> ⚠️ Ceci n\'attrape QUE les re-prises quasi-identiques (même cadrage). La redondance SÉMANTIQUE');
L.push('> (même sujet filmé sous des angles/zooms différents — ex. skyline ×4, foule Bund ×3) NE sort PAS ici :');
L.push('> le hash voit des frames différentes. → dédup sémantique = À L\'ŒIL sur la planche-contact `catalogue/index_*.jpg`.');
L.push('\n> Signaux FIABLES de ce rapport = verdict mouvement + coupe de QUEUE gratuite (mesurés). À juger À L\'ŒIL sur');
L.push('> `filmstrip.mjs` : point de POSE exact (le settle n\'attrape que les cas francs), horizon de travers, gens');
L.push('> coupés au bord, tilt-up amateur, hi/glow (highlights.mjs), sujets répétés. Doctrine : STYLE §Curation / §Mouvement.');

const outMd = path.join(ENG, 'catalogue/curation.md');
fs.writeFileSync(outMd, L.join('\n') + '\n');
console.log(L.join('\n'));
console.log(`\n→ écrit ${outMd}`);
