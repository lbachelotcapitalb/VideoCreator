// facecam/lib.mjs — briques partagées Fast Facecam (100% local/offline)
import fs from 'fs';
import { execSync } from 'child_process';
import { INBOX_FACECAM, MODEL_SMALL } from '../store.mjs';   // chemins du moteur et du store : un seul endroit

export const MODEL = MODEL_SMALL;

export function sh(cmd) { return execSync(cmd, { maxBuffer: 1 << 28 }).toString(); }

// Inbox facecam canonique (cf. ARBO.md). Une carte/EDL écrite AVANT une réorganisation du
// store garde un `rushDir` périmé (ex. l'ancien « facecamrush ») → ENOENT au chargement.
// resolveRushDir retombe alors sur l'inbox. Si le chemin existe : comportement INCHANGÉ.
export const FACECAM_INBOX = INBOX_FACECAM;
export function resolveRushDir(dir) {
  if (dir && fs.existsSync(dir)) return dir;
  if (fs.existsSync(FACECAM_INBOX)) {
    if (dir) console.error(`⚠ rushDir périmé (${dir}) → repli sur l'inbox facecam`);
    return FACECAM_INBOX;
  }
  throw new Error(`rushDir introuvable : ${dir}`);
}

export function probeDur(file) {
  return parseFloat(sh(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${file}"`).trim());
}

// liste triée des rushs d'un dossier -> [{id:'c1', file, name}]
// Ignore les rendus/exports pour que les ids c1..cN restent stables (on ne scanne QUE les rushs).
const IGNORE = /vlog|merged|render|_final|_v\d|facecam_out/i;
export function listClips(rushDir) {
  const files = fs.readdirSync(rushDir)
    .filter(f => /\.(mp4|mov|m4v)$/i.test(f) && !IGNORE.test(f))
    .sort();
  return files.map((f, i) => ({ id: `c${i + 1}`, name: f.replace(/\.[^.]+$/, ''), file: `${rushDir}/${f}` }));
}

// silencedetect -> [{s,e,d}] (temps ABSOLUS si -ss non utilisé, sinon relatifs au -ss)
export function detectSilences(file, { noise = '-30dB', d = 1.2, ss = null, to = null } = {}) {
  const seek = ss != null ? `-ss ${ss} ` : '';
  const end = to != null ? `-to ${to} ` : '';
  // -vn : silencedetect ne mesure QUE l'audio ; sans ça ffmpeg décode la vidéo 4K
  // entière (très lent sur un rush de 8 min). Les timestamps de silence sont
  // identiques -> le rendu ne change pas, seule la vitesse (×N).
  const out = execSync(
    `ffmpeg -hide_banner -nostats ${seek}${end}-i "${file}" -vn -af "silencedetect=noise=${noise}:d=${d}" -f null - 2>&1`,
    { maxBuffer: 1 << 28 }).toString();
  const spans = []; let cur = null;
  for (const line of out.split('\n')) {
    let m = line.match(/silence_start:\s*(-?[\d.]+)/); if (m) cur = { s: Math.max(0, parseFloat(m[1])) };
    m = line.match(/silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/);
    if (m && cur) { cur.e = parseFloat(m[1]); cur.d = parseFloat(m[2]); spans.push(cur); cur = null; }
  }
  return spans;
}

// îlots de parole = complément des silences >= gap
export function speechIslands(file, { gap = 1.2, minDur = 0.7 } = {}) {
  const dur = probeDur(file);
  const seps = detectSilences(file, { d: gap }).filter(s => (s.e - s.s) >= gap);
  const isl = []; let pos = 0;
  for (const s of seps) { if (s.s > pos + 0.05) isl.push({ a: pos, b: s.s }); pos = Math.max(pos, s.e); }
  if (dur > pos + 0.05) isl.push({ a: pos, b: dur });
  return isl.filter(i => (i.b - i.a) >= minDur);
}

export function fmt(s) { const m = Math.floor(s / 60); return m + ':' + (s % 60).toFixed(2).padStart(5, '0'); }

// ⭐ LE test « cette borne coupe-t-elle un mot ? » — UNE SEULE définition (05/09).
// Il existait en DEUX exemplaires qui ne disaient pas pareil : sweep.mjs (silencedetect
// d=0.08, « la borne tombe dans un silence ») et le garde parole (d=0.10 + proximité
// d'une frontière). Résultat : deux bornes posées et VALIDÉES par sweep étaient déclarées
// fautives par le garde. Quand deux outils mesurent la même grandeur et se contredisent,
// l'un des deux ment — et on ne le saura jamais tant que la règle vit en deux endroits.
// Règle unique : la borne doit tomber DANS un silence mesuré, à TOL près. La tolérance
// absorbe le lead/tail que refine pose volontairement (0,02–0,08 s de part et d'autre) ;
// au-delà, la borne est dans la parole et le mot est amputé — ce qui reste LISIBLE au
// texte (« dynasties » rogné de 0,37 s se transcrit « dynasties »), donc invisible
// autrement qu'ici.
export const SIL_NOISE = '-24dB', SIL_D = 0.08, SIL_TOL = 0.10;
export function silencesAutour(file, a, b, pad = 0.8) {
  const A = Math.max(0, a - pad);
  return detectSilences(file, { noise: SIL_NOISE, d: SIL_D, ss: A, to: b + pad })
    .map((s) => ({ s: A + s.s, e: A + s.e }));
}
export function borneCoupeUnMot(sils, t, tol = SIL_TOL) {
  if (!sils.length) return null;                       // rien de mesuré : on ne conclut pas
  if (sils.some((s) => t >= s.s - tol && t <= s.e + tol)) return null;
  const apres = sils.filter((s) => s.s > t).map((s) => s.s)[0];
  const avant = sils.filter((s) => s.e < t).map((s) => s.e).pop();
  return { t, apres, avant, ecart: +(Math.min(...[apres !== undefined ? apres - t : Infinity,
    avant !== undefined ? t - avant : Infinity])).toFixed(3) };
}
