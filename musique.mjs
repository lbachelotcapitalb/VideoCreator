#!/usr/bin/env node
// musique.mjs — workflow MUSIQUE de la stack montage (offline strict).
//
// ⚠️ DEUX ÉTAGES DE MUSIQUE — ne pas les confondre (l'en-tête ci-dessous a menti jusqu'au 29/07,
// elle n'annonçait que 2 sous-commandes alors que `plan` existe, et ça m'a fait poser au monteur une
// question à laquelle le code répondait déjà) :
//   ① LIT PAR JOUR — dans monte.mjs (`pickMusic`), c'est un PLACEHOLDER : il prend le PREMIER
//      fichier de Musiques/ par ordre alphabétique. Aucune intelligence, aucun in-point. Il n'a
//      de sens que pour écouter un jour isolé. Dès qu'une journée est destinée au vlog assemblé,
//      il faut `Réglages/musique.txt = off` (sinon N journées concaténées = N démarrages de
//      morceau) — ce sont les rendus « (nu vlogNN) » qui alimentent le merge.
//   ② CARTE SUR LA TIMELINE FINALE — ici, `plan` / `plan --structure`. C'est LÀ qu'est
//      l'intelligence : choix de piste par mood/usage, in-point calé sur l'énergie du morceau,
//      ambient d'un bout à l'autre (le beat est une OPTION `--beat` depuis le 30/07),
//      frontières snappées sur les ruptures du montage, et une GRILLE FINE DE NIVEAUX :
//      par bande paysage, tête MUETTE en sortie de parole puis queue SONORE — des tendances
//      longues, jamais une bascule par bande. Plan paysage commenté (`PARLE` dans l'EDL) →
//      niveau `voix`. Fondu de sortie étalé sur la bande paysage de clôture.
//      La musique se décide UNE FOIS, sur le vlog, jamais jour par jour.
//
// Sous-commandes :
//   node musique.mjs analyze [dossierMusique]
//       → enveloppe d'énergie RMS de chaque piste (ffmpeg → PCM, calcul Node),
//         repère montée / plateau fort / pic, propose un in-point par durée de clip,
//         écrit Réglages/musique.analyse.json (réutilisable par le moteur plus tard).
//
//   node musique.mjs apply <video.mp4> --track <sous-chaîne> --in <mm:ss|sec>
//                    [--mode speech|bed|bald] [--gain 1.0] [--out <chemin>] [--compare]
//       → pose la piste sur un rendu EXISTANT en démarrant à l'in-point (le -ss qui
//         manque au moteur). Reprend la philosophie de ducking de monte.mjs :
//           speech : la VOIX règne (musique 0.18, sidechain-duckée sous la parole)
//           bed    : la MUSIQUE porte (lit 0.9, ambiance 0.5 duckée dessous), loudnorm -14
//           bald   : musique nue par-dessus (remplace l'audio), loudnorm -14
//         --compare rend AUSSI une version musique@0:00 à côté (preuve avant/après).
//
//   node musique.mjs plan <video.mp4> [--out …]
//       → CARTE MULTI-PISTES automatique : découpe la vidéo en cues longs (doctrine ambient
//         50-120 s), alterne ambient / beat, choisit une piste différente par cue selon son
//         mood+usage, entre dedans à un in-point calculé sur son enveloppe d'énergie (pas à 0:00),
//         signale les cues où le PIC du morceau tombe dedans (`swell`), écrit
//         Réglages/musique.plan.json et rend la vidéo musicale.
//
//   node musique.mjs plan <video.mp4> --structure vlog/vlog.plan.json
//       → même chose sur une TIMELINE MIXTE (landscape × facecam) : les frontières de cue sont
//         SNAPPÉES sur les ruptures réelles du montage (jamais au milieu d'un plan ni d'une
//         phrase) et les NIVEAUX suivent une grille fine, bloc par bloc.
//         `--outro <s>` impose la durée du fondu de sortie au lieu de la déduire de la bande
//         paysage de clôture : c'est le cas quand le film se termine par un GÉNÉRIQUE, où le
//         fondu doit courir SUR le générique et pas remonter dans les plans qui le précèdent.
//
// Rien n'est publié, rien n'écrase un rush. Le moteur (monte.mjs) n'est PAS modifié :
// c'est la surface d'itération du workflow musique avant intégration.

import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync, existsSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { basename, join, extname, dirname, resolve } from 'node:path';
import os from 'node:os';
import { TESTS } from './store.mjs';   // chemins du store : un seul endroit

const STORE   = join(os.homedir(), 'Movies', 'Montage');
// dossier musique résilient au renommage (le monteur 25/07 : « Musique (optionnel) » → « Musiques »)
function musicDir() {
  for (const n of ['Musiques', 'Musique (optionnel)']) { const p = join(STORE, n); if (existsSync(p)) return p; }
  return join(STORE, 'Musiques');
}
const MUSIC   = musicDir();
const REGLAGES= join(STORE, 'Réglages');
// Le rendu ♪ se pose À CÔTÉ de la vidéo qu'il sonorise, pas dans un dossier en dur (le monteur 30/07 :
// les rendus VLOG agrégés vivent dans « Vidéos finies », les masters de jour dans « Landscape
// Rush » — l'un ne doit pas exiler l'autre). `Landscape Rush` ne reste que le repli.
const OUT_DIR = TESTS;
const outDirFor = (video) => { const d = dirname(resolve(video)); return d && existsSync(d) ? d : OUT_DIR; };
const WORK    = join(os.tmpdir(), 'musique-work'); mkdirSync(WORK, { recursive: true });
const MUSIC_EXT = new Set(['.mp3', '.m4a', '.wav', '.aac', '.flac', '.ogg', '.aif', '.aiff']);
// ⚠️ AMB_TP est le plafond DEMANDÉ à loudnorm, pas celui qu'on MESURE en sortie. Sur les
// masters #01 ET #02, TP=-1 a donné -0,5 puis -0,7 dBTP : loudnorm tourne ici en passe
// unique (mode dynamique, sans `measured_*`) et son plafond y est approché, pas garanti —
// et l'encodage AAC qui suit ajoute son propre dépassement inter-échantillon.
// Le plafond est donc posé 0,5 dB SOUS la cible réelle : on veut ≤ -1,0 dBTP au fichier
// livré, on demande -1,5. Réserve ouverte depuis le 01/08, corrigée le 31/08.
const AMB_LUFS = -14, AMB_TP = -1.5;   // LUFS : même cible que monte.mjs
// ⭐ 18/09 — UN PLAFOND APPROCHÉ N'EST PAS UN PLAFOND. Mesuré sur les 3 épisodes : le vrai
// pic du facecam est propre (−1,6 dBTP) et c'est à l'étage MUSIQUE que ça dépasse (#01 −0,5 ·
// #02 −0,8 · #03 +0,1 dBTP). Cause : loudnorm tourne ici en passe unique, son TP est une
// cible qu'il APPROCHE, et l'AAC qui suit ajoute son dépassement inter-échantillon. On pose
// donc un limiteur DUR après lui. `level=disabled` est obligatoire : sans lui, alimiter
// renormalise sa sortie et défait le loudnorm qu'on vient d'appliquer.
// ⚠⚠ 19/09 — ET UN LIMITEUR DE PIC ÉCHANTILLON NE BORNE PAS LE PIC INTER-ÉCHANTILLON.
// `alimiter` plafonne l'échantillon ; `gate.py` mesure le VRAI pic (true peak), qui inclut le
// dépassement reconstruit entre deux échantillons, et l'AAC en ajoute encore. Mesuré : plafond
// −1,0 dB → **−0,7 dBTP** en sortie sur le master du 19/09, alors que ce même réglage avait
// rendu −1,0 le 18/09 — la marge dépend de la MATIÈRE, donc un vivier neuf la redistribue.
// Le commentaire ci-dessous disait « plafond GARANTI » : il garantissait la mauvaise grandeur.
// Abaissé à −1,5 dB, soit 0,5 dB de marge pour un dépassement mesuré à +0,3 dB.
// *Deux grandeurs qui portent le même nom (« pic ») ne sont pas la même mesure.*
const AMB_CEIL = '-1.5dB';             // plafond ÉCHANTILLON, choisi pour tenir le VRAI pic ≤ −1 dBTP
// ⭐ ET LE REMÈDE A SA PROPRE DETTE : `alimiter` RETARDE le son de son `attack` (5 ms par
// défaut) et ne compense pas sa latence. Posé nu, il faisait échouer `gate.py` sur la seule
// dimension qui compte pour le monteur — la synchro — à +5 ms CONSTANT sur les 7 fenêtres, alors que
// la tolérance de la gate est 1 ms. Un correctif de niveau avait fabriqué un défaut d'HORLOGE.
// On rend donc les 5 ms au début et on les rajoute à la fin (la durée ne bouge pas, le film
// finit de toute façon en fondu). Mesuré par corrélation croisée AVANT de servir :
// loudnorm seul 0,00 ms · + alimiter −5,00 ms · + compensation 0,00 ms.
const AMB_LAT  = 0.005;                // latence d'alimiter = son attack, rendue au montage

const SR = 8000, WIN = 0.5;          // analyse : 8 kHz mono, fenêtre RMS 0.5 s

// ── utilitaires ──────────────────────────────────────────────────────────────
const fmt = (s) => `${Math.floor(s/60)}:${String(Math.round(s%60)).padStart(2,'0')}`;
function parseTime(t) {                // "1:17" | "77" | "77.5" → secondes
  if (t == null) return 0;
  const s = String(t).trim();
  if (s.includes(':')) { const [m, sec] = s.split(':'); return (+m)*60 + (+sec); }
  return parseFloat(s) || 0;
}
function durationOf(file) {
  return Number(execFileSync('ffprobe', ['-v','error','-show_entries','format=duration',
    '-of','default=nk=1:nw=1', file]).toString().trim());
}
function listTracks(dir) {
  return readdirSync(dir)
    .filter((f) => !f.startsWith('.') && MUSIC_EXT.has(extname(f).toLowerCase()))
    .filter((f) => !/\(\d+\)/.test(f))   // ignore les copies " (1)"
    .sort();
}
function resolveTrack(sub) {
  const all = readdirSync(MUSIC).filter((f) => MUSIC_EXT.has(extname(f).toLowerCase()));
  const hit = all.find((f) => f.toLowerCase().includes(String(sub).toLowerCase()));
  if (!hit) throw new Error(`aucune piste ne matche « ${sub} » dans ${MUSIC}`);
  return join(MUSIC, hit);
}

// ── ANALYSE ──────────────────────────────────────────────────────────────────
function pcm(file) {
  const r = spawnSync('ffmpeg', ['-v','error','-i',file,'-ac','1','-ar',String(SR),
    '-f','s16le','-acodec','pcm_s16le','pipe:1'], { maxBuffer: 1<<30 });
  const b = r.stdout; const n = b.length >> 1; const a = new Float64Array(n);
  for (let i=0;i<n;i++) a[i] = b.readInt16LE(i*2) / 32768;
  return a;
}
function envelope(x) {
  const w = Math.round(WIN*SR), out = [];
  for (let i=0;i<x.length;i+=w) { let s=0,c=0;
    for (let j=i;j<Math.min(i+w,x.length);j++){ s+=x[j]*x[j]; c++; }
    out.push(Math.sqrt(s/Math.max(1,c))); }
  return out;
}
function smooth(a, k) {
  const out = new Array(a.length), r = Math.round(k/2);
  for (let i=0;i<a.length;i++){ let s=0,c=0;
    for (let j=Math.max(0,i-r);j<=Math.min(a.length-1,i+r);j++){ s+=a[j]; c++; }
    out[i]=s/c; }
  return out;
}
// zero-crossing rate : proxy de BRILLANCE (aigus/souffle) — cheap, sur le PCM déjà décodé
function zcr(x) { let c=0; for (let i=1;i<x.length;i++) if ((x[i-1]<0)!==(x[i]<0)) c++; return c/x.length; }
// rythme via aubio : densité d'onsets (/s) + tempo (bpm). Repli 0 si échec (offline, robuste).
function rhythmFeatures(file) {
  const wav = join(WORK, 'rhythm.wav');
  try { execFileSync('ffmpeg', ['-y','-v','error','-i',file,'-ar','22050','-ac','1',wav]); }
  catch { return { onsetRate: 0, bpm: 0 }; }
  let onsets = 0, bpm = 0, dur = 1;
  try { onsets = execFileSync('aubioonset', ['-i',wav]).toString().trim().split('\n').filter(Boolean).length; } catch {}
  try { dur = durationOf(wav); } catch {}
  try { const m = execFileSync('aubio', ['tempo', wav]).toString().match(/([\d.]+)\s*bpm/); if (m) bpm = +m[1]; } catch {}
  return { onsetRate: +(onsets/Math.max(1,dur)).toFixed(2), bpm: Math.round(bpm) };
}
function analyzeTrack(file) {
  const dur = durationOf(file);
  const raw = pcm(file);
  const sm  = smooth(envelope(raw), 6);
  const max = Math.max(...sm), min = Math.min(...sm);
  const norm = sm.map((v) => (v-min)/(max-min+1e-9));
  let peakI=0; for (let i=0;i<norm.length;i++) if (norm[i]>norm[peakI]) peakI=i;
  const peakT = peakI*WIN;
  let a=peakI,b=peakI;
  while (a>0 && norm[a-1]>=0.80) a--;
  while (b<norm.length-1 && norm[b+1]>=0.80) b++;
  let build=a; while (build>0 && norm[build]>0.30) build--;
  const head = norm.slice(0, Math.round(5/WIN)).reduce((s,v)=>s+v,0)/Math.round(5/WIN);
  // features de caractère
  const meanN = norm.reduce((s,v)=>s+v,0)/norm.length;
  const cv = Math.sqrt(norm.reduce((s,v)=>s+(v-meanN)*(v-meanN),0)/norm.length) / (meanN+1e-9); // variabilité
  const buildRatio = norm.slice(0, Math.max(1,Math.round(norm.length*0.12))).reduce((s,v)=>s+v,0) / Math.max(1,Math.round(norm.length*0.12)); // bas = grosse montée depuis le calme
  const loud = sm.reduce((s,v)=>s+v,0)/sm.length; // énergie absolue moyenne (loudness relative)
  const bright = zcr(raw);
  const inFor = (clip) => { let x = Math.max(0, peakT - clip*0.65); if (x+clip>dur) x = Math.max(0, dur-clip); return x; };
  return {
    file: basename(file), dur, headEnergy: +head.toFixed(3),
    peak: +peakT.toFixed(1), buildStart: +(build*WIN).toFixed(1),
    strong: [+(a*WIN).toFixed(1), +((b+1)*WIN).toFixed(1)],
    inPoint: { '90': +inFor(90).toFixed(1), '120': +inFor(120).toFixed(1) },
    cv: +cv.toFixed(2), buildRatio: +buildRatio.toFixed(2), loud: +loud.toFixed(4), bright: +bright.toFixed(4),
    ...rhythmFeatures(file),
  };
}
// mood + usage : seuils calibrés SUR CETTE bibliothèque (percentiles) + indices du nom de fichier
function pct(arr, p) { const s=[...arr].sort((a,b)=>a-b); return s[Math.min(s.length-1, Math.floor(p*s.length))]; }
function deriveLabels(tracks) {
  const brightHi = pct(tracks.map(t=>t.bright), 0.66), brightLo = pct(tracks.map(t=>t.bright), 0.34);
  const loudMed = pct(tracks.map(t=>t.loud), 0.5), cvMed = pct(tracks.map(t=>t.cv), 0.5);
  for (const t of tracks) {
    const name = t.file.toLowerCase();
    const has = (re) => re.test(name);
    const brightness = t.bright>=brightHi ? 'clair' : t.bright<=brightLo ? 'sombre' : 'neutre';
    // MOOD (multi, plafonné à 3)
    const mood = [];
    if (t.onsetRate>=2.5 || has(/garage|beat|wave/)) mood.push('rythmé');
    if (brightness==='sombre' || has(/dark|deep/)) mood.push('sombre');
    if ((brightness==='clair' && t.cv<cvMed) || has(/dreamy|glass|slowlight|aerowave|delight|enchanted/)) mood.push('rêveur/aérien');
    if (t.buildRatio<0.35 && t.cv>=cvMed) mood.push('cinématique');
    if (has(/nature|mountain|glade|forest|horses|canvas|silence|slowlight/)) mood.push('nature/planant');
    if (!mood.length || (t.cv<0.35 && t.onsetRate<1)) mood.push('minimal/contemplatif');
    t.mood = [...new Set(mood)].slice(0,3);
    // USAGE (drapeaux actionnables)
    const use = [];
    if (t.onsetRate<2.2 && t.cv<=1.1) use.push('lit');                                   // bed ambiance
    if (t.buildRatio<0.45 || t.loud>=loudMed) use.push('plein');                          // porte une séquence
    if (t.onsetRate<1.2 && brightness!=='clair' && t.loud<=loudMed) use.push('facecam');  // sous la voix
    if (t.onsetRate>=2.5) use.push('beat');                                               // montage calé beat
    t.usage = use.length ? use : ['lit'];
    t.brightness = brightness;
  }
  return tracks;
}
function cmdAnalyze(dir) {
  const D = dir || MUSIC;
  const res = deriveLabels(listTracks(D).map((f) => analyzeTrack(join(D, f))));
  // table catalogue (console)
  console.log(`\n♪ Catalogue musique — ${res.length} pistes  (${basename(D)})\n`);
  console.log('  durée  démar  pic     bpm  onset/s  brillance  MOOD / USAGE / in-point(90s)');
  for (const t of res) {
    console.log(`  ${fmt(t.dur).padStart(4)}  ${(t.headEnergy*100).toFixed(0).padStart(3)}%  ${fmt(t.peak).padStart(5)}  ` +
      `${String(t.bpm).padStart(3)}  ${String(t.onsetRate).padStart(5)}   ${t.brightness.padEnd(7)}  ` +
      `${t.mood.join('+')} | ${t.usage.join('/')} | @${fmt(t.inPoint['90'])}`);
    console.log(`        ↳ ${t.file}`);
  }
  // JSON (pour plan/futur) + catalogue markdown (pour le monteur)
  writeFileSync(join(REGLAGES,'musique.analyse.json'),
    JSON.stringify({ generated:'offline', win:WIN, tracks:res }, null, 2));
  const md = [`# Catalogue musique — ${res.length} pistes`, '',
    'Mood + usage calculés offline (énergie, variabilité, montée, brillance ZCR, tempo/onsets aubio).',
    'Usage : **lit** = bed ambiance · **plein** = porte une séquence (100 % musique) · **facecam** = sous la voix · **beat** = montage calé.',
    '', '| Piste | Durée | Pic | BPM | Onsets/s | Brillance | Mood | Usage | In-point 90s |',
    '|---|---|---|---|---|---|---|---|---|',
    ...res.map(t => `| ${t.file} | ${fmt(t.dur)} | ${fmt(t.peak)} | ${t.bpm} | ${t.onsetRate} | ${t.brightness} | ${t.mood.join(', ')} | ${t.usage.join(', ')} | ${fmt(t.inPoint['90'])} |`),
  ].join('\n');
  writeFileSync(join(REGLAGES,'musique.catalogue.md'), md + '\n');
  console.log(`\n→ écrit Réglages/musique.analyse.json + musique.catalogue.md`);
}

// ── APPLICATION ──────────────────────────────────────────────────────────────
function run(args) { spawnSync('ffmpeg', args, { stdio: ['ignore','ignore','inherit'] }); }

function applyMusic({ video, track, inPoint, mode, gain, out }) {
  const music = resolveTrack(track);
  const ss = parseTime(inPoint);
  const g = gain ?? (mode === 'speech' ? 0.18 : mode === 'bed' ? 0.9 : 1.0);
  // -ss AVANT -i sur la musique = démarre à l'in-point (le chaînon manquant),
  // aloop reboucle ensuite le reste si la vidéo est plus longue que la piste restante.
  const musIn = ['-ss', ss.toFixed(3), '-i', music];
  let fc, map;
  if (mode === 'speech') {
    fc = `[1:a]aloop=loop=-1:size=2e9,volume=${g}[m];` +
         `[m][0:a]sidechaincompress=threshold=0.03:ratio=8:attack=5:release=400[md];` +
         `[0:a][md]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]`;
  } else if (mode === 'bed') {
    fc = `[1:a]aloop=loop=-1:size=2e9,volume=${g}[bed];` +
         `[0:a]volume=0.5[amb];` +
         `[amb][bed]sidechaincompress=threshold=0.03:ratio=6:attack=8:release=350[ambd];` +
         `[bed][ambd]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mix];` +
         `[mix]loudnorm=I=${AMB_LUFS}:TP=${AMB_TP}:LRA=11,alimiter=limit=${AMB_CEIL}:level=disabled,atrim=start=${AMB_LAT},asetpts=N/SR/TB,apad=pad_dur=${AMB_LAT}[a]`;
  } else { // bald : musique nue, remplace l'audio
    fc = `[1:a]aloop=loop=-1:size=2e9,volume=${g},loudnorm=I=${AMB_LUFS}:TP=${AMB_TP}:LRA=11,alimiter=limit=${AMB_CEIL}:level=disabled,atrim=start=${AMB_LAT},asetpts=N/SR/TB,apad=pad_dur=${AMB_LAT}[a]`;
  }
  map = ['-map','0:v','-map','[a]'];
  run(['-y','-i',video, ...musIn, '-filter_complex', fc, ...map,
       '-c:v','copy','-c:a','aac','-b:a','192k','-ar','48000','-ac','2','-shortest', out]);
  return { music: basename(music), inPoint: ss, mode, gain: g, out };
}

function cmdApply(argv) {
  const video = argv._[0];
  if (!video || !existsSync(video)) throw new Error(`vidéo introuvable : ${video}`);
  const mode = argv.mode || 'bed';
  const track = argv.track; if (!track) throw new Error('--track <sous-chaîne> requis');
  const inPoint = argv.in ?? 0;
  const gain = argv.gain != null ? parseFloat(argv.gain) : undefined;
  const base = basename(video).replace(/\.mp4$/i, '');
  const tag = `[${mode}+in${fmt(parseTime(inPoint)).replace(':','m')}]`;
  const out = argv.out || join(outDirFor(video), `${base} ♪${tag}.mp4`);
  const r = applyMusic({ video, track, inPoint, mode, gain, out });
  console.log(`✓ ${basename(out)}  ← ${r.music} @ ${fmt(r.inPoint)} (mode ${mode}, gain ${r.gain})`);
  if (argv.compare) {
    const out0 = join(outDirFor(video), `${base} ♪[${mode}+in0m00 NAIF].mp4`);
    const r0 = applyMusic({ video, track, inPoint: 0, mode, gain, out: out0 });
    console.log(`✓ ${basename(out0)}  ← ${r0.music} @ 0:00 (comparaison naïve)`);
  }
}

// ── PLAN MULTI-PISTES (carte musique) ────────────────────────────────────────
// Découpe la timeline d'un vlog en CUES (morceaux ≤ MAX, exploités ≥ MIN), attribue
// une piste par cue (rotation, jamais 2× d'affilée, in-point stratégique posant le
// swell dans le cue), et une INTENSITÉ « au feeling » (lit ↔ plein) équilibrée :
// ni trop de 100 % musique ni trop de 100 % son-vidéo, bascules cohérentes, un peu
// plus de plein juste après un facecam. Rend l'audio ; la VIDÉO n'est jamais ré-encodée.
const XF = 1.5;                       // crossfade entre cues (s)
// DURÉE D'UNE PISTE (le monteur, 31/07 : « ça change trop vite de musique, laisse durer un peu plus
// longtemps les musiques »). Avant : 50/90/120 → sur le VLOG #01 (12:50) ça donnait **9 pistes**,
// un changement toutes les 1 min 24. Maintenant : **5 pistes**, une toutes les ~2 min 34.
// C'est le MÊME retour que la préférence n°1 de `MUSIQUE.md` (« il faut des tendances plus
// longues »), appliqué cette fois au CHOIX DE PISTE et non au niveau : un morceau qui n'a pas eu
// le temps de s'installer est entendu comme un zapping, même si chaque morceau est bon.
const CUE_MIN = 90, CUE_TARGET = 150, CUE_MAX = 200;
// niveaux d'intensité = dominance musique ↔ son-vidéo (gain musique / gain original)
const LEVELS = {
  voix:  { mus: 0.15, org: 1.00 },    // facecam : voix reine (cas particulier)
  lit:   { mus: 0.85, org: 0.45 },    // ambiance gardée sous la musique
  plein: { mus: 1.00, org: 0.06 },    // 100 % musique
};

const BEAT_LEN = 45;                  // un cue BEAT est stratégique et COURT (le monteur 25/07)
// bibliothèque enrichie (features + mood + usage) avec le chemin, pour `plan`
function analyzeLibrary(dir) {
  return deriveLabels(listTracks(dir).map((f) => ({ path: join(dir, f), ...analyzeTrack(join(dir, f)) })));
}
// ⚠⚠ 31/08 — LE LIT MUSICAL DOIT COUVRIR SON CUE, ET UNE PISTE BOUCLÉE REJOUE SON PROPRE FADE.
// Retour du monteur sur le #02 : « tu mets 2× la même musique, tu l'arrêtes en fade à R24 et tu la
// reprends à R27 ». Mesuré sur le rendu du 30/08 : à 1:49,8 le film tombe à −57 dBFS et met
// 3 secondes à remonter. La cause n'était NI le ducking NI un changement de piste — c'était le
// LIT : les 5 cues faisaient 145 à 166 s, et les 5 pistes choisies duraient 67 à 112 s. Le
// `-stream_loop -1` rebouclait donc chaque piste — en rejouant son propre FONDU DE SORTIE
// (6,5 s de descente jusqu'à −96 dB sur la piste 1) suivi de son propre FONDU D'ENTRÉE.
// Bilan mesuré : 305 s sur 772, soit 40 % du film, passées sur un lit qui s'éteint et se
// rallume. « Arrêtée en fade puis reprise » est la description exacte de ce que le code faisait.
//
// La préférence n°4 du monteur (cues de ~2 min 30) est ARBITRÉE et ne se rediscute pas : ce sont
// donc l'attribution et le bouclage qui doivent suivre. Deux gestes, tous deux mesurables :
//   ① la COUVERTURE devient dominante dans le score d'attribution (+6 au lieu de +1) : on ne
//      prend une piste trop courte que si aucune longue n'est disponible.
//   ② quand il faut quand même boucler, on boucle sur le CORPS UTILE de la piste — fondu
//      d'entrée et fondu de sortie retirés — et on raccorde par un fondu enchaîné.
//      Le lit ne peut alors plus descendre au silence au milieu d'un cue.
//
// Le corps utile se MESURE (`silencedetect`), il ne se devine pas : une piste ambient peut
// commencer par 1,5 s de rien et finir par 6,5 s de descente, et ces valeurs changent d'une
// piste à l'autre. On ne retient un silence que s'il TOUCHE un bord du fichier — un creux au
// milieu d'un morceau ambient est de la musique, pas un fondu.
const LOOP_XF = 4.0;             // s — fondu enchaîné d'un tour de boucle sur le suivant
const _corps = new Map();
function corpsUtile(track) {
  if (_corps.has(track.path)) return _corps.get(track.path);
  let deb = 0, fin = track.dur;
  try {
    const out = ffOut(['-i', track.path, '-af', 'silencedetect=noise=-40dB:d=0.4', '-f', 'null', '-']);
    const sils = [];
    const re = /silence_start:\s*(-?[\d.]+)[\s\S]*?silence_end:\s*([\d.]+)/g;
    let m; while ((m = re.exec(out))) sils.push([parseFloat(m[1]), parseFloat(m[2])]);
    // un silence non refermé en fin de fichier n'a pas de `silence_end` : on le rattrape.
    const dernier = [...out.matchAll(/silence_start:\s*(-?[\d.]+)/g)].at(-1);
    if (dernier && (!sils.length || parseFloat(dernier[1]) > sils.at(-1)[0])) {
      sils.push([parseFloat(dernier[1]), track.dur]);
    }
    for (const [a, b] of sils) {
      if (a <= 0.05) deb = Math.max(deb, b);              // fondu d'entrée
      if (b >= track.dur - 0.05) fin = Math.min(fin, a);  // fondu de sortie
    }
  } catch { /* pas de mesure → on garde la piste entière, jamais moins */ }
  if (fin - deb < 10) { deb = 0; fin = track.dur; }       // mesure absurde : on n'ampute rien
  const r = { deb: +deb.toFixed(3), fin: +fin.toFixed(3), dur: +(fin - deb).toFixed(3) };
  _corps.set(track.path, r);
  return r;
}
// in-point qui pose le pic à ~65 % du cue (borné dans la piste)
function inPointFor(track, L) {
  let x = Math.max(0, track.peak - L*0.65);
  if (x + L > track.dur) x = Math.max(0, track.dur - L);
  return x;
}
// ⚠ 31/08 — LE POINT D'ENTRÉE CÈDE DEVANT LA COUVERTURE. `inPointFor` pose le pic à 65 % du
// cue : sur une piste de 4 min pour un cue de 2 min 45, il démarre si tard qu'il ne reste plus
// de quoi couvrir — et une piste largement assez longue se retrouvait comptée « trop courte »,
// donc bouclée. Placer joliment un pic ne vaut pas un tour de boucle : on recule le départ juste
// ce qu'il faut pour couvrir, en restant dans le corps utile de la piste.
// ⭐⭐ LES CREUX INTERNES D'UNE PISTE — la dimension qui manquait (19/09).
// Mesuré sur le master du 19/09 : **2,0 s à −40,9 dBFS à 5:11**, c'est-à-dire le symptôme
// « la musique s'arrête » que le monteur a signalé deux fois sur le #02. Tous les contrôles étaient
// verts, et à raison : la COUVERTURE l'était (rgba-chill-cole, 231,7 s de corps utile pour un
// cue de 160,6 s), l'ATTAQUE aussi (−22,2 dBFS sur les 6 premières secondes). Personne ne
// regardait le MILIEU du morceau. `rgba-chill-cole` porte un break de 2,5 s à −41,6 dBFS à
// 18,5 s, l'in-point le posait à 11,9 s du début du cue, et ce cue est en tête `plein` —
// musique seule. *Un critère vert ne couvre que la dimension qu'il regarde* : quand on choisit
// un objet sur UN critère, on liste les AUTRES dimensions qui décident du résultat.
//
// Trois dimensions désormais mesurées sur une piste : durée utile (couverture) · niveau
// d'attaque (le trou de 6:13,5 du #02) · **creux internes** (celui-ci).
//
// ⚠ Un creux de 0,5 s n'est pas un arrêt — c'est une respiration. Le plancher est 1,0 s,
// la durée du plus court trou que le monteur ait signalé.
const CREUX_DB = -35, CREUX_MIN = 1.0;

// ⭐⭐ LE REFUS QUI MANQUAIT — LA FENÊTRE RÉELLEMENT JOUÉE (20/09).
// `creuxInternes` ci-dessous existe depuis le 19/09 et il est juste. Il n'a pourtant rien vu
// du trou de **18,5 s** que le master de l'EP3 porte à 09:42,5–10:01,0 (min −40,5 dBFS contre
// une médiane de film à −17,3). Trois raisons, et chacune est une leçon déjà écrite ailleurs :
//   ① il écarte tout creux qui touche les bords du corps utile (`a > co.deb+1 && b2 < co.fin-1`),
//      pour ne pas confondre un fondu avec un arrêt. Or ici le défaut EST dans l'outro : le cue
//      consomme `dreem-memorable.mp3` de 15,78 à 157,28 s alors que son corps utile finit à
//      **155,47 s** — 1,8 s de silence pur, précédées de 20 s d'outro qui alterne −20 et −67 dBFS.
//   ② il raisonne sur la PISTE, pas sur la fenêtre que le cue joue vraiment. Coverage =
//      157,28 − 15,78 = 141,5 s = exactement la durée du cue : **marge 0,000 s**. Le contrôle de
//      couverture est vert et il a raison sur sa dimension — il demande « la piste est-elle assez
//      longue », jamais « joue-t-elle encore à la fin ». C'est le SYMÉTRIQUE de la leçon du 31/08
//      sur le niveau d'ATTAQUE : même famille, autre bout de la piste.
//   ③ quand aucun in-point n'évite les creux, il **imprime un ⚠ et laisse passer**. Or
//      *un refus qui n'empêche pas l'étage suivant de consommer l'objet n'est pas un refus,
//      c'est un avertissement* (18/09). Avec une marge de 0,000 s, `departPour` n'avait de toute
//      façon aucun jeu : il ne pouvait qu'avertir.
//
// Ce garde-ci mesure donc la FENÊTRE JOUÉE et il BLOQUE. Son seuil est DÉRIVÉ, pas choisi :
// mesuré sur les 5 cues de l'EP3, le plus long creux vaut 0 · 0 · 3 · **8** · 0 s. Les quatre
// cues sains plafonnent à 3 s, le défaut est à 8 s ; le refus se pose à 4 s, dans l'écart.
// Et le seuil de niveau est RELATIF à la médiane de la fenêtre elle-même (−20 dB), jamais absolu :
// *un proxy à seuil absolu fabrique des défauts* (19/09) — un morceau masterisé bas serait
// dénoncé partout par un −35 dBFS fixe.
const JOUE_SOUS_DB = -20;        // dB sous la MÉDIANE de la fenêtre jouée (relatif, pas absolu)
const JOUE_MAX_S = 4;            // s — 3 s mesurées sur les cues sains, 8 s sur le défaut
function creuxFenetreJouee(track, inPoint, len) {
  try {
    const raw = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(inPoint), '-t', String(len),
      '-i', track.path, '-ac', '1', '-ar', '8000', '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
    const x = new Float32Array(raw.buffer, raw.byteOffset, raw.length >> 2);
    const W = 8000, n = Math.floor(x.length / W);
    if (n < 4) return null;                       // trop court pour conclure → on ne crie pas
    const db = [];
    for (let i = 0; i < n; i++) {
      let acc = 0; for (let j = i * W; j < (i + 1) * W; j++) acc += x[j] * x[j];
      db.push(20 * Math.log10(Math.sqrt(acc / W) + 1e-12));
    }
    const med = [...db].sort((a, b) => a - b)[db.length >> 1];
    let best = 0, cur = 0, fin = 0;
    for (let i = 0; i < db.length; i++) {
      if (db[i] < med + JOUE_SOUS_DB) { cur++; if (cur > best) { best = cur; fin = i + 1; } }
      else cur = 0;
    }
    return { pire: best, debut: fin - best, med, min: Math.min(...db) };
  } catch { return null; }                        // mesure impossible → dit par le null
}
// Appelé au GOULOT : juste avant d'écrire le plan et de lancer le rendu. Une réserve se
// DÉCLARE et se CHIFFRE (`MUSIQUE_CREUX_RESERVE=8`), elle ne se prend pas en baissant le seuil.
function refuserSiLitMort(cues) {
  const tol = process.env.MUSIQUE_CREUX_RESERVE ? Number(process.env.MUSIQUE_CREUX_RESERVE) : null;
  const seuil = tol ?? JOUE_MAX_S;
  const fautifs = [], muets = [];
  for (const c of cues) {
    const len = c.end - c.start;
    const r = creuxFenetreJouee(c.track, c.inPoint, len);
    if (!r) { muets.push(c); continue; }
    const etat = r.pire > seuil ? '⛔' : '✅';
    console.log(`  ${etat} ${c.track.file.padEnd(38)} joué ${c.inPoint.toFixed(2)}→${(c.inPoint + len).toFixed(2)} s`
      + `  · médiane ${r.med.toFixed(1)} dBFS · plus long creux ${r.pire} s`
      + (r.pire ? ` (à +${r.debut} s du début du cue)` : ''));
    if (r.pire > seuil) fautifs.push({ c, r });
  }
  if (muets.length) {
    console.error(`\n⛔ ${muets.length} cue(s) NON MESURÉ(S) — une dimension aveugle n'est pas une dimension verte :`);
    for (const c of muets) console.error(`   · ${c.track.file}`);
    process.exit(1);
  }
  if (fautifs.length) {
    console.error(`\n⛔ LIT MUSICAL MORT sur ${fautifs.length} cue(s) — refus de rendre.`);
    for (const { c, r } of fautifs) {
      const t = c.start + r.debut;
      console.error(`   · ${c.track.file} : ${r.pire} s à plus de ${-JOUE_SOUS_DB} dB sous sa médiane,`
        + ` soit ${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')} dans le film.`);
    }
    console.error(`\n   Corriger par le CHOIX, pas par la compensation : changer la piste du cue, ou`);
    console.error(`   raccourcir le cue avant l'outro. Remonter le gain remonterait aussi le souffle`);
    console.error(`   et fausserait le loudnorm (31/08).`);
    console.error(`   Réserve assumée et chiffrée : MUSIQUE_CREUX_RESERVE=<secondes>`);
    process.exit(1);
  }
  if (tol != null) console.log(`  ⚠ réserve déclarée : creux toléré jusqu'à ${tol} s (MUSIQUE_CREUX_RESERVE)`);
}

const _creux = new Map();
function creuxInternes(track) {
  if (_creux.has(track.path)) return _creux.get(track.path);
  const out = [];
  try {
    const env = envelope(pcm(track.path));
    const co = corpsUtile(track);
    const bas = env.map((v) => 20 * Math.log10(Math.max(v, 1e-9)) < CREUX_DB);
    let s = null;
    for (let i = 0; i <= bas.length; i++) {
      if (i < bas.length && bas[i]) { if (s === null) s = i; continue; }
      if (s !== null) {
        const a = s * WIN, b2 = i * WIN;
        // les fondus de tête et de queue sont déjà retirés par corpsUtile : on ne compte
        // que ce qui tombe DANS le corps, sinon on condamnerait toutes les pistes.
        if (b2 - a >= CREUX_MIN && a > co.deb + 1 && b2 < co.fin - 1) out.push([a, b2]);
        s = null;
      }
    }
  } catch { /* mesure impossible → aucun creux connu, et on le dit à l'appelant par le vide */ }
  _creux.set(track.path, out);
  return out;
}
const chevauche = (x, L, c) => c.some(([a, b]) => b > x && a < x + L);
// ⚠ `departPour` est appelé par le SCORING (chaque piste contre chaque cue), pas seulement
// pour la piste retenue : sans dédoublonnage, une décision s'imprime 30 fois et le log
// devient illisible — donc plus personne ne le lit. Un garde qu'on ne lit plus est un garde
// débranché. Une ligne par (piste, longueur de cue).
const _ditUneFois = new Set();
function ditUneFois(cle, msg) { if (_ditUneFois.has(cle)) return; _ditUneFois.add(cle); console.log(msg); }

// ⭐ CORRIGER PAR LE CHOIX, PAS PAR LA COMPENSATION (leçon du 31/08, appliquée à l'in-point).
// Le réflexe facile serait de remonter le gain sur le creux : ça remonterait aussi le souffle
// et fausserait le loudnorm. On DÉPLACE donc le point d'entrée jusqu'à ce que le creux tombe
// hors du cue — et si aucune position ne le permet, on le DIT au lieu de livrer en silence.
function departPour(track, L) {
  const co = corpsUtile(track);
  let x = Math.max(inPointFor(track, L), co.deb);
  if (co.fin - x < L + XF) x = Math.max(co.deb, co.fin - (L + XF));
  x = Math.min(x, Math.max(co.deb, co.fin - 1));
  const creux = creuxInternes(track);
  if (!creux.length || !chevauche(x, L, creux)) return x;
  // candidats : juste APRÈS chaque creux, et juste AVANT (pour finir le cue avant lui).
  const cands = [];
  for (const [a, b] of creux) { cands.push(b + 0.05); cands.push(a - L - XF - 0.05); }
  const bons = cands
    .filter((c) => c >= co.deb && co.fin - c >= L + XF && !chevauche(c, L, creux))
    .sort((p, q) => Math.abs(p - x) - Math.abs(q - x));   // le plus proche du pic voulu
  if (bons.length) {
    ditUneFois(`ok:${track.file}:${L.toFixed(0)}`,
      `  ⇢ in-point de ${track.file} déplacé ${x.toFixed(2)} → ${bons[0].toFixed(2)} s `
      + `(${creux.length} creux interne(s) < ${CREUX_DB} dBFS, le cue de ${L.toFixed(0)} s les évite)`);
    return bons[0];
  }
  ditUneFois(`ko:${track.file}:${L.toFixed(0)}`,
    `  ⚠ ${track.file} : aucun in-point n'évite ses ${creux.length} creux interne(s) `
    + `pour un cue de ${L.toFixed(0)} s — la musique creuserait (`
    + creux.map(([a, b]) => `${a.toFixed(1)}–${b.toFixed(1)}s`).join(', ') + ')');
  return x;
}
// Découpe : AMBIENT dominante (cues longs), BEAT stratégique + court, jamais en 1er.
// « je filme beaucoup plus d'ambient / de plans smooth, le beat doit être stratégique
//   et généralement plus court » (le monteur 25/07).
function planCues(D, beatAvail) {
  const nBeat = (D >= 150 && beatAvail > 0) ? Math.min(beatAvail, Math.max(1, Math.floor(D / 210))) : 0;
  const ambTime = D - nBeat*BEAT_LEN;
  let nAmb = Math.max(1, Math.round(ambTime / CUE_TARGET));
  while (ambTime/nAmb > CUE_MAX) nAmb++;
  while (nAmb > 1 && ambTime/nAmb < CUE_MIN) nAmb--;
  const ambLen = ambTime / nAmb, total = nAmb + nBeat;
  const beatIdx = new Set();
  for (let k=1;k<=nBeat;k++) beatIdx.add(Math.min(total-1, Math.max(1, Math.floor(k*total/(nBeat+1)))));
  const cues = []; let t = 0;
  for (let i=0;i<total;i++) {
    const type = beatIdx.has(i) ? 'beat' : 'amb';
    const len = type==='beat' ? BEAT_LEN : ambLen;
    cues.push({ start:+t.toFixed(2), end:+(t+len).toFixed(2), len:+len.toFixed(2), type });
    t += len;
  }
  cues[cues.length-1].end = +D.toFixed(2);
  return cues;
}
// intensité : un BEAT porte toujours (plein) ; les AMBIENT alternent lit↔plein pour
// l'équilibre (démarre lit, la musique s'installe). Facecam → cue suivant en plein.
function assignIntensity(cues, facecamEndCues = new Set()) {
  let ambPhase = 'lit';
  for (let i=0;i<cues.length;i++) {
    if (cues[i].type === 'beat') { cues[i].level = 'plein'; continue; }
    if (facecamEndCues.has(i)) ambPhase = 'plein';
    cues[i].level = ambPhase;
    ambPhase = ambPhase === 'lit' ? 'plein' : 'lit';
  }
  return cues;
}
// attribue une piste par cue selon les FLAGS usage : cue beat → pool `beat` ; cue
// ambient → pool non-beat, en préférant l'usage qui matche le niveau (plein→présence,
// lit→calme `facecam`). Rotation, jamais 2× d'affilée, couvre le cue sans boucler si possible.
function assignTracks(cues, tracks) {
  const beatPool = tracks.filter((t) => t.usage.includes('beat'));
  const ambPool  = tracks.filter((t) => !t.usage.includes('beat'));
  let kb=0, ka=0, prev=null;
  for (const c of cues) {
    let pool = c.type==='beat' ? beatPool : ambPool;
    if (!pool.length) pool = tracks;                       // repli si un pool est vide
    let ranked = pool;
    if (c.type==='amb') {                                  // préfère l'usage qui colle au niveau
      const want = c.level==='plein' ? 'plein' : 'facecam';
      ranked = [...pool].sort((a,b) => (b.usage.includes(want)?1:0) - (a.usage.includes(want)?1:0));
    }
    const base = c.type==='beat' ? kb : ka;
    let pick = null;
    for (let i=0;i<ranked.length;i++) {
      const cand = ranked[(base+i) % ranked.length];
      if (cand.file === prev) continue;
      if (cand.dur - inPointFor(cand, c.len) >= c.len + XF) { pick = cand; break; }
    }
    if (!pick) pick = ranked.find((t) => t.file !== prev) || ranked[0];
    if (c.type==='beat') kb++; else ka++;
    c.track = pick; c.inPoint = +departPour(pick, c.len).toFixed(2);
    c.swellIn = pick.peak >= c.inPoint && pick.peak <= c.inPoint + c.len;
    prev = pick.file;
  }
  return cues;
}
// ── TIMELINE MIXTE (landscape × facecam) ────────────────────────────────────
// Réponse au « learning ouvert » du 25/07 : quand la timeline combinée existe, on arrête
// le tuilage régulier. DEUX GRILLES, et c'est tout l'intérêt :
//   · la grille des CUES (quel morceau) reste LONGUE (50-120 s, doctrine ambient) mais ses
//     frontières sont SNAPPÉES sur les ruptures réelles du montage → un changement de piste
//     ne tombe jamais au milieu d'un plan ni au milieu d'une phrase.
//   · la grille des NIVEAUX est FINE (un niveau par bloc) → c'est elle qui « fait varier la
//     fixation des niveaux sonores » : voix sous le facecam, plein/lit alterné sur le paysage.
// Sans ce découplage, un bloc facecam de 5,7 s deviendrait un cue de 5,7 s : on changerait de
// morceau toutes les 6 secondes, exactement ce que la doctrine interdit.
const SNAP_TOL = 20;             // on ne déplace pas une frontière de cue de plus de 20 s
// ⚠⚠ 31/08 — « SNAPPÉ SUR UNE FRONTIÈRE DE PLAN » N'EST PAS « SNAPPÉ SUR UNE TRANSITION ».
// Retour du monteur sur le #02 : « la 3ᵉ musique arrive trop soudainement, elle coupe en plein
// milieu de rush ; il faut caler les musiques sur des rushs pour qu'elles accompagnent des
// transitions ». Vérification faite AVANT de corriger : les 5 cues tombaient tous au 0,000 s
// près sur une frontière de plan — le snap fonctionnait. Le défaut était ailleurs : sur 226
// frontières, 166 séparent deux plans paysage de 2 s pris dans la même rafale. Tomber « pile »
// entre deux plans de 2 s, c'est tomber au milieu d'une séquence : rien ne marque le passage,
// donc la musique change sans raison audible. Les cues 4 et 5, que le monteur trouvait justes,
// tombaient eux sur un bloc facecam.
// D'où DEUX niveaux de frontières : les RUPTURES FORTES (entrée et sortie d'un bloc facecam,
// premier plan d'une nouvelle journée) — 60 sur 226 ici — et toutes les autres. On vise une
// rupture forte d'abord ; on ne retombe sur une frontière ordinaire que si aucune n'est à
// portée. Une frontière ordinaire reste préférable au milieu d'un plan.
function snapCuesToStructure(cues, boundaries, fortes = []) {
  const proche = (t, cand) => {
    if (!cand.length) return null;
    const b = cand.reduce((best, x) => Math.abs(x - t) < Math.abs(best - t) ? x : best, cand[0]);
    return Math.abs(b - t) <= SNAP_TOL ? b : null;
  };
  const snap = (t) => {
    const f = proche(t, fortes);                       // une transition que le spectateur VOIT
    if (f !== null) return f;
    const b = proche(t, boundaries);
    return b !== null ? b : t;                         // au-delà, on garde la grille (sinon un cue
  };                                                    // se fait aspirer et tombe sous CUE_MIN
  const out = [];
  let prev = 0;
  for (let i = 0; i < cues.length; i++) {
    const end = i === cues.length - 1 ? cues[i].end : snap(cues[i].end);
    if (end - prev < 1) continue;                      // deux frontières snappées au même point
    out.push({ ...cues[i], start: +prev.toFixed(3), end: +end.toFixed(3), len: +(end - prev).toFixed(3) });
    prev = end;
  }
  return out;
}
// ── DOCTRINE DE NIVEAUX (refondue le 30/07 sur retour du monteur) ────────────────────
// L'ancienne règle alternait `plein`↔`lit` UNE BANDE SUR DEUX. Verdict du monteur sur le
// 1ᵉʳ rendu : « éviter de trop vite alterner entre son / pas de son sur les rushs
// landscape, j'ai l'impression que tu fais un peu au hasard, il faut des tendances
// plus longues ». Le défaut n'était pas le dosage mais la CADENCE : une bande sur deux,
// avec un facecam entre chaque, ça bascule toutes les 15 s sans motif lisible.
//
// La règle est maintenant celle que le monteur a formulée, et elle vaut DANS la bande :
//   « suite à un rush facecam, on a du landscape SANS SON, puis ensuite AVEC SON. »
// Donc chaque bande paysage = une TÊTE muette (la musique reprend la main en sortant de
// la parole) puis une QUEUE sonore (la rue revient et reste). Deux tendances longues par
// bande, toujours dans le même ordre : c'est motivé, donc ça ne s'entend plus comme du
// hasard. Le basculement tombe sur une frontière de PLAN, jamais au milieu d'un plan.
//
// EXCEPTION, et c'est l'autre retour : « (sauf si rush avec ma voix voulu évidemment) ».
// Un plan paysage où le monteur PARLE passe en `voix` — sa voix domine la musique, comme sur un
// facecam. Sur le 1ᵉʳ rendu, R011 (le rayon LAWSON, 22 s) et R028 (le Starbucks, 14,6 s)
// étaient tombés en `lit`/`plein` : la musique passait devant son commentaire alors qu'il
// avait justement gardé ces prises POUR le commentaire. Ces plans sont déclarés par la
// ligne `PARLE` de l'EDL (vlog.txt) et arrivent ici via `piece.parle`.
const HEAD_MUET_PART = 0.40;   // part de la bande passée sans son de rue, en sortie de parole
const HEAD_MUET_MAX  = 12.0;   // …plafonnée : au-delà on prive trop longtemps de l'ambiance
const BANDE_COURTE   = 6.0;    // une bande plus courte n'a pas le temps de tenir deux tendances
function levelsFromStructure(pieces) {
  // 1) regrouper les plans paysage par BANDE (les blocs facecam restent tels quels)
  const groups = [];
  for (const p of pieces) {
    if (p.kind === 'F') { groups.push({ kind: 'F', p }); continue; }
    const last = groups[groups.length - 1];
    if (last && last.kind === 'L' && last.band === p.band) { last.plans.push(p); continue; }
    groups.push({ kind: 'L', band: p.band, plans: [p] });
  }
  // 2) un palier par tendance
  const out = [];
  const push = (start, end, level, tag, band) => {
    const last = out[out.length - 1];
    if (last && last.level === level && Math.abs(last.end - start) < 0.01) { last.end = end; return; }
    out.push({ start, end, level, tag, ...(band !== undefined ? { band } : {}) });
  };
  for (const g of groups) {
    if (g.kind === 'F') { push(g.p.t0, g.p.t1, 'voix', g.p.badge); continue; }
    const bandeDur = g.plans[g.plans.length - 1].t1 - g.plans[0].t0;
    const seuil = Math.min(HEAD_MUET_MAX, bandeDur * HEAD_MUET_PART);
    let cum = 0;
    for (const p of g.plans) {
      // un plan PARLÉ ne suit aucune tendance : la voix passe devant, point.
      if (p.parle) { push(p.t0, p.t1, 'voix', p.badge, g.band); cum += p.dur; continue; }
      // tête muette (musique seule) tant qu'on n'a pas atteint le seuil ; queue sonore ensuite.
      // Une bande courte reste entièrement muette : deux tendances en 5 s = le hasard reproché.
      const level = (bandeDur < BANDE_COURTE || cum < seuil) ? 'plein' : 'lit';
      push(p.t0, p.t1, level, p.badge, g.band);
      cum += p.dur;
    }
  }
  return out;
}
// ── SCISSION IMPOSÉE D'UN CUE (`--impose`) — arbitrage du monteur du 31/08 ───────────
// « un cue qu'on ne sait pas couvrir se SCINDE en deux cues sur deux pistes, il ne se boucle
// pas ». Le vivier ne permet pas d'appliquer la règle partout (10 pistes ambient, une seule
// au-dessus de 2 min 30, cf. MUSIQUE.md), donc la scission se DÉSIGNE au lieu d'être déduite :
// `--impose <sec|mm:ss>:<sous-chaîne de piste>` coupe le cue qui contient cet instant à la
// RUPTURE FORTE la plus proche et pose la piste nommée sur la seconde moitié.
//
// ⚠ La piste est cherchée dans TOUT le vivier, beat compris : la préférence n°3 (cues beat OFF
// par défaut) est une règle d'ATTRIBUTION AUTOMATIQUE, pas une interdiction. Quand le monteur nomme
// une piste, il a déjà tranché — l'outil ne rediscute pas son choix.
// ⚠ Le cue reste de type `amb` : c'est la piste qui change, pas la doctrine de découpe (un cue
// beat serait raccourci à BEAT_LEN et replacé sur le cue le plus paysager).
// Niveau moyen des 6 premières secondes jouées d'une piste (à partir de son in-point). Sert à
// dire si une piste imposée entre en scène audiblement — la COUVERTURE ne dit rien du NIVEAU.
function attaqueDb(track, inPoint = 0) {
  try {
    const raw = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(inPoint), '-t', '6',
      '-i', track.path, '-ac', '1', '-ar', '8000', '-f', 'f32le', '-'],
      { maxBuffer: 1 << 26 });
    const x = new Float32Array(raw.buffer, raw.byteOffset, raw.length >> 2);
    if (!x.length) return 0;
    let acc = 0; for (let i = 0; i < x.length; i++) acc += x[i] * x[i];
    return 20 * Math.log10(Math.sqrt(acc / x.length) + 1e-12);
  } catch { return 0; }          // mesure impossible → on ne crie pas à tort
}
function imposerCues(cues, tracks, spec, boundaries, fortes) {
  if (!spec || spec === true) return cues;
  for (const item of String(spec).split(',').map((s) => s.trim()).filter(Boolean)) {
    const i = item.lastIndexOf(':');
    if (i < 0) throw new Error(`--impose : attendu <sec|mm:ss>:<piste>, reçu « ${item} »`);
    const brut = item.slice(0, i).trim(), motif = item.slice(i + 1).trim();
    const t0 = brut.includes(':')
      ? brut.split(':').reduce((a, b) => a * 60 + parseFloat(b), 0)
      : parseFloat(brut);
    if (!Number.isFinite(t0)) throw new Error(`--impose : instant illisible « ${brut} »`);
    const piste = tracks.find((t) => t.file.includes(motif));
    if (!piste) throw new Error(`--impose : aucune piste ne contient « ${motif} »`);
    // rupture forte la plus proche, repli sur une frontière ordinaire (même doctrine que le snap)
    const near = (cand) => (cand.length
      ? cand.reduce((best, x) => (Math.abs(x - t0) < Math.abs(best - t0) ? x : best), cand[0])
      : null);
    let t = near(fortes);
    if (t === null || Math.abs(t - t0) > SNAP_TOL) t = near(boundaries);
    if (t === null) throw new Error(`--impose : aucune frontière près de ${brut}`);
    const k = cues.findIndex((c) => t > c.start + 1 && t < c.end - 1);
    if (k < 0) throw new Error(`--impose : ${t.toFixed(3)} s ne tombe à l'intérieur d'aucun cue`);
    const c = cues[k];
    const a = { ...c, end: +t.toFixed(3), len: +(t - c.start).toFixed(3) };
    const b = { ...c, start: +t.toFixed(3), len: +(c.end - t).toFixed(3), track: piste };
    for (const x of [a, b]) {
      x.inPoint = +inPointFor(x.track, x.len).toFixed(2);
      x.swellIn = x.track.peak >= x.inPoint && x.track.peak <= x.inPoint + x.len;
    }
    cues.splice(k, 1, a, b);
    // ⚠ 31/08 — UNE PISTE IMPOSÉE PEUT DÉMARRER TROP DOUCEMENT. Le cue de clôture partait sur une
    // tête `plein` (musique seule, son-vidéo à 0,06) et `universfield-mountain-silence` fait
    // −44,7 dBFS sur ses 6 premières secondes : 1,0 s du rendu tombait sous −35 dBFS, un trou.
    // La couverture ne dit rien du NIVEAU D'ATTAQUE — on le mesure et on le dit, à chaque impose.
    const atq = attaqueDb(piste, b.inPoint);
    const co = corpsUtile(piste);
    console.log(`  ⇢ --impose : cue scindé à ${fmt(t)} (demandé ${fmt(t0)}, écart ${(t - t0).toFixed(3)} s) — `
      + `${a.len.toFixed(1)} s sur ${basename(a.track.file)} puis ${b.len.toFixed(1)} s sur ${basename(piste.file)} `
      + `(corps utile ${co.dur.toFixed(1)} s → ${co.dur >= b.len + XF ? 'couvert sans boucle' : '⚠ BOUCLE ENCORE'}`
      + ` · attaque ${atq.toFixed(1)} dBFS${atq < -35 ? ' ⚠ DÉMARRE TROP BAS — trou probable sur une tête `plein`' : ''})`);
  }
  return cues;
}
const BEAT_MIN_PAYSAGE = 0.45;   // sous ce taux de paysage, un cue beat n'a rien à porter
// Attribution SANS RÉPÉTITION tant que le vivier n'est pas épuisé. Le rang dans le vivier suit
// le caractère voulu par le cue : plus il est PAYSAGER, plus on va vers les pistes de présence
// (`plein`, claires, rythmées) ; plus il est PARLÉ, plus on va vers le calme (`lit`/`facecam`).
function assignTracksNoRepeat(cues, tracks) {
  const beatPool = tracks.filter((t) => t.usage.includes('beat'));
  const ambPool = tracks.filter((t) => !t.usage.includes('beat'));
  // ⭐⭐ UN VIVIER SPÉCIALISÉ TROP PETIT REDEVIENT LE VIVIER ENTIER (19/09).
  // Le repli existait déjà — mais sa condition était `!pool.length`, c'est-à-dire le SEUL
  // cas où il ne sert à rien de l'avoir. Mesuré sur le vivier installé par le monteur le 19/09 :
  // `analyzeLibrary` classe 6 des 7 pistes en `beat`, donc le pool ambient en contient UNE.
  // Le repli ne se déclenchait pas (1 ≠ 0), et l'anti-répétition n'a alors plus rien à
  // choisir : la même piste sur les 5 cues — c'est-à-dire précisément « tu mets 2× la même
  // musique », le défaut que toute cette chaîne existe pour éviter.
  // La bonne condition n'est pas « vide » mais « incapable de servir sans se répéter » :
  // il faut au moins autant de pistes que de cues de ce type.
  // *Un repli dont la condition est plus étroite que le défaut ne se déclenche jamais.*
  const nAmb = cues.filter((c) => c.type !== 'beat').length;
  const nBeat = cues.length - nAmb;
  const maigre = (pool, n) => pool.length < n;
  if (nAmb && maigre(ambPool, nAmb)) {
    console.log(`  ⇢ vivier ambient trop maigre (${ambPool.length} piste(s) pour ${nAmb} cues) → `
      + `le vivier ENTIER (${tracks.length}) sert les cues ambient, sinon la même piste reviendrait`);
  }
  if (nBeat && maigre(beatPool, nBeat)) {
    console.log(`  ⇢ vivier beat trop maigre (${beatPool.length} piste(s) pour ${nBeat} cues) → vivier entier`);
  }
  const used = new Set();
  let prev = null;
  for (const c of cues) {
    const n = c.type === 'beat' ? nBeat : nAmb;
    let pool = (c.type === 'beat' ? beatPool : ambPool);
    if (maigre(pool, n)) pool = tracks;
    const want = c.paysage >= 0.5 ? 'plein' : 'facecam';
    // ⚠ la COUVERTURE pèse +6, pas +1 : une piste qui ne tient pas la longueur du cue oblige à
    // boucler, et un tour de boucle s'entend toujours un peu. Elle reste sous l'anti-répétition
    // (−10) : mieux vaut boucler que remettre la piste précédente d'affilée.
    // ⚠ 31/08, 2ᵉ tour — L'ORDRE DES PRIORITÉS COMPTE PLUS QUE LES POIDS. Au 1ᵉʳ essai, la
    // couverture pesait +6 contre une réutilisation à −3 : la seule piste de 4 min 45 a été
    // choisie pour 3 des 5 cues. Couvrir un cue avec une piste DÉJÀ ENTENDUE, c'est troquer un
    // défaut contre le défaut que le monteur signalait justement (« tu mets 2× la même musique »).
    // Ordre retenu, du plus fort au plus faible : ne jamais réentendre une piste du film (−20)
    // > couvrir le cue sans boucler (+6) > coller à l'usage voulu (+2). Le vivier fait 18 pistes
    // pour 5 cues : « jamais deux fois » est toujours tenable, « toujours couvrir » ne l'est pas.
    const score = (t) => (t.usage.includes(want) ? 2 : 0) + (used.has(t.file) ? -20 : 0)
      + (t.file === prev ? -10 : 0)
      + (corpsUtile(t).fin - departPour(t, c.len) >= c.len + XF ? 6 : 0);
    const pick = [...pool].sort((a, b) => score(b) - score(a))[0];
    used.add(pick.file);
    if (used.size >= pool.length) used.clear();          // vivier épuisé → on repart
    c.track = pick; c.inPoint = +inPointFor(pick, c.len).toFixed(2);
    c.swellIn = pick.peak >= c.inPoint && pick.peak <= c.inPoint + c.len;
    prev = pick.file;
  }
  return cues;
}
// expression de gain automatisée, en intervalles MI-OUVERTS : `between()` vaut 1 aux DEUX
// bornes, donc deux intervalles adjacents se chevauchent d'une frame et le gain double.
// ⚠⚠ 31/08 — UNE MARCHE D'ESCALIER DE 16,5 dB S'ENTEND COMME UN ARRÊT DE LA MUSIQUE.
// Retour du monteur sur le #02 : « tu mets 2× la même musique, tu l'arrêtes en fade à R24 et tu la
// reprends à R27 ». Ce n'était PAS un changement de piste (les deux instants sont dans le même
// cue, mesuré) : c'était l'enveloppe. `gainExpr` posait une fonction EN MARCHES —
// `gte(t,début)*lt(t,fin)*valeur` — donc le gain musique sautait de 1,00 à 0,15 en UN
// échantillon à l'entrée d'un bloc facecam, et remontait pareil à la sortie. −16,5 dB
// instantanés puis +16,5 dB instantanés, ça ne s'entend pas comme un ducking : ça s'entend
// comme un arrêt suivi d'un redémarrage. Le #01 avait 15 blocs facecam, le #02 en a 27 : le
// même défaut, deux fois plus souvent, a fini par s'entendre.
//
// LES NIVEAUX NE BOUGENT PAS — ils sont arbitrés par le monteur (voix 0,15/1,00 · lit 0,85/0,45 ·
// plein 1,00/0,06). Ce qui change est la FORME du passage de l'un à l'autre.
//
// L'enveloppe s'écrit comme une somme de RAMPES au lieu d'une somme de marches :
//     v0 + Σ (v_i − v_{i−1}) · clip((t − début_i) / RAMPE, 0, 1)
// La rampe est posée de façon ASYMÉTRIQUE, et c'est voulu : une DESCENTE finit AU point de
// bascule (la musique est déjà baissée quand la première syllabe arrive), une MONTÉE part DU
// point de bascule (l'ambiance ou la musique revient après, jamais par-dessus la fin de phrase).
const RAMPE = 0.50;            // s — durée d'un passage d'un niveau à l'autre
const gainExpr = (spans, key, L = LEVELS) => {
  const v = spans.map((s) => L[s.level][key]);
  const termes = [];
  for (let i = 1; i < spans.length; i++) {
    const d = v[i] - v[i - 1];
    if (Math.abs(d) < 1e-6) continue;                 // même niveau des deux côtés : rien à faire
    // descente → la rampe se termine sur la frontière ; montée → elle y commence.
    const t0 = d < 0 ? spans[i].start - RAMPE : spans[i].start;
    termes.push(`(${d.toFixed(4)})*clip((t-${Math.max(0, t0).toFixed(3)})/${RAMPE},0,1)`);
  }
  return [v[0].toFixed(4), ...termes].join('+');
};

function ff(args) { spawnSync('ffmpeg', ['-y','-v','error',...args], { stdio:['ignore','ignore','inherit'] }); }
function ffOut(args) {
  const r = spawnSync('ffmpeg', ['-v','info',...args], { encoding:'utf8', maxBuffer: 1<<26 });
  return (r.stderr || '') + (r.stdout || '');
}
// LUFS intégré des SEULES zones demandées (aselect les recolle bout à bout avant la mesure).
function lufsOfSpans(wav, spans) {
  if (!spans.length) return null;
  const sel = spans.map((s) => `between(t,${s.start.toFixed(3)},${s.end.toFixed(3)})`).join('+');
  const out = ffOut(['-i', wav, '-af', `aselect='${sel}',asetpts=N/SR/TB,ebur128`, '-f','null','-']);
  const all = out.match(/I:\s*(-?[\d.]+) LUFS/g);
  return all && all.length ? parseFloat(all[all.length-1].match(/(-?[\d.]+)/)[1]) : null;
}

// rendu à DEUX grilles : lit musical monté sur les cues (volume neutre), puis DEUX enveloppes
// de gain (musique et son-vidéo) pilotées par la grille fine des niveaux.
// + ÉQUILIBRAGE MESURÉ : les niveaux du monteur (voix 0,15/1,00 · lit 0,85/0,45 · plein 1,00/0,06)
// ont été arbitrés sur un vlog SANS facecam. Sur une timeline mixte, les bandes portées par la
// musique ressortent 4-5 LU au-dessus de la parole (mesuré sur VLOG #01 : −11,7 vs −16,3) —
// le spectateur monterait le son pour entendre, et se ferait cueillir au montage suivant.
// On mesure donc l'écart réel et on corrige le gain de la VOIX, au lieu de le supposer.
// Fondu de sortie : il court sur la BANDE PAYSAGE DE CLÔTURE, celle qui a le dernier mot
// depuis que le vlog ne finit plus sur du facecam. On la retrouve en remontant les paliers
// non-`voix` depuis la fin. Bornes : moins de 4 s ça claque, plus de 20 s ça se traîne.
function outroDuration(spans, D) {
  let start = D;
  for (let i = spans.length - 1; i >= 0; i--) {
    if (spans[i].level === 'voix') break;
    start = spans[i].start;
  }
  return Math.max(4, Math.min(20, D - start));
}
function renderPlanStructured(video, cues, spans, out, outroOverride) {
  const D = cues[cues.length-1].end;
  // `--outro <s>` : la règle « toute la bande paysage de clôture » ne vaut plus quand le film
  // se termine par un GÉNÉRIQUE. Le fondu doit alors courir sur le générique lui-même, pas
  // remonter dans les plans qui le précèdent (sinon la musique est déjà éteinte quand le
  // carton arrive — l'inverse de « la musique se poursuit jusqu'à cet élément »).
  const OUTRO = outroOverride != null
    ? Math.max(1, Math.min(D, Number(outroOverride)))
    : outroDuration(spans, D);
  console.log(`  fondu de sortie : ${OUTRO.toFixed(1)} s`
    + (outroOverride != null ? ' (imposé par --outro)' : ' (bande paysage de clôture)'));
  const segs = cues.map((c, i) => {
    const seg = join(WORK, `scue_${String(i).padStart(2,'0')}.wav`);
    const besoin = c.len + XF;
    const corps = corpsUtile(c.track);
    const depart = departPour(c.track, c.len);
    const dispo = corps.fin - depart;
    if (dispo >= besoin) {                                // la piste couvre : aucune boucle
      ff(['-ss', depart.toFixed(3), '-i', c.track.path, '-t', besoin.toFixed(3),
          '-ar','48000','-ac','2', seg]);
      c.boucles = 0;
    } else {
      // ⚠ on boucle sur le CORPS UTILE (fades retirés) et on raccorde par acrossfade :
      // `-stream_loop` rejouait le fondu de sortie de la piste puis son fondu d'entrée,
      // ce qui creusait un trou audible au milieu du cue (cf. l'encadré plus haut).
      const tour = join(WORK, `scue_${String(i).padStart(2,'0')}_tour.wav`);
      ff(['-ss', corps.deb.toFixed(3), '-i', c.track.path, '-t', corps.dur.toFixed(3),
          '-ar','48000','-ac','2', tour]);
      let acc = join(WORK, `scue_${String(i).padStart(2,'0')}_a00.wav`);
      ff(['-ss', depart.toFixed(3), '-i', c.track.path,
          '-t', Math.min(dispo, besoin).toFixed(3), '-ar','48000','-ac','2', acc]);
      let longueur = dispo, k = 0;
      while (longueur < besoin && k < 20) {
        const nxt = join(WORK, `scue_${String(i).padStart(2,'0')}_a${String(++k).padStart(2,'0')}.wav`);
        ff(['-i', acc, '-i', tour, '-filter_complex',
            `[0:a][1:a]acrossfade=d=${LOOP_XF}:c1=tri:c2=tri[a]`, '-map','[a]', nxt]);
        acc = nxt; longueur += corps.dur - LOOP_XF;
      }
      ff(['-i', acc, '-af', `atrim=0:${besoin.toFixed(3)}`, '-ar','48000','-ac','2', seg]);
      c.boucles = k;
    }
    return seg;
  });
  const bouclés = cues.filter((c) => c.boucles > 0);
  console.log(`  lit musical : ${cues.length - bouclés.length}/${cues.length} cue(s) couverts par leur piste`
    + (bouclés.length ? ` · ${bouclés.length} bouclé(s) par fondu enchaîné (${LOOP_XF} s)` : ''));
  for (const c of bouclés) {
    const co = corpsUtile(c.track);
    console.log(`    ${c.track.file} : corps utile ${co.dur.toFixed(1)} s pour un cue de ${c.len.toFixed(1)} s`
      + ` → ${c.boucles} raccord(s)`);
  }
  let music = segs[0];
  for (let i=1;i<segs.length;i++) {
    const nxt = join(WORK, `smix_${i}.wav`);
    ff(['-i',music,'-i',segs[i],'-filter_complex',
        `[0:a][1:a]acrossfade=d=${XF}:c1=tri:c2=tri[a]`,'-map','[a]', nxt]);
    music = nxt;
  }
  const bed = join(WORK, 'sbed_neutre.wav');       // lit NEUTRE : réutilisé aux deux passes
  ff(['-i',music,'-af',
      `afade=t=in:st=0:d=${XF},afade=t=out:st=${(D-XF).toFixed(2)}:d=${XF},atrim=0:${D.toFixed(3)}`, bed]);

  const voix = spans.filter((s) => s.level === 'voix');
  const image = spans.filter((s) => s.level !== 'voix');
  const mixWav = join(WORK, 'smix_final.wav');
  const build = (L) => {
    const musicFull = join(WORK, 'smusic_full.wav');
    ff(['-i',bed,'-af',`volume=eval=frame:volume='${gainExpr(spans,'mus',L)}'`, musicFull]);
    const origAuto = join(WORK, 'sorig_auto.wav');
    ff(['-i',video,'-af',`volume=eval=frame:volume='${gainExpr(spans,'org',L)}'`,'-ar','48000','-ac','2', origAuto]);
    // ⚠ le fondu de SORTIE se pose APRÈS le loudnorm — posé avant, la normalisation le
    // remonterait en partie. Il court sur toute la bande paysage de clôture (le monteur 30/07 :
    // « ne pas finir sur du facecam mais landscape avant baisse progressive du son »),
    // pas sur les 1,5 s du crossfade : une coupure nette en fin de film s'entend.
    ff(['-i',musicFull,'-i',origAuto,'-filter_complex',
        `[0:a][1:a]amix=inputs=2:duration=longest:normalize=0[m];`
        + `[m]loudnorm=I=${AMB_LUFS}:TP=${AMB_TP}:LRA=11,alimiter=limit=${AMB_CEIL}:level=disabled,atrim=start=${AMB_LAT},asetpts=N/SR/TB,apad=pad_dur=${AMB_LAT}[n];`
        + `[n]afade=t=out:st=${(D - OUTRO).toFixed(2)}:d=${OUTRO.toFixed(2)}[a]`,
        '-map','[a]', mixWav]);
  };

  let L = LEVELS;
  build(L);
  const lv = lufsOfSpans(mixWav, voix), li = lufsOfSpans(mixWav, image);
  if (lv != null && li != null) {
    const delta = li - lv;                          // > 0 = l'image écrase la parole
    console.log(`  équilibre mesuré : parole ${lv.toFixed(1)} LUFS · image ${li.toFixed(1)} LUFS (écart ${delta >= 0 ? '+' : ''}${delta.toFixed(1)} LU)`);
    if (Math.abs(delta) >= 1) {
      const k = Math.min(2.5, Math.max(0.4, Math.pow(10, delta / 20)));
      L = { ...LEVELS, voix: { mus: LEVELS.voix.mus, org: +(LEVELS.voix.org * k).toFixed(3) } };
      console.log(`  → gain parole ×${k.toFixed(2)} (voix.org ${LEVELS.voix.org} → ${L.voix.org}), 2ᵉ passe`);
      build(L);
      const lv2 = lufsOfSpans(mixWav, voix), li2 = lufsOfSpans(mixWav, image);
      if (lv2 != null && li2 != null) console.log(`  après correction : parole ${lv2.toFixed(1)} · image ${li2.toFixed(1)} (écart ${(li2 - lv2).toFixed(1)} LU)`);
    }
  }
  ff(['-i',video,'-i',mixWav,'-map','0:v','-map','1:a',
      '-c:v','copy','-c:a','aac','-b:a','192k','-ar','48000','-ac','2','-shortest', out]);
  return L;
}

function renderPlan(video, cues, out) {
  const D = cues[cues.length-1].end;
  // 1) segments musique (volume baké), longueur Li+XF pour nourrir les crossfades
  const segs = cues.map((c, i) => {
    const seg = join(WORK, `cue_${String(i).padStart(2,'0')}.wav`);
    ff(['-stream_loop','-1','-ss',c.inPoint.toFixed(3),'-i',c.track.path,
        '-t',(c.len+XF).toFixed(3),'-af',`volume=${LEVELS[c.level].mus}`,
        '-ar','48000','-ac','2', seg]);
    return seg;
  });
  // 2) chaîne acrossfade → lit musical complet, puis fondus de tête/fin + trim à D
  let music = segs[0];
  for (let i=1;i<segs.length;i++) {
    const nxt = join(WORK, `mix_${i}.wav`);
    ff(['-i',music,'-i',segs[i],'-filter_complex',
        `[0:a][1:a]acrossfade=d=${XF}:c1=tri:c2=tri[a]`,'-map','[a]', nxt]);
    music = nxt;
  }
  const musicFull = join(WORK, 'music_full.wav');
  ff(['-i',music,'-af',
      `afade=t=in:st=0:d=${XF},afade=t=out:st=${(D-XF).toFixed(2)}:d=${XF},atrim=0:${D.toFixed(3)}`,
      musicFull]);
  // 3) audio original avec gain automatisé par cue (dominance son-vidéo)
  const expr = cues.map((c) => `between(t,${c.start},${c.end})*${LEVELS[c.level].org}`).join('+');
  const origAuto = join(WORK, 'orig_auto.wav');
  ff(['-i',video,'-af',`volume=eval=frame:volume='${expr}'`,'-ar','48000','-ac','2', origAuto]);
  // 4) mix musique + original, recalé à -14 LUFS
  const mixWav = join(WORK, 'mix_final.wav');
  ff(['-i',musicFull,'-i',origAuto,'-filter_complex',
      `[0:a][1:a]amix=inputs=2:duration=longest:normalize=0[m];[m]loudnorm=I=${AMB_LUFS}:TP=${AMB_TP}:LRA=11,alimiter=limit=${AMB_CEIL}:level=disabled,atrim=start=${AMB_LAT},asetpts=N/SR/TB,apad=pad_dur=${AMB_LAT}[a]`,
      '-map','[a]', mixWav]);
  // 5) mux : vidéo COPIÉE (jamais ré-encodée) + audio mixé
  ff(['-i',video,'-i',mixWav,'-map','0:v','-map','1:a',
      '-c:v','copy','-c:a','aac','-b:a','192k','-ar','48000','-ac','2','-shortest', out]);
}

function cmdPlan(argv) {
  const video = argv._[0];
  if (!video || !existsSync(video)) throw new Error(`vidéo introuvable : ${video}`);
  const D = durationOf(video);
  let tracks = analyzeLibrary(MUSIC);
  // ── `--exclure <sous-chaîne>[,…]` — RETIRER UNE PISTE DU VIVIER, avec sa raison ─────
  // ⭐ POURQUOI (19/09). Le vivier neuf contient `the-eastern-plain-trouble-by-trouble`,
  // qui porte des VOIX chantées (« The ocean, The ocean… ») : posée sous un bloc facecam,
  // elle se superpose à la parole du monteur. C'est le cas `flint-everywhere` du #01.
  // La consigne exacte est « jamais sous un bloc facecam » — mais sur une timeline qui
  // alterne L/F toutes les quelques secondes, un cue de 150 s contient TOUJOURS du facecam :
  // la seule lecture applicable de cette consigne est donc l'exclusion du vivier. On
  // l'écrit et on la chiffre plutôt que de la contourner en silence.
  // ⚠ Le retrait est ANNONCÉ à chaque tour — un vivier amputé sans un mot est indiscernable
  // d'un vivier plus pauvre qu'on croit.
  if (argv.exclure) {
    for (const motif of String(argv.exclure).split(',').map((s) => s.trim()).filter(Boolean)) {
      const av = tracks.length;
      tracks = tracks.filter((t) => !t.file.toLowerCase().includes(motif.toLowerCase()));
      if (tracks.length === av) throw new Error(`--exclure : aucune piste ne contient « ${motif} »`);
      console.log(`  ⇢ --exclure « ${motif} » : ${av - tracks.length} piste(s) retirée(s) du vivier (${tracks.length} restantes)`);
    }
  }
  if (tracks.length < 2) throw new Error('au moins 2 pistes attendues pour varier');
  const beatAvail = tracks.filter((t) => t.usage.includes('beat')).length;
  if (argv.structure) return cmdPlanStructured(argv, video, D, tracks, beatAvail);
  let cues = planCues(D, beatAvail);
  cues = assignIntensity(cues);
  cues = assignTracks(cues, tracks);
  const nBeat = cues.filter((c)=>c.type==='beat').length;
  console.log(`\n♪ Carte musique — ${basename(video)} (${fmt(D)}, ${cues.length} cues : ${cues.length-nBeat} ambient + ${nBeat} beat)\n`);
  for (const c of cues) {
    const tag = c.type==='beat' ? `BEAT·${c.level}` : c.level;
    console.log(`  ${fmt(c.start)}–${fmt(c.end)}  [${tag.toUpperCase().padEnd(10)}]  ` +
      `${c.track.file}  @${fmt(c.inPoint)}  (${c.track.mood.join('+')})${c.swellIn?'  ⟵ swell':''}`);
  }
  console.log('\n♪ LIT MUSICAL — niveau sur la fenêtre RÉELLEMENT jouée de chaque cue');
  refuserSiLitMort(cues);

  writeFileSync(join(REGLAGES,'musique.plan.json'), JSON.stringify(
    { video: basename(video), dur: D, xf: XF,
      cues: cues.map((c)=>({ start:c.start, end:c.end, type:c.type, level:c.level, track:c.track.file, inPoint:c.inPoint, mood:c.track.mood, usage:c.track.usage, swellIn:c.swellIn })) },
    null, 2));
  const out = argv.out || join(outDirFor(video), `${basename(video).replace(/\.mp4$/i,'')} ♪[carte ${cues.length}pistes].mp4`);
  console.log(`\n→ rendu ${basename(out)} …`);
  renderPlan(video, cues, out);
  console.log(`✓ ${basename(out)}`);
}

// `plan --structure <vlog.plan.json>` : la carte musique d'une TIMELINE MIXTE.
// ── LE BEAT EST UNE OPTION, PAS UN DÉFAUT (le monteur 30/07) ────────────────────────────
// La doctrine du 25/07 posait « ~1 cue beat par 3,5 min ». Sur le VLOG #01 ça a placé un
// morceau rythmé à 6:56 (vers R051, le campus du 18/07). Verdict : « je ne veux pas de la
// musique qui commence vers R51, trop dynamique — contraste de rythme trop important ici,
// on reste sur du Dreamscape dark ambiant comme pour les rushs précédents, c'est parfait ».
// Le beat n'est donc plus automatique sur une timeline STRUCTURÉE : un vlog de voyage tient
// sur une seule famille sonore, et un morceau rythmé au milieu s'entend comme une rupture,
// pas comme une relance. Il reste disponible à la demande : `plan --structure … --beat`.
function cmdPlanStructured(argv, video, D, tracks, beatAvail) {
  if (!argv.beat) {
    if (beatAvail) console.log('  (cues beat désactivés — ambient d\'un bout à l\'autre ; `--beat` pour en remettre)');
    beatAvail = 0;
  }
  const plan = JSON.parse(readFileSync(argv.structure, 'utf8'));
  const pieces = plan.pieces;
  const spans = levelsFromStructure(pieces);
  const boundaries = [...new Set(pieces.map((p) => +p.t0.toFixed(3)))].concat([D]).sort((a, b) => a - b);
  // ruptures FORTES : ce qui change de REGISTRE à l'écran — entrée/sortie d'un bloc facecam,
  // et le premier plan d'une nouvelle journée (`origine` = « J24-07 R12 »). Cf. l'encadré
  // « frontière de plan ≠ transition » au-dessus de snapCuesToStructure.
  const fortes = [];
  let jour = null;
  for (const p of pieces) {
    if (p.kind === 'F') { fortes.push(+p.t0.toFixed(3), +(p.t0 + p.dur).toFixed(3)); continue; }
    const j = String(p.origine || '').split(' ')[0];
    if (j && j !== jour) { fortes.push(+p.t0.toFixed(3)); jour = j; }
  }
  let cues = snapCuesToStructure(planCues(D, beatAvail), boundaries,
    [...new Set(fortes)].sort((a, b) => a - b));
  // niveau DOMINANT du cue → sert seulement à choisir la piste (présence vs calme)
  for (const c of cues) {
    const w = { voix: 0, lit: 0, plein: 0 };
    for (const s of spans) w[s.level] += Math.max(0, Math.min(c.end, s.end) - Math.max(c.start, s.start));
    c.paysage = (w.lit + w.plein) / Math.max(0.001, c.end - c.start);   // part de PAYSAGE du cue
    c.level = Object.entries(w).sort((a, b) => b[1] - a[1])[0][0];
    if (c.level === 'voix') c.level = 'lit';           // sous la voix, on veut du calme
  }
  // Le BEAT va là où il y a de l'IMAGE, pas là où il y a de la parole. Sans structure, `plan`
  // place les cues beat au milieu de la timeline (footage-blind, learning ouvert du 25/07) ;
  // ici on sait où est le paysage → on redistribue les mêmes N cues beat sur les cues les plus
  // paysagers, en gardant la règle « jamais en 1er ». Si AUCUN cue n'est assez paysager (vlog
  // très bavard), on n'en met pas : un morceau rythmé sous 60 s de parole n'est pas stratégique.
  const nBeat = cues.filter((c) => c.type === 'beat').length;
  if (nBeat) {
    cues.forEach((c) => { c.type = 'amb'; });
    cues.map((c, i) => ({ c, i })).slice(1)
      .filter((x) => x.c.paysage >= BEAT_MIN_PAYSAGE)
      .sort((a, b) => b.c.paysage - a.c.paysage)
      .slice(0, nBeat)
      .forEach((x) => { x.c.type = 'beat'; });
  }
  // ROTATION SANS RÉPÉTITION : `assignTracks` n'interdit que deux fois d'affilée. Sur 10 cues
  // et une bibliothèque de 17 pistes, ça laissait 3 cues sur le MÊME morceau et 10/10 dans le
  // même mood « sombre » — parce que la préférence par niveau (`facecam` = calme) ne désigne
  // que 4 pistes. Ici on épuise le vivier avant de resservir, et on ouvre la préférence :
  // sous la voix la musique est déjà à 0,15, une piste plus claire n'écrase rien.
  assignTracksNoRepeat(cues, tracks);
  cues = imposerCues(cues, tracks, argv.impose, boundaries, [...new Set(fortes)].sort((a, b) => a - b));

  const nBeatFinal = cues.filter((c) => c.type === 'beat').length;
  console.log(`\n♪ Carte musique STRUCTURÉE — ${basename(video)} (${fmt(D)})`);
  console.log(`  ${cues.length} cues (${cues.length - nBeatFinal} ambient + ${nBeatFinal} beat), `
    + `frontières snappées sur le montage (${new Set(fortes).size} ruptures fortes sur ${boundaries.length} frontières)`);
  for (const c of cues.slice(1)) {
    const p = pieces.find((x) => Math.abs(x.t0 - c.start) < 0.02);
    const q = pieces.find((x) => Math.abs(x.t0 + x.dur - c.start) < 0.02);
    console.log(`    cue à ${Math.floor(c.start/60)}:${(c.start%60).toFixed(2).padStart(5,'0')} → ${p ? `début ${p.badge}` : q ? `fin ${q.badge}` : 'hors frontière'}`
      + `${p && p.kind === 'F' || q && q.kind === 'F' ? '  (rupture forte)' : ''}`);
  }
  console.log(`  ${spans.length} paliers de niveau (grille fine)\n`);
  for (const c of cues) {
    const tag = c.type === 'beat' ? `BEAT` : 'amb';
    console.log(`  ${fmt(c.start)}–${fmt(c.end)}  [${tag.padEnd(4)}]  ${c.track.file}  @${fmt(c.inPoint)}  (${c.track.mood.join('+')})${c.swellIn ? '  ⟵ swell' : ''}`);
  }
  console.log('');
  const tally = spans.reduce((a, s) => (a[s.level] = (a[s.level] || 0) + (s.end - s.start), a), {});
  for (const [k, v] of Object.entries(tally)) console.log(`  niveau ${k.padEnd(6)} : ${fmt(v)} (${(100 * v / D).toFixed(0)} %)`);

  console.log('\n♪ LIT MUSICAL — niveau sur la fenêtre RÉELLEMENT jouée de chaque cue');
  refuserSiLitMort(cues);

  writeFileSync(join(REGLAGES, 'musique.plan.json'), JSON.stringify(
    { video: basename(video), dur: D, xf: XF, structure: argv.structure,
      cues: cues.map((c) => ({ start: c.start, end: c.end, type: c.type, track: c.track.file, inPoint: c.inPoint, mood: c.track.mood, usage: c.track.usage, swellIn: c.swellIn })),
      niveaux: spans }, null, 2));
  const out = argv.out || join(outDirFor(video), `${basename(video).replace(/\.mp4$/i, '')} ♪.mp4`);
  console.log(`\n→ rendu ${basename(out)} …`);
  renderPlanStructured(video, cues, spans, out, argv.outro);
  console.log(`✓ ${basename(out)}`);
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function parseArgv(a) {
  const o = { _: [] };
  for (let i=0;i<a.length;i++){
    if (a[i].startsWith('--')) { const k=a[i].slice(2);
      if (i+1<a.length && !a[i+1].startsWith('--')) o[k]=a[++i]; else o[k]=true; }
    else o._.push(a[i]);
  }
  return o;
}
const [cmd, ...rest] = process.argv.slice(2);
try {
  if (cmd === 'analyze') cmdAnalyze(rest[0]);
  else if (cmd === 'apply') cmdApply(parseArgv(rest));
  else if (cmd === 'plan') cmdPlan(parseArgv(rest));
  else {
    console.log('usage:\n  node musique.mjs analyze [dossier]\n' +
      '  node musique.mjs apply <video.mp4> --track <nom> --in <mm:ss> [--mode speech|bed|bald] [--gain N] [--compare]\n' +
      '  node musique.mjs plan  <vlog.mp4> [--out <chemin>]   # carte multi-pistes auto (cues ~2min30, in-point, intensité au feeling)\n' +
      '  node musique.mjs plan  <vlog.mp4> --structure vlog/vlog.plan.json [--beat]\n' +
      '        # timeline MIXTE landscape×facecam : cues snappés sur le montage + grille fine de niveaux.\n' +
      '        # Par bande paysage : tête MUETTE en sortie de parole puis queue SONORE (tendances longues).\n' +
      '        # Plan paysage marqué PARLE dans l\'EDL → niveau `voix`. Fondu de sortie sur la bande de clôture.\n' +
      '        # --beat : réautorise un cue rythmé (désactivé par défaut, cf. retour le monteur du 30/07).\n' +
      '        # --impose <sec|mm:ss>:<piste>[,…] : scinde le cue qui contient cet instant à la\n' +
      '        #   rupture forte la plus proche et pose la piste NOMMÉE sur la seconde moitié.\n' +
      '        #   La piste est cherchée dans TOUT le vivier, beat compris — quand le monteur nomme un\n' +
      '        #   morceau, il a tranché. Depuis un EDL : ligne `MUSIQUE_IMPOSE …` dans vlog.txt.\n' +
      '        # --outro <s> : impose la durée du fondu de sortie (défaut = toute la bande paysage\n' +
      '        #   de clôture, borné 4-20 s). À utiliser quand le film finit par un GÉNÉRIQUE :\n' +
      '        #   le fondu doit courir SUR le générique, pas remonter dans les plans d\'avant.');
    process.exit(cmd ? 1 : 0);
  }
} catch (e) { console.error('✗', e.message); process.exit(1); }
