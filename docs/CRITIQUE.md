# CRITIQUE — mode « faire gagner un cran de qualité » du skill videocreator

## Sommaire

- Vocabulaire & doctrine (fixés par le monteur — non négociables)
- Ce que tu tiens à jour
- PATH (obligatoire — sinon whisper/ffmpeg introuvables)
- La boucle, un tour
- Garde-fous (non négociables)

> Ce fichier est **un mode du skill videocreator**, PAS un agent autonome. Quand le monteur dit
> « critique ce montage / améliore la vidéo / pourquoi ce rendu est moyen », Claude suit
> cette procédure **inline** (il n'y a rien à déléguer, rien qui tourne tout seul).
> Le skill charge ce fichier ; la doctrine de rendu reste dans `STYLE.md` / `INDEX.md`.

En mode critique, ton rôle n'est pas de monter : c'est de **juger un rendu et de faire
gagner un cran de qualité à chaque tour**, sans casser ce qui marche. Tout est **100% local**
(le Mac voyage en Chine, derrière le Great Firewall — aucun rush, transcript ou rendu ne
quitte le Mac ; aucun appel réseau).

## Vocabulaire & doctrine (fixés par le monteur — non négociables)

- Ce que le monteur filme (ville, rue, gens, sans parler) = **plans d'ambiance** / B-roll. JAMAIS
  « timelapse » (ça = de l'accéléré). Le montage qui les enchaîne = **montage d'ambiance**.
- **Respecter la substance d'un plan** : un plan d'ambiance se tient ENTIER, dans l'ordre. On ne
  hache pas un plan en 10, on ne saute pas d'un plan à l'autre pour y revenir (défaut rejeté du mode
  rythme). Tenir long > couper. Ne rogner que le mort CERTAIN (noir franc, image figée). Un cut de
  milieu se décide à l'œil (EDL), pas par une heuristique agressive. « sans cut excessif ».
- **⭐ Durée ↔ mouvement de caméra** : plan FIXE (point figé, micro-mouvement) → tolère une coupe courte
  (2-4 s) ; plan MOUVEMENT (pano, travelling, marche) → doit être TENU (couper vite = tournis). le monteur filme
  surtout en mouvement → tenir ses plans est juste. NE PAS lui proposer un rythme rapide façon guide.
- **Directions Artistiques (DA)** : `DA.txt` à la racine sélectionne une DA (look + rythme). `look studio` =
  filmique chaud faible contraste + plans-mouvement tenus (fixes resserrés). `brut` = neutre. Registre
  extensible dans `monte.mjs` (objet `DA`). `grade.txt` = repli manuel si pas de DA. Cf. `STYLE.md`.
  Le grade `look studio` a **deux batches auto** (par luminance du plan, seuil YAVG 90) : NUIT (noirs profonds,
  expo basse, hautes clampées à 0,82) et JOUR (doux, sat rehaussée). ⭐ **MAJ 20/07** : le batch JOUR a une
  **ÉPAULE hautes lumières** (genou `0,9→0,83 · 1→0,93`, dosage « légère » validé le monteur) — avant il POUSSAIT les
  blancs (`1→0,97`) et CRAMAIT ciel/surfaces lavées en plein jour (« trop de lumière blanche », diffus). Cf. STYLE.md.
- **Deux niveaux de rendu** (`qualite.txt` = brouillon | final) : itérer/cadrer en brouillon (videotoolbox
  rapide, défaut), puis final (libx264 CRF16 slow = vraie qualité) pour publier. La « perte de qualité »
  ressentie = videotoolbox mou → le final la corrige. Itérer en brouillon, ne passer final qu'une fois validé.
- **Durée ↔ mouvement, exécuté** : `motionScore()` classe chaque plan (fixe <1,5 / mouvement ≥1,5) ; en DA
  `holdMovement`, le mouvement est tenu entier, le fixe cappé 5s. le monteur filme en mouvement → rien cappé.
  Si tu touches au grade ou au seuil : une seule variante par tour, compare avant/après à l'œil.
- **⭐ Acquis 20/07 (retour le monteur sur le montage jour 20) — deux ratés à ne plus laisser passer :**
  - **Déclenchement ACCIDENTEL** : un rush **< 1,0 s** (`MIN_SHOT_PERCEPTIBLE` dans `monte.mjs`) = erreur de
    record imperceptible (objectif obstrué, paroi, départ/arrêt maladroit). Le moteur l'écarte AUTO en mode auto
    (sauté si `plan.txt` curé) ; `curate.mjs` le nomme (⛔ REJET). Ex. jour 20 : R01 0,30 s / R02 0,37 s passaient.
    Si tu vois un plan quasi-imperceptible / sans sujet en tête de montage → vérifier qu'il n'a pas échappé au filtre.
  - **Surplus de lumière blanche (cramé jour)** : ciel/surfaces « très blanchis par la lumière du jour ». `curate.mjs`
    le MESURE désormais (charge « clair **+ PÂLE** » = ciel/surface lavée ≠ néon coloré → recommande `hi`/`hi2`).
    Le blanc DIFFUS est dompté en amont par l'épaule du grade JOUR ; le flag `hi`/`hi2` reste pour une surface
    lavée FRANCHE. Ne te fie plus au seul œil pour ça — lis la colonne « cramé-pâle » de `curate.mjs`.
- Modes : A (parlé/karaoké) · B (beat, musique) · RYTHME (paysage sans musique) · **D AMBIANCE**
  (B-roll enchaîné — le mode préféré pour la ville, `mode.txt=ambiance`) · C (intro titre).
- Rushes parlés non voulus dans un montage d'ambiance : `exclure.txt` (un nom/ligne).
- **Cut d'intro sec** : `couper.txt` (`<bout-du-nom> <seconde-de-départ>`) = le plan démarre à cette
  seconde, sans effet (« juste au début du no-speed »). Prioritaire sur `ramp.txt`. L'alternative simple au ramp.
- **Speed-ramp d'intro « retour sur terre »** : `ramp.txt` (`<bout-du-nom> <secondes-jusqu-au-sujet>`)
  accélère en DÉCÉLÉRANT le déplacement de caméra d'ouverture d'un plan (ex. haut d'un building → rue),
  au lieu d'un cut. `settle` = LE réglage à tuner à l'œil, EN MOUVEMENT (les images fixes trompent sur la
  vitesse). Pour régler : trouver dans le rush brut la seconde où la caméra arrive au sujet, la mettre
  dans ramp.txt, re-rendre, regarder, ajuster. Ne jamais juger un ramp sur une planche de stills.

## Ce que tu tiens à jour

- Moteur : `~/Library/Application Support/Montage/monte.mjs` (Node, commenté). Tu peux
  l'éditer, **mais un seul changement par tour** et **toujours un backup `.bak-AAAAMMJJ-HHMMSS`
  avant** (`cp monte.mjs "monte.mjs.bak-$(date +%Y%m%d-%H%M%S)"`).
- Sonde : `~/Library/Application Support/Montage/critique.mjs` — signaux objectifs + planches.
- **Apprentissage par référence** : `analyse-reference.mjs <video>` profile une vidéo que le monteur
  trouve bien montée (déposée dans `~/Movies/Montage/Références (inspiration)/`) → durée des plans,
  rythme, audio + planches. Tu la regardes, tu en tires des cibles, tu les écris dans `STYLE.md`.
- `STYLE.md` — **à quoi doit ressembler** un bon montage (doctrine le monteur + cibles apprises des
  références). **Lis-le avant de juger** : tu notes CONTRE ces cibles, pas contre ton goût.
- `AMELIORATION.md` — grille + journal des essais. **Lis-le en premier**, **écris-y ton tour à la
  fin** (même un essai annulé).

## PATH (obligatoire — sinon whisper/ffmpeg introuvables)

Toute commande node/ffmpeg :
`PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/sbin:/usr/sbin" node …`

## La boucle, un tour

1. **Lis** `AMELIORATION.md` (grille + journal).
2. **Sonde** le rendu ciblé : `node critique.mjs [chemin.mp4]` (défaut = dernier rendu). Ça écrit
   `critique/<stamp>/{planche.jpg,cuts.jpg,signals.json,rapport.txt}`.
3. **Regarde** `planche.jpg` (Read) et lis `signals.json`. Note contre la grille : les chiffres
   pour le mécanique (bandes noires, LUFS/peak, plan moyen, quasi-noir), **ton œil** pour ce que la
   machine ne sait pas (récit établissement→détails→clôture, diversité des angles, plans redondants,
   trop de ciel/sol mort, respiration). ⭐ Pour le **cramé jour** et les **rushes accidentels**, ne juge
   PAS qu'à l'œil : lance `node curate.mjs` et lis la section ⛔ REJET + la colonne « cramé-pâle » (flag
   `hi`/`hi2` recommandé) — c'est mesuré (acquis 20/07).
4. **Propose UN changement** ciblé sur le drapeau le plus rentable — un paramètre (`RHYTHM_SHOT`,
   seuils, un filtre `loudnorm`, un ancrage de crop) ou une petite logique. Dis ce que tu attends
   comme effet mesurable.
5. Si le monteur valide (ou si carte blanche) : backup → édite → `node --check monte.mjs` → **re-rends le
   même batch** (`node monte.mjs --render` depuis le dernier projet si possible, sinon redépose) →
   **re-sonde** → **compare les deux `signals.json`**. Garde si mieux, `git`-less revert via le `.bak`
   sinon.
6. **Consigne** dans `AMELIORATION.md` : date absolue, constat, signal, changement, avant/après, verdict.

## Garde-fous (non négociables)

- **Un seul réglage par tour.** Deux changements = on ne sait plus lequel a agi.
- **Backup avant toute édition** du moteur. Les rushes ne sont jamais supprimés.
- **Ne pas laisser s'empiler les rendus de test** : `node arbo.mjs --apply --purge` après chaque tour.
  Il garde N et N-1 dans `Vidéos finies/Tests` et met le reste à la corbeille ; `Journées/` (les masters
  `Montage JOUR JJ-MM …`, matière du final) et `Éléments/` ne sont jamais touchés. Purger aussi
  `projects/`+`critique/`. Ne plus le faire à la main : c'est ce qui avait produit 13 rendus empilés.
- **Jamais de dépendance réseau/LLM-en-ligne dans le pipeline** : le montage doit rester heuristique
  et offline (il tourne VPN coupé). Une sélection « intelligente » reste une surcouche à la demande.
- **Ne publie jamais** : l'upload YouTube est manuel (le monteur valide et clique).
- **Ne déporte pas** le montage sur le VPS (pas de GPU, 7 Go libres, il héberge la prod).
- **Nuit urbaine = sombre légitimement** : ne sur-corrige pas l'exposition, ne flague le quasi-noir
  qu'au-delà de 25 %.
- Si un `mode.txt` traîne à la racine (`rythme|beat|parle|auto`), signale-le : un `rythme` oublié
  sabote un futur vlog parlé.

Rends un compte-rendu court : note par dimension, le drapeau prioritaire, le changement proposé (ou
appliqué + avant/après). Pas de listes à rallonge.
