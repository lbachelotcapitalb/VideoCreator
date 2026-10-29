#!/usr/bin/env node
// facecam/map.mjs — carte contenu↔timecode d'un dossier de rushs facecam.
// Découpe sur la VÉRITÉ des silences (pas sur les mots : le small bunch les timestamps),
// puis transcrit CHAQUE îlot séparément -> carte fiable pour écrire l'EDL.
// Usage: node facecam/map.mjs "<dossierRushs>" [--gap 1.2] [--min 0.7] [--json out.json]
import fs from 'fs';
import { execSync } from 'child_process';
import { MODEL, listClips, speechIslands, probeDur, fmt } from './lib.mjs';

const args = process.argv.slice(2);
const rushDir = args[0];
if (!rushDir) { console.error('usage: node facecam/map.mjs "<dossierRushs>" [--gap 1.2] [--min 0.7] [--json out.json]'); process.exit(1); }
const getf = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const gap = parseFloat(getf('--gap', '1.2'));
const minDur = parseFloat(getf('--min', '0.7'));
const jsonOut = getf('--json', null);

const since = getf('--since', null);        // 'YYYYMMDD' : ne mapper que les rushs de ce jour ou après
const fresh = args.includes('--fresh');     // ignorer la carte existante (tout re-transcrire)

const WORK = `${rushDir}/.facecam_work`; fs.mkdirSync(WORK, { recursive: true });
// ⚠ listClips SUR TOUT LE DOSSIER : les ids c1..cN sont positionnels, une EDL déjà écrite en
// dépend. On filtre APRÈS (--since) pour ne pas décaler les ids d'un montage existant.
const allClips = listClips(rushDir);
const stampOf = (n) => (n.match(/(\d{8})\d{6}/) || [])[1] || null;
const clips = since ? allClips.filter((c) => { const s = stampOf(c.name); return !s || s >= since; }) : allClips;
if (since) console.log(`(scope --since ${since} : ${clips.length}/${allClips.length} rushs)`);

// INCRÉMENTAL : on réutilise les îlots déjà transcrits d'une carte précédente pour les rushs
// INCHANGÉS (signature taille+mtime). Une passe suivante ne coûte que les NOUVEAUX rushs.
const sigOf = (f) => { const s = fs.statSync(f); return `${s.size}:${Math.round(s.mtimeMs)}`; };
let prev = new Map();
if (jsonOut && !fresh && fs.existsSync(jsonOut)) {
  try {
    for (const rec of (JSON.parse(fs.readFileSync(jsonOut, 'utf8')).clips || [])) if (rec.sig) prev.set(rec.name, rec);
  } catch { /* carte illisible -> on repart de zéro */ }
}

const out = { rushDir, gap, minDur, clips: [] };

for (const c of clips) {
  const sig = sigOf(c.file);
  const cached = prev.get(c.name);
  if (cached && cached.sig === sig) {          // rush inchangé -> on garde ses îlots
    out.clips.push({ ...cached, id: c.id });   // (id repris du dossier courant, il peut avoir bougé)
    console.log(`\n# ${c.id}  ${c.name}  (déjà mappé, ${cached.islands.length} îlots réutilisés)`);
    continue;
  }
  const dur = probeDur(c.file);
  const islands = speechIslands(c.file, { gap, minDur });
  const rec = { id: c.id, name: c.name, dur, sig, islands: [] };
  console.log(`\n# ${c.id}  ${c.name}  (${dur.toFixed(1)}s)  islands=${islands.length}`);
  islands.forEach((isl, i) => {
    const wav = `${WORK}/${c.id}_${i}.wav`;
    execSync(`ffmpeg -y -v error -ss ${isl.a} -to ${isl.b} -i "${c.file}" -ac 1 -ar 16000 "${wav}"`);
    execSync(`whisper-cli -m "${MODEL}" -l fr -otxt -of "${WORK}/${c.id}_${i}" "${wav}" >/dev/null 2>&1`);
    let text = '';
    try { text = fs.readFileSync(`${WORK}/${c.id}_${i}.txt`, 'utf8').replace(/\s+/g, ' ').trim(); } catch {}
    rec.islands.push({ i, a: +isl.a.toFixed(2), b: +isl.b.toFixed(2), dur: +(isl.b - isl.a).toFixed(1), text });
    console.log(`[${String(i).padStart(2)}] ${fmt(isl.a)}–${fmt(isl.b)} (${(isl.b - isl.a).toFixed(1)}s)  ${text}`);
  });
  out.clips.push(rec);
}
if (jsonOut) { fs.writeFileSync(jsonOut, JSON.stringify(out, null, 1)); console.log(`\n→ carte JSON: ${jsonOut}`); }
