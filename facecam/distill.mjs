#!/usr/bin/env node
// ============================================================================
// facecam/distill.mjs — DISTILLATION de la substance (capacité « (3) » du monteur).
//
// ≠ subjects.mjs (qui groupe les REPRISES quasi-verbatim d'un même sujet).
// Ici : le monteur redit une même IDÉE avec d'AUTRES MOTS, parfois loin dans le corpus,
// souvent sans rien ajouter — MAIS parfois une passe apporte un petit plus
// intéressant (un « nugget »), à un endroit qui peut être isolé.
// But : ne garder que la MEILLEURE SUBSTANCE, et ne greffer un nugget que s'il
// est proprement isolable. Sinon on garde la passe entière — cohérence > perfection.
//
// Ce que fait l'outil (offline, non destructif) :
//   1. regroupe les îlots par proximité de SENS (embeddings locaux si dispo,
//      sinon cosinus IDF à seuil bas = générateur de candidats) ;
//   2. par groupe : calcule le SOCLE (ce que tout le monde dit) et l'APPORT PROPRE
//      de chaque passe (ce qu'elle seule dit) ;
//   3. désigne la passe « gardienne » (substance max) et signale les NUGGETS des
//      autres, avec leur position dans la passe (fin / milieu / début) ;
//   4. applique le RÉGULATEUR : un nugget trop court à greffer = NE PAS greffer.
//
// Sortie : rapport + <carte>.distill.json. Aucun cut : c'est un dossier d'arbitrage
// (l'EDL reste écrite à la main, avec le jugement sémantique de Claude).
//
// Usage: node facecam/distill.mjs <carte.json> [--sim 0.30] [--embed] [--minseg 1.2]
//   --embed : utilise les embeddings locaux (.venv-vision + model2vec) = vraie
//             proximité de SENS (paraphrase). Sans, repli lexical IDF (candidats).
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ENGINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PY = path.join(ENGINE, '.venv-vision', 'bin', 'python');
const EMBED = path.join(ENGINE, 'facecam', 'embed.py');

const argv = process.argv.slice(2);
const cartePath = argv.find((a) => !a.startsWith('--'));
if (!cartePath) { console.error('usage: node facecam/distill.mjs <carte.json> [--sim 0.30] [--embed]'); process.exit(1); }
const gf = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? parseFloat(argv[i + 1]) : d; };
const MIN_SEG = gf('--minseg', 1.2);    // régulateur : sous ça, un greffon est un micro-fragment
const USE_EMBED = argv.includes('--embed');
// Deux échelles de similarité : en SÉMANTIQUE tout un même voyage se ressemble déjà
// (mesuré : à 0,55 le corpus Chine fondait en un seul groupe de 29) → seuil beaucoup
// plus haut. En LEXICAL, l'IDF sépare tôt → seuil bas pour attraper la parenté d'idée.
const SIM = argv.includes('--sim') ? gf('--sim', 0.30) : (USE_EMBED ? 0.75 : 0.30);

const carte = JSON.parse(fs.readFileSync(cartePath, 'utf8'));

// mots-outils : ils ne portent pas l'idée
const STOP = new Set(('a à au aux avec ce ces dans de des du elle en et eux il je la le les leur lui ma mais '
  + 'me même mes moi mon ne nos notre nous on ou où par pas pour qu que qui sa se ses son sur ta te tes toi ton '
  + 'tu un une vos votre vous c d j l m n s t y est sont été être ai as avait cette donc voilà genre chose truc '
  + 'trucs peu près plus très bien fait faire là ça comme quoi vais veux alors enfin ici aussi cest tout tous '
  + 'toute peut quand parce pense sais dit dire vraiment beaucoup petit grand autre autres deja déjà').split(/\s+/));
const deburr = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const toks = (t) => deburr((t || '').toLowerCase()).split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !STOP.has(w));

// ---- 1) blocs candidats : les îlots porteurs ---------------------------------
const blocks = [];
for (const c of carte.clips || [])
  for (const isl of c.islands || []) {
    const t = (isl.text || '').trim();
    if (!t) continue;
    const w = toks(t);
    if (w.length < 6) continue;                       // trop maigre pour porter une idée
    blocks.push({ rush: c.name, clip: c.id, i: isl.i, a: isl.a, b: isl.b, dur: +(isl.b - isl.a).toFixed(1), text: t, words: w });
  }
if (blocks.length < 2) { console.error('pas assez de matière'); process.exit(1); }

// ---- 2) similarité : embeddings (sens) ou IDF (candidats lexicaux) ------------
let simOf;                                            // (i,j) -> 0..1
let mode = 'lexical (IDF)';
if (USE_EMBED) {
  try {
    const payload = JSON.stringify(blocks.map((b) => b.text));
    const out = execFileSync(PY, [EMBED], { input: payload, maxBuffer: 1 << 28, stdio: ['pipe', 'pipe', 'ignore'] }).toString();
    const V = JSON.parse(out).vectors.map((v) => {                 // normalise
      const n = Math.hypot(...v) || 1; return v.map((x) => x / n);
    });
    simOf = (i, j) => V[i].reduce((s, x, k) => s + x * V[j][k], 0);
    mode = 'SÉMANTIQUE (embeddings locaux)';
  } catch { /* repli silencieux sur le lexical */ }
}
if (!simOf) {
  const N = blocks.length, df = new Map();
  blocks.forEach((b) => new Set(b.words).forEach((w) => df.set(w, (df.get(w) || 0) + 1)));
  const idf = (w) => Math.log((N + 1) / ((df.get(w) || 0) + 0.5));
  const vec = blocks.map((b) => { const m = new Map(); b.words.forEach((w) => m.set(w, (m.get(w) || 0) + idf(w))); return m; });
  simOf = (i, j) => {
    let dot = 0, na = 0, nb = 0;
    for (const [k, v] of vec[i]) { na += v * v; if (vec[j].has(k)) dot += v * vec[j].get(k); }
    for (const v of vec[j].values()) nb += v * v;
    return na && nb ? dot / Math.sqrt(na * nb) : 0;
  };
}

// ---- 3) groupes d'idée (linkage MOYEN, glouton) ------------------------------
// ⚠ PAS de single-linkage : en mode sémantique tout ce qui parle du même voyage se
// ressemble un peu, et le « max » enchaîne tout en une boule unique (mesuré : 29 passes
// au socle diffus). La moyenne exige d'être proche du groupe ENTIER → groupes nets.
const groups = [];
blocks.forEach((b, i) => {
  let best = null, bs = SIM;
  for (const g of groups) {
    const s = g.reduce((acc, k) => acc + simOf(i, k), 0) / g.length;
    if (s >= bs) { bs = s; best = g; }
  }
  if (best) best.push(i); else groups.push([i]);
});

// ---- 4) socle / apport propre / nugget ---------------------------------------
// L'apport d'une passe = ses mots-contenu que AUCUNE autre passe du groupe ne dit.
// Position de l'apport dans le texte -> un apport en FIN est le cas typique du monteur
// (« j'en apporte un peu plus en fin »), et c'est le plus facile à isoler.
const dossiers = [];
for (const g of groups) {
  if (g.length < 2) continue;
  const membres = g.map((i) => blocks[i]);
  const sets = membres.map((m) => new Set(m.words));
  const socle = [...sets[0]].filter((w) => sets.every((s) => s.has(w)));
  const infos = membres.map((m, k) => {
    const autres = sets.filter((_, j) => j !== k);
    const apport = [...new Set(m.words)].filter((w) => !autres.some((s) => s.has(w)));
    // où sont ces mots dans le texte ? (fraction moyenne de progression)
    const seq = m.words;
    const pos = apport.map((w) => seq.indexOf(w) / Math.max(1, seq.length - 1)).filter((p) => p >= 0);
    const posMoy = pos.length ? pos.reduce((a, b) => a + b, 0) / pos.length : null;
    return { ...m, apport, nApport: apport.length,
      substance: new Set(m.words).size,
      posApport: posMoy == null ? null : +posMoy.toFixed(2) };
  });
  // gardienne = substance max (elle porte le socle + le plus de matière)
  const ordre = [...infos].sort((a, b) => b.substance - a.substance);
  const gardienne = ordre[0];
  const nuggets = ordre.slice(1)
    .filter((m) => m.nApport >= 3)                                  // apport non trivial
    .map((m) => {
      const zone = m.posApport == null ? 'diffus' : m.posApport > 0.66 ? 'FIN' : m.posApport < 0.34 ? 'début' : 'milieu';
      // durée approx. du greffon : part du texte concernée × durée de l'îlot
      const part = m.nApport / Math.max(1, new Set(m.words).size);
      const dureeApprox = +(m.dur * Math.min(1, part * 1.6)).toFixed(1);
      const greffable = zone === 'FIN' && dureeApprox >= MIN_SEG;   // régulateur
      return { ...m, zone, dureeApprox, greffable };
    });
  dossiers.push({ socle: socle.slice(0, 8), gardienne, nuggets, taille: g.length });
}
dossiers.sort((a, b) => b.nuggets.filter((n) => n.greffable).length - a.nuggets.filter((n) => n.greffable).length || b.taille - a.taille);

// ---- 5) rapport ---------------------------------------------------------------
const nGreffe = dossiers.reduce((s, d) => s + d.nuggets.filter((n) => n.greffable).length, 0);
console.log(`DISTILLATION — ${blocks.length} îlots · ${dossiers.length} idée(s) redite(s) · mode ${mode}\n`);
if (!dossiers.length) console.log('✓ aucune idée redite détectée (chaque îlot dit quelque chose de neuf)');
for (const d of dossiers) {
  console.log(`▸ idée « ${d.socle.join(' ') || '(socle diffus)'} » — ${d.taille} passes`);
  console.log(`   ★ GARDER  ${d.gardienne.clip}[${d.gardienne.i}] @${d.gardienne.a}-${d.gardienne.b}s (substance ${d.gardienne.substance})`);
  console.log(`             « ${d.gardienne.text.slice(0, 110)} »`);
  for (const n of d.nuggets) {
    console.log(`   ${n.greffable ? '＋ NUGGET greffable' : '· redite (ne rien greffer)'}  ${n.clip}[${n.i}] @${n.a}-${n.b}s`
      + `  apport ${n.nApport} mots en ${n.zone}${n.greffable ? ` (~${n.dureeApprox}s)` : ''}`);
    console.log(`      apporte : ${n.apport.slice(0, 10).join(', ')}`);
    console.log(`      « ${n.text.slice(0, 110)} »`);
  }
  console.log('');
}
console.log(`RÉGULATEUR : ${nGreffe} greffon(s) retenu(s) (apport en FIN et ≥ ${MIN_SEG}s).`);
console.log(`  Les autres redites : garder la passe gardienne ENTIÈRE — un micro-greffon hache le montage.`);
console.log(`  ⚠ bornes d'un greffon à confirmer par SWEEP (re-transcrire à plusieurs bornes), jamais au profil d'énergie.`);

const outPath = cartePath.replace(/\.json$/, '') + '.distill.json';
fs.writeFileSync(outPath, JSON.stringify({ sim: SIM, mode, minSeg: MIN_SEG, dossiers }, null, 1));
console.log(`→ ${outPath}`);
