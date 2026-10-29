#!/usr/bin/env node
// ============================================================================
// facecam/sujets.mjs — RÉ-ADRESSER les sujets d'un master facecam mono-fichier.
//
// POURQUOI CET OUTIL EXISTE. `vlog.mjs` ne lit qu'un `sujets.json` dont les bornes sont
// en secondes ABSOLUES du master. Pour un lot rendu ville par ville, c'est `fusion.mjs`
// qui l'écrit. Pour l'épisode #03 le master sort d'UN seul `render.mjs` — et ce geste-là
// avait été fait À LA MAIN le 17/09. Il a donc fallu le réinventer dès que les bornes de
// l'EDL ont bougé, c'est-à-dire au pire moment.
// ⭐ « Une chaîne qu'on ne peut pas rejouer n'est pas une chaîne » (31/07) : toute suite
// de commandes qu'on refera un jour s'écrit dans le repo.
//
// CE QU'IL NE DEVINE PAS. La VILLE d'un sujet n'est écrite nulle part dans le manifeste de
// spans : elle vit dans le `sujets.json` précédent. On la reprend par LABEL (jamais par
// rang — « un identifiant dérivé d'un ordre n'est pas un identifiant », 31/07) et on
// REFUSE si un label n'a pas de ville connue, au lieu de livrer un champ vide.
//
// Usage :
//   node facecam/sujets.mjs <master.spans.json> --villes <ancien-sujets.json> --out <sujets.json>
//   node facecam/sujets.mjs … --dry        (n'écrit rien, montre le tableau)
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const gf = (k, d = null) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const DRY = argv.includes('--dry');
const spansPath = argv.find((a) => !a.startsWith('--') && a !== gf('--villes') && a !== gf('--out'));
const villesPath = gf('--villes');
const outPath = gf('--out');
if (!spansPath || !villesPath || !outPath) {
  console.error('usage : node facecam/sujets.mjs <master.spans.json> --villes <ancien-sujets.json> --out <sujets.json> [--dry]');
  process.exit(2);
}

const man = JSON.parse(fs.readFileSync(spansPath, 'utf8'));
const anciens = JSON.parse(fs.readFileSync(villesPath, 'utf8'));
const [fn, fd] = String(man.fps).split('/').map(Number);
const fps = fd ? fn / fd : fn;
if (!Number.isFinite(fps) || fps <= 0) throw new Error(`fps illisible dans le manifeste : « ${man.fps} »`);

// label → ville, repris de l'ancien sujets.json. Par LABEL, jamais par rang.
const ville = Object.fromEntries(anciens.map((s) => [s.label, s.ville]));
const orphelins = man.spans.filter((s) => !ville[s.label]).map((s) => s.label);
if (orphelins.length) {
  console.error(`❌ ${orphelins.length} span(s) sans ville connue dans ${path.basename(villesPath)} : ${orphelins.join(', ')}`);
  console.error('   → un champ « ville » vide ferait tomber le carton de ville au mauvais endroit. On refuse.');
  process.exit(1);
}

// ── les bornes : cumul d'IMAGES converti en secondes. Jamais le champ `t` d'un autre outil.
let cum = 0;
const sujets = man.spans.map((s, i) => {
  const a = cum / fps;
  cum += s.frames;
  const b = cum / fps;
  return {
    id: `F${String(i + 1).padStart(2, '0')}`,
    label: s.label,
    ville: ville[s.label],
    a: Number(a.toFixed(3)),
    b: Number(b.toFixed(3)),
    dur: Number((s.frames / fps).toFixed(3)),
  };
});

// ── GARDE : contiguïté et total. Un trou de 1 image décale tout ce qui suit.
let trous = 0, ecartMax = 0;
for (let i = 1; i < sujets.length; i++) {
  const d = Math.abs(sujets[i].a - sujets[i - 1].b);
  ecartMax = Math.max(ecartMax, d);
  if (d > 1e-3) trous++;
}
const totalAttendu = man.total_frames / fps;
const ecartTotal = Math.abs(sujets.at(-1).b - totalAttendu);

console.log(`══════ SUJETS FACECAM ══════`);
console.log(`  master   : ${man.out} · ${man.total_frames} images · ${totalAttendu.toFixed(3)} s · ${man.fps}`);
console.log(`  sujets   : ${sujets.length} · villes ${[...new Set(sujets.map((s) => s.ville))].join(' → ')}`);
console.log(`· contiguïté : ${sujets.length - trous}/${sujets.length} à 0 ms · écart max ${(ecartMax * 1000).toFixed(1)} ms` + (trous ? '  ❌' : '  ✅'));
console.log(`· total      : ${sujets.at(-1).b.toFixed(3)} s contre ${totalAttendu.toFixed(3)} s attendues · écart ${(ecartTotal * 1000).toFixed(1)} ms` + (ecartTotal > 1e-3 ? '  ❌' : '  ✅'));
if (trous || ecartTotal > 1e-3) { console.error('\n❌ les bornes ne pavent pas le master — on n\'écrit pas.'); process.exit(1); }

// comparaison à l'ancien, quand les labels sont les mêmes : ce qui a BOUGÉ, et de combien.
const avant = Object.fromEntries(anciens.map((s) => [s.label, s]));
const bouges = sujets.filter((s) => avant[s.label] && Math.abs(avant[s.label].dur - s.dur) > 1e-3);
if (bouges.length) {
  console.log(`\n· ${bouges.length} sujet(s) de durée différente :`);
  for (const s of bouges) console.log(`    ${s.id} ${s.label.padEnd(34)} ${avant[s.label].dur.toFixed(3)} → ${s.dur.toFixed(3)} s  (${(s.dur - avant[s.label].dur >= 0 ? '+' : '')}${(s.dur - avant[s.label].dur).toFixed(3)})`);
} else {
  console.log(`\n· aucune durée de sujet n'a bougé contre ${path.basename(villesPath)}`);
}

if (DRY) { console.log('\n(--dry : rien écrit)'); process.exit(0); }
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(sujets, null, 1) + '\n');
console.log(`\n✓ ${outPath}`);
