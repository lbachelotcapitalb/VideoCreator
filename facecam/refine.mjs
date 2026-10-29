#!/usr/bin/env node
// facecam/refine.mjs — affine chaque span d'un EDL sur le VRAI PARLÉ (pas le dB).
// Principe : segmenter en BURSTS de voix à un seuil « voix » (-24dB) où la respiration
// (plus basse) ne passe PAS, puis transcrire chaque burst pour le CLASSER :
//   - respiration / bruit de bouche  -> pas un burst (sous le seuil) OU burst vide
//   - hallucination whisper (Amara, « sous-titres », « merci d'avoir regardé ») -> DROP
//   - filler pur (« euh », « voilà », « donc voilà », « ce genre de chose ») -> DROP
// On coupe les bursts de tête/fin non-substantiels, on retire les fillers isolés au milieu,
// et on rogne un filler de fin resté COLLÉ dans le dernier burst (via mots, si micro-silence).
// Sortie : <edl>.refined.json (a/b resserrés sur la voix + cuts[] + refined:true), exécuté par render.mjs.
// Usage: node facecam/refine.mjs <edl.json> [--serrement <palier>] [--voice -24dB] [--gap 0.14]
import fs from 'fs';
import { execSync } from 'child_process';
import { MODEL_BIG as MODELE_BIG } from '../store.mjs';   // chemins du moteur et du store : un seul endroit
import { palier, PALIER_DEFAUT } from '../profil.mjs';   // les paliers de serrement
import { MODEL, listClips, detectSilences, probeDur } from './lib.mjs';

const edlPath = process.argv[2];
if (!edlPath) { console.error('usage: node facecam/refine.mjs <edl.json>'); process.exit(1); }
const gf = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
// Le serrement se choisit une fois, et vaut pour les DEUX étages : ici (où tombent les bornes)
// et au rendu (respiration gardée + compression des silences internes). Les avoir séparés faisait
// qu'un EDL « serré » au rendu gardait des bornes réglées « normal », sans que rien ne le dise.
// --voice et --gap restent prioritaires : le palier ne prive de rien.
const PAL = palier(gf('--serrement', null) ?? PALIER_DEFAUT);
const VOICE = gf('--voice', PAL.voice);   // seuil « voix » : la respiration passe sous ce niveau
const VGAP = parseFloat(gf('--gap', String(PAL.gap)));
if (!PAL.eprouve) console.log(`⚠️  palier « ${PAL.nom} » JAMAIS éprouvé — le garde de la parole tranchera.`);
console.log(`serrement : ${PAL.nom}  ·  voix ${VOICE}  ·  écart ${VGAP}s`);
const MINB = 0.10;                       // burst plus court = bruit
const LEADW = 0.30, TAILW = 1.10;        // fenêtre de contenu autour de [a,b] (TAILW large = rattrape une fin de phrase)

const edl = JSON.parse(fs.readFileSync(edlPath, 'utf8'));
const clips = Object.fromEntries(listClips(edl.rushDir).map(c => [c.id, c.file]));
const WORK = `${edl.rushDir}/.facecam_work/refine`; fs.mkdirSync(WORK, { recursive: true });

// --- classification texte d'un burst ---
const HALLUC = /amara|sous-titr|merci d('|\s)?avoir|abonnez|remerci|thanks for watching|sous-titrage|❤/i;
const FILLER = new Set(['euh', 'euhh', 'heu', 'heuu', 'hein', 'bah', 'ben', 'voila', 'voilà', 'quoi',
  'donc', 'enfin', 'disons', 'mmh', 'hum', 'hm', 'mmm', 'ba', 'bon', 'et', 'ok', 'ouais']);
const FILLER_RE = [/^ce genre de choses?$/, /^des choses comme [çc]a$/, /^et voil[àa]$/, /^donc voil[àa]$/,
  /^voil[àa] donc$/, /^enfin voil[àa]$/, /^donc euh+$/, /^voil[àa]$/, /^tu vois$/, /^et tout [çc]a$/];
const norm = t => t.toLowerCase().replace(/[.,!?…"'’«»\-]/g, ' ').replace(/\s+/g, ' ').trim();
function isDropText(text) {
  const t = norm(text);
  if (!t) return true;
  if (HALLUC.test(text)) return true;
  const toks = t.split(' ').filter(Boolean);
  if (!toks.length) return true;
  if (toks.every(w => FILLER.has(w))) return true;          // que du filler
  if (FILLER_RE.some(re => re.test(t))) return true;         // formule filler
  if (toks.length === 1 && toks[0].length <= 2) return true; // mono-syllabe parasite
  return false;
}
const isFillerTok = w => { const t = norm(w); return !t || FILLER.has(t) || /^[.,!?…]+$/.test(w); };
// marqueurs d'AMORCE à couper en tête (le « euh » que whisper écrit souvent « et/eh », + connecteurs mous)
const LEAD_MARK = new Set(['euh', 'euhh', 'heu', 'heuu', 'eh', 'et', 'hein', 'ah', 'bah', 'ben', 'ba', 'bon',
  'mmh', 'hum', 'donc', 'alors', 'voila', 'voilà', 'enfin', 'mais', 'ok', 'et que', 'et donc', 'et puis']);

// profil RMS (dB) par pas de `step`s sur [a,b] du fichier — pour trouver un CREUX d'énergie (frontière propre)
function rmsProfile(file, a, b, step = 0.02) {
  const out = execSync(
    `ffmpeg -hide_banner -nostats -ss ${a.toFixed(3)} -to ${b.toFixed(3)} -i "${file}" ` +
    `-af "astats=metadata=1:reset=${step}:length=${step},ametadata=print:key=lavfi.astats.Overall.RMS_level" -f null - 2>&1`,
    { maxBuffer: 1 << 27 }).toString();
  const vals = [];
  for (const m of out.matchAll(/RMS_level=(-?[\d.]+|-inf)/g)) vals.push(m[1] === '-inf' ? -90 : parseFloat(m[1]));
  return vals.map((db, i) => ({ t: a + i * step, db }));
}
// --- VAD PAR LA HAUTEUR (aubiopitch) : la respiration/le bruit de bouche sont NON-VOISÉS (pas de
// fondamentale F0), la parole est VOISÉE. On rogne le souffle de tête/queue là où il y a de l'énergie
// mais AUCUNE F0 dans la bande voix — indépendamment du dB (le souffle collé passe le seuil dB).
// ⚠️ Piège : une consonne INITIALE non-voisée (« s » de « Si », « Ce ») n'a pas non plus de F0 →
// rogner à l'aveugle tronquerait le mot. Garde-fous : (1) marge de recul CONS avant l'onset voisé
// pour garder l'attaque ; (2) garde-fou anti-troncature en aval (re-transcription large-v3, le 1er/
// dernier mot de contenu doit être INCHANGÉ, sinon on annule le rognage). La F0 hors bande (fricatives
// → pitch fantôme > 1 kHz) n'est PAS comptée comme voix (bande stricte VMIN..VMAX).
const VMIN = 70, VMAX = 400, VSUS = 3;   // bande voix (Hz) + nb de frames consécutives = voisé stable
function pitchFrames(file, a, b) {        // -> [{t (absolu), f}] via aubiopitch yinfft
  const wav = `${WORK}/_pitch.wav`;
  execSync(`ffmpeg -y -v error -ss ${a.toFixed(3)} -to ${b.toFixed(3)} -i "${file}" -ac 1 -ar 44100 "${wav}"`);
  let out = ''; try { out = execSync(`aubiopitch -i "${wav}" -p yinfft -u Hz -l 0.5 2>/dev/null`, { maxBuffer: 1 << 26 }).toString(); } catch { return []; }
  const fr = [];
  for (const line of out.trim().split('\n')) { const [t, f] = line.trim().split(/\s+/).map(Number); if (!isNaN(t)) fr.push({ t: a + t, f: f || 0 }); }
  return fr;
}
const inBand = f => f >= VMIN && f <= VMAX;
function firstSustainedVoiced(fr) { for (let i = 0; i + VSUS <= fr.length; i++) { let ok = true; for (let j = 0; j < VSUS; j++) if (!inBand(fr[i + j].f)) { ok = false; break; } if (ok) return fr[i].t; } return null; }
function lastSustainedVoiced(fr) { for (let i = fr.length - VSUS; i >= 0; i--) { let ok = true; for (let j = 0; j < VSUS; j++) if (!inBand(fr[i + j].f)) { ok = false; break; } if (ok) return fr[i + VSUS - 1].t; } return null; }

// coupe une AMORCE (euh/et/donc/voilà…) en tête d'un burst : cible = 1er mot de contenu (whisper),
// puis SNAP au creux d'énergie le plus profond autour (frontière propre). N'agit QUE si un vrai creux
// existe (≥ MINDIP dB sous le plateau) → jamais de coupe en plein milieu d'une voyelle (sinon on laisse).
function trimLeadMarker(file, a, b, words, MINDIP = 2.5) {
  if (!words.length) return null;
  let k = 0;
  while (k < words.length && (isFillerTok(words[k].w) || LEAD_MARK.has(norm(words[k].w)))) k++;
  if (k === 0 || k >= words.length) return null;              // rien à couper, ou tout serait filler
  const target = a + words[k].t0;                              // début (approx) du 1er mot de contenu
  const prof = rmsProfile(file, Math.max(0, target - 0.16), target + 0.14, 0.02);
  if (prof.length < 4) return null;
  const plateau = Math.max(...prof.map(p => p.db));            // niveau de parole local
  let best = null;
  for (const p of prof) if (!best || p.db < best.db) best = p; // creux le plus profond
  if (!best || (plateau - best.db) < MINDIP) return null;      // pas de vraie frontière → on NE coupe PAS
  return best.t;                                               // snap au creux
}

// modèle large-v3 : meilleure transcription → sert au PROBE d'amorce (frontière connecteur→contenu)
const MODEL_BIG = MODELE_BIG;
const HAS_BIG = fs.existsSync(MODEL_BIG);
// connecteurs/hésitations à retirer en TÊTE (« et que c'est… », « voilà donc… », « euh… »)
const STRIP = new Set(['et', 'que', 'qu', 'euh', 'euhh', 'heu', 'heuu', 'eh', 'donc', 'alors', 'mais',
  'bah', 'ben', 'ba', 'bon', 'voila', 'voilà', 'enfin', 'hein', 'ah', 'ok', 'ouais', 'puis']);
function headWords(file, t, key, model) {
  const wav = `${WORK}/${key}.wav`;
  execSync(`ffmpeg -y -v error -ss ${t.toFixed(3)} -to ${(t + 1.3).toFixed(3)} -i "${file}" -ac 1 -ar 16000 "${wav}"`);
  execSync(`whisper-cli -m "${model}" -l fr -otxt -of "${WORK}/${key}" "${wav}" >/dev/null 2>&1`);
  let txt = ''; try { txt = fs.readFileSync(`${WORK}/${key}.txt`, 'utf8'); } catch {}
  return norm(txt).split(' ').filter(Boolean);
}
// avance le début tant que le 1er mot transcrit est un connecteur/filler (STRIP). La transcription
// se re-vérifie à chaque pas → s'arrête PILE sur le 1er mot de contenu, jamais dedans. Renvoie le
// nouveau début, ou null. Utilise large-v3 (transcription stable) si dispo, sinon small.
function probeLeadStrip(file, a, idx) {
  const model = HAS_BIG ? MODEL_BIG : MODEL;
  const step = 0.06, maxSteps = 9;   // jusqu'à ~0.54 s d'amorce
  let t = a, moved = 0;
  for (let i = 0; i < maxSteps; i++) {
    const toks = headWords(file, t, `s${idx}_pr${i}`, model);
    if (!toks.length) break;
    if (STRIP.has(toks[0])) { t += step; moved++; continue; }
    break;
  }
  return moved > 0 ? t : null;
}

function transcribeTxt(file, a, b, key, model = MODEL) {
  const wav = `${WORK}/${key}.wav`;
  execSync(`ffmpeg -y -v error -ss ${a.toFixed(3)} -to ${b.toFixed(3)} -i "${file}" -ac 1 -ar 16000 "${wav}"`);
  execSync(`whisper-cli -m "${model}" -l fr -otxt -of "${WORK}/${key}" "${wav}" >/dev/null 2>&1`);
  try { return fs.readFileSync(`${WORK}/${key}.txt`, 'utf8').replace(/\s+/g, ' ').trim(); } catch { return ''; }
}
// premier mot « de contenu » (hors ponctuation) d'un texte — sert au garde-fou anti-troncature
const firstContentWord = t => norm(t).split(' ').filter(Boolean)[0] || '';
const lastContentWord  = t => { const a = norm(t).split(' ').filter(Boolean); return a[a.length - 1] || ''; };
function transcribeWords(file, a, b, key) {
  const wav = `${WORK}/${key}.wav`;
  execSync(`ffmpeg -y -v error -ss ${a.toFixed(3)} -to ${b.toFixed(3)} -i "${file}" -ac 1 -ar 16000 "${wav}"`);
  execSync(`whisper-cli -m "${MODEL}" -l fr -ml 1 -ojf -of "${WORK}/${key}" "${wav}" >/dev/null 2>&1`);
  try {
    const j = JSON.parse(fs.readFileSync(`${WORK}/${key}.json`, 'utf8'));
    return j.transcription.filter(s => s.text.trim() && !s.text.startsWith('[')).map(s => ({ t0: s.offsets.from / 1000, t1: s.offsets.to / 1000, w: s.text }));
  } catch { return []; }
}

// rogne le SOUFFLE de TÊTE (énergie sans F0) jusqu'à l'onset voisé, en gardant CONS s d'attaque.
// Garde-fou anti-troncature : le 1er mot de contenu (large-v3) doit rester INCHANGÉ avant/après le
// rognage, sinon on ANNULE (protège les mots à consonne initiale non-voisée « Si », « Ce »…).
function pitchTrimHead(file, inA, outB, idx) {
  const HEAD_GAP = 0.12, CONS = 0.06, WIN = 0.75;
  const fr = pitchFrames(file, Math.max(0, inA - 0.05), Math.min(inA + WIN, outB - 0.3));
  const onset = firstSustainedVoiced(fr);
  if (onset == null || onset - inA < HEAD_GAP) return null;        // pas de souffle de tête notable
  const cand = onset - CONS;
  if (cand <= inA + 0.03 || !HAS_BIG) return null;                 // rien à gagner / garde-fou indispo
  const ref = firstContentWord(transcribeTxt(file, inA, inA + 1.3, `s${idx}_hg0`, MODEL_BIG));
  const aft = firstContentWord(transcribeTxt(file, cand, cand + 1.3, `s${idx}_hg1`, MODEL_BIG));
  return (ref && aft && ref === aft) ? cand : null;                // 1er mot intact -> sûr ; sinon on garde le souffle
}
// rogne le SOUFFLE de QUEUE (après le dernier mot voisé), en gardant CONS s. Même garde-fou (dernier mot).
function pitchTrimTail(file, inA, outB, idx) {
  const TAIL_GAP = 0.12, CONS = 0.08, WIN = 0.75;
  const fr = pitchFrames(file, Math.max(outB - WIN, inA + 0.3), outB + 0.05);
  const off = lastSustainedVoiced(fr);
  if (off == null || outB - off < TAIL_GAP) return null;
  const cand = off + CONS;
  if (cand >= outB - 0.03 || !HAS_BIG) return null;
  const ref = lastContentWord(transcribeTxt(file, outB - 1.3, outB, `s${idx}_tg0`, MODEL_BIG));
  const aft = lastContentWord(transcribeTxt(file, Math.max(inA, cand - 1.3), cand, `s${idx}_tg1`, MODEL_BIG));
  return (ref && aft && ref === aft) ? cand : null;
}

function refineSpan(file, a, b, idx, label) {
  const dur = probeDur(file);
  const R0 = Math.max(0, a - 1.0), Rend = Math.min(dur, b + 1.5);
  const sil = detectSilences(file, { noise: VOICE, d: VGAP, ss: R0, to: Rend });
  // bursts = complément des silences (relatif à R0)
  let bursts = []; let p = 0; const span = Rend - R0;
  for (const s of sil) { if (s.s > p + 0.02) bursts.push([p, s.s]); p = Math.max(p, s.e); }
  if (span > p + 0.02) bursts.push([p, span]);
  bursts = bursts.filter(x => x[1] - x[0] >= MINB)
    .map(x => ({ A0: R0 + x[0], A1: R0 + x[1] }))
    // ne garder que les bursts dans la fenêtre de contenu
    .filter(x => x.A1 >= a - LEADW && x.A0 <= b + TAILW);
  if (!bursts.length) return { a, b, cuts: [], refined: true, note: 'no-burst-fallback' };
  // classer (small = rapide)
  for (const [i, bu] of bursts.entries()) { bu.text = transcribeTxt(file, bu.A0, bu.A1, `s${idx}_b${i}`); bu.drop = isDropText(bu.text); bu.idx = i; }
  // BORNES tête/queue sur les flags SMALL (coupe franche du souffle/filler de tête et de fin, comme la
  // baseline). On NE re-confirme PAS tête/queue avec large-v3 : il GARBLE aussi les bursts ultra-courts
  // (mesuré : « ce genre de choses » de fin → large-v3 « sur les choses » → faux rescue qui ré-inclut un
  // filler de fin que refine est censé couper).
  let lo = 0; while (lo < bursts.length && bursts[lo].drop) lo++;
  let hi = bursts.length - 1; while (hi >= lo && bursts[hi].drop) hi--;
  if (hi < lo) return { a, b, cuts: [], refined: true, note: 'all-drop-fallback' };
  const keep = bursts.slice(lo, hi + 1);
  // RE-CONFIRMATION large-v3 des DROPs INTERNES uniquement : un mis-drop au MILIEU casse une phrase.
  // small HALLUCINE des fillers sur des bursts COURTS de vrai contenu (mesuré : « pour pouvoir la voir »
  // → small « voilà voilà » ; « autour » → small « Amara.org » → drop à tort, coupait en plein milieu).
  // large-v3, plus fiable en isolé, tranche : on n'annule le drop QUE s'il y lit du vrai contenu.
  if (HAS_BIG) for (let i = 1; i < keep.length - 1; i++) {
    const bu = keep[i]; if (!bu.drop) continue;
    const big = transcribeTxt(file, bu.A0, bu.A1, `s${idx}_b${bu.idx}_big`, MODEL_BIG);
    if (big && !isDropText(big)) { bu.drop = false; bu.text = big; bu.rescued = true; } // vrai contenu -> pas de cut
  }
  let inA = keep[0].A0, outB = keep[keep.length - 1].A1, leadNote = '', noLead = false;
  // fillers isolés au MILIEU -> cuts
  const cuts = [];
  for (let i = 1; i < keep.length - 1; i++) if (keep[i].drop) cuts.push([keep[i].A0, keep[i].A1]);
  // rogne within-burst d'un filler de FIN collé (via mots), seulement si gain net
  const last = keep[keep.length - 1];
  const words = transcribeWords(file, last.A0, last.A1, `s${idx}_lastw`);
  if (words.length) {
    let e = words.length; while (e > 0 && isFillerTok(words[e - 1].w)) e--;
    if (e > 0 && e < words.length) {
      const newEnd = last.A0 + words[e - 1].t1;
      if (outB - newEnd > 0.25) outB = newEnd;   // n'agit que si ça retire >0.25s
    }
  }
  // SOUFFLE DE QUEUE (pitch-VAD) : rogne le souffle/bruit après le dernier mot voisé (dB-indépendant).
  const tailT = pitchTrimTail(file, inA, outB, idx);
  if (tailT != null) { outB = tailT; leadNote = leadNote ? leadNote + '+tail-pitch' : 'tail-pitch'; }
  // SOUFFLE DE TÊTE (pitch-VAD) : rogne le souffle/bruit de bouche AVANT l'onset voisé, avant le probe
  // (qui, lui, retire les connecteurs VOISÉS « et/donc/voilà » que le pitch ne voit pas).
  const headT = pitchTrimHead(file, inA, outB, idx);
  if (headT != null) { inA = headT; noLead = true; leadNote = leadNote ? leadNote + '+head-pitch' : 'head-pitch'; }
  // coupe l'AMORCE collée en tête (« et que c'est… », « voilà donc… », « euh… ») par PROBE :
  // on avance le début tant que la transcription commence par un connecteur/filler (large-v3).
  // La transcription se re-vérifie à chaque pas → s'arrête PILE sur le contenu, jamais dedans.
  const probeT = probeLeadStrip(file, inA, idx);
  if (probeT != null && probeT > inA + 0.02 && probeT < outB - 0.5) { inA = probeT; leadNote = leadNote ? leadNote + '+lead-probe' : 'lead-probe'; noLead = true; }
  return { a: +inA.toFixed(3), b: +outB.toFixed(3), cuts: cuts.map(c => [+c[0].toFixed(3), +c[1].toFixed(3)]), refined: true, noLead, note: leadNote, text: keep.filter(k => !k.drop).map(k => k.text).join(' ') };
}

const out = { ...edl, spans: [] };
edl.spans.forEach((sp, i) => {
  const file = clips[sp.clip];
  const r = refineSpan(file, sp.a, sp.b, i, sp.label);
  const rec = { ...sp, a: r.a, b: r.b, cuts: r.cuts, refined: true, noLead: !!r.noLead };
  out.spans.push(rec);
  const dIn = (r.a - sp.a), dOut = (sp.b - r.b);
  console.log(`[${String(i).padStart(2)}] ${sp.clip} ${sp.label||''}  in ${sp.a}->${r.a} (${dIn>=0?'+':''}${dIn.toFixed(2)} tête) | out ${sp.b}->${r.b} (-${dOut.toFixed(2)} queue) | cuts=${r.cuts.length}${r.note?'  ['+r.note+']':''}`);
});
const rp = edlPath.replace(/\.json$/, '') + '.refined.json';
fs.writeFileSync(rp, JSON.stringify(out, null, 1));
console.log(`\n→ ${rp}`);
