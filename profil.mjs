// ============================================================================
// profil.mjs — CE QUI APPARTIENT À CELUI QUI MONTE, pas au moteur.
//
//   import { PROFIL, ACCENT_CSS, ACCENT_FFMPEG, ACCENT_ASS, ACCENT_LUM } from './profil.mjs';
//   node profil.mjs            → affiche le profil actif et d'où il vient
//
// POURQUOI (10/09). La couleur d'accent vivait en dur dans 7 fichiers, sous TROIS écritures
// différentes — « #F5F5F5 » en CSS, « 0xF5F5F5 » pour ffmpeg, « &H00F5F5F5 » pour l'ASS (qui
// est en BGR, donc inversé). Changer d'identité visuelle demandait sept modifications
// cohérentes dont une conversion à la main : la première ratée sortait un sous-titre bleu.
// Ici on déclare UNE couleur, le moteur en dérive les trois écritures.
//
// MONTAGE_PROFIL=<chemin.json> choisit un autre profil. Sans rien, c'est profil/defaut.json.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = path.dirname(fileURLToPath(import.meta.url));
export const CHEMIN_PROFIL = process.env.MONTAGE_PROFIL || path.join(ICI, 'profil', 'defaut.json');

function lire() {
  try { return JSON.parse(fs.readFileSync(CHEMIN_PROFIL, 'utf8')); }
  catch (e) {
    // Un profil illisible ne doit pas casser un rendu en cours : on retombe sur des valeurs
    // neutres et on le DIT. Un repli silencieux ferait sortir un master hors charte sans un mot.
    console.error(`⚠️  profil illisible (${CHEMIN_PROFIL}) : ${e.message} — repli sur les valeurs neutres.`);
    return { operateur: 'l’opérateur', identite: { accent: '#F5F5F5', police_titre: 'Bebas Neue',
             police_texte: 'Montserrat', police_sous_titre: 'Lato Black', police_cjk: 'PingFang SC' } };
  }
}
export const PROFIL = lire();

const HEX = (PROFIL.identite?.accent || '#F5F5F5').replace('#', '').toUpperCase();
const [R, G, B] = [0, 2, 4].map((i) => parseInt(HEX.slice(i, i + 2), 16));

export const ACCENT_CSS = `#${HEX}`;                    // CSS / HTML
export const ACCENT_FFMPEG = `0x${HEX}`;                // drawtext, drawbox…
export const ACCENT_ASS = `&H00${[B, G, R].map((v) => v.toString(16).padStart(2, '0').toUpperCase()).join('')}`;
// ⚠️ ASS est en &HAABBGGRR : le bleu d'abord. C'est l'inversion qui se ratait à la main.
export const ACCENT_LUM = Math.round(0.2126 * R + 0.7152 * G + 0.0722 * B);        // Rec.709, affichage
// Rec.601 : c'est CETTE formule qu'applique cv2 en convertissant en niveaux de gris, donc la seule
// juste pour comparer l'accent à une image grise. Le profil peut imposer sa valeur : celle en
// service (163) précède la dérivation (166) et changer un seuil en passant ne se fait pas.
export const ACCENT_LUM_GRIS = PROFIL.identite?.luminance_accent_gris
  ?? Math.round(0.299 * R + 0.587 * G + 0.114 * B);

export const POLICE_TITRE = PROFIL.identite?.police_titre || 'Bebas Neue';
export const POLICE_TEXTE = PROFIL.identite?.police_texte || 'Montserrat';
export const POLICE_SOUS_TITRE = PROFIL.identite?.police_sous_titre || 'Lato Black';
export const POLICE_CJK = PROFIL.identite?.police_cjk || 'PingFang SC';
export const OPERATEUR = PROFIL.operateur || 'l’opérateur';

// ── LE SERREMENT DU PARLÉ, en paliers nommés ────────────────────────────────────────────────
// Deux niveaux existaient déjà, recopiés à la main d'un EDL à l'autre sans jamais porter de nom.
// Les nommer, c'est pouvoir les CHOISIR — et dire lequel a servi dans la preuve d'un rendu.
export const PALIERS = PROFIL.serrement?.paliers || {};
export const PALIER_DEFAUT = PROFIL.serrement?.defaut || 'historique';

// Rend le palier demandé, ou explique ce qui existe. On ne retombe JAMAIS en silence sur un
// autre palier : un serrement choisi et pas appliqué sortirait un master hors intention.
export function palier(nom) {
  const cle = (nom || PALIER_DEFAUT).toLowerCase().replace(/[éè]/g, 'e').replace(/\s+/g, '-');
  const p = PALIERS[cle];
  if (!p) {
    const connus = Object.keys(PALIERS).join(', ') || '(aucun — profil sans section serrement)';
    throw new Error(`palier de serrement « ${nom} » inconnu. Connus : ${connus}`);
  }
  return { nom: cle, ...p };
}

export function listePaliers() {
  return Object.entries(PALIERS).map(([nom, p]) => ({ nom, ...p, defaut: nom === PALIER_DEFAUT }));
}

// Lancé directement, ou seulement importé ? Comparer les chemins BRUTS ne suffit pas : l'URL du
// module est encodée (%20 sous « Application Support ») et /tmp est un lien vers /private/tmp.
// Les deux pièges ont rendu ce bloc MUET — le script tournait et n'imprimait rien.
const lanceDirectement = (() => {
  try {
    return fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(process.argv[1] || '');
  } catch { return false; }
})();
if (lanceDirectement) {
  console.log(`profil actif : ${CHEMIN_PROFIL}\n`);
  console.log(`  opérateur       ${OPERATEUR}`);
  console.log(`  accent          ${ACCENT_CSS}  ·  ffmpeg ${ACCENT_FFMPEG}  ·  ASS ${ACCENT_ASS}  ·  luminance ${ACCENT_LUM} (gris ${ACCENT_LUM_GRIS})`);
  console.log(`  polices         titre « ${POLICE_TITRE} » · texte « ${POLICE_TEXTE} » · sous-titre « ${POLICE_SOUS_TITRE} » · CJK « ${POLICE_CJK} »`);
  console.log(`  look par défaut ${PROFIL.montage?.look_defaut ?? '—'}  ·  épisode ${PROFIL.episode?.duree_cible_min ?? '—'} min, alternance ${PROFIL.episode?.alternance ?? '—'}`);
  const l = listePaliers();
  if (l.length) {
    console.log(`\n  SERREMENT DU PARLÉ — défaut « ${PALIER_DEFAUT} »\n`);
    console.log('    palier        lead   tail   seuil  cible  voix     gap    état');
    for (const p of l) {
      console.log(`    ${(p.nom + (p.defaut ? ' ←' : '')).padEnd(13)} `
        + `${String(p.lead).padEnd(6)} ${String(p.tail).padEnd(6)} ${String(p.silThresh).padEnd(6)} `
        + `${String(p.silTarget).padEnd(6)} ${String(p.voice).padEnd(8)} ${String(p.gap).padEnd(6)} `
        + `${p.eprouve ? 'éprouvé' : '⚠ jamais éprouvé'}`);
    }
    console.log('\n    Les clés posées dans un EDL (lead/tail/silThresh/silTarget) gagnent sur le palier.');
  }
}
