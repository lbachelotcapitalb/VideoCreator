#!/usr/bin/env node
// vlog-restitution.mjs — rend le TABLEAU DE RESTITUTION d'un montage mergé, à partir de
// `vlog/vlog.plan.json` (la timeline mesurée écrite par vlog.mjs).
//
// Garde-fou §3 du skill : « toute itération de montage rend un tableau propre ». Sur un vlog
// mergé, la maille utile n'est PAS le plan (110 lignes illisibles) mais le BLOC : une bande
// paysage ou un bloc facecam, avec sa matière d'origine et son rôle. Le détail plan-par-plan
// reste dans les fiches `lecture-<jour>.md` et dans `vlog.plan.json`.
//
//   node vlog-restitution.mjs [vlog/vlog.plan.json] > extrait.md
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ENGINE = path.dirname(fileURLToPath(import.meta.url));
const planPath = process.argv[2] || path.join(ENGINE, 'vlog/vlog.plan.json');
const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
const hms = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

// regroupe les plans consécutifs d'une même bande, garde les blocs facecam tels quels
const rows = [];
for (const p of plan.pieces) {
  const last = rows[rows.length - 1];
  if (p.kind === 'L' && last && last.kind === 'L' && last.band === p.band) {
    last.t1 = p.t1; last.badges.push(p.badge); last.origines.push(p.origine); continue;
  }
  rows.push({ kind: p.kind, band: p.band, t0: p.t0, t1: p.t1, badges: [p.badge], origines: [p.origine], label: p.label });
}

const short = (a) => a.length > 1 ? `${a[0]}→${a[a.length - 1]}` : a[0];
const jourOf = (o) => o.split(' ')[0].replace('J', '');

console.log(`## Tableau de restitution — ${plan.titre} (${hms(plan.total)})\n`);
console.log('| # | in → out | type | matière | durée | rôle |');
console.log('|---|---|---|---|---|---|');
rows.forEach((r, i) => {
  const d = r.t1 - r.t0;
  const mat = r.kind === 'L'
    ? `J${jourOf(r.origines[0])} · ${r.origines.map((o) => o.split(' ')[1]).join(' ')} (${r.badges.length} plans)`
    : `facecam ${r.origines[0]}`;
  console.log(`| ${short(r.badges)} | ${hms(r.t0)} → ${hms(r.t1)} | ${r.kind === 'L' ? 'paysage' : 'FACECAM'} | ${mat} | ${d.toFixed(1)} s | ${r.kind === 'F' ? r.label : ''} |`);
});

const L = plan.pieces.filter((p) => p.kind === 'L');
const F = plan.pieces.filter((p) => p.kind === 'F');
const sum = (a) => a.reduce((s, p) => s + p.dur, 0);
console.log(`\n**Bilan** — ${rows.length} blocs : ${rows.filter((r) => r.kind === 'L').length} bandes paysage `
  + `(${L.length} plans, ${hms(sum(L))}) + ${F.length} blocs facecam (${hms(sum(F))}) = **${hms(plan.total)}**.`);
const parJour = {};
for (const p of L) { const j = jourOf(p.origine); parJour[j] = (parJour[j] || 0) + p.dur; }
console.log(`\n| jour | paysage retenu |\n|---|---|`);
for (const [j, d] of Object.entries(parJour)) console.log(`| ${j} | ${hms(d)} |`);
