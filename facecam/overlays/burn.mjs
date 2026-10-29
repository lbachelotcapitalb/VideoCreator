#!/usr/bin/env node
// ============================================================================
// facecam/overlays/burn.mjs — CAPTURER puis BRÛLER N overlays en UNE passe ffmpeg
//
// Version généralisée de `.coulisses/facecam/v12_burn.mjs`, qui ne savait faire
// QUE le v12 (chemins, fps et sous-titres en dur). La leçon derrière ce fichier :
// *une chaîne qu'on ne peut pas rejouer n'est pas une chaîne* — l'habillage du
// VLOG #02 aurait autrement redemandé d'inventer la même commande.
//
// Usage : node facecam/overlays/burn.mjs <plan.json> [--capture] [--dry]
//                                        [--scale N] [--t <s>] [--out <f.mp4>]
//   --capture  (re)génère les séquences PNG avant de brûler
//   --dry      imprime la commande ffmpeg et sort
//   --t <s>    n'encode que les N premières secondes (validation du filtergraph)
//   --scale N  double les positions quand les PNG viennent d'un `--dsf 2` (4K)
//
// Plan : { video_in, video_out, fps, subs?, frames, overlays:[{id,html,t0,t1,clip}] }
//   · `video_in` est CONTRÔLÉ avant tout (01/09). La rétention N/N-1 met les sources à la
//     corbeille : le plan 1080 du #02 pointait sur un master parti là-bas, et sans garde on le
//     découvrait après la capture, sur une erreur ffmpeg muette. Le garde va regarder dans
//     `~/.Trash` et imprime le `mv` exact. Un plan dont la source est DÉFINITIVEMENT figée le dit
//     dans `_source_a_la_corbeille`.
//   · `fps` DOIT être celui du film — 30/1 ici, 30000/1001 sur le v12. Une cadence
//     supposée fabrique une dérive cumulative parfaitement crédible et fausse.
//   · `clip` = le panneau ÉLARGI (40 px suffisent) pour contenir le halo d'ombre :
//     capturer au ras du panneau rogne l'ombre et laisse un bord net.
//   · `subs` est FACULTATIF : sans lui, aucun filtre `ass` n'est ajouté.
//
// UNE SEULE passe : enchaîner un ré-encodage par overlay empilerait N générations
// de pertes h264. L'audio est copié tel quel (`-c:a copy`) — le loudness du master
// n'est pas retouché d'un dB.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { STORE } from '../../store.mjs';

const a = process.argv.slice(2);
const opt = (n, d) => { const i = a.indexOf(n); return i < 0 ? d : a[i + 1]; };
const planPath = a[0];
if (!planPath || planPath.startsWith('--')) {
  console.error('usage: burn.mjs <plan.json> [--capture] [--dry] [--scale N] [--t s] [--out f.mp4]');
  process.exit(1);
}
const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
const BASE = path.dirname(path.resolve(planPath));
// ⚠️ fileURLToPath, PAS `new URL(...).pathname` : le repo vit dans « Application Support »
// et l'espace ressort en %20 → MODULE_NOT_FOUND sur capture.mjs (vécu, 31/08).
const HERE = path.dirname(fileURLToPath(import.meta.url));
// ── OÙ UN CHEMIN DE PLAN EST RÉSOLU (01/09, en versionnant les plans) ──────────────
// Le plan de burn vit désormais dans le REPO (`facecam/plans/`), pas dans le store : c'est
// une décision, et elle se relit. Trois formes, dans cet ordre de priorité :
//   · `store:<…>`  → résolu contre `STORE` (store.mjs). C'est la SEULE façon de désigner un
//     fichier du store sans écrire `path.join(STORE, …)` à la main — la dispersion de sept
//     littéraux est exactement ce qui a fait dériver le store, et `arbo.mjs` la dénonce.
//     Corollaire pratique : le plan reste juste sur une machine où `MONTAGE_STORE` diffère.
//   · chemin relatif → résolu contre le DOSSIER DU PLAN, donc contre le repo. Sert à tout ce
//     qui voyage avec le code : le `.ass` livré, les polices, `vlog.plan.json`.
//   · chemin absolu → pris tel quel. Toléré, mais il fige la machine : à éviter dans un plan
//     versionné, puisqu'il est précisément ce qu'on vient de retirer.
const abs = (p) => {
  if (typeof p === 'string' && p.startsWith('store:')) return path.join(STORE, p.slice(6));
  return path.isAbsolute(p) ? p : path.join(BASE, p);
};

const dry = a.includes('--dry');
const doCapture = a.includes('--capture');
const SCALE = Number(opt('--scale', 1));
const limit = opt('--t', null);
const FRAMES = abs(plan.frames ?? 'frames');
const videoIn = abs(plan.video_in);
const videoOut = abs(opt('--out', plan.video_out));
const FPS = String(plan.fps ?? '30/1');
const fpsNum = FPS.includes('/') ? (() => { const [n, d] = FPS.split('/').map(Number); return n / d; })() : Number(FPS);

// ------------------------------------------------------------------ capture
if (doCapture) {
  for (const o of plan.overlays) {
    const dir = path.join(FRAMES, o.id);
    fs.rmSync(dir, { recursive: true, force: true });
    const args = [path.join(HERE, 'capture.mjs'), abs(o.html), String(o.t0), String(o.t1),
      '--dir', dir, '--fps', FPS, '--clip', o.clip.join(',')];
    if (SCALE > 1) args.push('--dsf', String(SCALE));
    const r = spawnSync(process.execPath, args, { stdio: ['ignore', 'ignore', 'inherit'] });
    const n = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.png')).length : 0;
    console.log(`  ${o.id.padEnd(16)} ${String(n).padStart(4)} PNG  (exit ${r.status})`);
  }
}

// ------------- ⭐ LA SOURCE D'ABORD (01/09). Le burn-plan 1080 du VLOG #02 pointait sur un master
// que la rétention avait mis à la CORBEILLE au rendu du 4K : sans ce garde, on le découvrait en
// plein re-burn, après la capture des PNG, sur une erreur ffmpeg qui ne dit pas la cause. La
// rétention est la cause DOMINANTE d'une source absente ici, et elle est réversible — donc le
// garde ne se contente pas de refuser : il va regarder dans la corbeille et donne le geste exact.
if (!fs.existsSync(videoIn)) {
  const t = path.join(process.env.HOME, '.Trash', path.basename(videoIn));
  console.error(`✗ source ABSENTE — burn ANNULÉ\n    ${videoIn}`);
  if (fs.existsSync(t)) {
    const go = (fs.statSync(t).size / 1e9).toFixed(2);
    console.error(`\n  Elle est à la CORBEILLE (${go} Go) — la rétention N/N-1 l'y a mise. Pour la reprendre :\n`
      + `    mv ${JSON.stringify(t)} ${JSON.stringify(videoIn)}\n\n`
      + `  ⚠️ Elle y repartira au prochain rendu de la même lignée. Si ce master est FIGÉ, écrire\n`
      + `     "_source_a_la_corbeille" dans le plan plutôt que de la restaurer à chaque fois.`);
  } else {
    console.error(`\n  Absente aussi de la corbeille : il faut la RE-RENDRE (revlog.mjs) avant de re-brûler.`);
  }
  process.exit(1);
}

// Même garde pour l'ASS et le dossier de polices (01/09, découvert en DÉPLAÇANT le .ass dans le
// repo) : `ass=` sur un fichier absent ne fait pas échouer ffmpeg bruyamment, il rend un film SANS
// sous-titres — un défaut qui ne se voit qu'au visionnage, après l'encodage. Et un `fontsdir` vide
// fait retomber libass sur une police système : le film sort, avec la mauvaise typo.
if (plan.subs && !fs.existsSync(abs(plan.subs))) {
  console.error(`✗ sous-titres ABSENTS — burn ANNULÉ\n    ${abs(plan.subs)}\n`
    + `\n  Sans ce garde, ffmpeg aurait rendu le film ENTIER, simplement sans sous-titres.`
    + `\n  Les .ass livrés vivent dans le REPO : facecam/assets/sous-titres/`);
  process.exit(1);
}
if (plan.subs && !fs.existsSync(abs(plan.fontsdir ?? 'fonts'))) {
  console.error(`✗ fontsdir ABSENT — burn ANNULÉ\n    ${abs(plan.fontsdir ?? 'fonts')}\n`
    + `\n  libass serait retombé sur une police système : le film sort, avec la MAUVAISE typo.`);
  process.exit(1);
}

// ── ⛔ LE CONTENU DE L'ASS SE CONTRÔLE AVANT D'ENCODER (01/09) ──────────────────────
// Les deux gardes ci-dessus vérifient que les FICHIERS existent. Ça ne dit rien de ce qu'ils
// contiennent — et c'est par là que le défaut est passé DEUX FOIS : le monteur a signalé « le sous-titre
// est déjà là et consommé alors que j'ai pas commencé à parler » sur un master dont toute la chaîne
// était verte. Chaque contrôle avait raison sur SA dimension ; personne ne regardait la façon de
// CONSOMMER les timecodes (`\k` vs `\kf`) ni l'ANCRAGE de la transcription sur la voix.
//
// La correction durable n'est pas une ligne de doctrine de plus : *une règle qui dépend de ma
// discipline plutôt que d'un outil finira violée*, et *une règle mécanisée mais déclenchée à la
// main n'est mécanisée qu'à moitié — chercher qui appuie sur le bouton.* Le bouton, c'est ce
// fichier : le SEUL passage obligé entre un ASS et un master livrable. D'où l'appel ci-dessous,
// automatique, bloquant, et qui refuse aussi de tourner à l'aveugle.
//
// `subs_controle` est OBLIGATOIRE dès qu'un plan porte des sous-titres — pas facultatif : sans lui
// les dimensions VOIX, RENDU et TEXTE ne seraient pas mesurables, et une dimension aveugle n'est pas une
// dimension verte. `MONTAGE_NO_SUBS_GATE=1` désarme, délibérément et en le disant.
if (plan.subs && !process.env.MONTAGE_NO_SUBS_GATE) {
  const sc = plan.subs_controle;
  // ⭐ `lexique` est OBLIGATOIRE depuis le 20/09, au même titre que `plan` et `work` : la
  // dimension TEXTE ne peut pas relire les graphies sans lui, et les deux fautes d'accord
  // brûlées dans le master de l'EP3 sont passées PRÉCISÉMENT par ce trou — les 4 autres
  // dimensions étaient vertes. Le laisser facultatif, c'est désarmer le garde par omission.
  if (!sc || !sc.plan || !sc.work || !sc.lexique) {
    console.error(`✗ contrôle des sous-titres NON DÉCLARÉ — burn ANNULÉ\n`
      + `\n  Ce plan porte des sous-titres mais son bloc "subs_controle" est absent ou incomplet`
      + `\n  (il lui faut "plan", "work" ET "lexique"). Sans eux, VOIX (le sous-titre ne part pas`
      + `\n  avant la parole, mesuré au signal), RENDU (part d'accent à la 1re image) et TEXTE`
      + `\n  (graphie fausse survivante, accord après un nombre) ne seraient pas mesurées.`
      + `\n  Une dimension aveugle n'est pas une dimension verte. Ajouter dans le plan :\n`
      + `\n    "subs_controle": {`
      + `\n      "plan": "<…>/vlog/vlog.plan.json",   // les bornes des blocs facecam`
      + `\n      "work": "<…>/vlog/work/subs02",      // les .wav de bloc, pour vad.py`
      + `\n      "avance_max": 0.15,`
      + `\n      "avance_toleree": { "F03": 1.02 },   // réserves NOMMÉES et chiffrées`
      + `\n      "accent_tolere": ["4:07.19"],`
      + `\n      "lexique": "<…>/facecam/assets/lexiques/lexique_chine_03.json",  // dimension TEXTE`
      + `\n      "texte_tolere": ["Skyline"]         // réserves NOMMÉES, jamais un seuil baissé`
      + `\n    }\n`
      + `\n  Pour passer outre en connaissance de cause : MONTAGE_NO_SUBS_GATE=1`);
    process.exit(1);
  }
  const argsC = [path.join(HERE, 'subs-controle.mjs'), abs(plan.subs),
    '--plan', abs(sc.plan), '--work', abs(sc.work),
    '--fontsdir', abs(plan.fontsdir ?? 'fonts'),
    '--avance-max', String(sc.avance_max ?? 0.15)];
  const tol = Object.entries(sc.avance_toleree ?? {}).map(([k, v]) => `${k}:${v}`).join(',');
  if (tol) argsC.push('--tolere-avance', tol);
  if ((sc.accent_tolere ?? []).length) argsC.push('--tolere-accent', sc.accent_tolere.join(','));
  argsC.push('--lexique', abs(sc.lexique));
  if ((sc.texte_tolere ?? []).length) argsC.push('--tolere-texte', sc.texte_tolere.join(','));
  try {
    execFileSync(process.execPath, argsC, { stdio: 'inherit' });
  } catch {
    console.error(`\n✗ contrôle des sous-titres EN DÉFAUT — burn ANNULÉ.`
      + `\n  Corriger l'ASS (subs-recale.mjs / subs-blocs.mjs), ou DÉCLARER la réserve dans`
      + `\n  "subs_controle" du plan avec sa valeur mesurée — jamais en baissant le seuil.`);
    process.exit(1);
  }
}


// ------------- contrôle AVANT d'encoder : une séquence incomplète se voit ICI,
// pas au visionnage (un PNG manquant = un trou d'une image dans l'animation).
const args = ['-v', 'warning', '-stats', '-i', videoIn];
for (const o of plan.overlays) {
  const dir = path.join(FRAMES, o.id);
  const n = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.png')).length : 0;
  const want = Math.round((o.t1 - o.t0) * fpsNum);
  if (n !== want) { console.error(`✗ ${o.id} : ${n} PNG au lieu de ${want} — capture incomplète, burn ANNULÉ.`); process.exit(1); }
  args.push('-itsoffset', String(o.t0), '-framerate', FPS, '-i', path.join(dir, '%05d.png'));
}

let fc = '', prev = '0:v';
plan.overlays.forEach((o, i) => {
  const [x, y] = o.clip.map((v) => v * SCALE);
  const last = i === plan.overlays.length - 1;
  const lbl = last ? (plan.subs ? 'vov' : 'vout') : `v${i}`;
  fc += `[${prev}][${i + 1}:v]overlay=${x}:${y}:eof_action=pass:repeatlast=0:` +
        `enable='between(t,${o.t0},${o.t1})'[${lbl}];`;
  prev = lbl;
});
if (plan.subs) fc += `[vov]ass=${abs(plan.subs)}:fontsdir=${abs(plan.fontsdir ?? 'fonts')}[vout]`;
else fc = fc.replace(/;$/, '');

const out = limit ? videoOut.replace(/\.mp4$/, `_TEST${limit}s.mp4`) : videoOut;

// ── ⛔ DEUX FFMPEG SUR LE MÊME FICHIER DE SORTIE = UN MASTER CORROMPU (01/09) ────────
// Vécu le jour même : un burn lancé en arrière-plan a survécu à la mort de son shell, un
// second a été lancé sur le MÊME `--out`, et le fichier est sorti avec `exit=0`, le bon
// compte d'images (23 507) et la bonne durée (783,566667 s) — mais **11 415 erreurs de
// décodage**. Aucun contrôle de forme ne voyait le problème : il a fallu un décodage
// intégral. *Un fichier de la bonne taille avec le bon nombre d'images peut être illisible.*
// Le symptôme visible en amont était la VITESSE : 0,27× au lieu de 0,63×, parce que deux
// encodeurs se partageaient la machine — une lenteur inexpliquée est une information.
// Ce garde regarde donc qui écrit DÉJÀ là où on s'apprête à écrire.
{
  // ⚠️ `ps -Ao command=` ET NON `pgrep -fl` : sur macOS, `pgrep -l` n'imprime que le NOM du
  // processus (« ffmpeg »), jamais sa ligne de commande — `-f` sert à MATCHER, pas à AFFICHER.
  // Le garde se déclarait donc vert en toutes circonstances. Trouvé en le testant sur le cas
  // qu'il doit attraper, un burn réellement en cours : *un garde neuf qui sort négatif se
  // suspecte avant de se croire.*
  // ⚠️ DEUX PIÈGES DE PLUS, trouvés en testant le garde sur un burn réellement en cours :
  //   · `ps` TRONQUE la ligne de commande à la largeur du terminal — or `--out` est le DERNIER
  //     argument de ffmpeg, donc le seul qui compte disparaissait. `-ww` lève la troncature.
  //   · `ps` réencode les accents (« Vidéos » ressort « VidM-CM-) »), donc comparer le CHEMIN
  //     complet ne matche jamais. On compare le BASENAME, qui n'en porte pas.
  // *Un garde qui interroge le système se teste contre la sortie réelle de la commande, pas
  // contre l'idée qu'on s'en fait.*
  const enCours = spawnSync('ps', ['-Awwo', 'pid=,command='], { encoding: 'utf8' }).stdout ?? '';
  const nomOut = path.basename(out);
  const conflit = enCours.split('\n')
    // la ligne de `ps` est « <pid> <commande> » : le binaire est le 2ᵉ champ, et il peut être
    // un chemin absolu. Une regex ancrée sur `^ffmpeg` ne matchait donc rien — troisième
    // essai de ce garde, et le premier qui mord.
    .filter((l) => /^\s*\d+\s+\S*ffmpeg\s/.test(l) && l.includes(nomOut));
  if (conflit.length) {
    console.error(`✗ un ffmpeg écrit DÉJÀ ce fichier — burn ANNULÉ\n    ${out}\n`);
    for (const c of conflit) console.error(`    ${c.slice(0, 120)}…`);
    console.error(`\n  Deux encodeurs sur la même sortie produisent un fichier qui a l'air bon`
      + `\n  (exit 0, bon compte d'images) et qui est ILLISIBLE. Tuer l'autre, ou changer --out.`);
    process.exit(1);
  }
}

args.push('-filter_complex', fc, '-map', '[vout]', '-map', '0:a',
  '-c:a', 'copy', '-c:v', 'libx264', '-crf', String(plan.crf ?? 18), '-preset', plan.preset ?? 'medium',
  '-pix_fmt', 'yuv420p', '-movflags', '+faststart');
if (limit) args.push('-t', limit);
args.push('-y', out);

if (dry) { console.log('ffmpeg ' + args.map((s) => (/[ '"]/.test(s) ? `'${s}'` : s)).join(' ')); process.exit(0); }
console.log(`burn → ${out}${limit ? `  (${limit} s de test)` : ''}\n  source ${videoIn}\n  frames ${FRAMES} · ${plan.overlays.length} overlays · fps ${FPS}${plan.subs ? ' · + sous-titres' : ''}`);
const t = Date.now();
const r = spawnSync('ffmpeg', args, { stdio: ['ignore', 'inherit', 'inherit'] });
console.log(`\nexit=${r.status} en ${((Date.now() - t) / 1000).toFixed(1)} s`);
process.exit(r.status ?? 1);
