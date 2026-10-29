#!/usr/bin/env node
// ============================================================================
// facecam/overlays/subs-controle.mjs — LE GARDE QUI EMPÊCHE DE RE-LIVRER LE DÉFAUT
//
// POURQUOI CE FICHIER EXISTE (01/09). le monteur a signalé DEUX fois le même symptôme sur le
// master 4K du #02 — « le sous-titre est déjà là et consommé alors que j'ai pas commencé
// à parler » — et les deux fois TOUS les contrôles de la chaîne étaient au vert : synchro
// son 0 ms sur 7 fenêtres, aucun évènement hors de son bloc, zéro chevauchement, allumage
// à 0,000 s du début de chaque mot sur 1 094 mots. Ils avaient raison, chacun sur SA
// dimension. Le défaut vivait dans deux dimensions que personne ne regardait : la façon de
// CONSOMMER les timecodes (`\k` vs `\kf`) et l'ANCRAGE de la transcription sur la voix.
//
// La leçon qui commande ce fichier n'est pas « il manquait un contrôle », c'est :
// **une règle qui dépend de ma discipline plutôt que d'un outil finira violée**, et sa
// suite — *une règle mécanisée mais déclenchée à la main n'est mécanisée qu'à moitié :
// chercher qui appuie sur le bouton.* Ici le bouton, c'est `burn.mjs` : le seul passage
// obligé entre un ASS et un master livrable. Ce contrôle y est appelé AUTOMATIQUEMENT et
// REFUSE de brûler, exactement comme le garde « source ABSENTE ».
//
// QUATRE DIMENSIONS, parce qu'un critère vert ne couvre que celle qu'il regarde :
//   ① TAG        — zéro `\k` (bascule d'un coup au début du mot). Lecture du fichier.
//   ② PLANCHER   — aucun 1er mot de ligne sous KF_MIN_CS : un `\kf` de 0,01 s se remplit
//                  en une image, donc se lit comme un `\k`. Lecture du fichier.
//   ③ VOIX       — le sous-titre ne part jamais avant la parole, mesuré au SIGNAL (vad.py
//                  `--tete` : le SILENCE AVÉRÉ de tête, jamais un onset) et non dans la
//                  transcription. Demande `--plan` et `--work`. Voir la dette 3 en ligne.
//   ④ RENDU      — part d'accent à la 1re image de chaque début de bloc (subs-gate.mjs).
//                  Demande ffmpeg + les polices.
//
// ⚠️ UNE DIMENSION NON MESURÉE SE DIT, ELLE NE SE TAIT PAS. Sans `--plan`/`--work`, ③ est
// annoncée « NON MESURÉE » et le contrôle échoue en mode strict : *un garde silencieux est
// indiscernable d'un garde débranché.* C'est ce qui empêche de contourner le garde par
// simple omission dans le plan de burn.
//
// ⚠️ LES RÉSERVES CONNUES SE DÉCLARENT ET SE CHIFFRENT. Un garde qui bloque tout ne se
// garde pas, il se contourne : au 01/09 trois blocs du #02 restent en avance (F03, F18,
// F23) et une ligne reste accent à l'apparition (4:07,19), pour des causes nommées et non
// résolues. On ne baisse pas le seuil — on ÉNUMÈRE ces cas avec leur valeur maximale
// acceptée. Une réserve non listée bloque ; une réserve listée qui EMPIRE bloque aussi.
// *Une décision qui contredit une règle doit laisser dans l'artefact de quoi la défaire.*
//
// Usage :
//   node facecam/overlays/subs-controle.mjs <film.ass>
//        [--plan vlog/vlog.plan.json] [--work vlog/work/subs02] [--fontsdir <dir>]
//        [--avance-max 0.15] [--tolere-avance F03:1.05,F18:0.75] [--tolere-accent 4:07.19]
//        [--sans-rendu] [--souple] [--lexique <lexique.json>] [--tolere-texte <mot,…>]
//        [--voix-detail]                 ← la table VOIX bloc par bloc, pour rejouer un invariant
//   → exit 0 si tout est vert, 1 si une dimension mord (ou n'est pas mesurable).
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PY = path.resolve(HERE, '..', '..', '.venv-vision/bin/python');
const a = process.argv.slice(2);
const opt = (n, d) => { const i = a.indexOf(n); if (i < 0) return d; const v = a[i + 1]; a.splice(i, 2); return v; };
const planPath = opt('--plan', null);
const work = opt('--work', null);
const fontsdir = opt('--fontsdir', null);
const lexPath = opt('--lexique', null);
const tolTexte = (opt('--tolere-texte', '') || '').split(',').map((x) => x.trim()).filter(Boolean);
const AVANCE_MAX = parseFloat(opt('--avance-max', '0.15'));
const tolAvance = Object.fromEntries((opt('--tolere-avance', '') || '').split(',').filter(Boolean)
  .map((x) => { const [k, v] = x.split(':'); return [k.trim(), parseFloat(v)]; }));
const tolOcre = (opt('--tolere-accent', '') || '').split(',').map((x) => x.trim()).filter(Boolean);
const sansRendu = a.includes('--sans-rendu');
const souple = a.includes('--souple');      // rapporte sans bloquer — INSTRUCTION seulement
const assPath = a.find((x) => !x.startsWith('--'));
if (!assPath) {
  console.error('usage: subs-controle.mjs <film.ass> [--plan p.json] [--work dir] [--avance-max 0.15]'
    + ' [--tolere-avance F03:1.05] [--tolere-accent 4:07.19] [--sans-rendu] [--souple] [--voix-detail]');
  process.exit(2);
}
if (!fs.existsSync(assPath)) { console.error(`✗ ASS introuvable : ${assPath}`); process.exit(2); }

const KF_MIN_CS = 10;                       // même constante que subs.mjs et subs-recale.mjs
const P = (s) => { const [h, m, x] = s.split(':'); return +h * 3600 + +m * 60 + parseFloat(x); };
const fmt = (s) => { const m = Math.floor(s / 60), r = s - 60 * m; return `${m}:${r.toFixed(2).padStart(5, '0')}`; };
const txt = fs.readFileSync(assPath, 'utf8');
const dialogues = txt.split('\n').filter((l) => l.startsWith('Dialogue'));
const dims = [];                            // { nom, etat: 'vert'|'rouge'|'non mesuré', detail }

// ── ① TAG ───────────────────────────────────────────────────────────────────
{
  const k = (txt.match(/\{\\k\d/g) || []).length;
  dims.push({ nom: 'TAG      `\\kf` et jamais `\\k`', etat: k ? 'rouge' : 'vert',
    detail: k ? `${k} tag(s) \\k — le mot bascule en accent au DÉBUT de sa prononciation`
              : `${(txt.match(/\{\\kf\d/g) || []).length} tags \\kf, 0 \\k` });
}

// ── ② PLANCHER ──────────────────────────────────────────────────────────────
{
  const courts = [];
  for (const l of dialogues) {
    // ⚠️ `\\kf?` ET NON `\\kf` : sur un ASS encore en `\k`, une regex qui n'accepte que
    // `\kf` ne trouve RIEN et cette dimension se déclare VERTE sans avoir rien mesuré —
    // le défaut même que ce fichier existe pour empêcher. Un contrôle qui ne matche pas
    // son entrée doit se taire, pas se féliciter.
    const m = l.match(/^Dialogue:\s*[^,]*,([^,]*),[^,]*,(?:[^,]*,){6}\{\\kf?(\d+)\}([^{]*)/);
    if (m && +m[2] < KF_MIN_CS) courts.push(`${m[1].slice(3)} « ${m[3].trim()} » ${(+m[2] / 100).toFixed(2)} s`);
  }
  const vus = dialogues.filter((l) => /\{\\kf?\d/.test(l)).length;
  dims.push({ nom: `PLANCHER 1er mot ≥ ${KF_MIN_CS} cs`,
    etat: courts.length ? 'rouge' : (vus ? 'vert' : 'non mesuré'),
    detail: courts.length ? `${courts.length} ligne(s) : ${courts.slice(0, 4).join(' · ')}${courts.length > 4 ? ' …' : ''}`
      : vus ? `${vus} lignes karaoké, aucune sous ${(KF_MIN_CS / 100).toFixed(2)} s`
            : `aucune ligne karaoké trouvée dans ${dialogues.length} dialogues — rien n'a été mesuré` });
}

// ── ③ VOIX — mesurée au SIGNAL, jamais dans la transcription ────────────────
{
  if (!planPath || !work || !fs.existsSync(planPath) || !fs.existsSync(work) || !fs.existsSync(PY)) {
    dims.push({ nom: 'VOIX     le sous-titre ne part pas avant la parole', etat: 'non mesuré',
      detail: 'il manque --plan et/ou --work (ou le venv) — dimension AVEUGLE, pas verte' });
  } else {
    const PLAN = JSON.parse(fs.readFileSync(planPath, 'utf8'));
    // ⭐ UN PLAN DE SIMULATION NE JUGE PAS UN LIVRABLE (20/09, dette n°8). `vlog.mjs --dry`
    // calcule ses durées au lieu de les mesurer : sur l'EP3 les bornes de bloc dérivaient
    // jusqu'à +0,098 s, assez pour faire mordre une réserve déclarée au millième. On REFUSE
    // au lieu de mesurer faux — *une dimension aveugle n'est pas une dimension verte*, et
    // une dimension qui mesure sur un artefact de simulation est pire : elle se croit juste.
    if (PLAN._dry) {
      dims.push({ nom: 'VOIX     le sous-titre ne part pas avant la parole', etat: 'non mesuré',
        detail: `${path.basename(planPath)} est un plan de SIMULATION (_dry) — durées calculées, `
          + 'pas mesurées. Relancer un vrai rendu, ou pointer --plan sur vlog.plan.json.' });
    } else {
    const F = PLAN.pieces.filter((p) => p.kind === 'F');
    const evs = dialogues.map((l) => { const m = l.match(/^Dialogue:\s*[^,]*,([^,]*),/); return { st: P(m[1]) }; });
    const mordent = [], tolerees = [], aveugles = [], table = [];
    let mesures = 0;
    for (const [k, b] of F.entries()) {
      const id = 'F' + String(k + 1).padStart(2, '0');
      const w = path.join(work, `${id}.wav`);
      // ⚠️ UN BLOC QU'ON NE SAIT PAS MESURER SE DÉCLARE, IL NE SE SAUTE PAS (20/09, dette 3).
      // Les trois `continue` d'origine — wav absent, aucun évènement, vad muet — faisaient
      // sortir un bloc du décompte SANS le dire, et la dimension affichait quand même
      // « N blocs mesurés ». C'est le motif du 19/09 (la carte de l'EP02 : la dimension
      // QUEUE n'a jamais tourné et le quitus a écrit « toutes dimensions mesurées »).
      // *Un garde qui DÉCLARE avoir regardé est pire qu'un garde muet.*
      if (!fs.existsSync(w)) { aveugles.push(`${id} wav absent`); continue; }
      // ⚠️ TOLÉRANCE 0,02 s ET NON 0,001 : les timecodes ASS sont arrondis au CENTIÈME,
      // une borne à 71,033 s s'y écrit « 71.03 ». Une tolérance plus fine que l'arrondi du
      // fichier fait SAUTER le premier évènement d'un bloc, et le contrôle mesure alors le
      // suivant — trois blocs du #02 sont sortis faux, dans le sens rassurant.
      // ⭐ LA RECHERCHE DU 1er SOUS-TITRE NE PEUT PAS COMMENCER À `t0` (20/09, trouvé par le
      // banc `subs-voix-cas.mjs`, cas ②). La v1 cherchait dans `[t0 − 0,02 ; t1[` : un
      // évènement posé AVANT le début de son bloc — c'est-à-dire l'avance MAXIMALE, celle
      // qui déborde sur la bande paysage précédente — sortait de la fenêtre de recherche,
      // et le contrôle mesurait alors le sous-titre SUIVANT. Le garde sortait VERT sur le
      // défaut le plus gros qu'il puisse y avoir. Éprouvé : F19 avancé d'une seconde entière
      // passait inaperçu.
      // On descend donc la borne basse à la fin du bloc F précédent : un sous-titre posé
      // dans l'intervalle entre deux blocs n'appartient à la parole d'aucun des deux, et
      // l'attribuer au bloc qui SUIT est exactement le dire « il est parti trop tôt ».
      // ⚠️ La tolérance de 0,02 s reste, et elle reste nécessaire : les timecodes ASS sont
      // arrondis au CENTIÈME (une borne à 71,033 s s'y écrit « 71.03 »).
      const bas = Math.min(b.t0 - 0.02, k > 0 ? F[k - 1].t1 : b.t0 - 0.02);
      const prem = evs.find((e) => e.st >= bas && e.st < b.t1);
      if (!prem) { aveugles.push(`${id} aucun évènement dans [${bas.toFixed(2)}–${b.t1.toFixed(2)}]`); continue; }
      // ⭐⭐ LA GRANDEUR JUSTE N'EST PAS L'ONSET, C'EST LE SILENCE AVÉRÉ (20/09, dette 3).
      // La v1 appelait `vad.py <bloc.wav>` nu, c'est-à-dire `bornes()[0]` : le début de la
      // 1re île, donc un ONSET — calé sur un pic tenu, et daté avec des seuils relatifs au
      // p95 DU FICHIER qu'on lui donne. Sur un bloc long dont la parole monte en volume,
      // l'attaque douce passe sous le seuil et l'onset tombe trop TARD : F08 de l'EP3 était
      // annoncé à **+1,293 s** d'avance alors que sa tête [0→1,60 s], transcrite seule, dit
      // « C'est une ville qui est plus historique ». Une réserve chiffrée a été posée dans
      // les deux plans de burn pour un défaut qui n'existait pas.
      //
      // C'est mot pour mot la leçon du 19/09 déjà payée dans `parole.mjs` §(d) : *on ne
      // demande pas « où commence l'île » mais « combien de SILENCE AVÉRÉ y a-t-il devant
      // la parole »* — et *un instrument qui se trompe DANS LE SENS DE L'ALERTE fait
      // corriger ce qui n'était pas cassé*. « Qui d'autre a la même forme ? » avait ici une
      // réponse, et c'était un outil du même dossier.
      //
      // On appelle donc `vad.py --tete` (`air_de_tete`) et on compare le 1er sous-titre à
      // `fin` — l'instant où le plus long creux AVÉRÉ s'achève, c'est-à-dire le dernier
      // instant où l'on est SÛR que rien n'a encore été dit. Par construction la sonde ne
      // peut plus accuser sans avoir mesuré du silence.
      //
      // ⚠️ La « fenêtre ÉTROITE de tête » que prescrivait la note de reprise a été ÉPROUVÉE
      // puis écartée, et c'est mesuré : sur un bloc qui s'ouvre 3,6 s avant la parole, une
      // fenêtre de 2,5 s ne contient que du fond de salle, `vad.py` y rend `debut: null`, et
      // l'ancien code faisait alors `continue` — un faux négatif SILENCIEUX, c'est-à-dire
      // l'erreur dans le pire sens. Une fenêtre fixe ne peut pas voir au-delà de son bord.
      // *Une note qui décrit un remède est une hypothèse comme une autre.*
      const v = JSON.parse(execFileSync(PY, [path.join(HERE, 'vad.py'), '--tete', w], { encoding: 'utf8' }))[w];
      if (!v || v.fin == null) { aveugles.push(`${id} aucune parole trouvée par vad.py`); continue; }
      mesures++;
      // arrondi au millième AVANT de comparer : une avance de 0,150 s stockée
      // 0,15000000000000002 mordait sur un seuil de 0,15 — un garde ne doit pas
      // dépendre de la représentation flottante de sa propre unité.
      const avance = +((b.t0 + v.fin) - prem.st).toFixed(3);
      table.push({ id, t0: +b.t0.toFixed(3), ev: +prem.st.toFixed(3), fin: v.fin, air: v.air, onset: v.onset, avance });
      if (avance <= AVANCE_MAX) continue;
      const plafond = tolAvance[id];
      if (plafond !== undefined && avance <= plafond) tolerees.push(`${id} +${avance.toFixed(2)} s`);
      else mordent.push(`${id} +${avance.toFixed(2)} s à ${fmt(prem.st)}${plafond !== undefined ? ` (toléré ≤ ${plafond})` : ''}`);
    }
    // ⚠️ LE PIRE BLOC S'AFFICHE MÊME QUAND TOUT EST VERT. « 22 blocs mesurés » ne permet
    // pas de rejouer un invariant : c'est ce qui a rendu la dette 3 invisible pendant un
    // épisode entier. On imprime donc la marge la plus étroite, et `--voix-detail` sort la
    // table complète — *un contrôle qu'on ne peut pas auditer se croit sur parole.*
    const pire = table.slice().sort((x, y) => y.avance - x.avance).slice(0, 3)
      .map((r) => `${r.id} ${r.avance >= 0 ? '+' : ''}${r.avance.toFixed(3)}`).join(' · ');
    if (a.includes('--voix-detail')) {
      console.log('\n── VOIX, bloc par bloc (avance = t0 + fin du creux avéré − 1er sous-titre) ──');
      for (const r of table) console.log(`  ${r.id}  t0 ${String(r.t0).padStart(9)}  1er ST ${String(r.ev).padStart(9)}`
        + `  air ${String(r.air).padStart(5)}  fin ${String(r.fin).padStart(5)}  onset ${String(r.onset).padStart(5)}`
        + `  →  avance ${(r.avance >= 0 ? '+' : '') + r.avance.toFixed(3)}`);
      console.log();
    }
    dims.push({ nom: `VOIX     avance ≤ ${AVANCE_MAX.toFixed(2)} s`,
      etat: mordent.length ? 'rouge' : (aveugles.length ? 'non mesuré' : 'vert'),
      detail: (mordent.length ? `${mordent.length} bloc(s) : ${mordent.join(' · ')}` : `${mesures}/${F.length} blocs mesurés, pire marge ${pire}`)
        + (tolerees.length ? `  ·  réserves déclarées : ${tolerees.join(' · ')}` : '')
        + (aveugles.length ? `  ·  ⚠️ ${aveugles.length} bloc(s) NON MESURÉ(S) : ${aveugles.join(' · ')}` : '') });
    }
  }
}

// ── ④ RENDU — la seule dimension qui regarde des PIXELS ─────────────────────
{
  if (sansRendu) {
    dims.push({ nom: 'RENDU    accent à la 1re image', etat: 'non mesuré', detail: '--sans-rendu' });
  } else {
    try {
      const args = [path.join(HERE, 'subs-gate.mjs'), assPath, '--n', '28', '--json'];
      if (fontsdir) args.push('--fontsdir', fontsdir);
      let sortie = '';
      try { sortie = execFileSync(process.execPath, args, { encoding: 'utf8' }); }
      catch (e) { sortie = (e.stdout || '').toString(); if (!sortie.trim()) throw e; }
      const r = JSON.parse(sortie.trim().split('\n').pop());
      const mordent = r.fautifs.filter((f) => !tolOcre.includes(f.tc));
      const tol = r.fautifs.filter((f) => tolOcre.includes(f.tc));
      dims.push({ nom: `RENDU    accent ≤ ${r.seuil} % à la 1re image`, etat: mordent.length || r.muets === r.n ? 'rouge' : 'vert',
        detail: (r.muets === r.n ? 'AUCUN texte rendu — police absente ou timecodes incohérents'
          : mordent.length ? `${mordent.length} : ${mordent.map((f) => `${f.tc} « ${f.mot} » ${f.accent} %`).join(' · ')}`
          : `${r.n} débuts de bloc mesurés`)
          + (tol.length ? `  ·  réserves déclarées : ${tol.map((f) => `${f.tc} ${f.accent} %`).join(' · ')}` : '') });
    } catch (e) {
      dims.push({ nom: 'RENDU    accent à la 1re image', etat: 'non mesuré',
        detail: `subs-gate n'a pas pu tourner : ${String(e.message).split('\n')[0]}` });
    }
  }
}

// ── ⑤ TEXTE — la dimension qui relit ce qui est ÉCRIT ───────────────────────
// ⭐ POURQUOI ELLE EXISTE (20/09). Les quatre dimensions d'au-dessus étaient VERTES sur
// un ASS qui disait « des Ouzbékistan » et « la capitale Ouïghours » — deux fautes
// d'accord que le rattrapage flou du lexique avait fabriquées, et qui sont parties dans
// le master. Elles ont été trouvées en RELISANT les noms propres à la main, pas par un
// garde. Tag, plancher, horloge, rendu : aucun ne lit le TEXTE. *Un critère vert ne
// couvre que la dimension qu'il regarde* — et il en manquait une, la seule que le monteur VOIT.
//
// Deux tests, tous deux dérivés des deux fautes réellement payées, jamais inventés :
//   ⓐ GRAPHIE FAUSSE SURVIVANTE — les clés du lexique SONT la liste des graphies que
//     whisper est connu pour produire de travers. Si l'une d'elles est encore dans le
//     texte livré, le lexique n'a pas mordu. Test à zéro faux positif par construction…
//     ⚠️ SAUF pour les clés où graphie fausse == graphie correcte (`Chengdu`, `Datong`,
//     `Almaty`, `TikTok` : elles ne sont là que pour BLOQUER le rattrapage flou). Les
//     tester ferait crier le garde sur le mot juste — mesuré : 4 faux positifs sur l'EP3.
//     Les `_fusions` sont testées sur la PAIRE de jetons, qui est ce qu'elles réparent.
//   ⓑ ACCORD APRÈS UN NOMBRE — « 25 an » au lieu de « 25 ans ». Mesuré sur le corpus
//     réel de l'EP3 : 7 suites nombre+mot, 7 justes, donc 0 faux positif. Deux exemptions
//     NOMMÉES, tirées de ce corpus : une DATE (« 14 juillet ») est un ordinal, elle ne
//     s'accorde pas ; un mot de 1-2 lettres est une unité (« 20 h »), pas un nom.
//
// ⚠️ Les frontières de mot se posent en LOOKAROUND sur une classe de lettres accentuées,
// jamais en `\b` : `\b` est ASCII, donc « Ouïghours » se coupe sur le « ï » et le motif
// mord là où il ne devrait pas.
{
  const NL = "[\\wÀ-ÖØ-öø-ÿ’'-]";              // une lettre de mot, accents compris
  const ech = (k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const mot = (k) => new RegExp(`(?<!${NL})${ech(k)}(?!${NL})`);
  const plein = dialogues.map((l) => l.split(',').slice(9).join(',').replace(/\{[^}]*\}/g, '')).join(' ');
  if (!lexPath) {
    dims.push({ nom: 'TEXTE    graphies et accords', etat: 'non mesuré',
      detail: 'il manque --lexique <lexique.json> — dimension AVEUGLE, pas verte' });
  } else if (!fs.existsSync(lexPath)) {
    dims.push({ nom: 'TEXTE    graphies et accords', etat: 'non mesuré',
      detail: `lexique introuvable : ${lexPath}` });
  } else {
    const lex = JSON.parse(fs.readFileSync(lexPath, 'utf8'));
    const fautes = [];
    let testees = 0;
    for (const [k, v] of Object.entries(lex)) {
      if (k.startsWith('_') || typeof v !== 'string' || k === v) continue;
      testees++;
      if (mot(k).test(plein) && !tolTexte.includes(k)) fautes.push(`« ${k} » (devrait être « ${v} »)`);
    }
    for (const f of (lex._fusions || [])) {
      if (!Array.isArray(f) || f.length < 3) continue;
      // ⚠️ MESURÉ AU BANC (20/09) : la paire ['a','voulu'] → « l'État a voulu » criait sur
      // l'ASS LIVRÉ, c'est-à-dire sur le texte DÉJÀ RÉPARÉ — parce que le remplacement
      // CONTIENT la paire qu'il corrige. Un motif que la bonne réponse contient ne peut
      // pas signaler un défaut : on l'écarte, sinon le garde crie à chaque succès.
      if (new RegExp(`(?<!${NL})${ech(f[0])}\\s+${ech(f[1])}(?!${NL})`).test(f[2])) continue;
      testees++;
      const paire = new RegExp(`(?<!${NL})${ech(f[0])}\\s+${ech(f[1])}(?!${NL})`);
      if (paire.test(plein) && !tolTexte.includes(`${f[0]} ${f[1]}`)) {
        fautes.push(`« ${f[0]} ${f[1]} » (devrait être « ${f[2]} »)`);
      }
    }
    const MOIS = /^(janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[ûu]t|septembre|octobre|novembre|d[ée]cembre)$/i;
    // ⚠️ MESURÉ AU BANC (20/09) : ma 1re version exemptait tout mot de ≤ 2 lettres « parce
    // que c'est une unité » — et « 25 an », le cas d'école même de cette dimension, fait
    // DEUX lettres. Le test ne mordait pas sur le défaut qu'il existe pour attraper.
    // Une exemption se NOMME ; une exemption déduite d'une forme attrape ce qu'elle n'a
    // pas vu. Liste explicite, donc relisable et contestable.
    const UNITES = /^(h|min|s|ms|km|m|cm|mm|kg|g|t|L|ml|%|€|\$|k|M|Go|Mo|To|km\/h|fps|px)$/;
    const accords = [];
    let nombres = 0;
    for (const m of plein.matchAll(/(?<![\d,.])(\d[\d   ]*)\s+([A-Za-zÀ-ÖØ-öø-ÿ][\wÀ-ÖØ-öø-ÿ’'-]*)/g)) {
      const n = parseInt(m[1].replace(/\D/g, ''), 10);
      const w = m[2];
      if (!(n >= 2) || UNITES.test(w) || MOIS.test(w)) continue;   // unité, date : pas un accord
      nombres++;
      if (!/[sxz]$/i.test(w) && !tolTexte.includes(`${n} ${w}`)) accords.push(`« ${n} ${w} »`);
    }
    const tout = [...fautes, ...accords];
    dims.push({ nom: 'TEXTE    graphie fausse + accord après un nombre',
      etat: tout.length ? 'rouge' : 'vert',
      detail: tout.length
        ? `${tout.length} : ${tout.slice(0, 5).join(' · ')}${tout.length > 5 ? ' …' : ''}`
        : `${testees} graphie(s) fausse(s) absente(s), ${nombres} accord(s) après un nombre vérifié(s)`
          + (tolTexte.length ? `  ·  réserves déclarées : ${tolTexte.join(' · ')}` : '') });
  }
}

// ── verdict ─────────────────────────────────────────────────────────────────
const ic = { vert: '✅', rouge: '⛔', 'non mesuré': '⚠️ ' };
console.log(`\n══════ CONTRÔLE DES SOUS-TITRES — ${path.basename(assPath)} ══════\n`);
for (const d of dims) console.log(`  ${ic[d.etat]} ${d.nom.padEnd(38)} ${d.detail}`);
const rouges = dims.filter((d) => d.etat === 'rouge');
const aveugles = dims.filter((d) => d.etat === 'non mesuré');
console.log();
if (!rouges.length && !aveugles.length) { console.log(`══════ ✅ LES ${dims.length} DIMENSIONS SONT VERTES ══════`); process.exit(0); }
if (rouges.length) console.error(`⛔ ${rouges.length} dimension(s) en défaut : ${rouges.map((d) => d.nom.split(' ')[0]).join(', ')}`);
if (aveugles.length) console.error(`⚠️  ${aveugles.length} dimension(s) NON MESURÉE(S) : ${aveugles.map((d) => d.nom.split(' ')[0]).join(', ')}`
  + '\n   Une dimension aveugle n\'est pas une dimension verte. Fournir --plan/--work, ou assumer avec --souple.');
if (souple) { console.log('\n--souple : rapporté, non bloquant.'); process.exit(0); }
process.exit(1);
