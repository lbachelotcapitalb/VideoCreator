// brief.mjs — BRIEF DE SESSION en une commande (lecture seule, instantané, zéro ffmpeg).
// `node brief.mjs` au démarrage d'une session montage → où on en est, d'un coup d'œil :
// jour ciblé, look actif, qualité, résumé plan.txt, dernier(s) rendu(s), taille catalogue.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JOURS, STORE, TESTS } from './store.mjs';   // chemins du store : un seul endroit

const ENG = path.dirname(fileURLToPath(import.meta.url));
const REG = path.join(STORE, 'Réglages');
const OUT = TESTS;                      // rendus de test N/N-1 (cf. store.mjs)
// 1re ligne utile (ignore commentaires # et lignes vides) — comme le fait le moteur.
const read1 = (f) => { try { return fs.readFileSync(f, 'utf8').split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#')) || ''; } catch { return ''; } };
const readAll = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };

// look actif : lut.txt > DA.lut > DA/grade
function look() {
  const lut = read1(path.join(REG, 'lut.txt'));
  if (lut) return `LUT ${lut}`;
  const da = read1(path.join(REG, 'DA.txt'));
  return da ? `DA ${da}` : '(défaut/brut)';
}

console.log('══════ BRIEF MONTAGE ══════');
console.log(`jour ciblé   : ${read1(path.join(REG, 'jour.txt')) || '(tous)'}`);
console.log(`look actif   : ${look()}`);
console.log(`qualité      : ${read1(path.join(REG, 'qualite.txt')) || 'brouillon (défaut)'}`);
const luts = (() => { try { return fs.readdirSync(path.join(REG, 'LUTs')).filter((f) => f.endsWith('.cube')); } catch { return []; } })();
if (luts.length) console.log(`LUTs dispo   : ${luts.map((l) => l.replace('.cube', '')).join(', ')}  (dose: lut.txt = nom 0.6)`);

// plan.txt (plan de coupe curé)
const plan = readAll(path.join(REG, 'plan.txt')).split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
if (plan.length) {
  console.log(`\nplan.txt     : ${plan.length} plans (ordre = montage) — le moteur EXÉCUTE ce plan gelé`);
  for (const l of plan) {
    const flags = (l.match(/\b(hi2?|glow)\b/g) || []).join(' ');
    console.log(`  · ${l}${flags ? '' : ''}`);
  }
} else {
  console.log('\nplan.txt     : (absent) → montage mécanique auto (pas de plan gelé)');
}

// état de batch (etat.txt) — résumé de reprise : scope + en-attente ouverts + dernière itération
const etat = readAll(path.join(REG, 'etat.txt')).split('\n');
if (etat.some((l) => l.trim())) {
  const section = (name) => {
    const i = etat.findIndex((l) => l.trim() === `## ${name}`);
    if (i < 0) return [];
    const out = [];
    for (let j = i + 1; j < etat.length; j++) { if (/^##\s/.test(etat[j])) break; if (etat[j].trim()) out.push(etat[j].trim()); }
    return out;
  };
  const scope = section('Scope');
  const pend = section('En attente').filter((l) => /^-\s*\[\s\]/.test(l));
  const jour = section("Journal d'itérations");
  console.log('\nétat batch   : (Réglages/etat.txt — reprise)');
  scope.forEach((l) => console.log(`  ${l}`));
  console.log(`  en attente : ${pend.length}${pend.length ? '' : ' (rien d’ouvert)'}`);
  pend.slice(0, 3).forEach((l) => console.log(`    ${l}`));
  if (jour.length) console.log(`  dernière it: ${jour[jour.length - 1].replace(/^-\s*/, '')}`);
} else {
  console.log('\nétat batch   : (pas d’etat.txt — node etat.mjs log "…" pour démarrer le fil de reprise)');
}

// catalogue
try {
  const cat = JSON.parse(fs.readFileSync(path.join(ENG, 'catalogue/catalogue.json'), 'utf8'));
  const jours = [...new Set(cat.map((c) => c.jour))].join(', ');
  console.log(`\ncatalogue    : ${cat.length} plans (R01..R${String(cat.length).padStart(2, '0')}), jour(s) ${jours}`);
} catch { console.log('\ncatalogue    : (pas encore catalogué — node catalogue.mjs)'); }

// derniers rendus (N / N-1)
try {
  const mp4 = fs.readdirSync(OUT).filter((f) => f.endsWith('.mp4'))
    .map((f) => ({ f, m: fs.statSync(path.join(OUT, f)).mtimeMs })).sort((a, b) => b.m - a.m);
  console.log(`\nrendus       : ${mp4.length ? '' : '(aucun)'}`);
  mp4.slice(0, 3).forEach((x, i) => console.log(`  ${i === 0 ? 'N  ' : i === 1 ? 'N-1' : '   '} ${x.f}`));
  // Le réflexe N/N-1 ne vise QUE les rendus de test : un « Montage JOUR … (auto) » est le rendu
  // consolidé d'une journée de tournage (un par jour), il se garde.
  const tests = mp4.filter((x) => !/JOUR/i.test(x.f));
  if (tests.length > 2) console.log(`  ⚠ ${tests.length - 2} rendu(s) de test plus ancien(s) à purger (réflexe N/N-1)`);
} catch { console.log('\nrendus       : (dossier absent)'); }

// ── ANTÉRIORITÉ du jour scopé (ajouté 29/07) ────────────────────────────────
// Reprendre un jour déjà travaillé demandait de fouiller « Landscape Rush », montage.log et
// RESTITUTIONS.md pour savoir ce qui existait déjà (4-5 allers-retours sur le jour 20, le 29/07).
// Tout est dérivable ici, en lecture seule : rendus de ce jour, fiche de lecture, entrée de
// restitution, et surtout la COHÉRENCE de l'en-tête « # jour: » de plan.txt (cf. monte.mjs).
try {
  const jour = (read1(path.join(REG, 'jour.txt')) || '').replace(/\D/g, '');
  if (jour.length === 8) {
    const jj = `${jour.slice(6, 8)}-${jour.slice(4, 6)}`;               // 20-07
    // les masters de journée vivent dans « Vidéos finies/Journées » depuis le 31/07 (le monteur :
    // « les rendus bruts vont dans Vidéos finies et pas un dossier de rush ») — cf. store.mjs
    const lsq = (d) => { try { return fs.readdirSync(d); } catch { return []; } };
    const rendus = lsq(JOURS).filter((f) => f.endsWith('.mp4') && f.includes(jj));
    const fiche = path.join(REG, `lecture-${jour.slice(0, 4)}-${jour.slice(4, 6)}-${jour.slice(6, 8)}.md`);
    const ficheOk = fs.existsSync(fiche)
      && /^- \*\*assumé\*\* : (?!quel sujet)/m.test(fs.readFileSync(fiche, 'utf8'));  // remplie ≠ gabarit
    const resti = readAll(path.join(ENG, 'RESTITUTIONS.md')).includes(jj);
    const declared = (readAll(path.join(REG, 'plan.txt')).match(/^\s*#\s*jour\s*[:=]\s*(.+?)\s*$/mi) || [, ''])[1]
      .replace(/\D/g, '');
    console.log(`\nantériorité  : jour ${jj}`);
    console.log(`  rendus de ce jour : ${rendus.length ? rendus.join('  ·  ') : '(aucun)'}`);
    console.log(`  fiche de lecture  : ${!fs.existsSync(fiche) ? '❌ absente (node lecture.mjs)'
      : ficheOk ? '✅ remplie' : '⚠ gabarit vide — à remplir AVANT plan.txt'}`);
    console.log(`  RESTITUTIONS.md   : ${resti ? '✅ entrée présente' : '❌ aucune entrée pour ce jour'}`);
    if (!declared) console.log('  plan.txt          : ⚠ pas d\'en-tête « # jour: » — monte.mjs ne pourra pas vérifier');
    else if (declared !== jour) console.log(`  plan.txt          : ⛔ écrit pour ${declared} ≠ jour scopé ${jour} — monte.mjs REFUSERA de monter`);
    else console.log('  plan.txt          : ✅ en-tête concordante');
  }
} catch { /* antériorité = confort, jamais bloquant */ }

console.log('\nprochaine étape usuelle : node probe.mjs (mesure) · filmstrip.mjs (pellicules) · monte.mjs (rendre)');
console.log('═══════════════════════════');
