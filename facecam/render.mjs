#!/usr/bin/env node
// facecam/render.mjs — rend un EDL Fast Facecam en 1 vidéo mergée (offline).
// Deux dynamismes intégrés :
//  (1) TÊTE SERRÉE : chaque span démarre pile à l'onset de parole (fine silencedetect),
//      + `lead` s seulement de respiration -> plus de délai mort avant qu'il parle.
//  (2) COMPRESSION INTERNE : les silences internes >= silThresh sont ramenés à silTarget.
// Puis concat (démuxer) + loudnorm UNE fois. Coupes DANS le silence -> aucun mot tronqué.
// Usage: node facecam/render.mjs <edl.json> [--def 1080|2160] [--out <fichier.mp4>]
//
// DÉFINITION (31/07). Les rushs parlés sont en 3840×2160 : le 1080p était un choix du
// pipeline, pas une limite de la matière. Défaut = `Réglages/definition.txt` (même contrat
// que monte.mjs/vlog.mjs), surchargeable par `--def`. `--out` sert à ne pas écraser le v11
// 1080p de référence quand on rejoue le même EDL en 4K. Les segments intermédiaires vont
// dans un dossier PROPRE à la définition : sans ça, un `segs/` rempli en 1080p serait
// re-concaténé tel quel et le 4K sortirait en 1080p sans un mot.
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { listClips, detectSilences, probeDur } from './lib.mjs';
import { purgeApresRendu } from '../store.mjs';
import { palier, PALIER_DEFAUT } from '../profil.mjs';   // les paliers de serrement

const argv = process.argv.slice(2);
// on RETIRE les options (nom + valeur) avant de chercher le positionnel : sinon la valeur
// d'un `--out` passerait pour l'EDL.
const flag = (n) => { const i = argv.indexOf(n); if (i < 0) return null; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const OUT_ARG = flag('--out'), DEF_ARG = flag('--def'), SERR_ARG = flag('--serrement');
const edlPath = argv.find((a) => !a.startsWith('--'));
if (!edlPath) { console.error('usage: node facecam/render.mjs <edl.json> [--def 1080|2160] [--out x.mp4] [--serrement doux|normal|serre|tres-serre]'); process.exit(1); }
const REGLAGES = path.join(process.env.HOME, 'Movies', 'Montage', 'Réglages');
const lireDef = () => { try { return fs.readFileSync(path.join(REGLAGES, 'definition.txt'), 'utf8'); } catch { return '1080'; } };
const DEF = /2160|4k/i.test(DEF_ARG ?? lireDef()) ? 2160 : 1080;
const VID_W = DEF === 2160 ? 3840 : 1920, VID_H = DEF === 2160 ? 2160 : 1080;
const edl = JSON.parse(fs.readFileSync(edlPath, 'utf8'));
const rushDir = edl.rushDir;
const OUT = OUT_ARG ?? edl.out;
const HFLIP = !!edl.hflip;                       // remet l'image miroir DJI à l'endroit
// ═══ LE SERREMENT ════════════════════════════════════════════════════════════════════
// Quatre leviers, et un ORDRE DE PRIORITÉ qui ne change rien à l'existant :
//   ① une clé posée dans l'EDL gagne toujours  → les 20 EDL déjà rendus sont intacts
//   ② --serrement <palier>                     → le choix du moment
//   ③ la clé `serrement` de l'EDL              → le choix collé au projet
//   ④ le palier par défaut du profil           → « serre » depuis le 10/09 (18 EDL l'ont porté)
// On ne retombe jamais en silence : un palier inconnu ARRÊTE (un serrement choisi et non
// appliqué sortirait un master hors intention, et rien ne le dirait).
const PAL = palier(SERR_ARG ?? edl.serrement ?? PALIER_DEFAUT);
const LEAD = edl.lead ?? PAL.lead;               // respiration gardée avant l'onset (tête serrée)
const TAIL = edl.tail ?? PAL.tail;               // silence gardé après la fin
const TH = edl.silThresh ?? PAL.silThresh;       // silence interne compressé au-delà
const TG = edl.silTarget ?? PAL.silTarget;       // durée cible d'un silence compressé
// Les clés de l'EDL peuvent contredire le palier : on le DIT, plutôt que d'annoncer un
// palier qui n'a pas servi.
const IMPOSES = ['lead', 'tail', 'silThresh', 'silTarget'].filter((k) => edl[k] !== undefined);
// Un EDL qui ne déclare rien reçoit quand même un réglage : il doit l'entendre, pas le subir.
// (Avant le 10/09 ce bloc criait sur « historique » ; le défaut a changé, la ligne reste — ce
// qu'on annonce, c'est le palier SERVI, pas celui qu'on espérait.)
if (!SERR_ARG && !edl.serrement && IMPOSES.length === 0) {
  console.log(`ℹ️  aucun serrement déclaré → palier du profil « ${PAL.nom} » (queue ${PAL.tail} s, `
    + `respiration ${PAL.lead} s). Un autre : --serrement doux|normal|serre|tres-serre.`);
}
if (!PAL.eprouve) console.log(`⚠️  palier « ${PAL.nom} » JAMAIS éprouvé sur un rendu — le garde de la parole tranchera.`);
const FPS = edl.fps ?? '30000/1001';
const CRF = edl.crf ?? 20;

// ═══ LES IDS DE CLIP NE DOIVENT PAS DÉPENDRE DU CONTENU DU DOSSIER (31/07) ═══════════
// `listClips()` numérote c1..cN par ORDRE ALPHABÉTIQUE. Donc déposer un seul rush de plus
// dans l'inbox DÉCALE TOUS LES IDS, et un EDL écrit la veille désigne silencieusement
// d'autres fichiers. Vécu : un `DJI_20260724143315` copié dans l'inbox après coup a décalé
// les 10 clips du VLOG #01 d'un cran ; rejoué tel quel, l'EDL de 28 spans a rendu
// **220,0 s au lieu de 451,8 s** — 9 segments VIDES (seek au-delà de la fin d'un rush plus
// court : ffmpeg sort un mp4 de 695 octets et RETOURNE 0) et 1 tronqué. Aucune erreur,
// aucun avertissement, un fichier plausible. La seule chose qui l'a révélé, c'est la durée.
//
// Parade en deux temps :
//  (1) un EDL peut PORTER sa table `clips` (id → nom de fichier). C'est une décision de
//      montage, elle appartient à l'EDL, pas à l'état d'un dossier. On la privilégie.
//  (2) GARDE DURE quand il n'y en a pas : chaque span doit tenir dans la durée de son clip.
//      Un span qui déborde arrête le rendu au lieu de fabriquer un trou.
const parClasse = Object.fromEntries(listClips(rushDir).map(c => [c.id, c.file]));
const clips = edl.clips
  ? Object.fromEntries(Object.entries(edl.clips).map(([id, nom]) => {
      const f = path.isAbsolute(nom) ? nom : path.join(rushDir, nom);
      const cand = [f, f + '.MP4', f + '.mp4', f + '.MOV', f + '.mov'].find(p => fs.existsSync(p));
      if (!cand) throw new Error(`EDL.clips : fichier introuvable pour ${id} → ${nom}`);
      return [id, cand];
    }))
  : parClasse;
if (edl.clips) {
  const diff = Object.keys(clips).filter(id => clips[id] !== parClasse[id]);
  console.log(`· table de clips lue dans l'EDL (${Object.keys(clips).length} clips)`
    + (diff.length ? `  ⚠ ${diff.length} id(s) que l'ordre alphabétique du dossier attribuerait AUTREMENT : ${diff.join(', ')}` : ''));
}

// GARDE : un span hors des bornes de son rush = rendu arrêté, jamais un segment vide.
{
  const durees = {};
  const debords = [];
  for (const sp of edl.spans) {
    const file = clips[sp.clip];
    if (!file) throw new Error(`clip inconnu: ${sp.clip}`);
    if (durees[sp.clip] == null) durees[sp.clip] = probeDur(file);
    const besoin = sp.b + TAIL + 0.15;
    if (besoin > durees[sp.clip]) {
      debords.push(`  ✗ ${sp.clip} « ${sp.label || ''} » : le span va jusqu'à ${besoin.toFixed(2)} s`
        + ` mais ${path.basename(file)} ne dure que ${durees[sp.clip].toFixed(2)} s`);
    }
  }
  if (debords.length) {
    console.error(`\n✗ ${debords.length} span(s) débordent de leur rush — le rendu est ANNULÉ.`);
    console.error(debords.join('\n'));
    console.error(`\nCause la plus probable : les ids c1..cN sont attribués par ordre ALPHABÉTIQUE`
      + ` du dossier ${rushDir}\net son contenu a changé depuis l'écriture de l'EDL.`
      + ` Parade : ajouter une table "clips" dans l'EDL (id → nom de fichier).`);
    process.exit(1);
  }
}

// ═══ ÉQUILIBRAGE DE LUMIÈRE : MESURÉ TOUT SEUL SI L'EDL NE LE PORTE PAS (02/08) ══════
// POURQUOI. `render.mjs` se contentait de lire `sp.lum` — s'il était ABSENT, `grade` valait
// null et le rendu sortait SANS AUCUNE correction de lumière, sans un mot. Deux défauts d'un
// coup, tous deux déjà nommés dans SKILL.md : (1) la correction dépendait de ma discipline à
// lancer `lumieres.mjs --apply` avant de rendre — *une règle mécanisée mais déclenchée à la
// main n'est mécanisée qu'à moitié* ; (2) son absence était SILENCIEUSE — *un garde-fou
// silencieux est indiscernable d'un garde-fou débranché*. Un EDL écrit à la main, ou un span
// ajouté après coup à un EDL déjà équilibré, produisait donc un plan non corrigé au milieu
// d'un film corrigé : exactement le flash au raccord que l'outil existe pour supprimer.
// COMMENT. Process fils (`lumieres.mjs` est un script prod : l'importer exécuterait son
// top-level), puis relecture de l'EDL pour récupérer les `lum`. `MONTAGE_NO_LUM=1` désarme.
// On imprime une ligne DANS TOUS LES CAS, y compris « déjà équilibré ».
const sansLum = edl.spans.filter((sp) => !(sp.lum && sp.lum.curve)).length;
if (sansLum && !process.env.MONTAGE_NO_LUM) {
  console.log(`· équilibrage de lumière : ${sansLum}/${edl.spans.length} span(s) sans \`lum\` → mesure automatique…`);
  try {
    execSync(`"${process.execPath}" "${path.join(import.meta.dirname, 'lumieres.mjs')}" "${edlPath}" --apply`,
      { stdio: 'inherit', maxBuffer: 1 << 28 });
    const frais = JSON.parse(fs.readFileSync(edlPath, 'utf8'));
    // report par INDEX : `lumieres --apply` n'ajoute que `lum`, il ne touche ni l'ordre ni les bornes.
    edl.spans.forEach((sp, i) => { if (frais.spans[i] && frais.spans[i].lum) sp.lum = frais.spans[i].lum; });
    const reste = edl.spans.filter((sp) => !(sp.lum && sp.lum.curve)).length;
    console.log(reste ? `  ⚠ ${reste} span(s) restent SANS correction de lumière` : '  ✓ tous les spans sont équilibrés');
  } catch (e) {
    console.log(`  ⚠ mesure impossible (${String(e.message).split('\n')[0]}) — RENDU SANS CORRECTION DE LUMIÈRE`);
  }
} else if (sansLum) {
  console.log(`· équilibrage de lumière : DÉSARMÉ (MONTAGE_NO_LUM) — ${sansLum} span(s) rendus sans correction`);
} else {
  console.log(`· équilibrage de lumière : déjà mesuré sur les ${edl.spans.length} spans de l'EDL`);
}

const WORK = `${rushDir}/.facecam_work/segs${DEF === 2160 ? '2160' : ''}`; fs.mkdirSync(WORK, { recursive: true });
const segFiles = [];

edl.spans.forEach((sp, idx) => {
  const file = clips[sp.clip];
  if (!file) throw new Error(`clip inconnu: ${sp.clip}`);
  // REFINED : a/b déjà resserrés sur la voix par refine.mjs -> pas de re-détection d'onset dB
  // (sinon on ré-inclut la respiration). On applique les cuts fillers + la compression interne.
  const R0 = Math.max(0, sp.a - (sp.refined ? 0.30 : 0.8));
  const regionEnd = sp.b + TAIL + 0.15;
  const sil = detectSilences(file, { noise: '-30dB', d: 0.12, ss: R0, to: regionEnd });
  let onsetRel;
  if (sp.refined) {
    onsetRel = sp.a - R0;                          // a = onset de voix (refine)
  } else {
    const lead = sil.find(s => s.s <= 0.18);       // legacy : onset = fin du silence de tête
    onsetRel = lead ? lead.e : Math.max(0, sp.a - R0);
  }
  // noLead : début rogné par PROBE (amorce « et que/voilà donc » retirée) → PAS de lead arrière
  // (sinon on ré-inclut le filler qu'on vient de couper).
  const leadAmt = sp.noLead ? 0 : LEAD;
  const keepStart = Math.max(0, onsetRel - leadAmt);
  const keepEnd = Math.min(regionEnd - R0, (sp.b - R0) + TAIL);
  // coupes = (a) fillers isolés détectés par refine (sp.cuts, temps ABSOLUS source) + (b) silences internes >= TH
  const cuts = [];
  for (const [c0, c1] of (sp.cuts || [])) {        // fillers du refine -> relatif R0
    const r0 = c0 - R0, r1 = c1 - R0;
    if (r1 > r0) cuts.push([r0, r1]);
  }
  const L = TG * 0.55, T = TG * 0.45;
  for (const s of sil) {
    if (s.s > onsetRel + 0.05 && s.e < keepEnd - 0.05 && (s.e - s.s) >= TH) {
      const c0 = s.s + L, c1 = s.e - T;
      if (c1 - c0 > 0.04) cuts.push([c0, c1]);
    }
  }
  cuts.sort((x, y) => x[0] - y[0]);
  // keeps = [keepStart,keepEnd] moins les coupes (fusionnées)
  const keeps = [];
  let p = keepStart;
  for (const [c0, c1] of cuts) { if (c0 > p) keeps.push([p, c0]); p = Math.max(p, c1); }
  if (keepEnd > p) keeps.push([p, keepEnd]);
  const kept = keeps.map(([a, b]) => (b - a)).reduce((x, y) => x + y, 0);

  // ⭐⭐ LE MICRO-SEGMENT — « un rush rapide de quelques centièmes au début » (le monteur, 3 fois).
  // le monteur l'a signalé sur le bloc badge F09 le 17/09, le 18/09 et le 19/09 ; il a été classé
  // « propre » deux fois. Il existe, et il naît ICI : quand une coupe de `refine` (un filler)
  // est suivie de près par une coupe de silence, il reste entre les deux un keep de quelques
  // IMAGES — sur `architecture-sino-musulmane`, 2,8 images, soit la queue d'un « Euh… » que
  // le spectateur voit passer avant la phrase.
  //
  // ⚠ CE N'EST PAS UNE MESURE D'IMAGE, ET C'EST VOULU. Le 19/09 la piste suivie était la
  // DIFFÉRENCE IMAGE À IMAGE sur le master rendu, avec un seuil ABSOLU (0,60) : elle
  // désignait 6 spans. Normalisée par la médiane du span, elle n'en désigne plus qu'UN —
  // celui-ci, à 5,3× sa médiane, les cinq autres entre 1,6× et 2,6×, c'est-à-dire du
  // mouvement de facecam ordinaire. *Un proxy à seuil absolu fabrique des défauts ; et un
  // faux positif ne se prononce pas à l'œil.* Le plan de coupe, lui, ne se trompe pas : un
  // keep de 2,8 images EST un micro-segment, par construction, sans rien décoder.
  //
  // ⚠ Et le refus est posé AVANT l'encodage du span : un garde qui mord après 17 minutes de
  // ré-encodage est un garde qu'on désarme. Réserve : `_reserves_micro` dans l'EDL, une
  // entrée `"<label>:<n° de keep>"`, chiffrée comme les autres.
  const MICRO_IMG = 8;        // en dessous, un keep ne porte ni image lisible ni syllabe
  keeps.forEach(([ka, kb], k) => {
    if ((kb - ka) * 30 >= MICRO_IMG) return;
    const cle = `${sp.label}:${k}`;
    const decl = (edl._reserves_micro || []).includes(cle);
    const msg = `span ${idx} « ${sp.label} » : keep #${k}/${keeps.length} ne dure que `
      + `${((kb - ka) * 30).toFixed(1)} image(s) (${(R0 + ka).toFixed(3)}→${(R0 + kb).toFixed(3)} source) `
      + `— micro-segment visible au montage`;
    if (decl) { console.log(`  · micro-segment DÉCLARÉ en réserve (${cle}) — ${msg}`); return; }
    console.error(`\n⛔ MICRO-SEGMENT — ${msg}`);
    console.error(`   → déplacer la borne a au-delà de la coupe, ou retirer le cut de tête ;`);
    console.error(`     réserve assumée = ajouter "${cle}" à _reserves_micro dans l'EDL.\n`);
    process.exit(1);
  });

  const sel = keeps.map(([a, b]) => `between(t,${a.toFixed(3)},${b.toFixed(3)})`).join('+');
  // ÉQUILIBRAGE DE LUMIÈRE (le monteur, 02/08) : l'expo auto du DJI se cale différemment d'une prise
  // à l'autre (tournage à contre-jour devant une fenêtre) — enchaîner deux spans écartés de
  // 30 IRE fait un flash au raccord. `sp.lum.curve` est MESURÉ par facecam/lumieres.mjs, jamais
  // écrit à la main. Posé AVANT `format=yuv420p` (curves travaille en RGB).
  const grade = sp.lum && sp.lum.curve ? `curves=all='${sp.lum.curve}'` : null;
  const vf = [`select='${sel}'`, `setpts=N/FRAME_RATE/TB`, `scale=${VID_W}:${VID_H}:flags=bicubic`,
    `fps=${FPS}`, HFLIP ? `hflip` : null, grade, `format=yuv420p`, `setsar=1`].filter(Boolean).join(',');
  const af = [`aselect='${sel}'`, `asetpts=N/SR/TB`, `aresample=48000:async=1`].join(',');
  const seg = `${WORK}/${String(idx).padStart(2, '0')}_${sp.clip}_${sp.label || ''}.mp4`;
  // -t AVANT -i : borne le décodage à la région lue. Sinon, avec un filtre `select`,
  // le -t de sortie ne se déclenche jamais (le temps de sortie gèle sur les frames droppées)
  // et ffmpeg décode le rush jusqu'à la fin (hang sur un rush de 8 min). Cf. README §Pièges.
  const cmd = `ffmpeg -y -v error -ss ${R0.toFixed(3)} -t ${(keepEnd + 0.15).toFixed(3)} -i "${file}" ` +
    `-map 0:v:0 -map 0:a:0 -vf "${vf}" -af "${af}" ` +
    `-c:v libx264 -crf ${CRF} -preset medium -pix_fmt yuv420p ` +
    `-c:a aac -b:a 192k -ar 48000 -ac 2 -video_track_timescale 30000 "${seg}"`;
  execSync(cmd, { maxBuffer: 1 << 28 });
  console.log(`[${idx}] ${sp.clip} onset=${(R0 + onsetRel).toFixed(2)} cutsInternes=${cuts.length} kept=${kept.toFixed(1)}s  ${sp.label || ''}`);
  segFiles.push(seg);
});

// ═══ SOUDURE CFR — et elle se MESURE avant de rendre la main (18/09) ══════════
// LE DÉFAUT QUE ÇA CORRIGE. le monteur, sur le master du 17/09 : « le son est décalé de mes
// paroles ». Le concat démuxer cale chaque fichier sur la durée de son CONTENEUR — or
// la piste AAC d'un segment dépasse toujours un peu sa vidéo (granularité de 1024
// échantillons = 21 ms, plus le delay d'encodeur). Ces restes ne se compensent pas :
// ils s'additionnent en TROUS dans la timeline vidéo. Mesuré sur VLOG_Chine03_facecam_v1 :
// 19 sauts, +0,355 s d'avance du pts sur l'index à la fin, 0 recul — donc invisible pour
// un contrôle de durée, de compte d'images ou de dérive A/V, qui étaient tous au vert.
// Et c'est fatal en aval : `vlog.mjs` découpe l'IMAGE par index et le SON en secondes.
// Sur un master qui dérive, les deux ne désignent plus le même instant.
//
// LE REMÈDE N'EST PAS NEUF : fusion.mjs l'applique déjà un étage plus haut (re-mux
// MPEG-TS — pas d'edit list, pas de start_time à propager —, `duration` explicite
// DÉRIVÉE DU COMPTE D'IMAGES et jamais du champ `duration` du conteneur, audio
// reconstruit puis recadré à la durée VIDÉO de chaque morceau). Il ne pouvait pas
// sauver le #02 parce que ses ENTRÉES dérivaient déjà en interne ; ici les segments
// sortent d'un `fps=` et sont CFR chacun, donc la soudure l'est aussi.
// « Qui d'autre a la même forme ? » avait une réponse, et personne n'était allé la chercher.
const nbFrames = (f) => Number(execSync(
  `ffprobe -v error -select_streams v:0 -count_packets -show_entries stream=nb_read_packets -of csv=p=0 "${f}"`).toString().trim());
const [fn, fd] = String(FPS).split('/').map(Number);
const fps = fd ? fn / fd : fn;
const segFrames = segFiles.map(nbFrames);

const tsDir = `${rushDir}/.facecam_work/ts${DEF === 2160 ? '2160' : ''}`;
fs.rmSync(tsDir, { recursive: true, force: true });
fs.mkdirSync(tsDir, { recursive: true });
const tsFiles = segFiles.map((f, i) => {
  const o = `${tsDir}/${String(i).padStart(3, '0')}.ts`;
  execSync(`ffmpeg -y -v error -i "${f}" -map 0:v:0 -c copy -bsf:v h264_mp4toannexb -f mpegts "${o}"`);
  return o;
});
const listTxt = `${tsDir}/concat.txt`;
fs.writeFileSync(listTxt, tsFiles.map((f, i) =>
  `file '${f.replace(/'/g, "'\\''")}'\nduration ${(segFrames[i] / fps).toFixed(6)}`).join('\n') + '\n');
const vOnly = `${tsDir}/_v.mp4`;
execSync(`ffmpeg -y -v error -f concat -safe 0 -i "${listTxt}" -c copy -an -video_track_timescale 15360 "${vOnly}"`);

// audio : chaque segment ramené à la durée VIDÉO de SON segment (apad puis atrim : on
// comble s'il manque, on coupe s'il déborde), concaténé, PUIS loudnorm en une seule passe.
const aOnly = `${tsDir}/_a.m4a`;
{
  const ins = segFiles.map(f => `-i "${f}"`).join(' ');
  const fc = segFiles.map((_, k) =>
    `[${k}:a]aresample=48000:async=1,apad,atrim=0:${(segFrames[k] / fps).toFixed(6)},asetpts=N/SR/TB[a${k}]`).join(';')
    + ';' + segFiles.map((_, k) => `[a${k}]`).join('') + `concat=n=${segFiles.length}:v=0:a=1[ac]`
    + ';[ac]loudnorm=I=-16:TP=-1.5:LRA=11[out]';
  execSync(`ffmpeg -y -v error ${ins} -filter_complex "${fc}" -map "[out]" -c:a aac -b:a 192k -ar 48000 -ac 2 "${aOnly}"`,
    { maxBuffer: 1 << 28 });
}
execSync(`ffmpeg -y -v error -i "${vOnly}" -i "${aOnly}" -map 0:v:0 -map 1:a:0 -c copy -movflags +faststart "${OUT}"`);

// ⭐ ET ON MESURE LA SORTIE, pas l'intention. Un garde-fou neuf se valide sur le cas qu'il
// doit attraper : celui-ci a été éprouvé contre l'ancienne soudure (écart 355 ms, il mord)
// AVANT de servir. `parseFloat` et non `Number` : `csv=p=0` laisse une virgule en fin de
// ligne, et `Number("0.0,")` vaut NaN — toute comparaison avec NaN est fausse, donc le
// garde se déclarerait vert sans rien lire (piège payé le 31/08 dans fusion.mjs).
{
  const pts = execSync(`ffprobe -v error -select_streams v:0 -show_entries frame=pts_time -of csv=p=0 "${OUT}"`,
    { maxBuffer: 1 << 28 }).toString().trim().split('\n').map(l => parseFloat(l));
  let ecartMax = 0, reculs = 0;
  for (let i = 0; i < pts.length; i++) {
    if (!Number.isFinite(pts[i])) throw new Error(`horloge : pts illisible à l'image ${i} — le contrôle ne peut pas se prononcer`);
    ecartMax = Math.max(ecartMax, Math.abs(pts[i] - i / fps));
    if (i && pts[i] <= pts[i - 1]) reculs++;
  }
  const cfr = ecartMax <= 0.040 && reculs === 0;
  console.log(`\n· horloge  : ${pts.length} images · écart index↔pts ${(ecartMax * 1000).toFixed(0)} ms · ${reculs} recul(s)`
    + (cfr ? '  ✅ CFR' : '  ❌'));
  if (!cfr) throw new Error(`soudure NON CFR (écart ${ecartMax.toFixed(3)} s, ${reculs} recul(s)) : vlog.mjs découpe l'image par index et le son en secondes — les deux ne pointeraient pas le même instant`);
}
const dur = execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${OUT}"`).toString().trim();
const sz = (fs.statSync(OUT).size / 1e6).toFixed(1);

// ═══ MANIFESTE DE SPANS + DÉTECTION DE DÉRIVE (31/07) ════════════════════════
// POURQUOI. Rejouer le MÊME EDL sur les MÊMES rushs n'est pas garanti de rendre le même
// nombre d'images : le rendu 4K du 31/07 est sorti à 13 532 images là où celui du 25/07 en
// faisait 13 533 — une seule image, dans `programme-itineraire`, très probablement due à un
// ffmpeg qui a changé entre les deux dates. Une image, c'est 33 ms, donc invisible ; mais
// tout ce qui indexe le rendu par TIMECODE en dépend : les `t0`/`t1` du plan de burn des
// overlays, les frontières de `sujets.json` qui découpent les blocs du vlog, les sous-titres.
// Le problème n'est pas la dérive, c'est de l'apprendre par hasard en comparant deux durées.
// Ici on écrit ce que le rendu contient VRAIMENT, span par span, et on compare au dernier
// manifeste du même EDL : la dérive est NOMMÉE, LOCALISÉE, et chiffrée en aval.
// (`nbFrames` / `fps` sont définis plus haut, au moment de la soudure : la même grandeur
// mesurée deux fois avec deux définitions, c'est deux outils qui finissent par se contredire.)
let cum = 0;
const spansOut = segFiles.map((f, i) => {
  const sp = edl.spans[i];
  const n = segFrames[i];
  const row = { i, label: sp.label || '', clip: sp.clip, a: sp.a, b: sp.b, frames: n, offset: cum, t: +(cum / fps).toFixed(3) };
  cum += n;
  return row;
});
const manifeste = {
  edl: path.basename(edlPath), out: path.basename(OUT), w: VID_W, h: VID_H, fps: String(FPS),
  total_frames: cum, total_s: +(cum / fps).toFixed(3), spans: spansOut,
};
const sidecar = `${OUT.replace(/\.[^.]+$/, '')}.spans.json`;
fs.writeFileSync(sidecar, JSON.stringify(manifeste, null, 1));

// comparaison au manifeste le plus récent du MÊME EDL (toutes définitions confondues : à
// nombre d'images près, un rendu 1080p et un rendu 4K doivent être rigoureusement jumeaux).
let alerte = '';
try {
  const dir = path.dirname(OUT);
  const refs = fs.readdirSync(dir).filter(f => f.endsWith('.spans.json') && f !== path.basename(sidecar))
    .map(f => path.join(dir, f))
    .map(p => ({ p, j: JSON.parse(fs.readFileSync(p, 'utf8')), m: fs.statSync(p).mtimeMs }))
    .filter(x => x.j.edl === manifeste.edl)
    .sort((a, b) => b.m - a.m);
  if (refs.length) {
    const ref = refs[0];
    // on ne compare QUE les spans que l'EDL n'a pas touchés (même clip, mêmes bornes) :
    // une frontière déplacée exprès n'est pas une dérive, c'est une décision.
    const parCle = Object.fromEntries(ref.j.spans.map(s => [`${s.clip}|${s.a}|${s.b}`, s]));
    const derives = spansOut.map(s => ({ s, r: parCle[`${s.clip}|${s.a}|${s.b}`] }))
      .filter(x => x.r && x.r.frames !== x.s.frames);
    if (derives.length) {
      const d0 = derives[0];
      alerte = `\n⚠️  DÉRIVE D'IMAGES contre ${path.basename(ref.p)} (${ref.j.w}×${ref.j.h}) :`
        + ` ${derives.length} span(s) inchangé(s) dans l'EDL rendent un nombre d'images DIFFÉRENT.\n`
        + derives.slice(0, 6).map(x =>
            `      ${x.s.clip} « ${x.s.label} » : ${x.r.frames} → ${x.s.frames} images (${x.s.frames - x.r.frames >= 0 ? '+' : ''}${x.s.frames - x.r.frames})`).join('\n')
        + `\n      total ${ref.j.total_frames} → ${cum} images.`
        + `\n      → tout ce qui indexe ce rendu par TIMECODE glisse à partir de ${d0.s.t.toFixed(2)} s :`
        + ` plan de burn des overlays, frontières de sujets.json, sous-titres.`
        + `\n      → cause habituelle : ffmpeg a changé de version depuis le rendu de référence.`
        + ` Vérifier les frontières situées APRÈS ce point, ou re-caler le plan de burn.`;
    } else {
      alerte = `\n  ✓ aucune dérive d'images contre ${path.basename(ref.p)} (${ref.j.total_frames} images, spans inchangés identiques)`;
    }
  }
} catch (e) { alerte = `\n  (comparaison au manifeste précédent impossible : ${e.message})`; }

console.log(`\n✓ ${OUT}\n  ${VID_W}×${VID_H}  durée=${dur}s  ${cum} images  taille=${sz}MB  hflip=${HFLIP}`
  + `\n  serrement=${PAL.nom}${IMPOSES.length ? ` (mais ${IMPOSES.join(', ')} imposé(s) par l'EDL)` : ''}`
  + `  lead=${LEAD}s  tail=${TAIL}s  compression=${TH}->${TG}s`
  + `\n  manifeste de spans → ${path.basename(sidecar)}${alerte}`);

// ⭐⭐ LE GARDE DE LA PAROLE — il BLOQUE, il n'avertit pas (05/09).
// Le 05/09 le monteur a dû signaler à la main 5 défauts sur un master que TOUS les contrôles
// avaient laissé passer : 3 relances, un « euh » de 0,76 s, un mot amputé. Ma parade
// spontanée — « relire le transcript du rendu » — ne pouvait pas marcher : whisper
// DÉDUPLIQUE deux prises identiques consécutives, donc le défaut est invisible dans
// l'objet même qu'on relit. Le contrôle vit maintenant dans parole.mjs (découpe au
// silence + transcription de chaque burst SEUL + stabilité spectrale + frontières).
// Il est appelé ICI parce que le rendu est le SEUL point par lequel un master doit
// passer : une leçon qui dépend de mon souvenir de lancer un outil n'est pas tenue.
// Une exception se DÉCLARE et se chiffre dans l'EDL (`_reserves_parole`), jamais en
// baissant un seuil. MONTAGE_NO_PAROLE=1 désarme (débogage seulement).
// ⭐⭐ ET IL LAISSE UN QUITUS, SINON IL NE PROTÈGE QUE CE RENDU-CI (18/09).
// Trou trouvé en relisant la chaîne : ce garde sortait en `exitCode = 1`… mais le master
// restait sur le disque, et `vlog.mjs` — l'étage qui fabrique l'épisode que le monteur REGARDE —
// ne lui demandait rien. Un master recalé pouvait donc être livré au tour suivant, et le
// garde n'aurait jamais tourné dessus. *Un refus qui n'empêche pas l'étage suivant de
// consommer l'objet n'est pas un refus, c'est un avertissement.*
// D'où un QUITUS écrit à côté du master (`<master>.parole.json`), qui porte l'EMPREINTE du
// fichier (taille ^ mtime, la même ruse que la clé de cache de vlog.mjs) : re-rendre le
// master change l'empreinte et périme le quitus tout seul. `vlog.mjs` refuse sans lui.
const QUITUS = OUT.replace(/\.mp4$/i, '.parole.json');
const empreinteDe = (f) => { const st = fs.statSync(f); return (Number(st.size) ^ Math.round(st.mtimeMs)).toString(36).slice(-8); };
const poseQuitus = (etat, detail) => {
  try {
    fs.writeFileSync(QUITUS, JSON.stringify({ master: path.basename(OUT), empreinte: empreinteDe(OUT),
      etat, detail, date: new Date().toISOString() }, null, 1));
  } catch (e) { console.error(`⚠ quitus non écrit (${e.message})`); }
};
// ⚠ on efface le quitus AVANT de contrôler : si le contrôle plante en cours de route, il ne
// doit pas rester un quitus périmé qui ferait passer le master. Un garde ne laisse jamais
// derrière lui un état qui veut dire « oui » par défaut.
try { fs.rmSync(QUITUS, { force: true }); } catch {}

if (process.env.MONTAGE_NO_PAROLE === '1') {
  console.log('\n· garde parole DÉSARMÉ (MONTAGE_NO_PAROLE=1) — le master n\'est PAS contrôlé');
  poseQuitus('DESARME', 'MONTAGE_NO_PAROLE=1 — le master n\'a PAS été contrôlé');
} else {
  // ⭐⭐ UNE CARTE TROUVÉE N'EST PAS UNE CARTE QUI PARLE DE CE MONTAGE (19/09).
  // Le choix se faisait au NOM (`^carte.*\.json$`, premier match) : sur le dossier de
  // coulisses de l'EP3, `carte-aout.json` — la carte de l'épisode #02 — vient avant
  // `carte-episode3.json` dans l'ordre alphabétique. Elle a donc été passée au garde le
  // 18/09. Ses clips s'appellent c12…c27, ceux de l'EP3 c28/c29 : `island()` ne résolvait
  // AUCUN span, la dimension QUEUE n'a jamais été mesurée — et le quitus a écrit
  // « toutes dimensions mesurées ». Un défaut réel y a survécu (`deconcentration-economique`
  // perd « et donc deux sphères », 1,87 s de son après la borne).
  // *Une définition déduite d'un NOM n'est pas une définition* — déjà payé sur les lignées
  // de purge d'`arbo.mjs` le 01/09, jamais porté ici. « Qui d'autre a la même forme ? »
  // avait une réponse.
  // La carte est donc VALIDÉE contre l'EDL : elle doit connaître les clips du montage.
  const clipsEDL = new Set(Object.keys(clips));
  const parleDeCeMontage = (f) => {
    try {
      const c = JSON.parse(fs.readFileSync(f, 'utf8'));
      return (c.clips || []).some((x) => clipsEDL.has(x.id));
    } catch { return false; }
  };
  const candidats = [edl.carte, edlPath.replace(/\.edl(\.refined)?\.json$/, '.carte.json'),
    ...(() => { try { return fs.readdirSync(path.dirname(edlPath)).filter((f) => /^carte.*\.json$/.test(f) && !/\.(subjects|scored|coherence|distill)\./.test(f)).map((f) => path.join(path.dirname(edlPath), f)); } catch { return []; } })()]
    .filter(Boolean).filter((f) => { try { return fs.existsSync(f); } catch { return false; } });
  const ecartees = candidats.filter((f) => !parleDeCeMontage(f));
  const carteGuess = candidats.find(parleDeCeMontage);
  const args = [`"${path.join(import.meta.dirname, 'parole.mjs')}"`, `"${OUT}"`, '--edl', `"${edlPath}"`];
  if (carteGuess) {
    args.push('--carte', `"${carteGuess}"`);
    console.log(`\n· garde parole : carte « ${path.basename(carteGuess)} » (clips de l'EDL reconnus)`
      + (ecartees.length ? ` — ${ecartees.length} carte(s) écartée(s) : ${ecartees.map((f) => path.basename(f)).join(', ')}` : ''));
  } else if (process.env.MONTAGE_QUEUE_RESERVE) {
    console.log(`\n⚠️  garde parole : AUCUNE carte ne connaît les clips de cet EDL — QUEUE NON MESURÉE, `
      + `réserve assumée (MONTAGE_QUEUE_RESERVE="${process.env.MONTAGE_QUEUE_RESERVE}")`);
  } else {
    // ⚠ et ça REFUSE. Une dimension qu'on ne sait pas mesurer se déclare et fait échouer,
    // sinon on désarme le garde par simple omission — c'est exactement ce qui s'est passé.
    console.error(`\n⛔ GARDE PAROLE : aucune carte ne connaît les clips de cet EDL `
      + `(${[...clipsEDL].join(', ')}) — la dimension QUEUE serait NON MESURÉE.`);
    if (candidats.length) console.error(`   Cartes trouvées mais écartées : ${candidats.map((f) => path.basename(f)).join(', ')}`);
    console.error(`   → poser \`"carte": "<chemin>"\` dans l'EDL, ou assumer la réserve avec`);
    console.error(`     MONTAGE_QUEUE_RESERVE="<pourquoi>".`);
    poseQuitus('ECHEC', 'aucune carte valide — dimension QUEUE non mesurable');
    process.exit(1);
  }
  console.log('\n· garde parole : contrôle du master span par span…');
  try {
    console.log(execSync(`"${process.execPath}" ${args.join(' ')}`, { maxBuffer: 1 << 28 }).toString());
    poseQuitus('OK', carteGuess ? 'toutes dimensions mesurées' : 'QUEUE non mesurée (aucune carte)');
  } catch (e) {
    console.log((e.stdout || '').toString());
    console.error("\n⛔ GARDE PAROLE : le master porte des défauts de parole — il n'est PAS livrable en l'état.");
    console.error("   Corriger les bornes indiquées dans l'EDL puis re-rendre (incrémental), ou déclarer");
    console.error("   la réserve dans `_reserves_parole` de l'EDL sous la forme \"<label>:<type>\".");
    console.error("   ⛔ AUCUN QUITUS n'est posé : vlog.mjs REFUSERA ce master tant qu'il n'est pas repassé.");
    poseQuitus('ECHEC', 'le garde parole a mordu — master non livrable');
    process.exitCode = 1;
  }
}

purgeApresRendu();   // rétention N/N-1 : réflexe du moteur, pas de l'opérateur
