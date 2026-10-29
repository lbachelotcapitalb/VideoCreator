#!/usr/bin/env node
// ============================================================================
// facecam/overlays/coller-generique.mjs — COLLER LE GÉNÉRIQUE SANS RE-RENDRE LE FILM,
//                                          ET SANS LE LAISSER TOMBER DANS LE SILENCE
//
// POURQUOI CE FICHIER EXISTE (20/09). le monteur a demandé « un générique de fin comme à l'épisode 1
// et 2 ». Aux #01 et #02 il avait été livré ISOLÉ dans `Éléments/`, donc j'ai livré isolé — et
// il a répondu « je vois pas le générique de fin demandé ? ». **Un générique de FIN est à la fin
// du FILM** ; « comme aux épisodes 1 et 2 » portait sur la FORME du générique (le tracé, le code
// couleur), pas sur son mode de livraison. *Quand une consigne cite un précédent, elle cite ce
// qui était VISIBLE dedans, pas les décisions d'intendance qui l'entouraient.*
//
// ⚠️ ET LA VRAIE FAUTE EST EN AMONT : `vlog.mjs` SAIT DÉJÀ FAIRE ÇA depuis le #01 — directive
// `GENERIQUE <fichier>` dans l'EDL, plus `OUTRO <s>` pour que le fondu musical MEURE SUR le
// générique au lieu de mourir avant. J'ai tranché « livré isolé » en invoquant le coût d'un
// re-rendu, sans lire la capacité qui existait. *Avant d'annoncer qu'une capacité manque, lire
// le code qui la porterait* — écrit dans SKILL.md depuis le 29/07.
//
// ALORS POURQUOI CE SCRIPT PLUTÔT QUE `vlog.mjs` ? Parce qu'ici le re-rendu est INTERDIT : le
// `OUT` de l'EDL pointe sur `(master 20-09).mp4`, que le monteur a explicitement protégé, et le master
// livré est DÉJÀ prouvé (gate passée, sous-titres brûlés). Re-rendre pour ajouter 12 s de carton
// jetterait une preuve pour en refabriquer une identique. Ce script fait donc le collage en
// COPIE DE FLUX — le film n'est pas ré-encodé d'une seule image.
//   → Au PROCHAIN épisode, la bonne voie reste `GENERIQUE` + `OUTRO` dans l'EDL, en amont.
//     Celle-ci est la voie de RATTRAPAGE sur un master déjà prouvé.
//
// ⭐ LE SILENCE EST LE VRAI PIÈGE, et il ne se voit pas sur le papier. Un générique à piste
// muette collé derrière un film dont la musique vient de se fondre donne **12 s de silence
// complet** sur le carton final. Mesuré sur l'EP3 : le film joue encore à −23 dBFS à 12:18 et
// ne fond que sur ses 1,5 dernières secondes. On PROLONGE donc la piste du dernier cue, qui
// avait encore 22,1 s devant elle, et le fondu meurt sur le générique — ce que `OUTRO` aurait
// fait. *Coller deux objets corrects peut fabriquer un défaut qui n'est dans aucun des deux.*
//
// ⛔ CE QU'IL REFUSE, parce qu'un collage silencieux est indiscernable d'un collage réussi :
//   · les flux ne correspondent pas au caractère près (codec, dimensions, pix_fmt, fps, audio)
//     → une copie de flux produirait un fichier illisible ou désynchronisé ;
//   · la piste musicale n'a pas assez de matière restante pour couvrir le générique ;
//   · la durée de sortie ne vaut pas EXACTEMENT master + générique ;
//   · un creux apparaît au raccord (mesuré après coup, sur le fichier RENDU).
//
// Usage :
//   node facecam/overlays/coller-generique.mjs <master.mp4> <generique.mp4> --out <f.mp4>
//        --musique <piste.mp3> --raccord-a <s_film> --piste-au-raccord <s_piste>
//        [--fondu 2.5] [--xf 0.5] [--gain auto|<dB>]
//
// `--raccord-a` : l'instant du FILM où l'on quitte le mixage d'origine (choisir juste AVANT
//                 que son fondu de sortie commence).
// `--piste-au-raccord` : l'instant de LA PISTE qui joue à cet instant-là. Les deux ensemble
//                 disent comment la musique se prolonge sans saut de phase.
// ============================================================================

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const a = process.argv.slice(2);
const opt = (k, d = null) => { const i = a.indexOf(k); return i >= 0 && a[i + 1] ? a[i + 1] : d; };
const libres = a.filter((x, i) => !x.startsWith('--') && !(i > 0 && a[i - 1].startsWith('--')));
const [master, generique] = libres;
const out = opt('--out', null);
const musique = opt('--musique', null);
const raccordA = Number(opt('--raccord-a', NaN));
const pisteAu = Number(opt('--piste-au-raccord', NaN));
const FONDU = Number(opt('--fondu', 2.5));
const XF = Number(opt('--xf', 0.5));
const gainOpt = opt('--gain', 'auto');

if (!master || !generique || !out || !musique || !Number.isFinite(raccordA) || !Number.isFinite(pisteAu)) {
  console.error('usage: coller-generique.mjs <master.mp4> <generique.mp4> --out <f.mp4> --musique <p.mp3> --raccord-a <s> --piste-au-raccord <s>');
  process.exit(1);
}
for (const f of [master, generique, musique]) {
  if (!fs.existsSync(f)) { console.error(`⛔ introuvable : ${f}`); process.exit(1); }
}

const probe = (f, sel, ent) => execFileSync('ffprobe',
  ['-v', 'error', '-select_streams', sel, '-show_entries', `stream=${ent}`, '-of', 'csv=p=0', f],
  { encoding: 'utf8' }).trim().split('\n')[0];
const dur = (f) => Number(execFileSync('ffprobe',
  ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' }).trim());

// ── ① LES FLUX DOIVENT CORRESPONDRE ────────────────────────────────────────────────────
const CLES_V = 'codec_name,profile,width,height,pix_fmt,avg_frame_rate';
const CLES_A = 'codec_name,profile,sample_rate,channels';
const vM = probe(master, 'v:0', CLES_V), vG = probe(generique, 'v:0', CLES_V);
const aM = probe(master, 'a:0', CLES_A), aG = probe(generique, 'a:0', CLES_A);
console.log('\n══════ COLLAGE DU GÉNÉRIQUE ══════\n');
console.log('  ① flux — une copie ne pardonne aucun écart');
console.log(`     master    v: ${vM}\n               a: ${aM}`);
console.log(`     générique v: ${vG}\n               a: ${aG}`);
if (vM !== vG || aM !== aG) {
  console.error('\n⛔ LES FLUX DIFFÈRENT — une copie produirait un fichier illisible ou désynchronisé.');
  console.error('   Re-rendre le générique avec les mêmes paramètres (generique-mp4.mjs suit la définition du store).');
  process.exit(1);
}
console.log('     ✅ identiques');

const Dm = dur(master), Dg = dur(generique), Dt = dur(musique);
const CUT = Dm - raccordA;                       // durée du mixage d'origine qu'on remplace
const Bdur = CUT + Dg;                           // ce que la piste doit fournir
console.log(`\n  ② durées — master ${Dm.toFixed(3)} s · générique ${Dg.toFixed(3)} s · total attendu ${(Dm + Dg).toFixed(3)} s`);
console.log(`     raccord à ${raccordA.toFixed(2)} s du film = ${pisteAu.toFixed(2)} s de la piste`);
console.log(`     la piste doit fournir ${Bdur.toFixed(2)} s à partir de ${pisteAu.toFixed(2)} s`);
if (pisteAu + Bdur > Dt) {
  console.error(`\n⛔ PISTE TROP COURTE : il faudrait ${(pisteAu + Bdur).toFixed(2)} s, elle en fait ${Dt.toFixed(2)}.`);
  console.error('   Choisir une autre piste, ou reculer --raccord-a.');
  process.exit(1);
}
console.log(`     ✅ piste de ${Dt.toFixed(1)} s, il reste ${(Dt - pisteAu - Bdur).toFixed(2)} s de marge`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coller-'));
const ff = (args) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });

// ── ③ LE GAIN SE MESURE, il ne se devine pas ───────────────────────────────────────────
function rmsDb(file, ss, t) {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(ss), '-t', String(t),
    '-i', file, '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'], { maxBuffer: 1 << 26 });
  const x = new Float32Array(raw.buffer, raw.byteOffset, raw.length >> 2);
  let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return 20 * Math.log10(Math.sqrt(s / Math.max(1, x.length)) + 1e-12);
}
let gain;
if (gainOpt === 'auto') {
  const nF = rmsDb(master, raccordA - 2, 2), nP = rmsDb(musique, pisteAu - 2, 2);
  gain = nF - nP;
  console.log(`\n  ③ gain — film ${nF.toFixed(1)} dBFS vs piste brute ${nP.toFixed(1)} dBFS  →  ${gain >= 0 ? '+' : ''}${gain.toFixed(2)} dB`);
} else {
  gain = Number(gainOpt);
  console.log(`\n  ③ gain imposé : ${gain >= 0 ? '+' : ''}${gain.toFixed(2)} dB`);
}

// ── ④ VIDÉO : concat en COPIE, pas une image ré-encodée ────────────────────────────────
// ⚠️ LE CONCAT DÉMUXEUR DÉCALE L'ORIGINE TANT QUE LES SOURCES PORTENT LEUR AUDIO (20/09).
// Les deux fichiers démarrent à `start_pts=0` ; leur concat démarre à **323** ticks de 1/15360,
// soit 21 ms — qui n'est même pas une frontière d'image (une image = 512 ticks). Or `gate.py`
// refuse un `start_time` non nul, et à raison : *un segment qui démarre à 0,033 s se traduit
// par un trou inséré au concat* (30/07). La cause : l'audio du master finit 14,6 ms AVANT sa
// vidéo, et le démuxeur aligne le second segment sur le flux le plus long.
// Essayés et RÉFUTÉS : `-avoid_negative_ts make_zero` (0,066 s — pire), `-avoid_negative_ts
// disabled`, `-muxdelay 0 -muxpreload 0`, `-fflags +genpts`, et `-an` sur le CONCAT (le
// démuxeur lit quand même l'audio des sources pour poser ses frontières) — tous laissent 323.
// ⛔ Et le détour par du H.264 brut, qui remettait bien l'origine à 0, FABRIQUAIT UN DÉFAUT
//    PIRE : les DTS ne se réordonnent plus à la jonction des deux GOP (2 erreurs de décodage,
//    2 images perdues, gate refusée). *Corriger un défaut en en recréant un autre n'est pas
//    corriger* — c'est la leçon du 31/08 sur les bornes de F36, repayée ici.
// Ce qui marche : retirer l'audio des DEUX sources AVANT le concat, et rester en mp4.
// Aucune image n'est ré-encodée — `-c:v copy` partout.
const mv = path.join(tmp, 'm_v.mp4'), gv = path.join(tmp, 'g_v.mp4'), colle = path.join(tmp, 'colle.mp4');
console.log('\n  ④ concat vidéo en copie de flux (audio retiré des sources AVANT) …');
ff(['-i', master, '-an', '-c:v', 'copy', mv]);
ff(['-i', generique, '-an', '-c:v', 'copy', gv]);
const liste = path.join(tmp, 'l.txt');
fs.writeFileSync(liste, [mv, gv].map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n') + '\n');
ff(['-f', 'concat', '-safe', '0', '-i', liste, '-c:v', 'copy', colle]);

// ── ⑤ AUDIO : le mixage d'origine, puis la piste qui CONTINUE, puis le fondu ───────────
// acrossfade : sortie = Adur + Bdur − XF. On pose Adur = raccordA + XF pour que le
// fondu croisé porte sur [raccordA, raccordA+XF] des DEUX côtés — donc sans saut de phase,
// puisque B[0] correspond, par construction, à l'instant `raccordA` du film.
const audio = path.join(tmp, 'a.wav');
console.log('  ⑤ audio : mixage d\'origine → la piste continue → fondu …');
ff(['-i', master, '-ss', String(pisteAu), '-t', String(Bdur + XF), '-i', musique,
  '-filter_complex',
  `[0:a]atrim=0:${(raccordA + XF).toFixed(3)},asetpts=N/SR/TB[A];`
  + `[1:a]volume=${gain.toFixed(2)}dB,atrim=0:${(Bdur + XF).toFixed(3)},asetpts=N/SR/TB[B];`
  + `[A][B]acrossfade=d=${XF}:c1=tri:c2=tri[M];`
  // ⚠️ le fondu MEURT 0,30 s AVANT la fin. Un afade qui court jusqu'au dernier échantillon
  // laisse la dernière demi-seconde à −37,6 dBFS (mesuré, gate REFUSÉE) : l'oreille et la
  // gate attendent un vrai noir sonore, pas une rampe encore audible. Après la fin du fondu,
  // afade tient le gain à 0 — donc ces 0,30 s sont du silence numérique.
  + `[M]afade=t=out:st=${(Dm + Dg - FONDU).toFixed(3)}:d=${(FONDU - 0.30).toFixed(3)}[o]`,
  '-map', '[o]', '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s24le', audio]);

console.log('  ⑥ remux — vidéo copiée, audio ré-encodé …');
ff(['-i', colle, '-i', audio, '-map', '0:v:0', '-map', '1:a:0',
  '-c:v', 'copy', '-c:a', 'aac', '-b:a', '200k', '-movflags', '+faststart', '-shortest', out]);

// ── ⑦ LA PREUVE SE PREND SUR LE FICHIER RENDU ──────────────────────────────────────────
const Do = dur(out);
const attendu = Dm + Dg;
console.log(`\n  ⑦ preuve, sur le fichier RENDU`);
console.log(`     durée   ${Do.toFixed(3)} s  (attendu ${attendu.toFixed(3)} s, écart ${((Do - attendu) * 1000).toFixed(0)} ms)`);
const nImg = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
  '-count_packets', '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0', out], { encoding: 'utf8' }).trim();
console.log(`     images  ${nImg}`);
let ok = Math.abs(Do - attendu) < 0.100;
if (!ok) console.error('     ⛔ la durée ne vaut pas master + générique');
// ⚠️ CES DEUX AXES-CI ONT ÉTÉ AJOUTÉS APRÈS COUP, parce que ma première version a imprimé
// « ✅ COLLÉ ET PROUVÉ » sur un fichier que `gate.py` a ensuite REFUSÉ sur les deux. Une preuve
// qui ne regarde que ce à quoi on a pensé n'est pas une preuve — elle est la liste de mes
// hypothèses. *Un critère vert ne couvre que la dimension qu'il regarde.*
const sp = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
  '-show_entries', 'stream=start_pts,start_time', '-of', 'csv=p=0', out], { encoding: 'utf8' }).trim();
const [spts] = sp.split(',');
console.log(`     origine start_pts=${spts}  (le concat démuxeur y laisse 323 si on ne repasse pas par le H.264 brut)`);
if (Number(spts) !== 0) { console.error('     ⛔ start_time non nul — gate.py refusera, et un trou s\'insère au concat'); ok = false; }
const finDb = rmsDb(out, Do - 0.5, 0.5);
console.log(`     dernière demi-seconde ${finDb.toFixed(1)} dBFS`);
if (finDb > -42) { console.error('     ⛔ le fondu de sortie ne descend pas assez — gate.py demande un vrai noir sonore'); ok = false; }
// ⛔ ET LE DÉCODAGE INTÉGRAL, parce que c'est le SEUL axe qui a vu le mauvais remède. Le détour
// par le H.264 brut passait la durée, l'origine ET le fondu ; il cassait les DTS à la jonction,
// ce qu'aucun contrôle de forme ne pouvait montrer. *Un fichier de la bonne taille avec le bon
// nombre d'images peut être illisible* (01/09).
const errs = (() => { try {
  execFileSync('ffmpeg', ['-v', 'error', '-i', out, '-f', 'null', '-'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return '';
} catch (e) { return String(e.stderr || ''); } })();
const nErr = errs.trim() ? errs.trim().split('\n').length : 0;
console.log(`     décodage intégral ${nErr} erreur(s)`);
if (nErr) { console.error(errs.trim().split('\n').slice(0, 3).map((l) => '       ' + l).join('\n')); ok = false; }
// creux au raccord ET sur le générique : c'est le défaut que ce script existe pour éviter
console.log('     RMS par seconde autour du raccord et sur le générique :');
let creux = 0;
for (let t = Math.floor(raccordA) - 3; t < Math.floor(attendu); t++) {
  const v = rmsDb(out, t, 1);
  const zone = t >= Dm ? 'générique' : 'film';
  if (v < -35) creux++;
  console.log(`       ${Math.floor(t / 60)}:${String((t % 60)).padStart(2, '0')}  ${v.toFixed(1).padStart(6)} dBFS  ${zone}${v < -35 ? '   ⛔ creux' : ''}`);
}
if (creux > Math.ceil(FONDU)) { console.error(`\n⛔ ${creux} seconde(s) sous −35 dBFS — plus que le fondu de ${FONDU} s ne l'explique.`); ok = false; }
console.log(ok ? '\n══════ ✅ COLLÉ ET PROUVÉ ══════' : '\n══════ ⛔ REFUSÉ ══════');
if (!ok) { try { fs.unlinkSync(out); } catch {} }   // ne pas laisser un livrable non prouvé
process.exit(ok ? 0 : 1);
