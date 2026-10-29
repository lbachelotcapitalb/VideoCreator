#!/usr/bin/env node
// ============================================================================
// facecam/overlays/subs-gate.mjs — LE SOUS-TITRE EST-IL DÉJÀ CONSOMMÉ QUAND IL APPARAÎT ?
//
// POURQUOI cet outil existe (01/09). le monteur, sur le master 4K du #02 : « à 0:10 le
// sous-titre est déjà là et consommé alors que j'ai pas commencé à parler ». Toute
// la chaîne était pourtant verte : la gate mesurait la synchro SON (corrélation
// croisée, 0 ms sur 7 fenêtres), `subs-blocs.mjs` contrôlait qu'aucun évènement ne
// déborde de son bloc ni n'en chevauche un autre, et l'appariement ASS ↔ transcription
// donnait un allumage à 0,000 s du début de chaque mot (1 094 mots, écart max 0,000 s).
// Aucun de ces contrôles ne pouvait voir le défaut : il n'était pas dans les TIMECODES
// mais dans la façon de les CONSOMMER — le tag `\k` bascule le mot en accent d'un coup
// au DÉBUT de sa prononciation, donc à l'instant où la voix attaque, le mot est déjà
// entièrement accent, c'est-à-dire lu comme DÉJÀ DIT. `\kf` le remplit progressivement
// et n'est plein qu'à la fin du mot. Les deux portent les MÊMES timecodes : c'est
// pour ça qu'aucune mesure de synchro ne pouvait les distinguer.
//
// *Un critère vert ne couvre que la dimension qu'il regarde.*
//
// CE QU'IL MESURE, et pourquoi PAS sur le film. Une première version comparait la
// frame d'avant à la frame d'apparition du master, pour isoler le texte par
// différence. Elle s'est déclarée VERTE sur le master fautif — parce que le bloc
// facecam commence 0,02 s avant son premier sous-titre : les deux images sont sur
// des PLANS DIFFÉRENTS, et la différence capte le changement de plan, pas le texte.
// *Un garde-fou neuf se teste sur le cas qu'il doit attraper*, et celui-là mentait.
// On rend donc l'ASS sur un fond NOIR : plus de décor à démêler, la mesure ne voit
// que les glyphes, elle est rejouable pour quelques secondes, et surtout elle se
// prend AVANT le burn — un contrôle qui coûte 27 min de re-rendu ne se prend pas.
//
// VERDICT : à la première image d'un évènement, la part d'accent parmi les pixels de
// glyphe doit être quasi nulle ; à la dernière, quasi totale.
//
// Usage : node facecam/overlays/subs-gate.mjs <film.ass> [--n 10] [--seuil 12]
//                  [--fps 30] [--fontsdir <dir>] [--work <dir>] [--garder]
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = path.resolve(HERE, '..', '..');
const PY = path.join(ENGINE, '.venv-vision/bin/python');

const a = process.argv.slice(2);
const opt = (k, d) => { const i = a.indexOf(k); if (i < 0) return d; const v = a[i + 1]; a.splice(i, 2); return v; };
const N = parseInt(opt('--n', '10'), 10);
const SEUIL = parseFloat(opt('--seuil', '12'));
const FPS = parseFloat(opt('--fps', '30'));
const JSON_OUT = a.includes('--json');
const FONTS = opt('--fontsdir', path.join(ENGINE, 'facecam/assets/fonts'));
const WORK = opt('--work', fs.mkdtempSync(path.join(os.tmpdir(), 'subs-gate-')));
const GARDER = a.includes('--garder');
const ass = a.find((x) => !x.startsWith('--'));

if (!ass) { console.error('usage: subs-gate.mjs <film.ass> [--n 10] [--seuil 12] [--fps 30]'); process.exit(2); }
if (!fs.existsSync(ass)) { console.error(`✗ absent : ${ass}`); process.exit(1); }
// ⚠️ un `ass=` sur un fichier absent ne fait PAS échouer ffmpeg (leçon du 01/09) : le
// film sort entier, simplement sans sous-titres. Un `fontsdir` vide est le même piège
// en plus discret — libass retombe sur une police système et la typo change en silence.
if (!fs.existsSync(FONTS) || !fs.readdirSync(FONTS).some((f) => f.endsWith('.ttf'))) {
  console.error(`✗ fontsdir sans police : ${FONTS}`); process.exit(1);
}
fs.mkdirSync(WORK, { recursive: true });

// ── 1) lire les évènements ───────────────────────────────────────────────────
const P = (t) => { const [h, m, r] = t.split(':'); return +h * 3600 + +m * 60 + parseFloat(r); };
const evs = [];
let playX = 1920, playY = 1080;
const brut = fs.readFileSync(ass, 'utf8');
// l'en-tête PORTE LE STYLE (police, corps, PrimaryColour accent, SecondaryColour blanche) :
// le mini-ASS de mesure doit le reprendre tel quel, sinon on mesure une autre typo.
const iEv = brut.indexOf('[Events]');
if (iEv < 0) { console.error('✗ pas de section [Events]'); process.exit(1); }
const entete = brut.slice(0, iEv);
const fmtLine = (brut.slice(iEv).split('\n').find((L) => /^Format:/.test(L))) || 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text';
for (const L of brut.split('\n')) {
  const px = L.match(/^PlayResX:\s*(\d+)/); if (px) playX = +px[1];
  const py = L.match(/^PlayResY:\s*(\d+)/); if (py) playY = +py[1];
  const m = L.match(/^Dialogue:\s*[^,]*,([^,]*),([^,]*),[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,(.*)$/);
  if (m) evs.push({ st: P(m[1]), en: P(m[2]), body: m[3] });
}
if (!evs.length) { console.error('✗ aucun évènement dans l\'ASS'); process.exit(1); }
// On échantillonne les DÉBUTS DE BLOC — l'évènement précédé de plus de 0,5 s de blanc.
// C'est le cas dont le monteur parle : le sous-titre qui APPARAÎT, pas celui qui s'enchaîne.
const premiers = evs.filter((e, i) => i === 0 || e.st - evs[i - 1].en > 0.5);
const pas = Math.max(1, Math.floor(premiers.length / N));
const echant = premiers.filter((_, i) => i % pas === 0).slice(0, N);
console.log(`${evs.length} évènements · ${premiers.length} débuts de bloc · ${echant.length} mesurés`);
console.log(`rendu sur fond noir ${playX}×${playY} · fontsdir ${path.basename(FONTS)}\n`);

// ── 2) rendre UNE image de l'ASS à l'instant t, sur du noir ──────────────────
// ⚠️ TROIS FORMES ESSAYÉES, DEUX FAUSSES — la façon d'atteindre l'instant t fait
// partie de la mesure. `-ss` APRÈS `-i` fabrique puis jette toutes les images depuis 0
// (18 700 pour un évènement à 10 min : le contrôle dépassait 2 min, donc on ne le
// prenait plus). `-ss` AVANT `-i` sur du `lavfi` est instantané mais remet l'horloge du
// filtergraph à zéro : `ass=` ne voit plus rien et rend du NOIR — un faux « rien à
// signaler », le pire des résultats. `setpts=PTS+t/TB` échoue pareil, pour la même raison.
// La forme juste ne déplace pas l'horloge : elle RECALE l'ÉVÈNEMENT. On écrit un ASS
// d'une seule ligne, remise à 0,10 s, et on rend l'image voulue à 0,10 s + offset. Coût
// constant quel que soit l'instant dans le film, et rien à seeker.
const rendre = (e, offset, nom) => {
  const out = path.join(WORK, `${nom}.png`);
  const mini = path.join(WORK, `${nom}.ass`);
  const T = (s) => { const cs = Math.round(s * 100);
    return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, '0')}`
      + `:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`; };
  fs.writeFileSync(mini, entete + '[Events]\n' + fmtLine + '\n'
    + `Dialogue: 0,${T(0.10)},${T(0.10 + (e.en - e.st))},Default,,0,0,0,,${e.body}\n`);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi',
    '-i', `color=c=black:s=${playX}x${playY}:r=${FPS}:d=${(0.3 + (e.en - e.st)).toFixed(3)}`,
    '-vf', `ass=${mini}:fontsdir=${FONTS}`, '-frames:v', '1', '-ss', (0.10 + offset).toFixed(3),
    out], { stdio: 'ignore' });
  return out;
};

// part d'accent parmi les pixels de GLYPHE (le contour noir et l'ombre sont écartés
// par la luminance ; couleur d'accent du profil et blanc ne diffèrent que par le bleu : 32 vs 255).
const partOcre = (png) => JSON.parse(execFileSync(PY, ['-c', `
import cv2, numpy as np, json
im = cv2.imread(${JSON.stringify(png)})
b, g, r = im[:,:,0].astype(int), im[:,:,1].astype(int), im[:,:,2].astype(int)
lum = 0.299*r + 0.587*g + 0.114*b
glyphe = lum > 110
if glyphe.sum() < 100:
    print(json.dumps({"glyphe": int(glyphe.sum()), "accent": None})); raise SystemExit
accent = (b[glyphe] < 130) & (r[glyphe] > 150)
print(json.dumps({"glyphe": int(glyphe.sum()), "accent": round(100*float(accent.mean()), 1)}))
`], { encoding: 'utf8' }).trim());

// ── 3) mesure ────────────────────────────────────────────────────────────────
const fmt = (s) => { const m = Math.floor(s / 60), r = s - 60 * m; return `${m}:${r.toFixed(2).padStart(5, '0')}`; };
let ko = 0, muets = 0;
const lignes = [], fautifsJson = [];
for (const [i, e] of echant.entries()) {
  const debut = partOcre(rendre(e, 0.5 / FPS, `d${i}`));            // 1re image affichée
  const fin = partOcre(rendre(e, (e.en - e.st) - 1.5 / FPS, `f${i}`)); // dernière image affichée
  const mot = (e.body.match(/\{\\kf?\d+\}([^{]*)/) || [, '?'])[1].trim();
  if (debut.accent === null) { muets++; lignes.push(`  ${fmt(e.st).padStart(8)}  ⚠ rien de rendu — police ou timecode ?`); continue; }
  const bad = debut.accent > SEUIL;
  if (bad) { ko++; fautifsJson.push({ st: +e.st.toFixed(2), tc: fmt(e.st), mot, accent: debut.accent }); }
  lignes.push(`  ${fmt(e.st).padStart(8)}  « ${mot} »`.padEnd(40)
    + `1re image ${String(debut.accent).padStart(5)} %   dernière ${String(fin.accent ?? '—').padStart(5)} %`
    + `   ${bad ? '⛔ déjà consommé' : '✓'}`);
}
// `--json` : la sortie MACHINE, pour que `subs-controle.mjs` n'ait pas à relire du texte
// d'affichage. *Un garde qui parse la prose d'un autre garde casse au premier reformatage.*
if (JSON_OUT) {
  console.log(JSON.stringify({ seuil: SEUIL, n: echant.length, ko, muets,
    fautifs: fautifsJson }, null, 0));
  if (!GARDER) fs.rmSync(WORK, { recursive: true, force: true });
  process.exit(ko || muets === echant.length ? 1 : 0);
}
console.log(lignes.join('\n'));
console.log(`\nseuil ${SEUIL} % d'accent à la 1re image — ${ko} évènement(s) déjà consommé(s) sur ${echant.length}`);
if (!GARDER) fs.rmSync(WORK, { recursive: true, force: true });
if (muets === echant.length) {
  console.error('⛔ AUCUN texte rendu : ASS vide, police absente, ou fps/timecodes incohérents.');
  process.exit(1);
}
if (ko) {
  console.error('⛔ le karaoké est en avance : un mot est accent avant d\'avoir fini d\'être dit.\n'
    + '   Cause connue : tag `\\k` (bascule d\'un coup au début du mot) au lieu de `\\kf`.');
  process.exit(1);
}
console.log('✓ aucun sous-titre n\'apparaît déjà consommé.');
