# ARBO — arborescence du store, canonique et REPRODUCTIBLE (`arbo.mjs`)

À ouvrir pour : ranger/organiser le store, monter une machine neuve, comprendre où un fichier doit vivre.
Le store n'est pas rangé « au goût du jour » : c'est un contrat, et `arbo.mjs` en est l'exécuteur.
**Ne jamais ranger ce dossier à la main** — lancer l'outil, il fait exactement ça, en dry-run d'abord.

## Sommaire

- **Les quatre règles qui expliquent tout** — pourquoi la structure est ce qu'elle est
- **Commandes** — plan, application, vérification, rétention
- **Ce qu'il garantit** — et ce qu'il ne touche jamais
- **Étendre** — ajouter un dossier au contrat
- **`--purge-journees`** — ouvrir les masters de journée à la rétention, mais par jour

```
~/Movies/Montage/
├── Landscape Rush/                 ← RUSHES SEULEMENT
│   └── Déposer les rushes ici/     ← INBOX watchée (rushes DJI landscape, ils y RESTENT)
├── Facecam Rush/                   ← rushes + le master facecam dérushé (SOURCE du merge)
│   └── Déposer les rushes ici/     ← rushes facecam (+ `.facecam_work/`)
├── Vidéos finies/                  ← TOUT ce que le moteur PRODUIT
│   ├── VLOG Chine 01 (…).mp4       ← les ÉPISODES : l'objet qu'on regarde et qu'on itère
│   ├── Journées/                   ← les masters de journée (`Montage JOUR JJ-MM …`) — matière du final
│   ├── Tests/                      ← les rendus datés (`Montage AAAA-MM-JJ-HH-MM`) — rétention N/N-1
│   └── Éléments/                   ← les pièces réutilisables : générique de fin, cartons, maquettes
├── Musiques/ · Références (inspiration)/ · Réglages/ · YouTube (Chine)/ · Bande de montage.app
└── .coulisses/                     ← masqué : EDL + cartes json, backups config
```

## Les quatre règles qui expliquent tout
1. **Un dossier de RUSH ne contient que des rushes.** *Posé par le monteur le 31/07 : « les rendus bruts
   vont dans Vidéos finies et pas un dossier de rush ».* Avant, « Landscape Rush » recevait à la
   fois l'inbox, les 24 masters de journée et les rendus de test — donc on ne voyait plus les
   rushes. Seule exception, assumée : le **master facecam dérushé** (`VLOG_Chine_facecam_v12.mp4`)
   reste dans « Facecam Rush », parce que `vlog.mjs` le lit comme une SOURCE du merge.
2. **« Vidéos finies » = tout ce que le moteur produit**, trié par NATURE : l'épisode à la racine
   (c'est le livrable), le master de journée dans `Journées/`, le rendu daté dans `Tests/`, la
   pièce réutilisable dans `Éléments/`. Le motif `VLOG <espace>…` distingue l'épisode du master
   facecam `VLOG_…` (underscore).
3. **La rétention est MÉCANISÉE, pas écrite** : `arbo.mjs --purge` garde N et N-1 dans `Tests/`,
   parmi les épisodes, et parmi les masters facecam. `Journées/` et `Éléments/` ne sont **jamais**
   purgés. *Pourquoi c'est une règle et plus une consigne : le 31/07, la rétention « garder N et
   N-1 » existait depuis des semaines dans STYLE.md — et il y avait 13 rendus de test empilés
   (782 Mo) plus 2 épisodes périmés (2,35 Go). Une règle que rien n'exécute n'est pas une règle.*
   ⭐ **Et elle se DÉCLENCHE toute seule** (02/08) : `monte.mjs`, `vlog.mjs` et `facecam/render.mjs`
   appellent `purgeApresRendu()` (`store.mjs`) en dernier geste — une ligne imprimée même quand rien
   n'est dû, `MONTAGE_NO_PURGE=1` pour désarmer. *Une règle mécanisée mais déclenchée à la main n'est
   mécanisée qu'à moitié.* La commande reste pour un balayage délibéré.
   ⭐ **Une lignée de master facecam = SUJET × DÉFINITION** (02/08), pas « le dossier ». Depuis
   « une ville = un rendu », six masters coexistent par version (`VLOG_Xiamen_…`, `VLOG_HongKong_…`) :
   groupés en un seul pool, le N/N-1 gardait *les 2 fichiers les plus récents, point*, et
   `--purge --apply` aurait mis **4 des 6 livrables du jour** à la corbeille. **Le jour où un
   artefact existe en N exemplaires PARALLÈLES, « les 2 plus récents » cesse de vouloir dire
   « N et N-1 ».** Ce qui borne une rétention, c'est ce qui rend deux fichiers CONCURRENTS —
   jamais la seule date.
   ⭐ **Et cette DÉFINITION se MESURE, elle ne se déduit pas du nom** (01/09). `fusion.mjs` sort les
   masters facecam 4K en `VLOG_<Ville>_facecam_v9.mp4`, **sans suffixe `_4K`** : les six rendus 4K du
   VLOG #02 tombaient donc dans la lignée *1080p* et y érodaient le N/N-1 des vrais 1080p (constaté
   le 31/08 — seuls des N-2 sont partis, mais la règle était défaite). `arbo.mjs` lit désormais la
   largeur à l'**ffprobe** (`≥ 2560 px → 4k`), le nom n'étant qu'un **repli annoncé** quand ffprobe
   est injoignable. *Une définition déduite d'un nom n'est pas une définition* — même famille que
   « un identifiant dérivé d'un ordre n'est pas un identifiant ».
   ⭐⭐ **Et un ÉTAGE n'est pas une GÉNÉRATION** (20/09) — la lignée d'épisode vaut donc
   **ÉPISODE × DÉFINITION × ÉTAGE**. Le nu, le sous-titré et le sous-titré + générique ne sont pas
   trois versions successives : chacun se FABRIQUE à partir du précédent, donc aucun ne remplace
   l'autre. Comptés dans un seul pool, chaque étage ajouté **poussait un vrai livrable dehors** :
   le 20/09 la purge désignait très exactement les deux masters que le monteur avait nommément protégés,
   parce qu'ils étaient les plus ANCIENS de quatre — et `purgeApresRendu()` l'aurait fait en
   DERNIER GESTE d'un rendu, sans qu'on le voie venir. `masters-proteges.txt` a empêché le dégât ;
   il ne corrigeait pas la définition. L'étage se lit dans le parenthésé du nom, **une fois retirés
   la date (= la génération) et la définition** : `master`, `master sous-titré`, `merge + générique`…
   Deux fichiers ne sont concurrents que s'ils sont au MÊME étage, et seule la date les départage.
   Éprouvé dans les deux sens avant de servir : sur les 4 fichiers de l'EP3, **0 à la corbeille et
   0 épargné par la liste de protection** — la définition fait désormais le travail que la liste
   faisait en rattrapage ; sur 3 fichiers du MÊME étage, le plus ancien part, en 1080 comme en 4K.
   ⚠️ Restent déduits, eux : `Journées/` (lignée = le JOUR seul, un master 4K et un 1080p du même
   jour se feraient concurrence) et `Tests/` (pas de notion de définition). Non corrigé à ce jour.
   ⭐ **Certains lots se purgent par NATURE, pas par génération** (01/09). `vlog/work` pesait
   **20 Go** et aucun outil ne le connaissait : il vit dans le **moteur**, pas dans le store. Il n'y
   a là ni N ni N-1, seulement des natures — `norm/`, `_raw_v.mp4` et `fusion/` se refabriquent en
   une commande, `_raw_a.m4a` **non** (c'est l'étalon de `gate.py`). D'où une **liste blanche de ce
   qu'on jette**, jamais une liste noire de ce qu'on garde : un artefact neuf dans ce dossier doit
   être gardé par défaut, pas jeté par oubli. Deux gardes : rien n'est touché si un **ffmpeg tourne**
   (sa matière est en cours d'usage), et le poids d'un dossier est calculé récursivement — sinon le
   dry-run annoncerait 0 Mo pour `norm/` et mentirait sur ce qu'il s'apprête à faire.
   *Passage du 01/09 : 20 Go → 4,6 Go, étalon `_raw_a.m4a` prouvé intact au md5.*
4. **Rien de technique dans le champ de vision du monteur** : EDL, cartes json, backups → `.coulisses/`
   (dossier masqué, visible avec Cmd+Maj+.).

## Commandes
```bash
node arbo.mjs            # PLAN (dry-run) : dit ce qu'il ferait, ne touche à rien
node arbo.mjs --apply    # applique le rangement — uniquement mkdir/mv, JAMAIS de suppression
node arbo.mjs --purge    # PLAN de rétention (N/N-1) ; avec --apply → CORBEILLE (réversible)
node arbo.mjs --check    # sortie 1 si dérive (réflexe d'ouverture / après un gros chantier)
node arbo.mjs --store <chemin> --apply   # nouvelle machine / store neuf
```
`--apply --purge` fait les deux, dans le bon ordre : on range d'abord, on applique la rétention
ensuite (sinon la purge compterait des fichiers encore au mauvais endroit).

## Ce qu'il garantit
- **Idempotent** : store conforme → « rien à faire » (sortie 0).
- **Migre en UNE passe** un store d'avant la réorg du 25/07 (`Déposer les rushes ici` à la racine,
  `facecamrush`, `.bak` dans `Réglages/`), d'avant le 30/07 (VLOG mergés restés dans une source)
  **et** d'avant le 31/07 (masters de journée et rendus de test restés dans « Landscape Rush »).
- **Ne supprime jamais rien.** `--apply` ne fait que mkdir/mv. `--purge` met à la **corbeille** :
  tant que le monteur ne la vide pas, tout est récupérable. Et il **signale sans y toucher** une vidéo de
  « Vidéos finies » qu'il ne sait pas classer (= présumée finale validée, posée à la main).
- **Contrôle le MOTEUR** : il nomme tout script qui **fabrique** un chemin de store au lieu de
  l'importer de `store.mjs`. C'est ce contrôle qui empêche la dérive de revenir : le 31/07, sept
  scripts portaient chacun leur littéral `'Landscape Rush'` — une seule modification oubliée et le
  désordre se reconstituait au rendu suivant.
- Ordre du plan verrouillé : il **trie le contenu d'une inbox AVANT** de déplacer le dossier parent
  (sinon les chemins seraient périmés au rename → il aurait fallu 2 passes).
- Piège corrigé au test : `TECH` est évalué **avant** le motif de rendu, sinon `/^VLOG_/i` attrape
  `vlog_chine.edl.json` et `VLOG_….EDL.md` → l'EDL remonterait au lieu d'aller en coulisses.

## Étendre
- **Renommer un dossier** = le changer dans **`store.mjs`** (et dans la SPEC en tête d'`arbo.mjs`),
  nulle part ailleurs. Aucun script du moteur ne doit reconstruire un chemin de store à la main.
- **Ajouter une 3ᵉ source** (drone, B-roll…) = ajouter une entrée dans `SOURCES` en tête de
  `arbo.mjs` (`{ dir, legacy[], render, dest }`) et l'exporter depuis `store.mjs`.
- **Ajouter une famille de fichiers produits** (un nouveau type d'élément, par ex.) = ajouter son
  motif à `ELEMENT` dans `arbo.mjs`. Pas de nouveau dossier sans une ligne ici.

## `--purge-journees` (30/08) — ouvrir `Journées/`, mais par JOUR

`Journées/` est hors du `--purge` ordinaire : c'est la matière du final, et une rétention qui
mordrait dessus par accident coûterait un re-rendu. Quand le monteur demande le ménage des masters
périmés, **`node arbo.mjs --purge-journees`** (dry-run) puis `--apply --purge-journees` applique
la même rétention N/N-1 — mais la **lignée est LE JOUR**, pas la date de fichier.

C'est la leçon des lignées facecam du 02/08, un cran plus haut : deux masters ne sont concurrents
que s'ils racontent **la même journée**. Un pool global aurait gardé les 2 fichiers les plus
récents du dossier et mis **tous les autres jours** à la corbeille.

Premier passage (30/08) : 61 fichiers / 6,7 Go → **34 fichiers / 2,7 Go**, 26 masters périmés à la
corbeille (4,37 Go, réversibles). Aucun jour n'a perdu son master courant ni son précédent.

