// etat.mjs — ÉTAT DE BATCH persistant : le fil de la session survit à un clear / changement de machine.
//   node etat.mjs                    → imprime Réglages/etat.txt (résumé aussi dans brief.mjs)
//   node etat.mjs log "message"      → ajoute une ligne datée sous « Journal d'itérations »
//   node etat.mjs decision "message" → ajoute une ligne sous « Décisions » (le POURQUOI du plan)
//   node etat.mjs pending "message"  → ajoute une case à cocher sous « En attente »
//   node etat.mjs done "texte partiel" → coche la 1re case « En attente » qui matche (- [ ] → - [x])
// plan.txt = le plan gelé (QUOI). etat.txt = raisonnement + en-attente + journal (POURQUOI + où j'en suis).
// 100 % offline, aucune dépendance. Édition manuelle du fichier possible à tout moment.
import fs from 'node:fs';
import path from 'node:path';
import { REGLAGES } from './store.mjs';   // les chemins du store : un seul endroit

const REG = REGLAGES;
const FILE = path.join(REG, 'etat.txt');

const SECTIONS = ['Scope', 'Décisions', 'En attente', 'Journal d\'itérations'];
function skeleton() {
  return ['# État du batch — fichier de REPRISE (survit à un clear / changement de machine).',
    '# plan.txt = le plan gelé (QUOI) ; ici = raisonnement + en-attente + journal (POURQUOI + où j\'en suis).',
    '# Édition à la main OU via `node etat.mjs` (log / pending / decision / done). brief.mjs en montre un résumé.',
    '', '## Scope', '(à remplir : jour · look · rendu courant)',
    '', '## Décisions', '', '## En attente', '', '## Journal d\'itérations', ''].join('\n') + '\n';
}
function stamp() {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function read() { try { return fs.readFileSync(FILE, 'utf8'); } catch { return null; } }

// insère `line` à la FIN de la section `header` (juste avant le prochain `## ` ou l'EOF)
function appendUnder(text, header, line) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.trim() === `## ${header}`);
  if (start < 0) throw new Error(`section « ${header} » introuvable dans etat.txt`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) { if (/^##\s/.test(lines[i])) { end = i; break; } }
  // point d'insertion = après la dernière ligne non vide de la section
  let ins = start + 1;
  for (let i = start + 1; i < end; i++) if (lines[i].trim() !== '') ins = i + 1;
  lines.splice(ins, 0, line);
  return lines.join('\n');
}

const [cmd, ...rest] = process.argv.slice(2);
const msg = rest.join(' ').trim();

if (!cmd) {
  const t = read();
  if (t == null) { console.log('(pas d\'etat.txt — `node etat.mjs log "…"` en crée un, ou édite Réglages/etat.txt)'); process.exit(0); }
  console.log(t.replace(/\n$/, ''));
  process.exit(0);
}

if (!['log', 'decision', 'pending', 'done'].includes(cmd)) {
  console.error(`Commande inconnue : ${cmd}. Attendu : (rien) | log | decision | pending | done.`);
  process.exit(1);
}
if (!msg) { console.error(`Usage : node etat.mjs ${cmd} "message"`); process.exit(1); }

let text = read() ?? skeleton();

if (cmd === 'done') {
  const lines = text.split('\n');
  const needle = msg.toLowerCase();
  const idx = lines.findIndex((l) => /^\s*-\s*\[\s\]/.test(l) && l.toLowerCase().includes(needle));
  if (idx < 0) { console.error(`Aucune case « En attente » non cochée ne matche : ${msg}`); process.exit(1); }
  lines[idx] = lines[idx].replace(/\[\s\]/, '[x]');
  text = lines.join('\n');
  console.log(`✓ coché : ${lines[idx].trim()}`);
} else {
  const map = { log: 'Journal d\'itérations', decision: 'Décisions', pending: 'En attente' };
  const line = cmd === 'log' ? `- [${stamp()}] ${msg}`
    : cmd === 'pending' ? `- [ ] ${msg}`
    : `- ${msg}`;
  text = appendUnder(text, map[cmd], line);
  console.log(`+ ${map[cmd]} : ${line}`);
}

fs.writeFileSync(FILE, text.endsWith('\n') ? text : text + '\n');
