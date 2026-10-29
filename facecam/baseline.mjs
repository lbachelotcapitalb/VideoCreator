#!/usr/bin/env node
// ============================================================================
// facecam/baseline.mjs — BOUCLE D'AMÉLIORATION **ANTI-RÉGRESSION**.
//
// Exigence du monteur : « intégrer une boucle d'amélioration mais ANTI-RÉGRESSION à
// chaque itération ». Le piège d'un pipeline qui s'améliore : un réglage gagne
// sur un axe et casse silencieusement un autre (on serre les silences → on hache ;
// on réordonne pour le sens → on crée un saut de pose). Ici : on FIGE une
// référence chiffrée, et toute itération suivante doit prouver qu'elle **ne
// régresse RIEN** — pas seulement qu'elle progresse quelque part.
//
//   node facecam/baseline.mjs lock  <edl.json> --tag v11     → fige la référence
//   node facecam/baseline.mjs check <edl.json> [--against v11] [--tol 0]
//   node facecam/baseline.mjs list
//
// Les métriques ne sont pas réinventées : on rejoue `joins.mjs` (FORME) et
// `coherence.mjs` (SENS) et on agrège leurs JSON. Ajouter un contrôle = il entre
// automatiquement dans la boucle.
//
// Verdict : ✅ ACCEPTABLE (aucune régression) · ⛔ REFUSÉ (au moins une métrique
// dégradée). Un gain ailleurs ne rachète JAMAIS une régression : c'est la règle.
// Rien n'est modifié ni rendu — c'est une gate de décision.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STORE = path.join(process.env.HOME, 'Movies', 'Montage');
const BASEDIR = path.join(STORE, '.coulisses', 'facecam', 'baselines');
fs.mkdirSync(BASEDIR, { recursive: true });

const argv = process.argv.slice(2);
const cmd = argv[0];
const gf = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const edlPath = argv.slice(1).find((a) => !a.startsWith('--'));

// --- métriques : direction = ce qui compte comme DÉGRADATION ------------------
// 'down' = plus haut est pire (défauts) · 'info' = suivi, jamais bloquant.
const METRICS = {
  microSegments: { dir: 'down', label: 'segments trop courts' },
  poseJumps:     { dir: 'down', label: 'sauts de pose au raccord' },
  worstJump:     { dir: 'down', label: 'pire saut (coût)' },
  cutsPerMin:    { dir: 'down', label: 'raccords/min (haché)' },
  phantoms:      { dir: 'down', label: 'textes fantômes (whisper)' },
  refIssues:     { dir: 'down', label: 'référents manquants' },
  nSpans:        { dir: 'info', label: 'spans' },
  keptTotal:     { dir: 'info', label: 'durée gardée (s)' },
};

function mesurer(edl) {
  const carte = path.join(STORE, '.coulisses', 'facecam', 'carte.json');
  const run = (script, args) => {
    try { execFileSync('node', [path.join(HERE, script), ...args], { stdio: ['ignore', 'ignore', 'ignore'], maxBuffer: 1 << 26 }); }
    catch { /* l'outil écrit son JSON même s'il sort en warning */ }
  };
  run('joins.mjs', [edl]);
  run('coherence.mjs', [carte, '--edl', edl]);
  const j = JSON.parse(fs.readFileSync(edl.replace(/\.json$/, '') + '.joins.json', 'utf8'));
  const c = JSON.parse(fs.readFileSync(carte.replace(/\.json$/, '') + '.coherence.json', 'utf8'));
  return {
    microSegments: j.short.length,
    poseJumps: j.jumps.filter((x) => x.cost > 1).length,
    worstJump: j.worstCost,
    cutsPerMin: j.cutsPerMin,
    phantoms: c.phantoms.length,
    refIssues: c.refIssues.length,
    nSpans: JSON.parse(fs.readFileSync(edl, 'utf8')).spans.length,
    keptTotal: j.keptTotal,
  };
}

const fichier = (tag) => path.join(BASEDIR, `${tag}.json`);

if (cmd === 'list') {
  const l = fs.readdirSync(BASEDIR).filter((f) => f.endsWith('.json'));
  if (!l.length) console.log('(aucune référence figée)');
  for (const f of l) {
    const b = JSON.parse(fs.readFileSync(path.join(BASEDIR, f), 'utf8'));
    console.log(`• ${f.replace(/\.json$/, '')}  ← ${path.basename(b.edl)}  (${Object.entries(b.metrics).map(([k, v]) => `${k}=${v}`).join(' · ')})`);
  }
  process.exit(0);
}

if (!edlPath) { console.error('usage: baseline.mjs lock|check <edl.json> [--tag|--against <nom>] [--tol 0]'); process.exit(1); }

if (cmd === 'lock') {
  const tag = gf('--tag', 'courant');
  const metrics = mesurer(edlPath);
  fs.writeFileSync(fichier(tag), JSON.stringify({ tag, edl: edlPath, metrics }, null, 1));
  console.log(`RÉFÉRENCE FIGÉE « ${tag} » ← ${path.basename(edlPath)}\n`);
  for (const [k, v] of Object.entries(metrics)) console.log(`  ${METRICS[k].label.padEnd(28)} ${v}`);
  console.log(`\n→ ${fichier(tag)}`);
  console.log(`Toute itération suivante devra prouver qu'elle ne dégrade AUCUNE de ces valeurs :`);
  console.log(`  node facecam/baseline.mjs check <edl> --against ${tag}`);
  process.exit(0);
}

if (cmd === 'check') {
  const tag = gf('--against', 'courant');
  const TOL = parseFloat(gf('--tol', '0'));          // marge tolérée avant de crier à la régression
  if (!fs.existsSync(fichier(tag))) { console.error(`référence « ${tag} » absente — lance d'abord : baseline.mjs lock <edl> --tag ${tag}`); process.exit(2); }
  const base = JSON.parse(fs.readFileSync(fichier(tag), 'utf8'));
  const now = mesurer(edlPath);

  const regressions = [], gains = [], infos = [];
  for (const [k, meta] of Object.entries(METRICS)) {
    const a = base.metrics[k], b = now[k];
    if (a == null || b == null) continue;
    const d = +(b - a).toFixed(2);
    if (meta.dir === 'info') { if (d !== 0) infos.push({ k, a, b, d }); continue; }
    if (d > TOL) regressions.push({ k, a, b, d });          // plus de défauts = régression
    else if (d < -TOL) gains.push({ k, a, b, d });
  }

  console.log(`ANTI-RÉGRESSION — ${path.basename(edlPath)} vs référence « ${tag} »\n`);
  const ligne = ({ k, a, b, d }) => `  ${METRICS[k].label.padEnd(28)} ${a} → ${b}  (${d > 0 ? '+' : ''}${d})`;
  if (gains.length) { console.log('GAINS :'); gains.forEach((g) => console.log(ligne(g))); console.log(''); }
  if (regressions.length) { console.log('⛔ RÉGRESSIONS :'); regressions.forEach((r) => console.log(ligne(r))); console.log(''); }
  if (infos.length) { console.log('(informatif, non bloquant) :'); infos.forEach((i) => console.log(ligne(i))); console.log(''); }
  if (!gains.length && !regressions.length) console.log('  (aucun mouvement sur les métriques de défaut)\n');

  if (regressions.length) {
    console.log(`⛔ REFUSÉ — ${regressions.length} métrique(s) dégradée(s). Un gain ailleurs ne rachète pas une régression :`);
    console.log(`   corriger, ou assumer explicitement en re-figeant la référence (lock) avec la raison.`);
    process.exit(1);
  }
  console.log(`✅ ACCEPTABLE — aucune régression${gains.length ? `, ${gains.length} gain(s)` : ''}.`);
  console.log(`   Si l'itération est validée à l'œil : re-figer → baseline.mjs lock ${edlPath} --tag ${tag}`);
  process.exit(0);
}

console.error('commande inconnue : lock | check | list');
process.exit(1);
