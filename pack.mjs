// pack.mjs — PACK VISUEL en une commande : rassemble tout ce que Claude doit VOIR pour juger un batch,
// et écrit un MANIFEST (liste ordonnée de chemins d'images à Read). But : réduire les allers-retours d'images.
//
//   node pack.mjs                → planches-contact + pellicules (pas 1s) + curate + proof-grid du dernier rendu
//   node pack.mjs 0.5            → pellicules au pas 0,5 s (plus fin pour caler une coupe)
//   node pack.mjs --no-strips    → sauter les pellicules (si déjà à jour)  · --no-curate · --no-proof
//   node pack.mjs --render "…mp4"→ proof-grid d'un rendu précis (défaut : le plus récent)
//
// Orchestrateur : appelle filmstrip.mjs / curate.mjs (ne les réimplémente pas). 100 % offline.
// Sortie : work/pack/MANIFEST.md (+ proof_<stamp>.jpg). Ne modifie NI le plan NI un rendu.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STORE, TESTS } from './store.mjs';   // chemins du store : un seul endroit

const ENG = path.dirname(fileURLToPath(import.meta.url));
const OUT = TESTS;                      // les rendus de test (cf. store.mjs)
const CAT = path.join(ENG, 'catalogue');
const PACK = path.join(ENG, 'work/pack');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const STEP = (argv.find((a) => /^\d*\.?\d+$/.test(a))) || '1';
const renderArg = (() => { const i = argv.indexOf('--render'); return i >= 0 ? argv[i + 1] : null; })();

fs.mkdirSync(PACK, { recursive: true });
const rel = (p) => p.replace(process.env.HOME, '~');
const run = (script, ...a) => {
  console.log(`\n── ${script} ${a.join(' ')} ──`);
  return spawnSync('node', [path.join(ENG, script), ...a], { stdio: 'inherit' }).status === 0;
};

// préalable : le catalogue doit exister (planches-contact + numérotation R##)
let cat = [];
try { cat = JSON.parse(fs.readFileSync(path.join(CAT, 'catalogue.json'), 'utf8')); }
catch { console.error('✖ Pas de catalogue.json — lance d\'abord : node catalogue.mjs "<dossier>" <dates>'); process.exit(1); }

// 1) pellicules (VOIR l'intérieur des plans) — sauf --no-strips
if (!has('--no-strips')) run('filmstrip.mjs', STEP);
// 2) curation mesurée (keep-ranges + doublons) → catalogue/curation.md — sauf --no-curate
if (!has('--no-curate')) run('curate.mjs');

// 3) proof-grid du dernier rendu (planche-contact de la SORTIE, pour juger le récit d'un coup d'œil)
let proof = null, renderName = null;
if (!has('--no-proof')) {
  let target = renderArg;
  if (!target) {
    try {
      const mp4 = fs.readdirSync(OUT).filter((f) => f.toLowerCase().endsWith('.mp4') && !f.startsWith('.'))
        .map((f) => ({ f, m: fs.statSync(path.join(OUT, f)).mtimeMs })).sort((a, b) => b.m - a.m);
      if (mp4.length) target = path.join(OUT, mp4[0].f);
    } catch { /* pas de dossier de sortie */ }
  } else if (!path.isAbsolute(target)) { target = path.join(OUT, target); }
  if (target && fs.existsSync(target)) {
    renderName = path.basename(target);
    const dur = parseFloat((spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=nw=1:nk=1', target], { encoding: 'utf8' }).stdout || '').trim()) || 1;
    const stamp = renderName.replace(/\.mp4$/i, '').replace(/[^0-9A-Za-z_-]+/g, '_');
    proof = path.join(PACK, `proof_${stamp}.jpg`);
    console.log(`\n── proof-grid : ${renderName} (${dur.toFixed(0)}s) ──`);
    const fps = (24 / Math.max(dur, 1)).toFixed(4);   // 24 vignettes réparties sur la durée
    const vf = `fps=${fps},scale=320:-1,drawtext=text='%{pts\\:hms}':x=6:y=6:fontsize=20`
      + `:fontcolor=yellow:box=1:boxcolor=black@0.7:borderw=1,tile=6x4:padding=6:margin=6:color=0x111111`;
    spawnSync('ffmpeg', ['-y', '-i', target, '-vf', vf, '-frames:v', '1', '-q:v', '3', proof], { stdio: 'ignore' });
    if (!fs.existsSync(proof)) { console.error('  (échec proof-grid ffmpeg)'); proof = null; }
  } else { console.log('\n── proof-grid : (aucun rendu à montrer) ──'); }
}

// ── MANIFEST : la liste ORDONNÉE d'images à Read (+ le rapport de curation) ──
const strips = (() => { try { return fs.readdirSync(path.join(CAT, 'strips')).filter((f) => f.endsWith('.jpg')).sort(); } catch { return []; } })();
const indexes = (() => { try { return fs.readdirSync(CAT).filter((f) => /^index_\d+\.jpg$/.test(f)).sort(); } catch { return []; } })();

const M = [];
M.push('# PACK VISUEL — liste à Read (dans cet ordre)\n');
M.push(`Généré : ${new Date().toISOString()} · ${cat.length} plans catalogués (R01..R${String(cat.length).padStart(2, '0')})\n`);
M.push('## 1. Planches-contact (vue d\'ensemble du jour)');
indexes.forEach((f) => M.push(`- ${rel(path.join(CAT, f))}`));
M.push('\n## 2. Curation mesurée (keep-ranges + doublons) — À LIRE');
M.push(`- ${rel(path.join(CAT, 'curation.md'))}`);
M.push(`\n## 3. Pellicules par plan (pas ${STEP}s — temps gravé, pour trancher où couper)`);
strips.forEach((f) => M.push(`- ${rel(path.join(CAT, 'strips', f))}`));
M.push('\n## 4. Proof-grid du dernier rendu (juge le récit d\'un coup d\'œil)');
M.push(proof ? `- ${rel(proof)}  (${renderName})` : '- (aucun rendu)');
M.push('\n> Doctrine de lecture : planches → dédup sémantique à l\'œil · curation.md → keep-ranges fiables ·');
M.push('> pellicules → point de pose / horizon / gens coupés · proof-grid → établissement→détails→clôture, respiration.');

const manifest = path.join(PACK, 'MANIFEST.md');
fs.writeFileSync(manifest, M.join('\n') + '\n');
console.log('\n' + M.join('\n'));
console.log(`\n→ manifest : ${rel(manifest)}  (Read ce fichier, puis les images qu'il liste)`);
