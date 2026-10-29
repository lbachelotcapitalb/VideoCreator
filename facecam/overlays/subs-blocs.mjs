#!/usr/bin/env node
// ============================================================================
// facecam/overlays/subs-blocs.mjs — UN ASS pour un film MIXTE landscape × facecam
//
// `subs.mjs` sous-titre UNE fenêtre et rend des timecodes RELATIFS à son t0. Sur le
// VLOG #01 il n'y avait qu'une fenêtre (le master facecam entier) : un appel suffisait.
// Le #02 est un MERGE — 27 blocs facecam dispersés dans 199 plans paysage muets — donc
// 27 fenêtres à transcrire séparément, puis à REPOSITIONNER sur l'horloge du film.
//
// Ce que fait ce script, et pourquoi il vit dans le repo plutôt que dans le terminal :
//   1. lit les blocs `kind:"F"` de `vlog.plan.json` (source unique des bornes) ;
//   2. appelle `subs.mjs` sur l'AUDIO PROPRE de chaque bloc (le `fc_*_final.mp4`),
//      jamais sur le master : le master porte le lit musical, qui dégrade whisper ;
//   3. DÉCALE chaque évènement de `+t0` et les fond en un seul ASS ;
//   4. contrôle qu'aucun évènement ne déborde de son bloc ni n'en chevauche un autre.
//
// ⚠️ Le décalage se fait sur les BORNES DU PLAN, pas sur une durée relue du mp4 : les
// deux se ressemblent (20,087 vs 20,10 s) et ce sont deux horloges. Le film est CFR 30/1.
// ⚠️ AUCUNE taille n'est passée : les défauts de `subs.mjs` SONT la convention arbitrée
// par le monteur (Lato Black 58 · couleur d'accent du profil · MarginV 36 · une seule ligne · karaoké). Et
// on ne double rien pour le 4K — libass met son PlayResX 1920 à l'échelle de la sortie.
//
// Usage : subs-blocs.mjs --plan <vlog.plan.json> --work <dir> --out <film.ass>
//                        [--lexique <l.json>] [--only F01,F02] [--force]
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
const work     = opt('--work', null);
const outPath  = opt('--out', null);
const lexique  = opt('--lexique', null);
const only     = (opt('--only', '') || '').split(',').filter(Boolean);
const force    = a.includes('--force');
const rogner   = a.includes('--rogner');   // cf. § ROGNER, désactivé par défaut
// `--air <s>` fige l'air à une valeur et DÉSARME la montée par paliers. Sert à fabriquer
// un DONNEUR D'HORLOGE pour `subs-recale.mjs` : là, perdre un mot est sans conséquence
// puisque seuls les TEMPS sont repris, et le texte vient de la transcription non rognée.
// À ne jamais utiliser pour produire un ASS livrable — la garde de non-perte est désarmée.
const airFixe  = (() => { const v = opt('--air', null); return v === null ? null : +v; })();
if (!planPath || !work || !outPath) {
  console.error('usage: subs-blocs.mjs --plan <vlog.plan.json> --work <dir> --out <film.ass> [--lexique l.json] [--only F01,F03] [--force]');
  process.exit(1);
}
fs.mkdirSync(work, { recursive: true });

const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
const blocs = plan.pieces.filter((p) => p.kind === 'F').map((p, i) => ({
  id: 'F' + String(i + 1).padStart(2, '0'), badge: p.badge, label: p.label,
  t0: p.t0, t1: p.t1, dur: p.dur, src: p.file,
}));
console.log(`${blocs.length} blocs facecam · ${blocs.reduce((s, b) => s + b.dur, 0).toFixed(1)} s de parole`);

// ── 1) transcrire bloc par bloc ─────────────────────────────────────────────
// `--cache` porte la transcription BRUTE : réitérer le lexique ou la mise en lignes
// ne relance pas whisper. C'est ce qui rend ce script rejouable pour quelques secondes.
// L'ÉTALON DE NON-PERTE : la transcription de la source ENTIÈRE, gardée à part. C'est elle
// qui dit ce que whisper entend quand on ne lui rogne rien — donc ce qu'un rognage a le droit
// de produire. On compare aux TROIS premiers mots, pas au premier : `subs.mjs` élide la
// ponctuation et les amorces en tête de ligne, donc le 1er mot produit diffère légitimement
// du 1er mot brut. *Une jauge qui sonne sur du travail correct finit par être ignorée.*
const REF = path.join(work, '..', 'subs02-cache-avant-rognage');
const normMot = (w) => w.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9']/gi, '').toLowerCase();
const refDebut = (id) => {
  const f = path.join(REF, `${id}.cache.json`);
  if (!fs.existsSync(f)) return [];
  const tr = JSON.parse(fs.readFileSync(f, 'utf8')).transcription || [];
  return tr.map((x) => x.text).join(' ').trim().split(/\s+/).slice(0, 3).map(normMot).filter(Boolean);
};
const premierMot = (assPath) => {
  const L = fs.readFileSync(assPath, 'utf8').split('\n').find((x) => x.startsWith('Dialogue'));
  return normMot(((L || '').split(',,').pop() || '').replace(/\{[^}]*\}/g, '').trim().split(/\s+/)[0] || '');
};

for (const b of blocs) {
  if (only.length && !only.includes(b.id)) continue;
  const ass = path.join(work, `${b.id}.ass`);
  const cache = path.join(work, `${b.id}.cache.json`);
  // l'audio propre est extrait à côté du bloc ; à défaut on retombe sur le mp4 du bloc
  const wav = path.join(work, `${b.id}.wav`);
  // ⭐ ET C'EST CE SCRIPT QUI L'EXTRAIT (20/09). Le repli « à défaut, le mp4 du bloc »
  // ne marche pas : `vad.py` lit le WAV avec `wave.open`, qui refuse un mp4
  // (« file does not start with RIFF id ») — et l'appel de vad.py ci-dessous est
  // INCONDITIONNEL, donc le repli faisait planter la chaîne entière au 1er bloc.
  // Sur le #02 les wav avaient été extraits À LA MAIN dans le terminal ; la commande
  // est morte avec le shell, et l'EP3 a rouvert exactement le même trou.
  // *Une chaîne qu'on ne peut pas rejouer n'est pas une chaîne* (31/07) : le geste
  // rentre dans le script. Il est idempotent (rejouable sans refaire le travail) —
  // le wav présent est réutilisé, `--force` le refait.
  // ⚠️ Et c'est AUSSI le dossier que `subs-recale.mjs --wav` lit pour mesurer la voix :
  // les deux outils partagent donc UN exemplaire de cet audio, jamais deux extractions
  // qui pourraient diverger.
  if (!fs.existsSync(wav) || force) {
    if (!fs.existsSync(b.src)) { console.error(`  ${b.id} ⛔ bloc absent : ${b.src}`); process.exit(1); }
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', b.src, '-ac', '1', '-ar', '16000', wav]);
  }
  const src = fs.existsSync(wav) ? wav : b.src;
  if (!force && fs.existsSync(ass)) { console.log(`  ${b.id} — déjà transcrit`); continue; }
  if (!fs.existsSync(src)) { console.error(`  ${b.id} ⛔ source absente : ${src}`); process.exit(1); }

  // ── ROGNER LE BLANC DE TÊTE AVANT DE TRANSCRIRE (01/09) ────────────────────
  // whisper ne DATE pas le premier mot : il le COLLE au début du fichier qu'on lui
  // donne. Réfutation faite ce jour-là — le même bloc précédé de 2,000 s de silence
  // NUMÉRIQUE ressort « Alors » à 0,000 s, dans un silence qu'on venait d'ajouter.
  // Conséquence sur le #02 : F01 affichait son sous-titre 2,64 s avant que le monteur ouvre
  // la bouche, et 9 blocs sur 27 avaient plus de 0,15 s d'avance.
  // Recaler APRÈS COUP a été essayé et ÉCARTÉ : whisper ayant étalé le texte sur toute
  // la durée du bloc, il n'y a plus de place où pousser les lignes — au choix on perd
  // du texte (16 lignes sur 229), on crée des chevauchements (36) ou on déforme des
  // durées sans rien gagner en parallélisme global. *On corrige la cause, pas la trace.*
  // On lui donne donc un fichier qui COMMENCE sur la parole ; l'offset est rendu à la
  // fusion. `debut` est mesuré au signal par `vad.py`, jamais lu dans la transcription.
  const v = JSON.parse(execFileSync(PY, [path.join(HERE, 'vad.py'), src], { encoding: 'utf8' }))[src];
  // ⚠️ AIR GÉNÉREUX, ET UNE GARDE DERRIÈRE. Un premier essai rognait à 60 ms de l'attaque
  // mesurée : 38 mots ont disparu du film — « C'était les points qui m'intéressaient »,
  // « Surtout que », « et c'est une ville qui a »… Le détecteur RATE les attaques douces
  // (consonne sourde, voix qui monte progressivement), et ce qu'il rate, le rognage le
  // coupe. Deux parades, car l'air seul ne suffit pas à le garantir : 0,40 s de marge,
  // ET le contrôle du premier mot plus bas, contre la transcription non rognée.
  // *Un pré-traitement qui peut manger de la donnée se contrôle sur la donnée.*
  // ⛔ DÉSACTIVÉ PAR DÉFAUT (01/09) — `--rogner` pour le rallumer. Rogner corrige bien
  // l'avance, mais AUCUN réglage testé ne le fait sans manger de la parole : à 0,06 s
  // d'air, 38 mots coupés ; à 0,40 s, encore 4 blocs amputés (F03 « c'était » → whisper
  // repart à « m'intéressait »). Et le silence n'est pas rognable « sûrement » non plus :
  // `blanc_de_tete` rend 0,00 s sur les 27 blocs — l'ambiance extérieure (rue, oiseaux)
  // porte de l'énergie en bande vocale dès la 1re fenêtre, donc il n'y a pas de silence
  // à couper, seulement de la NON-PAROLE que ce détecteur ne sait pas distinguer.
  // Ce qui manque est un VAD qui sépare voix et ambiance (modulation ~4 Hz, harmonicité).
  //
  // ⭐ L'AIR N'EST PAS UNE CONSTANTE, C'EST UNE ÉCHELLE (01/09, 2ᵉ passe). C'est ce qui a
  // débloqué le sujet. Chercher LA bonne valeur d'air était une impasse par construction :
  // trop court, il coupe une attaque douce (38 mots mangés à 0,06 s) ; trop long, il laisse
  // l'avance en place. Aucune valeur unique ne peut être juste sur 27 blocs enregistrés dans
  // 27 ambiances. Ce qui marche : MONTER l'air par paliers tant que le premier mot produit
  // n'est pas celui de la transcription non rognée — le contrôle de non-perte ne sert plus
  // seulement à constater le dégât, il PILOTE le réglage. Et si aucun palier ne passe, on
  // retombe sur la transcription entière : *un bloc en avance vaut mieux qu'un bloc amputé.*
  // ⚠️ ET L'ÉCHELLE COMMENCE À ZÉRO. Premier essai de l'échelle : paliers 0,40 → 1,20 s.
  // Résultat mesuré — F01 passait de 2,64 s à 0,40 s d'avance, F03 de 0,99 à 0,80 : l'avance
  // résiduelle valait EXACTEMENT l'air, à chaque fois. C'est structurel et non un hasard :
  // whisper colle son premier mot au début du fichier, donc après rognage le sous-titre part
  // à `t0 + tête`, la voix à `t0 + tête + air`. *Un pré-traitement qui laisse une marge laisse
  // exactement cette marge comme défaut.* L'air n'est donc pas un réglage de confort mais LE
  // défaut lui-même : on part de 0 et on ne monte que si le contrôle de non-perte le réclame.
  const PALIERS = airFixe === null ? [0.00, 0.15, 0.30, 0.60, 1.00] : [airFixe];
  const ref3 = refDebut(b.id);
  const t = Date.now();
  let tete = 0; const essais = [];
  const transcrire = (fichier, duree) => {
    // ⚠️ l'audio change d'un palier à l'autre : le cache de transcription ne vaut plus rien.
    // Sans ce retrait, subs.mjs relit le cache et le 2ᵉ palier rendrait le résultat du 1er.
    if (fs.existsSync(cache)) fs.rmSync(cache);
    execFileSync(process.execPath, [path.join(HERE, 'subs.mjs'), fichier, '0', String(duree),
      '--out', ass, '--cache', cache, ...(lexique ? ['--lexique', lexique] : [])],
      { stdio: ['ignore', 'ignore', 'inherit'] });
  };
  process.stdout.write(`  ${b.id} (${b.dur.toFixed(1)} s) ${b.label ?? ''} … `);
  if (rogner && v && v.debut != null) {
    for (const AIR of PALIERS) {
      const tt = +(v.debut - AIR).toFixed(3);
      if (tt <= 0.02) break;                       // plus rien à rogner : les paliers montent
      const aT = path.join(work, `${b.id}.parole.wav`);
      execFileSync('ffmpeg', ['-y', '-v', 'error', '-ss', String(tt), '-i', src,
        '-ar', '16000', '-ac', '1', aT]);
      transcrire(aT, b.dur - tt);
      const obtenu = premierMot(ass);
      essais.push(`${AIR.toFixed(2)} s → « ${obtenu} »`);
      if (airFixe !== null || !ref3.length || ref3.includes(obtenu)) { tete = tt; break; }
    }
  }
  if (tete === 0) transcrire(src, b.dur);          // repli : la source entière, rien de perdu
  fs.writeFileSync(path.join(work, `${b.id}.tete.json`), JSON.stringify({ tete }));
  console.log(`${tete ? `[tête ${tete.toFixed(2)} s rognée] ` : (essais.length ? '[rognage abandonné] ' : '')}`
    + `${((Date.now() - t) / 1000).toFixed(1)} s`
    + (essais.length > 1 ? `  paliers : ${essais.join(' · ')}` : ''));
}

// ── 2) fondre en un seul ASS, décalé sur l'horloge du film ──────────────────
const T = (s) => {                       // secondes → h:mm:ss.cc (format ASS)
  const cs = Math.round(s * 100);
  const h = Math.floor(cs / 360000), m = Math.floor(cs / 6000) % 60;
  const sec = Math.floor(cs / 100) % 60, c = cs % 100;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
};
const P = (t) => { const [h, m, r] = t.split(':'); return +h * 3600 + +m * 60 + parseFloat(r); };

let header = null; const events = []; let nBlocs = 0, clamps = 0, maxOver = 0;
for (const b of blocs) {
  const ass = path.join(work, `${b.id}.ass`);
  if (!fs.existsSync(ass)) { console.error(`⛔ ${b.id} : ASS manquant, relancer sans --only`); process.exit(1); }
  const txt = fs.readFileSync(ass, 'utf8');
  const i = txt.indexOf('[Events]');
  if (i < 0) { console.error(`⛔ ${b.id} : pas de section [Events]`); process.exit(1); }
  // l'en-tête (PlayRes, styles) est IDENTIQUE d'un bloc à l'autre — on garde le premier
  // et on VÉRIFIE que les suivants ne divergent pas, plutôt que de le supposer.
  const head = txt.slice(0, i);
  if (header === null) header = head;
  else if (head !== header) { console.error(`⛔ ${b.id} : en-tête ASS différent du premier bloc`); process.exit(1); }
  const lines = txt.slice(i).split('\n');
  // l'offset du blanc rogné à la transcription : les timecodes de l'ASS de bloc sont
  // relatifs à la PAROLE, pas au début du bloc.
  const fTete = path.join(work, `${b.id}.tete.json`);
  const tete = fs.existsSync(fTete) ? JSON.parse(fs.readFileSync(fTete, 'utf8')).tete : 0;
  let n = 0;
  for (const L of lines) {
    const m = L.match(/^Dialogue:\s*([^,]*),([^,]*),([^,]*),(.*)$/);
    if (!m) { if (/^Format:/.test(L) && !events.length) events.push(L); continue; }
    let st = P(m[2]) + tete + b.t0, en = P(m[3]) + tete + b.t0;
    // GARDE : un évènement qui déborde de son bloc s'afficherait sur le plan PAYSAGE
    // suivant, muet. whisper cale ses fenêtres sur 30 s et date régulièrement le dernier
    // mot APRÈS la fin de l'audio (F01 : 20,28 s pour 20,10 s) — un débordement de
    // quelques dixièmes se PLAFONNE, il ne se refuse pas. Au-delà de 0,5 s ce n'est plus
    // un arrondi mais la mauvaise fenêtre, et là on s'arrête.
    const over = en - b.t1;
    if (st < b.t0 - 0.001 || over > 0.5) {
      console.error(`⛔ ${b.id} : évènement ${T(st)}→${T(en)} hors du bloc ${T(b.t0)}→${T(b.t1)}`); process.exit(1);
    }
    if (over > 0.001) { en = b.t1; clamps++; maxOver = Math.max(maxOver, over); }
    if (en - st < 0.05) continue;          // reste d'un mot entièrement au-delà de la borne
    // GARDE DE CONTRAT (01/09) : le karaoké doit être `\kf` (remplissage progressif) et
    // jamais `\k` (bascule d'un coup au DÉBUT du mot). Les deux portent exactement les
    // mêmes timecodes, donc AUCUN contrôle de synchro ne peut les distinguer.
    if (/\{\\k\d/.test(m[4])) {
      console.error(`⛔ ${b.id} : karaoké en \\k (bascule au début du mot) — attendu \\kf. Régénérer avec --force.`);
      process.exit(1);
    }
    events.push({ st, en, line: `Dialogue: ${m[1]},${T(st)},${T(en)},${m[4]}` });
    n++;
  }
  if (n === 0) console.warn(`  ⚠ ${b.id} : AUCUN sous-titre — bloc muet ou transcription vide ?`);
  nBlocs++;
}
const fmt = events.find((e) => typeof e === 'string');
const evs = events.filter((e) => typeof e !== 'string').sort((x, y) => x.st - y.st);

// GARDE : « une seule ligne à l'écran » (parti pris n°12) = zéro chevauchement.
// C'est ce défaut-là qui avait fait re-brûler le v12 du #01 : libass EMPILE.
let chev = 0;
for (let i = 1; i < evs.length; i++) if (evs[i].st < evs[i - 1].en - 0.001) chev++;

fs.writeFileSync(outPath, header + '[Events]\n' + (fmt ? fmt + '\n' : '')
  + evs.map((e) => e.line).join('\n') + '\n');
console.log(`\n✓ ${outPath}`);
console.log(`  ${nBlocs} blocs · ${evs.length} évènements · ${chev} chevauchement(s)`
  + `  ·  ${clamps} fin(s) plafonnée(s) à la borne du bloc (débord max ${maxOver.toFixed(3)} s)`
  + `  ·  ${T(evs[0].st)} → ${T(evs[evs.length - 1].en)}`);
// ── GARDE DE NON-PERTE DE TEXTE (01/09) ────────────────────────────────────
// Le rognage du blanc de tête est un pré-traitement qui peut MANGER de la parole : au
// premier essai (60 ms d'air) il a coupé 38 mots, tous en début de bloc. Un sous-titre
// qui arrive à l'heure mais amputé est un plus mauvais résultat qu'un sous-titre en
// avance. On compare donc, bloc par bloc, le premier mot produit à celui de la
// transcription NON rognée gardée en réserve.
const norm = (w) => w.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9']/gi, '').toLowerCase();
const ampute = [];
for (const b of blocs) {
  const ref = path.join(work, '..', 'subs02-cache-avant-rognage', `${b.id}.cache.json`);
  const ass = path.join(work, `${b.id}.ass`);
  if (!fs.existsSync(ref) || !fs.existsSync(ass)) continue;
  const tr = JSON.parse(fs.readFileSync(ref, 'utf8')).transcription || [];
  // ⚠️ On compare aux TROIS premiers mots, pas au premier. `subs.mjs` élide la ponctuation
  // et les amorces en tête de ligne (`t.replace(/^[,;:.!?…·\s-]+/, '')`), donc le premier
  // mot produit diffère légitimement du premier mot brut — un contrôle sur le seul premier
  // mot criait au loup sur F09 et F22 alors que rien n'était coupé. *Une jauge qui sonne
  // sur du travail correct finit par être ignorée le jour où elle a raison.*
  const debut3 = tr.map((x) => x.text).join(' ').trim().split(/\s+/).slice(0, 3).map(norm).filter(Boolean);
  const L = fs.readFileSync(ass, 'utf8').split('\n').find((x) => x.startsWith('Dialogue'));
  const obtenu = norm(((L || '').split(',,').pop() || '').replace(/\{[^}]*\}/g, '').trim().split(/\s+/)[0] || '');
  if (debut3.length && obtenu && !debut3.includes(obtenu)) {
    ampute.push(`${b.id} attendu l'un de « ${debut3.join(' / ')} », obtenu « ${obtenu} »`);
  }
}
console.log(`  1er mot conservé dans chaque bloc : ${ampute.length ? `⛔ ${ampute.length} bloc(s) amputé(s)` : '✓'}`
  + (ampute.length ? ` — ${ampute.join(' · ')}` : ''));

// ── GARDE DE PARALLÉLISME VOIX ↔ SOUS-TITRE (01/09) ─────────────────────────
// Consigne du monteur, après DEUX signalements du même défaut : « tu ne dois pas faire
// apparaître le sous-titre avant que je commence de parler […] contrôle toujours ce
// parallélisme quand tu poses des sous-titres. » Contrôlé sur la SORTIE, pas seulement
// en amont : un `--only` peut avoir laissé en place un ASS de bloc d'avant le rognage.
const AVANCE_MAX = 0.15;
const fautifs = [];
for (const b of blocs) {
  const w = path.join(work, `${b.id}.wav`);
  if (!fs.existsSync(w)) continue;
  const prem = evs.find((e) => e.st >= b.t0 - 0.001 && e.st < b.t1);
  if (!prem) continue;
  const v = JSON.parse(execFileSync(PY, [path.join(HERE, 'vad.py'), w], { encoding: 'utf8' }))[w];
  if (!v || v.debut == null) continue;
  const avance = (b.t0 + v.debut) - prem.st;      // > 0 : le sous-titre part AVANT la voix
  if (avance > AVANCE_MAX) fautifs.push(`${b.id} +${avance.toFixed(2)} s à ${T(prem.st)}`);
}
console.log(`  parallélisme voix ↔ sous-titre : ${fautifs.length} bloc(s) au-delà de ${AVANCE_MAX} s d'avance`
  + (fautifs.length ? ` — ${fautifs.join(' · ')}` : ' ✓'));

if (chev) { console.error('⛔ chevauchements : libass les EMPILERAIT (deux lignes à l\'écran)'); process.exit(1); }
if (ampute.length) {
  console.error(`⛔ ${ampute.length} bloc(s) ne commencent pas par ce qui est prononcé : de la parole a été coupée.`);
  process.exit(1);
}
if (fautifs.length) {
  // Défaut OUVERT et non résolu au 01/09 : il est RAPPORTÉ, pas transformé en échec —
  // sans quoi plus aucun ASS ne pourrait être produit tant que le VAD ne sait pas
  // distinguer voix et ambiance. Un garde qui bloque tout ne se garde pas, il se
  // contourne. Il redeviendra bloquant le jour où la correction existera.
  console.error(`⚠ ${fautifs.length} bloc(s) où le sous-titre APPARAÎT AVANT LA VOIX de plus de ${AVANCE_MAX} s`
    + ' — défaut connu, non corrigé (voir § ROGNER).');
}
