// ═══════════════════════════════════════════════════════════════════════════
//  filters.mjs — BIBLIOTHÈQUE DE FILTRES COLORIMÉTRIQUES du moteur de montage.
//  100 % offline : n'utilise que des filtres présents dans le build ffmpeg du monteur
//  (vérifié ffmpeg 8.1.2 : eq, curves, colorbalance, colorlevels, colortemperature,
//   colorcorrect, colorcontrast, exposure, huesaturation, vibrance, colorchannelmixer,
//   selectivecolor, normalize, lut3d/lut1d, deband, hqdn3d/nlmeans/atadenoise…).
//
//  DEUX ÉTAGES :
//   1) MESURE consolidée — `measurePlate(file)` : UN seul passage signalstats (8-bit
//      normalisé) renvoie toutes les stats du plan. Un filtre adaptatif pioche dedans
//      au lieu de relancer sa propre mesure → plus rapide, moins de conso.
//   2) FILTRES :
//      • ADAPTATIFS (auto, schéma mesure→règle, zone morte + gate) : warmth, saturation,
//        blackpoint, exposure. Chacun renvoie un FRAGMENT vf (`,filtre=…`) ou '' .
//      • hi/glow — dompteurs pilotés par flag (plan.txt), pas par mesure.
//      • LOOKS — catalogue des réglages CLASSIQUES, chacun un builder paramétré qu'on
//        dose librement (luminosité, expo, contraste, gamma, satu, vibrance, température,
//        teinte, hue, point noir/blanc, lift/gamma/gain, LUT filmique…).
//
//  RÈGLE DE MESURE (durement apprise) : TOUJOURS `format=yuv420p` AVANT `signalstats`.
//  Les rushes mélangent 8-bit (0-255) et 10-bit (0-1023) ; sans normalisation les plans
//  10-bit lisent ~4× trop haut et toute comparaison inter-plans est fausse.
// ═══════════════════════════════════════════════════════════════════════════
import { spawnSync } from 'node:child_process';

function ffprobeDuration(file) {
  const o = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=nw=1:nk=1', file], { encoding: 'utf8' });
  return parseFloat((o.stdout || '').trim()) || 0;
}

// ─── 1) MESURE CONSOLIDÉE ───────────────────────────────────────────────────
// Un passage signalstats sur ~6 frames réparties (8-bit normalisé). Renvoie les
// moyennes des stats utiles : luma (YAVG/YMIN/YLOW/YHIGH/YMAX), chroma (UAVG/VAVG),
// saturation (SATAVG/SATMAX). Caché par fichier.
const _plateCache = new Map();
export function measurePlate(file) {
  if (_plateCache.has(file)) return _plateCache.get(file);
  const d = ffprobeDuration(file);
  // ~6 frames sur la portion centrale (évite fondus d'entrée/sortie) ; repli 1 frame.
  const fps = d > 1 ? (6 / d).toFixed(4) : '1';
  const ss = d > 1 ? (d * 0.15).toFixed(2) : '0';
  const to = d > 1 ? (d * 0.85).toFixed(2) : null;
  const args = ['-hide_banner', '-ss', ss, '-i', file];
  if (to) args.push('-to', to);
  args.push('-vf', `fps=${fps},format=yuv420p,signalstats,metadata=print`, '-an', '-f', 'null', '-');
  const r = spawnSync('ffmpeg', args, { encoding: 'utf8', maxBuffer: 64 << 20 });
  const t = r.stderr || '';
  const avg = (k) => {
    const v = [...t.matchAll(new RegExp(`signalstats\\.${k}=([\\d.]+)`, 'g'))].map((m) => +m[1]);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const m = {
    YAVG: avg('YAVG'), YMIN: avg('YMIN'), YLOW: avg('YLOW'), YHIGH: avg('YHIGH'), YMAX: avg('YMAX'),
    UAVG: avg('UAVG'), VAVG: avg('VAVG'), SATAVG: avg('SATAVG'), SATMAX: avg('SATMAX'),
  };
  const ok = m.YAVG !== null ? m : null;
  _plateCache.set(file, ok);
  return ok;
}

// Chaleur R−B GLOBALE via mini-échantillon RGB (1×1, 3 instants). scale=1:1 = moyenne EXACTE
// pleine trame (≠ moyenne d'un grid réduit — la nuance décale la valeur et ferait basculer un
// gate : NE PAS consolider avec plateBrightZone). Sert la balance des blancs + les gates chaleur.
const _warmCache = new Map();
export function plateWarmth(file) {
  if (_warmCache.has(file)) return _warmCache.get(file);
  const d = ffprobeDuration(file);
  const times = d > 0 ? [0.3, 0.5, 0.7].map((f) => (d * f).toFixed(2)) : ['0'];
  let rs = 0, bs = 0, n = 0;
  for (const t of times) {
    const out = spawnSync('ffmpeg', ['-v', 'error', '-ss', t, '-i', file, '-frames:v', '1',
      '-vf', 'scale=1:1:flags=area,format=rgb24', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 16 }).stdout;
    if (out && out.length >= 3) { rs += out[0]; bs += out[2]; n++; }
  }
  const w = n ? (rs - bs) / n : null;
  _warmCache.set(file, w);
  return w;
}

// CHALEUR & SATURATION de la ZONE BRILLANTE (top-quartile de luma), pas la moyenne globale.
// C'est LE cran au-dessus de plateWarmth : une façade dorée noyée dans un ciel noir lit
// « neutre » en moyenne globale (R16/R22 ratés), mais sa zone brillante est franchement
// chaude. On lit un petit grid RGB (80×45) à 3 instants, on garde les pixels au-dessus du
// quantile de luma, et on renvoie { warmth:R−B, sat:HSV% } moyennés dessus. Caché.
const _brightCache = new Map();
export function plateBrightZone(file, W = 80, H = 45, QT = 0.75) {
  if (_brightCache.has(file)) return _brightCache.get(file);
  const d = ffprobeDuration(file);
  const times = d > 0 ? [0.3, 0.5, 0.7].map((f) => (d * f).toFixed(2)) : ['0'];
  let rb = 0, sat = 0, n = 0;
  for (const t of times) {
    const out = spawnSync('ffmpeg', ['-v', 'error', '-ss', t, '-i', file, '-frames:v', '1',
      '-vf', `scale=${W}:${H}:flags=area,format=rgb24`, '-f', 'rawvideo', '-'],
      { maxBuffer: 1 << 20 }).stdout;
    if (!out || out.length < W * H * 3) continue;
    const P = [];
    for (let i = 0; i < W * H; i++) {
      const r = out[i * 3], g = out[i * 3 + 1], b = out[i * 3 + 2];
      P.push({ r, g, b, y: 0.299 * r + 0.587 * g + 0.114 * b });
    }
    const ys = P.map((p) => p.y).sort((a, b) => a - b);
    const thr = ys[Math.floor(ys.length * QT)];
    for (const p of P) if (p.y >= thr) {
      const mx = Math.max(p.r, p.g, p.b), mn = Math.min(p.r, p.g, p.b);
      rb += p.r - p.b; sat += mx ? (mx - mn) / mx * 100 : 0; n++;
    }
  }
  const res = n ? { warmth: rb / n, sat: sat / n } : null;
  _brightCache.set(file, res);
  return res;
}

// ─── 2a) FILTRES ADAPTATIFS (mesure→règle, zone morte + gate) ────────────────

// BALANCE DES BLANCS — région-aware (17/07). Refroidit les façades DORÉES sur-cuites, laisse
// les néons vifs et les plans froids. La moyenne globale R−B ne SÉPARE PAS un doré (R22, 14.7)
// d'un néon (R07, 14.7) : mêmes chiffres. Le discriminateur mesuré = « DORURE de la zone
// brillante » = warmth × saturation de la zone brillante (`plateBrightZone`). Une façade lavée
// est chaude ET saturée dans sa zone claire ; un néon est chaud mais sa zone claire est moins
// saturée (cœurs qui clippent vers le blanc) ; un plan froid n'est pas chaud du tout.
//   index = regionW × regionSat/100 →  DORÉ ≥13.5 (R16 22.6 · R22 13.5 · R23 51.7)
//                                      NÉON ≤12.7 (R03 10.2 · R07 10.5 · R10 12.7 · R15 7.2)
//                                      FROID <0 · BRUME R09 1.8
// Correction PROPORTIONNELLE à (index − GATE) → près du seuil (R22/R10) la dose est ~0, donc
// la marge fine R22↔R10 ne provoque pas de bascule visible. Sortie = même forme colorbalance
// qu'avant (levier jaune→bleu, léger retrait de rouge, plafonné). Corrige le sous-dosage de
// R16 (global 17.3→dose 0.025 ; region→0.064) et attrape R22, sans dé-saturer aucun néon.
export function adaptiveWarmth(file) {
  const bz = plateBrightZone(file);
  if (!bz || bz.warmth <= 0) return '';                 // zone brillante froide/neutre → rien
  const index = bz.warmth * bz.sat / 100;
  const GATE = 12, K = 0.006, CAP = 0.20;
  if (index <= GATE) return '';                          // néon/froid/brume : ne pas refroidir
  const corr = Math.min(CAP, K * (index - GATE));
  return `,colorbalance=rm=${(-corr * 0.6).toFixed(3)}:bm=${corr.toFixed(3)}`
    + `:rh=${(-corr * 0.5).toFixed(3)}:bh=${(corr * 0.9).toFixed(3)}`;
}

// SATURATION : remonte les plans ternes/mono (boost gaté chaleur — pas sur un doré, ça
// re-jaunit), calme les criards. Cf. STYLE.md §Saturation ADAPTATIVE.
export function adaptiveSaturation(file) {
  const m = measurePlate(file);
  if (!m || m.SATAVG === null) return '';
  const s = m.SATAVG, LOW = 13, HIGH = 28, TARGET = 15.5, WARM_GATE = 15;
  if (s < LOW) {
    const w = plateWarmth(file);
    if (w !== null && w >= WARM_GATE) return '';        // plan doré : ne pas re-jaunir
    return `,eq=saturation=${Math.min(1.30, TARGET / s).toFixed(3)}`;
  }
  if (s > HIGH) return `,eq=saturation=${Math.max(0.82, HIGH / s).toFixed(3)}`;
  return '';
}

// POINT NOIR / CONTRASTE par plan : mesure le PLANCHER réel (YLOW). Si les noirs sont
// LAITEUX (plancher levé → image plate, sans profondeur), on relève le point noir d'ENTRÉE
// (`colorlevels` rimin/gimin/bimin) pour rendre la profondeur (doctrine « noirs profonds »).
// Un plan déjà profond n'est PAS touché (zone morte) → on ne crushe jamais un plan sombre.
// Sur-chaud → on épargne le canal bleu (plancher chaud volontaire, ne pas bleuir l'ombre).
export function adaptiveBlackpoint(file) {
  const m = measurePlate(file);
  if (!m || m.YLOW === null) return '';
  const blk = m.YLOW;                               // plancher 0-255
  const FLOOR_HI = 40, TARGET = 24, K = 0.7, CAP = 0.08, BRIGHT_SKIP = 110;
  // GARDE FAUX-POSITIF : un plancher élevé sur un plan GLOBALEMENT clair = brume/voile/
  // sur-ex qui remplit le cadre (ex. R09, projection dans la fumée), PAS des noirs levés
  // par le grade → creuser ne rend pas de la profondeur, ça écrase du contenu. On n'agit
  // que sur un plan à la fois sombre ET au plancher laiteux (vrai défaut de contraste).
  if (blk <= FLOOR_HI || (m.YAVG !== null && m.YAVG > BRIGHT_SKIP)) return '';
  const lift = Math.min(CAP, ((blk - TARGET) / 255) * K);
  const w = plateWarmth(file);
  const bFactor = (w !== null && w > 15) ? 0.6 : 1;  // plan chaud : creuser moins le bleu
  return `,colorlevels=rimin=${lift.toFixed(3)}:gimin=${lift.toFixed(3)}:bimin=${(lift * bFactor).toFixed(3)}`;
}

// EXPOSITION : léger gain sur un plan trop sombre, légère baisse sur un plan trop clair,
// autour d'une cible de luma moyenne. Conservateur (gain plafonné) pour ne pas bagarrer
// avec hiTame (qui, lui, façonne le HAUT de la courbe). Zone morte large.
export function adaptiveExposure(file) {
  const m = measurePlate(file);
  if (!m || m.YAVG === null) return '';
  const y = m.YAVG, LOWY = 74, HIGHY = 120, TARGET = 92, CAP = 0.10;
  if (y >= LOWY && y <= HIGHY) return '';
  const ref = y < LOWY ? LOWY : HIGHY;
  // exposure= en stops approximés : delta doux proportionnel à l'écart à la cible.
  const ev = Math.max(-CAP, Math.min(CAP, (TARGET - y) / 255 * 1.4));
  return `,exposure=exposure=${ev.toFixed(3)}`;
}

// ─── 2b) DOMPTEURS PILOTÉS PAR FLAG (plan.txt), pas par mesure ───────────────

// HAUTES LUMIÈRES (`hi`/`hi2`) : courbe en S — creuse les bas-mids (contraste) + tire le
// sommet vers le bas (néons/façades contenus, moins de blanc qui bave).
export function hiTame(level) {
  if (!level) return '';
  const c = level >= 2
    ? '0/0 0.24/0.16 0.5/0.44 0.70/0.54 0.86/0.62 1/0.66'    // fort
    : '0/0 0.28/0.21 0.5/0.47 0.74/0.60 0.90/0.70 1/0.76';   // modéré
  return `,curves=m='${c}'`;
}

// ANTI-BLOOM (`glow`) : contraste local grand rayon (resserre le voile basse-fréquence)
// + creux léger de la bande de halo. À réserver aux plans à néon (l'unsharp lève du bruit
// sur un plan sombre lisse).
export function deBloom(on) {
  if (!on) return '';
  return ",unsharp=9:9:0.8:9:9:0.0,curves=m='0/0 0.5/0.48 0.66/0.56 0.85/0.80 0.95/0.93 1/1'";
}

// ─── 2c) CHAÎNE ADAPTATIVE assemblée (ordre canonique) ──────────────────────
// Ordre : blancs → saturation → point noir → exposition. (Le grade de base est appliqué
// AVANT dans FIT ; hi/glow sont ajoutés par l'appelant selon les flags du plan.)
export function adaptiveColor(file, opts = {}) {
  const o = { warmth: true, saturation: true, blackpoint: true, exposure: false, ...opts };
  let vf = '';
  if (o.warmth) vf += adaptiveWarmth(file);
  if (o.saturation) vf += adaptiveSaturation(file);
  if (o.blackpoint) vf += adaptiveBlackpoint(file);
  if (o.exposure) vf += adaptiveExposure(file);    // OFF : cible 92 laverait la nuit low-key
  return vf;
}
// NB (17/07) : denoise & deband AUTO tentés puis RETIRÉS — la détection cheap/offline n'est pas
// fiable (le résidu de bruit s'auto-annule au downscale ; le banding se confond avec un ciel
// sombre lisse → faux positif sur R15/R16). Ce montage est de toute façon propre (DJI 10-bit).
// Restent dispo en MANUEL via LOOKS.denoise / LOOKS.deband si le monteur repère un rush bruité/bandé à
// l'œil. Un détecteur AUTO sûr demande un rush de RÉFÉRENCE bruité/bandé pour se calibrer.

// ─── 2d) LOOKS — catalogue des réglages CLASSIQUES, dosables ─────────────────
// Chaque entrée est un builder `(amount) => fragment`. `amount` est l'intensité (dose)
// dans une échelle naturelle au réglage ; 0 (ou défaut neutre) = pas d'effet. On pioche
// et on dose. Sert de vocabulaire commun (réglages manuels, futures DA, futurs adaptatifs).
// Réf. paramètres : `ffmpeg -h filter=<nom>` (build 8.1.2).
export const LOOKS = {
  // — Tonalité —
  brightness: (v = 0) => `,eq=brightness=${(+v).toFixed(3)}`,          // -1..1 (0 neutre)
  exposure:   (ev = 0, black = 0) => `,exposure=exposure=${(+ev).toFixed(3)}:black=${(+black).toFixed(3)}`, // -3..3 / -1..1
  contrast:   (v = 1) => `,eq=contrast=${(+v).toFixed(3)}`,            // 0..2 (1 neutre)
  gamma:      (v = 1) => `,eq=gamma=${(+v).toFixed(3)}`,               // 0.1..10 (1 neutre)
  // Point noir / point blanc d'entrée (contraste par les extrémités) — colorlevels.
  blackPoint: (v = 0) => `,colorlevels=rimin=${(+v).toFixed(3)}:gimin=${(+v).toFixed(3)}:bimin=${(+v).toFixed(3)}`, // 0..0.2 creuse les noirs
  whitePoint: (v = 1) => `,colorlevels=rimax=${(+v).toFixed(3)}:gimax=${(+v).toFixed(3)}:bimax=${(+v).toFixed(3)}`, // 0.8..1 éclaircit les blancs
  // Lift / Gamma / Gain (bas / mids / hauts) via une courbe 3-points sur toutes voies.
  lift:  (v = 0) => `,curves=all='0/${Math.max(0, +v).toFixed(3)} 0.5/0.5 1/1'`,
  gain:  (v = 1) => `,curves=all='0/0 0.5/0.5 1/${Math.min(1, +v).toFixed(3)}'`,
  // — Couleur —
  saturation: (v = 1) => `,eq=saturation=${(+v).toFixed(3)}`,         // 0..3 (1 neutre)
  vibrance:   (v = 0) => `,vibrance=intensity=${(+v).toFixed(3)}`,    // -2..2 (0 neutre, préserve la peau)
  temperature:(k = 6500, mix = 1) => `,colortemperature=temperature=${Math.round(+k)}:mix=${(+mix).toFixed(2)}:pl=0.5`, // 1000..40000 K
  tint:       (v = 0) => `,colorbalance=gm=${(+v).toFixed(3)}`,       // vert(-)↔magenta(+)
  hue:        (deg = 0, sat = 1) => `,hue=h=${(+deg).toFixed(1)}:s=${(+sat).toFixed(3)}`, // rotation teinte
  warmCool:   (v = 0) => `,colorbalance=rm=${(+v).toFixed(3)}:bm=${(-v).toFixed(3)}`, // +chaud / -froid (mids)
  // WB auto sur blacks & whites (colorcorrect en mode moyenne) — neutralise une dominante.
  autoWB:     (sat = 1) => `,colorcorrect=analyze=average:saturation=${(+sat).toFixed(3)}`,
  // — Netteté / bruit / bandes (utilitaires nuit) —
  sharpen:    (v = 0) => `,unsharp=5:5:${(+v).toFixed(2)}:5:5:0`,     // 0..1.5
  denoise:    (v = 0) => v > 0 ? `,hqdn3d=${(+v).toFixed(1)}:${(+v).toFixed(1)}:6:6` : '',
  deband:     (v = 0) => v > 0 ? `,deband=1thr=${(+v).toFixed(3)}:2thr=${(+v).toFixed(3)}:3thr=${(+v).toFixed(3)}:4thr=${(+v).toFixed(3)}` : '',
  // — LUT filmique .cube (look tout-fait, dosable via mix par blend externe) —
  filmLut:    (cube) => cube ? `,lut3d='${cube}'` : '',
};
