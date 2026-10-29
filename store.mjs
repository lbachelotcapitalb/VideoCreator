// ============================================================================
// store.mjs — LES CHEMINS DU STORE, en un seul endroit.
//
// POURQUOI ce fichier existe (le monteur, 31/07) : « les rendus bruts vont dans
// "Vidéos finies" et pas un dossier de rush ». Un dossier de RUSH ne contient
// que des rushes. Tout ce qui SORT du moteur — master de journée, rendu de
// test, épisode agrégé — vit sous « Vidéos finies ».
//
// Avant ce fichier, sept scripts portaient chacun leur littéral de chemin :
// changer l'organisation demandait sept modifications cohérentes, et la
// première oubliée reconstituait le désordre au rendu suivant. Le nom d'un
// dossier se change ICI, nulle part ailleurs.
//
//   Vidéos finies/                      ← TOUT ce que le moteur produit
//     VLOG Chine 01 ….mp4               · les ÉPISODES (le livrable qu'on regarde)
//     Journées/                         · les masters de journée, matière du final
//     Tests/                            · les rendus datés d'itération (rétention N/N-1)
//     Éléments/                         · les pièces réutilisables : générique de fin, cartons…
//                                         (produites une fois, greffées ensuite — jamais purgées)
//   Landscape Rush/Déposer les rushes ici/   ← RUSHES seulement
//   Facecam Rush/Déposer les rushes ici/     ← RUSHES seulement
//
// RÉTENTION : elle est MÉCANISÉE dans `arbo.mjs --purge` (N et N-1 dans
// Tests/, N et N-1 des épisodes ; `Journées/` n'est JAMAIS purgé). Ne pas la
// refaire à la main : une règle qui dépend d'un réflexe humain finit toujours
// par 13 rendus empilés — c'est exactement ce qui s'est passé le 31/07.
// ============================================================================
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// ⭐ LA RÉTENTION EST UN RÉFLEXE DU MOTEUR, PAS DE L'OPÉRATEUR (le monteur, 02/08 : « ait le réflexe purge »).
// Elle était déjà mécanisée dans `arbo.mjs --purge`, mais son DÉCLENCHEMENT dépendait encore de moi —
// et le 02/08 il a fallu que le monteur la demande. C'est exactement le motif du 31/07 (13 rendus empilés)
// qui revient d'un cran plus haut : *une règle mécanisée mais déclenchée à la main n'est mécanisée
// qu'à moitié.* Chaque script qui REND appelle donc ceci en dernier geste.
// On passe par un process fils : `arbo.mjs` est un script prod, l'importer exécuterait son top-level.
// Rien n'est supprimé — tout part à la CORBEILLE, réversible. `MONTAGE_NO_PURGE=1` désarme.
const MOTEUR = path.dirname(fileURLToPath(import.meta.url));
export function purgeApresRendu() {
  if (process.env.MONTAGE_NO_PURGE) return;
  try {
    const out = execFileSync(process.execPath, [path.join(MOTEUR, 'arbo.mjs'), '--apply', '--purge'],
      { encoding: 'utf8', maxBuffer: 1 << 26 });
    const jetes = out.split('\n').filter((l) => l.includes('→ corbeille'));
    // ⚠ on écrit une ligne MÊME quand rien n'est dû : un garde-fou silencieux est indiscernable
    // d'un garde-fou débranché (cf. « exit 0 n'est pas une preuve »).
    console.log(jetes.length
      ? `\n· rétention N/N-1 (auto) — ${jetes.length} fichier(s) à la corbeille :`
        + jetes.map((l) => `\n  ${l.trim()}`).join('')
      : `\n· rétention N/N-1 (auto) — rien à jeter`);
  } catch (e) { console.log(`\n  (rétention auto non appliquée : ${e.message.split('\n')[0]})`); }
}

// ── LES DEUX RACINES ────────────────────────────────────────────────────────
// MOTEUR = ce dépôt (code, doctrine, modèles). STORE = la matière (rushs, rendus, réglages).
// Les deux se déplacent : une machine neuve, un disque externe pour les rushs, un clone de test.
// D'où deux variables d'environnement, et un repli sur l'emplacement historique — de sorte
// qu'une installation qui ne déclare rien continue de marcher exactement comme avant.
export const MOTEUR_DIR = process.env.MONTAGE_HOME || MOTEUR;

export const STORE = process.env.MONTAGE_STORE
  || path.join(process.env.HOME, 'Movies', 'Montage');

// Les modèles de transcription : gros fichiers, hors dépôt (cf. .gitignore), donc leur
// emplacement se déclare. Ils vivaient en dur dans cinq scripts facecam.
export const MODELS = process.env.MONTAGE_MODELS || path.join(MOTEUR_DIR, 'models');
export const MODEL_SMALL = path.join(MODELS, 'ggml-small.bin');
export const MODEL_BIG = path.join(MODELS, 'ggml-large-v3.bin');

export const INBOX_NAME = 'Déposer les rushes ici';   // même nom dans CHAQUE source

export const LANDSCAPE = path.join(STORE, 'Landscape Rush');
export const FACECAM = path.join(STORE, 'Facecam Rush');
export const INBOX = path.join(LANDSCAPE, INBOX_NAME);          // rushes paysage
export const INBOX_FACECAM = path.join(FACECAM, INBOX_NAME);    // rushes facecam

export const FINAL = path.join(STORE, 'Vidéos finies');
export const JOURS = path.join(FINAL, 'Journées');
export const TESTS = path.join(FINAL, 'Tests');
export const ELEMENTS = path.join(FINAL, 'Éléments');   // pièces réutilisables (générique, cartons…)

export const MUSIC = path.join(STORE, 'Musiques');
export const REGLAGES = path.join(STORE, 'Réglages');

// Les trois familles de fichiers que le moteur produit, reconnues au NOM.
// (le même jeu de motifs sert à arbo.mjs pour ranger et purger)
export const RE_JOUR = /^Montage JOUR /i;                 // master de journée
export const RE_TEST = /^Montage \d{4}-\d{2}-\d{2}/i;     // rendu de test daté
export const RE_EPISODE = /^VLOG .+\.(mp4|mov|m4v)$/i;    // épisode agrégé
// ⚠️ l'ESPACE après VLOG distingue l'épisode du master facecam `VLOG_…_v12.mp4`
// (underscore), qui reste une SOURCE dans Facecam Rush.
