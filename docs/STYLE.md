# STYLE — les techniques de montage de la stack

## Sommaire

- ⭐⭐ Étalonnage et curation — les techniques
- Directions Artistiques (DA) — presets sélectionnables
- Recadrage sujet-aware (formats mélangés → 16:9, automatique)
- Playbook opérateur — PROCÉDURE AUTONOME (lire au début d'une session montage)
- Bibliothèque de filtres — `filters.mjs` (le monteur 17/07 : « construis-toi une bibliothèque »)
- Roadmap — filtres ADAPTATIFS à développer + outils open-source à explorer (le monteur 17/07)

> **Entrée = `INDEX.md`** (carte, commandes, table des matières de ce fichier). On n'ouvre CE fichier
> qu'à la section utile.

Ce fichier porte les **techniques** de la stack. Le **goût** — votre direction artistique, vos références,
vos cibles chiffrées — est à vous : déposez-le dans une section « Doctrine » ici, ou dans votre profil
(`profil/defaut.json`). La stack ne livre volontairement aucune direction artistique imposée.

## ⭐⭐ Étalonnage et curation — les techniques

### Curation « récit intelligent » — tri du NON-PERTINENT à l'œil (doctrine le monteur, 17/07)

**Règles de sélection (ajoutées 18/07, retour le monteur — mon cahier des charges les ratait).** À appliquer avant le
tri fin :
1. **Rush où le monteur parle / se filme face caméra (selfie-commentaire)** — **PAS exclu par défaut** (MAJ 18/07 :
   c'est du contenu vlog légitime, à placer à propos). L'exclusion est un **choix EXPLICITE du monteur pour un
   montage donné** (ex. 15/07 : il les voulait dehors). Quand il le demande, écarter le **rush ENTIER** — ne
   pas repêcher sa « fenêtre décor » (piège R22/R23 le 15/07, gardés par leur queue « bâtiments »). Consigner
   l'exclusion du jour dans `Réglages/exclure.txt` (matching par nom de fichier → n'impacte que ce jour-là).
   Ne JAMAIS pré-remplir exclure.txt avec les rushes parlés d'un nouveau jour sans que le monteur l'ait demandé.
2. **La règle DÉCISIVE « plan MOUVEMENT = TENU entier » PRIME sur toute mesure de mouvement.** Un plan filmé
   en marchant/en pano se garde à sa longueur naturelle — couper court = tournis (verdict le monteur, non négociable).
   Le seuil `curate.mjs` n'est qu'un RADAR pour un pano *vraiment* trop rapide (whip) ou du mouvement *gratuit* ;
   il ne justifie JAMAIS de recouper en masse à 2-3 s ni d'écarter un plan tenable. **Métrique NORMALISÉE (MAJ
   18/07 soir)** : `curate.mjs` mesure un **ratio = mouvement temporel ÷ détail spatial Sobel ×100**, invariant
   jour/nuit → il flague `MOUVEMENT TRÈS RAPIDE` seulement au-delà de **ratio 70** (ancres JOUR : R26 20 · R16 24
   · marche R07 50 / R09 57 = TENIR ; R01/R40 ≈ 83 = whip/flou). Au-delà : **vérifier à l'œil sur `filmstrip.mjs`
   et TENIR si le mouvement révèle du neuf** ; ne recouper à une fenêtre posée que s'il n'apporte rien.
   Ne pas se fier à la médiane GLOBALE pour juger une fenêtre montée (la globale de R22 15/07 était gonflée par
   le selfie + un swing). ⚠️ La *version brute* (diff inter-image « méd 24 ») n'était PAS invariante à la lumière :
   en plein JOUR (image claire, trafic/feuillage/foule) elle gonflait à mouvement modéré → 37/40 du 16/07 en faux
   positif. C'est CORRIGÉ dans le code (ratio normalisé) ; l'ancien seuil « 24 » ne vaut plus.
3. **Non-B-roll perso** hors thème (écran de téléphone, menu resto, voiture en showroom, POV nourriture) =
   écarté d'un montage d'ambiance ville. Re-basculable si un beat vlog est explicitement voulu.
4. **Déclenchement ACCIDENTEL (MAJ 20/07, retour le monteur)** — un rush **< 1,0 s** est une erreur de record
   (départ/arrêt maladroit du DJI, objectif encore obstrué) : aucun plan lisible, **imperceptible** en montage.
   **Écarté AUTOMATIQUEMENT par le moteur** en mode auto (`monte.mjs`, `MIN_SHOT_PERCEPTIBLE = 1,0 s` ; sauté si
   un `plan.txt` curé existe — la liste du monteur fait foi). `curate.mjs` le NOMME en tête de rapport (⛔ REJET).
   Calibré 20/07 : R01 0,30 s (paroi bois) / R02 0,37 s (objectif obstrué) étaient passés faute de garde-fou ;
   le plus court plan VOULU du jour = 2,57 s → marge ×2,5. ⚠️ Ne PAS lister un rush accidentel dans un plan.txt.

Le monteur délègue à Claude le tri du raté : regarder la matière (pellicules `filmstrip.mjs`, 1 img/s, temps
gravé) et **couper ou jeter** ce qui n'apporte rien. Ses cas types (le raté « saute aux yeux ») :
- **Tilt vers le haut des buildings** en cours de plan, alors qu'on les voyait DÉJÀ en vue de rue normale :
  n'apporte rien ET **tue le dynamisme principal** de la vue normale (les gens qui marchent). → couper le tilt,
  garder la vue de rue. Règle : ne pas garder un sur-cadrage redondant qui sacrifie l'action de premier plan.
- **Va-et-vient de caméra inutiles** (balayage aller-retour sans sujet nouveau) → couper le retour.
- **Retours répétés** sur la même chose dans un même plan → n'en garder qu'un passage.
- **Répétition de plans** sur une même vidéo (deux rushes ~identiques : même angle, même sujet) → **dédupe**,
  garder le meilleur (mieux exposé / plus stable / plus d'action), écarter l'autre.
- **Horizon de travers / dutch angle INVOLONTAIRE** (verticales qui penchent, bâtiments inclinés sur tout le
  plan) = **moche** → écarter le plan (ou le morceau penché). Défaut, pas un style. Ex. R04 (15/07).
- **Gens coupés à moitié au bord du cadre** (premier plan humain tronqué au bas/aux côtés) = **frustrant à
  l'œil** → écarter. Un sujet humain de premier plan doit être entier ou clairement hors-champ, pas sectionné.
- **Caméra qu'on lève (tilt up amateur)** = geste d'amateur qui casse la vue → écarter le plan/le tilt. Ex. R06.
Principe : garder ce qui a une **valeur nouvelle** (sujet, action, angle qu'on n'a pas encore) ; couper le
redondant et le mou. La coupe se fait en **keep-ranges par rush** (garder 0–5,5 s, couper 6–9 s…), pas juste
tête/queue. Le rendu reste offline (le moteur exécute un plan gelé) ; la VISION = Claude (online).

### Hautes lumières trop intenses — identifier & dompter (couche « hi », 17/07)
Le monteur : sur certains plans, des lumières trop fortes (néons, **façades éclairées**) « bavent » et **empêchent la
netteté**. Traitement :
- **Identifier — mesuré (MAJ 20/07)** : `curate.mjs` sort une colonne **cramé-pâle** + une section ☀️ qui
  RECOMMANDE `hi`/`hi2`. Le discriminant qui manquait à `clip%`/`bloom%` (highlights.mjs, resté indicatif) est
  enfin codé : on ne compte QUE le blanc **CLAIR + PÂLE** (near-white Y≥225, saturation < 0,12) dans la bande
  HAUTE (ciel) + le voile plein cadre, sur 6 frames en **p75** (capte le cramé TRANSITOIRE — trouée de ciel,
  bout d'allée — sans qu'une frame-fluke décide). Ça sépare « surface lavée » (à dompter) de « néon coloré »
  (à garder). Calibré 20/07 : offenders francs **R11 ~26 · R08/R12 ~7 · R10/R06 ~5** ; propres < 3 →
  seuils `hi` ≥ 4,5 · `hi2` ≥ 12. ⚠️ Reste des **cas à l'œil** : un cramé PONCTUEL petit (bouts d'allée R13/R14,
  charge basse ~2) mesure sous le seuil — c'est le **grade JOUR** (épaule, ci-dessous) qui les dompte en amont.
- **Épaule du grade JOUR (MAJ 20/07, retour le monteur « trop de lumière blanche », dosage « légère »)** : la version
  d'avant POUSSAIT les blancs (`0,75→0,78 · 1→0,97`, sans genou) → en plein jour, ciel et surfaces lavées
  CRAMAIENT de façon DIFFUSE (pas qu'un plan isolé). `GRADE_LOOKSTUDIO_DAY` roule maintenant le haut par un genou
  (`0,9→0,83 · 1→0,93`) en tenant les mids (`0,72→0,72`) : le ciel bleu + les nuages reviennent, les bouts
  d'allée cramés se domptent, **sans perdre le côté aéré** (sat 1,10 / expo jour inchangées). C'est le filet
  BLANKET ; le flag `hi`/`hi2` reste pour une surface lavée FRANCHE au-delà.
- **⭐ JAUNI DOUX + LÉGER CONTRASTE (31/07, le monteur : « un peu d'effet jauni / contraste, lumière blanche
  un peu moins puissante »)** — variante **A2**, choisie sur une grille de 3 plans JOUR (une tour plein
  ciel, un extérieur matin, un intérieur chaud). Le genou descend encore (`0,9→0,81 · 1→0,90`) : c'est
  la « lumière blanche moins puissante ». Contraste `1,05 → 1,08`, gamma `1,02 → 1,01`.
  **LA LEÇON, et elle coûte cher si on l'ignore : un jaune GLOBAL tue le ciel.** La première recette
  testée retirait du bleu partout, hautes lumières comprises (`bh` négatif, courbe bleue écrasée en
  haut) → **le ciel virait au vert-jaune**, franc à l'œil sur les deux plans extérieurs. L'ambre doit
  vivre dans les **OMBRES et les MEDIUMS** (`rs 0,05 · rm 0,07 · gm 0,03 · bs −0,07 · bm −0,10`) et les
  **hautes garder leur bleu** (`bh = 0`, courbe bleue tenue à `0,9→0,765 · 1→0,885`) : le béton, la
  végétation et la nourriture se réchauffent, le ciel reste un ciel. Effet mesuré : axe rouge V **+1,5**,
  axe bleu U **−1,0**, ciel intact. ⚠️ Sur un plan majoritairement ciel l'effet est DISCRET **par
  construction** — ce n'est pas un dosage raté, c'est la zone qu'on protège.
- **Dompter** (flag `hi` / `hi2` dans `plan.txt`, ex. `R15 hi`, `R22 6.5-10.5 hi2`) : `hiTame()` = **courbe en S**,
  PAS un simple rolloff. ⚠️ leçon (retour le monteur 17/07) : un rolloff qui comprime juste le haut vers les mids
  **APLATIT le contraste** et ne baisse pas assez les blancs → « on dirait que rien n'a changé ». La bonne
  recette : **creuser les bas-mids (contraste ↑, image punchy) + TIRER le sommet nettement vers le bas** (les
  sources blanches éblouissantes deviennent des néons/glows contenus, l'or devient profond et saturé). `hi`
  modéré (sommet→0,76), `hi2` fort (sommet→0,66). Validé avant/après (façade dorée R16 : or profond + contraste
  vs blanc plat). **S'applique AUSSI en final** (vrai réglage image, ≠ badges/timecode brouillon-only).
  ⚠️ la courbe creuse un peu les noirs — surveiller que ça n'écrase pas un plan déjà très sombre.

### ⭐ VERROU DE SCÈNE sur le batch JOUR/NUIT — l'étalonnage par plan crée des sauts (31/07)

**Le symptôme, repéré par le monteur sur le VLOG #01** : *« entre R48 et R49 il y a énormément de
différence de rendu couleur, comment l'expliquer ? tous les rushs n'ont pas reçu la même passe
de coloration ? »* — oui, et c'était un défaut, pas un réglage.

**La cause mesurée.** `gradeFor()` votait **plan par plan** sur une mesure continue (YAVG) avec
un **seuil sec à 90**. Deux plans du même lieu, filmés à 1 min 40 d'intervalle :

| | 18/07 R02 → R048 | 18/07 R03 → R049 |
|---|---|---|
| YAVG mesuré | **95,5** | **88,1** |
| batch reçu | JOUR — noirs naturels, γ 1,02, sat 1,10 | NUIT — noirs écrasés 0→0,02, γ 0,92, sat 0,95, réchauffement |
| dose `adaptiveSaturation` | ×1,23 (SATAVG 12,6 < 13) | rien (14,4, en zone morte) |

Sept points de luminance d'écart, et deux étalonnages opposés. **Le moteur n'avait aucune notion
de SCÈNE** : il traitait deux plans consécutifs du même endroit comme des étrangers.

**La règle (arbitrée par le monteur, 31/07)** : verrouiller le batch **par bande de plans CONSÉCUTIFS,
et seulement ceux qui se suivent vraiment**. Une bande se coupe quand l'écart de TOURNAGE entre
deux rushs dépasse **10 minutes** ; toute la bande reçoit un seul batch, décidé à la **médiane**
des YAVG (pas la moyenne : un seul plan très clair — un mur blanc, un écran LED — ne doit pas
faire basculer une scène entière, c'est justement l'accident qu'on corrige).

**Le seuil de 10 min est MESURÉ, pas rond** : sur les 90 raccords des 6 journées du VLOG #01, la
distribution des écarts est franchement bimodale (18 raccords sous 1 min, 26 au-delà de 20 min)
et son **creux tombe sur la tranche 8-12 min** — 4 raccords seulement. C'est la vallée entre
« on est encore sur la même scène » et « on a changé d'endroit ». Sur le 18/07, ça découpe
exactement `{R02, R03}` (les robots) · `{R05}` · `{R06, R07, R08}` (le campus).

**Résultat mesuré sur le raccord fautif** : écart de luminance R048↔R049 **26,8 → 6,7** ·
écart de saturation **5,5 → 0,3** · distance colorimétrique globale **30,3 → 18,7 (−38 %)**.
Le résidu est la chrominance : le mur LED passe VRAIMENT du rouge au bleu entre les deux prises,
et ça, on ne le corrige pas — c'est la scène.

⚠️ **Piège de cache qui accompagne ce changement.** La clé d'un segment ne portait que ce qui
dépend du FICHIER (« cropPan/adaptatif sont déterministes du contenu »). Le batch dépend
désormais des plans VOISINS : sans précaution, un plan réaligné par sa scène ressortait du cache
avec son ANCIEN étalonnage, en silence. Le champ `bat` n'entre dans la clé **que pour les plans
que la scène contredit** — même ruse que `mute` et `rep` : les autres gardent leur clé, donc
tout le cache existant survit. Vérifié sur le 18/07 : 4 segments réutilisés, 2 recalculés, et
les segments non concernés sont **bit à bit identiques** (PSNR = inf).

**La leçon transposable** : dès qu'une décision d'étalonnage cesse d'être une fonction du seul
fichier, la clé de cache doit le refléter — sinon la correction est invisible et on croit l'avoir
appliquée. C'est la même famille de bug que le nom de fichier des blocs facecam (cf. `VLOG.md` §6).

### Filtre ADAPTATIF à la palette — « intelligence de filtre » (le monteur, 17/07)
Un grade/filtre FIXE ne convient pas à toutes les palettes : LOOK STUDIO **ajoute du chaud** → flatteur sur un
plan FROID (R01, heure bleue, R−B ≈ −13) mais **sur-cuit** un plan déjà DORÉ (R16 +24, R23 +32 → mono-orange,
blancs qui bavent). Solution `adaptiveWB(file)` dans monte.mjs, **auto par plan** :
- mesure la **chaleur** du plan = R−B moyen (pixel 1×1, source, 3 instants, `plateWarmth`).
- **ne REFROIDIT QUE les plans sur-chauds** (seuil R−B > 15) proportionnellement, **pondéré sur l'axe
  JAUNE→BLEU** (`colorbalance` bm/bh = levier direct anti-jaune, + léger retrait de rouge ; plafonné) → l'or
  vire au crème/beige naturel (retour le monteur « bâtiments jaunes trop jaunis »), variété tonale rendue (verts,
  pierre), sans tuer la chaleur tungstène du bâtiment.
- **plans froids/neutres (≤18) : NON touchés** (le grade y est déjà bon → R01 strictement identique).
Validé avant/après : R23/R16 dé-cuits, R01 inchangé. C'est LE principe « filtres différents selon la palette ».
> ⭐ MàJ 17/07 : `adaptiveWarmth` ne mesure PLUS la chaleur GLOBALE mais celle de la **zone brillante** (façade),
> gatée par la **dorure** (warmth × satu de la zone claire) pour séparer un doré d'un néon. Cf. Roadmap §Warmth
> par RÉGION (FAIT) pour le mécanisme et les chiffres. Le principe adaptatif décrit ici reste valide ; seule la
> SONDE a gagné en finesse (mesure régionale au lieu de moyenne d'image).
Extensible : d'autres axes adaptatifs possibles (saturation si mono, expo si plan sombre) sur le même schéma
mesure→règle. Le grade de base `GRADE_LOOKSTUDIO` reste le socle ; `adaptiveWB` ne fait que corriger l'excès.

### Saturation ADAPTATIVE — rendre la variété tonale aux plans ternes (`adaptiveSat`, 17/07) — FAIT
2ᵉ axe adaptatif, même schéma que `adaptiveWB`. Un plan nuit peut être TERNE/MONO (skyline multi-néons plat)
→ on lui rend ses couleurs ; un néon CRIARD → on le calme. `adaptiveSat(file)` dans monte.mjs :
- mesure la satu du plan = **SATAVG** (`plateSat`, source, 3 instants), zone morte au milieu (on ne corrige
  que l'excès, comme adaptiveWB).
- terne (SATAVG < 13) → BOOST plafonné ×1,30 vers une cible ~15,5 ; criard (SATAVG > 28) → réduction
  plancher ×0,82. Entre les deux : intact.
Deux enseignements DUREMENT gagnés, valables pour TOUT futur filtre de mesure :
1. **Normaliser le bit-depth AVANT de mesurer.** Les rushes mélangent 8-bit (`yuv420p`, 0-255) et 10-bit
   (`yuv420p10le`, 0-1023) : `signalstats` brut lit les plans 10-bit ~4× trop haut (R15 YAVG 305 au lieu de 76)
   → mesure fausse, comparaison inter-plans impossible. Parade : `format=yuv420p` DANS la chaîne AVANT
   `signalstats`. (`plateWarmth` y échappait déjà via `format=rgb24`.) À généraliser à expo/point-noir/etc.
2. **Gate CHALEUR sur le boost.** Piège vécu (R16 Bund doré) : la SATAVG *globale* est basse (cadre = surtout
   ciel noir) mais la zone brillante est DÉJÀ saturée → booster re-jaunit (mono-orange, ce que `adaptiveWB`
   combat). Donc on ne remonte QUE les plans froids/neutres (R−B < 15, platitude réelle : R15/R03 skylines).
   La réduction d'un criard n'est PAS gatée. C'est la limite « moyenne globale vs zone brillante » de la
   roadmap, contournée par une garde bon marché plutôt que par un masque local.
Validé avant/après : R15 (7,6→néons ressortis), R03 (12,2→ciel bleu + feux + rouge rendus) boostés ; R16 doré
et R10 déjà-vif (21,4, zone morte) strictement intacts. Ordre dans la chaîne : après `adaptiveWB`, avant `glow`.

### Anti-bloom / bruit de lumière autour des émetteurs (flag `glow`, le monteur 17/07)
Retour le monteur : le feu vert / les néons **débordent** (halo, voile) autour d'eux au lieu de rester contenus.
⚠️ HONNÊTETÉ : une partie de ce glow est **optique, capté à la prise de vue** (la lumière a physiquement bavé
sur le capteur) → on le **RÉDUIT / resserre**, on ne le **supprime** pas à 100 % (sinon halo noir / artefacts).
Recette `deBloom()` (flag `glow` en fin de ligne `plan.txt`, ex. `R03 6-11 glow`) : **contraste LOCAL grand
rayon** (`unsharp=9:9:0.8` → resserre les bords, tue le voile basse-fréquence) + **creux léger de la BANDE de
halo** (upper-mids) en gardant la source (~1,0). Validé sur R03 (feu vert + néons resserrés, texte lisible) et
R10 (Snack Street : caractères nets, couleurs qui ressortent). **À RÉSERVER aux plans à néon/bruit lumineux** :
l'`unsharp` peut lever du bruit sur un plan sombre lisse. S'applique aussi en final. Testé sans artefact à 0,8 ;
au-delà ça durcit trop. NB : c'est un traitement GLOBAL qui vise préférentiellement les halos (via le contraste
local + la bande de bloom), pas un masque par émetteur — le vrai masquage local par source n'est pas fait
(complexe, risqué) ; l'approche actuelle suffit visuellement.

## Directions Artistiques (DA) — presets sélectionnables

Une **DA** regroupe un LOOK (grade) + une INTENTION de rythme. le monteur en choisit une par montage en
déposant `DA.txt` à la racine de `~/Movies/Montage/` avec le nom de la DA. Registre extensible dans
`monte.mjs` (objet `DA`) : ajouter une entrée = une nouvelle DA disponible. Sans `DA.txt`, rendu neutre
(le toggle manuel `grade.txt` reste un repli).

| DA (`DA.txt`) | Look | Rythme | Statut |
|---|---|---|---|
| **`look studio`** | filmique chaud, grade codé + chaîne adaptative — **batch JOUR/NUIT auto** (luminance du plan, seuil YAVG 90 ; NUIT = noirs profonds/expo basse/hautes domptées, JOUR = doux/ciel maîtrisé/sat rehaussée) | plans-**mouvement tenus**, plans **fixes resserrés** (≤5s) | nuit 16/07 · jour 18/07 |
| `nuit cine` | **LUT** `nuit_cine.cube` : noirs profonds bleu-cyan / lumières chaudes / néons punchy (alternative graduée à look studio) | idem look studio | livré 17/07 |
| `cine teal orange` | **LUT** `cine_teal_orange.cube` : blockbuster, ombres cyan / hautes orangées, saturé | idem | livré 17/07 |
| `kodak warm` | **LUT** `kodak_warm.cube` : film chaud nostalgique, WB chaud, hautes crème | idem | livré 17/07 |
| `brut` | aucun grade | plans entiers | livré 16/07 |
| _(à venir)_ | _ex. N&B, diurne…_ | _selon futures références_ | idées |

**« LOOK STUDIO »** (1re DA, consolidée pour cette vidéo) : déambulation dans la ville. Grade filmique chaud à
**deux batchs auto-sélectionnés par la luminance du plan** (`gradeFor`, seuil YAVG 90) : NUIT (noirs profonds,
expo basse, hautes domptées, ambre, sat ~0,93 — recette `GRADE_LOOKSTUDIO`) ou JOUR (noirs naturels, ombres
ouvertes, ciel couvert maîtrisé, sat ~1,10 — `GRADE_LOOKSTUDIO_DAY`, ajouté 18/07). Rythme = la **durée suit le mouvement de caméra**
(règle décisive du monteur) : plan MOUVEMENT tenu entier, plan FIXE resserré à 5s.

### LUT filmiques `.cube` (`lut3d`) — looks tout-faits sélectionnables (FAIT 17/07)
Un LOOK complet dans un fichier `.cube`, appliqué par `lut3d` — permet des DA supplémentaires SANS
coder un grade. **100 % offline** : les LUT sont GÉNÉRÉES par calcul (`make-luts.mjs`, aucun download —
contrainte Chine + règle sécu), écrites dans `~/Movies/Montage/Réglages/LUTs/`. Trois looks livrés :
`nuit_cine` (recommandé nuit : noirs PROFONDS bleu-cyan, lumières chaudes, néons punchy — calé sur la
doctrine « noirs profonds » via un toe crush, validé avant/après R16/R15), `cine_teal_orange` (blockbuster
saturé), `kodak_warm` (film chaud). Chaque LUT = une fonction de transfert RGB (WB → courbe en S → split-tone
ombres/hautes → saturation) échantillonnée sur une grille 33³.
Sélection : `DA.txt` = `nuit cine` / `cine teal orange` / `kodak warm`, OU `lut.txt` = nom d'un `.cube` du
dossier (**DROP-IN** : une VRAIE LUT tierce déposée là marche pareil ; `lut.txt` prime sur la DA). ⭐ Règle
d'intégration : **une LUT DÉFINIT la palette → la chaîne adaptative (warmth/sat/point-noir) est court-circuitée**
quand une LUT est active (mesuré sur la commande ffmpeg réelle) ; hi/glow (correctifs, pas un look) RESTENT.
**Dosage exposé** : `lut.txt = nuit_cine 0.6` → le moteur génère un `.cube` dosé (chaque entrée lerpée vers
l'identité à 1−intensité, caché dans `LUTs/.cache/`). Une LUT à 0.6 lit souvent plus naturel qu'à fond (validé
avant/après R16 : progression douce source→0.3→0.6→plein). Une DA peut porter `lutIntensity`. Le grade codé LOOK STUDIO reste le
défaut (`DA.txt`=LOOK STUDIO) ; les LUT sont des alternatives OPT-IN, elles ne changent rien tant qu'on ne les
sélectionne pas. Enseignement : une LUT non calée nuit LAVE la nuit (noirs levés — même piège que le grade jour
de la chaîne de référence) → toute future LUT nuit doit intégrer un assombrissement expo + toe crush (cf. `nuit_cine`).

### Lit musical sous l'ambiance (`Musique (optionnel)/`, terrain prêt 17/07)
Un montage d'ambiance curé était MUET (ambiance de rue seule). Désormais, dès qu'un morceau est déposé dans
`Musique (optionnel)/`, `mixMusicBed()` le pose en **lit** sous le montage : musique porteuse, ambiance de rue
abaissée et **sidechain-duckée** sous elle, le tout re-normalisé à −14 LUFS. ≠ mode BEAT (aucune coupe sur le
beat — la doctrine tient les plans) ; ≠ `mixMusicUnderSpeech` (là la voix est reine). Non destructif (repli =
ambiance seule). Terrain validé sur ton généré (le filtergraph tourne, durée = la vidéo) ; dormant tant qu'aucun
morceau n'est déposé → comportement actuel inchangé. le monteur dépose la musique (sourcée sur place, ⚠️ droits YouTube).

### Cut d'intro sec (`couper.txt`) — l'alternative au ramp
`couper.txt` : `<bout-du-nom> <seconde-de-départ>` → le plan démarre à cette seconde, **cut sec, sans
effet** (« juste au début du no-speed »). C'est le pendant simple du speed-ramp : quand le monteur ne veut PAS
l'effet mais juste sauter l'intro. Prioritaire sur `ramp.txt` pour un même plan. Ex. Plan 2 (0006) coupé à 4,5s.

### Speed-ramp d'intro « retour sur terre » (compétence 16/07)
Quand un plan s'ouvre sur un long déplacement de caméra avant d'arriver au sujet (ex. Plan 2 = le haut
d'un building, puis descente vers la rue), on **accélère cette descente en DÉCÉLÉRANT** (rapide en haut →
ralenti à l'atterrissage) au lieu d'un cut : le building est montré, effet « retour sur terre ». L'intro
est muette, l'**ambiance de la rue arrive au point de pose** (renforce l'effet). Piloté par `ramp.txt`
(racine) : `<bout-du-nom> <secondes-jusqu-au-sujet>`. `rampSegments()` + `RAMP_SPEEDS=[6,4.5,3.3,2.4,1.6]`.
Ex. Plan 2 (0006) : descente 5,5 s → jouée en 1,9 s. Le `settle` est LE réglage à tuner à l'œil (une seule
valeur). Se juge EN MOUVEMENT (les stills trompent). Auto-détection du settle = piste future (nécessite du
mouvement directionnel/tilt, pas seulement scalaire).
⚠️ **Pièges corrigés (bug vécu = saccade ~1-6 img/s)** : (1) `setpts` doit venir AVANT le `fps` final
(sinon timeline cassée au concat) ; (2) NE PAS mettre `anullsrc`+`-shortest` pendant l'encodage `setpts`
(donnait 6 fps) → encoder les tranches MUETTES (`-an`), les concaténer, PUIS ajouter le silence en une
passe séparée (vidéo finie + anullsrc + `-shortest` = sûr). Vérifier : la zone rampée doit compter ~30 img/s.

### Détection fixe / mouvement (le cran exécutable de la règle)
`motionScore(fichier)` dans `monte.mjs` : vignette 48×27 → différence inter-images. Le mouvement d'objets
locaux se moyenne et disparaît, seul le déplacement de CAMÉRA subsiste. **Calibré** : plan figé 0,0 · plan
verrouillé (la chaîne de référence) 0,7-0,9 · plans du monteur (filmés en mouvement) 2,1-6,6. **Seuil `MOTION_STATIC` = 1,5** :
< 1,5 = fixe (cappé à `AMB_STATIC_CAP`=5s, fenêtre centrale) ; ≥ 1,5 = mouvement (tenu entier). N'agit
qu'en mode ambiance avec une DA `holdMovement`. Sur la matière du monteur (tout en mouvement) → rien n'est
cappé, c'est voulu.

### Deux niveaux de rendu (`qualite.txt` = brouillon | final) — proposé par le monteur 16/07
La « perte de qualité » ressentie venait de l'encodeur **videotoolbox (12M, mou)**. Workflow :
- **brouillon** (défaut) : videotoolbox rapide → on itère/cadre le montage et juge le grade vite.
- **final** : **libx264 CRF 16 preset slow** → vraie qualité pour publier (une seule génération, segments→concat copy).
Méthode : itérer en brouillon jusqu'à ce que ça plaise, PUIS un rendu `final`. (Le temps est surtout pris par
whisper ~2 min ; le gain brouillon/final est sur l'encodage.)

**RYTHME (profilé sur le .mp4 complet, 22 min) :** 362 plans, **16 coupes/min, plan médian 2,3 s**
(distribution <1s:3 · 1-2s:85 · **2-4s:189** · 4-8s:60 · >8s:25). C'est un **guide structuré** : carton-titre,
marqueurs « Day 2 / City God Temple », inserts d'écran de téléphone (Alipay, prix), alternance
large→détail→humain→info, bande musicale posée (-17 LUFS). Genre = guide narré, PAS montage d'ambiance pur.

### ⭐ La purge de cache effaçait le NEUF et gardait le PÉRIMÉ (bug corrigé 31/07)
`pruneCache()` triait les segments « plus récents d'abord » puis supprimait **en partant du début**
de cette liste : elle effaçait donc exactement ce qu'on venait d'encoder. Le commentaire disait
« purge des plus vieux », le code faisait l'inverse — et **rien ne le signalait** tant que le cache
restait sous les 4 Go.
**Ce qui l'a réveillé** : la première grosse re-passe (recette de grade JOUR changée le 31/07 → les
97 plans du VLOG recalculés, cache pile au plafond). Résultat : **88 des 97 segments neufs supprimés
à la volée pendant que les jours suivants se rendaient**, 3,96 Go d'orphelins périmés conservés, et
`vlog.mjs` qui s'arrête net sur « segment purgé du cache ». 40 min de rendu à refaire.
**La leçon, plus large que ce bug** : un cache qui se purge tout seul est un endroit où une panne ne
fait AUCUN bruit — le rendu du jour se termine en vert, le manifeste s'écrit, et c'est seulement
l'étage d'après (le merge) qui découvre le trou. Quand une passe recalcule BEAUCOUP de segments,
vérifier que le manifeste pointe encore sur des fichiers qui existent, avant de lancer le merge.
Le tri part maintenant du plus vieux ; couplé au `touchCache()` des cache-hits, c'est un vrai LRU.

## Recadrage sujet-aware (formats mélangés → 16:9, automatique)
`cropPan(file)` dans `monte.mjs` : les rushes mélangent 16:9 (rue) et **carré 1:1** (skylines du Bund, et TOUT
le 16/07 en 3072²) — comme toutes les vidéos passées. Le `FIT` cover recadrait au CENTRE → sur un carré il
jetait le sujet. Désormais, pour tout plan hors 16:9, on mesure la **TEXTURE** de l'image (gradient seul,
moyenné sur 3 instants, grille 64) et on cale la fenêtre 16:9 sur la bande la plus texturée : le bâti/les néons
sont texturés, le ciel l'est moins → la fenêtre suit la ville. Slack vertical → choisit y, horizontal → x, vrai
16:9 → pan nul (crop d'avant inchangé). Full-frame, zéro barre, aucun réglage. Appliqué au corps ET à l'intro
rampée. Le log affiche `recadré sujet ↕ y=…/…`.
⚠️ **FIX 18/07 (jour vs nuit)** : l'ancienne métrique pondérait la **luminance** brute. Ça suivait la ville la
NUIT (ciel sombre) mais s'INVERSAIT le JOUR — un ciel couvert clair+nuageux est LUMINEUX et texturé → il
gagnait, la fenêtre montait sur le ciel (y=0, sujet coupé en bas ; vu sur les 5 plans du 16/07). Passage en
**gradient seul = invariant à la lumière** → le crop redescend sur la ville jour comme nuit. Limite inchangée :
un carré au sujet plein-hauteur perd du haut ou du bas — on se cale au mieux sur la zone texturée.

## Playbook opérateur — PROCÉDURE AUTONOME (lire au début d'une session montage)
**Mandat d'autonomie (le monteur, 17/07)** : je dois produire un premier montage curé ET corrigé **tout seul**, à sa
patte, SANS lui faire re-valider chaque étape. Je déroule 1→8 en autonomie, je livre un brouillon numéroté, PUIS
Le monteur affine en citant les badges R##/le timecode. La doctrine complète (ce qui se coupe, ce qui s'écarte, ce qui
se dompte) est aux §Curation / §Mouvement / §Hautes lumières ci-dessus — c'est MA grille, appliquée sans qu'il
la rappelle. Étapes (ne pas en sauter) :
1. **Scoper le jour.** Plusieurs jours sont souvent déposés d'un coup dans « Landscape Rush/Déposer les rushes ici ».
   Écrire `Réglages/jour.txt` avec la/les date(s) à monter (le nom `DJI_YYYYMMDD…` est la source fiable, PAS
   la date-fichier : un re-vidage de carte recopie et fausse les mtime). « avant-hier / hier » = calculer
   depuis la date du jour, puis vérifier sur les noms.
2. **Cataloguer** le sous-ensemble : `node catalogue.mjs "<dossier>" <dates>` (ou il lit `jour.txt`) → R01..RNN
   + planches-contact `index_*.jpg`. Les lire (Read) : c'est le référentiel partagé « R## » avec le monteur.
2bis. **Pellicules pour VOIR l'intérieur des plans** : `node filmstrip.mjs [pas_s] [R##]` → `catalogue/strips/R##_strip.jpg`
   (1 img/s par défaut, temps gravé sur chaque cellule). Les Read : c'est ce qui permet de décider OÙ couper
   (tilt, va-et-vient, mort) et de repérer les répétitions ENTRE plans. Densifier à `0.5` pour caler une coupe.
3. **Curer plan par plan EN AUTONOMIE** (keep-ranges par rush), en appliquant MA grille sans la faire valider :
   - **Contenu** : garder l'ambiance/B-roll à valeur nouvelle ; **écarter** pièces-à-caméra / plans parlés (sa
     voix), street-food, showroom/intérieur clair (rupture ton nuit), et **dédupe** les sujets répétés (une
     skyline, une foule Bund…). Cf. §Curation.
   - **Mouvement** : couper le mouvement gratuit (fins de plan +++, va-et-vient, tilt vers du déjà-vu) ; garder
     le mouvement qui révèle du neuf ou le plan une fois POSÉ (repère fixe stabilisé) ; pano > vitesse R07 = couper.
   - **Défauts rédhibitoires** : horizon de travers, gens coupés à moitié au bord, tilt-up amateur → écarter.
   - Situer les coupes à la demi-seconde sur les pellicules (`filmstrip.mjs 0.5 R##`).
3bis. **Écrire le plan dans `Réglages/plan.txt`** (`R07` entier · `R03 2.5-11` · `R12 0-3 7-11` · flag `hi`/`hi2` ;
   `#` commentaire ; ordre = ordre du montage ; rush non listé = écarté). Le moteur EXÉCUTE ce plan gelé : whisper
   sauté, keep-ranges tels quels, aucune coupe mécanique. `exclure/couper/ramp.txt` ignorés (le plan fait foi).
   ⚠️ retirer `plan.txt` pour repasser au montage mécanique auto d'un autre batch.
3ter. **CONTRÔLE COULEUR/LUMIÈRE de TOUS les plans gardés** (grille auto par plan, sur une frame graduée
   extraite du rendu — faire une grille de contrôle 1 frame/plan et la Read) :
   - **Hautes lumières lavées** (§Hautes lumières) : grande surface claire+lisse (façade, bateau) qui bave →
     flag `hi` / `hi2` (façades dorées). NE PAS toucher les néons vivants texturés.
   - **Bruit de lumière / bloom** (§Anti-bloom) : néons/feux qui débordent (halo) → flag `glow` (plans à néon
     seulement — l'unsharp lève du bruit sur un plan sombre lisse).
   - **Chaleur (jaune/doré)** : AUTOMATIQUE via `adaptiveWB` (refroidit les plans R−B>15) — rien à flaguer, mais
     vérifier qu'un plan doré n'est pas resté « trop jaune » (sinon dire de renforcer le seuil/gain).
   - Chaque traitement s'applique AUSSI en final (≠ badges/timecode brouillon-only). Après flags → re-rendre.
4. **Brouillon** (`qualite.txt`=brouillon) → extraire quelques images (ffmpeg -ss) et les MONTRER comme preuve.
   Le brouillon est un **PROXY DE TRAVAIL numéroté** (auto, brouillon seulement) : chaque plan porte son
   **badge R##** (haut-gauche, = numéro des planches catalogue) et un **timecode global** court (bas-droite).
   → le monteur itère en citant les repères : « raccourcis R07 », « à 1:23 coupe ». Le **final n'a AUCUN habillage**.
   **Décoder ses retours** : « plan N » = le **badge R0N** à l'écran (PAS la N-ième position) ; un **temps
   approximatif** (« vers 1:14 ») → mapper via le timecode gravé. Les deux repères suffisent, il n'a pas à être
   précis. À chaque retour : réécrire `plan.txt`, re-rendre, montrer la nouvelle timeline R##→mm:ss.
5. **Final** seulement après OK du monteur sur le look (`qualite.txt`=final, libx264 CRF16, ~1 passe lente).
6. **Purge à CHAQUE rendu — par l'OUTIL, plus de tête** : `node arbo.mjs --purge` (dry-run) puis
   `--apply --purge`. Il garde N et N-1 dans `Vidéos finies/Tests`, parmi les épisodes et parmi les
   masters facecam, et met le reste à la **corbeille** (réversible tant qu'elle n'est pas vidée).
   `Journées/` et `Éléments/` ne sont JAMAIS purgés — c'est la matière du montage final et les
   pièces réutilisables. Purger en plus les `projects/`+`critique/` accumulés.
   ⚠️ **Pourquoi ça a changé le 31/07** : cette consigne existait déjà, mot pour mot, en « réflexe
   sans qu'il le redemande ». Mesure du jour où le monteur a ouvert le dossier : **13 rendus de test
   empilés** (782 Mo) et 2 épisodes périmés (2,35 Go). Une règle de rangement suspendue à un
   réflexe n'est pas tenue ; celle-ci est désormais une commande. La leçon dépasse le rangement :
   **si une règle du skill dépend de ma discipline plutôt que d'un outil, elle finira violée.**

Réglages (dans `Réglages/`) : `jour.txt` (scope jour), `plan.txt` (**plan de coupe curé — prioritaire**),
`DA.txt` (look+rythme), `mode.txt` (ambiance),
`qualite.txt` (brouillon/final), `exclure.txt` (rushes à virer, sous-chaîne du nom ; commentaire en fin de
ligne OK), `couper.txt` / `ramp.txt` (intro d'un plan). Musique optionnelle dans « Musique (optionnel) ».

Pièges (déjà corrigés côté code, mais à connaître) :
- **Ordre = nom, pas mtime** (recopie de carte ⇒ mtime menteuse). Corrigé dans `listRushes()`.
- **Formats mélangés** 16:9 / carré : gérés seuls par le recadrage sujet-aware (cf. section dédiée). Rien à faire.
- **Voix FR = plan JETÉ en entier** (pas seulement muté). Un beau plan narré par le monteur disparaît → le signaler,
  et proposer le mode « muet » si le monteur veut garder l'image. Ses pièces-à-caméra tombent ainsi toutes seules.
- **App / onglet** : sans objet ici (ce pipeline est offline, aucun state partagé).

## Bibliothèque de filtres — `filters.mjs` (le monteur 17/07 : « construis-toi une bibliothèque »)
Source unique de tous les filtres colorimétriques, importée par monte.mjs. But : aller plus vite / consommer
moins (piocher + doser au lieu de recoder), et couvrir TOUT le spectre des réglages classiques. Deux étages :

**1) Mesure consolidée — `measurePlate(file)`** : UN seul passage `signalstats` (8-bit normalisé, ~6 frames,
caché) renvoie toutes les stats du plan (YAVG/YMIN/YLOW/YHIGH/YMAX, UAVG/VAVG, SATAVG/SATMAX). Les filtres
adaptatifs piochent dedans → une mesure au lieu d'une par filtre. `plateWarmth` reste à part (R−B en RGB, sert
la balance des blancs + les gates). **Règle d'or** : `format=yuv420p` AVANT `signalstats` (rushes 8-bit ET
10-bit mélangés ; sinon les 10-bit lisent ~4× trop haut).

**2) Filtres**, tous testés en avant/après avant activation :
- **Adaptatifs** (mesure→règle, zone morte + gate, renvoient un fragment vf) : `adaptiveWarmth`,
  `adaptiveSaturation`, `adaptiveBlackpoint`, `adaptiveExposure`. `adaptiveColor(file, opts)` assemble la chaîne
  (warmth → saturation → point-noir ; exposure OFF par défaut). Chaîne image par plan dans monte.mjs :
  `FIT(grade) → hiTame → adaptiveColor → deBloom(glow) → badge`.
- **Pilotés par flag** (plan.txt) : `hiTame` (hautes lumières), `deBloom` (anti-bloom `glow`).
- **LOOKS** — catalogue des réglages CLASSIQUES, chacun un builder `(dose) => fragment`, qu'on pioche et dose :
  `brightness, exposure, contrast, gamma, blackPoint, whitePoint, lift, gain` (tonalité) ; `saturation, vibrance,
  temperature, tint, hue, warmCool, autoWB` (couleur) ; `sharpen, denoise, deband` (nuit) ; `filmLut(.cube)`.
  Paramètres sourcés de `ffmpeg -h filter=…` (build 8.1.2 du monteur). Vocabulaire commun pour réglages manuels,
  futures DA et futurs adaptatifs.

Ajouter un filtre = ajouter une fonction dans filters.mjs (mesure→règle si adaptatif, ou builder LOOKS si manuel),
valider avant/après, gate par plan quand ça peut nuire ailleurs. Jamais dans monte.mjs.

## Roadmap — filtres ADAPTATIFS à développer + outils open-source à explorer (le monteur 17/07)
Objectif le monteur : « développer plein de filtres pour être le plus adaptatif possible selon le plan, améliorer le
rendu couleur ». Le schéma est TOUJOURS le même : **mesurer une propriété du plan → appliquer une correction
proportionnelle** (comme `adaptiveWarmth`). Socle actuel : grade LOOK STUDIO → hi/hi2 (courbe S) →
adaptiveColor (chaleur → saturation → point-noir) → glow (anti-bloom) → crop sujet-aware.

Depuis le 17/07 tout ça vit dans la **bibliothèque `filters.mjs`** (cf. §Bibliothèque de filtres) : mesure
consolidée + registre adaptatif + catalogue LOOKS. Ajouter un axe = ajouter une fonction là, pas dans monte.mjs.

**FAIT 18/07 (jour + invariance lumière) — cf. §Leçons de session 18/07 :**
- ~~**Grade JOUR**~~ **FAIT** : batch JOUR de LOOK STUDIO, sélection auto par luminance (`gradeFor`, seuil YAVG 90).
- ~~**Crop invariant à la lumière**~~ **FAIT** : `cropPan` en gradient seul (le jour, la luminance faisait gagner le ciel).
- ~~**Plafond de mouvement enforced**~~ ~~**Seuil normalisé jour/nuit**~~ **FAIT (18/07 soir)** : `curate.mjs`
  flague sur un **RATIO invariant** (mouvement temporel ÷ détail spatial Sobel ×100, plafond `RATIO_STRONG=70`),
  plus sur la médiane brute « 24 » (calibrée nuit, sur-flaguait le jour : 37/40 faux positifs le 16/07).

Axes adaptatifs à AJOUTER (chacun = mesure + règle, gate/auto, valider en avant/après) :
- ~~**Saturation adaptative**~~ **FAIT (17/07)** : `adaptiveSaturation` — SATAVG 8-bit normalisé, boost ×1,30 des
  plans ternes/mono gaté chaleur (froids seulement), réduction ×0,82 des criards. Cf. §Saturation ADAPTATIVE.
- ~~**Balance des noirs / contraste par plan**~~ **FAIT (17/07)** : `adaptiveBlackpoint` — mesure le plancher réel
  (YLOW), relève le point noir d'entrée (`colorlevels`) si laiteux, zone morte (YLOW≤40) pour ne jamais crusher un
  plan déjà profond. **Garde faux-positif** : un plancher élevé sur un plan GLOBALEMENT clair = brume/voile (R09
  dragon), pas un défaut → skip si YAVG>110. Enseignement : sur le montage 15/07 les noirs sont DÉJÀ profonds
  partout (YLOW 27-37) sauf R09 (brume, skippé) → le filtre est un filet de sécurité, pas un gain visible ici.
- ~~**Exposition adaptative**~~ **CODÉE, OFF — verdict tranché (17/07) : la garder OFF sur la nuit.** Mesuré YAVG
  des 11 plans : seuls outliers R16 (63), R22 (71), R09 (127). Mais R16/R22 sont sombres PARCE QUE ce sont des
  plans nuit dominés par le ciel noir = le low-key VOULU (« noirs profonds, expo basse »). La cible générique 92
  les éclaircirait → LAVERAIT la nuit = régression, exactement la doctrine que l'expo violerait. Une expo « nuit-
  aware » (rescaper seulement un vrai crush, cible basse) est possible mais AUCUN plan ici n'en a besoin → non
  fait. `adaptiveExposure` reste dispo dans la lib, hors chaîne.
- ~~**Débruitage nuit**~~ **MESURÉ NON REQUIS + auto NON FIABLE (17/07).** Le DJI 10-bit sort très propre : bruit
  d'ombre mesuré 0.16–0.32 (sur 255) et AUCUN grain visible en zoom ×2 sur le rendu 1080 (le downscale 4K→1080
  tue déjà le peu de bruit). Tentative de détecteur AUTO abandonnée : le résidu |raw−débruité| s'auto-annule au
  downscale de mesure, et `bitplanenoise` du bitplan bas est quasi-aléatoire même sur une image propre → pas de
  séparation fiable propre/bruité. Reste en MANUEL via `LOOKS.denoise` (hqdn3d) si un rush haut-ISO est jugé
  bruité à l'œil. Un détecteur auto sûr = tâche future avec un rush de RÉFÉRENCE bruité pour se calibrer.
- ~~**Deband**~~ **MESURÉ ABSENT + auto NON FIABLE (17/07).** Zoom ×2 sur les 2 plus grands ciels (R15 41% de
  ciel, R16 44%) : R15 = ciel noir pur, R16 = nuages texturés → AUCUN banding à la livraison 1080. Tentative de
  détecteur AUTO abandonnée : une métrique « zone mid-dark lisse » FAIT FEU sur ces ciels propres (faux positif
  8-11% > seuil) → deband les softerait sans gain = régression. Détecter le banding RÉEL (plateaux séparés de
  steps en contours) ≠ « zone lisse » et reste cher/fragile offline. Reste en MANUEL via `LOOKS.deband` si le monteur
  repère du banding sur un rush de crépuscule. Détecteur auto = tâche future avec un rush de RÉFÉRENCE bandé.
- ~~**Warmth par RÉGION**~~ **FAIT (17/07)** : `adaptiveWarmth` désormais région-driven via `plateBrightZone`
  (top-quartile de luma, lit un grid 80×45 RGB à 3 instants → renvoie warmth R−B ET saturation HSV de la zone
  claire). La leçon dure : **la chaleur seule ne sépare PAS un doré d'un néon** — R22 (doré) et R07 (néon) lisent
  TOUS DEUX ~14.7 en global et ~36-39 en zone brillante. Le discriminateur qui marche = **DORURE = warmth × satu
  de la zone brillante** : une façade lavée est chaude ET saturée dans sa zone claire ; un néon est chaud mais sa
  zone claire est moins saturée (cœurs qui clippent vers le blanc) ; un plan froid n'est pas chaud du tout.
  Mesuré : DORÉ R16 22.6 · R22 13.5 · R23 51.7 ≥ NÉON R03 10.2 · R07 10.5 · R10 12.7 · R15 7.2 > FROID <0 · BRUME
  R09 1.8. Correction PROPORTIONNELLE à (index−12), plafonnée → près du seuil (R22↔R10) la dose ≈0, donc la marge
  fine ne fait pas basculer visiblement. **Gains validés avant/après** : R16 (façade dorée) enfin correctement
  dé-cuite (dose 0.026→0.064, mono-jaune dompté, chaleur tungstène gardée) ; R23 marginalement plus « pierre » ;
  R10 néon un poil PLUS vif (le refroidissement parasite du global 19.3 est retiré : dose 0.048→0.004) ; néons
  froids (R01/02/08), skylines néon (R03/07/15) et brume (R09) STRICTEMENT intouchés. Enseignement bonus :
  R22 s'est révélé être une skyline mixte (Pudong), pas une façade — la dose proportionnelle la nudge de façon
  imperceptible (0.009) sans dé-saturer ses LED colorés → le proportionnel au seuil rend le mauvais label inoffensif.

Outils OPEN-SOURCE gratuits à évaluer pour enrichir la stack (tous scriptables offline, cf. contrainte Chine) :
- **ffmpeg (déjà là)** — ~~`lut3d` (LUT .cube = looks filmiques)~~ **FAIT 17/07** (cf. §LUT filmiques : 3 looks
  générés offline + drop-in + court-circuit adaptatif). Restent : `colortemperature` (WB plus propre que colorbalance), `libplacebo` (tone-mapping/dither), `deband`,
  `nlmeans`/`hqdn3d` (denoise), `vidstab`/`deshake` (stabilisation — à manier avec précaution, le monteur aime le
  mouvement), `xfade`/`tmix` (transitions douces).
- **G'MIC** (`gmic`, brew) — moteur d'image open-source ÉNORME : local contrast, bloom control, grain, color
  grading, denoise avancé. Idéal pour des corrections que ffmpeg ne fait pas finement. Vérifier install offline.
- **VapourSynth** (python) — traitement vidéo frame-exact + écosystème de plugins (deband f3kdb, denoise KNLMeans,
  awarpsharp…). Le plus puissant pour du per-plan avancé ; plus lourd à installer.
- **frei0r** — plugins vidéo additionnels branchables dans ffmpeg.
- **LUTs filmiques gratuites** (.cube) — appliquées via `lut3d`, permettent des DA supplémentaires sans coder le grade.
⚠️ Toujours : valider chaque nouveau filtre en AVANT/APRÈS à l'image, gate par plan quand ça peut nuire ailleurs,
et garder la contrainte offline (rien de cloud — le Mac voyage en Chine). Priorité = rendu couleur adaptatif.
