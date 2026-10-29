#!/usr/bin/env node
// ============================================================================
// frame.mjs — extraire UNE image par son INDEX, sans décoder tout le film.
//
// POURQUOI ce fichier existe (01/09) : les frames de preuve se visent par index
// (`select='eq(n,N)'`), et cette forme décode DEPUIS LE DÉBUT — environ 2 min pour
// l'image 23 400 d'un master 4K. Une preuve qui coûte deux minutes se prend moins
// souvent qu'une preuve qui en coûte deux secondes, et une preuve qu'on ne prend
// pas ne prouve rien. Corollaire de « une chaîne qu'on ne peut pas rejouer n'est
// pas une chaîne » : cette commande se refaisait à la main à chaque master.
//
// ⚠️ LE PIÈGE, PAYÉ EN L'ÉCRIVANT : un `-ss` suivi d'un `gte(t, N/fps)` sort
// l'image **N+1**. Le pts de l'image N vaut exactement N/fps, et le seuil calculé
// en flottant tombe un cheveu au-dessus — donc la première image qui satisfait le
// test est la suivante. Le seuil est donc posé à **(N − 0,5)/fps** : une demi-image
// de marge, insensible à l'arrondi dans les deux sens. Découvert non pas en lisant
// l'image (elle « avait l'air bonne ») mais en comparant son md5 à celui de la voie
// lente. *Deux grandeurs dans la même unité ne sont pas la même horloge — et une
// image extraite ne dit pas d'elle-même quel index elle porte.*
//
// ⛔ CE QUE CET OUTIL NE FAIT PAS : mesurer une FRONTIÈRE de plan. `bornes.py` interdit le seek
// pour cette tâche, et à raison — le `pts` affiché après un `-ss` ne correspond plus à l'image
// rendue. Ici on ne LIT aucun pts : on connaît déjà l'index voulu et on veut son image, validée
// par md5 contre la voie lente (`--verifier`). Chercher un index qu'on ignore reste le travail de
// `bornes.py`.
//
// Usage : node frame.mjs <video> <index> [--out f.png] [--marge 2] [--verifier]
//   --verifier  extrait AUSSI par la voie lente et compare les md5 (le contrôle
//               qui a trouvé le décalage ; à rejouer sur tout nouveau format).
// ============================================================================
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import crypto from 'crypto';

const a = process.argv.slice(2);
const opt = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
const video = a[0];
const N = Number(a[1]);
if (!video || !Number.isInteger(N) || N < 0) {
  console.error('usage: frame.mjs <video> <index> [--out f.png] [--marge 2] [--verifier]');
  process.exit(1);
}
if (!fs.existsSync(video)) { console.error(`✗ vidéo absente : ${video}`); process.exit(1); }

const out = opt('--out', path.join(path.dirname(video), `frame-${String(N).padStart(6, '0')}.png`));
const marge = Number(opt('--marge', 2));
const verifier = a.includes('--verifier');

// ⭐ LIRE le fps, ne jamais le supposer : une cadence supposée (29,97 pour du 30/1)
// fabrique une dérive cumulative parfaitement crédible, et fausse. Cf. STYLE.
const probe = (champ) => execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
  '-show_entries', `stream=${champ}`, '-of', 'default=nw=1:nk=1', video], { encoding: 'utf8' }).trim().split('\n')[0];
const rfr = probe('r_frame_rate');
const [num, den] = rfr.split('/').map(Number);
const fps = num / (den || 1);
const total = Number(probe('nb_frames')) || null;
if (total && N >= total) { console.error(`✗ index ${N} hors du film (${total} images)`); process.exit(1); }

const seuil = (N - 0.5) / fps;                 // ⚠️ la demi-image, cf. en-tête
const seek = Math.max(0, seuil - marge);
const md5 = (p) => crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex');

const t0 = Date.now();
execFileSync('ffmpeg', ['-v', 'error', '-ss', String(seek), '-copyts', '-i', video,
  '-vf', `select='gte(t\\,${seuil})'`, '-fps_mode', 'passthrough', '-frames:v', '1', '-y', out],
  { stdio: ['ignore', 'inherit', 'inherit'] });
const dt = (Date.now() - t0) / 1000;
console.log(`image ${N}  (${rfr} = ${fps.toFixed(3)} fps · t = ${(N / fps).toFixed(3)} s)`);
console.log(`  → ${out}   en ${dt.toFixed(1)} s`);

if (verifier) {
  const ref = out.replace(/\.png$/, '.lent.png');
  const t1 = Date.now();
  execFileSync('ffmpeg', ['-v', 'error', '-i', video, '-vf', `select='eq(n\\,${N})'`,
    '-fps_mode', 'passthrough', '-frames:v', '1', '-y', ref], { stdio: ['ignore', 'inherit', 'inherit'] });
  const dt1 = (Date.now() - t1) / 1000;
  const ok = md5(out) === md5(ref);
  console.log(`  voie lente (select eq(n,${N})) : ${dt1.toFixed(1)} s   → ×${(dt1 / dt).toFixed(1)} plus lent`);
  console.log(ok ? `  ✅ MÊME IMAGE que la voie lente (md5 ${md5(out).slice(0, 12)}…)`
                 : `  ❌ IMAGES DIFFÉRENTES — le seuil rate sa cible, NE PAS se fier à la voie rapide`);
  fs.rmSync(ref, { force: true });
  if (!ok) process.exit(1);
}
