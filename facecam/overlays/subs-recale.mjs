#!/usr/bin/env node
// ============================================================================
// facecam/overlays/subs-recale.mjs — LE TEXTE D'UN CÔTÉ, L'HORLOGE DE L'AUTRE
//
// POURQUOI (01/09). le monteur, sur le master 4K du #02 : « le sous-titre est déjà là alors
// que j'ai pas commencé à parler ». Cause établie et prouvée par réfutation dans
// `vad.py` : **whisper ne DATE pas le premier mot, il le COLLE au début du fichier**
// qu'on lui donne, puis ÉTALE le texte sur la durée disponible. Sur le #02 : 9 blocs
// sur 27 en avance, de 0,16 s à 2,64 s (F01, à 0:10 — exactement l'instant que le monteur a
// signalé).
//
// DEUX CORRECTIONS ONT ÉTÉ ESSAYÉES ET RÉFUTÉES, chacune par une mesure :
//   ① recaler l'ASS après coup (décalage global, étirement affine) — FAUX : sur F01
//      les silences de whisper à 11,76 s et 15,32 s tombent DÉJÀ pile sur les pauses
//      mesurées (11,55-12,00 · 15,15-15,50). L'erreur est locale à la TÊTE et vaut
//      zéro dès le milieu du bloc : tout décalage global casse un milieu qui est juste.
//   ② rogner le blanc de tête et re-transcrire (`subs-blocs.mjs --rogner`) — l'horloge
//      devient juste, mais whisper RE-DÉCODE et ne rend pas le même texte : mesuré sur
//      les 9 blocs, 8 sont abîmés (« des quartiers un peu plus riches » → « les cartes
//      riches », « donc ça compte » → « ça camp », 22 mots nets perdus). *Un sous-titre
//      à l'heure mais amputé est un plus mauvais résultat qu'un sous-titre en avance.*
//
// CE QUE FAIT CELUI-CI. Les deux transcriptions disent presque la même chose : l'une a
// le BON TEXTE (celle livrée, passée au lexique et relue), l'autre la BONNE HORLOGE
// (celle du fichier rogné, dont le premier mot est ancré sur la voix). On ne choisit
// pas entre les deux : on APPARIE les deux suites de mots et on donne au texte livré
// les temps de son jumeau recalé. Le texte n'est jamais touché — c'est l'invariant que
// la garde de sortie vérifie mot à mot.
//
// Un mot sans jumeau (whisper en a mangé un en re-décodant) n'invente rien : son temps
// est INTERPOLÉ entre ses deux voisins appariés. Un bloc dont l'appariement est trop
// pauvre (< 70 % de mots appariés) est REFUSÉ et garde ses temps d'origine : mieux vaut
// un bloc en avance qu'un bloc recalé au hasard.
//
// Usage :
//   node facecam/overlays/subs-recale.mjs --film <film.ass> --plan <vlog.plan.json>
//        --livre <dir> --recale <dir> --out <film-recale.ass> [--only F01,F03] [--dry]
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PY = path.resolve(HERE, '..', '..', '.venv-vision/bin/python');

const a = process.argv.slice(2);
const opt = (n, d) => { const i = a.indexOf(n); if (i < 0) return d; const v = a[i + 1]; a.splice(i, 2); return v; };
const filmPath = opt('--film', null);
const planPath = opt('--plan', null);
const dirLivre = opt('--livre', null);
const dirRecale = opt('--recale', null);   // un ou PLUSIEURS dossiers, separes par des virgules
const wavDir = opt('--wav', null);         // ou vivent les <bloc>.wav, pour mesurer la voix
const AVANCE_MAX = parseFloat(opt('--avance-max', '0.15'));
const outPath = opt('--out', null);
const only = (opt('--only', '') || '').split(',').filter(Boolean);
const dry = a.includes('--dry');
if (!filmPath || !planPath || !dirLivre || !dirRecale || !outPath) {
  console.error('usage: subs-recale.mjs --film f.ass --plan vlog.plan.json --livre <dir> --recale <dir> --out o.ass [--only F01] [--dry]');
  process.exit(1);
}

const KF_MIN_CS = 10;                       // 0,10 s = 3 images à 30 fps — cf. subs.mjs
const dirsRecale = dirRecale.split(',').map((x) => x.trim()).filter(Boolean);
const P = (s) => { const [h, m, x] = s.split(':'); return +h * 3600 + +m * 60 + parseFloat(x); };
const T = (s) => {
  const cs = Math.round(s * 100);
  const h = Math.floor(cs / 360000), m = Math.floor(cs / 6000) % 60;
  const sec = Math.floor(cs / 100) % 60, c = cs % 100;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
};
const N = (w) => w.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9']/gi, '').toLowerCase();

// ── lire un ASS de bloc → suite de MOTS datés (temps relatifs au fichier transcrit) ──
// Le karaoké porte des DURÉES (`\kfNN`, en centisecondes) et non des dates : le temps
// d'un mot se reconstruit en cumulant depuis le début de sa ligne. `tete` rend l'offset
// du blanc rogné, sans quoi les temps du jumeau seraient ceux d'un autre fichier.
function motsDatesDeBloc(dir, id) {
  const f = path.join(dir, `${id}.ass`);
  if (!fs.existsSync(f)) return null;
  const fTete = path.join(dir, `${id}.tete.json`);
  const tete = fs.existsSync(fTete) ? (JSON.parse(fs.readFileSync(fTete, 'utf8')).tete || 0) : 0;
  const out = [];
  for (const L of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = L.match(/^Dialogue:\s*([^,]*),([^,]*),([^,]*),(.*)$/);
    if (!m) continue;
    const st = P(m[2]) + tete, en = P(m[3]) + tete;
    const corps = m[4].replace(/^[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,/, '');
    let t = st;
    const mots = [];
    for (const seg of corps.split(/(?=\{\\kf)/)) {
      const k = seg.match(/^\{\\kf(\d+)\}(.*)$/s);
      if (!k) continue;
      const dur = +k[1] / 100;
      const texte = k[2].trim();
      if (texte) mots.push({ mot: texte, cle: N(texte), t0: t, t1: t + dur, dur });
      t += dur;
    }
    out.push({ st, en, mots, ligne: L });
  }
  return out;
}

// ── appariement de deux suites de mots quasi identiques (LCS) ───────────────
// Needleman-Wunsch aurait le même résultat ici ; la LCS suffit et se relit.
function apparier(A, B) {
  const n = A.length, m = B.length;
  const d = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      d[i][j] = A[i] === B[j] ? d[i + 1][j + 1] + 1 : Math.max(d[i + 1][j], d[i][j + 1]);
    }
  }
  const paires = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { paires.push([i, j]); i++; j++; }
    else if (d[i + 1][j] >= d[i][j + 1]) i++;
    else j++;
  }
  return paires;
}

// ── temps neufs pour la suite A, d'après le jumeau B et leur appariement ────
// Les mots appariés prennent le temps de leur jumeau. Les autres n'inventent rien : ils
// sont INTERPOLÉS entre leurs deux voisins appariés (ou reportés à l'identique avant le
// premier / après le dernier). Puis on impose la monotonie : un mot ne recule jamais sur
// son voisin, sinon le karaoké repartirait en arrière.
function temps(A, B, paires, debutVoix) {
  const neuf = new Array(A.length).fill(null);
  for (const [i, j] of paires) neuf[i] = { t0: B[j].t0, t1: B[j].t1 };
  const prem = paires[0]?.[0] ?? 0, dern = paires[paires.length - 1]?.[0] ?? A.length - 1;
  // ── LA TÊTE NON APPARIÉE SE COMPRIME DANS L'ESPACE RÉEL, ELLE NE S'EXTRAPOLE PAS ──
  // Quand le donneur a perdu les premiers mots en re-décodant (F03 repartait à « et », F23
  // à « énorme »), reporter à l'identique les écarts d'ORIGINE les repousse avant le début
  // du bloc — l'ASS est alors clampé à la borne et le recalage ne sert à rien : F03 restait
  // à +0,99 s malgré 100 % d'appariement. Or on SAIT où la parole commence (`vad.py`) et où
  // le premier mot apparié tombe : ces mots-là ont été dits ENTRE les deux. On les répartit
  // donc dans cet intervalle, au prorata de leur durée d'origine. *Une extrapolation qui
  // sort du domaine mesuré n'est pas une estimation, c'est une invention.*
  if (prem > 0 && debutVoix != null && debutVoix < neuf[prem].t0) {
    const tete = A.slice(0, prem);
    const total = tete.reduce((s2, w) => s2 + Math.max(w.dur, 0.01), 0);
    const espace = neuf[prem].t0 - debutVoix;
    let t = debutVoix;
    for (let i = 0; i < prem; i++) {
      const part = espace * Math.max(A[i].dur, 0.01) / total;
      neuf[i] = { t0: t, t1: t + part };
      t += part;
    }
  }
  for (let i = prem - 1; i >= 0; i--) {
    if (neuf[i]) continue;
    const d = A[i + 1].t0 - A[i].t0;
    neuf[i] = { t0: neuf[i + 1].t0 - d, t1: neuf[i + 1].t0 - d + A[i].dur };
  }
  for (let i = dern + 1; i < A.length; i++) {
    const d = A[i].t0 - A[i - 1].t0;
    neuf[i] = { t0: neuf[i - 1].t0 + d, t1: neuf[i - 1].t0 + d + A[i].dur };
  }
  for (let i = prem; i <= dern; i++) {
    if (neuf[i]) continue;
    let g = i - 1; while (g >= 0 && !neuf[g]) g--;
    let h = i + 1; while (h < A.length && !neuf[h]) h++;
    const pas = (neuf[h].t0 - neuf[g].t1) / (h - g);
    neuf[i] = { t0: neuf[g].t1 + pas * (i - g - 1), t1: neuf[g].t1 + pas * (i - g) };
  }
  for (let i = 1; i < A.length; i++) if (neuf[i].t0 < neuf[i - 1].t1) neuf[i].t0 = neuf[i - 1].t1;
  for (let i = 0; i < A.length; i++) if (neuf[i].t1 < neuf[i].t0 + 0.02) neuf[i].t1 = neuf[i].t0 + 0.02;
  return neuf;
}

const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
const blocs = plan.pieces.filter((p) => p.kind === 'F').map((p, i) => ({
  id: 'F' + String(i + 1).padStart(2, '0'), label: p.label, t0: p.t0, t1: p.t1, dur: p.dur,
}));

const film = fs.readFileSync(filmPath, 'utf8').split('\n');
// ⚠️ ON TRAVAILLE SUR LES LIGNES DU FILM, PAS SUR LES ASS DE BLOC. Les deux portent le
// même texte mais pas le même repère : le bloc est relatif à sa fenêtre, le film à
// l'horloge du montage (`+t0`, et `+tête` si le bloc a été rogné). Apparier sur le texte
// des ASS de bloc puis réécrire dans le film, c'est mélanger deux horloges — le piège
// exact qui a coûté cinq retours du monteur sur le #02. Le film est la seule source ici ;
// le dossier `--recale` ne sert qu'à FOURNIR des temps, jamais du texte.
const idxFilm = film.map((l, i) => [l, i]).filter(([l]) => l.startsWith('Dialogue'));
const rendus = new Map();          // index de ligne du film → ligne réécrite
let nBlocs = 0, nRefus = 0;
const rapport = [];

for (const b of blocs) {
  if (only.length && !only.includes(b.id)) continue;
  // les lignes du film qui appartiennent à ce bloc, dans l'ordre
  const livre = idxFilm.map(([l, i]) => {
    const m = l.match(/^Dialogue:\s*([^,]*),([^,]*),([^,]*),(.*)$/);
    const st = P(m[2]), en = P(m[3]);
    // ⚠️ TOLÉRANCE 0,02 s ET NON 0,001 : les timecodes ASS sont arrondis au CENTIÈME, une
    // borne à 71,033 s s'y écrit « 71.03 ». Plus fin que l'arrondi du fichier, le test rate
    // le PREMIER évènement du bloc — celui-là même qu'on vient recaler. Corrigé d'abord dans
    // subs-controle.mjs, ce script est resté en 0,001 et F18 a été recalé sur sa 2ᵉ ligne :
    // *une leçon corrigée à un endroit se porte aux autres qui ont la même forme, sinon elle
    // n'est corrigée qu'ici.*
    if (!(st >= b.t0 - 0.02 && st < b.t1)) return null;
    const corps = m[4].replace(/^[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,/, '');
    let t = st - b.t0;                       // ramené dans le repère du bloc
    const mots = [];
    for (const seg of corps.split(/(?=\{\\kf)/)) {
      const k = seg.match(/^\{\\kf(\d+)\}(.*)$/s);
      if (!k) continue;
      const dur = +k[1] / 100, texte = k[2].trim();
      if (texte) mots.push({ mot: texte, cle: N(texte), t0: t, t1: t + dur, dur });
      t += dur;
    }
    return { st: st - b.t0, en: en - b.t0, mots, i, tete: m[1] };
  }).filter(Boolean).filter((l) => l.mots.length);
  // ── CHOISIR LE DONNEUR, BLOC PAR BLOC, SUR UNE MESURE ──────────────────────
  // Un seul donneur d'horloge ne peut pas convenir aux 27 blocs : chacun est enregistré
  // dans une ambiance différente, et l'air de rognage qui ancre bien l'un ampute l'autre.
  // Premier essai (un donneur unique à air 0) : F10 et F23 tombaient sous 70 % d'appariement
  // et gardaient leurs temps d'origine. On fabrique donc PLUSIEURS donneurs (`--recale a,b,c`,
  // un par air) et on retient, POUR CHAQUE BLOC, celui que la mesure désigne — jamais un
  // réglage global. *Une réponse hors liste est la meilleure ; encore faut-il que l'outil
  // sache la recevoir.*
  //
  // Ordre de préférence, écrit en clair avant d'être codé (sinon on règle des poids à
  // l'aveugle) : ① le sous-titre ne part pas avant la voix ; ② à égalité, le plus synchrone
  // en valeur absolue ; ③ à égalité encore, le meilleur appariement. Un donneur sous 70 %
  // d'appariement est écarté d'office — mieux vaut un bloc en avance qu'un bloc recalé au
  // hasard sur des mots qui ne se correspondent pas.
  const A = livre.flatMap((l) => l.mots);
  const wavB = path.join(wavDir ?? dirsRecale[0], `${b.id}.wav`);
  const debutVoix = (fs.existsSync(wavB) && fs.existsSync(PY))
    ? (JSON.parse(execFileSync(PY, [path.join(HERE, 'vad.py'), wavB], { encoding: 'utf8' }))[wavB] || {}).debut
    : null;
  const essais = [];
  for (const dir of dirsRecale) {
    const recale = motsDatesDeBloc(dir, b.id);
    if (!recale) continue;
    const B = recale.flatMap((l) => l.mots);
    const paires = apparier(A.map((x) => x.cle), B.map((x) => x.cle));
    const taux = paires.length / Math.max(1, A.length);
    if (taux < 0.70) { essais.push({ dir, taux, rejete: 'appariement' }); continue; }
    const neuf = temps(A, B, paires, debutVoix);
    // l'ASS écrit ne peut pas commencer avant la borne du bloc : l'avance EFFECTIVE se
    // calcule sur la date CLAMPÉE, pas sur celle qu'on aurait voulue.
    const depart = Math.max(0, neuf[0].t0);
    const avance = debutVoix == null ? null : +(debutVoix - depart).toFixed(3);
    essais.push({ dir, taux, neuf, avance });
  }
  const bons = essais.filter((e) => e.neuf);
  if (!bons.length) {
    rapport.push(`${b.id}  ⛔ aucun donneur exploitable (${essais.map((e) => `${path.basename(e.dir)} ${(e.taux * 100).toFixed(0)} %`).join(' · ')}) — temps d'origine gardés`);
    nRefus++; continue;
  }
  bons.sort((x, y) => {
    const ax = x.avance ?? 9, ay = y.avance ?? 9;
    const dep = (ax > AVANCE_MAX ? 1 : 0) - (ay > AVANCE_MAX ? 1 : 0);
    if (dep) return dep;
    const abs = Math.abs(ax) - Math.abs(ay);
    if (Math.abs(abs) > 0.005) return abs;
    return y.taux - x.taux;
  });
  const elu = bons[0];
  const neuf = elu.neuf;

  // ── ANCRAGE DE SÉCURITÉ : la consigne du monteur passe avant l'élégance ─────────
  // Pour deux blocs (F10, F23) aucun donneur ne descend sous le seuil : le rognage le plus
  // agressif mange trop de mots pour rester apparié, et le plus doux garde de l'avance. On
  // ne laisse pas le défaut pour autant. La consigne est explicite — « tu ne dois pas faire
  // apparaître le sous-titre avant que je commence de parler » — donc on ANCRE : les mots
  // datés avant l'attaque de la voix sont repoussés et répartis entre celle-ci et le premier
  // mot qui, lui, tombe déjà après. C'est une compression, elle a un COÛT (ces mots défilent
  // plus vite) et il est imprimé ; ce n'est pas un défaut caché, c'est un choix nommé.
  let ancre = null;
  if (debutVoix != null && elu.avance != null && elu.avance > AVANCE_MAX) {
    const j = neuf.findIndex((n) => n.t0 >= debutVoix);
    const espace = j > 0 ? neuf[j].t0 - debutVoix : 0;
    // ⛔ ET UN GARDE SUR LE REMÈDE : ancrer 9 mots dans 0,03 s (F23) ne corrige pas le
    // défaut, ça en fabrique un pire — le sous-titre part à l'heure et défile trop vite pour
    // être lu, c'est-à-dire le « déjà consommé » du monteur par une autre porte. On n'ancre que
    // si chaque mot garde au moins le plancher de remplissage. Sinon on ne touche à rien et
    // le bloc reste une réserve NOMMÉE. *Corriger un défaut en recréant l'autre n'est pas
    // une correction.*
    if (j > 0 && espace / j >= KF_MIN_CS / 100) {
      const durs = neuf.slice(0, j).map((n) => Math.max(n.t1 - n.t0, 0.01));
      const total = durs.reduce((x, y) => x + y, 0);
      let t = debutVoix;
      for (let i = 0; i < j; i++) { const q = espace * durs[i] / total; neuf[i] = { t0: t, t1: t + q }; t += q; }
      ancre = `${j} mot(s) ancrés dans ${espace.toFixed(2)} s`;
      elu.avance = +(debutVoix - Math.max(0, neuf[0].t0)).toFixed(3);
    } else if (j > 0) {
      ancre = `ancrage REFUSÉ — ${j} mots pour ${espace.toFixed(2)} s, ${(espace / j).toFixed(3)} s/mot < plancher`;
    }
  }


  // réécrire chaque LIGNE du film : même texte, même découpe, temps neufs
  let k = 0;
  const avant = livre[0].mots[0].t0 + b.t0;
  for (const l of livre) {
    const nm = l.mots.length;
    const st = neuf[k].t0, en = neuf[k + nm - 1].t1;
    let body = '';
    for (let q = 0; q < nm; q++) {
      const gap = q === 0 ? 0 : neuf[k + q].t0 - neuf[k + q - 1].t1;
      const cs = Math.max(1, Math.round((gap + (neuf[k + q].t1 - neuf[k + q].t0)) * 100));
      body += `{\\kf${cs}}${l.mots[q].mot} `;
    }
    k += nm;
    // borne du bloc : on ne déborde jamais sur le plan paysage suivant, muet
    const stF = Math.max(b.t0, st + b.t0), enF = Math.min(b.t1, en + b.t0);
    if (enF - stF < 0.05) continue;   // reste d'une ligne entièrement au-delà de la borne
    rendus.set(l.i, `Dialogue: ${l.tete},${T(stF)},${T(enF)},Default,,0,0,0,,${body.trim()}`);
  }
  nBlocs++;
  rapport.push(`${b.id}  ${path.basename(elu.dir).padEnd(14)} ${(elu.taux * 100).toFixed(0).padStart(3)} % apparié`
    + ` · 1er sous-titre ${T(avant)} → ${T(Math.max(b.t0, neuf[0].t0 + b.t0))}`
    + (elu.avance == null ? '' : ` · avance ${elu.avance >= 0 ? '+' : ''}${elu.avance.toFixed(3)} s`
        + (elu.avance > AVANCE_MAX ? '  ⛔' : '  ✓'))
    + (ancre ? `  ⚓ ${ancre}` : '')
    + (bons.length > 1 ? `   (${bons.length} donneurs)` : ''));
}

for (const l of rapport) console.log('  ' + l);
console.log(`\n${nBlocs} bloc(s) recalé(s) · ${nRefus} refusé(s) · ${rendus.size} ligne(s) réécrite(s)`);


// Le film réécrit : les lignes recalées prennent la place des anciennes, les autres
// passent telles quelles. Les deux transformations qui suivent s'appliquent dessus.
const sortie = film.map((l, i) => rendus.get(i) ?? l);

// ── PLANCHER DE REMPLISSAGE : UN MOT QUI SE REMPLIT EN UNE IMAGE EST UN `\k` ─
// Dernier défaut de la série, trouvé par `subs-gate.mjs` sur les 28 débuts de bloc :
// 0:38,73 (« En ») et 4:07,19 (« aujourd'hui, ») restaient accent dès la 1re image, avec
// 16,5 % et 54,9 % de remplissage. Le tag est pourtant bien `\kf` — c'est sa DURÉE qui
// est absurde : whisper donne 0,01 s à « En » et 0,04 s à « aujourd'hui, ». En dessous
// d'environ 3 images, un remplissage progressif est indiscernable d'une bascule : on
// retombe visuellement sur le `\k` que le monteur a signalé. *Un tag juste avec une durée fausse
// produit le défaut du tag faux.*
// On pose donc un plancher sur le PREMIER mot de chaque ligne — le seul dont l'état est
// lu à l'apparition — et on reprend le temps sur les mots SUIVANTS de la même ligne : le
// total de la ligne est conservé au centième près, donc ni sa fin, ni la ligne d'après,
// ni aucune borne de bloc ne bougent. La même règle est posée à la source dans
// `subs.mjs` (constante KF_MIN_CS) pour que les prochains ASS naissent corrects.
let planchers = 0;
for (let i = 0; i < sortie.length; i++) {
  // ⚠️ NEUF champs avant le texte, pas huit (Layer, Start, End, Style, Name, MarginL,
  // MarginR, MarginV, Effect). Une virgule mangée et libass lit le 1er mot comme un
  // EFFET : il disparaît du rendu et la gate mesure alors le mot d'après — un défaut
  // qui se voit à l'image et pas dans le fichier. Compter les champs, ne pas les estimer.
  const m = sortie[i].match(/^(Dialogue:\s*(?:[^,]*,){9})(.*)$/);
  if (!m) continue;
  const tags = [...m[2].matchAll(/\{\\kf(\d+)\}([^{]*)/g)].map((x) => ({ cs: +x[1], mot: x[2] }));
  if (tags.length < 2 || tags[0].cs >= KF_MIN_CS) continue;
  let dette = KF_MIN_CS - tags[0].cs;
  tags[0].cs = KF_MIN_CS;
  for (let q = 1; q < tags.length && dette > 0; q++) {
    const pris = Math.min(dette, tags[q].cs - 1);   // jamais en dessous de 1 cs
    if (pris > 0) { tags[q].cs -= pris; dette -= pris; }
  }
  if (dette > 0) { tags[0].cs -= dette; continue; }  // ligne trop courte : on ne force pas
  sortie[i] = m[1] + tags.map((t) => `{\\kf${t.cs}}${t.mot}`).join('');
  planchers++;
}
console.log(`plancher de remplissage (${KF_MIN_CS} cs) sur le 1er mot : ${planchers} ligne(s)`);

// ── RABOTER LES CHEVAUCHEMENTS, JAMAIS DÉCALER LES DÉBUTS ──────────────────
// Deux lignes se chevauchaient après recalage (0:46,85 et 10:57,20) : une ligne réécrite
// finit après le début de la suivante, restée telle quelle. libass les EMPILERAIT — deux
// lignes à l'écran, le défaut qui avait fait re-brûler le v12 du #01. On rabote la FIN de
// la ligne d'avant, jamais le DÉBUT de la suivante : le début est précisément ce que ce
// script est venu poser, le raboter reviendrait à défaire la correction pour la sauver.
{
  const pos = [];
  for (let i = 0; i < sortie.length; i++) if (sortie[i].startsWith('Dialogue')) pos.push(i);
  for (let q = 0; q + 1 < pos.length; q++) {
    const A = sortie[pos[q]].match(/^Dialogue:\s*([^,]*),([^,]*),([^,]*),(.*)$/);
    const B = sortie[pos[q + 1]].match(/^Dialogue:\s*[^,]*,([^,]*),/);
    const en = P(A[3]), stSuiv = P(B[1]);
    if (en > stSuiv - 0.02) {
      const enNeuf = Math.max(P(A[2]) + 0.05, stSuiv - 0.02);
      sortie[pos[q]] = `Dialogue: ${A[1]},${A[2]},${T(enNeuf)},${A[4]}`;
    }
  }
}

// chevauchements : libass EMPILERAIT deux lignes à l'écran
const evs = sortie.filter((l) => l.startsWith('Dialogue')).map((l) => {
  const m = l.match(/^Dialogue:\s*[^,]*,([^,]*),([^,]*),/); return { st: P(m[1]), en: P(m[2]) };
}).sort((x, y) => x.st - y.st);
const chev = evs.filter((e, i) => i && e.st < evs[i - 1].en - 0.001);
for (const e of chev) console.log(`  chevauchement à ${T(e.st)}`);
console.log(`chevauchements : ${chev.length ? `⛔ ${chev.length}` : '✓ 0'}`);
if (chev.length) process.exit(1);

// ── GARDE D'INVARIANT : le TEXTE ne bouge pas, jamais ───────────────────────
// Placée EN DERNIER, après le plancher de remplissage et le rabotage : une garde qui
// passe avant les deux dernières transformations ne prouve rien sur le fichier écrit —
// c'est ce qui a laissé passer une virgule mangée dans le plancher, invisible au diff
// et fatale à l'image. *Une garde se pose sur l'ARTEFACT LIVRÉ, pas sur un état de passage.*
// C'est la raison d'être de ce script : *un changement ciblé se prouve par ce qui n'a
// PAS bougé.* On compare la suite complète des mots, avant et après, ponctuation comprise.
const motsDe = (lignes) => lignes.filter((l) => l.startsWith('Dialogue'))
  .map((l) => l.split(',,').pop().replace(/\{[^}]*\}/g, '')).join(' ').split(/\s+/).filter(Boolean);
const av = motsDe(film), ap = motsDe(sortie);
const identique = av.length === ap.length && av.every((w, i) => w === ap[i]);
console.log(`texte inchangé : ${identique ? `✓ ${av.length} mots, à l'identique` : `⛔ ${av.length} → ${ap.length} mots`}`);
if (!identique) process.exit(1);

if (dry) { console.log('\n--dry : rien écrit'); process.exit(0); }
fs.writeFileSync(outPath, sortie.join('\n'));
console.log(`\n✓ ${outPath}`);
