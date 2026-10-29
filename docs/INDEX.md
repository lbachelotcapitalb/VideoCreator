# INDEX — carte OPÉRATIONNELLE du montage

## Sommaire

- Reprise & suivi (survivre à un clear)
- Boucle opérateur (le cœur — détail : STYLE §Playbook opérateur)
- Le chemin LÉGER (efficience)
- Fichiers moteur
- Réglages (`~/Movies/Montage/Réglages/`)
- Looks disponibles
- STYLE.md — où sauter (TOC générée, numéros de ligne FIABLES)
- Règles de sélection (18/07 — cf. STYLE §Curation)
- Backlog / pistes (non fait — décider avant de coder)

Ce fichier = **comment on opère** (la boucle, les fichiers moteur, les réglages, où sauter dans STYLE).
Le **routage** (quelle demande → quel outil) et les **garde-fous** sont dans `SKILL.md`, déjà chargé :
pas de doublon ici. On n'ouvre `STYLE.md §X` **que** pour la tâche du moment (TOC en bas, avec les lignes).

- **Moteur** (code + libs) : `~/Library/Application Support/Montage/` · **Store** : `~/Movies/Montage/`
- **Arborescence du store** : contrat posé/vérifié par `node arbo.mjs` → détail dans `ARBO.md`. En doute : `node arbo.mjs --check`.
- **Pipeline 100 % offline** (le Mac voyage en Chine) : jamais de cloud/download, tout se calcule localement.

## Reprise & suivi (survivre à un clear)
- **`node etat.mjs`** = le fil de session persistant (`Réglages/etat.txt`) : scope · décisions · en-attente ·
  journal. C'est l'équivalent montage du handoff. `brief.mjs` en montre déjà le résumé ; consigner au fil de
  l'eau : `node etat.mjs log "…"`, `decision "…"`, `pending "…"`, `done "…"`.
- **`node pack.mjs`** = pack visuel en une commande (planches + pellicules + curation + proof-grid du dernier
  rendu) → `work/pack/MANIFEST.md` liste tout à Read. Réduit les allers-retours d'images.
- **Todo de session** : pour une session à 6-8 étapes (scoper→cataloguer→curer→rendre→itérer), tenir une todo
  structurée via le task-tracker intégré. Habitude, pas un script.

## Boucle opérateur (le cœur — détail : STYLE §Playbook opérateur)
> Cette boucle est celle d'UNE JOURNÉE. Elle porte la **GATE 1** (le plan de coupe, étape 5-bis).
> Un ÉPISODE mergé en a une seconde, la **GATE 2** (la trame, avant d'écrire l'EDL) : elle vit dans
> `VLOG.md` §4 ②, avec le format exact de ce qui est soumis. Ce sont les deux seules décisions que
> le skill soumet au lieu de les prendre.
1. **Scoper** le jour → `Réglages/jour.txt` (source fiable = nom `DJI_YYYYMMDD…`, pas la mtime).
2. **Cataloguer** → `node catalogue.mjs "<dossier>" <dates>` → `R01..RNN` + planches `catalogue/index_*.jpg`. (Le rendu re-numérote de toute façon les noms, cf. `numeroter.mjs`.)
3. **Pré-trier + pellicules** → `node curate.mjs` (→ `catalogue/curation.md` : keep-ranges de queue + doublons) PUIS `node filmstrip.mjs [pas_s] [R##]` (temps gravé) pour trancher à l'œil.
   ⭐ **`node filmstrip.mjs --fin [R##]`** = les 1,5 dernières secondes à 0,1 s, horodatage ABSOLU gravé : c'est le SEUL moyen de voir un **sujet qui sort par le bord du cadre** en fin de plan (STYLE §E-bis) — aucune mesure de la chaîne ne l'attrape. À passer sur tout plan qui se rapproche de son sujet.
4. **LIRE puis curer** → `node lecture.mjs` → remplir `Réglages/lecture-<jour>.md` (par rush : ce que ça
   montre · comment ça évolue · quelle durée et pourquoi · décision) **avant** d'écrire `Réglages/plan.txt`
   (`R07` entier · `R03 6-11` · flags `hi`/`hi2`/`glow`) **+ une en-tête `# jour: AAAAMMJJ`** — sans elle,
   `monte.mjs` ne peut pas vérifier que le plan vise bien le jour scopé (et un plan périmé sort un montage
   plausible mais FAUX). Plan gelé = fait foi. ⚠️ Rythme conseillé :
   court 1,5-2,5 s par défaut, 5 s = dérogation, **au-delà de 7 s il faut une INTENTION NOMMÉE** (ce n'est
   pas un plafond — jour 20 R16 à 11,3 s).
5. **Look** → `Réglages/DA.txt` (LOOK STUDIO défaut, ou une LUT ; `lut.txt = nom 0.6` pour doser) ; `qualite.txt` = brouillon|final · `definition.txt` = 1080|2160. Un morceau dans `Musiques/` → lit musical auto sous l'ambiance.
5-bis. **🛑 GATE 1 — FAIRE VALIDER LE PLAN DE COUPE** (01/08) : la fiche de lecture + le tableau `R## · durée source · décision · durée gardée · pourquoi` + **les rushs écartés nommés un par un**. **PAS de liste de doutes par rush** (le monteur, 02/08 : il ne veut pas rouvrir les rushs un à un pour arbitrer 2 s ; ce qui est incertain, je le tranche et j'écris la raison — seule remonte une question qui se répond DE TÊTE, en une phrase). C'est la seule phase où le skill choisit CE QU'ON GARDE du voyage, et la décision la plus chère à défaire de toute la chaîne. Réponse attendue : **go** · **consigne** · **la version du monteur reprise telle quelle**. Format exact : `VLOG.md` §4 GATE 1. Levée seulement par un « débrouille-toi » explicite → le jour devient **une réserve à nommer**.
6. **Rendre** → `node monte.mjs` → `Vidéos finies/Tests/Montage <stamp>.mp4` (badges R## + timecode en brouillon). **Incrémental** : chaque plan est mis en cache (`cache/`), une retouche ne re-encode QUE les plans changés (cf. `CACHE_VER` pour invalider ; `Réglages/cache.txt`=off pour désactiver). Le cache est plafonné à **12 Go** et purgé en **LRU** (plus vieux d'abord — ⚠️ le tri était inversé et supprimait le NEUF, corrigé le 31/07, cf. STYLE §purge de cache).
   ⚠️ **`· monté → X.mp4` N'EST PAS la fin du rendu** (02/08). Il reste ensuite l'intro titrée, **le burn du timecode global** (`stampTimecode`, étape 4bis) et l'écriture du projet : le fichier est RÉÉCRIT après cette ligne. Ne jamais déplacer / renommer / mesurer la sortie avant **`✅ terminé en … min →`** — sinon on récupère un master sans timecode, de durée identique et donc indiscernable au ffprobe (vécu sur les jours 21, 23 et 24 le 02/08 : md5 différents, seul le timecode manquait). Attendre `✅ terminé`, pas `monté →`.
7. **Vérifier** à l'image (extraire des frames, les Read) ; itérer en citant R##/timecode. Confort : `node visionneuse.mjs --open` → bande de montage jouable ; le monteur pose des marques → `Réglages/marques.txt` (Claude les relit + applique).
   → puis **RENDRE LE TABLEAU DE RESTITUTION** (obligatoire, le monteur 27/07) : **`node restitution.mjs`** sort le
   squelette mesuré (une ligne par rush — `R## · durée source · décision · durée gardée · pourquoi` + bilan
   `avant → après`, chiffres depuis ffprobe et non à la main) ; Claude relit, complète les « À REMPLIR » et
   colle l'entrée dans `RESTITUTIONS.md` avec son contexte. Aucun rush passé sous silence. point 4.
8. **Purger** : **le moteur le fait tout seul** (02/08) — `monte.mjs`, `vlog.mjs` et `facecam/render.mjs` appellent `purgeApresRendu()` (`store.mjs`) en dernier geste, et impriment une ligne **même quand rien n'est dû** ; `MONTAGE_NO_PURGE=1` désarme. La commande reste pour un balayage délibéré : **`node arbo.mjs --purge`** (dry-run) puis `--apply --purge`. **`--purge-journees`** (30/08) ÉTEND la rétention aux masters de `Journées/`, avec une lignée = **le JOUR** (`Montage JOUR 22-07 …`) : hors de ce flag explicite, `Journées/` n'est jamais touché, c'est la matière du final. Garde N et N-1 dans `Tests/`, **par LIGNÉE d'épisode = épisode × définition** (30/08 — un pool global avait jeté le master 1080p du #01 au rendu du #02) et **par LIGNÉE de master facecam = sujet × définition** (six villes = six lignées), met le reste à la **corbeille** (réversible), ne touche JAMAIS à `Journées/` ni `Éléments/`. Vider en plus `work/`, `projects/`, `critique/`.

**Où atterrit quoi** (le monteur 31/07 : « les rendus bruts vont dans Vidéos finies et pas un dossier de rush »). **Un dossier de rush ne contient que des rushes.** Tout ce que le moteur produit vit sous « Vidéos finies » : l'**épisode** à la racine (UN SEUL fichier, musique posée — `vlog.mjs` enchaîne la musique et supprime l'assemblage muet) · le **master de journée** dans `Journées/` · le **rendu de test daté** dans `Tests/` · la **pièce réutilisable** (générique de fin, carton, maquette) dans `Éléments/`. EDL, cartes json, backups → `.coulisses/`. Seule exception : le master facecam dérushé (`VLOG_…_v12.mp4`) reste dans « Facecam Rush », c'est une SOURCE du merge. `musique.mjs` pose son rendu **à côté de sa source**. Les chemins vivent dans **`store.mjs`** — aucun script ne doit en fabriquer un ; `node arbo.mjs` range dans les deux sens et dénonce le script qui dériverait.

## Le chemin LÉGER (efficience)
- **Sous une LUT, l'adaptatif est court-circuité** → zéro mesure couleur par plan (le plus rapide). le monteur aime les LUT.
- **`probe.mjs`** = l'outil de mesure permanent : NE PAS réécrire de script de mesure jetable, l'invoquer. Scoper (`node probe.mjs R07`) : sans argument il mesure les 34 plans (> 5 min).
- **Valider un changement de filtre** = une grille avant/après (extraire même frame, 2 looks, `hstack`), pas un rendu complet.
- Mesures **cachées** par fichier (measurePlate/plateWarmth/plateBrightZone) : gratuites au 2ᵉ appel dans un run.

## Fichiers moteur
| Fichier | Rôle |
|---|---|
| `monte.mjs` | Moteur : scope → catalogue → curation (plan.txt) → grade/LUT + adaptatif + hi/glow → concat → titre/musique. Le batch JOUR/NUIT de LOOK STUDIO est **verrouillé par SCÈNE** (bande de plans consécutifs séparés de ≤ 10 min de tournage, vote à la médiane) et non plus plan par plan — cf. STYLE §Verrou de scène. |
| `filters.mjs` | **Bibliothèque de filtres** (source unique couleur). Fonctions ci-dessous. |
| `brief.mjs` | **Brief de session** (lecture seule, instantané) : jour, look, qualité, plan.txt, **résumé etat.txt**, rendus N/N-1, catalogue. `node brief.mjs`. |
| `etat.mjs` | **État de batch persistant** (`Réglages/etat.txt`) : scope · décisions · en-attente · journal, pour la reprise. `node etat.mjs [log\|decision\|pending\|done "…"]`. |
| `arbo.mjs` | **Arborescence du store** : pose / répare / vérifie (dry-run par défaut, `--apply`, `--check`, `--store`). Cf. `ARBO.md`. |
| `revlog.mjs` | **Re-rendre un VLOG déjà monté sans toucher au montage** (recette de grade changée, épaule, filtre adaptatif) : reconstruit le `plan.txt` de chaque journée depuis `vlog/parts-<jour>.json` → master NU → **vérifie que tous les segments existent avant d'installer** → merge + musique → restaure les Réglages (même si ça casse). `node revlog.mjs [--dry] [--jours 15-07,19-07] [--no-merge]`. Automatise `VLOG.md` §4 ①→③. |
| `nus.mjs` | **AMORCER les manifestes d'un épisode NEUF** : rend en NU des journées déjà validées dont le plan de coupe ne vit plus que dans `projects/<stamp>/` (`Réglages/plan.txt` est écrasé à chaque jour, les 11 plans d'un lot n'existent donc plus comme réglage). Choisit par jour le projet le PLUS RÉCENT, puis CONTRÔLE ce choix : nombre de plans du plan archivé, rushs identiques (garde « R## = index, pas identifiant »), et **durée du nu == durée du master badgé à 0,5 s près**. Installe `vlog/parts-<JJ-MM>.json` en bloc ou rien. Restaure les Réglages même en cas d'échec. `node nus.mjs [--dry] [--jours 21-07,22-07]`. C'est le PRÉALABLE à `revlog.mjs`, qui lui suppose les manifestes existants. |
| `gate.py` | **LA GATE DE CLÔTURE d'un master**, mesurée et rejouable : définition · images == durée × fps EXACTEMENT · `avg_frame_rate` · `start_time` · dérive A/V · écart au plan · **synchro réelle par corrélation croisée** contre le son d'origine sur 7 fenêtres · LUFS / vrai pic / LRA · équilibre parole–image · fondu de sortie · décodage intégral. Décode le fichier EN ENTIER et tranche dans numpy — **aucune sonde de commodité** (trois fois sur ce projet, `-ss` avant `-i`, `astats reset=` et `volumedetect` ont FABRIQUÉ des pannes). `.venv-vision/bin/python gate.py "<master.mp4>" --ref-audio vlog/work/_raw_a.m4a --plan vlog/vlog.plan.json [--rapide]`. Sort 1 si la gate échoue. |
| `frame.mjs` | **Une image de preuve par son INDEX, sans décoder tout le film.** `select='eq(n,N)'` décode depuis le début — ~2 min pour l'image 23 400 d'un master 4K, et *une preuve qui coûte deux minutes se prend moins souvent qu'une preuve qui en coûte deux secondes*. Pose un `-ss` en amont, garde les timestamps (`-copyts`) et sélectionne au seuil **(N − 0,5)/fps** : la demi-image est ce qui évite de sortir l'image **N+1**, car le pts de l'image N vaut exactement N/fps et un seuil flottant tombe un cheveu au-dessus. **Lit le fps du fichier**, ne le suppose jamais. `--verifier` extrait AUSSI par la voie lente et compare les md5 — c'est ce contrôle qui a trouvé le décalage d'une image, que l'œil ne voyait pas. ⛔ Ne sert PAS à trouver une frontière de plan : ça reste `bornes.py`, qui s'interdit le seek. `node frame.mjs "<video.mp4>" <index> [--out f.png] [--marge 2] [--verifier]`. |
| `facecam/overlays/subs-blocs.mjs` | **UN ASS pour un film MIXTE landscape × facecam** : `subs.mjs` sous-titre UNE fenêtre et rend des timecodes RELATIFS à son t0 — le VLOG #01 n'en avait qu'une (le master facecam entier), le #02 en a **27 dispersées** dans 199 plans paysage muets. Lit les blocs `kind:"F"` de `vlog.plan.json`, transcrit chacun sur son AUDIO PROPRE (jamais sur le master, dont le lit musical dégrade whisper), DÉCALE de `+t0` et fond le tout. Trois gardes : aucun évènement hors de son bloc (un débord de whisper ≤ 0,5 s est **plafonné**, au-delà on s'arrête), en-têtes ASS identiques, **zéro chevauchement** (libass EMPILE, c'est ce qui avait fait re-brûler le v12 du #01). Aucune taille n'est passée : les défauts de `subs.mjs` SONT la convention du monteur, et rien ne se double pour le 4K. `node facecam/overlays/subs-blocs.mjs --plan vlog/vlog.plan.json --work vlog/work/subs02 --out film.ass [--lexique l.json] [--only F01,F03] [--force]`. |
| `facecam/overlays/subs-gate.mjs` | **Le sous-titre est-il DÉJÀ CONSOMMÉ quand il apparaît ?** — le contrôle qui manquait le 01/09, quand le monteur a vu « à 0:10 le sous-titre est déjà là et consommé alors que j'ai pas commencé à parler » sur un master dont TOUTE la chaîne était verte. Le défaut n'était pas dans les timecodes (allumage à 0,000 s du début du mot sur 1 094 mots mesurés) mais dans la façon de les CONSOMMER : `\k` bascule le mot en accent d'un coup au DÉBUT de sa prononciation, `\kf` le remplit pendant qu'il est dit. Mêmes timecodes → **aucune mesure de synchro ne peut les distinguer**. L'outil rend l'ASS sur un fond NOIR (plus de décor à démêler) et mesure la part d'accent parmi les pixels de glyphe à la **première** et à la **dernière** image de chaque début de bloc : quasi nulle puis quasi totale. Se prend **avant** le burn, en ~3 s. `node facecam/overlays/subs-gate.mjs film.ass [--n 10] [--seuil 12] [--fps 30]`. |
| `facecam/overlays/vad.py` | **OÙ LA VOIX COMMENCE VRAIMENT, mesuré sur le SIGNAL** — la seule référence de vérité, whisper ne datant pas le premier mot mais le collant au début du fichier. Énergie en bande **300-3400 Hz** (un RMS large ne distingue pas la voix de l'ambiance de rue), double seuil calé sur le SOMMET et non sur le plancher (un silence numérique fait s'effondrer un seuil calé sur le plancher). ⚠️ La remontée d'onset se fait sur une **DENSITÉ** (60 % d'occupation sur 0,2 s), pas sur une continuité : la continuité stricte s'arrête à la première plosive et date l'onset 0,5 à 1,6 s trop tard — deux faux « le sous-titre est en avance » qui ont fait recaler cinq blocs pour rien, dont un mis à 0,92 s de retard. Un trou de longueur fixe a été essayé et écarté : il laisse passer un claquement de rue isolé. `--valider` rejoue le test du décalage CONNU de 2,000 s. ⚠️ **`--tete` ne rend PAS un onset** (19/09) : il rend le plus long **SILENCE AVÉRÉ** devant la voix, et l'instant où ce creux finit. Un onset est toujours en retard et s'arrête sur une pause intra-phrase — 4 spans de l'EP3 ont été annoncés à 0,32-0,44 s de blanc alors que la voix y attaque à 0,00 s, avec un remède `a → a + air` qui aurait effacé leur premier mot. **`--souffle <wav> <t>`** rend le début de l'énoncé qui contient `t` (dernier creux avéré de 0,20 s) : c'est la borne d'élargissement du test « la borne `a` ampute la phrase », et c'est elle qui empêche d'entrer dans la fausse prise que `refine` a sautée. `python vad.py <a.wav> [b.wav…]` · `--iles` · `--tete` · `--souffle` · `--valider` · `--valider-air`. |
| `facecam/overlays/vad-cas.mjs` | **LES CAS CONNUS DE `--tete`, REJOUABLES** — la mesure du blanc de tête a été refaite trois fois en trois jours, et chaque version s'est déclarée juste avant d'être réfutée. Cet outil fabrique ses cas à partir d'un span PROPRE du master courant (2,000 s de silence numérique · 0,900 s de silence · un blip de 0,10 s suivi de 1,500 s de rien) et vérifie les deux sens : ce qui doit **crier**, et ce qui doit rester **muet** — *un cas qui ne crie pas ne prouve rien*. `node facecam/overlays/vad-cas.mjs [--master <facecam.mp4>]`. |
| `facecam/plans/*.json` | **LES PLANS DE BURN, DANS LE REPO** (01/09) — ils décrivent ce qui est brûlé sur un master (overlays, positions, sous-titres, réserves du garde) et vivaient dans le store, donc hors de toute sauvegarde et de tout historique. Trois formes de chemin, dans cet ordre : **`store:<…>`** résolu contre `STORE` (store.mjs) — la seule façon de désigner un fichier du store sans disperser un `path.join(STORE,…)` de plus, et ce qui rend le plan juste sur une machine où `MONTAGE_STORE` diffère ; **relatif** résolu contre le dossier du plan, donc contre le repo (le `.ass` livré, les polices, `vlog.plan.json`) ; **absolu**, toléré mais à proscrire dans un plan versionné. Les PNG (`frames`, 527 Mo) restent dans le store : ils se refabriquent par `--capture`. Déplacement prouvé par l'invariant qui compte — la commande ffmpeg produite est **identique au caractère près** avant et après, y compris une fois les anciens fichiers supprimés du store. |
| `facecam/overlays/subs-controle.mjs` | **LE GARDE QUI EMPÊCHE DE RE-LIVRER LE DÉFAUT** — appelé AUTOMATIQUEMENT par `burn.mjs` dès qu'un plan porte des sous-titres, et **bloquant**. Existe parce que le monteur a signalé DEUX fois « le sous-titre est déjà là et consommé » sur un master dont toute la chaîne était verte : chaque contrôle avait raison sur SA dimension, personne ne regardait la façon de CONSOMMER les timecodes ni l'ANCRAGE sur la voix. Quatre dimensions — **TAG** (`\kf`, jamais `\k`) · **PLANCHER** (1er mot ≥ 0,10 s : un `\kf` de 0,01 s se remplit en une image, donc se lit comme un `\k`) · **VOIX** (avance mesurée au SIGNAL par `vad.py`, jamais lue dans la transcription) · **RENDU** (part d'accent à la 1re image, via `subs-gate.mjs --json`). Une dimension non mesurable est annoncée **NON MESURÉE** et fait échouer : *un garde silencieux est indiscernable d'un garde débranché*, et c'est ce qui interdit de le contourner par omission. Les réserves connues se DÉCLARENT avec leur valeur maximale (`--tolere-avance F03:1.02`, `--tolere-accent 4:07.19`) : non listée elle bloque, listée mais qui EMPIRE elle bloque aussi. Éprouvé dans les deux sens — 4/4 dimensions rouges sur l'ASS d'avant les correctifs, 4/4 vertes sur celui livré. `node facecam/overlays/subs-controle.mjs <film.ass> [--plan …] [--work …] [--tolere-avance F03:1.02] [--sans-rendu] [--souple]`. |
| `facecam/overlays/subs-recale.mjs` | **LE TEXTE D'UN CÔTÉ, L'HORLOGE DE L'AUTRE** — répare un ASS dont les sous-titres APPARAISSENT AVANT LA VOIX, sans jamais toucher au texte. Cause (prouvée dans `vad.py`) : whisper ne DATE pas le premier mot, il le COLLE au début du fichier et étale le texte sur la durée disponible ; sur le #02, 9 blocs sur 27 en avance, jusqu'à **2,64 s** sur F01 — l'instant exact que le monteur a signalé à 0:10. Deux corrections ont été essayées et RÉFUTÉES par la mesure : le décalage global (faux — les silences de whisper tombent déjà pile au milieu du bloc, l'erreur est locale à la tête) et la re-transcription sur audio rogné (l'horloge devient juste, mais whisper re-décode : 8 blocs sur 9 abîmés, 22 mots nets perdus). Celui-ci APPARIE les deux suites de mots (LCS) et donne au texte livré les temps de son jumeau rogné ; un mot sans jumeau est interpolé, un bloc apparié à moins de 70 % est REFUSÉ et garde ses temps. Pose aussi le **plancher de remplissage** (`KF_MIN_CS`, 0,10 s sur le 1er mot, repris sur les suivants : un `\kf` de 0,01 s se lit comme un `\k`). Trois gardes sur l'ARTEFACT ÉCRIT, jamais sur un état de passage : texte identique mot à mot, zéro chevauchement, bornes de bloc tenues. **Plusieurs donneurs, un choix par BLOC** : `--recale a,b,c` accepte une liste (un dossier par air de rognage) et retient, pour chaque bloc, celui que la mesure désigne — ordre écrit avant d'être codé : ① ne pas partir avant la voix ② le plus synchrone ③ le mieux apparié. La tête non appariée se **comprime entre l'attaque de la voix et le 1er mot apparié** au lieu de s'extrapoler (sinon elle sort du bloc et l'ASS est clampé : F03 restait à +0,99 s malgré 100 % d'appariement). Un **ancrage de secours** force le 1er mot sur la voix quand aucun donneur n'y arrive, mais **se refuse lui-même** s'il devait tasser les mots sous le plancher (F23 : 9 mots pour 0,03 s). Mesuré sur le #02 : 10 blocs en avance → **2**. `node facecam/overlays/subs-recale.mjs --film f.ass --plan vlog/vlog.plan.json --livre <dir> --recale <d1,d2,d3> --wav <dir> --out o.ass [--only F01,F03] [--dry]`. |
| `facecam/overlays/generique-mp4.mjs` | **Générique de fin, de la spec au MP4** en une commande (spec → HTML → capture → mp4 à piste muette). `node facecam/overlays/generique-mp4.mjs vlog/generique-01.json --out "…/Éléments/… .mp4" [--dsf 2]`. |
| `miniature.mjs` | **La vignette d'un épisode** (image fixe 4K, pas une vidéo) : extrait une frame du **master** (donc déjà gradée — un rush brut donnerait une vignette qui ne ressemble pas au film ; `--brut` force quand même), **mesure** la bande la plus calme (densité de contours), **mesure** la largeur réelle du texte rendu (Bebas est condensée : l'estimer, c'est livrer un titre à 40 % ou 110 % du cadre) accepte un titre **multi-ligne** (`--titre "SUD DE|LA CHINE"`, pas vertical réglable par `--interligne`) — chaque ligne a son propre `drawtext` recentré, car un `drawtext` unique à `\n` aligne les lignes À GAUCHE, et c'est la ligne la **plus large** qui fixe le corps ; puis grave le titre dans la **typo du carton de ville** — Bebas Neue accent `#F5F5F5`, ombre portée au prorata, idéogrammes PingFang. Rend le **contraste sous le texte** (part du fond plus claire que l'accent, seuil ~15 % comme le carton) ; `--scrim` ajoute un voile quand la mesure le réclame. Livre le 4K **et** le 1280×720 que YouTube demande à l'upload, dans `Éléments/`. `node miniature.mjs "<master.mp4>" --t 0.30 --titre "Shanghai" [--hanzi 上海] [--pos auto\|haut\|centre\|bas] [--largeur 0.62] [--scrim] [--dry]`. |
| `toc.mjs` | Régénère la **TOC de STYLE.md** (numéros de ligne réels) dans cet INDEX. `node toc.mjs [--check]` — à lancer après toute édition de STYLE.md. |
| `pack.mjs` | **Pack visuel** en une commande (planches + pellicules + curate + proof-grid) → `work/pack/MANIFEST.md`. `node pack.mjs [pas] [--no-strips\|--no-curate\|--no-proof\|--render "…mp4"]`. |
| `probe.mjs` | Mesure par plan (chaleur globale/région, dorure, doses, SATAVG/YAVG/YLOW, look actif). `node probe.mjs [R##…]`. |
| `musique.mjs` | **Workflow musique** (hors moteur) : `analyze` · `apply "<mp4>" --track <nom> --in <mm:ss> [--mode]` · **`plan "<vlog.mp4>"`** (carte MULTI-PISTES auto) · **`plan --structure vlog/vlog.plan.json`** (timeline mixte : cues snappés sur les ruptures + grille fine de niveaux). Depuis le 30/07 : par bande paysage, **tête muette puis queue sonore** (plus d'alternance une bande sur deux) · plan marqué `PARLE` dans l'EDL → niveau `voix` · **cues beat désactivés par défaut** (`--beat` pour en remettre) · fondu de sortie étalé sur la bande paysage de clôture. Doctrine complète : `MUSIQUE.md`. |
| `lecture.mjs` | **Fiche de lecture du jour** (`Réglages/lecture-<jour>.md`) : un bloc par rush — montre / évolue / durée et pourquoi / décision. Instantané, n'écrase pas un fichier rempli (`--force`). À remplir AVANT `plan.txt` (STYLE §LA DA DES VLOG). |
| `curate.mjs` | **Assistant curation** : pré-tri mesuré (keep-range de queue gratuite + doublons perceptuels) → `catalogue/curation.md`. Ne décide pas. `node curate.mjs [R##…]`. |
| `restitution.mjs` | **Génère le tableau de restitution** du jour scopé depuis `plan.txt` + ffprobe : une ligne par rush, décision déduite, durées et bilan MESURÉS, « pourquoi » pré-rempli avec le commentaire de `plan.txt`. Signale les lignes sans raison écrite. **Il imprime, il n'écrit pas dans `RESTITUTIONS.md`** — l'entrée reste un texte argumenté. `node restitution.mjs [--nu]`. |
| `make-luts.mjs` | Génère les LUT `.cube` filmiques par calcul (offline) dans `Réglages/LUTs/`. Dosage à l'application (`lut.txt = nom 0.6`). |
| `bornes.py` | **Relève les FRONTIÈRES de plans d'un rendu BROUILLON**, image par image (masque du jaune du badge `R##`, aucun seek). C'est ce qui convertit une consigne du monteur lue sur le TIMECODE GRAVÉ (« R13 finit à 29:00 ») en fenêtre source : `borne = in_actuel + (TC_consigne − début_du_plan)`. ⚠️ **Ne JAMAIS mesurer une frontière avec `ffmpeg -ss <t>`** — le seek retombe sur une keyframe et le `pts` affiché ne correspond plus à l'image rendue (30/08 : `R24` montré 0,4 s après sa fin, bornes justes failli être « corrigées »). Les valeurs ISOLÉES de la sortie sont les frontières ; les rafales à 1/30 s sont le fond qui transparaît sous la boîte du badge. `.venv-vision/bin/python bornes.py "<rendu.mp4>"` |
| `catalogue.mjs` | Indexe un jour → `R##` + planches-contact. `filmstrip.mjs` → pellicules internes. ⚠️ **Il VIDE `catalogue/` d'abord** : re-scoper un jour efface les pellicules, `curation.md` et les planches du jour précédent. Ce qu'on veut garder se copie ailleurs AVANT. |
| `numeroter.mjs` | **Préfixe R## dans le NOM** des rushes du jour actif (le badge se retrouve dans le Finder). Idempotent : appelé à chaque rendu par `monte.mjs`, ne renomme que les écarts. `node numeroter.mjs [--dry]`. |
| `generise.mjs` | **Produit le dépôt PUBLIC** à partir de celui-ci, par transformation reproductible. Le périmètre est dérivé de `capacites.json` (`public:true`), pas d'une seconde liste ; les données personnelles sont écartées ; le nom de l'auteur est remplacé. `--dry` montre l'arbre, `--out <d>` écrit, `--check <d>` refuse un dépôt qui fuit, `--self-test` prouve que la garde sait voir une fuite. Après écriture il **lance la garde du dépôt généré** : ne pas fuiter ne suffit pas, il doit marcher. |
| `profil/defaut.json` + `profil.mjs` | **Ce qui appartient à celui qui monte** : couleur d'accent, polices, look par défaut, préférences sonores, trame d'épisode, rétention. L'accent est déclaré UNE fois (`#F5F5F5`) et le moteur en dérive les trois écritures — CSS, ffmpeg `0xRRGGBB`, ASS `&HAABBGGRR` (inversé, c'est la conversion qui se ratait à la main). `MONTAGE_PROFIL=<chemin.json>` en choisit un autre. `node profil.mjs` affiche le profil actif. |
| `capacites.json` | **LA source des compétences** : 49 entrées (titre, déclencheurs, commande, chaîne de scripts, prérequis, doc, gate). Trois consommateurs la lisent, aucun n'en tient de copie. Éditer ICI, jamais ailleurs. |
| `capacites.mjs` | Les trois rendus GÉNÉRÉS + la garde. `node capacites.mjs` → la liste lisible · `--chaine A` → une seule famille · `--json` → ce que sert la Bande de montage (prérequis mesurés sur CETTE machine) · `--skill` → réécrit la table de routage de `SKILL.md` entre balises · `--check` → sortie 1 si un script est absent, un doc mort, un script orphelin, un binaire non déclaré · `--self-test` → contrôle POSITIF : injecte 7 défauts et exige que la garde les voie. |
| `visionneuse.mjs` | **Bande de montage ÉDITABLE** (serveur local :8765) : planche R## + rendu jouable + tête de lecture. Glisser=sélection, clic droit=couper/supprimer, Undo + **Sauvegarder** (écrit `plan.txt`, préserve les commentaires). Coupes en attente dans `Réglages/marques.txt`. **Bouton 🧰 Compétences** (ou la touche `?`) → le catalogue complet, filtrable, commande copiable au clic, grisée si un binaire manque sur la machine — servi par `/capacites` depuis `capacites.json`. `node visionneuse.mjs [--open]`. |
| `~/Movies/Montage/Bande de montage.app` | **App desktop** double-cliquable → lance le serveur + ouvre la visionneuse en fenêtre-app Chrome dédiée. `open "~/Movies/Montage/Bande de montage.app"`. |
| `facecam/fusion.mjs` | **Souder N rendus facecam de ville en UN master + le `sujets.json` global**. Version surchargeable PAR VILLE (`Yangshuo:8`) : corriger une borne ne doit pas obliger à re-rendre les cinq autres. Mesure aussi l'HORLOGE du master (écart index↔pts, reculs de pts) — les trois contrôles historiques (images, dérive A/V, `start_time`) étaient tous verts sur un master pourtant indécoupable à la seconde (cf. `VLOG.md` §6-bis). `vlog.mjs` ne lit qu'une ligne `FACECAM` et des bornes en secondes ABSOLUES ; un lot rendu ville par ville (6 mp4 + 6 `.spans.json`) n'y entre pas tel quel. Re-mux MPEG-TS + `duration` explicite dérivée du COMPTE D'IMAGES, audio recadré à la durée vidéo de chaque ville (les 3 pièges de concat de `vlog.mjs` §5 sont les mêmes ici : ces fichiers ont `has_b_frames=2` et `start_time=0,021`). Refuse un `.spans.json` périmé et une borne hors du fichier. `node facecam/fusion.mjs [--v 7] [--out …mp4] [--sujets vlog/sujets-02.json] [--dry] Xiamen Shenzhen Macao HongKong Guangzhou Yangshuo`. |
| `facecam/sujets.mjs` | **Ré-adresser la table des sujets d'un master rendu D'UN SEUL TENANT**. `fusion.mjs` écrit cette table quand le master est soudé de plusieurs morceaux ; quand il sort d'un seul `render.mjs`, personne — et le geste se faisait à la main, donc il fallait le réinventer dès qu'une borne de l'EDL bougeait (*une chaîne qu'on ne peut pas rejouer n'est pas une chaîne*). La **ville** n'est pas dans le manifeste de spans : elle est reprise **par LABEL** depuis la table précédente, jamais par rang, et l'outil REFUSE si un label n'a pas de ville (un champ vide ferait tomber le carton au mauvais endroit). Gardes : contiguïté 0 ms sur tous les spans + somme des bornes = durée du master. `node facecam/sujets.mjs <master.spans.json> --villes <ancien-sujets.json> --out <sujets.json> [--dry]`. |
| `facecam/` | Module dérushage talking-head (`map` → `subjects` → `pick` → EDL → `refine` → `render`). Cf. `facecam/README.md`. |
| `vlog.mjs` | **Montage MERGÉ landscape × facecam** (découpe le facecam par **INDEX D'IMAGE**, jamais en secondes : le master soudé est VFR et ses pts reculent aux jonctions de ville — `VLOG.md` §6-bis ; le nom du bloc en cache porte la fenêtre d'images ET une empreinte du master) : lit `Réglages/vlog.txt` (bandes `L` / blocs `F` / lignes `PARLE` et `CARTON`), recolle les segments EXACTS des jours (manifestes `vlog/parts-<jour>.json`), découpe le facecam aux frontières de sujets (`vlog/sujets.json`), concatène **sans dérive A/V** (timestamps remis à zéro, audio recadré à la durée vidéo de chaque morceau — cf. §5 du fichier), regrave badges renumérotés + timecode, **brûle les cartons de ville** (`CARTON R001 SHANGHAI 上海` → Bebas Neue 150 px accent centré, fondu 0,45 s ; un par ville, sur le 1ᵉʳ plan qui y arrive), écrit `vlog/vlog.plan.json`. Affiche la **dérive A/V mesurée** en fin de concat : au-delà de 100 ms il ne faut pas livrer. `node vlog.mjs [--dry] [--plan …] [--nu]`. **Rend UN SEUL fichier** : il enchaîne `musique.mjs plan --structure` et supprime l'assemblage muet intermédiaire (le monteur 30/07) ; `--nu` s'arrête avant la musique, pour déboguer. **Obéit à `Réglages/qualite.txt`** (31/07) : `final` → libx264 CRF 16 preset slow **et AUCUN repère gravé** (les cartons de ville, eux, font partie du film et restent) ; `reperes.txt`=`off` éteint les repères sans passer en final. **`GENERIQUE <fichier>`** dans l'EDL greffe le générique de fin comme un **plan** de la timeline (badge `GEN`) — donc concaténé sans dérive A/V, pas collé après coup — et **`OUTRO <s>`** impose la durée du fondu musical pour qu'il meure SUR lui. Doctrine : **`VLOG.md`**. |
| `vlog-restitution.mjs` | Tableau de restitution d'un montage mergé (une ligne par bloc) depuis `vlog/vlog.plan.json`. |
| `cache/` (dans monte.mjs) | **Rendu incrémental** : segments par plan mis en cache tant que rush+ranges+grade+badge+qualité ne changent pas. Purge auto au-delà de ~4 Go. Invalider : bump `CACHE_VER`. |
| `highlights.mjs` | Mesure `clip%`/`bloom%` (indicatif, le vrai repérage hi/glow reste à l'œil). |
| `critique.mjs` | Sonde qualité d'un rendu (planche, cuts, signals) — cf. `CRITIQUE.md` (procédure) et `AMELIORATION.md` (grille + journal). |

### filters.mjs — fonctions
- **Mesure** : `measurePlate` (signalstats YUV : Y*/SAT*), `plateWarmth` (R−B global, scale 1:1), `plateBrightZone` (chaleur+satu zone brillante top-luma).
- **Adaptatifs** (auto, mesure→règle, gate) : `adaptiveWarmth` (région-driven, gate DORURE=warmth×satu), `adaptiveSaturation` (boost ternes gaté chaleur / calme criards), `adaptiveBlackpoint` (relève plancher laiteux), `adaptiveExposure` (**OFF** : laverait la nuit). `adaptiveColor(file)` = la chaîne assemblée (court-circuitée sous LUT).
- **Flag (plan.txt)** : `hiTame` (`hi`/`hi2`), `deBloom` (`glow`).
- **LOOKS** = catalogue de réglages classiques dosables (brightness…filmLut) pour manuel/futures DA.

## Déplacer la stack — trois variables, aucun code à toucher

Le moteur et la matière se déplacent séparément (machine neuve, disque externe pour les rushs,
clone de test). Rien de déclaré = comportement historique, à l'identique.

| Variable | Ce qu'elle déplace | Repli |
|---|---|---|
| `MONTAGE_HOME` | le moteur (code, doctrine, `models/`) | le dossier du script lancé |
| `MONTAGE_STORE` | la matière (rushs, rendus, `Réglages/`) | `~/Movies/Montage` |
| `MONTAGE_MODELS` | les modèles de transcription seuls | `<moteur>/models` |
| `MONTAGE_PROFIL` | l'identité visuelle et les préférences | `profil/defaut.json` |

⚠️ Sept scripts importaient `store.mjs` **et** redéfinissaient `STORE` en dur juste en dessous :
poser `MONTAGE_STORE` déplaçait la moitié des chemins et pas l'autre. Le doublon est supprimé —
un chemin du store se lit dans `store.mjs`, jamais recalculé sur place.

## Réglages (`~/Movies/Montage/Réglages/`)
`plan.txt` (plan de coupe curé — **prioritaire**) · `DA.txt` (look+rythme) · `lut.txt` (LUT drop-in `nom [intensité]`, prime sur DA) ·
`qualite.txt` (brouillon|final) · `definition.txt` (1080|2160) · `jour.txt` (scope) · `couper.txt`/`ramp.txt` (intro d'un plan) · `exclure.txt` ·
`marques.txt` (coupes en attente de la visionneuse) · `etat.txt` (fil de session) · `LUTs/*.cube` · `grade.txt` (toggle manuel legacy).
Musique : un fichier dans `Musiques/` → lit auto sous l'ambiance.
**Montage mergé** (cf. `VLOG.md`) : `reperes.txt` = `off` → master de jour **NU** (ni badge R##, ni
timecode) même en brouillon · `musique.txt` = `off` → aucun lit musical côté moteur (la musique se
pose après, sur la timeline finale) · `vlog.txt` = l'EDL d'entrelacement lu par `vlog.mjs`.
**MASTER PUBLIABLE** (31/07) : `qualite.txt` = `final` puis **`node revlog.mjs`** — il re-rend les
journées ET relance le merge, donc les segments du cache passent eux aussi en CRF 16 (`q` est dans
la clé de cache : un `final` posé au seul étage vlog resservirait des segments brouillon). Le master
sort sans badge ni timecode. **Remettre `qualite.txt` = `brouillon` après** : `revlog.mjs` sauvegarde
`jour/plan/reperes/musique` mais PAS la qualité.
**DÉFINITION 4K** (31/07) : `definition.txt` = `2160` → tout le pipeline sort en **3840×2160**
(`monte.mjs`, `vlog.mjs`, `facecam/render.mjs`, `overlays/capture.mjs --dsf`). Défaut `1080` = la
définition de TRAVAIL, celle qui rend une itération en minutes. Les rushs sont en 4K (sauf 15-16/07,
carrés 3072² → crop 16:9 = 3072×1728, encore au-dessus du 1080p) : le 1080p était un choix du
pipeline, pas une limite de la matière. Trois choses à savoir :
- la définition est **dans la clé de cache** des segments (`def`, posé seulement à 2160) et dans le
  **nom** des blocs facecam (`_4k`) — sinon un rendu 4K resservirait du 1080p **en silence** ;
- le plafond de cache est monté à **12 Go** (97 segments 4K ≈ 3 Go, la purge se déclencherait pendant le run) ;
- en final, le preset x264 passe à **`medium` à 2160** (mesuré : `slow` coûte 1,7× le temps pour
  +0,08 dB de PSNR et le même poids) ;
- l'EDL accepte des **surcharges par définition** — `FACECAM_2160`, `GENERIQUE_2160`, `OUT_2160` —
  lues seulement quand `definition.txt` = 2160 : le master 1080p de référence ne peut pas être écrasé.
**Remettre `definition.txt` = `1080` après**, comme la qualité : `revlog.mjs` ne la restaure pas.

## Looks disponibles
- **LOOK STUDIO** (défaut) — grade codé + chaîne adaptative. **Batch JOUR/NUIT auto** (18/07), **verrouillé par SCÈNE** depuis le 31/07 (bande de plans consécutifs ≤ 10 min de tournage, vote à la médiane) : YAVG > 90 → batch JOUR, sinon batch NUIT chaud noirs profonds. Le batch JOUR est **jauni doux + léger contraste** depuis le 31/07 (variante A2 : ambre dans les ombres/mediums, **hautes lumières laissées bleues pour ne pas verdir le ciel**, genou 0,9→0,81). Cf. STYLE §Hautes lumières / §Verrou de scène.
- **LUT** (`DA.txt` = `nuit cine` / `cine teal orange` / `kodak warm`, ou `lut.txt`) — cf. STYLE §LUT filmiques.
  `nuit_cine` = recommandé nuit (noirs profonds, néons punchy). Drop-in : toute `.cube` déposée marche.
  **Dosage** : `lut.txt = nuit_cine 0.6` (mélange vers l'identité ; 0.6 lit plus naturel qu'à fond).

## STYLE.md — où sauter (TOC générée, numéros de ligne FIABLES)
<!-- TOC:STYLE -->
_Généré par `node toc.mjs` — ne pas éditer à la main. 20 sections, STYLE.md = 485 lignes._
_Usage : `Read STYLE.md offset=<ligne> limit=60` — **jamais** le fichier entier._

| Ouvrir STYLE §… | pour… | ligne |
|---|---|---|
| **Sommaire** |  | 3 |
| **⭐ Étalonnage et curation** | ce qui se COUPE à l'œil (tilts, va-et-vient, dutch, sujets coupés) | 19 |
| Curation « récit intelligent » | ce qui se COUPE à l'œil (tilts, va-et-vient, dutch, sujets coupés) | 21 |
| Hautes lumières trop intenses | dompter façade/bateau lavé (courbe S, flag `hi`) | 70 |
| VERROU DE SCÈNE sur le batch JOUR/NUIT |  | 108 |
| Filtre ADAPTATIF à la palette | principe du warmth adaptatif (région-driven) | 155 |
| Saturation ADAPTATIVE | boost des plans ternes, gaté par la chaleur | 173 |
| Anti-bloom / bruit de lumière autour des émetteurs | resserrer les halos néon (flag `glow`) | 193 |
| **Directions Artistiques** | table des looks sélectionnables | 206 |
| LUT filmiques `.cube` | générer / sélectionner / doser une LUT, court-circuit adaptatif | 228 |
| Lit musical sous l'ambiance (`Musique (optionnel)/`, terrain… | musique sous l'ambiance côté moteur (cf. MUSIQUE.md pour musique.mjs) | 247 |
| Cut d'intro sec | `couper.txt` — l'alternative sèche au ramp | 255 |
| Speed-ramp d'intro « retour sur terre » | `ramp.txt` — intro « retour sur terre » | 260 |
| Détection fixe / mouvement | `motionScore`, seuil et cap | 274 |
| Deux niveaux de rendu | `qualite.txt` = brouillon \| final | 282 |
| La purge de cache effaçait le NEUF et gardait le PÉRIMÉ |  | 294 |
| **Recadrage sujet-aware** | crop 16:9 auto sur formats mélangés | 309 |
| **Playbook opérateur** | ⭐ procédure autonome complète (8 étapes détaillées) | 323 |
| **Bibliothèque de filtres** | doctrine de filters.mjs | 390 |
| **Roadmap — filtres ADAPTATIFS à développer + outils…** | crans faits / à venir + verdicts (expo, denoise, deband, LUT) | 415 |
<!-- /TOC:STYLE -->

## Règles de sélection (18/07 — cf. STYLE §Curation)
- **Rush selfie/parlé : PAS exclu par défaut** (contenu vlog légitime). Exclusion = demande explicite du monteur pour un montage donné → alors rush ENTIER (jamais repêcher sa fenêtre « décor », piège R22/R23). Ne pas pré-exclure les parlés d'un nouveau jour.
- **Mouvement : la règle DÉCISIVE (plan mouvement = TENU) PRIME.** `curate.mjs` mesure un **RATIO invariant jour/nuit** (mouvement temporel ÷ détail spatial ×100, plafond `RATIO_STRONG=70`) — il ne flague QUE le pano vraiment trop rapide (16/07 : marche/holds 20-57 passent, seuls balayages ~83 flaggés). Ne JAMAIS s'en servir pour recouper en masse à 2-3 s ni jeter un jour (leçon 40→5, 18/07). L'ancien seuil brut « méd 24 » (calibré nuit) sur-flaguait le jour → supprimé.
- **Non-B-roll perso** (téléphone/menu/voiture, plan **utilitaire** : écran, panneau, bouton) hors montage d'ambiance. ⚠️ **La nourriture en sort (29/07)** : un plat CADRÉ est un plan de vlog légitime (jour 20 R15, gardé par le monteur).
- **SÉRIE ≠ redondance (29/07)** : plusieurs plans d'un même motif (6× le paysage vu du train, 4× la contre-plongée de façade) = une série assumée, **tout se garde**. Le doublon SÉMANTIQUE fait raccourcir, jamais couper — seul le doublon de PRISE (même plan refilmé) est un motif de cut.
- **Plafond 7 s (29/07)** : ce n'est pas un plafond, c'est le seuil au-delà duquel il faut une **intention nommée** (jour 20 R16 11,3 s / R17 8,7 s : « montrer l'ampleur du nombre de building »).
- **Déclenchement ACCIDENTEL (20/07)** : rush < 1,0 s (`MIN_SHOT_PERCEPTIBLE`) = erreur de record imperceptible → **écarté AUTO** par `monte.mjs` en mode auto (sauté si plan.txt curé) ; `curate.mjs` le NOMME (⛔ REJET). Ex. jour 20 : R01 0,30 s / R02 0,37 s.
- **Cramé-pâle (20/07)** : `curate.mjs` mesure une charge « clair + PÂLE » (ciel/surface lavée ≠ néon) → recommande `hi`/`hi2`. Le blanc DIFFUS de plein jour est dompté en amont par l'**épaule des hautes lumières du grade JOUR** (dosage « légère » validé le monteur). Cf. STYLE §Hautes lumières.

## Backlog / pistes (non fait — décider avant de coder)
- **Compare N vs N-1** : grille côte-à-côte des 2 derniers rendus à quelques timecodes, pour juger une itération vite (complète `critique.mjs` / `pack.mjs`).

_(Faits 18/07 : **état de batch** → `etat.mjs` + `brief.mjs` · **pack visuel** → `pack.mjs` · **flag MOUVEMENT normalisé (RATIO invariant, plafond 70)** dans `curate.mjs` · **re-curation généreuse 16/07** 35/40 rushes tenus, voix conservée (corrige le jet 40→5).)_
