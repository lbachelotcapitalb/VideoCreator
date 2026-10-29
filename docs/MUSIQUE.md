# MUSIQUE — workflow `musique.mjs` (à ouvrir SEULEMENT pour une tâche musique)

## Sommaire

- Les trois sous-commandes
- Doctrines sonores
- Timeline MIXTE landscape × facecam — `plan --structure` (29/07)
- ⭐ Les 3 retours son du VLOG #02 (31/08) — lit qui s'éteint, cue mal calé, ducking en marche
- ⭐ `--impose` : quand le monteur NOMME la piste (31/08, 3ᵉ brouillon)

Surface DÉDIÉE au son musical, **hors moteur** (ne touche pas `monte.mjs` ni son cache) → on itère sans
re-rendre un montage complet.

## Les trois sous-commandes

- `node musique.mjs analyze [dossier]` — **catalogue de la bibliothèque** (offline). Par piste : énergie
  (`démarrage %`, `pic`, `plateau fort`, in-point conseillé) **+ caractère** : variabilité (CV), montée
  (buildRatio), **brillance** (ZCR), **tempo/onsets** (aubio) → **MOOD** (rythmé · sombre · rêveur/aérien ·
  cinématique · nature/planant · minimal) et **USAGE** (`lit` bed ambiance · `plein` porte une séquence ·
  `facecam` sous la voix · `beat` montage calé). Seuils **calibrés sur la biblio** (percentiles) + indices du
  nom. Écrit `Réglages/musique.analyse.json` (pour `plan`/futur) + `musique.catalogue.md` (lisible). ⚠ bpm
  indicatif (aubio se cale mal sur l'ambient sans percu).
- `node musique.mjs apply "<rendu.mp4>" --track <sous-chaîne> --in <mm:ss> [--mode] [--gain] [--compare]` —
  pose UNE piste **à partir de l'in-point** (`-ss` avant `-i`, puis `aloop` reboucle le reste). Modes = la
  doctrine audio de monte.mjs : `speech` (voix reine, musique 0.18 sidechain-duckée) · `bed` (musique porte
  0.9, ambiance 0.5 duckée dessous, loudnorm −14) · `bald` (musique nue, remplace l'audio). `--compare` rend
  aussi la version @0:00 (avant/après).
- `node musique.mjs plan "<vlog.mp4>" [--out …]` — **carte musique MULTI-PISTES auto** (le vrai objectif :
  varier les morceaux pour le contraste). Découpe la timeline en **cues**, attribue une piste par cue
  **selon les flags usage du catalogue** (cue `amb` → pool non-beat, en préférant l'usage qui colle au niveau :
  `plein`→présence, `lit`→calme/`facecam` ; cue `beat` → pool `beat`), **rotation**, jamais 2× d'affilée,
  **in-point stratégique** (swell dans le cue), une **intensité** par cue, **crossfade** 1,5 s. La VIDÉO n'est
  **jamais ré-encodée** (audio : lit concaténé en acrossfade + gain son-vidéo automatisé par cue + loudnorm −14
  + mux `-c:v copy`). Écrit `Réglages/musique.plan.json` + rend le vlog.
  - **Doctrine découpe (le monteur 25/07)** : **AMBIENT dominante** (cues longs ∈ [50 s, 120 s], exploite franchement,
    jamais 10 s) ; **BEAT stratégique + COURT** (`BEAT_LEN` 45 s), **jamais en 1ᵉʳ**, ~1 par 3,5 min
    (`floor(D/210)`, borné par les pistes `beat` dispo). le monteur filme surtout de l'ambient/plans smooth.

## ⭐ Le vivier du 19/09 — ce qu'un vivier neuf change à la carte (EP3, 2ᵉ passe)

Le monteur a **vidé** `Musiques/` (« toutes les musiques ont des bruitages copyright ») et installé
**7 pistes**. Trois conséquences mesurées, qui valent pour tout changement de vivier :

| constat mesuré | conséquence |
|---|---|
| `analyzeLibrary` classe **6 pistes sur 7 en `beat`** | le pool ambient n'en contient qu'**une** : la même piste sur les 5 cues |
| le repli « pool vide → vivier entier » ne partait pas (1 ≠ 0) | condition corrigée : **« incapable de servir sans se répéter »**, soit au moins autant de pistes que de cues |
| `the-eastern-plain-trouble-by-trouble` porte des **voix chantées** | sortie du vivier via `MUSIQUE_EXCLURE` dans l'EDL (sur une timeline L/F, tout cue de 150 s contient du facecam) |

**`MUSIQUE_EXCLURE <sous-chaîne>[,…]`** (EDL) → `musique.mjs plan --exclure`. Même raison d'être
que `MUSIQUE_IMPOSE` : un choix de morceau fait partie du montage, donc il vit dans l'artefact
versionné avec sa justification. Le retrait est **annoncé à chaque tour** — un vivier amputé sans
un mot est indiscernable d'un vivier plus pauvre qu'on croit.

**La dette « MUSIQUE #03 » est soldée par la mesure** : attaques 0-6 s des 6 pistes retenues entre
**−9,8 et −22,2 dBFS**, toutes très au-dessus du seuil de −35 dBFS qui avait creusé 2,0 s de trou
sur le #02. Aucun in-point correctif n'est nécessaire. (La 7ᵉ, à −36,3 dBFS, est justement celle
qu'on exclut.) Corps utile mesuré : 155,5 à 237,1 s pour des cues de ~148 s — **zéro boucle
possible à 5 cues**, sans entamer la préférence n°4.

---

## Doctrines sonores

**Doctrine in-point** : le pic du morceau doit tomber sur le **temps fort de l'image** (~65-75 % du plan),
pas au démarrage. Morceaux qui *démarrent déjà au sommet* (`0-5s ≥ 70 %` : `monume-547901`, `monume-nature`)
→ laisser à 0. Les 3 à **surtout pas** démarrer au début (longue montée) : `ambienthorses` (pic 2:15),
`monume-570679` (pic 1:19), `mondamusic-487320` (plateau large).

**Doctrine intensité (« au feeling », consigne le monteur 25/07)** : 3 niveaux = dominance musique↔son-vidéo —
`voix` (mus 0.15 / org 1.0, facecam, voix reine) · `lit` (0.85 / 0.45, ambiance gardée) · `plein`
(1.0 / 0.06, 100 % musique). Pas de bonne réponse théorique → viser l'**ÉQUILIBRE** : ni trop de plein ni
trop de son-vidéo. ⚠️ **Le PLACEMENT de ces 3 niveaux a changé le 30/07** — l'alternance stricte
lit↔plein a été remplacée par la structure interne à la bande (tête muette → queue sonore) :
voir §Timeline MIXTE ci-dessous, « Les 4 préférences sonores du monteur ». Les VALEURS, elles, n'ont pas bougé.

**Learnings ouverts (à itérer) :**
- ✅ **Dossier renommé** `Musique (optionnel)` → `Musiques` (le monteur 25/07) : `musique.mjs` (`musicDir()`) ET
  `monte.mjs` (`MUSIC`, ~ligne 26) testent les deux noms → `pickMusic` réparé (aligné le 25/07).
- ✅ **`plan` consomme les flags usage** (fait 25/07) : cue `amb`→pistes non-beat matchées au niveau,
  cue `beat`→pistes `beat`. Reste : le placement du beat est **temporel** (~1 par 3,5 min, milieu), pas encore
  **calé sur l'énergie de l'image** (footage-blind) — prochaine intelligence quand `plan` lira une structure du vlog.
- ✅ **Mariage facecam + landscape sur 1 timeline : FAIT le 29/07** — `plan --structure <vlog.plan.json>`.
  Le hook `facecamEndCues` n'a pas servi tel quel : voir ci-dessous, il donnait 100 % de plein.
- ✅ **Cues snappés sur les vraies ruptures : FAIT le 29/07** (mode `--structure` seulement ; sans
  structure, `plan` reste sur le tuilage régulier — il n'a alors aucune rupture à connaître).
- Contraste prouvé sur le rendu (CV énergie : PLEIN 18 % lisse/dominant vs LIT 36 % ambiance vivante) mais le
  `loudnorm` final aplatit la dynamique globale — le contraste est **timbral/de balance**, pas de volume.
- En `apply` mode `bed`, `loudnorm=−14` masque le gain d'in-point au global (mesuré : sorties quasi
  identiques ; visible **musique isolée** 41 %→76 %). L'in-point paie surtout en **audibilité dès la 1ʳᵉ s**.
- **Intégration moteur** (un jour) : `pickMusic()` lit une carte, `-ss` propagé dans les 3 chemins audio de
  `monte.mjs` (édition moteur → backup + `node --check` + **un seul réglage par tour**).

_Voir aussi : `STYLE.md` §Lit musical (musique sous l'ambiance côté moteur)._

---

## Timeline MIXTE landscape × facecam — `plan --structure` (29/07)

`node musique.mjs plan "<rendu.mp4>" --structure vlog/vlog.plan.json`

**Le problème** : sur une timeline entrelacée, un bloc facecam peut faire 5,7 s. Un cue par bloc
donnerait un changement de morceau toutes les 6 secondes — exactement ce que la doctrine ambient
interdit (« cues longs ∈ [50 s, 120 s], jamais 10 s »).

**La solution : DEUX GRILLES.**

| grille | pas | rôle |
|---|---|---|
| **cues** (quel morceau, quel in-point) | long, 50-120 s, **frontières snappées sur les ruptures du montage** | un changement de piste ne tombe jamais au milieu d'un plan ni d'une phrase |
| **niveaux** (dominance musique ↔ son-vidéo) | fin, **un palier par bloc** | c'est LUI qui « fait varier la fixation des niveaux sonores » |

Le lit musical est monté sur les cues **à volume neutre**, puis DEUX enveloppes de gain
(`volume=eval=frame`) sont appliquées d'après la grille fine : une sur la musique, une sur le
son-vidéo. Les deux grilles deviennent indépendantes.

### ⭐ Les 4 préférences sonores du monteur (retours des 30 et 31/07 sur le VLOG #01)

Elles sont **implémentées** dans `levelsFromStructure()` et `cmdPlanStructured()`. Ce sont des
consignes, pas des réglages à re-arbitrer.

| # | Consigne du monteur (mot pour mot) | Ce que fait le code |
|---|---|---|
| 1 | « suite à un rush facecam, on a du landscape **sans son**, puis ensuite **avec son** » — « il faut des **tendances plus longues** », « tu fais un peu au hasard » | chaque bande paysage = **tête `plein`** (musique seule) puis **queue `lit`** (l'ambiance revient et reste). Bascule sur une frontière de PLAN. Seuil : 40 % de la bande, plafonné à 12 s. Bande < 6 s → entièrement `plein` |
| 2 | « **sauf si rush avec ma voix voulu** évidemment » — « laisser prédominante ma voix plutôt que la musique puisque je parle » | un plan paysage déclaré `PARLE` dans l'EDL passe en **`voix`**, comme un facecam. Mesuré sur R011/R028 : parole remontée de **+4,9 et +8,9 dB** par rapport à la musique |
| 3 | « je ne veux pas de la musique qui commence vers R51, **trop dynamique** (contraste de rythme trop important) — on reste sur du **Dreamscape dark ambiant** » | les cues **beat sont OFF par défaut** en mode `--structure`. `--beat` pour en remettre. Un vlog de voyage tient sur UNE famille sonore |
| 4 | *(31/07)* « je trouve que **ça change trop vite de musique**, laisse durer un peu plus longtemps les musiques » | `CUE_MIN/TARGET/MAX` passent de **50/90/120 s** à **90/150/200 s**. Sur #01 (12:50) : **9 pistes → 5**, un changement toutes les **2 min 34** au lieu de 1 min 24. C'est le même retour que le n°1, appliqué au CHOIX DE PISTE et non au niveau |

Deux corollaires du même retour, côté montage et pas côté musique :

- **La fin ne se coupe pas net.** « Ne pas finir le VLOG sur du rush facecam mais landscape avant
  **baisse progressive du son** » → le fondu de sortie court sur toute la **bande paysage de
  clôture** (mesurée automatiquement par `outroDuration`), pas sur les 1,5 s du crossfade. Il est
  posé **après** le `loudnorm` — posé avant, la normalisation le remonterait.
- **La cadence prime sur le dosage.** Le défaut du 1ᵉʳ rendu n'était pas le niveau mais le RYTHME
  des changements. Une règle qui bascule « une bande sur deux » s'entend comme du hasard, même si
  chaque niveau pris isolément est juste. Deux tendances longues et toujours dans le même ordre
  s'entendent comme une intention.

> ⚠️ **Le hook `facecamEndCues` ne s'applique PAS ici** — et l'alternance stricte qui l'avait
> remplacé (25/07) est **morte le 30/07**, c'est elle que le monteur a entendue comme aléatoire.
> « Le facecam force le cue suivant en plein » avait été écrit quand le facecam était rare ;
> appliqué à une timeline entrelacée, on obtient 100 % de plein et on n'entend plus jamais la rue.
> La bonne réponse n'était ni l'un ni l'autre : c'est la structure INTERNE à la bande.

**Piège mesuré** : `between(t,a,b)` vaut 1 **aux deux bornes** → deux paliers adjacents se
chevauchent d'une frame et le gain double. Les enveloppes utilisent donc des intervalles
mi-ouverts `gte(t,a)*lt(t,b)`.

_Voir aussi : `VLOG.md` (la chaîne complète du montage mergé)._

---

## ⭐ Les 3 retours son du VLOG #02 (31/08) — et ce qu'ils ont appris

Trois retours du monteur qui se ressemblaient à l'oreille (« la musique s'arrête », « ça change
trop soudainement ») avaient **trois causes différentes**, dont aucune n'était le dosage. Les
niveaux (`voix 0,15/1,00 · lit 0,85/0,45 · plein 1,00/0,06`) n'ont pas bougé d'un chiffre.

| # | Ce que le monteur entend | La cause MESURÉE | La parade |
|---|---|---|---|
| 1 | « tu l'arrêtes en fade et tu la reprends » | Les 5 cues faisaient 145 à 166 s, les 5 pistes 67 à 112 s. `-stream_loop -1` rebouclait donc chaque piste **en rejouant son propre fondu de sortie** puis son fondu d'entrée. **305 s sur 772, soit 40 % du film**, sur un lit qui s'éteint et se rallume | `corpsUtile()` mesure les fades (`silencedetect`) et on boucle sur le CORPS, raccordé par `acrossfade` 4 s. La couverture pèse +6 dans le score |
| 2 | « la 3ᵉ musique arrive trop soudainement, en plein milieu de rush » | Les 5 cues tombaient **au 0,000 s près** sur une frontière de plan : le snap marchait. Mais 166 des 226 frontières séparent deux plans paysage de 2 s pris dans la même rafale — « pile entre deux plans » y veut dire « au milieu d'une séquence » | DEUX niveaux de frontières. **Rupture FORTE** = entrée/sortie d'un bloc facecam, premier plan d'une nouvelle journée (55 sur 226). On y snappe d'abord, l'ordinaire n'est qu'un repli |
| 3 | « on n'entend plus la musique sous le facecam » | `gainExpr` posait une fonction **en marches** : −16,5 dB en un échantillon à l'entrée d'un bloc, +16,5 dB à la sortie. Le #01 avait 15 blocs facecam, le #02 en a 27 | Somme de **rampes** (`clip`) de 0,50 s. Asymétrie voulue : une descente FINIT sur la frontière, une montée y COMMENCE |

**La leçon commune** : *« snappé sur une frontière » n'est pas « snappé sur une transition », et
« la piste est posée » n'est pas « la piste sonne ».* Chaque fois, l'intention était codée et le
contrôle vérifiait l'intention, pas le résultat. Ce qui a tranché, c'est d'écouter le RENDU à
l'oscilloscope : RMS par fenêtre de 0,5 s sur les 772 s, et la question « où est-ce que ça tombe
sous −35 dBFS ? ». Un plan musical qui se lit bien sur le papier peut décrire un film muet.

**Ordre des priorités dans l'attribution des pistes** (le poids compte moins que l'ordre) :
ne jamais réentendre une piste du film (−20) > couvrir le cue sans boucler (+6) > coller à
l'usage voulu (+2). Au 1ᵉʳ essai la couverture était à +6 contre −3 pour la réutilisation : la
seule piste de 4 min 45 a servi **3 cues sur 5**, c'est-à-dire qu'on remplaçait un défaut par
celui que le monteur signalait. 18 pistes pour 5 cues : « jamais deux fois » est toujours tenable,
« toujours couvrir » ne l'est pas.


---

## ⭐ `--impose` : quand le monteur NOMME la piste (31/08, 3ᵉ brouillon du #02)

**L'arbitrage.** le monteur, sur le 2ᵉ brouillon : « un cue qu'on ne sait pas couvrir se **scinde en
deux cues sur deux pistes**, il ne se boucle pas. » La règle est juste, le vivier ne la porte
pas : 10 pistes ambient, corps utile de 67 à 282 s, **une seule au-dessus de 2 min 30**.
L'appliquer partout ferait 8 cues sur 12:52, soit un changement toutes les **1 min 36** — la
cadence que le monteur avait rejetée sur le #01 (préférence n°4). Soumis en tableau ; sa réponse n'a
pris aucune des options : **« utilise `nest-beatzofficial-dreamscape-journey-292663` »**.

**Ce que ça a appris.** Une question d'arbitrage peut recevoir une réponse qui n'est pas dans
la liste, et c'est la meilleure : le monteur n'a pas tranché *une doctrine*, il a **désigné un
morceau**. L'outil doit savoir recevoir ça. D'où `--impose`, et rien de plus :

    node musique.mjs plan <mp4> --structure … --impose <sec|mm:ss>:<sous-chaîne de piste>[,…]
    # depuis un EDL de vlog : ligne  MUSIQUE_IMPOSE 253.667:nest-beatzofficial-dreamscape-journey

Il scinde le cue qui contient cet instant **à la rupture forte la plus proche** (même doctrine
de snap que `snapCuesToStructure` : rupture forte d'abord, frontière ordinaire en repli) et pose
la piste nommée sur la seconde moitié. Il imprime l'écart au point demandé et **dit si la piste
couvre** le nouveau cue — un `--impose` qui boucle encore doit se voir.

⚠️ **La piste est cherchée dans TOUT le vivier, `beat` compris.** La préférence n°3 (« cues beat
OFF par défaut ») est une règle d'**attribution automatique**, pas une interdiction : quand le monteur
nomme un morceau, il a déjà tranché, et l'outil ne rediscute pas son choix. `nest-beatz` est
classée `plein, beat` — elle entre parce qu'elle a été désignée.

**Résultat mesuré sur le 3ᵉ brouillon.** Cue 2 (2:33 → 5:19, 165,9 s) scindé à **4:13,67** =
sortie du bloc F08 **et** premier plan du 24-07, la rupture la plus forte disponible : la musique
remonte du ducking sur un thème neuf, un jour neuf. 100,4 s sur `9jackjack8` (corps 106,4 s) puis
65,5 s sur `nest-beatz` (corps 126,0 s) — **les deux couverts sans boucle**. 6 cues au lieu de 5,
un changement toutes les **2 min 09** (contre 2 min 34 avant, 1 min 36 si on scindait partout).

**2ᵉ scission, même jour.** le monteur : « tu veux reprendre les 3 cues ? » — **un seul**, et c'est la
mesure qui le dit. Le cue 4 tenait 2:25 sur `547901` (corps **67,5 s**) : le seul cue du film où
le thème revient **deux fois**, donc le défaut que le monteur avait signalé sur 0 → 5:20, transposé.
Scindé à **6:12,00** = sortie de F11 (52,8 s + 91,7 s sur `universfield-tokyo`, corps 111,5 s).
Les cues 5 et 6 n'ont **pas** été touchés : 1 raccord chacun sur 110,4 et 100,2 s de corps, soit
un seul redémarrage en 2:30 d'ambient minimal. **Les scinder aurait fait 9 cues = un changement
toutes les 1 min 26, la cadence rejetée sur le #01** (préférence n°4) : on aurait corrigé un
défaut en recréant l'autre. État final : **7 cues, un changement toutes les 1 min 50, 5/7 couverts
sans boucle**. Vérifié sur le rendu : RMS continu −18 à −28 dBFS au passage de 6:12, aucun trou.

**3ᵉ passe, « fais + ».** le monteur demande d'aller au bout : les cues 5 et 6 sont scindés à leur tour,
à **8:56,43** (sortie de F17) et **11:43,17** (sortie de F24 **et** premier plan du 31-07, double
rupture). **9 cues, 9/9 couverts, ZÉRO boucle sur tout le film** — au prix assumé et annoncé d'un
changement toutes les **1 min 26**, c'est-à-dire la cadence que la préférence n°4 avait écartée.
C'est son arbitrage, pas une dérive : le compromis a été chiffré avant, il est écrit dans l'EDL,
et revenir à 7 cues tient en retirant deux entrées de `MUSIQUE_IMPOSE`.

### ⚠️ LA COUVERTURE NE DIT RIEN DU NIVEAU D'ATTAQUE

Le 1ᵉʳ jet de cette 3ᵉ passe a **creusé un trou** : `universfield-mountain-silence` couvrait
largement le cue de clôture (104,4 s pour 68,6 s) mais fait **−44,7 dBFS sur ses 6 premières
secondes**, et ce cue démarre sur une tête `plein` (musique seule, son-vidéo à 0,06). Résultat :
**1,0 s du rendu sous −35 dBFS** à 11:44,5 — exactement le symptôme « la musique s'arrête » que
toute cette section corrige. Le contrôle de couverture était vert.

`imposerCues` **mesure et imprime désormais l'attaque** de chaque piste imposée (RMS moyen des
6 s jouées depuis son in-point) et alerte sous −35 dBFS. Sur cette passe : `nest-beatz` −12,5 ·
`tokyo` −27,8 · `487320` −16,7 · `monume-nature` −10,7. La piste de clôture a été **changée**
(`monume-nature-dreamscape-547914`, qui démarre à son sommet — la doctrine in-point le disait déjà)
plutôt que remontée au gain. Preuve : **0 passage sous −35 dBFS** hors fondu de sortie, et les
8 changements de piste mesurés entre −17,0 et −28,2 dBFS.

*La leçon, une de plus dans la même famille : un critère vert ne couvre que ce qu'il regarde.*
