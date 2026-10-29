#!/usr/bin/env node
// ============================================================================
// facecam/overlays/vad-cas.mjs — LES CAS CONNUS DE `vad.py --tete`, rejouables.
//
// POURQUOI CE FICHIER EXISTE (19/09). La mesure du BLANC DE TÊTE a été refaite trois
// fois en trois jours, et chaque version s'est déclarée juste avant d'être réfutée :
//   · 18/09 — onset de la 1re île : 4 spans annoncés à 0,32-0,44 s de blanc alors que
//     la voix y attaque à 0,00 s. Quatre réserves posées dans l'EDL pour rien, et un
//     remède arithmétique qui, appliqué, aurait effacé le premier mot de chacun.
//   · la cause écrite ce jour-là (« l'île courte est jetée par MIN_ILE ») était elle
//     aussi fausse : remesuré, AUCUNE île courte n'est jetée — c'est la REMONTÉE de
//     `iles()` qui s'arrête sur une pause intra-phrase.
//   · 19/09 — on ne mesure plus un onset mais le plus long SILENCE AVÉRÉ devant la voix.
//
// *Un instrument se valide sur des cas connus AVANT de servir, et une suite de commandes
// qu'on refera un jour s'écrit dans le dépôt.* Les deux sens sont éprouvés ici : ce qui
// doit rester muet, et ce qui doit crier. Un cas qui ne CRIE pas ne prouve rien.
//
// Usage : node facecam/overlays/vad-cas.mjs [--master <facecam.mp4>]
//   Sans argument, prend le master facecam le plus récent de « Facecam Rush ».
//   Sortie non nulle dès qu'un cas s'écarte de plus de deux fenêtres (0,04 s).
// ============================================================================
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { STORE } from '../../store.mjs';

const ENGINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PY = path.join(ENGINE, '.venv-vision', 'bin', 'python');
const VAD = path.join(ENGINE, 'facecam', 'overlays', 'vad.py');

const argv = process.argv.slice(2);
const gf = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };

const FR = path.join(STORE, 'Facecam Rush');
let master = gf('--master', null);
if (!master) {
  const c = fs.readdirSync(FR).filter((f) => /^VLOG_.*facecam.*\.mp4$/i.test(f) && !/_4k/i.test(f))
    .map((f) => ({ f, t: fs.statSync(path.join(FR, f)).mtimeMs })).sort((a, b) => b.t - a.t);
  if (!c.length) { console.error('✗ aucun master facecam dans « Facecam Rush »'); process.exit(2); }
  master = path.join(FR, c[0].f);
}
const manifest = master.replace(/\.mp4$/i, '.spans.json');
if (!fs.existsSync(manifest)) { console.error(`✗ manifeste absent : ${manifest}`); process.exit(2); }
const S = JSON.parse(fs.readFileSync(manifest, 'utf8'));
const FPS = 30000 / 1001;

const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'vadcas-'));
const ff = (...a) => execFileSync('ffmpeg', ['-y', '-v', 'error', ...a]);
const wavDuSpan = (i) => {
  const sp = S.spans.find((x) => x.i === i);
  if (!sp) return null;
  const out = path.join(WORK, `s${i}.wav`);
  ff('-ss', sp.t.toFixed(3), '-t', (sp.frames / FPS).toFixed(3), '-i', master, '-ac', '1', '-ar', '16000', out);
  return { out, label: sp.label };
};
const concat = (parts, out) => {
  const args = [];
  for (const p of parts) args.push('-i', p);
  ff(...args, '-filter_complex', `${parts.map((_, k) => `[${k}:a]`).join('')}concat=n=${parts.length}:v=0:a=1`,
    '-ar', '16000', '-ac', '1', out);
  return out;
};
const mesure = (w) => {
  const o = JSON.parse(execFileSync(PY, [VAD, '--tete', w], { encoding: 'utf8' }));
  return Object.values(o)[0];
};

// ---- un span PROPRE du master sert d'étalon : on lui ajoute des têtes connues.
// Il doit exister et être sans blanc ; on prend le premier span dont l'air mesuré est < 0,20 s.
let etalon = null;
for (const sp of S.spans) {
  const w = wavDuSpan(sp.i); if (!w) continue;
  const r = mesure(w.out);
  if (r && r.air < 0.20) { etalon = { ...w, air: r.air }; break; }
  fs.rmSync(w.out, { force: true });
}
if (!etalon) { console.error('✗ aucun span propre pour servir d\'étalon'); process.exit(2); }

const sil = (d, f) => { ff('-f', 'lavfi', '-t', String(d), '-i', 'anullsrc=r=16000:cl=mono', '-ar', '16000', '-ac', '1', f); return f; };
const blip = (d, f) => { ff('-f', 'lavfi', '-t', String(d), '-i', 'sine=frequency=900:sample_rate=16000', '-ar', '16000', '-ac', '1', f); return f; };

const cas = [];
// (1) DOIT RESTER MUET : les spans que le monteur a laissés passer, et ceux dont la réserve `air`
//     du 18/09 s'est révélée fausse. Leur air est l'air propre de l'étalon, à une fenêtre près.
cas.push({ nom: `étalon « ${etalon.label} » (rien à signaler)`, wav: etalon.out, attendu: etalon.air, crie: false });
// (2) DOIT CRIER : 2,000 s de silence NUMÉRIQUE devant l'étalon.
cas.push({ nom: '2,000 s de silence numérique', crie: true, attendu: etalon.air + 2.0,
  wav: concat([sil(2.0, path.join(WORK, 'sil2.wav')), etalon.out], path.join(WORK, 'pad2.wav')) });
// (3) DOIT CRIER : 0,900 s de silence, l'ordre de grandeur des blancs que le monteur signale.
cas.push({ nom: '0,900 s de silence', crie: true, attendu: etalon.air + 0.9,
  wav: concat([sil(0.9, path.join(WORK, 'sil09.wav')), etalon.out], path.join(WORK, 'pad09.wav')) });
// (4) DOIT CRIER MALGRÉ LE BLIP : un clic de 0,10 s, puis 1,50 s de rien, puis la parole.
//     C'est le faux négatif historique de `deux-locales-25-ans` : sans précaution, le blip
//     tient lieu d'attaque de voix et l'instrument écrit « rien à signaler » sur le défaut.
cas.push({ nom: 'blip 0,10 s + 1,500 s de silence', crie: true, attendu: etalon.air + 1.5,
  wav: concat([blip(0.10, path.join(WORK, 'blip.wav')), sil(1.5, path.join(WORK, 'sil15.wav')), etalon.out],
    path.join(WORK, 'blipcase.wav')) });

const TOL = 0.04, SEUIL = 0.30;   // SEUIL = la tolérance du garde (parole.mjs S.airMax)
let ok = true;
console.log(`CAS CONNUS de vad.py --tete — étalon : ${path.basename(master)} / ${etalon.label}\n`);
for (const c of cas) {
  const r = mesure(c.wav);
  const air = r ? r.air : null;
  const juste = air !== null && Math.abs(air - c.attendu) <= TOL;
  const crieBien = air !== null && (air > SEUIL) === c.crie;
  const bon = juste && crieBien;
  ok &&= bon;
  console.log(`${bon ? '✓' : '⛔'} ${c.nom.padEnd(42)} attendu ${c.attendu.toFixed(2)}s · mesuré `
    + `${air === null ? 'NON MESURÉ' : air.toFixed(2) + 's'} · ${c.crie ? 'doit CRIER' : 'doit rester MUET'}`
    + `${crieBien ? '' : ' ← IL NE LE FAIT PAS'}`);
}
fs.rmSync(WORK, { recursive: true, force: true });
console.log(`\nVERDICT : ${ok ? '✓ l\'instrument voit ce qu\'il doit voir, et se tait sur le reste' : '⛔ instrument non valide — ne pas s\'en servir pour livrer'}`);
process.exit(ok ? 0 : 1);
