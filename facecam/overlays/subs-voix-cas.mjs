#!/usr/bin/env node
// ============================================================================
// facecam/overlays/subs-voix-cas.mjs — LE BANC DE LA DIMENSION ③ VOIX, rejouable.
//
// POURQUOI CE FICHIER EXISTE (20/09, dette 3). La dimension VOIX de `subs-controle.mjs`
// est l'instrument qui a jugé le master de l'EP3 avant sa publication, et il s'était
// trompé : il appelait `vad.py` nu, c'est-à-dire `bornes()[0]` — un ONSET, calé sur un
// pic tenu et daté avec des seuils relatifs au p95 DU FICHIER. Sur F08 (bloc de 8,5 s
// dont la parole monte en volume) il annonçait **+1,293 s d'avance** là où la tête du
// bloc, transcrite seule, dit « C'est une ville qui est plus historique ». Une réserve
// chiffrée a été posée dans les DEUX plans de burn pour un défaut qui n'existait pas.
//
// *Un instrument qui se trompe DANS LE SENS DE L'ALERTE fait corriger ce qui n'était pas
// cassé* — et celui-là avait déjà été payé le 19/09 dans `parole.mjs`. La correction n'est
// donc pas un réglage : c'est un changement de GRANDEUR. On ne demande plus « où commence
// l'île » mais « combien de SILENCE AVÉRÉ y a-t-il devant la parole » (`vad.py --tete`).
//
// ⚠️ ET LA FENÊTRE ÉTROITE QUE PRESCRIVAIT LA NOTE DE REPRISE A ÉTÉ ÉCARTÉE, MESURE À
// L'APPUI — cas ③ ci-dessous. Une fenêtre fixe ne voit pas au-delà de son bord : sur un
// bloc qui s'ouvre 3,6 s avant la parole, `vad.py` sur une fenêtre de 2,5 s rend
// `debut: null`, donc le garde se tait. *Une note qui décrit un remède est une hypothèse
// comme une autre.*
//
// LES DEUX SENS, parce qu'un banc à un seul sens ne prouve rien :
//   ① NE DOIT PAS ATTRAPER — l'ASS livré de l'EP3, ses 22 blocs, son vrai plan. Le vrai
//      contrôle négatif, c'est les 22 blocs, pas un bloc choisi parce qu'il est propre.
//   ② DOIT ATTRAPER — le même ASS, un évènement de tête avancé de 1,00 s. Le défaut est
//      injecté là où l'instrument REGARDE (leçon du 06/09 : saboter l'EDL ne prouve rien
//      sur un garde qui lit le master).
//   ③ LA FENÊTRE FIXE SE TAIT — 3,6 s de fond de salle RÉEL devant un bloc : `--tete`
//      voit 3,5 s, une fenêtre de 2,5 s ne voit rien du tout.
//   ④ NE DOIT PAS DEVENIR VERT PAR OMISSION — `--work` pointé sur un dossier vide : la
//      dimension doit sortir NON MESURÉE, jamais verte.
//
// Usage : node facecam/overlays/subs-voix-cas.mjs
//   Sortie non nulle dès qu'un cas ne se comporte pas comme annoncé.
// ============================================================================
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { STORE } from '../../store.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = path.resolve(HERE, '..', '..');
const PY = path.join(ENGINE, '.venv-vision', 'bin', 'python');
const VAD = path.join(HERE, 'vad.py');
const CTRL = path.join(HERE, 'subs-controle.mjs');

const ASS = path.join(ENGINE, 'facecam', 'assets', 'sous-titres', 'VLOG_Chine_03.ass');
const PLAN = path.join(ENGINE, 'vlog', 'vlog.plan.json');
const LEX = path.join(ENGINE, 'facecam', 'assets', 'lexiques', 'lexique_chine_03.json');
const WORK = path.join(STORE, '.coulisses', 'facecam', 'subs03', 'livre');

for (const [q, p] of [['ASS livré', ASS], ['plan de merge', PLAN], ['wav de bloc', WORK], ['venv', PY]]) {
  if (!fs.existsSync(p)) { console.error(`✗ ${q} introuvable : ${p}\n  ce banc s'appuie sur la matière de l'EP3.`); process.exit(2); }
}
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'svcas-'));
const ff = (...a) => execFileSync('ffmpeg', ['-y', '-v', 'error', ...a]);
// `--sans-rendu` : cette dimension-ci n'est pas le sujet du banc, et elle coûte un rendu.
const ctrl = (ass, work, extra = []) => {
  const args = [CTRL, ass, '--plan', PLAN, '--work', work, '--lexique', LEX, '--sans-rendu', '--souple', ...extra];
  try { return execFileSync(process.execPath, args, { encoding: 'utf8' }); }
  catch (e) { return ((e.stdout || '') + (e.stderr || '')).toString(); }
};
const ligneVoix = (s) => (s.split('\n').find((l) => /VOIX/.test(l)) || '').trim();

const cas = [];
const dit = (ok, nom, attendu, mesure) => { cas.push(ok); console.log(`${ok ? '✓' : '⛔'} ${nom.padEnd(52)} ${attendu}\n    → ${mesure}`); };

console.log(`\nBANC — dimension ③ VOIX de subs-controle.mjs  (matière : EP3, ${path.basename(ASS)})\n`);

// ── ① NE DOIT PAS ATTRAPER : l'ASS livré, ses 22 blocs, sans aucune réserve ──
{
  const s = ctrl(ASS, WORK);
  const l = ligneVoix(s);
  const ok = /✅/.test(l) && /22\/22 blocs mesurés/.test(l) && !/réserves déclarées/.test(l);
  dit(ok, '① ASS livré (22 blocs, 0 réserve)', 'doit rester MUET et mesurer 22/22', l || '(pas de ligne VOIX)');
}

// ── ② DOIT ATTRAPER : un évènement de tête avancé de 1,00 s ─────────────────
// Le défaut est injecté dans l'ASS, c'est-à-dire là où l'instrument regarde vraiment.
{
  const DEC = 1.00, CIBLE = 'F19';               // bloc court, marge d'avance la plus étroite
  const PLANJ = JSON.parse(fs.readFileSync(PLAN, 'utf8'));
  const b = PLANJ.pieces.filter((p) => p.kind === 'F')[+CIBLE.slice(1) - 1];
  const P = (s) => { const [h, m, x] = s.split(':'); return +h * 3600 + +m * 60 + parseFloat(x); };
  const T = (v) => { const h = Math.floor(v / 3600), m = Math.floor((v - 3600 * h) / 60), r = v - 3600 * h - 60 * m;
    return `${h}:${String(m).padStart(2, '0')}:${r.toFixed(2).padStart(5, '0')}`; };
  let fait = false;
  const lignes = fs.readFileSync(ASS, 'utf8').split('\n').map((l) => {
    if (fait || !l.startsWith('Dialogue')) return l;
    const m = l.match(/^(Dialogue:\s*[^,]*,)([^,]*)(,.*)$/);
    if (!m) return l;
    const st = P(m[2]);
    if (st < b.t0 - 0.02 || st >= b.t1) return l;
    fait = true;
    return `${m[1]}${T(st - DEC)}${m[3]}`;
  });
  const cible = path.join(TMP, 'defaut.ass');
  fs.writeFileSync(cible, lignes.join('\n'));
  const l = ligneVoix(ctrl(cible, WORK));
  const m = l.match(new RegExp(`${CIBLE} \\+([\\d.]+) s`));
  const ok = fait && /⛔/.test(l) && m && Math.abs(+m[1] - DEC) <= 0.06;
  dit(ok, `② ${CIBLE} avancé de ${DEC.toFixed(2)} s dans l'ASS`, `doit CRIER ${CIBLE} à +${DEC.toFixed(2)} s`, l || '(pas de ligne VOIX)');
}

// ── ③ LA FENÊTRE FIXE SE TAIT LÀ OÙ `--tete` VOIT ───────────────────────────
// 3,6 s de fond de salle RÉEL (le creux le plus profond de F14, bouclé) devant F10.
{
  const src = path.join(WORK, 'F14.wav'), voix = path.join(WORK, 'F10.wav');
  const tone = path.join(TMP, 'tone.wav'), long = path.join(TMP, 'tone36.wav');
  const cas36 = path.join(TMP, 'cas36.wav'), fen = path.join(TMP, 'cas36-2s5.wav');
  ff('-ss', '20.04', '-t', '1.20', '-i', src, '-ar', '16000', '-ac', '1', tone);
  ff('-stream_loop', '3', '-i', tone, '-t', '3.60', '-ar', '16000', '-ac', '1', long);
  ff('-i', long, '-i', voix, '-filter_complex', '[0:a][1:a]concat=n=2:v=0:a=1', '-ar', '16000', '-ac', '1', cas36);
  ff('-i', cas36, '-t', '2.5', '-ar', '16000', '-ac', '1', fen);
  const muet = JSON.parse(execFileSync(PY, [VAD, '--iles', long], { encoding: 'utf8' }))[long];
  const tete = JSON.parse(execFileSync(PY, [VAD, '--tete', cas36], { encoding: 'utf8' }))[cas36];
  const etroite = JSON.parse(execFileSync(PY, [VAD, fen], { encoding: 'utf8' }))[fen];
  const ok = muet.length === 0 && tete && Math.abs(tete.onset - 3.60) <= 0.10 && (!etroite || etroite.debut == null);
  dit(ok, '③ 3,60 s de fond de salle réel devant F10',
    'la fenêtre de 2,5 s doit rendre null (aveugle), `--tete` doit voir ~3,60 s',
    `fond de salle : ${muet.length} île(s) · --tete onset ${tete && tete.onset} s · fenêtre 2,5 s debut ${etroite && etroite.debut}`);
}

// ── ④ NE DOIT PAS DEVENIR VERT PAR OMISSION ─────────────────────────────────
{
  const vide = fs.mkdtempSync(path.join(TMP, 'vide-'));
  const l = ligneVoix(ctrl(ASS, vide));
  const ok = /⚠️|non mesuré|NON MESURÉ/.test(l) && !/✅/.test(l);
  dit(ok, '④ --work sur un dossier VIDE', 'la dimension doit sortir NON MESURÉE', l || '(pas de ligne VOIX)');
}

fs.rmSync(TMP, { recursive: true, force: true });
const ko = cas.filter((x) => !x).length;
console.log(`\n${ko ? `⛔ ${ko} cas sur ${cas.length} ne se comporte pas comme annoncé` : `✓ les ${cas.length} cas passent — l'instrument voit ce qu'il doit voir, et se tait sur le reste`}\n`);
process.exit(ko ? 1 : 0);
