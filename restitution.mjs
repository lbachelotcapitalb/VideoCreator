#!/usr/bin/env node
// restitution.mjs — GÉNÈRE le tableau de restitution du jour scopé (garde-fou « clôture = tableau »).
//
// Pourquoi cet outil (29/07) : le garde-fou du monteur du 27/07 — « toute itération de montage rend un
// tableau propre, une ligne par rush, aucun rush passé sous silence » — ne tenait QUE par la
// discipline de Claude. Rien ne le vérifiait, et l'arithmétique (durées gardées, bilan avant→après)
// se faisait à la main : sur le jour 20 le total annoncé était 80,1 s pour un rendu de 80,198 s.
// Juste, mais le risque d'erreur était gratuit. Ici les chiffres viennent de ffprobe et de plan.txt.
//
// Ce qu'il fait   : une ligne par rush du jour, décision déduite de plan.txt, durées mesurées,
//                   colonne « pourquoi » pré-remplie avec le COMMENTAIRE de la ligne de plan.txt.
// Ce qu'il ne fait pas : décider, et ÉCRIRE dans RESTITUTIONS.md. Il imprime ; c'est Claude qui
//                   relit, complète les « pourquoi » vides et colle l'entrée. Une entrée de
//                   restitution est un texte argumenté, pas une sortie de script.
//
//   node restitution.mjs            → tableau du jour scopé (Réglages/jour.txt)
//   node restitution.mjs --nu       → markdown seul (sans l'en-tête de contexte)
//
// 100 % offline, lecture seule.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { INBOX, STORE } from './store.mjs';   // chemins du store : un seul endroit

const HOME = process.env.HOME;
const RUSH = INBOX;
const REGLAGES = path.join(STORE, 'Réglages');
const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.avi', '.mkv', '.webm']);
const NU = process.argv.includes('--nu');
// Seuil du filtre « déclenchement accidentel » de monte.mjs — répliqué ici pour que la colonne
// « décision » dise POURQUOI un rush absent de plan.txt a disparu (accident ≠ choix de montage).
const MIN_SHOT_PERCEPTIBLE = 1.0;

function readJours() {
  try {
    return fs.readFileSync(path.join(REGLAGES, 'jour.txt'), 'utf8')
      .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
      .map((l) => l.replace(/\D/g, '')).filter((d) => d.length === 8);
  } catch { return []; }
}
function dur(file) {
  const o = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=nw=1:nk=1', file], { encoding: 'utf8' }).stdout || '';
  return parseFloat(o) || 0;
}
const fr = (n) => n.toFixed(1).replace('.', ',');
const mmss = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).replace('.', ',').padStart(4, '0')}`;

// ── plan.txt : décision + commentaire par R## ────────────────────────────────
// Même grammaire que readPlan() de monte.mjs (R## + fenêtres + flags), mais on garde EN PLUS le
// commentaire de fin de ligne : c'est la raison écrite, et elle a sa place dans le tableau.
function readPlan() {
  const f = path.join(REGLAGES, 'plan.txt');
  if (!fs.existsSync(f)) return null;
  const byId = {};
  let last = null;
  let stop = false;   // une remarque ⚠ (aparté technique) coupe la reprise des lignes suivantes
  for (const raw of fs.readFileSync(f, 'utf8').split('\n')) {
    const code = raw.replace(/#.*$/, '').trim();
    const note = (raw.match(/#\s*(.*)$/) || [, ''])[1].trim();
    if (!code) {
      // ligne de commentaire seule : c'est la SUITE du « pourquoi » du rush précédent — sauf
      // après un aparté ⚠, dont la continuation n'a plus rien à faire dans la colonne « pourquoi ».
      if (/^[⚠↑]/.test(note)) stop = true;
      else if (last && note && !stop && !/^jour\s*[:=]/i.test(note)) byId[last].note += ' ' + note;
      continue;
    }
    const m = code.match(/^R?(\d{1,3})\b(.*)$/i);
    if (!m) continue;
    const id = parseInt(m[1], 10);
    const ranges = [];
    for (const tok of m[2].trim().split(/\s+/).filter(Boolean)) {
      const mm = tok.match(/^(\d+(?:[.,]\d+)?)[-–](\d+(?:[.,]\d+)?)$/);
      if (mm) ranges.push([parseFloat(mm[1].replace(',', '.')), parseFloat(mm[2].replace(',', '.'))]);
    }
    byId[id] = { ranges: ranges.length ? ranges : null, note };
    last = id; stop = false;
  }
  return byId;
}

const JOURS = readJours();
const plan = readPlan();
if (!plan) { console.error('Aucun Réglages/plan.txt — rien à restituer.'); process.exit(1); }

const files = fs.readdirSync(RUSH)
  .filter((f) => !f.startsWith('.') && VIDEO_EXT.has(path.extname(f).toLowerCase()))
  .filter((f) => !JOURS.length || (() => { const m = f.match(/(\d{8})/); return m && JOURS.includes(m[1]); })())
  .sort((a, b) => ((a.match(/(\d{14})/) || [])[1] || a).localeCompare((b.match(/(\d{14})/) || [])[1] || b));
if (!files.length) { console.error('Aucun rush pour le jour', JOURS.join(', ')); process.exit(1); }

const rows = [];
let gardee = 0, source = 0, autoAvant = 0, nPlans = 0;
files.forEach((f, i) => {
  const id = i + 1;
  const d = dur(path.join(RUSH, f));
  source += d;
  if (d >= MIN_SHOT_PERCEPTIBLE) autoAvant += d;      // ce que le montage auto aurait gardé
  const p = plan[id];
  let decision, kept;
  if (!p) {
    decision = d < MIN_SHOT_PERCEPTIBLE ? '**CUT total**' : '**CUT total**';
    kept = null;
  } else if (!p.ranges) {
    decision = '**entier**'; kept = d;
  } else {
    decision = p.ranges.map(([a, b]) => `fenêtre ${fr(a)}-${fr(b)}`).join(' + ');
    kept = p.ranges.reduce((s, [a, b]) => s + (b - a), 0);
  }
  if (kept != null) { gardee += kept; nPlans++; }
  let why = p ? p.note : (d < MIN_SHOT_PERCEPTIBLE
    ? `déclenchement accidentel (< ${MIN_SHOT_PERCEPTIBLE.toFixed(1)} s), écarté par le moteur`
    : '⚠️ À REMPLIR — rush absent de plan.txt, la raison du cut n\'est écrite nulle part');
  why = why.replace(/\s+/g, ' ').trim() || '⚠️ À REMPLIR';
  rows.push(`| R${String(id).padStart(2, '0')} | ${fr(d)} s | ${decision} | ${kept == null ? '—' : fr(kept) + ' s'} | ${why} |`);
});

const out = [];
if (!NU) {
  out.push(`# Restitution — jour ${JOURS.join(', ') || '(non scopé)'} (généré par restitution.mjs)`, '',
    `> Squelette MESURÉ. Relire chaque « pourquoi », compléter ceux marqués À REMPLIR, puis coller`,
    `> l'entrée dans RESTITUTIONS.md avec son contexte (base de départ, protocole, réserves).`, '');
}
out.push('| R## | durée source | décision | durée gardée | pourquoi |', '|---|---|---|---|---|', ...rows, '');
out.push(`**Bilan : ${mmss(autoAvant)} (${files.filter((f, i) => dur(path.join(RUSH, f)) >= MIN_SHOT_PERCEPTIBLE).length} plans) → `
  + `${mmss(gardee)} (${nPlans} plans)** · plan moyen ${fr(gardee / nPlans)} s · `
  + `${(gardee / autoAvant * 100).toFixed(0)} % de la durée conservée`);
const aRemplir = rows.filter((r) => r.includes('À REMPLIR')).length;
if (aRemplir) out.push('', `⚠️ **${aRemplir} ligne(s) sans raison écrite** — un rush ne se coupe pas en silence (la règle de restitution).`);
console.log(out.join('\n'));
