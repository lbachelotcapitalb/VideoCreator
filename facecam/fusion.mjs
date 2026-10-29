#!/usr/bin/env node
// fusion.mjs — souder N rendus facecam (un par ville) en UN master + le sujets.json global.
//
// POURQUOI CET OUTIL. `vlog.mjs` ne lit qu'UNE ligne `FACECAM` et un seul `sujets.json` dont
// les bornes sont en SECONDES ABSOLUES du master. Le lot d'août a été rendu ville par ville
// (6 mp4 + 6 `.spans.json`), donc il n'entre pas tel quel dans un épisode mergé. Cet outil
// fait les deux gestes d'un coup : le master soudé, et la table des sujets ré-adressée.
//
//   node facecam/fusion.mjs --v 7 --out VLOG_Chine02_facecam_v1.mp4 \
//        --sujets vlog/sujets-02.json Xiamen Shenzhen Macao HongKong Guangzhou Yangshuo
//
// L'ORDRE DES ARGUMENTS EST L'ORDRE DU MASTER. Il n'engage pas le montage (l'EDL désigne les
// blocs par leur id, pas par leur rang) : il décide seulement dans quel sens les ids F## se
// lisent. On le prend donc dans l'ordre du film, pour qu'un id croissant = un sujet plus tard.
//
// ⚠ LES TROIS PIÈGES DE CONCAT DÉJÀ PAYÉS (vlog.mjs §5, 30-31/07) sont traités ici de la même
// façon, parce que ce sont les mêmes fichiers qui les portent : les 6 rendus de ville ont
// `has_b_frames=2` et `start_time=0,021` — un concat démuxer mp4 `-c copy` réinsérerait ce
// lead-in en trou avant chaque ville. Donc : re-mux en MPEG-TS (qui n'a ni edit list ni
// start_time à propager), `duration` EXPLICITE dans la liste (dérivée du COMPTE D'IMAGES,
// jamais du champ `duration` du conteneur), et audio construit SÉPARÉMENT puis recadré à la
// durée vidéo de chaque ville.
//
// ⚠ Le master sort au fps NATIF des rendus de ville (29,97). Ce n'est pas une entorse au CFR 30
// de la timeline : `vlog.mjs` ré-encode chaque bloc facecam en `fps=30` quand il le découpe.
// Le master facecam est une SOURCE, pas un morceau de timeline (v12 de l'épisode #01 : idem).
//
// GARDE DURE. Chaque borne de sujet doit tomber dans la durée de sa ville, et la somme des
// images des spans doit valoir le compte d'images du fichier. Sinon on s'arrête : un `-ss`
// au-delà de la fin fait sortir ffmpeg avec un code 0 et un mp4 de 695 octets (piège du 31/07).

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { FACECAM } from '../store.mjs';

const sh = (cmd, args) => execFileSync(cmd, args, { maxBuffer: 1 << 28 }).toString();
const probe = (f, entries, stream = 'v:0') => sh('ffprobe', ['-v', 'error',
  '-select_streams', stream, '-show_entries', entries, '-of', 'json', f]);
const hms = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`;

// ---- arguments ----------------------------------------------------------------
const argv = process.argv.slice(2);
const opt = (nom, def = null) => {
  const i = argv.indexOf(`--${nom}`);
  if (i < 0) return def;
  const v = argv[i + 1];
  argv.splice(i, 2);
  return v;
};
const VER = opt('v', '7');
const OUTNAME = opt('out', 'VLOG_Chine02_facecam_v1.mp4');
const SUJETS = opt('sujets', 'vlog/sujets-02.json');
const DRY = argv.includes('--dry') && (argv.splice(argv.indexOf('--dry'), 1), true);
const VILLES = argv.filter((a) => !a.startsWith('--'));
if (!VILLES.length) {
  console.error('usage : node facecam/fusion.mjs [--v 7] [--out …mp4] [--sujets …json] [--dry] <Ville[:version]> <Ville[:version]> …');
  process.exit(2);
}

// ⚠ `new URL(import.meta.url).pathname` rend le chemin PERCENT-ENCODÉ : « Application%20Support ».
// fileURLToPath le décode — sans ça le sujets.json part dans un dossier qui n'existe pas.
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.isAbsolute(OUTNAME) ? OUTNAME : path.join(FACECAM, OUTNAME);
const SUJ = path.isAbsolute(SUJETS) ? SUJETS : path.join(REPO, SUJETS);
const WORK = path.join(REPO, 'vlog', 'work', 'fusion');

// ---- 1) inventaire + gardes ----------------------------------------------------
// On lit le COMPTE D'IMAGES (nb_read_packets) et le fps natif : la durée d'une ville est
// images/fps, jamais le champ `duration` du conteneur (il ment d'une image selon le format).
// ⚠ 31/08 — la version se surcharge PAR VILLE : `Yangshuo:8`. Une correction de borne ne
// touche qu'une ville, et on ne va pas re-rendre les cinq autres (≈8 min chacune) pour lui
// faire rattraper un numéro de version. Sans ça, la seule issue était d'ÉCRASER le v7 de
// la ville corrigée — c'est-à-dire de détruire la version de référence pour en poser une neuve.
const parts = VILLES.map((arg) => {
  const [ville, verVille] = arg.split(':');
  const mp4 = path.join(FACECAM, `VLOG_${ville}_facecam_v${verVille || VER}.mp4`);
  const sj = mp4.replace(/\.mp4$/, '.spans.json');
  for (const f of [mp4, sj]) if (!fs.existsSync(f)) throw new Error(`${ville} : ${path.basename(f)} introuvable`);
  const st = JSON.parse(probe(mp4, 'stream=r_frame_rate')).streams[0];
  const [n, d] = String(st.r_frame_rate).split('/').map(Number);
  const fps = d ? n / d : n;
  const frames = Number(JSON.parse(sh('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-count_packets', '-show_entries', 'stream=nb_read_packets', '-of', 'json', mp4])).streams[0].nb_read_packets);
  const spans = JSON.parse(fs.readFileSync(sj, 'utf8'));

  // garde 1 : le manifeste décrit-il bien CE fichier ? (un rendu plus récent l'aurait périmé)
  const somme = spans.spans.reduce((a, s) => a + s.frames, 0);
  if (somme !== frames || spans.total_frames !== frames) {
    throw new Error(`${ville} : le manifeste dit ${spans.total_frames} images (Σ spans ${somme}), `
      + `le fichier en compte ${frames} — spans.json périmé, re-rendre avant de fusionner`);
  }
  return { ville, mp4, fps, frames, spans: spans.spans, dur: frames / fps };
});

let cumul = 0, n = 0;
const sujets = [];
for (const p of parts) {
  for (const s of p.spans) {
    // garde 2 : la borne tombe-t-elle DANS la ville ? (un -ss au-delà sort en code 0)
    if (s.offset + s.frames > p.frames) {
      throw new Error(`${p.ville}/${s.label} : ${s.offset + s.frames} images demandées sur ${p.frames}`);
    }
    const a = (cumul + s.offset) / p.fps;
    sujets.push({
      id: `F${String(++n).padStart(2, '0')}`,
      label: `${p.ville.toLowerCase()}-${s.label}`,
      ville: p.ville,
      a: Number(a.toFixed(3)),
      b: Number((a + s.frames / p.fps).toFixed(3)),
      dur: Number((s.frames / p.fps).toFixed(3)),
    });
  }
  cumul += p.frames;
}

console.log('══════ FUSION FACECAM ══════');
for (const p of parts) console.log(`  ${p.ville.padEnd(11)} ${String(p.frames).padStart(5)} img · ${hms(p.dur).padStart(7)} · ${p.spans.length} sujets`);
console.log(`  ${'TOTAL'.padEnd(11)} ${String(cumul).padStart(5)} img · ${hms(cumul / parts[0].fps).padStart(7)} · ${sujets.length} sujets`);
console.log(`  master → ${OUT}`);
console.log(`  sujets → ${SUJ}`);
if (DRY) { console.log('\n(--dry : rien écrit)'); process.exit(0); }

// ---- 2) vidéo : re-mux TS puis concat avec durées explicites --------------------
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });
const ts = parts.map((p, i) => {
  const o = path.join(WORK, `${String(i).padStart(2, '0')}.ts`);
  sh('ffmpeg', ['-y', '-v', 'error', '-i', p.mp4, '-map', '0:v:0', '-c', 'copy',
    '-bsf:v', 'h264_mp4toannexb', '-f', 'mpegts', o]);
  return o;
});
const liste = path.join(WORK, 'concat.txt');
fs.writeFileSync(liste, ts.map((f, i) =>
  `file '${f.replace(/'/g, "'\\''")}'\nduration ${(parts[i].frames / parts[i].fps).toFixed(6)}`).join('\n') + '\n');
const v = path.join(WORK, '_v.mp4');
sh('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', liste, '-c', 'copy', '-an',
  '-video_track_timescale', '15360', v]);

// ---- 3) audio : recadré à la durée VIDÉO de chaque ville ------------------------
// (le démuxer ferait avancer les deux flux indépendamment — dérive mesurée sur le #01)
const a = path.join(WORK, '_a.m4a');
{
  const args = ['-y', '-v', 'error'];
  parts.forEach((p) => args.push('-i', p.mp4));
  const fc = parts.map((p, k) =>
    `[${k}:a]aresample=48000:async=1,apad,atrim=0:${p.dur.toFixed(6)},asetpts=N/SR/TB[a${k}]`).join(';')
    + ';' + parts.map((_, k) => `[a${k}]`).join('') + `concat=n=${parts.length}:v=0:a=1[out]`;
  args.push('-filter_complex', fc, '-map', '[out]', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', a);
  sh('ffmpeg', args);
}

// ---- 4) mux + preuve MESURÉE (pas le code retour) -------------------------------
sh('ffmpeg', ['-y', '-v', 'error', '-i', v, '-i', a, '-map', '0:v:0', '-map', '1:a:0',
  '-c', 'copy', '-movflags', '+faststart', OUT]);

const outFrames = Number(JSON.parse(sh('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
  '-count_packets', '-show_entries', 'stream=nb_read_packets', '-of', 'json', OUT])).streams[0].nb_read_packets);
const dv = Number(JSON.parse(probe(OUT, 'stream=duration')).streams[0].duration);
const da = Number(JSON.parse(probe(OUT, 'stream=duration', 'a:0')).streams[0].duration);
const st0 = JSON.parse(probe(OUT, 'stream=start_time')).streams[0].start_time;

fs.mkdirSync(path.dirname(SUJ), { recursive: true });
fs.writeFileSync(SUJ, JSON.stringify(sujets, null, 1) + '\n');

console.log('\n· images   : ' + outFrames + ' attendues ' + cumul + (outFrames === cumul ? '  ✅' : '  ❌'));
console.log('· vidéo    : ' + hms(dv) + ' · audio ' + hms(da) + ' · dérive A/V ' + ((da - dv) * 1000).toFixed(0) + ' ms');
console.log('· start_time vidéo : ' + st0 + (Number(st0) === 0 ? '  ✅' : '  ⚠ le concat a réinséré un lead-in'));
console.log('· dernier sujet    : ' + sujets.at(-1).id + ' → ' + sujets.at(-1).b.toFixed(3) + ' s / ' + (cumul / parts[0].fps).toFixed(3) + ' s');

// ⚠⚠ 31/08 — L'HORLOGE DU MASTER SE MESURE, elle aussi. Les trois contrôles ci-dessus (compte
// d'images, dérive A/V, start_time) étaient TOUS au vert sur le master du #02, et ce master
// était pourtant inutilisable pour une découpe à la seconde : ses pts prenaient jusqu'à
// 3,0 images d'avance sur l'index (les rendus de ville sont VFR, leur pts dérive à chaque
// raccord de prise) et RECULAIENT à chaque jonction de ville (le concat y remet l'offset à la
// durée exacte en images). `vlog.mjs` ouvrait donc ses blocs 1 à 3 images trop tôt, sur la
// queue de la prise précédente : « un rush inutile pendant quelques centièmes » (le monteur, 30/08).
// Un compte d'images juste ne dit RIEN sur la place de ces images dans le temps.
// `vlog.mjs` découpe désormais par index d'image et n'en dépend plus — mais un master dont
// l'horloge ment reste un piège pour le prochain outil qui l'adressera en secondes. On le dit.
const pts = sh('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
  // ⚠ `-of csv=p=0` laisse une VIRGULE en fin de ligne : `Number('0.000000,')` vaut NaN, et
  // toute comparaison avec NaN étant fausse, le contrôle se serait déclaré vert sans rien lire.
  'frame=pts_time', '-of', 'csv=p=0', OUT]).trim().split('\n').map((l) => parseFloat(l));
const F = 1 / parts[0].fps;
let ecartMax = 0, reculs = 0;
for (let i = 0; i < pts.length; i++) {
  ecartMax = Math.max(ecartMax, Math.abs(pts[i] - i * F) / F);
  if (i && pts[i] <= pts[i - 1]) reculs++;
}
const horlogeOk = ecartMax < 0.6 && reculs === 0;
console.log('· horloge  : écart index↔pts ' + ecartMax.toFixed(2) + ' image · ' + reculs + ' recul(s) de pts'
  + (horlogeOk ? '  ✅' : '  ⚠ master VFR — ne l\'adresser QU\'en index d\'image, jamais en secondes'));

if (outFrames !== cumul || Math.abs(da - dv) > 0.10) { console.log('\n❌ à investiguer AVANT de monter'); process.exit(1); }
console.log('\n✅ terminé');
