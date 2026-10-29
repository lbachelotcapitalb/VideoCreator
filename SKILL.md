---
name: videocreator
description: Stack de montage vidéo 100 % locale et hors ligne (ffmpeg + whisper.cpp) : dérushage de rushs parlés qui coupe les vides, les faux départs et les « euh » ; bande de montage éditable dans le navigateur ; sous-titres karaoké calés sur la voix ; overlays animés (carte, itinéraire, schéma, vignette de chiffre) ; montage de journée, étalonnage, musique. Utilise-le quand on dit « dérushe mes rushs », « monte cette journée », « coupe les vides », « mets des sous-titres », « habille la vidéo », « ouvre la bande de montage », « change le look », « critique ce montage », ou quand il faut savoir ce que la stack sait faire (`node capacites.mjs`). Rien ne quitte la machine : aucun appel réseau dans le pipeline.
---

# videocreator — orchestrateur de la stack montage

**Ce fichier est un ROUTEUR, pas un manuel.** Il tient dans un coup d'œil : réflexe d'ouverture,
table de routage, garde-fous. Tout le détail vit dans des fichiers voisins qu'on n'ouvre **que**
pour la tâche du moment (§Carte des docs, en bas). Ne jamais tout charger « pour voir ».

- **Moteur** = `~/Library/Application Support/Montage/` (repo git `VideoCreator`) · **Store** = `~/Movies/Montage/`.
- Le repo **EST** le skill (`~/.claude/skills/videocreator` = symlink) : code, doctrine et ce fichier voyagent ensemble.
- **100 % local/offline** (le Mac voyage en Chine, VPN coupé) : aucun rush/transcript/rendu ne quitte la machine,
  aucun appel réseau dans le pipeline. Les binaires (ffmpeg, whisper.cpp, aubio) viennent de brew, pas du repo.

## 1. Réflexe d'ouverture (30 s)

1. **PATH dans TOUTE commande** node/ffmpeg, sinon whisper/ffmpeg introuvables :
   `PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/sbin:/usr/sbin" node …`
2. `node brief.mjs` → jour, look, `plan.txt`, dernier rendu, résumé de l'état de batch. **Suffit** pour savoir où on en est.
3. Consigner au fil de l'eau : `node etat.mjs log|decision|pending|done "…"` — c'est le handoff du montage,
   il survit à un `/clear`. Le lire = `node etat.mjs`.
4. Ouvrir un doc **seulement** si la ligne de routage ci-dessous le dit.

## 2. Routage — ce que le monteur demande → ce que tu lances

**Cette table est GÉNÉRÉE** depuis `capacites.json` par `node capacites.mjs --skill`. C'est la
MÊME source que le panneau « Compétences » de la Bande de montage et que la réponse à « qu'est-ce
que tu sais faire ? » (`node capacites.mjs`). Ne jamais l'éditer à la main : l'édition se fait dans
`capacites.json`, puis on régénère. `node capacites.mjs --check` refuse un manifeste qui a dérivé
du code (script absent, doc morte, prérequis non déclaré, script orphelin).

<!-- CAPACITES:TABLE -->

<!-- GÉNÉRÉ par `node capacites.mjs --skill` depuis capacites.json — NE PAS ÉDITER À LA MAIN -->

### A · Parole — dérusher des rushs parlés, couper les vides

| le monteur dit… | Tu lances | Ce que ça rend | Doc |
|---|---|---|---|
| « dérushe mes facecam » · « merge mes prises parlées » · « coupe les vides » | `node facecam/map.mjs "<dossierRushs>"` 🛑 facecam/parole.mjs | un master .mp4 serré + son EDL .json | facecam/README.md |
| « qu'est-ce que je dis dans ces rushs » · « carte de mes prises » · « transcris mes rushs » | `node facecam/map.mjs "<dossierRushs>" [--gap 1.2] [--min 0.7]` | carte .json : un îlot de parole = un texte + un timecode | facecam/README.md |
| « quels sujets j'ai traités » · « j'ai refait des prises » · « regroupe mes reprises » | `node facecam/subjects.mjs` | carte des sujets : chaque sujet, toutes ses occurrences, une meilleure provisoire | facecam/README.md |
| « quelle prise garder » · « la meilleure version de ce sujet » · « choisis mes prises » | `node facecam/pick.mjs` | une étoile motivée par sujet + le détail des scores | facecam/README.md |
| « serre mes bornes » · « il reste du blanc au début » · « affine les coupes » | `node facecam/refine.mjs <edl.json>` | le même EDL, bornes affinées sur la parole | facecam/README.md |
| « j'ai bafouillé » · « je me suis repris » · « coupe mes faux départs » | `node facecam/relances.mjs --apply` | le même EDL, relances retirées | facecam/README.md |
| « il reste une scorie » · « un mot est mangé en queue » · « cette coupe tombe mal » | `node facecam/sweep.mjs --span <id> [--borne b] [--sens dehors]` | un tableau de candidats mesures pour cette borne | facecam/README.md |
| « c'est prêt à rendre » · « contrôle mon EDL » · « vérifie avant rendu » | `node facecam/joins.mjs <edl.json> && node facecam/coherence.mjs <edl.json>` | deux rapports d'alertes a arbitrer | facecam/README.md |
| « mes plans n'ont pas la même lumière » · « ça saute en luminosité » · « équilibre l'image » | `node facecam/lumieres.mjs --apply` | un réglage de lumière par span, mesure | facecam/README.md |
| « rends le montage » · « fabrique le master » · « sors la vidéo » | `node facecam/render.mjs <edl.json> [--def 1080|2160] [--out <fichier.mp4>]` 🛑 facecam/parole.mjs, lance par le rendu lui-même | un master .mp4 + son .spans.json | facecam/README.md |
| « c'est trop serré » · « ça respire pas assez » · « serre plus » | `node facecam/render.mjs <edl.json> --serrement serre` 🛑 facecam/parole.mjs | le rendu, et la ligne de preuve qui dit quel palier a servi | facecam/README.md |
| « est-ce qu'il reste des scories » · « prouve que le master est propre » | `node facecam/parole.mjs <master.mp4>` | un verdict par span ; sortie non nulle si un défaut subsiste | facecam/README.md |
| « je me répète » · « j'ai dit ça deux fois » · « distille mon propos » | `node facecam/distill.mjs` | groupes d'idées redondantes + apports isolables | facecam/README.md |
| « colle mes rendus » · « un seul fichier à partir de mes morceaux » | `node facecam/fusion.mjs <rendu1.mp4> <rendu2.mp4> ...` | un master soude + un sujets.json global | facecam/README.md |
| « ré-adresse mes sujets » · « les bornes de l'EDL ont bougé » · « refais la table des sujets » | `node facecam/sujets.mjs <master.spans.json> --villes <ancien-sujets.json> --out <sujets.json>` | une table de sujets contiguë, contrôlée à 0 ms | facecam/README.md |
| « est-ce que j'ai cassé quelque chose » · « compare avec avant » · « anti-régression » | `node facecam/baseline.mjs` | un tableau avant-après par axe mesure | facecam/README.md |

### B · Voir — bande de montage, pellicules, mesures

| le monteur dit… | Tu lances | Ce que ça rend | Doc |
|---|---|---|---|
| « ouvre la bande de montage » · « je veux éditer visuellement » · « montre-moi la timeline » | `node visionneuse.mjs --open` | des coupes écrites dans le plan de coupe | INDEX.md |
| « montre-moi ce plan » · « où couper dans ce rush » · « une pellicule » | `node filmstrip.mjs [pas_en_secondes]` | une planche par rush, temps gravé | INDEX.md |
| « montre-moi l'image à tel instant » · « une capture du master » · « prouve-le en image » | `node frame.mjs <video.mp4> --index <N>` | une image .png | INDEX.md |
| « c'est trop chaud » · « mesure la couleur » · « pourquoi ce plan jure » | `node probe.mjs [R03 R16]` | un tableau de mesures par plan | INDEX.md |
| « donne-moi tout à voir » · « prépare le matériel visuel » · « pack » | `node pack.mjs [pas] [--no-strips] [--no-curate] [--no-proof]` | un manifeste d'images à ouvrir | INDEX.md |
| « où commence ce plan » · « je lis le timecode gravé » · « converti mes coupes dictées » | `python3 bornes.py <brouillon.mp4>` | la frontière mesurée de chaque plan | INDEX.md |

### C · Habillage — sous-titres, overlays, miniature

| le monteur dit… | Tu lances | Ce que ça rend | Doc |
|---|---|---|---|
| « mets des sous-titres » · « sous-titre la vidéo » · « le sous-titre est en avance » | `node facecam/overlays/subs.mjs <video.mp4> && node facecam/overlays/subs-recale.mjs` 🛑 subs-controle.mjs | un fichier .ass karaoké recale et contrôle | facecam/README.md |
| « sous-titre mon montage mergé » · « des blocs parlés dispersés » | `node facecam/overlays/subs-blocs.mjs <plan.json>` | un .ass unique, chaque bloc à sa place | facecam/README.md |
| « où poser cet élément » · « il ne faut pas me cacher » · « quelle bande est libre » | `python3 facecam/freespace.py <video.mp4> <t0> <t1> --n <N>` | les bandes libres mesurées, pire cas | facecam/README.md |
| « une carte de mon trajet » · « un itinéraire animé » · « montre le parcours » | `node facecam/overlays/route.mjs <spec.json>` | une composition HTML pilotable image par image | facecam/README.md |
| « une carte muette » · « colorie ces pays » · « des distances depuis un point » | `node facecam/overlays/geomap.mjs <spec.json>` | une composition HTML pilotable image par image | facecam/README.md |
| « un graphique » · « une frise » · « mets cette phrase à l'écran » | `node facecam/overlays/figure.mjs <spec.json>` | une composition HTML pilotable image par image | facecam/README.md |
| « une vignette pour ce chiffre » · « affiche ce nombre » · « un chiffre à l'écran » | `node facecam/overlays/chip.mjs <spec.json>` | une composition HTML pilotable image par image | facecam/README.md |
| « un générique de fin » · « un carton de fin » · « à suivre » | `node facecam/overlays/generique-mp4.mjs <spec.json>` | un .mp4 avec piste muette | facecam/README.md |
| « capture cette composition » · « transforme le HTML en PNG » | `node facecam/overlays/capture.mjs <composition.html> <sortie/> <fps> <duree>` | une suite de .png à fond transparent | facecam/README.md |
| « habille la vidéo » · « grave les overlays » · « applique l'habillage » | `node facecam/overlays/burn.mjs <plan.json>` 🛑 refuse sans subs-controle.mjs déclaré | le master habille | facecam/README.md |
| « qu'est-ce qu'on pourrait illustrer » · « propose-moi des visuels » · « il manque des éléments » | `node facecam/overlays/suggest.mjs <rendu.mp4>` | une liste de propositions horodatées | facecam/README.md |
| « une miniature » · « la cover de la vidéo » · « une image avec le titre » | `node miniature.mjs "<master.mp4>" --t <sec> --titre "<titre>"` | une image 4K + une version réduite pour l'upload | INDEX.md |
| « il a dit quoi exactement » · « ce mot est faux dans les sous-titres » · « tranche entre ces deux graphies » | `node facecam/overlays/mot-litigieux.mjs <bloc.wav> --candidats "a|b" --temoin <t.wav> --temoin-vrai "…" --temoin-leurre "…"` | tranché (0) · INDÉCIDABLE + l'extrait à écouter (2) · instrument récusé (1) | facecam/README.md |
| « colle le générique au film » · « je vois pas le générique » · « mets le carton de fin dans la vidéo » | `node facecam/overlays/coller-generique.mjs <master.mp4> <generique.mp4> --out <f.mp4> --musique <p.mp3> --raccord-a <s> --piste-au-raccord <s>` | le film + son générique, prouvé (durée, origine, fondu, décodage intégral) | facecam/README.md |

### D · Paysage — catalogue, montage d'une journée, vlog, musique

| le monteur dit… | Tu lances | Ce que ça rend | Doc |
|---|---|---|---|
| « catalogue mes rushs » · « dérushe ma journée » · « indexe mes plans » | `node catalogue.mjs "<dossier>"` | R01..RNN + planches-contact numérotées | INDEX.md |
| « pré-trie mes plans » · « lesquels sont bons » · « j'ai des doublons » | `node curate.mjs [R03 R16]` | un verdict mesure par plan + une plage a garder | INDEX.md |
| « fais la fiche du jour » · « lis mes rushs » · « avant de couper » | `node lecture.mjs` | un gabarit de fiche a remplir | INDEX.md |
| « c'est cramé » · « le ciel est brûlé » · « trop lumineux » | `node highlights.mjs` | un traitement suggère par plan | INDEX.md |
| « monte cette journée » · « fais le montage » · « assemble mes plans » | `node monte.mjs` | un master de journée | INDEX.md |
| « change le look » · « une autre LUT » · « l'image est trop froide » | `node make-luts.mjs` | des LUT .cube sélectionnables | INDEX.md |
| « fais la vidéo finale » · « entremêle facecam et paysage » · « l'épisode complet » | `node vlog.mjs --dry` 🛑 vlog.mjs | un épisode assemble + sa timeline mesurée | VLOG.md |
| « applique ce grade à toute la vidéo » · « re-rends avec la nouvelle recette » · « passe en final » | `node revlog.mjs --dry` | l'épisode re-rendu | VLOG.md |
| « pose une musique » · « le son est mal dosé » · « on n'entend pas ma voix » | `node musique.mjs plan "<video.mp4>"` | une carte musicale appliquée au film | MUSIQUE.md |
| « critique ce montage » · « pourquoi c'est moyen » · « améliore la vidéo » | `node critique.mjs [<rendu.mp4>]` | une planche + des signaux mesures + un rapport | CRITIQUE.md |
| « j'aime bien cette vidéo » · « inspire-toi de ça » · « analyse cette référence » | `node analyse-reference.mjs "<video.mp4>"` | un profil chiffré | INDEX.md |

### E · Chaîne — état, rangement, preuve, restitution

| le monteur dit… | Tu lances | Ce que ça rend | Doc |
|---|---|---|---|
| « où on en est » · « fais le point » · « brief » | `node brief.mjs` | un resume d'une page | INDEX.md |
| « note cette décision » · « qu'est-ce qui reste à faire » · « reprends où on en était » | `node etat.mjs [log|decision|pending|done "<texte>"]` | un état persistant relisable | INDEX.md |
| « range le dossier » · « c'est le bordel » · « ça s'accumule » | `node arbo.mjs` 🛑 node arbo.mjs --check | un plan de rangement, puis son application | ARBO.md |
| « fais la restitution » · « qu'est-ce qu'on a gardé » · « le bilan du montage » | `node restitution.mjs` | un tableau avant-après | INDEX.md |
| « prouve que c'est bon » · « contrôle final » · « c'est vraiment fini ? » | `.venv-vision/bin/python gate.py <master.mp4>` | un verdict mesure, sortie non nulle si un axe échoue | VLOG.md |
| « renomme mes rushs » · « je ne retrouve pas R07 » | `node numeroter.mjs --dry` | des fichiers préfixés | INDEX.md |

<!-- /CAPACITES:TABLE -->

## 2b. Manœuvres composées — ce qu'une commande seule ne dit pas

La table ci-dessus donne les gestes. Ces sept manœuvres-là enchaînent plusieurs gestes ET portent
une décision : elles se lisent AVANT de lancer quoi que ce soit.

| Manœuvre | L'enchaînement, et ce qui s'y décide | Ouvre |
|---|---|---|
| **Boucle d'une journée** | scoper `Réglages/jour.txt` → `catalogue` → `curate` → `filmstrip` → **`lecture` : remplir la fiche** (montre / évolue / durée et pourquoi) → curer `Réglages/plan.txt` → look → **🛑 GATE 1 : soumettre le plan de coupe** (fiche + tableau `R## · source · décision · gardé · pourquoi` + rushs écartés nommés) → `monte` → vérifier à l'image | `STYLE.md` §LA DA DES VLOG, puis `INDEX.md` §Boucle |
| **Dérushage facecam** | `map` → `subjects` → `pick` → **TOI tu écris l'EDL** (1 sujet = 1 prise, la ★) → `refine` → **`relances --apply` OBLIGATOIRE** (refine ne voit PAS qu'une phrase a été dite deux fois) → *s'il reste une scorie* : `sweep --span` → contrôles `joins` **et** `coherence` → arbitrer → `render` (qui lance lui-même `lumieres` et `parole`) → preuve → **`overlays/suggest.mjs` : PROPOSER l'habillage, jamais le produire** | `facecam/README.md` §Chaîne |
| **L'épisode mergé** | Ⓐ inventaire des jours jamais coupés (croiser `RESTITUTIONS.md` — seul coût imprévisible) Ⓑ boucle jour pour ceux-là → **🛑 GATE 1** Ⓒ `vlog/sujets.json` + `facecam/fusion.mjs` ① `nus.mjs` ② trame sur le papier → **🛑 GATE 2 : faire valider la TRAME avant d'écrire l'EDL** ③ `vlog --dry` puis `vlog` ④ `musique plan --structure` ⑤ preuve + `RESTITUTIONS.md` + remise en état des `Réglages` | **`VLOG.md`** §0 (la trame) puis §4 (les 2 gates) |
| **Passer en FINAL** | `Réglages/qualite.txt` = `final` → **`revlog.mjs`** (PAS `vlog.mjs` seul : la qualité est dans la clé de cache des segments, un `final` posé au seul étage vlog regraverait du propre par-dessus du brouillon) → master sans badge ni timecode → **remettre `qualite.txt` = `brouillon`** (revlog ne restaure pas la qualité) → preuve par `gate.py` | `VLOG.md` §4 ⑥ |
| **Passer en 4K** | `definition.txt` = `2160` EN PLUS de `qualite.txt` = `final`, puis `revlog`. **AVANT** : refaire facecam et générique en 4K via `capture.mjs --dsf 2` — **jamais** en repassant les moteurs d'overlays en coordonnées 3840×2160 (les partis pris sont calés sur le repère 1920×1080). **Remettre `definition.txt` = `1080` après** | `VLOG.md` §4 ⑦ |
| **Changer le look** | `DA.txt` ou `lut.txt` (dosage `nom 0.6`) ; flags `hi`/`glow` par plan. Valider par une **grille avant/après** (même frame, 2 looks, `hstack`), **jamais** un rendu complet. ⚠️ Un jaune qui descend jusque dans les HAUTES lumières fait **virer le ciel au vert** : l'ambre vit dans les ombres et les médiums | `STYLE.md` §LUT / §Hautes lumières |
| **Habiller le master** | étage **POST-CONCAT** sur le mp4 final, jamais dans `render.mjs` (burn d'un span = 6,5 s vs ~8 min). ① `freespace.py` → les bandes libres, pire cas ② format selon la bande **et** la forme de la donnée ③ `capture` ④ `subs` puis `subs-recale` ⑤ **une seule** passe `burn` pour TOUS les overlays ⑥ preuve **au pire instant**. ⚠️ Les partis pris du monteur sont arbitrés : les re-proposer, c'est lui refaire payer une décision prise | **`facecam/README.md`** §⭐ LES PARTIS PRIS |

## 3. Garde-fous NON négociables (ils restent ici, jamais délégués à un fichier annexe)

Deux familles se suivent ci-dessous et ne se lisent pas pareil. Les **règles du projet**
(offline, chemins, purge, jamais publier) se respectent telles quelles. Les **⭐ réflexes de
mesure** sont des leçons payées : chacune est une session où je me suis trompé, et elles se
relisent quand on s'apprête à conclure. Index, pour retrouver la bonne :

| Famille | Le réflexe | Se relit avant de… |
|---|---|---|
| **Ce qui décide du contenu doit être dans la clé** | *clé de cache* · *identifiant dérivé d'un ordre* · *deux horloges* · **définition déduite d'un nom** | réutiliser un fichier, adresser une fenêtre |
| **Mesurer la SORTIE, jamais l'intention** | *`exit 0` n'est pas une preuve* · *garde-fou silencieux* · *l'intention codée ≠ le résultat* · *le son se mesure* · *prouver par ce qui n'a pas bougé* · *vérifier que la borne mord* · *un faux positif ne se prononce pas à l'œil* · *un critère vert ne couvre que sa dimension* · *un cas de test qui ne dure pas* · **un instrument qui DÉDUPLIQUE ne prouve pas une absence** · **un cas de test doit FRANCHIR le seuil éprouvé** | dire « c'est fait » |
| **D'où vient le chiffre** | *un chiffre reçu est une hypothèse* · *une cadence supposée fabrique une dérive* · *un garde-fou neuf se teste sur son cas* · **une cible reçue peut être infaisable** | bâtir un raisonnement dessus |
| **Ce qui se décide AVEC le monteur** | *les 2 gates : plan de coupe et trame* · *une mesure n'interprète pas l'intention* · *une réponse hors liste est la meilleure* · **un coût annoncé avant n'est pas une dérive** | trancher seul |
| **La chaîne** | *rejouable* · *doc dans le même commit* · **un seul réglage par tour — et l'exemption qu'on s'accorde est le moment où il servait** · *corriger sans recréer* · **une preuve chère ne se prend pas** · **déplacer révèle qui référençait** | refermer une session |


- **Offline strict** : jamais de dépendance réseau/LLM-en-ligne DANS le pipeline. Une sélection
  « intelligente » par Claude reste une surcouche à la demande, avec repli heuristique.
- **Télécharger un ASSET manquant : autorisé d'office, sans demander** (le monteur, 25/07). Une police,
  un GeoJSON, une icône, un logo de marque qui manque → on le récupère TANT QU'IL Y A DU RÉSEAU,
  on le range dans `facecam/assets/` (donc dans le repo, pour qu'il voyage), et on dit après coup
  quel fichier et quelle taille. Ça ne contredit pas l'offline strict : c'est ce qui le rend
  possible. Le pipeline, lui, ne rappelle jamais le réseau. ⚠️ Ce qui doit survivre au voyage vit
  dans le **repo**, jamais dans un `node_modules` (un `npm i` l'effacerait).
- **Backup avant toute édition du moteur** : `cp monte.mjs "monte.mjs.bak-$(date +%Y%m%d-%H%M%S)"`, puis
  `node --check monte.mjs`. **Un seul réglage par tour** (deux changements = on ne sait plus lequel a agi).
- **Ne pas tester en important un script prod** : `node --check` / `--dry` uniquement — un `import`
  exécute le top-level (cf. mémoire `feedback-jamais-importer-script-prod`).
- **Où atterrit un rendu — UN DOSSIER DE RUSH NE CONTIENT QUE DES RUSHES** (le monteur, 31/07 :
  « les rendus bruts vont dans Vidéos finies et pas un dossier de rush »). Tout ce que le moteur
  produit vit sous « Vidéos finies » : l'**épisode** à la racine · le **master de journée** dans
  `Journées/` · le **rendu de test daté** dans `Tests/` · la **pièce réutilisable** (générique de
  fin, carton, maquette) dans `Éléments/`. Seule exception assumée : le master facecam dérushé
  (`VLOG_…_v12.mp4`) reste dans « Facecam Rush », `vlog.mjs` le lit comme une SOURCE.
  **Les chemins vivent dans `store.mjs`** : ne JAMAIS reconstruire `path.join(STORE,'…')` dans un
  script — c'est cette dispersion (7 littéraux) qui a fait dériver le store. `arbo.mjs` dénonce
  tout script qui recommence.
  Corollaire inchangé : **UN SEUL fichier livré par rendu agrégé**, celui avec le lit musical
  (le monteur, 30/07). `node vlog.mjs` assemble PUIS pose la musique et supprime l'assemblage muet —
  ne jamais livrer les deux et laisser le monteur deviner laquelle est la bonne. `--nu` s'arrête avant
  la musique, pour du débogage seulement.
- **Purger : le moteur le fait TOUT SEUL** (02/08). `monte.mjs`, `vlog.mjs` et `facecam/render.mjs`
  appellent `purgeApresRendu()` (`store.mjs`) en dernier geste : rétention N/N-1 appliquée à chaque
  rendu, une ligne imprimée **même quand rien n'est dû** (un garde-fou silencieux est indiscernable
  d'un garde-fou débranché). `MONTAGE_NO_PURGE=1` désarme. La commande manuelle reste pour un balayage
  délibéré : `node arbo.mjs --purge` (dry-run) puis `--apply --purge`. Garde N et N-1 des rendus de
  test, des épisodes et des masters facecam ; met le reste à la **corbeille** (réversible) ; ne touche
  JAMAIS `Journées/` ni `Éléments/`.
  ⚠️ **Et la DÉFINITION se MESURE** (01/09) : `fusion.mjs` sort les masters 4K de ville sans suffixe
  `_4K`, donc les six rendus 4K du #02 tombaient dans la lignée 1080p. `arbo.mjs` lit désormais la
  largeur à l'ffprobe, le nom n'étant qu'un **repli annoncé**. *Une définition déduite d'un nom
  n'est pas une définition.* Restent déduits : `Journées/` et `Tests/` — réponse explicite à la
  question « quels AUTRES pools ont la même forme ? », qui se pose et **se répond par écrit**.
  ⚠️ **Certains lots se purgent par NATURE, pas par génération** (01/09) : `vlog/work` pesait 20 Go
  et vit dans le MOTEUR, hors du champ d'arbo. Il n'y a là ni N ni N-1, seulement des natures —
  `norm/`, `_raw_v.mp4`, `fusion/` se refabriquent, `_raw_a.m4a` **non** (étalon de `gate.py`). D'où
  une **liste blanche de ce qu'on jette**, jamais une liste noire de ce qu'on garde : *un artefact
  neuf doit être gardé par défaut, pas jeté par oubli.* 20 Go → 4,6 Go, étalon prouvé intact au md5.
  ⚠️ **Une lignée d'ÉPISODE = ÉPISODE × DÉFINITION** (30/08) : le pool global des épisodes a mis le
  master 1080p du VLOG #01 à la corbeille au rendu du #02 (restauré). La leçon des lignées facecam
  était écrite dans `arbo.mjs` **juste sous la ligne fautive** et n'avait jamais été portée aux
  épisodes. *Une leçon écrite à côté du code fautif n'est pas une leçon appliquée* : après avoir
  corrigé la définition d'une lignée, d'un périmètre ou d'une clé, la question suivante est
  **« quels AUTRES pools ont la même forme ? »**, pas « ai-je bien corrigé celui-ci ».
  ⚠️⚠️ **Et une lignée d'épisode vaut ÉPISODE × DÉFINITION × ÉTAGE** (20/09) — troisième fois que
  ce même motif se paie. Le nu, le sous-titré et le sous-titré + générique ne sont pas trois
  générations : chacun se FABRIQUE à partir du précédent, donc aucun ne remplace l'autre. Comptés
  dans un seul pool, chaque étage ajouté **poussait un vrai livrable dehors**, et la purge
  désignait pile les deux masters que le monteur avait nommément protégés — les plus ANCIENS de quatre.
  `masters-proteges.txt` a empêché le dégât ; il ne corrigeait pas la définition. L'étage se lit
  dans le parenthésé du nom, **une fois retirés la date (= la génération) et la définition**.
  *La question « quels AUTRES pools ont la même forme ? » avait encore une réponse, et cette
  fois ce n'était pas un pool : c'était une DIMENSION de la clé qui manquait.*
  ⚠️ **Une lignée de master facecam = SUJET × DÉFINITION** : depuis
  « une ville = un rendu » il y a six masters par version, et un pool unique aurait jeté 4 des 6
  livrables du jour (corrigé 02/08).
  ⚠️ **La leçon, elle, dépasse le rangement** (31/07, complétée le 02/08) : la rétention N/N-1 était
  écrite depuis des semaines dans STYLE, INDEX et CRITIQUE — et il y avait 13 rendus de test empilés.
  **Une règle du skill qui dépend de ma discipline plutôt que d'un outil finira violée.** Le 02/08 le
  motif est revenu d'un cran plus haut : la règle ÉTAIT mécanisée (`arbo.mjs --purge`), mais son
  DÉCLENCHEMENT dépendait encore de moi — il a fallu que le monteur demande. *Une règle mécanisée mais
  déclenchée à la main n'est mécanisée qu'à moitié : chercher qui appuie sur le bouton, pas seulement
  si le bouton existe.*
- **Rendu incrémental** : une retouche ne re-encode que les plans changés (`cache/`). Ne pas casser le
  cache sans raison ; l'invalider via `CACHE_VER` seulement après un vrai changement du pipeline d'encodage.
- **⭐ SI UNE DÉCISION CESSE DE DÉPENDRE DU SEUL FICHIER, LA CLÉ DE CACHE DOIT LE DIRE** (31/07).
  Deux fois dans la même semaine, une correction demandée par le monteur n'était **pas dans le rendu** et
  rien ne l'a signalé : (1) le nom du bloc facecam ne portait que les IDs de sujets, donc déplacer
  une frontière resservait l'ancienne découpe ; (2) le batch JOUR/NUIT dépend désormais des plans
  VOISINS (verrou de scène), alors que la clé de segment ne portait que ce qui dépend du fichier.
  Réflexe : après avoir rendu une décision **contextuelle**, se demander « qu'est-ce qui, dans la
  clé, distingue ce cas de l'ancien ? ». Et n'ajouter le champ **que pour les cas concernés**
  (ruse `mute`/`rep`/`bat`) — sinon on jette tout le cache existant pour rien.
- **⭐ LES DEUX SEULES DÉCISIONS QUI SE FONT VALIDER : LE PLAN DE COUPE ET LA TRAME** (01/08).
  Tout le reste du pipeline est de l'exécution mesurable — un grade, un niveau sonore, une
  définition se rejouent en une commande. Ces deux-là non : **ce qu'on garde du voyage** (Ⓑ) et
  **dans quel ordre on le raconte** (②) sont les seules décisions éditoriales, et les plus chères
  à défaire. Le skill les SOUMET, il ne les prend pas — format exact dans `VLOG.md` §4, GATE 1 et
  GATE 2. Contrôle de cohérence : les retours du monteur sur le VLOG #01 (30/07) portaient **tous** sur
  la trame, donc sur du déjà rendu. Un accord de 2 minutes évitait un re-rendu complet.
  Exception : « débrouille-toi » / « fais tout » lève les gates — le jour ou la trame concernés
  deviennent alors **une réserve à nommer** dans la restitution ET dans la réponse.
- **⭐ UN IDENTIFIANT DÉRIVÉ D'UN ORDRE N'EST PAS UN IDENTIFIANT** (31/07). Les deux numérotations
  du moteur sont des **index de dossier** : `cN` (facecam) vient de l'ordre ALPHABÉTIQUE de l'inbox,
  `R##` (paysage) vient de l'ordre CHRONOLOGIQUE de l'inbox scopée au jour. Déposer **un seul rush
  de plus** décale donc tout ce qui suit, et un EDL / un `plan.txt` écrit la veille désigne d'autres
  fichiers. Vécu : un rush copié dans l'inbox facecam après coup a fait rendre **220,0 s au lieu de
  451,8 s**, avec 9 segments VIDES — et le script a fini en vert. Réflexe : **ce qui a été décidé se
  range avec le NOM du fichier**, jamais avec son rang (table `clips` d'un EDL, champ `rush` d'un
  manifeste), et on **compare** avant d'installer quoi que ce soit.
- **⭐ DEUX GRANDEURS DANS LA MÊME UNITÉ NE SONT PAS LA MÊME HORLOGE** (31/08). Cinq retours de
  le monteur sur le VLOG #02 — « un rush inutile pendant quelques centièmes puis le bon rush » — ne
  faisaient qu'UN défaut : `sujets.json` donne ses bornes en temps de CONTENU (index ÷ 29,97),
  ffmpeg lit le temps de PTS, et le master soudé est VFR (jusqu'à +3,0 images d'avance, et le pts
  RECULE aux jonctions de ville). Réflexe : **une fenêtre dans un fichier se dit en INDEX D'IMAGE**
  (`select='between(n,…)'`), pas en secondes, dès que le fichier n'est pas *prouvé* CFR.
  Corollaire : *un compte d'images juste ne dit rien sur la PLACE de ces images dans le temps* —
  les trois contrôles de `fusion.mjs` (images, dérive A/V, `start_time`) étaient au vert sur un
  master inutilisable ; il mesure désormais son horloge.
- **⭐ « L'INTENTION EST CODÉE » N'EST PAS « LE RÉSULTAT EST LÀ »** (31/08, côté son). Trois retours
  du monteur sur la musique du #02 avaient trois causes, dont aucune n'était le dosage : un lit qui
  s'éteignait 40 % du film (pistes de 67-112 s pour des cues de 145-166 s, rebouclées **sur leur
  propre fondu de sortie**), des cues snappés au 0,000 s près sur une frontière de plan mais au
  milieu d'une rafale de plans de 2 s, et une enveloppe de ducking **en marches** (−16,5 dB en un
  échantillon). Chaque contrôle vérifiait l'intention. Ce qui a tranché : écouter le RENDU à
  l'oscilloscope — RMS par fenêtre de 0,5 s sur les 772 s — et demander « où est-ce que ça tombe
  sous −35 dBFS ? ». *Un plan qui se lit bien sur le papier peut décrire un film muet.*
  Corollaire de vocabulaire, valable partout : **« snappé sur une frontière » n'est pas « snappé
  sur une transition »**. Le code faisait exactement ce que sa doc annonçait ; c'est la définition
  qui était trop large. Quand un contrôle est vert et que le monteur entend un défaut, suspecter la
  DÉFINITION du critère avant de suspecter son exécution.
- **⭐ D'OÙ VIENT LE CHIFFRE — un nombre reçu est une HYPOTHÈSE, pas une mesure** (31/08).
  Trois fois dans la même session, un chiffre non remesuré m'a coûté des tours :
  ① la consigne du monteur donnait un tableau chiffré (« cue 2 tombe à +1,63 s dans R040 = plein
  milieu ») et il était **faux** — remesuré, les 5 cues tombaient à **0,000 s** près sur une
  frontière. J'ai failli déplacer des cues pour réparer un défaut qui n'existait pas, et la
  vraie cause (la définition du critère) serait restée. *Une consigne qui contient une mesure
  contient aussi l'hypothèse de celui qui l'a prise : on la refait, ce n'est pas de la défiance.*
  ② j'ai converti des index en secondes avec une cadence **supposée** (29,97) alors que le rendu
  est en 30/1 — ça fabrique une dérive cumulative parfaitement crédible, qui n'existe pas, et on
  la suit plusieurs tours. *Lire le fps du fichier AVANT de convertir quoi que ce soit.*
  ③ j'ai écrit « vérifié en dry-run » dans un message de commit **avant** de l'avoir lancé (je
  reprenais le brief). La mesure a confirmé après coup — ça ne rachète rien : *une preuve
  s'écrit après avoir été produite, jamais avant.*
- **⭐ UN GARDE-FOU NEUF SE TESTE SUR LE CAS QU'IL DOIT ATTRAPER** (31/08). Le contrôle d'horloge
  que je venais d'ajouter à `fusion.mjs` a affiché « écart NaN · **0 recul de pts** » sur le
  master qui en comptait 3 : `-of csv=p=0` laisse une virgule en fin de ligne, `Number("0.0,")`
  vaut NaN, et **toute comparaison avec NaN est fausse** — donc le garde-fou se déclarait vert
  sans rien lire. C'est le même motif que « un garde-fou silencieux est indiscernable d'un
  garde-fou débranché », d'un cran plus vicieux : celui-là **parle**, et il ment.
  Règle : un contrôle neuf se valide sur un cas connu FAUX avant de servir, exactement comme
  `gate.py` avait été passée d'abord sur un master déjà prouvé.
- **⭐ CORRIGER UN DÉFAUT PEUT RECRÉER CELUI QU'ON CORRIGEAIT — poser l'ORDRE, pas les poids**
  (31/08). Pour que le lit musical couvre ses cues, j'ai monté la couverture à +6 contre −3 pour
  la réutilisation d'une piste. Résultat : la seule piste de 4 min 45 a servi **3 cues sur 5** —
  c'est-à-dire que je livrais « tu mets 2× la même musique », le défaut que le monteur signalait dans la
  phrase d'à côté. Quand plusieurs critères s'additionnent dans un score, ce sont leurs poids
  RELATIFS qui décident, et un poids se règle à l'aveugle : **écrire d'abord l'ordre des
  priorités en clair** (jamais deux fois la même piste > couvrir sans boucler > usage voulu),
  puis choisir des poids qui le réalisent, puis **vérifier la sortie du choix**, pas la formule.
- **⭐ UNE PREUVE COÛTEUSE SE LANCE SUR UNE CHAÎNE À JOUR** (31/08). J'ai lancé un rendu complet
  (~8 min) pour mesurer une correction musicale alors que j'avais modifié l'EDL d'une ville sans
  avoir refusionné le master : le rendu aurait mesuré la musique sur des images périmées. Tué et
  refait. Avant tout run long, remonter la chaîne d'un cran et se demander **ce qui a changé en
  amont depuis le dernier artefact** — c'est trente secondes contre huit minutes.
- **⭐ `exit 0` N'EST PAS UNE PREUVE — mesurer la SORTIE, jamais le code retour** (31/07). Un `-ss`
  au-delà de la fin d'un fichier fait sortir ffmpeg avec un **code 0** et un mp4 de 695 octets sans
  piste. C'est la même famille que les trois sondes de commodité qui ont fabriqué des pannes sur ce
  projet : ce qui tranche, c'est le compte d'images, la durée, le md5 — pas le fait que ça se soit
  « bien passé ».
- **⭐ UNE CHAÎNE QU'ON NE PEUT PAS REJOUER N'EST PAS UNE CHAÎNE** (31/07). Corollaire de « une règle
  non mécanisée n'est pas tenue », appliqué aux COMMANDES : le générique de fin et la gate de clôture
  avaient été montés à la main dans le terminal ; au master suivant, il a fallu les réinventer, et
  la gate est justement ce qui décide si on livre. Toute suite de commandes qu'on refera un jour
  s'écrit dans le repo (`generique-mp4.mjs`, `gate.py`) — et un instrument de mesure se **valide sur
  un cas connu** avant de servir (`gate.py` a d'abord été passée sur le master 1080p déjà prouvé).
- **⭐ UNE MESURE INFORME UNE DÉCISION, ELLE NE LA PREND PAS À LA PLACE DE LÉO** (02/08). *La leçon la
  plus chère de la session d'équilibrage.* le monteur demande « éclaircir tous les sombres » ; je mesure que
  34 des 36 plans tiennent déjà dans une bande de 4,6 points, j'en conclus qu'il n'y a plus de
  population de plans sombres, donc qu'il « doit vouloir dire » le niveau général — et je remonte le
  niveau, **rééclaircissant les plans clairs qu'il m'avait fait baisser deux fois**. La mesure était
  juste ; la conclusion m'appartenait et elle était fausse. **Quand une mesure contredit la lettre
  d'une demande, elle se RAPPORTE — elle ne sert pas à réécrire l'intention.** Deux phrases suffisent :
  voilà ce que je mesure, voilà les deux lectures possibles, laquelle. Le coût de la question est de
  30 secondes ; celui de la ré-interprétation a été deux rendus complets des six villes.
- **⭐ UN CHANGEMENT CIBLÉ SE PROUVE PAR CE QUI N'A PAS BOUGÉ** (02/08). le monteur demande de corriger les
  plans clairs *uniquement*, puis les sombres *uniquement*. Regarder l'image ne prouve rien de tel —
  ce qui le prouve, c'est que les paramètres de l'autre population soient **identiques au chiffre
  près** avant/après (ici les `lum.curve` : 7 des 9 spans de Hong Kong inchangés). Quand une demande
  porte un « seulement », cherche l'INVARIANT à afficher, pas seulement l'effet à montrer.
- **⭐ AVANT DE DESSERRER UNE BORNE, VÉRIFIER QU'ELLE MORD** (02/08). Deux tours perdus à élargir un
  plafond qui n'était pas atteint (+12,0 % demandés pour +13,0 % autorisés) : ce qui limitait était
  ailleurs. Et quand un réglage « dosé à fond » ne produit presque rien, le frein n'est pas son
  amplitude mais **l'endroit où il agit** — un gain appliqué aux ombres ne bougera pas la moyenne
  d'un plan dont la matière est dans la fenêtre. *Corriger une moyenne demande d'agir là où la
  matière est, pas là où le réglage est commode.* Diagnostiquer QUELLE contrainte lie, avant d'en
  relâcher une.
- **⭐ UN GARDE-FOU SILENCIEUX EST INDISCERNABLE D'UN GARDE-FOU DÉBRANCHÉ** (02/08). `purgeApresRendu()`
  imprime une ligne **même quand il n'y a rien à jeter** : sans ça, « aucune sortie » veut dire à la
  fois « rien à faire » et « le hook n'est jamais appelé ». Tout automatisme discret doit dire qu'il
  est passé. Corollaire de rangement : **une constante qui ne borne plus rien mais reste en tête de
  fichier finit par être lue comme la règle en vigueur** — l'ancien `GAIN_MAX` a été retiré, pas
  laissé « au cas où ».
- **⭐ UN FAUX POSITIF NE SE PRONONCE PAS À L'ŒIL** (31/08). Le détecteur de micro-segments avait
  signalé **6 images** au début du bloc F22 ; j'ai regardé une planche de 12 images, j'y ai vu une
  coupe suivie de mouvement, et j'ai écrit « faux positif ». le monteur l'a re-signalé au tour suivant :
  **le signalement était bon.** Remesuré autrement (différence image à image sur 270 frames), la
  coupe sautait aux yeux — 18,8 contre une médiane de 0,91. La cause était en amont : la borne `a`
  tombait dans une **relance**, et la compression de silence (`silThresh 0,35 → silTarget 0,16`)
  transformait la seconde de blanc qui suivait en un **saut visible de 0,2 s**. Deux règles :
  ① *un instrument se réfute par une MESURE du même ordre, jamais par un coup d'œil* — une planche
  de vignettes montre des états, pas des transitions ; ② *quand le monteur re-signale ce que j'ai classé
  faux positif, le signalement gagne d'office* — je n'ai pas à re-plaider, j'ai à re-mesurer.
  Même famille que « rejuger aussi les verdicts NÉGATIFS » : un verdict que j'ai rendu moi-même est
  le plus difficile à rouvrir.
- **⭐ UNE CIBLE CHIFFRÉE REÇUE PEUT ÊTRE INFAISABLE — le dire, pas la forcer** (31/08). Consigne :
  « viser ~0,20-0,25 s d'air après la parole » en queue de F36. Mesuré : la parole finit à 68,05 s
  et **le mouvement démarre à 68,12 s**, soit 0,07 s après. Toute valeur dans la fourchette demandée
  montrait donc précisément ce qu'elle devait supprimer. Livré à **0,150 s**, avec la mesure et la
  raison. C'est le pendant de *« un chiffre reçu est une hypothèse »* : une hypothèse peut être
  **contradictoire avec la matière**, et alors on ne choisit pas entre obéir et corriger en silence —
  on rapporte l'impossibilité, on tranche au plus près, on le nomme dans la restitution.
- **⭐ UNE RÉPONSE HORS LISTE EST LA MEILLEURE — l'outil doit savoir la recevoir** (31/08). J'ai
  soumis un arbitrage musical en quatre options (scinder partout / scinder deux cues / élargir le
  vivier / ne rien changer). le monteur n'en a choisi aucune : **« utilise `nest-beatz…292663` »**. Il n'a
  pas tranché une doctrine, il a **désigné un objet** — et c'était la bonne réponse, plus courte et
  plus juste que mes quatre. Deux conséquences : ① quand une question d'arbitrage revient avec une
  désignation concrète, on l'exécute telle quelle, on ne la retraduit pas en option ; ② si le moteur
  ne sait pas recevoir une désignation, **c'est le moteur qui manque** — d'où `--impose` /
  `MUSIQUE_IMPOSE`, écrits dans le même tour. Corollaire de vocabulaire : **une préférence codée
  « OFF par défaut » est une règle d'ATTRIBUTION AUTOMATIQUE, pas une interdiction.** Les cues beat
  sont off (préférence n°3) ; `nest-beatz` est classée `beat` ; elle entre parce que le monteur l'a nommée.
  Opposer une préférence du monteur à une demande du monteur, c'est invoquer une règle pour ne rien faire.
- **⭐ CORRIGER DANS LA MODALITÉ OÙ LE DÉFAUT EST DÉCRIT** (31/08). le monteur : « F36 finit trop tôt ».
  J'ai mesuré le **SON**, posé 0,50 s d'air, et obtenu au tour suivant « ça finit trop tard, on me
  voit bouger ». Le défaut était **visuel** des deux côtés ; je l'ai corrigé sur une grandeur
  voisine, et j'ai fabriqué le défaut symétrique. Une borne d'image se valide **à l'image** (lecture
  séquentielle des dernières frames + différence image à image), une borne de parole à l'oreille et
  au RMS. Vérification croisée utile : sur le retour d'à côté (F20, « on n'a pas la fin »), la
  transcription du bloc était **complète** — le texte ne disait rien du défaut, c'est le RMS de la
  queue (−22,7 dBFS sur la dernière fenêtre de 25 ms) qui montrait la coupe DANS le son.
- **⭐ UN CRITÈRE VERT NE COUVRE QUE LA DIMENSION QU'IL REGARDE** (31/08, 3ᵉ passe musicale).
  J'avais construit tout un contrôle de **couverture** — « la piste est-elle assez longue pour le
  cue ? » — et il était vert : `universfield-mountain-silence`, 104,4 s de corps utile pour un cue
  de 68,6 s. Le rendu creusait quand même **1,0 s sous −35 dBFS** à 11:44,5, c'est-à-dire
  exactement le symptôme « la musique s'arrête » que toute cette chaîne corrige. Cause : la piste
  fait **−44,7 dBFS sur ses 6 premières secondes**, et le cue démarrait sur une tête `plein`, où la
  musique est seule. *La couverture ne dit rien du niveau d'attaque.* Réflexe : quand on choisit un
  objet sur UN critère, lister les **autres dimensions qui décident du résultat** et les mesurer
  aussi — ici la durée et le niveau d'entrée. Un contrôle vert n'est pas un blanc-seing, c'est une
  réponse à la seule question qu'on lui a posée.
- **⭐ CORRIGER PAR LE CHOIX, PAS PAR LA COMPENSATION** (31/08, même passe). Le réflexe facile était
  de remonter le gain de la piste trop douce. C'était traiter le symptôme et en fabriquer deux
  autres : un gain qui remonte une attaque à −44,7 dBFS remonte aussi son **souffle** et son propre
  fondu, et il fausse le `loudnorm` global. La piste a été **changée** (`monume-nature-dreamscape`,
  attaque −10,7 dBFS — et la doctrine in-point disait déjà « celle-là démarre à son sommet, la
  laisser à 0 »). Règle : *quand un objet ne convient pas, on change d'objet avant de compenser
  son défaut* — une compensation se paie sur toute la chaîne en aval, un choix ne se paie qu'une
  fois. Corollaire : la réponse était **déjà écrite dans la doctrine** ; avant d'inventer une
  correction, relire ce que le catalogue dit de la matière.
- **⭐ UN COÛT ANNONCÉ AVANT N'EST PAS UNE DÉRIVE — écrire le coût ET le chemin de retour** (31/08).
  Aller au bout des scissions musicales *contredisait* la préférence n°4 du monteur (« laisse durer les
  musiques ») : 9 cues, un changement toutes les 1 min 26, la cadence qu'il avait écartée sur le
  #01. Ce n'est pas une dérive parce que trois choses ont été faites **dans cet ordre** : ① le coût
  a été chiffré et dit **avant** d'agir ; ② le monteur a tranché (« fais + ») ; ③ le compromis **et son
  chemin de retour** sont écrits dans l'EDL, pas seulement dans le chat (« revenir à 7 cues =
  retirer deux entrées de `MUSIQUE_IMPOSE` »). Sans le ③, la préférence n°4 réapparaîtrait au
  prochain épisode comme une règle violée sans raison lisible. *Une décision qui contredit une
  règle antérieure doit laisser dans l'artefact de quoi la défaire.*
- **⭐ UN CAS DE TEST QUI NE DURE PAS NE TESTE PAS UN GARDE QUI REGARDE LE PRÉSENT** (01/09).
  Le garde neuf de `arbo.mjs` refuse de purger `vlog/work` tant qu'un **ffmpeg tourne**. Testé avec
  un `ffmpeg -f lavfi -i testsrc=d=25 -f null -`, il s'est déclaré **négatif** : j'ai failli conclure
  qu'il ne mordait pas. En vérité 25 s de contenu synthétique s'encodent en une fraction de seconde
  — le processus était **mort avant la mesure**. Refait avec `-re`, le garde mord. C'est le pendant
  de « un garde-fou neuf se teste sur le cas qu'il doit attraper » : *encore faut-il que le cas
  EXISTE au moment où on regarde.* Quand un garde qui interroge le présent (un processus, un
  verrou, une connexion) sort négatif, vérifier d'abord que la condition tenait pendant la mesure.
- **⭐ DEUX TAGS AUX MÊMES TIMECODES NE SE CONSOMMENT PAS PAREIL** (01/09). le monteur, sur le master 4K
  du #02 : « à 0:10 le sous-titre est déjà là et **consommé** alors que j'ai pas commencé à parler ».
  Toute la chaîne était verte, et à raison : synchro son 0 ms sur 7 fenêtres, aucun évènement hors
  de son bloc, zéro chevauchement, et — remesuré ce jour-là — un allumage à **0,000 s** du début de
  chaque mot sur 1 094 mots appariés ASS ↔ transcription. Le défaut n'était pas dans les timecodes
  mais dans le **tag** qui les consomme : `\k` bascule le mot en accent **d'un coup au DÉBUT** de sa
  prononciation, donc à l'instant où la voix attaque, le mot est déjà entièrement accent — lu comme
  DÉJÀ DIT. `\kf` le remplit de gauche à droite pendant qu'il est dit. Mesuré sur le #02 : chaque
  mot accent pendant toute sa durée, médiane 0,19 s, p90 0,48 s, **max 1,08 s**. Corollaire de « un
  critère vert ne couvre que la dimension qu'il regarde » : *trois contrôles de TIMING ne disent
  rien d'un contrôle de RENDU*. Garde livrée : `subs-gate.mjs` (rend l'ASS sur fond noir, mesure la
  part d'accent à la 1re et à la dernière image) + refus de `\k` dans `subs-blocs.mjs`.
- **⭐ LA FAÇON D'ATTEINDRE L'INSTANT t FAIT PARTIE DE LA MESURE** (01/09, en écrivant `subs-gate`).
  Trois formes essayées pour rendre l'ASS à un instant donné, **deux fausses**. `-ss` APRÈS `-i`
  fabrique puis jette toutes les images depuis 0 (18 700 pour un évènement à 10 min : le contrôle
  dépassait 2 min, donc on ne le prenait plus). `-ss` AVANT `-i` sur du `lavfi` est instantané mais
  **remet l'horloge du filtergraph à zéro** : `ass=` ne voit plus rien et rend du NOIR — soit un
  faux « rien à signaler », le pire des résultats. `setpts=PTS+t/TB` échoue pareil. La forme juste
  ne déplace pas l'horloge, elle **RECALE l'ÉVÈNEMENT** dans un mini-ASS d'une ligne remise à
  0,10 s. *Un instrument dont on n'a pas vérifié qu'il voit quelque chose ne prouve pas une absence.*
- **⭐ RÉGÉNÉRER N'EST PAS TRANSFORMER** (01/09). Pour ne changer qu'un tag, j'ai relancé
  `subs-blocs.mjs --force` **sans `--lexique`** : les timecodes étaient parfaits, mais « portugaise »
  est devenu « portuaire », « Gulangyu » → « Goulangu », et 4 lignes se sont recoupées ailleurs.
  Une régénération rejoue TOUTE la chaîne, options comprises — celles qu'on oublie de repasser
  disparaissent en silence. Parade appliquée : restaurer, relancer AVEC le lexique, puis **prouver
  l'invariant** — 229 évènements des deux côtés, `diff` hors tag = **0 ligne**, durées de karaoké
  identiques. *Un changement ciblé se prouve par ce qui n'a PAS bougé.*
- **⭐ UNE HORLOGE SE MESURE SUR LE SIGNAL, PAS DANS LA TRANSCRIPTION** (01/09). le monteur, deux fois :
  « tu ne dois pas faire apparaître le sous-titre avant que je commence de parler. » **whisper ne DATE
  pas le premier mot, il le COLLE au début du fichier** qu'on lui donne — réfutation : le même bloc
  précédé de 2,000 s de silence NUMÉRIQUE ressort « Alors » à 0,000 s, dans un silence qu'on venait
  d'ajouter soi-même. Ses timecodes ne sont pas une mesure acoustique, c'est un ÉTALEMENT du texte sur
  la durée disponible. Mesuré sur le #02 : 9 blocs sur 27 en avance, jusqu'à **2,64 s** sur F01, à
  0:10 — l'instant exact du signalement. *Quand un outil rend un nombre, se demander s'il l'a MESURÉ
  ou s'il l'a déduit de la place qu'on lui a laissée.*
- **⭐ QUAND DEUX ARTEFACTS ONT CHACUN LA MOITIÉ DE LA RÉPONSE, ON N'EN CHOISIT PAS UN** (01/09). Deux
  corrections de l'avance ont été essayées et **réfutées par la mesure** : le décalage global (faux —
  les silences de whisper tombent DÉJÀ pile au milieu du bloc, l'erreur est locale à la tête) et la
  re-transcription sur audio rogné (l'horloge devient juste, mais whisper re-décode : 8 blocs sur 9
  abîmés, « des quartiers un peu plus riches » → « les cartes riches », 22 mots nets perdus). La sortie
  n'était pas de trancher entre le bon texte et la bonne horloge, mais de les **APPARIER** : `subs-recale.mjs`
  aligne les deux suites de mots et donne au texte livré les temps de son jumeau rogné. Résultat prouvé —
  1 097 mots identiques, F01 de +2,64 s à −0,01 s. *Un arbitrage entre deux artefacts imparfaits est
  souvent un faux dilemme : chercher ce que chacun sait, avant de choisir lequel jeter.*
- **⭐ UN TAG JUSTE AVEC UNE DURÉE ABSURDE PRODUIT LE DÉFAUT DU TAG FAUX** (01/09). Après le passage à
  `\kf`, `subs-gate.mjs` refusait encore 2 débuts de bloc sur 28. Le tag était bon ; c'est sa DURÉE qui
  ne l'était pas — 0,01 s pour « En », 0,04 s pour « aujourd'hui, ». En dessous de ~3 images, un
  remplissage progressif est indiscernable d'une bascule : on retombe visuellement sur le `\k` que le monteur
  avait signalé. 52 lignes sur 229 étaient dans ce cas. Plancher posé (`KF_MIN_CS` = 0,10 s sur le
  premier mot, repris sur les suivants, total de ligne conservé au centième). *Corriger la forme d'un
  réglage ne suffit pas si sa GRANDEUR reste hors du domaine où cette forme a un sens.*
- **⭐ CE QUI DÉCIDE DU LIVRABLE SE VERSIONNE — un fichier hors du repo n'a ni sauvegarde ni
  historique** (01/09). Les plans de burn décrivent tout ce qui est gravé sur un master : les huit
  overlays, leurs positions, le `.ass`, et depuis ce jour les **réserves acceptées par le garde**.
  Ils vivaient dans le store. Une décision aussi lourde ne peut pas dormir dans un fichier que rien
  ne sauvegarde et dont personne ne peut relire l'évolution — d'autant qu'elle porte désormais des
  seuils que le garde consulte pour AUTORISER un burn. Déplacés dans `facecam/plans/`.
  Ce que ça a demandé, et qui vaut pour tout déplacement de ce genre : ① les chemins absolus
  figeaient la machine — remplacés par `store:<…>` (résolu via `store.mjs`, donc juste même si
  `MONTAGE_STORE` change) et par du relatif pour ce qui voyage avec le code ; ② les 527 Mo de PNG
  RESTENT dans le store, parce qu'ils se refabriquent (`--capture`) et n'ont rien à faire dans un
  dépôt — *versionner ce qui DÉCIDE, pas ce qui se recalcule* ; ③ l'invariant à exhiber n'est pas
  « ça marche encore » mais **la commande ffmpeg produite, identique au caractère près** avant et
  après — y compris une fois les anciens fichiers réellement SUPPRIMÉS du store, ce qui est le seul
  test qui prouve que plus rien ne les référence.
- **⭐ UN FICHIER DE LA BONNE TAILLE AVEC LE BON NOMBRE D'IMAGES PEUT ÊTRE ILLISIBLE** (01/09).
  Un burn lancé en arrière-plan a survécu à la mort de son shell ; j'en ai relancé un second sur le
  MÊME `--out`. Résultat : `exit=0`, 23 507 images, 783,566667 s, 6,74 Go — et **11 415 erreurs de
  décodage**. Aucun contrôle de forme ne pouvait le voir ; seul le décodage intégral l'a montré.
  Le signal d'alerte était ailleurs et je l'avais lu sans le comprendre : la VITESSE, 0,27× au lieu
  de 0,63×, parce que deux encodeurs se partageaient la machine. *Une lenteur inexpliquée est une
  information, pas une nuisance.* Mécanisé : `burn.mjs` refuse de démarrer si un `ffmpeg` écrit déjà
  le fichier de sortie.
- **⭐ UN GARDE NEUF QUI SORT NÉGATIF SE SUSPECTE AVANT DE SE CROIRE** (01/09). Ce verrou a demandé
  **trois** essais, chacun vert à tort : ① `pgrep -fl` n'imprime que le NOM du processus sur macOS
  (`-f` sert à MATCHER, pas à AFFICHER) ; ② `ps` TRONQUE la ligne de commande à la largeur du
  terminal — or `--out` est le dernier argument, le seul qui compte — et réencode les accents
  (« Vidéos » → « VidM-CM-) »), donc comparer un chemin complet ne matche jamais ; ③ la regex était
  ancrée sur `^ffmpeg` alors que `ps` imprime « <pid> <commande> ». Trois fois le garde s'est déclaré
  vert sans rien voir. Il n'a mordu qu'au 4ᵉ jet, testé contre un burn RÉELLEMENT en cours. Corollaire
  pratique : *un garde qui interroge le système se valide contre la SORTIE RÉELLE de la commande,
  jamais contre l'idée qu'on s'en fait* — deux minutes de `ps | grep` auraient économisé trois tours.
- **⭐ UN INSTRUMENT QUI SE TROMPE DANS LE SENS DE L'ALERTE FAIT CORRIGER CE QUI N'ÉTAIT PAS CASSÉ**
  (01/09, la leçon la plus chère de la journée). `vad.py` annonçait deux blocs en avance que rien ne
  rattrapait. Remesuré **avec sa propre grandeur** — l'énergie en bande vocale 300-3400 Hz, et non un
  RMS large qui ne distingue pas la voix de l'ambiance de rue — la parole de F10 commence à 0,04 s et
  celle de F23 à 0,28 s : les deux « défauts » n'existaient pas. Cause : la remontée s'arrêtait à la
  première fenêtre sous le seuil bas, or une plosive dure 20 à 60 ms et plonge sous ce seuil ; l'onset
  tombait après la première consonne dure. **Coût réel** : cinq blocs recalés pour rien, dont F03 mis
  à 0,92 s de RETARD. Un faux négatif laisse passer un défaut ; un faux positif en FABRIQUE un, et la
  correction est bien réelle. Deux règles : ① *une sonde se réfute avec la grandeur qu'elle mesure*,
  pas avec une grandeur voisine plus commode — mon premier RMS large ne pouvait rien trancher ;
  ② *avant d'agir sur une alerte, vérifier que la chose alertée existe* — surtout quand l'action est
  irréversible sans backup.
- **⭐ CE QUI SÉPARE DEUX RÉGIMES N'EST NI LE NIVEAU NI LA CONTINUITÉ, C'EST LA DENSITÉ** (01/09).
  Trois versions de la remontée d'onset, deux fausses : la continuité stricte au seuil bas rate les
  attaques (F10 à 0,50 au lieu de 0,04) ; un trou toléré de longueur fixe les rattrape mais laisse
  passer un claquement de rue isolé (F01 remonte à 1,64 au lieu de 2,66) — un trou fixe ne distingue
  pas une plosive d'un silence, les deux sont des creux. Ce qui tranche : la parole tient un **régime
  dense** de 0,2 s (syllabes et plosives alternées), l'ambiance ne fait que des **pics isolés**.
  Validé dans les trois sens avant de servir — les deux cas ratés, le cas connu vrai, et le test de
  décalage connu de 2,000 s.
- **⭐ VIDER LA LISTE DES EXCEPTIONS EST LE SEUL MOYEN DE SAVOIR S'IL EN RESTE** (01/09). Les réserves
  déclarées dans le plan de burn rendent la dette visible, mais elles rendent aussi le garde vert :
  tant qu'on ne les efface pas, on ne sait pas si elles sont encore méritées. Effacées en fin de
  chantier, deux se sont révélées être des faux positifs de la sonde et la troisième a été levée en
  replaçant une frontière sur le signal. *Une tolérance est une hypothèse comme une autre : elle se
  remesure, elle ne se reconduit pas.*
- **⭐ UN RÉGLAGE UNIQUE NE PEUT PAS CONVENIR À 27 CAS — FABRIQUER DES CANDIDATS, LAISSER LA MESURE
  DÉSIGNER** (01/09, 3ᵉ passe sous-titres). J'ai cherché LA bonne valeur d'air de rognage pendant deux
  tours ; c'était une impasse par construction, chaque bloc étant enregistré dans une ambiance
  différente. Ce qui a débloqué : produire **plusieurs** donneurs d'horloge (airs 0,00 · 0,15 · 0,40 ·
  et un négatif qui mord dans la parole) et, POUR CHAQUE BLOC, retenir celui que la mesure désigne —
  ordre de préférence écrit en clair AVANT d'être codé (① ne pas partir avant la voix ② le plus
  synchrone ③ le mieux apparié), jamais des poids réglés à l'aveugle. Résultat : 10 blocs en avance
  → **2**. Généralisable : quand un paramètre unique doit servir des cas hétérogènes, il n'y a pas de
  bonne valeur — il y a un espace de candidats et un critère de choix.
- **⭐ UNE EXTRAPOLATION QUI SORT DU DOMAINE MESURÉ N'EST PAS UNE ESTIMATION, C'EST UNE INVENTION**
  (01/09). Quand le donneur avait perdu les premiers mots, je reportais les écarts d'ORIGINE en amont
  du premier mot apparié — ce qui les repoussait AVANT le début du bloc, donc l'ASS était clampé à la
  borne et le recalage ne servait à rien (F03 restait à +0,99 s malgré 100 % d'appariement). Or les
  deux bouts étaient connus : l'attaque de la voix (`vad.py`) et le premier mot apparié. Ces mots ont
  été dits ENTRE les deux — on les répartit dans cet intervalle. F03, F17, F25 passent à +0,000 s.
- **⭐ UN REMÈDE A BESOIN DE SON PROPRE GARDE** (01/09). L'ancrage forcé du premier mot sur la voix
  corrigeait bien l'avance… en tassant 9 mots dans **0,03 s** sur F23, c'est-à-dire en refabriquant le
  « déjà consommé » du monteur par une autre porte. Le remède ne s'applique donc que si chaque mot garde
  au moins le plancher de remplissage ; sinon il se REFUSE lui-même et le imprime. *Corriger un défaut
  en recréant l'autre n'est pas une correction* — et un remède qu'on n'a pas borné en est un.
- **⭐ UNE LEÇON CORRIGÉE À UN ENDROIT SE PORTE AUX AUTRES QUI ONT LA MÊME FORME** (01/09, payé le jour
  même où je l'avais écrite). J'ai corrigé la tolérance d'arrondi (0,001 → 0,02 s) dans
  `subs-controle.mjs`, pas dans `subs-recale.mjs` : celui-ci a donc recalé F18 sur sa **deuxième**
  ligne, et les deux outils se contredisaient sur le même fichier. La question qui suit toute
  correction n'est pas « ai-je bien corrigé celui-ci » mais **« qui d'autre a la même forme »** —
  déjà écrit pour les pools d'`arbo.mjs`, et repayé ici en quelques heures.
- **⭐ UNE LEÇON N'EST TENUE QUE QUAND ELLE VIT DANS LE PASSAGE OBLIGÉ** (01/09, consolidation). Le
  même défaut de sous-titres a été signalé DEUX fois par le monteur. Après le premier tour, la leçon était
  écrite partout — SKILL, README, INDEX, RESTITUTIONS — et le second tour l'a quand même laissée
  passer, parce qu'une doctrine ne s'exécute pas. Ce qui a réglé le sujet n'est pas un paragraphe de
  plus, c'est **`burn.mjs` qui refuse de démarrer** : le burn est le seul point par lequel un ASS
  devient un master livrable, donc c'est là que le garde doit vivre — pas dans `subs-blocs.mjs`, qu'on
  contourne en éditant l'ASS à la main, ni dans ma discipline. Réflexe généralisable : après avoir
  compris un défaut, **chercher le goulot par lequel il DOIT repasser**, et y poser le refus. Trois
  détails font la différence entre un garde et un décor : ① il **bloque** au lieu d'avertir ; ② une
  dimension qu'il ne peut pas mesurer est annoncée **NON MESURÉE** et fait échouer, sinon on le
  désarme par simple omission ; ③ les exceptions se **déclarent et se chiffrent** dans l'artefact
  (ici `subs_controle.avance_toleree`), jamais en baissant le seuil — une réserve non listée bloque,
  une réserve listée qui empire bloque aussi. Éprouvé sur ses cas connus FAUX avant de servir : 4/4
  dimensions rouges sur l'ASS d'avant les correctifs, 4/4 vertes sur celui livré.
- **⭐ UNE TOLÉRANCE PLUS FINE QUE L'ARRONDI DU FICHIER REND UN INSTRUMENT AVEUGLE** (01/09). Mon
  contrôle de parallélisme cherchait le premier sous-titre d'un bloc avec `st >= t0 − 0,001 s`, sur des
  timecodes ASS arrondis au **centième**. Un évènement posé pile sur la borne sort à 71,03 quand la borne
  vaut 71,033 : il tombait sous la tolérance et le contrôle passait au SUIVANT. Résultat, trois blocs
  mesurés faux et dans le sens rassurant — F03 annoncé à +0,003 s alors qu'il est à +1,00, F18 à
  −0,267 s alors qu'il est à +0,70. J'ai failli écrire une restitution disant qu'ils étaient corrigés.
  *La tolérance d'une comparaison se règle sur la PRÉCISION du fichier qu'on lit, pas sur celle qu'on
  aurait voulue* — et un contrôle qui saute une valeur ne dit pas « rien à signaler », il ne dit rien.
- **⭐ UNE GARDE SE POSE SUR L'ARTEFACT LIVRÉ, PAS SUR UN ÉTAT DE PASSAGE** (01/09). La garde « le texte
  n'a pas bougé » de `subs-recale.mjs` s'exécutait avant les deux dernières transformations : elle a
  déclaré « ✓ 1 097 mots à l'identique » sur un fichier où le plancher avait ensuite mangé une **virgule**
  (huit champs ASS comptés au lieu de neuf). libass lisait alors le premier mot comme un EFFET — le mot
  DISPARAISSAIT de l'image, sans rien changer au texte du fichier. Défaut trouvé par `subs-gate.mjs`, qui
  regardait le RENDU. *Une garde placée avant la fin de la chaîne ne prouve rien sur ce qui sort.*
- **⭐ DÉPLACER UN ARTEFACT RÉVÈLE QUI LE RÉFÉRENÇAIT SANS GARDE** (01/09). En rangeant le `.ass`
  livré du store vers le repo, le `burn-plan-4k.json` s'est mis à pointer dans le vide — et le burn
  sortait en **code retour 0**. Parce que `ass=` sur un fichier absent ne fait pas échouer ffmpeg :
  il rend le film ENTIER, simplement **sans sous-titres**, un défaut qui ne se voit qu'au visionnage,
  après l'encodage. Même famille pour un `fontsdir` vide (libass retombe sur une police système : le
  film sort avec la mauvaise typo). Deux règles : ① *un déplacement délibéré est un excellent test
  d'intégrité — le faire EXPRÈS coûte moins cher que de le subir* ; ② **tout chemin lu dans un plan
  se contrôle avant d'encoder**, pas seulement celui de la vidéo.
- **⭐ UN DOSSIER PASSÉ À UN OUTIL TIERS EST SON TERRITOIRE** (01/09). La table d'avances de
  `subs.mjs` dormait dans `assets/fonts/`, qui est le `fontsdir` que **libass énumère** : il tentait
  de l'ouvrir comme une police et imprimait `Error opening memory font` à chaque burn. Sans effet
  sur l'image — mais *un bruit permanent dans les logs finit par masquer un vrai message*. On ne
  range dans le dossier d'un tiers que ce qu'il sait lire. Reproduit et prouvé **à coût nul** : un
  `ffmpeg` d'UNE image avec le même filtre, 2 occurrences avant, 0 après — pas un burn de 27 min.
- **⭐ UNE PREUVE CHÈRE EST UNE PREUVE QU'ON NE PREND PAS** (01/09). `select='eq(n,N)'` décode
  depuis le début : **165,7 s** pour l'image 23 400 d'un master 4K. Une preuve à deux minutes se
  prend moins souvent qu'une preuve à deux secondes, et une preuve qu'on ne prend pas ne prouve
  rien — donc *le coût d'une preuve est un sujet d'outillage, pas de patience* (`frame.mjs`, ×122).
  Et le piège payé en l'écrivant : ma première version sortait l'image **N+1** (le pts de l'image N
  vaut exactement N/fps, un seuil flottant tombe un cheveu au-dessus ; seuil corrigé à
  **(N − 0,5)/fps**). L'image « avait l'air bonne » — c'est le **md5 contre la voie lente** qui l'a
  montré. *Un raccourci se valide contre la méthode lente qu'il remplace, jamais à l'œil* : c'est
  la même exigence que « un instrument se réfute par une mesure du même ordre ».
- **⭐ UN INSTRUMENT QUI DÉDUPLIQUE NE PEUT PAS PROUVER UNE ABSENCE** (05/09). le monteur a signalé
  **cinq** défauts de parole à la main sur un master facecam livré la veille comme « prouvé » :
  3 relances, un « euhhh » de 0,76 s, un mot amputé. Ma preuve de contenu était la re-transcription
  du rendu — et elle **ne pouvait pas** les voir : **whisper fusionne deux prises identiques
  consécutives.** Mesuré sur le bloc fautif : la fenêtre entière rend UNE phrase, les deux bursts
  transcrits séparément en rendent DEUX. Pire, j'avais utilisé cet instrument pour *disculper* trois
  blocs (« 3 faux positifs sur 4 »), donc il m'avait fait écrire une conclusion fausse **dans le sens
  rassurant**. Règle : *avant de conclure d'une absence, se demander si l'instrument est capable de
  montrer la chose absente* — et, pour de la parole, **ne jamais transcrire une fenêtre qui contient
  plusieurs bursts** : on découpe au silence, on transcrit chaque morceau SEUL, on compare.
  Corollaire, sur le « euh » collé à la parole : il n'est pas un burst, whisper l'écrit « … ». Ce qui
  le distingue physiquement d'une syllabe, c'est qu'il **ne s'articule pas** — ses formants ne bougent
  plus. On le mesure donc à la **stabilité spectrale**, et on ne le confirme qu'en transcrivant la
  seule plage (< 1 s, où aucune phrase ne peut être fabriquée). Éprouvé sur 7 plages d'un même bloc :
  la seule qui rende un filler est le vrai « euh ».
  Et le défaut le plus retors du lot : **un mot amputé reste lisible au texte.** « dynasties » rogné
  de 0,37 s se transcrit « dynasties » ; aucun contrôle textuel ne peut le voir. Seule la **frontière
  de silence** le dit — un test qui existait dans `sweep.mjs` **depuis le 02/08** et n'avait jamais
  été porté au contrôle final. Livré : `facecam/parole.mjs` + `parole.py`, **appelés par
  `render.mjs` qui REFUSE de livrer** — parce que la veille la leçon était déjà écrite dans
  RESTITUTIONS et n'avait rien empêché.
  ⭐ **Et la suite, payée le 06/09 : le garde a demandé CINQ corrections avant de servir, et son
  faux verdict le plus cher était ROUGE, pas vert.** Le test « la borne tombe-t-elle dans un
  silence » appliqué aux DEUX bornes a crié sur **9 spans sur 44**, en proposant à chaque fois
  « a → premier silence suivant » — c'est-à-dire de **supprimer la phrase**. Cause : `refine`
  avance `a` par probe jusqu'au premier mot de contenu, donc elle tombe VOLONTAIREMENT dans la
  parole. *Un proxy qui vaut pour une borne ne vaut pas pour l'autre : c'est le DÉFAUT cherché qui
  décide du test, pas la symétrie du code.* Et le même critère vivait en **deux exemplaires** avec
  des seuils différents (`sweep.mjs` d=0.08, le garde d=0.10) : deux bornes validées par l'un
  étaient condamnées par l'autre — *quand deux outils mesurent la même grandeur et se contredisent,
  l'un des deux ment, et on ne le saura jamais tant que la règle vit en deux endroits.*
  Trois autres faux positifs de la même veine, tous plausibles : élargir une fenêtre en amont fait
  entrer le bloc PRÉCÉDENT ; une divergence de transcription (0,02 s) n'est pas une perte de
  contenu ; une plage stable prise **au milieu d'un mot** se transcrit « Euh… » elle aussi.
  Enfin, le cas de test fabriqué pour vérifier que le garde MORD n'a d'abord rien attrapé : je
  sabotais l'EDL alors que le garde lit le MASTER. *Un cas de test doit être injecté là où l'outil
  regarde vraiment, sinon son silence ne prouve rien.*
- **⛔ LA CHAÎNE DE REFUS — ce qu'il est désormais IMPOSSIBLE de livrer sans contrôle** (18/09).
  le monteur : « que tu les contrôles strictement avant d'avoir fini de livrer ». La réponse n'est pas
  une promesse de discipline, c'est une chaîne où chaque étage refuse de consommer ce que
  l'étage d'avant n'a pas signé. À relire avant de dire « c'est rendu » :

  | étage | il REFUSE de démarrer si… | réserve, qui s'écrit et se chiffre |
  |---|---|---|
  | `facecam/render.mjs` | le master porte une relance, un euh ≥ 0,30 s, une queue perdue, une borne `b` dans un mot, **une borne `a` qui AMPUTE le début de la phrase** (19/09), **un blanc de tête > 0,30 s**, ou une dimension **NON MESURÉE** | `_reserves_parole` dans l'EDL |
  | `facecam/render.mjs` | le plan de coupe contient un **MICRO-SEGMENT** — un keep de moins de 8 images (19/09). Posé **avant** l'encodage : un garde qui mord après 17 min de ré-encodage est un garde qu'on désarme | `_reserves_micro` dans l'EDL |
  | `facecam/render.mjs` | **aucune carte ne connaît les clips de l'EDL** — sinon la dimension QUEUE est muette et le quitus écrit quand même « toutes dimensions mesurées » (19/09) | `MONTAGE_QUEUE_RESERVE="<pourquoi>"` |
  | `vlog.mjs` | le master facecam n'a **pas de quitus**, ou son quitus est **périmé** (empreinte) ou en **échec** | `MONTAGE_QUITUS_RESERVE="<pourquoi>"` |
  | `vlog.mjs` | le master facecam n'est **pas CFR** (l'image se coupe par index, le son en secondes) | `MONTAGE_HORLOGE_TOL=<s>` |
  | `vlog.mjs --dry` | un **carton de ville** tombe après le bloc qui la nomme | `RESERVE_CARTON <Ville>` dans l'EDL |
  | `facecam/overlays/burn.mjs` | l'ASS n'a pas passé `subs-controle.mjs`, ou un ffmpeg écrit déjà la sortie. Sa dimension VOIX mesure le **silence AVÉRÉ de tête** (`vad.py --tete`), jamais un onset, et un bloc qu'elle ne sait pas mesurer la fait ÉCHOUER au lieu d'être sauté (20/09) | `subs_controle.avance_toleree` |
  | `facecam/overlays/burn.mjs` | le plan ne déclare pas de **lexique** — sans lui la dimension TEXTE (graphie fausse survivante, accord après un nombre) est aveugle, et c'est par ce trou que deux fautes d'accord sont parties dans le master (20/09) | `subs_controle.texte_tolere` |
  | `facecam/overlays/coller-generique.mjs` | la durée ne vaut pas master + générique, l'origine n'est pas à zéro, le fondu final ne descend pas, ou le décodage intégral rend une erreur (20/09) | aucune — le livrable non prouvé est SUPPRIMÉ |
  | `musique.mjs` | un cue joue une **fenêtre morte** — plus de 4 s à plus de 20 dB sous la médiane de la fenêtre RÉELLEMENT jouée (20/09) | `MUSIQUE_CREUX_RESERVE=<s>` |
  | `facecam/overlays/mot-litigieux.mjs` | son **témoin ne mord pas** : il se récuse au lieu de trancher. Et il rend **INDÉCIDABLE** plutôt qu'un gagnant quand les modèles rendent l'amorce (20/09) | aucune — l'indécidable remonte au monteur |

  **Le trou que ça bouche, et qui était béant jusqu'au 18/09** : `parole.mjs` sortait en code 1
  … et le master restait sur le disque. `vlog.mjs`, l'étage qui fabrique l'épisode que le monteur
  REGARDE, ne lui demandait rien. Un master recalé devenait donc l'épisode, sans que le garde
  ait jamais tourné dessus — et le master du #03 avait de toute façon été rendu AVANT que la
  dimension « blanc de tête » n'existe. *Un refus qui n'empêche pas l'étage suivant de consommer
  l'objet n'est pas un refus, c'est un avertissement.* Le quitus (`<master>.parole.json`) porte
  l'**empreinte** du master, donc re-rendre le périme tout seul ; il est **effacé avant** le
  contrôle, pour qu'un plantage en cours de route ne laisse pas un « oui » par défaut.

  ⚠️ **Et un `exit 1` ne dit pas QUEL garde a mordu.** Quand plusieurs refus se suivent, vérifier
  le MESSAGE, pas le code retour — sinon on croit avoir validé un garde qui n'a jamais tourné,
  parce qu'un autre a mordu avant lui.

- **⭐⭐ QUAND TOUTES LES VALEURS D'UN RÉGLAGE DONNENT LE MÊME RÉSULTAT, C'EST LE CAS DE TEST
  QU'IL FAUT SUSPECTER, PAS LE RÉGLAGE** (19/09, la plus chère de la nuit). Le vrai pic du master
  dépassait : j'ai voulu vérifier que `alimiter` bornait vraiment, et je l'ai éprouvé sur un sinus
  de `lavfi`. `limit=-1dB`, `-1.5dB`, `0.891`, `0.841`, `0.125` — **−18,1 dB à chaque fois.** J'en
  ai conclu que le paramètre était ignoré, donc que le limiteur n'avait jamais borné, donc que la
  correction du 18/09 était un décor. J'ai failli réécrire un filtre qui marche.
  La cause : **le sinus brut est à −18,1 dBFS**, c'est-à-dire SOUS tous les plafonds testés. Aucun
  n'avait de quoi mordre, donc tous rendaient la même chose. Remis à +12 dB, le filtre se range
  exactement où on le lui demande (`limit=0.5` → −6,1 dB · `limit=0.125` → −18,1 dB).
  C'est le cousin d'AMPLITUDE de « un cas de test qui ne dure pas » (01/09, qui est son cousin de
  DURÉE) : *un cas de test doit FRANCHIR le seuil qu'on éprouve, sinon son silence ne prouve rien.*
  Et le signal qui aurait dû alerter était là dès la première ligne — **l'invariance**. Quand un
  réglage n'a aucun effet sur toute sa plage, deux lectures s'ouvrent : « il est ignoré » et « le
  cas ne l'atteint pas ». La seconde se vérifie en une commande (mesurer l'ENTRÉE), la première
  coûte une réécriture. On prend la moins chère d'abord.
- **⭐ L'EXEMPTION QU'ON S'ACCORDE À UNE RÈGLE EST EXACTEMENT LE MOMENT OÙ ELLE SERVAIT** (19/09).
  « Un seul réglage par tour » est écrit dans ces garde-fous depuis le 31/07. J'ai changé, dans le
  MÊME rendu, l'in-point musical et le plafond du limiteur — en me disant que les deux avaient
  chacun leur grandeur mesurable, donc que la règle ne s'appliquait pas. Faux : les deux
  atterrissent sur le VRAI PIC. Résultat, il passe de −0,7 à −0,5 dBTP et **je ne peux attribuer
  ce 0,2 dB à personne** ; 25 minutes de rendu dont la leçon est inutilisable.
  *Deux réglages qui touchent la même grandeur de sortie ne sont pas indépendants, même quand
  chacun a sa propre mesure.* Le test n'est pas « ces changements sont-ils de natures
  différentes ? » mais **« partagent-ils un nombre dans la preuve finale ? »** — s'ils le
  partagent, c'est deux tours.
- **⭐ UN ARTEFACT CHOISI PAR SON NOM N'EST PAS L'ARTEFACT DU MONTAGE** (19/09). `render.mjs`
  passait au garde la première carte qui matchait `^carte.*\.json$` : dans le dossier de
  coulisses de l'EP3, c'est `carte-aout.json` — la carte de l'épisode **#02**. Ses clips
  s'appellent c12…c27, ceux de l'EP3 c28/c29, donc `island()` ne résolvait AUCUN span : la
  dimension QUEUE n'a jamais tourné, et le quitus a écrit « toutes dimensions mesurées ».
  Pire qu'un garde muet — un garde qui **déclare** avoir regardé. Un défaut réel y a survécu.
  La carte est désormais **validée contre les clips de l'EDL**, et l'absence de carte valide
  fait échouer. *Une définition déduite d'un NOM n'est pas une définition* — écrit le 01/09
  pour les lignées de purge d'`arbo.mjs`, jamais porté ici : « qui d'autre a la même forme ? »
  avait une réponse.
- **⭐ UNE CAUSE ÉCRITE DANS UNE NOTE EST UNE HYPOTHÈSE COMME UNE AUTRE** (19/09). La dette du
  18/09 disait que les 4 réserves `air` venaient de `MIN_ILE` jetant une île courte. Remesuré :
  **aucune île courte n'est jetée** — `iles()` rend une seule île qui commence simplement
  0,32-0,44 s trop tard, parce que sa remontée s'arrête sur une pause intra-phrase. J'ai
  d'abord corrigé la cause écrite (recollage des îles courtes) et la mesure n'a pas bougé d'un
  centième : c'est ce qui a montré que la note se trompait. *On ne répare pas une cause qu'on
  n'a pas remesurée* — et une correction qui ne change AUCUN chiffre est une information.
  La sortie n'était pas de réparer l'instrument mais de poser la bonne question : « combien de
  SILENCE AVÉRÉ devant la voix », jamais « où commence l'île ».
- **⭐ UN PROXY À SEUIL ABSOLU FABRIQUE DES DÉFAUTS** (19/09). La note de reprise annonçait
  6 spans avec un micro-segment de tête, mesurés par la différence image à image au seuil
  **absolu** 0,60. Normalisée par la médiane interne du span, la même mesure n'en désigne plus
  qu'**un** (5,3× sa médiane ; les cinq autres entre 1,6× et 2,6×, c'est-à-dire du mouvement de
  facecam ordinaire). Et le plan de coupe, qui ne se trompe pas, dit la même chose : un seul
  span porte un keep de 2,8 images. *Deux instruments indépendants qui concluent pareil valent
  mieux qu'un seuil* — et corriger les cinq autres aurait été fabriquer cinq défauts pour
  réparer un défaut inexistant.
- **⭐ UN REPLI DONT LA CONDITION EST PLUS ÉTROITE QUE LE DÉFAUT NE SE DÉCLENCHE JAMAIS**
  (19/09, côté musique). `assignTracksNoRepeat` retombait sur le vivier entier si le vivier
  spécialisé était **vide** — le seul cas où ce repli ne sert à rien. Le vivier neuf du monteur
  classe 6 pistes sur 7 en `beat` : le pool ambient en contenait **une**, le repli ne partait
  pas, et la même piste serait revenue sur les 5 cues, c'est-à-dire exactement « tu mets 2× la
  même musique ». La bonne condition n'est pas « vide » mais « incapable de servir sans se
  répéter » : au moins autant de pistes que de cues.
- **⭐ UN GARDE NE COUVRE QUE LA DIMENSION QU'IL REGARDE — ET « TROP TÔT » N'EST PAS
  « TROP TARD »** (18/09). `parole.mjs` savait dire « la borne `a` coupe un mot » et il est
  sorti **VERT sur les quatre spans que le monteur a signalés à la main**. Cause : il n'avait aucun
  test pour la borne posée trop TÔT — le blanc avant l'attaque de voix. Les deux défauts sont
  opposés, et corriger l'un n'apprend rien sur l'autre. *Après avoir couvert un défaut,
  chercher son SYMÉTRIQUE avant de chercher un défaut voisin.* Refus livré : dimension `air`,
  tolérance **0,30 s** — un chiffre DÉRIVÉ des verdicts du monteur (il a signalé 0,92 · 1,18 ·
  1,84 s ; il a laissé passer 0,00 · 0,18 s), jamais choisi.
- **⭐ LE REMÈDE D'UN DÉFAUT PEUT AVEUGLER LE GARDE D'UN AUTRE** (18/09). La relance de
  `disneylandisation-patrimoine` était invisible pour `parole.mjs` **par construction** :
  `render.mjs` comprime les silences (silThresh 0,35 → silTarget 0,16), donc la pause de
  0,36 s qui séparait la fausse prise de la reprise tombe sous le seuil de découpe ; les deux
  prises deviennent UN burst, et whisper — qui déduplique — n'en rend qu'une phrase. Le garde
  cherchait le défaut dans l'artefact où le remède venait de l'effacer. *Un garde se pose là
  où le défaut est encore VISIBLE, pas là où l'objet final est commode à lire.* Refus livré :
  le test de relance lit désormais la **source**.
- **⭐ ET LA DÉCOUPE EN BURSTS SE FAIT DANS LA BANDE VOCALE, comme tout le reste** (18/09).
  Seconde moitié de la même cause : `silencedetect` mesure l'énergie LARGE, et sur un rush
  tourné dans la rue le fond de salle ne descend jamais sous −26 dB — la pause de la reprise
  n'était donc pas vue **même sur la source**. `vad.py` (300-3400 Hz, régime dense) l'y trouve.
  La leçon « une sonde se réfute avec la grandeur qu'elle mesure » était écrite le 01/09 pour
  les sous-titres et n'avait jamais été portée ici. **« Qui d'autre a la même forme ? » avait
  une réponse, et personne n'était allé la chercher.**
- **⭐ ON NOMME LA VILLE AVANT D'EN PARLER** (le monteur, 18/09) — et c'est un refus, pas une règle de
  trame. Le carton de ville précède le premier bloc facecam qui la nomme. Mesuré sur le master
  du 17/09 : **5 cartons sur 8** tombaient après. le monteur n'en avait vu qu'un. Refus dans
  `vlog.mjs --dry` (2 s) plutôt que dans `VLOG.md` (qui se relit mais ne s'exécute pas) ;
  réserve = ligne `RESERVE_CARTON <Ville>`, listée et chiffrée dans la sortie.
- **⭐ UNE HORLOGE QU'ON N'A PAS MESURÉE SE REFUSE, ELLE NE SE CORRIGE PAS AU JUGÉ** (18/09).
  `vlog.mjs` découpe l'image par INDEX et le son en SECONDES : ça ne tient que sur un master
  CFR. Mesuré sur le master facecam du #03 : 0 recul de pts, mais `|pts(n) − n/fps|` passe de
  +0,021 s à **+0,376 s**. Le signalement du monteur (« le son est décalé de mes paroles ») est
  donc confirmé. Recaler le son sur `pts` était la piste évidente — la corrélation croisée
  laisse un résidu qui grandit encore (+0,038 → +0,146 s), donc **ce n'est pas prouvé**.
  On BLOQUE et on le dit, au lieu de corriger dans une grandeur voisine et de fabriquer le
  défaut symétrique (31/08, bornes de F36). Réserve chiffrée : `MONTAGE_HORLOGE_TOL`.
- **Jamais publier** : l'upload YouTube est **manuel** (le monteur valide et clique ; proxy SOCKS via VPS pour la Chine).
- **Ne pas déporter** le montage sur le VPS (pas de GPU, disque plein, il héberge la prod).
- **Un overlay ne se juge JAMAIS sur le PNG à alpha seul** : composite-le sur la vraie image avant de trancher
  (un panneau à 62 % d'opacité disparaît sur un décor sombre). Et son **côté se mesure** (`freespace.py`),
  jamais à l'œil : le halo d'ombre compte dans le dégagement.
- **Clôture = preuve** : un montage n'est « fait » qu'avec une frame extraite + Read (ou la vidéo ouverte),
  jamais sur la seule foi du log. Piloter l'itération par les **badges R##** + le **timecode** gravés (brouillon).
- **⭐ LE SON SE MESURE AUSSI, et il ne se prouve PAS par la durée totale** (le monteur, 30/07). Une durée
  finale juste ne prouve rien sur la synchro : sur le VLOG #01 le total collait à 20 ms près alors
  que les lèvres dérivaient jusqu'à 1,2 s en fin de film. Ce qui se mesure, morceau par morceau :
  (1) **durée du FLUX vidéo vs durée du FLUX audio** de chaque segment, en CUMULÉ — un concat
  démuxer `-c copy` fait avancer les deux flux indépendamment ; (2) le **`start_time` de chaque
  flux vidéo** — un segment qui démarre à 0,033 s se traduit par un trou inséré au concat ;
  (3) la **synchro réelle**, par corrélation croisée du rendu contre la source (son ET image,
  séparément : c'est leur ÉCART qui est la désynchro, pas leur valeur). Un montage qui contient
  de la parole ne se clôt pas sans ces trois chiffres.
- **Clôture = TABLEAU DE RESTITUTION** (le monteur 27/07) : toute itération de montage rend un tableau propre,
  une ligne par rush du jour — `R## · durée source · décision (CUT total / fenêtre) · durée gardée ·
  pourquoi` + une ligne de bilan `avant → après`. Aucun rush passé sous silence.
  ⚠️ Ce tableau **s'ÉCRIT dans `RESTITUTIONS.md`** (repo, donc versionné et transportable), pas seulement
  dans le chat : le monteur doit pouvoir en redemander l'historique plus tard. Une entrée par journée montée,
  jamais réécrite — un re-montage AJOUTE une entrée datée. Le `plan.txt` du store, lui, est écrasé à
  chaque jour ; la fiche `lecture-<jour>.md` reste dans le store et n'est pas versionnée.
- **⭐ TOUCHER AU CODE = METTRE LA DOC À JOUR, dans le MÊME commit** (le monteur, 29/07). Pas « plus tard »,
  pas « quand j'aurai fini » : le commit qui change un comportement porte la ligne de doc qui le dit.
  Ça couvre l'en-tête du fichier modifié, `INDEX.md` (table des outils + boucle), `STYLE.md` si une
  règle bouge, et `node toc.mjs` derrière toute édition de STYLE.
  **Pourquoi c'est un garde-fou et pas du confort** — le 29/07, TROIS docs périmées m'ont fait lire
  la roadmap au lieu du code, dans la même session : `STYLE §F` annonçait « non fait » un cran livré
  (j'ai failli le refaire), `INDEX` disait encore « 7 s = plafond absolu » après correction de la
  règle, et l'en-tête de `musique.mjs` n'annonçait pas `plan` — ce qui m'a fait demander au monteur
  d'arbitrer une question à laquelle le code répondait déjà. Le coût n'est pas cosmétique : c'est du
  travail refait et des décisions demandées pour rien.
  **Corollaire opérationnel** : avant d'annoncer qu'une capacité MANQUE, lire le code qui la
  porterait. Une doc qui dit « non fait » n'est pas une preuve.
- **⭐ UNE CONTRAINTE DE FORME DÉSARME UN TEST EXACTEMENT SUR LE CAS QU'ELLE N'A PAS VU** (20/09).
  `isEcho()` cherchait la « même amorce » **à condition que la fausse prise soit la plus COURTE**
  (`b.length >= a.length`). Sur `rushs-perdus` le monteur part long, s'emmêle (4,98 s), puis reprend
  SERRÉ (2,66 s) : la contrainte éteignait le test au moment précis où il devait mordre, et le
  garde est sorti VERT sur un master livré — le 2ᵉ tour du même signalement. Or les **7 premiers
  mots sont identiques**. C'est la 3ᵉ fois que ce motif se paie sur ce même fichier (test de
  redite 18/09, test d'amorce ici) : *un proxy choisi sur un exemple ne couvre que la forme de
  cet exemple.* Règle : **c'est le DÉFAUT cherché qui décide du test, pas la forme du cas qui l'a
  fait écrire** — une relance ne dit nulle part laquelle des deux prises est la plus longue.
  Corollaire de contrôle : un test à deux sens ne vaut que si le sens NÉGATIF peut échouer. Un
  span à 1 burst ne peut pas déclencher un test de relance ; le vrai contrôle négatif, c'est les
  **44 spans** (0 faux positif), pas un span choisi parce qu'il est « connu propre ».
- **⭐⭐ LE CORPUS D'UN LEXIQUE EST CELUI DE LA CHAÎNE QUI VA S'EN SERVIR, PAS CELUI D'À CÔTÉ**
  (20/09). Le lexique de l'EP3 a été bâti sur `carte-episode3.json` — « Cheyenne » pour Xi'an,
  « Pinggao » pour Pingyao, « Terquitz » pour terre cuite. Mais la carte sort de `map.mjs`, qui
  transcrit des ÎLOTS courts, alors que `subs-blocs.mjs` transcrit des fenêtres de BLOC : avec
  ce contexte, whisper écrit déjà tout correctement et **aucune de ces graphies n'y reparaît**.
  Diffé avec/sans lexique depuis les mêmes caches, sur les 22 blocs : **3 gains, 2 DÉGÂTS** —
  « la capitale ouïghour » (juste) devenait « Ouïghours », « des Ouzbéks » (juste) devenait
  « des Ouzbékistan ». Deux fautes d'accord **brûlées dans l'image**, là où l'outil avait raison.
  Et les 3 gains venaient tous d'une clé EXPLICITE ou d'une `_fusions` ; **aucun du rattrapage
  flou**, qui n'apportait que les dégâts. `_noms` vidé. *Sur un corpus déjà propre, un nom dans
  une liste de rattrapage n'est pas neutre : il ATTIRE* — `ouzbeks` vs `ouzbekistan` sort à 0,64
  pour un seuil de 0,62. Deux réflexes : ① **mesurer ce qu'un outil de correction CHANGE** (diff
  avec/sans, sur le corpus réel) avant de le croire utile — un lexique se juge à son effet, pas à
  son intention ; ② **corriger par le CHOIX** (retirer la cause) plutôt que par la compensation
  (empiler des clés pour rattraper ses propres dégâts).
  ⚠️ Et le trou que ça révèle : **aucune dimension de `subs-controle.mjs` ne regarde le TEXTE**.
  Tag, plancher, horloge, rendu — tout est vert sur un ASS qui dit « des Ouzbékistan ». Ces deux
  fautes ont été trouvées en RELISANT les noms propres de l'ASS livré, pas par un garde.
- **⭐⭐ DISQUALIFIER UN INSTRUMENT PARCE QU'IL RATE SON TÉMOIN, PUIS TRANCHER AVEC UN
  INSTRUMENT QUI N'EN A AUCUN** (20/09, la faute la plus retorse du chantier EP3, parce qu'elle
  se déguise en rigueur). le monteur : « écoute les 4 secondes, c'est ma parole, pas le sens qui
  décide. » Je ne peux pas écouter. J'ai donc ① bâti une analyse acoustique, ② constaté qu'elle
  échouait sur ses propres témoins (ses formants ne séparaient pas le /a/ du monteur de son /ɛ/),
  ③ **eu raison de l'écarter**, puis ④ fait reposer la décision sur un vote de trois modèles
  whisper sur 29 fenêtres — **à qui je n'ai jamais donné de témoin**. Et j'ai écrit « tranché au
  signal » dans la restitution. La correction est partie dans le master.
  Le témoin, posé après coup, a démoli le vote en deux commandes : ① sur « les massifs
  montagneux de l'ouest de la **Chine** » (vérité connue, même locuteur), `large-v3` rend « de
  l'ouest de la **France** » — le modèle SUBSTITUE un mot fréquent à ce qui est dit ; ② amorcés
  (`--prompt`) avec l'une ou l'autre graphie, les 3 modèles **rendent l'amorce** sur la plage
  litigieuse, **dans les deux sens**, alors qu'ils **résistent** sur le témoin. La plage est
  donc **indécidable**, et mon vote ne comptait que le prior qui dominait chaque découpe.
  Trois règles, dont la première est la seule qui compte :
  ① **un instrument sans témoin n'est pas « moins sûr », il est MUET** — on ne sait même pas
  dans quel sens il se trompe, donc son accord avec mon hypothèse ne vaut rien ;
  ② **un vote entre instruments CORRÉLÉS n'est pas une mesure indépendante**, c'est le même
  instrument en plus fort : trois modèles de langue partagent le même prior français, et
  « montagneux » après « relief » est précisément ce que ce prior produit ;
  ③ **le soin apporté à écarter un instrument ne se reporte pas tout seul sur celui qui le
  remplace** — c'est au REMPLAÇANT qu'il faut redemander ses témoins, au moment exact où on se
  félicite d'avoir été rigoureux. *La rigueur dépensée en amont est ce qui rend la suite
  crédible ; c'est pour ça qu'elle est dangereuse.*
  Mécanisé : `facecam/overlays/mot-litigieux.mjs` — test à deux sens, `--temoin` **obligatoire**,
  se **récuse** (sortie 1) si le témoin ne mord pas, et rend **INDÉCIDABLE** (sortie 2) avec
  l'extrait à écouter plutôt qu'un gagnant. Éprouvé dans les trois sens avant de servir.
- **⭐⭐ L'INSTRUMENT QUI A JUGÉ LE LIVRABLE EST LE DERNIER QU'ON PENSE À RÉFUTER** (20/09,
  dette 3). La dimension VOIX de `subs-controle.mjs` — le garde qui a validé les sous-titres du
  master EP3 avant publication — appelait `vad.py` nu, donc `bornes()[0]` : un **onset**, calé sur
  un pic tenu et daté avec des seuils relatifs au **p95 du fichier qu'on lui donne**. Sur un bloc
  de 8,5 s dont la parole monte en volume, l'attaque douce passe sous le seuil : F08 était annoncé
  à **+1,293 s d'avance** alors que sa tête, transcrite seule, dit « C'est une ville qui est plus
  historique ». Une réserve chiffrée a été posée dans DEUX plans de burn pour un défaut inexistant.
  La leçon était déjà écrite à côté, dans `parole.mjs` §(d), depuis le 19/09 : *on ne demande pas
  « où commence l'île » mais « combien de SILENCE AVÉRÉ y a-t-il devant la parole »*. **« Qui
  d'autre a la même forme ? » avait encore une réponse, et c'était un outil du même dossier.**
  Corrigé par un changement de GRANDEUR (`vad.py --tete`, champ `fin`), pas par un seuil.
  ⚠️ Et **la fenêtre étroite que prescrivait la note de reprise a été réfutée par la mesure** :
  sur un bloc qui s'ouvre 3,6 s avant la parole, une fenêtre de 2,5 s rend `debut: null`, donc le
  garde se taisait — un faux négatif silencieux. *Une note qui décrit un remède est une hypothèse
  comme une autre*, y compris quand elle vient de moi la veille.
  ⚠️⚠️ Et le banc à deux sens a trouvé **un angle mort que la dette ne nommait pas** : la
  recherche du 1er sous-titre partait de `t0`, donc un évènement posé AVANT son bloc — l'avance
  MAXIMALE — sortait de la fenêtre de recherche et le contrôle mesurait le suivant. *Un banc qui
  ne teste que le défaut qu'on connaît ne prouve rien sur celui qu'on ne cherchait pas.*
  Réserve `avance_toleree` **vidée** des deux plans après avoir exhibé l'invariant : 21 blocs à
  verdict inchangé, mouvement ≤ 0,02 s (une fenêtre de `vad.py`), F08 à +0,093 s pour un seuil
  de 0,15. Banc : `node facecam/overlays/subs-voix-cas.mjs` (4 cas, 4 sens).

- **⭐ UN AVERTISSEMENT AU MILIEU D'UNE CHAÎNE EST UN REFUS QUI N'A PAS ÉTÉ ÉCRIT** (20/09,
  côté musique). `creuxInternes` existait depuis le 19/09 et il est juste — il n'a pourtant rien
  vu du trou de **18,5 s** du master EP3 (09:42,5–10:01,0, min −40,5 dBFS contre une médiane de
  film à −17,3). Trois causes, toutes déjà écrites ailleurs : ① il **écarte** les creux qui
  touchent les bords du corps utile, pour ne pas confondre un fondu avec un arrêt — or le défaut
  EST dans l'outro ; ② il raisonne sur la PISTE, pas sur la **fenêtre réellement jouée** (le cue
  consomme la piste jusqu'à son dernier échantillon, marge **0,000 s**) ; ③ quand aucun in-point
  n'évite les creux, il **imprime un ⚠ et laisse passer**. Avec 0,000 s de marge il ne pouvait
  de toute façon qu'avertir. *La couverture ne dit rien du niveau de SORTIE* — symétrique exact
  de la leçon du 31/08 sur le niveau d'ATTAQUE, et « qui d'autre a la même forme ? » avait encore
  une réponse. Refus livré dans `musique.mjs` (`refuserSiLitMort`), au goulot où un plan devient
  un rendu, seuil **dérivé** des 5 cues de l'EP3 (sains 0 · 0 · 3 · 0 s, défaut **8 s** → refus
  à 4 s, dans l'écart) et **relatif** à la médiane de la fenêtre, jamais absolu.
  Réserve : `MUSIQUE_CREUX_RESERVE=<s>`.

- **⭐⭐ MA PREUVE A DIT OUI TROIS FOIS AVANT QUE LA GATE DISE NON** (20/09, collage du
  générique). Tour 1 : mon script imprime « ✅ COLLÉ ET PROUVÉ », `gate.py` refuse sur deux axes
  que je n'avais pas pensé à regarder (`start_time` 0,021 s · dernière demi-seconde −37,6 dB).
  *Une preuve qui ne regarde que ce à quoi on a pensé n'est pas une preuve : c'est la liste de
  mes hypothèses.* Tour 2 : mon remède — repasser par du H.264 brut pour remettre l'origine à
  zéro — **marchait sur sa dimension** et cassait les DTS à la jonction des deux GOP. Durée
  juste, origine juste, fondu juste, **2 erreurs de décodage et 2 images perdues** : seul le
  décodage intégral pouvait le voir. *Corriger un défaut en en recréant un autre n'est pas
  corriger*, et un remède qui satisfait le critère qui l'a motivé est le plus difficile à
  suspecter. Tour 3 : la vraie cause était que les sources portaient encore leur **audio** — le
  démuxeur aligne le second segment sur le flux le plus long (l'audio du master finit 14,6 ms
  avant sa vidéo). Réfutés avant d'y arriver : `-avoid_negative_ts make_zero` (0,066 s, pire),
  `disabled`, `-muxdelay/-muxpreload 0`, `-fflags +genpts`, et `-an` sur le concat lui-même.
  Règle : **quand une gate refuse ce que mon propre contrôle a validé, c'est mon contrôle qu'on
  élargit**, pas seulement le défaut qu'on répare — les trois axes manquants vivent désormais
  dans le script.
- **⭐ UNE CONSIGNE QUI CITE UN PRÉCÉDENT CITE CE QUI ÉTAIT VISIBLE DEDANS** (20/09). « Un
  générique de fin comme à l'épisode 1 et 2 » : aux #01 et #02 il avait été livré ISOLÉ dans
  `Éléments/`, j'ai donc livré isolé — et le monteur a répondu « je vois pas le générique de fin
  demandé ? ». Un générique de **FIN** est à la fin du **FILM** ; le précédent portait sur la
  FORME de l'objet (le tracé, le code couleur), pas sur les décisions d'intendance qui
  l'entouraient. Et la faute d'en amont est pire : j'ai justifié « livré isolé » par le coût d'un
  re-rendu **sans lire que `vlog.mjs` sait déjà le faire** (directive `GENERIQUE` + `OUTRO`,
  depuis le #01). *Avant d'annoncer qu'une capacité manque, lire le code qui la porterait* —
  écrit ici depuis le 29/07, et pas appliqué.
- **⭐ COLLER DEUX OBJETS CORRECTS PEUT FABRIQUER UN DÉFAUT QUI N'EST DANS AUCUN DES DEUX**
  (20/09). Le master est prouvé, le générique est prouvé — collés, ils donnent **12,4 s de
  silence complet** sur le carton final, parce que la musique du film vient de se fondre et que
  le générique porte une piste muette (voulu : « la musique du film le couvre »… quand il est
  DANS le film). Mesuré : le film joue encore à −23 dBFS à 12:18 et ne fond que sur ses 1,5
  dernières secondes. Remède : prolonger la piste du dernier cue, qui avait encore 22,1 s devant
  elle, gain **mesuré** (−9,05 dB) et non deviné, fondu qui meurt sur le générique.

- **⭐⭐ L'ARTEFACT VERSIONNÉ N'EST PAS L'ARTEFACT ACTIF** (20/09, l'erreur la plus chère du
  chantier EP3 — évitée pour 2 secondes de `--dry`). L'EDL de l'épisode vit dans le dépôt
  (`vlog/edl/vlog-03.txt`), c'est lui qu'on lit, qu'on diffe et qu'on commite. Mais `vlog.mjs` ne
  le lit **pas** : il lit `Réglages/vlog.txt`, le plan ACTIF du store — et `revlog.mjs` l'appelle
  **sans `--plan`**. Ce fichier portait encore **l'EDL de l'ÉPISODE 02**. Lancée telle que la note
  de reprise la prescrivait, la chaîne aurait rendu l'EP02 en 4K et, par sa surcharge `OUT_2160`,
  **écrasé `VLOG Chine 02 (master 4K 31-08).mp4`** — un livrable fini, en dernier geste d'un run
  de deux heures. Ce qui a sauvé : le `--dry` **imprime le nom des fichiers qu'il va toucher**, et
  ces noms disaient « 02 ». *Un réglage GLOBAL ne travaille pas forcément sur l'objet qu'on a en
  tête.* Réflexe : avant tout run long, **faire IMPRIMER ce qui décide du livrable** — la source,
  la sortie, le plan — et le lire, au lieu de le supposer depuis le fichier qu'on vient d'éditer.
  Même famille que « un artefact choisi par son NOM n'est pas l'artefact du montage » (19/09) et
  que « un identifiant dérivé d'un ORDRE n'est pas un identifiant » (31/07) : **ce qui désigne
  l'objet se vérifie, jamais ce qui devrait le désigner.**
- **⭐ UN PÉRIMÈTRE DÉDUIT DU DOSSIER N'EST PAS UN PÉRIMÈTRE** (20/09). `revlog.mjs` re-rend **tous**
  les `vlog/parts-<JJ-MM>.json` qu'il trouve, pas ceux de l'épisode : 37 journées présentes, dont
  les 17 de l'EP02. Sans `--jours`, c'était 17 journées ré-encodées en 4K pour rien et les masters
  de journée du #02 réécrits. La borne juste ne s'invente pas : elle se **lit dans l'EDL de
  l'épisode** (`grep '^L '`), qui est le seul artefact qui sache quelles journées le composent.
- **⭐⭐ UN MODE « SIMULATION » PRODUIT UN ARTEFACT DE SIMULATION — et celui-ci l'ÉCRIT PAR-DESSUS
  LE VRAI** (20/09). Avant le burn, la dimension VOIX est sortie à **+1,32 s** contre **1,293**
  déclarés, et les 22 blocs facecam semblaient décalés de **+0,004 s à +0,098 s**, de façon
  cumulative — la signature d'une dérive d'horloge, sur un épisode qui en avait déjà une en dette.
  L'EDL n'avait pourtant pas bougé d'une ligne. Ce qui a tranché n'a pas été une analyse mais
  **l'attente du vrai artefact** : le plan écrit par le merge RÉEL est identique au plan 1080 à
  **0,00000 s** sur les 22 blocs. La dérive était entièrement un artefact de `--dry`.
  Deux règles : ① *on ne juge pas un livrable sur l'artefact d'un mode qui ne le produit pas* —
  quand une mesure inquiète, la première question est « d'où sort le fichier que je mesure ? » ;
  ② **un dry-run ne doit pas écrire sur une entrée de mesure.** `vlog.mjs --dry` écrase
  `vlog/vlog.plan.json`, qui est le fichier que `subs-controle.mjs` lit pour juger les
  sous-titres : une simulation y laisse une fausse vérité qu'aucun garde ne distingue de la vraie.
  **Corrigé le 20/09, par le CHOIX et non par la compensation** : `--dry` écrit
  `vlog/vlog.plan.dry.json`, jamais le vrai — le NOM porte la vérité — et l'artefact déclare
  `_dry: true`, que `subs-controle.mjs` **refuse** (dimension VOIX NON MESURÉE, donc bloquante).
  *Retirer la cause, puis poser le refus au goulot pour les fichiers déjà sur le disque.* Éprouvé
  dans les trois sens : après un `--dry`, le md5 du vrai plan est INCHANGÉ et le plan de
  simulation existe ; pointé sur le plan `_dry`, le contrôle refuse ; pointé sur le vrai, il
  mesure ses 22 blocs. ⚠️ Et une dimension qui mesure sur une simulation est **pire qu'aveugle :
  elle se croit juste** — c'est pour ça que le refus vaut mieux qu'un avertissement.
- **⭐ UNE RÉSERVE QUI EMPIRE N'EST PAS FORCÉMENT LE DÉFAUT QUI EMPIRE** (20/09, corollaire du
  précédent). « Une réserve listée qui empire bloque aussi » reste vrai — mais avant de rouvrir le
  DÉFAUT, on demande ce qui a changé dans la **chaîne de mesure** : la réserve F08 n'avait pas
  bougé d'un millième, c'est son entrée qui avait été remplacée. *Un écart entre une réserve et sa
  remesure a deux causes possibles, et la moins chère à écarter est l'instrument.*
- **⭐ LE DÉFAUT D'UN CHAMP OPTIONNEL PEUT ÊTRE EXACTEMENT LA CHOSE QU'ON VEUT RETIRER** (20/09).
  le monteur : « pas de "La suite bientôt" dans le générique ». Or le moteur écrivait
  `spec.title ?? 'LA SUITE BIENTÔT'` : **supprimer le champ du spec fait RÉAPPARAÎTRE le texte**,
  et `null` aussi. Sémantique posée, et elle vaut pour tout opt-out : *champ ABSENT = comportement
  historique* (les specs #01 et #02 ne bougent pas) · *valeur VIDE = la chose est retirée*.
  Deux corollaires payés dans le même geste : ① **on retire l'objet, pas son libellé** — le texte
  était surmonté d'un filet, et le retirer seul laissait un tiret blanc suspendu dans le noir ;
  ② le groupe `#title` **reste** dans le DOM, vide, parce que l'animation le cherche par id — un
  retrait qui casse le script à l'image où il l'anime n'est pas un retrait. Et le MINUTAGE ne
  bouge pas : la durée du générique décide de celle du film et du fondu musical posé dessus.
  Éprouvé dans les deux sens : EP01 et EP02 gardent texte et filet, EP03 n'a ni l'un ni l'autre,
  et les trois conservent `#title`.
- **⭐ UNE NOTE DE REPRISE EST UNE HYPOTHÈSE, Y COMPRIS QUAND ELLE DÉCRIT UN COMPORTEMENT**
  (20/09). « `revlog` ne restaure pas les réglages » : faux, il les restaure (`restaureRun()`,
  31/07) — mais depuis le snapshot pris **au DÉBUT** du run, donc il repose `final/2160`. Le geste
  de remise à `brouillon`/`1080` reste obligatoire, **pour la raison inverse de celle qui était
  écrite**. La règle « un chiffre reçu est une hypothèse » (31/08) et « une cause écrite dans une
  note est une hypothèse comme une autre » (19/09) s'étendent donc aux **comportements décrits** :
  une phrase sur ce que fait un script se vérifie dans le script, en trois secondes de `grep`.

- **⭐⭐ UNE PREUVE PRISE SUR L'ARTEFACT INTERMÉDIAIRE NE PROUVE RIEN SUR LE LIVRABLE — et la
  clé de cache est la porte par laquelle la correction se perd** (20/09, la faute la plus bête de
  la journée parce que la parade était déjà écrite VINGT LIGNES plus haut). le monteur : « pas de "La
  suite bientôt" dans le générique ». Spec corrigée, générique isolé 4K re-rendu, **vérifié à
  l'image** : la signature n'y est plus. Annoncé comme fait. Le film final la portait toujours.
  **Cause** : la clé du segment générique de `vlog.mjs` ne portait que le NOM du fichier, la
  qualité et la définition — **rien de son CONTENU**. Or l'isolé se régénère sous le même nom à
  chaque correction de sa spec : le cache servait l'ancien segment indéfiniment. La parade
  (empreinte `taille ^ mtime` dans la clé) existait depuis le 31/08 pour le master facecam, vingt
  lignes au-dessus, et n'avait jamais été portée au générique. *« Qui d'autre a la même forme ? »
  avait encore une réponse* — c'est la troisième fois sur ce moteur.
  Deux règles, et la première est celle qui m'a fait annoncer un faux résultat :
  ① **la preuve se prend sur le LIVRABLE**, jamais sur la pièce qu'on vient de fabriquer : entre
  les deux il y a une chaîne, et une chaîne a des caches. Vérifier l'isolé prouve que l'isolé est
  bon, rien de plus ;
  ② **tout artefact réutilisé par son NOM doit porter son empreinte dans sa clé** — sinon
  « corriger et re-rendre » est une opération qui ne fait rien, en silence et sans erreur.
  Corrigé et prouvé dans les deux sens : l'empreinte calculée à la main AVANT le run
  (`hwf1oe`) est exactement celle du segment que le run a fabriqué, et elle est stable tant que
  le fichier ne bouge pas ; le film re-rendu n'a plus la signature, vérifié à l'image **sur le
  film**.

## 4. Carte des docs — n'ouvrir QUE ce que la tâche exige

| Fichier | Quand l'ouvrir | Poids |
|---|---|---|
| **`INDEX.md`** | opérer : boucle en 8 étapes, fichiers moteur, réglages, looks, règles de sélection, **TOC de STYLE avec numéros de ligne** | ~3,5k tok |
| **`STYLE.md`** | doctrine « à quoi doit ressembler un bon montage » + leçons. **Ne JAMAIS lire en entier** : `Read STYLE.md offset=<ligne> limit=60` via la TOC d'INDEX. ⚠ après toute édition de STYLE.md → `node toc.mjs` (sinon la TOC ment et le sniping envoie dans le décor) | 13k tok (snipé) |
| **`RESTITUTIONS.md`** | **historique des montages rendus** : un tableau de restitution par journée montée + bilan `avant → après`. À OUVRIR quand le monteur demande « qu'est-ce qu'on avait décidé sur le JJ/MM ? », « pourquoi R## a sauté ? », « l'historique des montages ». À COMPLÉTER à chaque rendu | ~1k tok/entrée |
| **`VLOG.md`** | monter la VIDÉO FINALE en mariant landscape et facecam : **§0 la TRAME** (le gabarit d'épisode figé par le monteur : durées, cadence, points fixes) · §1 les règles · §2 overlays brûlés · §3 frontières de sujets · **§4 la chronologie en 7 temps** · §6 les 12 pièges | ~3,5k tok |
| **`PLAN-VLOG-01.md`** | l'épisode **#01 = le modèle de référence** (Chine, jours 15→20 × facecam v12) : ce que montre chaque rush, ce que dit chaque sujet, la raison de chaque adjacence. À ouvrir pour ITÉRER dessus, ou pour voir à quoi ressemble une trame remplie | ~4k tok |
| **`MUSIQUE.md`** | toute tâche musique (`musique.mjs`) **et tout retour du monteur sur le son** — §⭐ Les 4 préférences sonores (30-31/07) sont des consignes tranchées, pas des réglages à re-arbitrer | ~2k tok |
| **`ARBO.md`** | ranger le store, machine neuve, « où doit vivre ce fichier ? » | ~0,9k tok |
| **`facecam/README.md`** | dérushage facecam (flux 5 temps, obstacles→solutions) **+ §Overlays visuels** (carte/tracé animé, vignettes, sous-titres accent, HyperFrames) | ~5k tok |
| **`CRITIQUE.md`** | mode critique d'un rendu (procédure inline) | ~2,4k tok |
| **`AMELIORATION.md`** | grille de notation + journal des essais moteur | ~5,4k tok |
