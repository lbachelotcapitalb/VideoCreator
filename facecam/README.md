# Fast Facecam — merge + dérushage de rushs parlés (talking-head)

## Sommaire

- Pourquoi ce module existe
- Flux : map → subjects → EDL(Claude) → **refine** → **relances** (→ **sweep** si scorie) → **lumieres** → render → **garde parole (bloquant)** → preuve
- **Serrement — les 4 paliers nommés** (10/09)
- Réglages
- Obstacles → solutions (le cœur du module, chèrement acquis)
- Bonnes pratiques d'itération (méta — pour la prochaine fois)
- Intelligence de sélection (best-take — fusionné dans facecam le 25/07)
- Overlays visuels — carte/tracé, vignettes de chiffres (chantier ouvert le 25/07)

Compétence du skill **videocreator**. Fusionne plusieurs rushs facecam (le monteur parle face caméra,
beaucoup de prises ratées / répétitions / temps morts) en **1 vlog serré et dynamique**, où chaque
sujet n'est dit **qu'une fois**. 100% local/offline (whisper.cpp + ffmpeg, aucun réseau).

Distinct du moteur d'ambiance (`monte.mjs`) qui cale des B-roll sur un beat et SAUTE la parole.
Ici on monte **la parole elle-même**.

## Pourquoi ce module existe
Le modèle whisper `small` **bunch** les timestamps mot-à-mot : dans un rush de 8 min, deux prises à
30 s d'écart peuvent ne montrer aucun gap. → On ne coupe **jamais** sur les mots. On coupe sur la
**vérité des silences** (`silencedetect`), et on transcrit **chaque îlot de parole séparément** pour
obtenir une carte contenu↔timecode fiable.

## Flux : map → subjects → EDL(Claude) → **refine** → **relances** (→ **sweep** si scorie) → **lumieres** → render → **garde parole (bloquant)** → preuve

### 1. Carte — `map.mjs`
```
node facecam/map.mjs "<dossierRushs>" [--gap 1.2] [--min 0.7] [--json carte.json]
```
Extrait le wav 16k de chaque rush, calcule les îlots (parole entre silences ≥ `gap`), transcrit
chaque îlot, imprime `clip / in–out / texte`. `--json` sauvegarde la carte. Les ids `c1..cN` = rushs
triés par nom (les rendus/exports sont ignorés).

**INCRÉMENTAL (prochaine passe)** — avec `--json <carte>`, les rushs **inchangés** (signature
taille+mtime) sont **réutilisés** depuis la carte existante : une passe suivante ne transcrit que les
**nouveaux** rushs. Mesuré : 10 rushs = **1 min 27 à froid → 0,03 s** à chaud. `--fresh` force tout à
re-transcrire ; `--since YYYYMMDD` ne mappe que les rushs de ce jour ou après (nouveau tournage).
⚠️ `--since` filtre **après** `listClips` : les ids `c1..cN` restent ceux du dossier complet, donc une
EDL déjà écrite reste valide. Les rushs d'un tournage plus récent s'ajoutent en fin (`c11`, `c12`…) —
les ids existants ne bougent pas.

### 1b. Carte des sujets — `subjects.mjs`  (vision holistique)
```
node facecam/subjects.mjs <carte.json> [--sim 0.45]
```
Met à plat les îlots de TOUS les rush et dresse **la liste des sujets**, en regroupant les **reprises
d'un même sujet** (y compris cross-rush) par similarité cosinus **pondérée IDF** (les mots distinctifs
pèsent, les génériques s'effacent → pas de faux regroupement). Sortie `<carte>.subjects.json` : chaque
sujet → ses occurrences (rush@timecode) + une meilleure provisoire. C'est la matière première de l'EDL.

### 2. EDL — écrite par Claude (étape éditoriale), informée par la carte des sujets + les scoreurs
En lisant la carte des sujets : garder chaque sujet **1 fois** (la **meilleure prise** — voir
« Intelligence de sélection », pas forcément la 1re), écarter doublons entre rushs + ratés.
Fichier JSON (dans le store, à côté des rushs) :
```json
{
  "rushDir": "/…/Facecam Rush/Déposer les rushes ici",
  "out": "/…/Facecam Rush/Déposer les rushes ici/VLOG_xxx.mp4",
  "hflip": false,
  "lead": 0.05, "tail": 0.16,
  "silThresh": 0.5, "silTarget": 0.24,
  "spans": [ {"clip":"c1","a":2.56,"b":10.22,"label":"intro"}, … ]
}
```

### 2b. Affinage sur le VRAI PARLÉ — `refine.mjs`  ⭐ (respiration + filler + amorce)
```
node facecam/refine.mjs <edl.json>   # → <edl>.refined.json
```
Resserre chaque span sur la **parole réelle**, PAS sur l'énergie dB (la respiration passe le seuil −30 dB
mais n'est PAS de la parole ; mesuré : un span commençait 0,9 s trop tôt sur un souffle). Chaîne de 5 gestes,
du plus grossier au plus fin — chacun avec un garde-fou pour **ne jamais tronquer un vrai mot** :

1. **Bursts de voix** — `silencedetect` à **−24 dB** (seuil « voix » : la respiration, plus basse, est exclue
   nativement). Le complément des silences = les *bursts* (timing fiable). Bornes du span = 1er / dernier
   burst substantiel (souffle/faux-départ de tête et « donc euh… » de fin coupés).
2. **Classer chaque burst** (transcription `small`, rapide) → DROP si vide, **hallucination whisper**
   (« Amara.org », « sous-titres », « merci d'avoir regardé », « abonnez-vous » = signature de non-parole),
   ou **filler pur** (`euh`, `voilà`, `donc euh`, `ce genre de chose`, `quoi`…). Fillers isolés au milieu → `cuts[]`.
3. **Re-confirmer les DROP INTERNES en `large-v3`** — le small **hallucine des fillers sur des bursts COURTS de
   vrai contenu** (mesuré : « pour pouvoir la voir » → small « voilà voilà » → drop → cassait la phrase à 1:15 ;
   « autour » → small « Amara.org »). Chaque burst du **milieu** marqué drop est re-transcrit en large-v3 ; s'il
   y lit du vrai contenu → on **annule le drop**. ⚠️ **Milieu uniquement** : large-v3 garble AUSSI les bursts
   ultra-courts (« ce genre de choses » de fin → « sur les choses »), un rescue en tête/queue ré-inclurait un
   filler que refine doit couper → là, le flag `small` agressif est meilleur.
4. **Souffle de tête/queue = VAD par la HAUTEUR (aubiopitch)** — la respiration/le bruit de bouche sont
   **NON-VOISÉS** (pas de F0), la parole est **VOISÉE**. On rogne tête/queue jusqu'à l'onset/offset voisé
   (F0 dans **70–400 Hz** ; le pitch fantôme > 1 kHz des fricatives ne compte PAS comme voix), en gardant
   0,06–0,08 s d'attaque. ⚠️ **Consonne initiale non-voisée** (« **S**i », « **C**e », /s/ /p/ /t/) = pas de F0
   non plus → **garde-fou anti-troncature** : après rognage candidat, re-transcription large-v3, le 1er/dernier
   mot de contenu doit rester **INCHANGÉ**, sinon on ANNULE. Mesuré : souffle de tête 0,44 → 0,05 s ; « Si »/« Ce » préservés.
5. **Amorce collée en tête = PROBE incrémental** (« et que c'est… », « voilà donc… » sans pause) — on avance le
   début pas à pas (0,06 s) et on **re-transcrit** (large-v3) tant que le 1er mot ∈ `STRIP` (et, que, donc,
   alors, voilà, euh, mais, bah, ben…) → s'arrête **pile** sur le contenu (la transcription se re-vérifie →
   jamais dedans ; span `noLead`, le rendu ne remet pas de lead arrière). **Complémentaire du pitch** : l'amorce
   est VOISÉE (le pitch ne la voit pas), le pitch coupe le souffle non-voisé — les deux ne se marchent pas dessus.
   ⚠️ Un whisper plus gros **ne corrige PAS** les timestamps de tête (small ET large-v3 posent « et que c'est »
   à 75,06–75,60 alors que l'audio est silencieux jusqu'à 75,56) → c'est le **probe**, pas la précision des timestamps.

Sortie = EDL enrichi (`a`/`b` resserrés + `cuts[]` + `noLead` + `refined:true`), exécuté tel quel par render.mjs.
`out` peut **s'étendre** au-delà du `b` de l'EDL (fenêtre `TAILW`) → rattrape une phrase coupée trop tôt.
Modèles : `ggml-small.bin` (triage des bursts, rapide) + `ggml-large-v3.bin` (re-confirmation + garde-fous +
probe ; ~3,1 Go, **local sur le Mac**, jamais le VPS). Coût assumé (« + de calcul en local ») : refine ~8-9 min
sur 33 spans, mais chaque geste risqué est protégé par une re-transcription → robustesse > vitesse.

### 2c. Faux départs — `relances.mjs`  ⭐ (02/08 : « je ne veux laisser AUCUN raté »)
```
node facecam/relances.mjs <edl.json|edl.refined.json> [--n 4] [--apply]
```
**`refine.mjs` ne voit pas qu'une phrase a été DITE DEUX FOIS** : il resserre sur la parole, pas sur
le sens. Trois relances sont donc parties en production le 02/08, et c'est le monteur qui les a entendues.
Sa règle, textuelle : *« tu les identifies facilement en voyant des répétitions dont la énième finit
par dérouler la suite sans accroc »* — donc **la bonne prise est la DERNIÈRE**.

L'outil teste chaque burst de tête : **sa suite de mots réapparaît-elle dans les ~14 mots qui
suivent ?** Si oui, c'est une amorce avortée, et `a` se cale sur le premier burst qui ne se redit pas.
Garde-fou : la proposition est re-transcrite en `large-v3` et n'est retenue que si la répétition a
disparu (le doute par défaut = ne rien couper). `--apply` écrit, sinon il propose.

**Trois pièges payés en l'écrivant** (à reproduire, ce sont des motifs) :
- **Ne PAS chercher une « ouverture de référence »** dans les premiers mots : ils SONT le faux départ.
  Première version : elle prenait `words.slice(0, n)` comme motif — donc elle cherchait la répétition
  du raté, pas celle de la phrase. Le bon test est **par burst**, pas par n-gramme global.
- **Tout transcrire en `large-v3`, y compris les bursts.** Avec `small`, les bursts courts rendaient
  « on va un combi », « musique quand j'ai eu » : aucune répétition ne pouvait matcher. C'est le
  §Obstacles « bursts ultra-courts » appliqué à la lettre — sauf qu'ici la fenêtre est la bonne.
- **La comparaison positionnelle casse sur UNE insertion.** « en fait quand tu vas là-bas **et** que
  tu vois » vs « … que tu vois » : un mot en plus décale tout et fait exploser le compte d'erreurs.
  D'où la comparaison par burst entier avec tolérance 1/4, et le repli manuel par balayage quand le
  motif est trop abîmé.
- ⚠️ **Il ne voit QUE les répétitions INTERNES à un span.** L'écho *entre deux spans consécutifs*
  (deux blocs qui ouvrent tous les deux sur « En fait ») lui est invisible et s'entend très bien :
  ça se corrige en calant la tête du second sur le mot d'après (vécu sur Hong Kong, 02/08).

**⭐ Le garde-fou par re-transcription ne suffit PAS — il faut BORNER ce qu'une coupe peut enlever.**
En voulant attraper un dernier résidu (« …Hong Kong, / et donc moi quand j'entends Hong Kong… »),
une règle « scorie » a **cascadé** et proposé de couper **6,2 s sur 8,7** — et le contrôle large-v3
l'a **validée** : sur une fenêtre d'1,5 s, whisper refabrique la phrase entière (c'est exactement
l'« amorce plausible inventée sur du silence » du §Obstacles, ici retournée contre le garde-fou lui-même).
La parade n'est pas un meilleur modèle, c'est une **borne** : une proposition est refusée si elle
enlève > 45 % de la durée du span ou s'il resterait < 55 % des mots. Sur le cas fautif, le contrôle
textuel donnait « 87 % des mots » (whisper avait reconstruit) — **seule la borne de DURÉE a arrêté la
coupe**. Motif à reprendre partout : *quand un garde-fou repose sur un modèle génératif, lui adjoindre
une mesure qui, elle, ne peut pas halluciner.*

### 2d. Équilibrage de lumière — `lumieres.mjs`  ⭐ (02/08)
```
node facecam/lumieres.mjs <edl.json|edl.refined.json> [--n 6] [--apply]
```
le monteur, 02/08 : *« il y a des plans sombres et d'autres très lumineux, c'est le hasard de la mise au
point (…) identifie les plans lumineux et baisse un peu les fortes lumières, quitte à avoir une
légère ambiance tamisée. »* Le défaut est réel et **mesurable** : tourné à contre-jour devant une
fenêtre, l'auto-expo du DJI se cale différemment à chaque prise — sur le bloc Hong Kong l'écart entre
le plan le plus sombre et le plus clair atteint **22,6 points de luminance moyenne**, ce qui fait un
flash au raccord.

⭐ **C'EST AUTOMATIQUE DEPUIS LE 02/08** : `render.mjs` compte les spans sans `lum` et, s'il en
trouve, lance `lumieres.mjs --apply` lui-même avant d'encoder (`MONTAGE_NO_LUM=1` désarme). Avant ça,
un EDL sans `lum` sortait **sans aucune correction de lumière et sans un mot** — la correction
dépendait de mon souvenir de lancer l'outil, et son absence était silencieuse. Cas réel visé : un
span ajouté après coup à un EDL déjà équilibré donnait un plan non corrigé au milieu d'un film
corrigé, c'est-à-dire précisément le flash au raccord que l'outil existe pour supprimer. Une ligne
est imprimée **dans tous les cas**, y compris « déjà mesuré ».

L'outil MESURE (`signalstats`, 6 images par span) et écrit `lum.curve` dans l'EDL ; **`render.mjs`
l'applique** (`curves=all=…`, posé avant `format=yuv420p`). Deux gestes dosés, jamais forfaitaires :
un **rolloff des hautes lumières** (5 % de base pour tout le monde = le tamisé assumé, jusqu'à 14 %
sur les plans brûlés) et un **rattrapage d'exposition sur les mediums seuls** (± 13 % max) qui ramène
chaque span vers la **cible** du film — le noir n'est pas touché, donc l'image ne se délave pas.

⭐ **La cible est `min(médiane, TARGET_ABS)`, pas la médiane** (2e passe du 02/08 : le monteur a trouvé la
1re « encore trop lumineuse »). **Viser la médiane ne corrige rien quand la médiane est elle-même
trop claire** : sur Hong Kong, 8 spans sur 9 étaient groupés entre 53 % et 63 %, donc la médiane
valait 60,7 % et le plan LE PLUS CLAIR ne descendait que de **1,9 %** — le rolloff, lui, ne tire que
les points 0.70 et 1.0 de la courbe et laisse les mediums intacts. Un rattrapage qui vise le centre
d'un nuage ne peut pas déplacer le nuage. `TARGET_ABS = 0.520` plafonne la cible : les plans clairs
descendent pour de bon (HK, plan le plus clair : 62,6 % → **55,8 %** au lieu de 59,1 %) et un film
déjà sombre garde sa médiane, le plafond ne pouvant qu'assombrir. C'est l'« ambiance tamisée »
assumée par le monteur (« on peut y aller franchement »).

⭐ **Le rattrapage est ASYMÉTRIQUE : `DARK_PUSH` ne pousse que la branche NÉGATIVE** (3e passe du
02/08 — le monteur : *« tu peux encore baisser la luminosité des rushs CLAIRS uniquement »*). Le réflexe
aurait été de baisser encore `TARGET_ABS` — **c'est faux, et pour une raison qui vaut au-delà de ce
réglage** : le gain positif des plans SOMBRES se calcule depuis la même cible, donc baisser la cible
leur aurait rogné leur relevage. *Un paramètre qui sert deux populations ne peut pas en corriger une
seule.* On dédouble donc la formule : au-dessus de la cible, `gain × DARK_PUSH` (1.5) borné par
`GAIN_MAX_NEG` (0.200) ; au-dessous, la formule d'avant, bornée par `GAIN_MAX` — et les courbes des
spans à gain positif sont **identiques au chiffre près** (c'est la preuve du « clairs uniquement »,
elle se vérifie en comparant les `lum.curve` avant/après, pas en regardant l'image). L'effet est
proportionnel : le plan le plus clair de HK descend à **53,9 %** (62,6 % brut · 55,8 % au tour
précédent), un plan à peine au-dessus de la cible ne bouge quasiment pas (−2,2 %).

**Et symétriquement `LIGHT_PULL` (1.4) sur la branche POSITIVE** (le monteur : *« éclaircit un peu les rushs
sombres »*). ⚠️ **Le piège à ne pas refaire** : le réflexe était de monter la borne du relevage — or
elle **ne mordait pas**, le plan le plus sombre de HK demandait +12,0 % pour +13,0 % autorisés. Ce
qui le limitait, c'était la CIBLE, pas le plafond, et desserrer le plafond n'aurait produit **aucun
changement mesurable**. *Avant de desserrer une borne, vérifier qu'elle mord vraiment.* Le levier est
le multiplicateur ; les bornes (`GAIN_MAX_NEG`/`GAIN_MAX_POS`, 0.200) ne font que lui laisser la
place. Résultat : plan le plus sombre de HK **40,0 % brut → 44,3 % → 46,4 %**. Périmètre réel du
geste : sur les 36 spans du lot, **deux seulement** sont sous la cible (HK span 0, et Yangshuo span 2
à +1,4 % — invisible). L'ancien `GAIN_MAX` unique a été **retiré** : une constante qui ne borne plus
rien mais reste en tête de fichier finit par être lue comme la règle en vigueur.

🛑 **`TARGET_ABS` remonté à 0.560 (6e passe) — PUIS REMIS À 0.520 (8e passe) : c'était une ERREUR de
lecture, et c'est la leçon la plus chère du lot.** le monteur : *« je voulais éclaircir tous les sombres »*.
J'avais mesuré que 34 des 36 spans tenaient dans une bande de 50,3–54,9 %, conclu qu'il n'y avait
plus de population de plans sombres, donc que « tous les sombres » désignait le NIVEAU GÉNÉRAL — et
remonté la cible. Mesure du résultat : le plan clair remontait de 2,2 points quand le sombre n'en
gagnait que 1,4. **J'avais rééclairci les plans clairs que le monteur m'avait fait baisser deux fois.** Son
rappel : *« c'est l'inverse, on doit converger clair/sombre — j'ai demandé à éclaircir le sombre ET
assombrir le clair. »*

⚠️ **La règle à retenir, elle, n'a rien de conjoncturel : LA CIBLE FIXE LE NIVEAU, ELLE NE FAIT PAS
CONVERGER.** Ce qui rapproche deux plans, ce sont les multiplicateurs (`DARK_PUSH`/`LIGHT_PULL`) et
la forme de la courbe (`LIFT_HI`). Toucher au niveau pour répondre à une demande de convergence,
c'est déplacer le point de rendez-vous au lieu de rapprocher les deux qui doivent s'y rendre. La
cible ne se touche donc QUE si le monteur parle du niveau général. *Et le piège d'origine était en amont :
une mesure juste (« la population n'existe plus ») avait servi à re-interpréter l'intention au lieu
d'être rapportée pour qu'il tranche.*

⭐ **`LIFT_HI = 0.80` — le relevage monte plus haut dans la courbe que l'assombrissement** (7e passe).
C'est la suite du constat ci-dessus, et **la leçon dépasse ce réglage** : un gain de +20 % ne rendait
que +7,7 points de luminance moyenne sur HK span 0, et le réflexe (desserrer la borne, remonter la
cible) se trompait de cause. Le vrai frein était la **forme** de la courbe — on relevait à 0,85 le
point 0.35 (les ombres) et à 0,45 seulement le point 0.70 (la fenêtre), or **c'est la fenêtre qui
fait la moyenne de ce plan**. *Corriger une moyenne demande d'agir là où la matière est, pas là où le
réglage est commode.* Le poids haut ne change QUE pour la branche positive (l'assombrissement reste à
0,45), donc les plans clairs sont strictement inchangés — vérifiable sur leurs `lum.curve`. Résultat :
HK span 0 **40,0 % brut → 47,7 % → 49,3 %**, sans qu'un seul plan clair bouge. Une **garde de
monotonie** a été ajoutée au passage (le point 0.70 ne peut plus rattraper le point 1.0) : une courbe
qui s'inverse dans les hautes lumières solarise l'image sans que rien ne le signale.

⚠️ **`signalstats` rend les valeurs dans la profondeur de la SOURCE.** Les rushs DJI sont en 10 bits :
`YAVG ≈ 620` et `YMAX ≈ 950` sur **1023**, pas sur 255. Une formule écrite « en 8 bits » saturait le
rolloff au maximum pour TOUS les plans — la correction ne corrigeait plus rien, et rien ne le disait.
L'outil **détecte l'échelle** au lieu de la supposer. Et la correction se juge **sur une planche
avant/après composée sur la vraie image**, jamais sur les chiffres seuls.

⚠️ **Piège de parsing d'arguments, commun aux deux outils** : `args[args.indexOf('--x') + 1]` vaut
`args[0]` quand le flag est absent (`indexOf` = −1) — donc le CHEMIN de l'EDL était lu comme valeur
numérique, `NaN`, et `slice(0, NaN)` rendait un tableau vide **en silence**. Toujours passer par un
`getf(clé, défaut)` qui teste `i >= 0`.

### 2e. Balayage d'une borne — `sweep.mjs`  ⭐ (02/08) — un INSTRUMENT, pas un verdict
```
node facecam/sweep.mjs <edl.json|edl.refined.json> --span <idx|label> [--borne a|b]
     [--sens dedans|dehors] [--n 12] [--marge 0.45] [--motif "…"] [--prendre 241.30] [--apply]
```
Le balayage a servi **six fois** le 02/08 (HK 102,80 · GZ 36,40 · GZ 114,90 · HK 274,20, puis
HK 55,35 · HK 241,30) sans jamais exister ailleurs que dans un dossier de `.wav` jetables.
Il sert quand `relances.mjs` laisse une **scorie** trop courte pour son détecteur, ou quand
`refine.mjs` a mangé un mot en queue (`--borne b`).

Il propose N bornes candidates + **toutes les frontières de silence**, re-transcrit chacune en
`large-v3`, et rend un tableau `borne · ce qu'on entendrait · verdict`. Deux tests
**DISQUALIFIENT**, et aucun ne lit le contenu du texte :
- **borne dure** — une coupe ne peut pas dépasser `--marge` (45 % du span) ;
- **silence** — la borne doit tomber dans un silence mesuré (`silencedetect −24 dB`, ±0,06 s).
  Une borne posée DANS la parole coupe un mot ; ça se lit au signal, pas au modèle.

**`--sens dehors` (18/09) — la borne RECULE** (`a` plus tôt, `b` plus tard), pour RENDRE un mot
que la borne coupe, au lieu d'en rogner un. Cas qui l'a fait naître : une borne posée pour
supprimer de l'air sur `unesco-tenues-traditionnelles` mordait ensuite dans « patrimoine ».
Sans ce sens, la seule sortie était de reposer la borne **à la main** — c'est-à-dire de sortir
de l'instrument au moment précis où l'on en a le plus besoin. Les deux tests s'appliquent à
l'identique, et la fenêtre de mesure des silences est élargie au périmètre balayé (sinon les
frontières du côté « dehors » n'existent pas comme candidates et le balayage ne voit rien).

⚠️ **Et son test de silence reste le wide-band `silencedetect`** : sur un rush de rue il se
trompe. Sur ce même span il a refusé 501,960 comme « DANS la parole » alors que `vad.py`
(300-3400 Hz, régime dense) mesure l'attaque de voix à **502,08**. *Une sonde se réfute avec la
grandeur qu'elle mesure* — la leçon du 18/09 écrite pour `parole.mjs` n'a pas encore été portée
ici. Dette nommée.

**⭐ Pourquoi il n'élit rien tout seul — la 1ʳᵉ version a ÉCHOUÉ sur le cas connu.** Elle élisait
« la plus grande borne qui garde la phrase entière », en comparant chaque candidate à une
transcription de RÉFÉRENCE du span. Rejouée sur HK (réponse humaine `a` 239,26 → 241,30), elle a
proposé **243,180, soit 3,9 s de contenu réel coupé**. Deux causes :
1. « la plus grande borne » est une règle de **maximisation** — toute coupe plus longue reste un
   suffixe valide de la référence, donc rien ne l'arrête avant la borne dure. Le geste demandé
   n'est pas de couper le plus possible, c'est d'enlever **ce qui se redit** : la règle est
   minimale, pas maximale.
2. **whisper n'est pas monotone** : la fenêtre commençant 2 s plus tard a rendu 26 mots contre 25
   à la référence, qui avait avalé son propre début. Comparer deux transcriptions de fenêtres
   différentes est un sol qui bouge — la référence **rejetait la bonne réponse et validait la
   mauvaise**.

C'est la leçon de `relances.mjs` §2c appliquée à un autre étage : *quand un garde-fou repose sur un
modèle génératif, lui adjoindre une mesure qui ne peut pas halluciner.* Ici la mesure est le
silence ; le texte s'affiche pour que l'humain tranche. Élire demande donc une intention explicite :
`--motif "<mots>"` (la plus petite coupe qui fait disparaître ce motif de la tête — c'est le cas de
l'**écho ENTRE spans**, angle mort de `relances.mjs`) ou `--prendre <t>` (tu as lu le tableau).

**Validé sur le cas connu** (doctrine : un instrument de mesure se valide avant de servir) :
`--prendre 241.30` est accepté et rend exactement le texte gardé le 02/08 ; `--prendre 243.180`
— la borne que la 1ʳᵉ version élisait — est **refusée** par la mesure de silence.

⚠️ Piège payé à l'écriture : le `.replace(/\./g,'p')` du nom de cache ne doit porter que sur le NOM
de fichier. Appliqué au chemin complet, il transforme `/.facecam_work/` en `/pfacecam_work/` et
ffmpeg n'a plus de dossier où écrire.

### 2f. Garde de la parole — `parole.mjs` + `parole.py`  ⭐⭐ (05/09) — IL BLOQUE LE RENDU
```
node facecam/parole.mjs <master.mp4> [--carte carte.json] [--edl edl.json] [--span label]
```
Le 05/09, le monteur a dû signaler **cinq** défauts à la main sur un master que tous les contrôles
existants avaient laissé passer : trois relances (« en fait elle est… en fait elle est
construite sur… »), un « euhhh » de 0,76 s, un mot amputé. `refine` ne voit pas le sens,
`relances` ne teste que les bursts de tête, `joins` ne mesure que la forme, et `coherence`
travaille sur la carte, pas sur le rendu. Il manquait le contrôle du LIVRABLE.

⭐ **Et la parade évidente ne marche pas : relire le transcript du rendu est AVEUGLE par
construction.** whisper **DÉDUPLIQUE** deux prises identiques consécutives. Mesuré sur
`relief-rues-superposees` : la fenêtre entière rend *une* phrase, les deux bursts transcrits
séparément en rendent *deux*. J'avais fait exactement ça la veille et conclu « 3 défauts sur 4
étaient des faux positifs » — **c'était l'instrument qui effaçait la relance**, pas la relance
qui était absente. *Un instrument qui déduplique ne peut pas prouver une absence.*
D'où la règle du module : **on ne transcrit JAMAIS une fenêtre qui contient plusieurs bursts.**
On découpe d'abord au silence (mesure), puis chaque morceau est transcrit seul.

Quatre contrôles, chacun sur une grandeur qui ne peut pas halluciner :

| # | Défaut | Ce qui le mesure | Pourquoi les autres ne le voient pas |
|---|---|---|---|
| a | **relance** | découpe au silence → chaque burst transcrit SEUL → test de **préfixe** entre bursts voisins | le transcript global fusionne les deux prises |
| b | **« euh » long** | **stabilité spectrale** (`parole.py` : cos entre trames voisines) puis la seule plage transcrite → filler | collé à la parole, ce n'est pas un burst : whisper l'écrit « … » ou l'efface |
| c | **queue perdue** | dernier mot du span rendu vs texte de l'**îlot** de `map.mjs` (transcrit avant toute coupe) | rien ne comparait le livrable à ce qui avait été dit |
| d | **borne `b` dans la parole** | la borne doit tomber sur une **frontière de silence** mesurée | le mot amputé reste **lisible au texte** (« dynasties » rogné de 0,37 s) — aucun contrôle textuel ne peut le voir |
| e | **borne `a` qui AMPUTE la phrase** (19/09) | transcription de `[a,b]` **contre** `[début de l'énoncé, b]`, alignées par la QUEUE, on ne compte que les mots de **contenu** perdus | l'ancien test élargissait de **0,35 s** et cherchait un seul mot changé : il manquait 1,48 s de phrase sur `agences-francaises` — *un instrument ne voit pas ce qui ne tient pas dans sa fenêtre* |
| f | **micro-segment de tête** (19/09) | dans `render.mjs`, sur le **plan de coupe** : un keep de moins de 8 images | rien ne regardait le plan ; et la différence image à image, à seuil absolu, désignait 6 spans dont 5 faux |

**Le test (e) : où s'arrêter EST la mesure.** Élargir jusqu'au début de l'îlot ferait entrer la
fausse prise que `refine` a volontairement sautée (19 spans sur 44 en ont une) ; élargir d'une
marge fixe rate le défaut. Ce qui sépare une fausse prise de la suite d'une phrase n'est ni la
distance ni l'îlot, c'est une **PAUSE** — `vad.debut_de_souffle`, bande vocale, dernier creux
avéré de 0,20 s. Quatrième étage : si ce qu'on « récupérerait » **REDIT** ce qu'on garde, c'est
une fausse prise et le cas appartient à la dimension **relance**, pas à celle-ci. *Deux
dimensions qui se disputent le même cas se contredisent tôt ou tard : on désigne le propriétaire.*

**Le blanc de tête ne se mesure pas par un onset** (19/09) : `air_de_tete` rend le plus long
**silence avéré** devant la voix, et l'instant où ce creux finit. La v1 rendait le début de la
1re île — un onset, calé sur un pic tenu, arrêté par la moindre pause intra-phrase : 4 spans
annoncés à 0,32-0,44 s de blanc alors que la voix y attaque à 0,00 s, 4 réserves posées pour
rien, et un remède `a → a + air` qui aurait effacé leur premier mot. Cas connus rejouables dans
les deux sens (ce qui doit crier, ce qui doit se taire) : `node facecam/overlays/vad-cas.mjs`.

⚠️ **La CARTE passée au garde est validée contre les clips de l'EDL** (19/09). Elle était choisie
au NOM (premier `carte*.json`) et c'est `carte-aout.json` — l'épisode #02 — qui partait : aucun
span résolu, dimension QUEUE muette, et le quitus écrivant « toutes dimensions mesurées ».
Sans carte valide, `render.mjs` REFUSE (réserve : `MONTAGE_QUEUE_RESERVE`).

**Le test (b) est composite, et c'est le point** : la stabilité spectrale seule sort ~10 plages
par bloc dont 9 sont de la vraie parole (une voyelle tenue normale est stable elle aussi). Ce qui
tranche, c'est de transcrire **la seule plage** : sur les 7 plages d'un même bloc, la seule qui
rende un filler est le vrai « euh », les six autres rendent des mots (« fait », « de », « des gens
où »…). *Une mesure qui ne peut pas halluciner désigne les candidats ; une lecture bornée à moins
d'une seconde, où whisper ne peut pas fabriquer une phrase, les départage.*

**Le test (d) est une leçon RECYCLÉE, pas une invention** : « la borne doit tomber dans un silence
mesuré » existait dans `sweep.mjs` **depuis le 02/08** et n'avait jamais été portée au contrôle
final. C'est le motif déjà écrit ailleurs — *une leçon corrigée à un endroit se porte à tous ceux
qui ont la même forme* — repayé une fois de plus, et cette fois par le monteur à l'oreille.

⚠️⚠️ **LES DEUX BORNES NE SE JUGENT PAS AVEC LE MÊME TEST — et ce n'est pas une affaire de
seuil.** `refine` avance `a` par probe jusqu'au premier mot de CONTENU : elle tombe donc
VOLONTAIREMENT dans la parole (elle coupe « Donc », « Et donc »). Appliquer le test de silence aux
deux a crié sur **9 spans sur 44**, et son remède — « a → premier silence suivant » — aurait
supprimé des **phrases entières**. Ce qui décide du test, c'est le DÉFAUT cherché, pas la symétrie
du code :
- `b` n'est jamais reculée exprès → **test de silence** (`lib.mjs`, partagé avec `sweep`) ;
- `a` → **test DIRECT de troncature** : le premier mot rendu doit se retrouver en élargissant la
  fenêtre en amont. S'il change, on a coupé dedans.
*Un proxy qui vaut pour une borne ne vaut pas pour l'autre.*

⚠️ **Le test de tête a lui-même deux pièges**, tous deux payés le 06/09 : ① l'élargissement doit
s'ARRÊTER au silence précédent, sinon on entend le **bloc d'avant** et on compare deux contenus
différents (vécu : « Xi'an » entrait dans la fenêtre — un mot que le monteur ne prononce jamais dans ce
bloc — et le contrôle criait sur une tête propre) ; ② whisper n'étant pas monotone, on ne compare
pas UN mot à UN mot : on demande que le premier mot rendu se retrouve **en tête** de la version
large, sinon il a été amputé.

⚠️ **UNE SEULE DÉFINITION du critère de borne, dans `lib.mjs`.** Il en existait deux :
`sweep.mjs` (silencedetect `d=0.08`, « la borne tombe dans un silence ») et le garde (`d=0.10`
+ proximité d'une frontière). Résultat : **deux bornes posées ET VALIDÉES par sweep** étaient
déclarées fautives par le garde. *Quand deux outils mesurent la même grandeur et se contredisent,
l'un des deux ment — et on ne le saura jamais tant que la règle vit en deux endroits.*
(`SIL_NOISE`/`SIL_D`/`SIL_TOL` + `silencesAutour` + `borneCoupeUnMot`.)

⚠️ **QUATRE gardes cassés avant de servir, tous VERTS ou ROUGES à tort** — même famille que les
trois essais de `burn.mjs` le 01/09 : ① le détecteur de « euh » échouait **en silence** (chemin
python URL-encodé, `%20`) et le verdict annonçait « 0 euh » → une mesure indisponible **lève**
désormais, et le span est marqué **NON MESURÉ** (bloquant) ; ② la continuité stricte du plateau
fragmentait le vrai « euh » (sim moyenne 0.9913, donc **au-dessus** du seuil) en morceaux trop
courts — corrigé par la règle de **DENSITÉ** déjà écrite pour `vad.py` le 01/09 ; ③ le contrôle
de QUEUE criait **4 fois pour 1 vrai défaut**, trois alertes portant sur 0,02–0,05 s, c'est-à-dire
deux lectures whisper du même son → il exige maintenant `QUEUE_MIN_S = 0,25 s` de son réellement
coupé (*une divergence de transcription n'est pas une perte de contenu*) ; ④ une plage stable prise
**au milieu d'un mot** se transcrit aussi « Euh… » (0,49 s au milieu de « par soucis de sécurité »)
→ 3ᵉ étage, la plage doit être **bordée d'une pause** (`borde()`). *Un test composite ne vaut que
si chaque étage peut dire non pour une raison différente.*

**Éprouvé dans les deux sens avant de servir** (doctrine : un garde neuf se valide sur un cas connu
FAUX) : il mord sur les 5 défauts entendus par le monteur **et** sur un cas fabriqué — une borne poussée de
0,30 s dans un mot, « pingyao » devenant « gauss » ; il se tait sur les 6 voyelles articulées du
même bloc et sur les bornes que `sweep` avait validées. ⚠️ Le premier essai de ce test fabriqué
n'a **rien attrapé** : je sabotais l'EDL alors que le garde contrôle le MASTER — il fallait saboter
le `.spans.json`. *Un cas de test doit être injecté là où l'outil regarde vraiment.*

🚧 **Ce que le garde NE couvre PAS, et qu'il faut dire** : une voyelle tenue sous `euhMin`
(0,30 s), ou prise en plein débit sans pause adjacente. Il rend impossible ce qui a été signalé,
pas « toutes les erreurs ».

🛑 **`render.mjs` l'appelle et REFUSE de livrer** si le garde mord (`MONTAGE_NO_PAROLE=1`
désarme, débogage seulement). C'est délibéré et c'est la moitié qui compte : la veille, la leçon
« re-transcrire le rendu » était écrite dans RESTITUTIONS **et n'a rien empêché**. Le rendu est le
seul point par lequel un master doit passer. Une exception se **déclare et se chiffre** dans l'EDL
(`_reserves_parole: ["<label>:<type>"]`), jamais en baissant un seuil.

## Serrement — les 4 paliers nommés (10/09)

**Deux niveaux existaient déjà, sans nom.** Une mesure sur les 30 EDL du store l'a montré :
18 portaient `0.02 / 0.06 / 0.35 / 0.16`, 2 portaient `0.05 / 0.10 / 0.5 / 0.24`, et 10 ne
posaient rien — donc prenaient les défauts du code, `tail 0.18`, **le réglage d'aucun montage
livré**. Le serrement se recopiait à la main d'un EDL à l'autre, et un EDL neuf sortait plus mou
que tout le reste sans que rien ne le signale.

```
node facecam/render.mjs <edl.json> --serrement serre
node facecam/refine.mjs <edl.json> --serrement serre     # le MÊME palier aux deux étages
node profil.mjs                                           # voir les 4 paliers et leurs valeurs
```

| Palier | lead · tail · seuil · cible | Pour quoi | État |
|---|---|---|---|
| `historique` | 0.05 · 0.18 · 0.5 · 0.24 | ce que le code servait avant le 10/09 | ⚠ **aucun master livré** |
| `doux` | 0.08 · 0.25 · 0.70 · 0.40 | propos posé, lecture, ton calme | ⚠ jamais éprouvé |
| `normal` | 0.05 · 0.10 · 0.5 · 0.24 | mesuré sur `vlog_chine` | éprouvé (2 EDL) |
| `serre` | 0.02 · 0.06 · 0.35 · 0.16 | **le réglage de travail réel — le défaut depuis le 10/09** | éprouvé (18 EDL) |
| `tres-serre` | 0.01 · 0.04 · 0.25 · 0.10 | au-delà de `serre` | ⚠ jamais éprouvé |

**L'ordre de priorité, et pourquoi il ne casse rien :**

1. une clé posée dans l'EDL (`lead`, `tail`, `silThresh`, `silTarget`) **gagne toujours** — les
   20 EDL déjà rendus sont intacts, et le rendu dit « mais lead, tail imposé(s) par l'EDL » ;
2. `--serrement <palier>` — le choix du moment ;
3. la clé `serrement` de l'EDL — le choix collé au projet ;
4. le palier par défaut du profil (`serrement.defaut`), aujourd'hui **`serre`**.

**Trois choses que le moteur DIT plutôt que de les taire :**

- aucun serrement déclaré → il annonce le palier du profil qui a servi, avec sa queue et sa
  respiration, et rappelle les autres. Un réglage reçu sans l'avoir demandé doit s'entendre ;
- un palier `eprouve: false` → il l'annonce avant de rendre. C'est `parole.mjs` qui tranchera si
  une queue est mangée : **le garde reste le juge, le palier n'est qu'un candidat** ;
- un palier inconnu **arrête** le rendu au lieu de retomber sur un autre — un serrement choisi et
  non appliqué sortirait un master hors intention, en silence.

**Le défaut est passé de `historique` à `serre` le 10/09/2026** (`profil/defaut.json`,
`serrement.defaut`) : `historique` n'était le réglage d'aucun montage livré, `serre` est celui de
18. Ce que ça change sur l'existant : **rien, et c'est mesuré** — les **20** EDL rendables du store
posent tous `lead`/`tail`/`silThresh`/`silTarget`, qui gagnent sur le palier. Les « 10 EDL nus »
qu'annonçait la note d'origine étaient les **10 rapports `*.joins.json`** produits par `joins.mjs`,
que `render.mjs` ne lit jamais : le comptage prenait des rapports de métriques pour des plans de
coupe. Le nouveau défaut ne concerne donc que les EDL **à venir** qui ne déclarent rien. Pour
retrouver l'ancien comportement : `--serrement historique`, ou `"serrement": "historique"` dans l'EDL.

### 3. Rendu — `render.mjs`
```
node facecam/render.mjs <edl.json | edl.refined.json> [--def 1080|2160] [--out x.mp4] [--serrement <palier>]
```
Span **refined** : `a`/`b` déjà collés à la voix → pas de re-détection d'onset dB (sinon on ré-inclut la
respiration) ; applique les `cuts[]` fillers. Span **legacy** : **tête serrée** (redetecte l'onset,
démarre à `onset − lead`). Dans les deux cas : **compression** des silences internes ≥ `silThresh` → `silTarget`
(coupe dans le silence → aucun mot tronqué), scale à la **définition courante** (`Réglages/definition.txt`,
1080 par défaut · `--def 2160` pour du 3840×2160 natif — les rushs parlés SONT en 4K) / fps 29.97 /
x264 CRF `crf`. Les segments intermédiaires vivent dans un `.facecam_work/segs<def>/` propre à la
définition, et `--out` évite d'écraser le rendu de référence.

#### ⭐ La SOUDURE est CFR, et elle se MESURE avant de rendre la main (18/09)

le monteur, sur le master du 17/09 : **« le son est décalé de mes paroles »**. Ce n'était pas un défaut de
synchro à la prise : c'était l'**horloge du master**. Le concat démuxer cale chaque fichier sur la
durée de son CONTENEUR, or la piste AAC d'un segment dépasse toujours un peu sa vidéo (granularité de
1024 échantillons = 21 ms, plus le delay d'encodeur). Ces restes ne se compensent pas, ils
s'additionnent en **trous dans la timeline vidéo** — mesuré sur `VLOG_Chine03_facecam_v1` :
**19 sauts, +0,355 s d'avance du pts sur l'index à la fin, 0 recul**.

C'est fatal en aval, et invisible autrement : `vlog.mjs` découpe l'**image par index** et le **son en
secondes**. Sur un master qui dérive, les deux ne désignent plus le même instant. Les contrôles de
durée, de compte d'images et de dérive A/V étaient **tous au vert** — *un critère vert ne couvre que
la dimension qu'il regarde.*

Le remède n'est pas neuf : **`fusion.mjs` l'applique déjà un étage plus haut** — re-mux MPEG-TS (ni
edit list ni `start_time` à propager), `duration` explicite **dérivée du compte d'images** et jamais
du champ `duration` du conteneur, audio reconstruit puis recadré à la durée VIDÉO de chaque morceau.
Il ne pouvait pas sauver le #02, dont les ENTRÉES dérivaient déjà en interne ; ici les segments
sortent d'un `fps=` et sont CFR chacun, donc la soudure l'est aussi. **« Qui d'autre a la même
forme ? » avait une réponse, et personne n'était allé la chercher.**

`render.mjs` **refuse** désormais de livrer un master dont l'écart index↔pts dépasse 40 ms ou qui
recule. Mesuré après correction : **9 031 images, écart 0 ms, 0 recul, `start_time` 0, dérive A/V 0 ms.**

#### Ré-adresser la table des sujets — `sujets.mjs` (18/09)
```
node facecam/sujets.mjs <master.spans.json> --villes <ancien-sujets.json> --out <sujets.json> [--dry]
```
`vlog.mjs` exige un `sujets.json` en secondes absolues du master. Pour un lot rendu ville par ville
c'est `fusion.mjs` qui l'écrit ; pour un master rendu **d'un seul tenant**, personne — et le geste se
faisait à la main. Il a donc fallu le réinventer dès que les bornes de l'EDL ont bougé, c'est-à-dire
au pire moment. *Une chaîne qu'on ne peut pas rejouer n'est pas une chaîne.*
La **ville** n'est écrite nulle part dans le manifeste de spans : elle est reprise **par LABEL** (jamais
par rang) depuis la table précédente, et l'outil **refuse** si un label n'a pas de ville connue — un
champ vide ferait tomber le carton de ville au mauvais endroit. Gardes : contiguïté à 0 ms sur tous
les spans, et somme des bornes = durée du master.

> ⚠️ **LA COMPRESSION DE SILENCE PEUT FABRIQUER UN SAUT VISIBLE EN TÊTE DE SPAN** (31/08). « Coupe
> dans le silence → aucun mot tronqué » est vrai pour le SON et faux pour l'IMAGE : le raccord
> reste un saut de pose. Tant que le silence est *interne*, il est masqué par le débit ; en **tête
> de span**, il produit un micro-segment que le spectateur lit comme un faux départ.
> Vécu sur `quartiers-coloniaux` (Guangzhou) : `a = 114,9` tombait dans la **relance n°1** (parole
> 114,325 → 115,00), suivie d'**1,0 s de silence** compressée à 0,16 s. Le bloc rendu montrait donc
> **6 images** de la relance, puis un saut, puis la vraie prise (116,025). `refine` ne le voit pas
> (la borne est bien collée à de la voix), `relances` non plus (la relance n'est pas *entièrement*
> dans le span), et le compte d'images est juste.
> **Le contrôle qui l'attrape** : différence image à image sur les 30 premières frames du span —
> un pic isolé à moins de 0,5 s de l'entrée = un saut de tête. `joins.mjs` mesure les raccords
> ENTRE spans ; celui-ci est *dans* le span.
> **La parade** : `a` se pose sur le début de la **prise voulue**, pas sur le premier son présent.
> Quand un span commence par une relance suivie d'un blanc, remonter `a` après le blanc.
Puis concat démuxer + **loudnorm une seule fois** (−16 LUFS ; pas par segment → pas de saut de niveau).

#### Manifeste de spans `<rendu>.spans.json` — la non-dérive se MESURE (31/07)
Chaque rendu dépose à côté de lui le **compte d'images span par span** (+ son offset et son
timecode), et se **compare automatiquement** au dernier manifeste du même EDL — en ne regardant que
les spans que l'EDL n'a pas touchés (même clip, mêmes bornes) : une frontière déplacée exprès est
une décision, pas une dérive.

**Pourquoi.** Rejouer le MÊME EDL sur les MÊMES rushs ne garantit pas le même nombre d'images : le
rendu 4K du 31/07 est sorti à **13 532** images là où celui du 25/07 en faisait **13 533** — une
seule image, dans `programme-itineraire`, très probablement un ffmpeg qui a changé de version entre
les deux dates. Une image, c'est 33 ms : invisible. Mais **tout ce qui indexe le rendu par TIMECODE
en dépend** — les `t0`/`t1` du plan de burn des overlays, les frontières de `sujets.json` qui
découpent les blocs du vlog, les sous-titres. Le problème n'était pas la dérive : c'était de
l'apprendre par hasard, en comparant deux durées totales.
Le rendu dit maintenant, en clair : quels spans ont dérivé, de combien, **à partir de quel
timecode** — donc quelles frontières aval sont à revérifier.
Référence en place : `VLOG_Chine_facecam_v11_4K.spans.json` (13 532 images, 28 spans).

#### ⚠️⚠️ LES IDS `cN` NE SONT PAS STABLES — la table `clips` de l'EDL fait foi (31/07)
`listClips()` numérote `c1..cN` par **ordre alphabétique du dossier**. Donc **déposer un seul rush de
plus dans l'inbox décale tous les ids**, et un EDL écrit la veille désigne d'autres fichiers.
Ce n'est pas une hypothèse : en rejouant l'EDL du VLOG #01 pour le master 4K, un
`DJI_20260724143315_0001_D.MP4` copié dans l'inbox après coup a décalé les 10 clips d'un cran. Les
**28 spans ont tous été « rendus »**, le script a fini en vert, et le fichier faisait **220,0 s au lieu
de 451,8 s** : 9 segments **vides de 695 octets** (un `-ss` au-delà de la fin d'un rush plus court fait
sortir ffmpeg avec un **code retour 0** et un mp4 sans piste) et 1 tronqué. Aucune erreur, aucun
avertissement — seule la durée finale trahissait quoi que ce soit.

Deux parades, désormais dans le moteur :
1. **un EDL peut porter sa table `clips`** (`{"c1": "DJI_….MP4", …}`) — l'attribution d'un id est une
   décision de montage, elle appartient à l'EDL, pas à l'état d'un dossier. `render.mjs` la préfère,
   et **dit** combien d'ids l'ordre alphabétique attribuerait autrement ;
2. **garde dure** sinon : chaque span doit tenir dans la durée de son rush, sinon le rendu est
   **annulé** avec le détail des débordements. Un segment vide ne peut plus passer pour un rendu.

La table du VLOG #01 a été figée depuis `carte.json` (l'inventaire du 25/07, celui sur lequel l'EDL a
été écrit). **Réflexe pour tout nouveau vlog : `map.mjs` écrit `carte.json`, l'EDL en recopie la table.**

### 4. Preuve (clôture obligatoire)
Re-transcrire le mp4 final (chaque sujet 1×, joints propres) + extraire des frames et les Read.

## Réglages
| clé | défaut | effet |
|---|---|---|
| `lead` | 0.05 | respiration gardée AVANT l'onset (↓ = tête plus serrée) |
| `tail` | 0.16 | silence gardé après la fin d'un span |
| `silThresh` | 0.5 | silence interne compressé au-delà de cette durée |
| `silTarget` | 0.24 | durée cible d'un silence compressé (↓ = plus punchy, risque robotique) |
| `hflip` | false | remet l'image **miroir DJI selfie** à l'endroit (texte lisible) |
| `crf` | 20 | qualité x264 (brouillon) |

**Preset « dynamique » (validé sur le vlog Chine, demande « plus sharp, moins de silence ») :**
`lead 0.02` · `tail 0.06` · `silThresh 0.35` · `silTarget 0.16`. Gain mesuré : −5,4 s sur 7:45 et surtout
**beaucoup plus de coupes internes** (le temps mort *dans* les phrases). Vérifié sans troncature de mot
(les 5 segments finissant le plus fort, jusqu'à −15 dB, re-transcrits = identiques à la source).
⚠️ Ne pas descendre `silTarget` sous 0,16 (robotique). Pour détendre sans rallonger les pauses : remonter `tail`.
⚠️ Un segment qui finit à fort niveau (> −30 dB) n'est **pas** un signe de troncature : en français la syllabe
finale est souvent accentuée. Seule la **re-transcription comparée à la source** tranche (le seuil dB ment ici).

## Obstacles → solutions (le cœur du module, chèrement acquis)

**Sur whisper (ne JAMAIS lui faire confiance en aveugle) :**
- **Frontières de mots fausses en tête** — small ET large-v3 posent les mots d'amorce *dans le silence*
  (« et que c'est » à 75,06 alors que l'audio est muet jusqu'à 75,56). → Amorce = **probe incrémental**
  (avancer + re-transcrire), pas un timestamp « plus précis ». Un plus gros modèle ne règle PAS l'alignement.
- **Hallucinations = détecteur de non-parole** — « Amara.org », « Sous-titres… », « Merci d'avoir regardé »,
  « Abonnez-vous », « Radio-Canada » n'apparaissent que sur silence/souffle/bruit → burst qui les produit = DROP.
- **⚠️ Hallucination la plus dangereuse : l'AMORCE PLAUSIBLE inventée sur du silence.** Si la fenêtre transcrite
  commence par du silence, whisper peut fabriquer une phrase **crédible et contextuellement juste** — pas un
  marqueur repérable. Mesuré : transcrire `c10 [0→26]` a produit « **Shanghai c'est évidemment une ville à
  faire, déjà si vous allez en Chine** » alors que `[0→9,2]` est du **silence pur** (−50 à −64 dB) et ne donne
  « … » une fois transcrit seul. J'ai failli remonter dans l'EDL une phrase **qui n'existe pas**.
  → **RÈGLE : avant d'agir sur une phrase transcrite (la remettre, poser une borne), vérifier que l'audio a
  vraiment de l'énergie de parole à cet endroit** (RMS ou `silencedetect`), et re-transcrire **la zone seule**.
  Une transcription faite sur une fenêtre large n'est une preuve que pour les zones réellement sonores.
- **Bursts ULTRA-COURTS (< ~1 s) = aucun modèle fiable en isolé** — small → filler (« voilà voilà »,
  « Amara.org ») ; large-v3 → mots plausibles mais faux (« ce genre de choses » → « sur les choses »). Le vrai
  juge d'un burst court = le **contexte** (bursts voisins) ou l'**acoustique** (pitch/énergie), pas une
  transcription isolée. → re-confirmation large-v3 **des DROP du MILIEU seulement** (un mis-drop y casse une
  phrase = coûteux : c'était le bug « pour pouvoir la voir » à 1:15). En tête/queue, garder le small agressif.

**Sur l'acoustique (couper la voix, pas le bruit) :**
- **Jamais sur le dB seul** — respiration/bruits de bouche passent −30 dB. Onset/offset = voice-gate **−24 dB**
  (−30 → 0,9 s de souffle en trop ; −24 tombe pile sur la voix).
- **Souffle collé = VAD par la HAUTEUR (aubiopitch)** — F0 dans **70–400 Hz** = voix ; énergie sans F0 (ou
  pitch fantôme > 1 kHz d'une fricative) = souffle. Rogner tête/queue sur l'absence de F0, dB-indépendant.
- **Piège consonne initiale non-voisée** (« **S**i », « **C**e », /s/ /p/ /t/) — pas de F0 non plus, un rognage
  au pitch la couperait. → **garde-fou anti-troncature systématique** : 1er/dernier mot re-transcrit large-v3
  doit rester INCHANGÉ, sinon on ANNULE le geste (souffle gardé > mot mangé). C'est LE motif à reproduire.

- **Poser une borne de coupe à la main = BALAYAGE, pas lecture d'énergie.** Pour finir pile après un mot
  (ex. finir sur « …avec toi » sans le « donc » qui suit), le profil RMS ne dit PAS *quel* mot est où : deux
  mots enchaînés sans pause forment **un seul burst continu**, et un creux local n'est pas une frontière de
  mot (erreur commise : creux lu comme « fin de toi », en réalité « toi » n'avait pas commencé → mot tronqué
  au rendu). Méthode fiable = **sweep** : re-transcrire la source coupée à plusieurs bornes candidates
  (pas de 0,05–0,08 s) et retenir la plus grande borne qui contient le mot voulu SANS le suivant, confirmée
  par **deux modèles**. Ajouter ~0,1 s après l'apparition du mot pour lui laisser sa décroissance (sinon ça claque).

**Pièges pratiques :**
- **⚡ Changer l'ORDRE des spans ne demande AUCUN ré-encodage.** Les segments de `.facecam_work/segs/` sont
  produits **avant** le loudnorm final → un réordonnancement (ou le retrait d'un span) se rend en **re-concat
  des mêmes fichiers + un seul `loudnorm`** : ~1 min au lieu de ~8. Ne relancer `render.mjs` en entier que si
  un `a`/`b`/réglage change vraiment. Pour raccourcir UN span : `ffmpeg -i seg.mp4 -t <durée>` (ré-encode ce
  seul segment) puis re-concat. ⚠️ Mapping seg→source : `source = R0 + keepStart + t` avec `R0 = a − 0.30` et
  `keepStart = (a − R0) − lead` — **valable seulement si `cutsInternes = 0`** pour ce span (sinon le temps
  du segment n'est plus affine ; le log de `render.mjs` donne `cutsInternes` par span).
- **`-t` AVANT `-i`** dans le rendu par span : avec un filtre `select`, le `-t` de sortie ne se déclenche
  jamais (temps de sortie gelé sur frames droppées) → ffmpeg décode le rush jusqu'au bout (hang sur 8 min).
- Image DJI selfie = **miroir natif** (texte à l'envers), pas un bug → `hflip:true` **seulement si publié**.
- Ne PAS baisser `silTarget` trop bas : « dynamique mais pas robotique » (doctrine STYLE.md).
- Les rushs ne sont **jamais** supprimés ; tout le travail transite par `<rushDir>/.facecam_work/`.
- Jamais publier (upload YouTube manuel).

## Bonnes pratiques d'itération (méta — pour la prochaine fois)
1. **Diagnostiquer AVANT de coder** : un défaut audio (phrase cassée, souffle) se localise en re-transcrivant
   le rendu au timecode signalé, puis en remontant au span/burst source. Le mini-EDL (2-7 spans ciblés) est
   l'outil : on refine/render SEULEMENT les spans concernés → boucle de quelques minutes, pas 15.
2. **Un geste risqué = un garde-fou qui ANNULE** : dès qu'un traitement peut manger un mot (rognage, cut), lui
   coller une vérification qui compare avant/après et revient en arrière au moindre doute. Le doute par défaut = ne rien couper.
3. **Valider sur les cas limites, pas la moyenne** : tester le rognage sur un mot à /s/ initial (« Si »/« Ce »)
   ET sur un souffle franc — pas juste un cas facile. Une régression se cache toujours dans un cas non testé
   (ici : le rescue tête/queue ré-incluait « ce genre de choses », attrapé en énumérant TOUS les rescues avant le render).
4. **Garde-fous moteur** : `cp refine.mjs refine.mjs.bak-$(date …)` + `node --check` avant tout run ; jamais
   `import` d'un script prod pour le tester (le top-level s'exécute). **Un durcissement à la fois**, validé au
   niveau refine (deltas par span) AVANT le render complet.
5. **Clôture = preuve** : re-transcription du rendu final (phrases complètes, joints propres) + mesure
   pitch/énergie en tête + frames Read. Garder **N/N-1**, purger N-2. Rien n'est « fait » sur la foi d'un log.
6. **Contrôle des RÉFÉRENTS (sens, pas technique)** — un bloc entier peut être techniquement parfait et
   pourtant **incompréhensible** : le spectateur ne sait pas de quoi on parle. Cas vécu : tout le bloc Shanghai
   (4 spans, 1,5 min) sans que la ville soit **jamais nommée** — le rush qui le porte ouvre sur un pronom
   (« **C'**est évidemment une ville à faire »), son référent étant dans une AUTRE prise, montée 90 s plus loin.
   → Après avoir figé l'ordre de l'EDL, relire la suite des `label`/textes et vérifier que **chaque bloc nomme
   son sujet à sa première occurrence** (ville, personne, « ils », « là-bas »). Un pronom en tête de span est
   le signal d'alerte. Se corrige par **réordonnancement**, pas par récupération de rush.
7. **Quand le constat contredit la demande, le dire.** « Tu as coupé le passage où je disais X » → si la
   recherche montre que X n'a jamais été dit à cet endroit, l'annoncer avec la preuve (carte des îlots +
   mesure d'énergie) et proposer le vrai correctif, plutôt que remonter un passage halluciné.
8. **Revoir une chronologie = carte des sujets, puis ACTES.** Transcrire **chaque segment rendu** séparément
   (`segs/*.mp4`, small suffit) → une ligne = un sujet. Grouper en 4-6 actes (accroche / le lieu / ce qui
   surprend / le pratique / soi) et vérifier les **transitions aux frontières d'acte**, pas span par span.
   Terminer sur une **recommandation tournée vers le spectateur**, pas sur du personnel : sur le vlog Chine,
   finir sur « ça vaut le coup d'y aller, 2 h d'avion, une escale suffit » >> finir sur « je voyage solo ».
   Placer juste avant la clôture le span qui **énumère** (l'itinéraire) : il fournit le référent ET la relance.
   Guetter les **doublons créés par le déplacement** (ici la queue « je travaille à distance » de l'itinéraire
   redisait le span « rythme jour/soir » remonté avant) — un réordonnancement peut créer une redite qui
   n'existait pas. **Retirer du contenu du monteur = toujours lui demander** (doctrine : couper le vide, pas le fond).

## Intelligence de sélection (best-take — fusionné dans facecam le 25/07)

Le choix « meilleure prise / meilleure substance » n'est pas au doigt mouillé : scoreur pondéré +
distillation, sous un régulateur anti-sur-découpe. Principes (exigences du monteur) :
1. **Holistique d'abord** — `subjects.mjs` cartographie tous les sujets AVANT tout cut.
2. **Plan gelé → exécution précise** — l'EDL est explicite ; `render.mjs` l'exécute sans improviser.
3. **Boucle ANTI-RÉGRESSION** — chaque itération scorée contre une baseline verrouillée ; on n'accepte
   un changement que s'il ne régresse aucune décision déjà validée.

**Signaux par prise** (bruts, pondération λ softcodée) :
- audio/texte (whisper conf + aubio + ffmpeg) : fluidité · élocution · voix qui déraille · bruit ponctuel.
- vidéo (`score_video.py`, mediapipe via `.venv-vision` + `models/face_landmarker.task`) : tête stable ·
  yeux ouverts · regard caméra · bouche. Prouvé discriminant (prise ratée → `face_ratio` bas).

**Nettoyages** (sur la carte/EDL) : (1) queues de filler (« donc voilà ») ; (2) faux départs /
répétitions courtes ; (3) même idée redite → meilleure substance + greffe du nugget isolable.

**Régulateur anti-sur-découpe** (cœur, consigne le monteur — PAS de perfection stricte) :
`max(substance) − λ1·nbCuts − λ2·Σ saut_de_pose − λ3·segments_trop_courts`. Défaut conservateur
(lisse > serré). Global : un cut valide est annulé s'il crée un micro-segment ou un saut de pose.

**Claude vs offline** : Claude (en ligne) = jugement sémantique (sujets, nuggets, « n'apporte rien »)
→ rédige l'EDL ; repli offline (Chine) = heuristiques + embeddings locaux + meilleure prise par signaux.

### Le régulateur, exécuté — `joins.mjs`
```
node facecam/joins.mjs <edl.json|edl.refined.json> [--minseg 1.2] [--jump 25] [--pos 0.05]
```
Contrôle le plan **avant rendu**, sans rien couper (le plan reste gelé, tu arbitres) :
- **(a) segments trop courts** (< `minseg`) → « accumulation de cuts courts » ;
- **(b) saut de pose au raccord** → pose de tête + centre du visage de part et d'autre du joint
  (`pose_at.py`, batch : une passe mediapipe par clip). Coût > 1 = ça saute à l'œil ;
- **(c) densité** de raccords par minute gardée.
Sortie `<edl>.joins.json` + verdict. **Mesuré sur l'EDL de v6** (33 spans, 533,9 s) : 0 micro-segment,
4,4 raccords/min ✓, mais **18/32 raccords en saut de pose** — les pires (coût 3,4-3,8, Δcentre ~0,15)
sont TOUS des joints **entre prises différentes**. Vérifié à l'image : même décor/t-shirt, mais la
position dans le cadre saute franchement. C'est la pathologie n°3 du monteur, désormais mesurable.

### Le contrôle du SENS — `coherence.mjs`
```
node facecam/coherence.mjs <carte.json> [--edl <edl.json>] [--minspeech 0.15]
```
Pendant « compréhension » de `joins.mjs` (qui, lui, contrôle la forme). Automatise deux règles
apprises à la dure, plus haut dans ce README :
- **(a) FANTÔMES** — mesure l'**énergie de parole réelle** de chaque îlot (silencedetect, 1 passe par
  clip) : du texte sans énergie = hallucination. ⚠️ Complète le regex `HALLUC` de `refine.mjs`, qui ne
  voit pas un « **Merci.** » nu. **Prouvé** : `c3[4] 79,2-80,3 s` porte « Merci. » à **−49,5 dB**
  (vraie parole voisine : −20,9 dB) → texte inventé sur du silence, re-transcription isolée identique.
- **(b) RÉFÉRENTS** — signale les spans qui **ouvrent sur un pronom sans nommer leur sujet**, avec les
  noms propres déjà posés avant. **Prouvé** sur l'EDL de v6 : 2/33 spans, dont `#9 shanghai-certains-laide`
  (« Ce n'est pas des bâtiments neufs… ») alors que **« Shanghai » n'a jamais été prononcé avant** — exactement
  le bloc incompréhensible identifié à la main. Un pronom en tête n'est pas fatal SI le référent précède :
  c'est un signal, pas un verdict. Se corrige par **réordonnancement** (re-concat, ~1 min, zéro ré-encodage).

### La distillation (3) — `distill.mjs`
```
node facecam/distill.mjs <carte.json> [--sim 0.30] [--embed] [--minseg 1.2]
```
≠ `subjects.mjs` (reprises quasi-verbatim). Ici le monteur redit **la même IDÉE avec d'autres mots**, parfois
loin dans le corpus — souvent sans rien ajouter, parfois avec un **nugget** intéressant. L'outil :
groupe par proximité de sens → calcule le **socle** (ce que toutes les passes disent) et l'**apport
propre** de chacune → désigne la passe **gardienne** (substance max) → signale les nuggets **et leur
position** (début / milieu / **FIN**, le cas typique du monteur).
**Régulateur appliqué** : un nugget n'est « greffable » que s'il est en FIN **et** ≥ `minseg`. Sinon →
garder la gardienne ENTIÈRE (un micro-greffon hache le montage : cohérence > perfection).
⚠️ Les bornes d'un greffon se confirment par **sweep**, jamais au profil d'énergie (cf. §Obstacles).
- `--embed` = vraie proximité de **SENS** via `embed.py` (model2vec, embeddings statiques : numpy, pas
  de torch ; modèle **vendoré** dans `models/embed-multi/`, 506 Mo → 100 % offline ensuite). Vérifié :
  « Je voulais faire la Chine » ↔ « J'avais envie de visiter ce pays asiatique » = **0,41** (aucun mot
  commun) contre **0,09** pour une phrase sans rapport → capte ce que le lexical rate par construction.
- **Deux échelles de seuil** (`--sim`, auto selon le mode) : **lexical 0,30** · **sémantique 0,75**.
  En sémantique tout un même voyage se ressemble déjà : à 0,55 le corpus fondait en **un seul groupe de
  29 passes**. Le regroupement utilise un **linkage MOYEN**, jamais single-linkage (le « max » enchaîne
  tout en boule).
- **Quand utiliser quoi** : le **lexical** est plus précis sur un monologue mono-sujet (corpus Chine :
  3 idées redites, nettes) ; le **sémantique** sert quand le monteur REFORMULE vraiment la même idée avec
  d'autres mots. Les deux sont des **générateurs de candidats** — l'arbitrage final reste sémantique (Claude).
- Mesuré sur le corpus Chine (48 îlots) : 3 idées redites (lexical) / 10 (sémantique), **0 greffon retenu**
  → garder les passes entières. Branche « nugget greffable » vérifiée sur cas contrôlé (apport en FIN
  d'une passe non gardienne → détecté, ~8,5 s).

**(d) ALLERS-RETOURS entre prises** (`joins.mjs`, `--gain 0.3`) — un motif **A-B-A** (deux spans d'une
prise séparés par un span d'une autre) impose DEUX raccords cross-prise là où un regroupement n'en
laisserait qu'un. L'outil calcule le coût de l'ordre **A-C-B** depuis les poses déjà mesurées (aucune
passe mediapipe en plus) et **ne propose que si ça paie**.
⚠️ **Enseignement mesuré, contre-intuitif** : grouper la prise **ne paie pas mécaniquement**. Sur v11,
`A→C` devient bon marché (0,47) mais `C→B` devient cher (1,21) → **1,55 → 1,68 = REFUSÉ**. Le nombre de
transitions cross-prise compte plus que leur adjacence. Ne jamais réordonner « pour grouper » sans mesurer.
Et un réordonnancement change le **SENS** : re-passer `coherence.mjs` (référents) + guetter les doublons
créés par le déplacement, AVANT de rendre (le rendu, lui, est quasi gratuit : re-concat, zéro ré-encodage).

### La gate ANTI-RÉGRESSION — `baseline.mjs`
```
node facecam/baseline.mjs lock  <edl.refined.json> --tag v11      # fige la référence
node facecam/baseline.mjs check <edl.refined.json> --against v11  # exit 0 = OK, 1 = REFUSÉ
node facecam/baseline.mjs list
```
Le piège d'un pipeline qui s'améliore : un réglage gagne sur un axe et **casse silencieusement** un
autre (serrer les silences → ça hache ; réordonner pour le sens → un saut de pose apparaît). La gate
rejoue `joins.mjs` + `coherence.mjs`, agrège leurs métriques, et **refuse toute itération qui dégrade
ne serait-ce qu'une valeur** — *un gain ailleurs ne rachète jamais une régression*. Ajouter un contrôle
à l'un des deux outils le fait entrer automatiquement dans la boucle.
Métriques suivies : segments trop courts · sauts de pose · pire saut · raccords/min · fantômes ·
référents ( + spans / durée en informatif, non bloquant).
**Vérifié** : référence figée sur **v11** (0 micro-segment · 15 sauts · pire 3,92 · 4,2 raccords/min ·
1 fantôme · 2 référents · 28 spans · 455,8 s). Même EDL rejoué → ✅ `exit 0` ; EDL volontairement hachée
(un span coupé à 0,6 s) → ⛔ `exit 1`, régressions nommées (« segments trop courts 0 → 1 »).
Assumer un recul se fait **explicitement**, en re-figeant la référence (`lock`) avec la raison.

État : `relances.mjs` (faux départs) + `lumieres.mjs` (équilibrage de lumière) ajoutés le 02/08.
`subjects.mjs` (carte des sujets) + `score_video.py` + `pose_at.py` + **`pick.mjs`** (sélection
pondérée, prouvée ≠ « le plus long ») + **`joins.mjs`** (forme) + **`coherence.mjs`** (sens) +
**`distill.mjs`** (3) + **`baseline.mjs`** (anti-régression) faits ; nettoyages (1)(2) par `refine.mjs`.
À venir : atténuation des sauts de pose (regroupement par prise).

## Overlays visuels — carte/tracé, vignettes de chiffres (chantier ouvert le 25/07)

Étage **POST-CONCAT** : on habille le rendu final (`VLOG_*.mp4`), on ne touche PAS à `render.mjs`
(qui reste le moteur de la PAROLE). Raison mesurée : le burn d'un overlay sur un span = **6,5 s**
d'encodage, un `render.mjs` complet = ~8 min. Un changement de look ne doit jamais coûter un re-render.

### ⭐ LES PARTIS PRIS DE LÉO — arbitrés, à APPLIQUER sans re-poser la question
À lire avant toute proposition d'habillage. Chaque ligne a été tranchée par le monteur à l'usage,
souvent après avoir vu le contraire à l'image. Les redemander à chaque vlog, c'est lui
refaire payer une décision déjà prise. Le « pourquoi » est là pour qu'un cas non prévu
se rattrape tout seul : c'est l'intention qui commande, pas la lettre.

**Le fond — ce qu'on affiche**
1. **ZÉRO DOUBLON.** Un mot ou un chiffre qu'il PRONONCE ne se réaffiche jamais : les
   sous-titres le portent déjà. On affiche ce qu'il ne dit pas (chiffre national,
   comparaison, date, géographie). *Seule exception admise : un LOGO de marque — il
   identifie, il ne réécrit pas.*
2. **Un chiffre affiché est une affirmation** : sourcé, et validé par le monteur avant burn.
   Il ne vient JAMAIS d'une transcription.
3. **Fuir les superlatifs.** Sur v12, deux « 1er du monde » validés étaient FAUX
   (le métro de Shanghai, le rang d'investisseur). Un ordre de grandeur sans superlatif
   ne se fait jamais démentir. Un chiffre validé n'est pas un chiffre vérifié.
4. **Ne pas le contredire à l'image.** Ses approximations orales sont des façons de
   parler — « environ 2 h d'avion », lui : « c'est une expression, ça pose pas de souci ».
   Un schéma trop précis qui prend sa phrase au mot la démentit devant le spectateur.
5. **Pas de faux savoir.** Si la donnée n'existe pas hors ligne (un plan de rues) ou si
   la forme mentirait (un cercle isochrone quand la durée n'est pas proportionnelle à la
   distance), on ne fabrique pas : on change de forme ou on renonce.
6. **Périmètre : on s'arrête.** ~10 overlays sur 7:30 = un toutes les 45 s, c'est déjà
   dense. Le reste part en réserve pour un v13.

**La forme — comment on l'affiche**
7. **Un encadré à PHRASE COURTE plutôt que des chiffres nus.** Lui, 25/07 : « un seul
   encadré avec une simple phrase courte, procédé plus propre je trouve ». Gabarit qu'il
   a donné : *« La Chine a consommé (…) tandis que les USA ont (…) »*. Les chiffres
   ressortent en accent **dans** la phrase (`*…*` de `figure.mjs`), on ne les en sort pas.
8. **Aucune barre d'accent accent** sur les panneaux ni les vignettes — « c'est inutile ».
   Retirée des quatre moteurs. La valeur est déjà en accent, l'icône aussi.
   *le monteur n'avait visé que les petites vignettes ; généraliser aux grands panneaux était le
   bon réflexe, il l'a confirmé. Règle à reprendre : une consigne de STYLE porte sur
   l'ÉLÉMENT, pas sur l'instance montrée en exemple — le panneau resté jaune se lirait
   comme un oubli. On généralise, et on le dit.*
9. **Un logo se pose SANS encadré**, en version transparente, jamais sur un fond blanc.
   `panel: null`. Et on **remappe** ses couleurs pour la lisibilité au lieu de les
   écraser : l'anneau rouge d'Alstom reste rouge.
10. **Les cartes : petites, et jamais en ouverture.** Elle arrive juste avant la phrase
    qu'elle sert, pas sur les premières secondes — la vidéo n'ouvre pas sur un panneau.
    « Trop gros, ça prend trop de place » : dans le doute, réduire.
11. **Un contour accent dit « déjà fait », un aplat dit « le sujet ».** Deux registres
    distincts, jamais deux aplats. Et si les sous-titres portent déjà les noms, la carte
    est **muette** : aucun texte.
12. **UNE SEULE LIGNE de sous-titre à l'écran.** Jamais deux empilées. Si le texte ne
    tient pas, il passe dans un événement SUIVANT dans le temps, pas sur une 2e ligne.
    Convention figée par ailleurs : `Lato Black` 58 · couleur d'accent du profil · `MarginV 36`
    — ce sont les défauts du script, **ne pas re-proposer de typo**.

**La méthode — comment on travaille**
13. **Mesurer, jamais juger à l'œil** : `freespace.py` à **8 img/s**, et la géométrie
    sort de la mesure du span, pas de l'habitude.
14. **Juger l'overlay COMPOSITÉ sur la vraie image**, jamais le PNG à alpha seul.
15. **La preuve se prend sur le RENDU, au PIRE instant**, pas sur une frame choisie —
    et un outil de mesure doit être auto-validant (cf. `v12_verify.mjs` et sa zone témoin).
16. **Télécharger un asset manquant sans demander** (police, logo, GeoJSON, icône), le
    ranger dans le **repo**, et le dire après coup. Le réseau est périssable.
17. **On propose, on ne produit pas** — sauf ce qu'il a explicitement validé.

### Chaîne (7 outils, 100% offline)
```
freespace.py  → OÙ est le vide (mesure mediapipe : bandes gauche / droite / haut, pire cas)
  ⚠️ À LANCER AVEC `.venv-vision/bin/python`, PAS `python3` : cv2 et mediapipe ne sont
     PAS dans le python système (brew n'a que 3.14, sans roue mediapipe). « No module
     named cv2 » = mauvais interpréteur, pas une panne.
overlays/route.mjs  <spec>  → carte + tracé d'ITINÉRAIRE   (portrait : un trajet est vertical)
overlays/geomap.mjs <spec>  → pays en couleur · corridors qui se tracent · rayons depuis un point
overlays/figure.mjs <spec>  → barres datées · courbe · frise · schéma dessiné (non géographique)
overlays/chip.mjs   <spec>  → vignette de chiffre           (large : un chiffre est horizontal)
overlays/subs.mjs   <mp4> t0 t1  → sous-titres karaoké accent (ASS) + miroir des polices
overlays/generique.mjs <spec> → GÉNÉRIQUE plein cadre : fond noir, silhouette du pays qui
                                se dessine, itinéraire blanc progressif, signature, fondu.
                                ⚠️ ce n'est PAS un overlay : c'est un PLAN à part entière,
                                qu'on rend en mp4 puis qu'on greffe en fin de vlog.
overlays/capture.mjs <html> t0 t1 --dir F --clip x,y,w,h  → PNG à ALPHA (Chrome headless, CDP)
```
Les cinq moteurs de composition partagent le MÊME contrat : aucune animation CSS/rAF,
tout l'état visuel est fonction de `t` via `window.__seek(t)`. C'est ce qui rend la capture
image par image déterministe — et c'est la seule chose à respecter en écrivant un 6e moteur.

**Générique de fin (`generique.mjs`) — ce qui a été payé en le construisant**
- **Le pointillé SVG REDÉMARRE à chaque sous-chemin.** Dessiner une silhouette
  multi-anneaux d'un seul `path` + `pathLength=1` ne « dessine » rien : mesuré, les îlots
  apparaissent d'un coup et le continent se remplit en rafale (rien pendant 0,7 s, puis 90 %
  en 0,4 s). → on isole l'anneau de plus grand périmètre (le continent) dans son propre
  `path` — un seul sous-chemin, donc un trait continu — et les îlots arrivent en fondu.
- **Une étiquette ne doit jamais descendre dans la signature** : le plancher d'anti-collision
  est `titleY − titleClearance`, pas le bas du cadre (vécu : « Guangzhou » à cheval sur
  « LA SUITE BIENTÔT »).
- **La durée de tracé d'une étape se dose en racine de la distance**, pas au prorata :
  Shenzhen→Hong Kong (27 km) se dessinerait en 2 images et Chengdu→Pékin (1 524 km)
  mangerait la moitié du générique.
- Le mp4 sort avec une **piste audio muette** (`anullsrc` 48 kHz stéréo) : c'est ce qui rend
  le concat avec le vlog trivial, et ça laisse `musique.mjs` seul maître du son dessus.
- **Où il vit** : `Vidéos finies/Éléments/` (cf. `store.mjs`, `ELEMENTS`). Un générique est une
  **pièce réutilisable**, ni un test ni un épisode : `arbo.mjs --purge` ne le touche jamais.
- **La greffe se fait AVANT la passe musique**, sur l'assemblage NU : concat `-c copy` (les deux
  flux doivent partager codec/profil/fps/time_base — c'est le cas si le générique est encodé aux
  paramètres du film), puis `musique.mjs plan --structure … --outro <s>`. Sans `--outro`, le fondu
  remonte sur toute la bande paysage de clôture et la musique est déjà éteinte quand le carton
  arrive. Ajouter une pièce au plan (`vlog.plan.json`) : `kind:'L'`, `parle:false`, sa propre
  `band` — sinon elle n'existe pas pour la grille de niveaux.

### Le burn d'un vlog ENTIER : une seule passe, jamais N
Enchaîner un ré-encodage par overlay empilerait N générations de pertes h264. On déclare
les N séquences en entrée, chacune décalée à son timecode, et on encode UNE fois
(v12 : 9 overlays + 410 lignes d'ASS, 13 533 frames en **160 s**) :
```
ffmpeg -i <v11.mp4> \
  -itsoffset <t0> -framerate 30000/1001 -i frames/<ID>/%05d.png   (× N)
  -filter_complex "[0:v][1:v]overlay=X:Y:eof_action=pass:repeatlast=0:
                     enable='between(t,<t0>,<t1>)'[v0]; … ;[vov]ass=<x.ass>:fontsdir=<fonts>[vout]"
  -map "[vout]" -map 0:a -c:a copy -c:v libx264 -crf 18 -preset medium -pix_fmt yuv420p
```
- **`eof_action=pass:repeatlast=0` est obligatoire.** Sans lui, overlay répète la dernière
  frame de chaque séquence jusqu'à la fin de la vidéo : les 9 panneaux resteraient collés à
  l'écran. `enable='between()'` seul ne suffit pas à le garantir.
- **Valider le filtergraph sur `-t 12` avant les 7 minutes.** 5 s d'encodage contre 160,
  et ça teste le point risqué : les 8 séquences pas encore commencées ne doivent pas bloquer.
- **`clip` de capture = panneau ÉLARGI de 40 px.** Capturer au ras du panneau rogne le halo
  de `feDropShadow` et laisse un bord net à la place de l'ombre.
- **La preuve que l'audio est intact, c'est le md5 du flux**, pas une re-transcription :
  `ffmpeg -i v -map 0:a -c:a copy -f md5 -` doit rendre la même somme sur N et N-1
  (v11 = v12 = `5aaf49c4…`, −16,1 LUFS de part et d'autre). Bit à bit, c'est plus fort
  qu'un whisper qui redit la même chose.
- Contrôle AVANT de lancer : compter les PNG de chaque séquence et les comparer à
  `round((t1−t0)·fps)`. Un PNG manquant = un trou d'une frame, invisible dans le log.

### ⑦ Étape OBLIGATOIRE : proposer l'habillage — `overlays/suggest.mjs`
**Tout premier traitement d'un vlog facecam se termine par des PROPOSITIONS d'éléments visuels**, jamais
par une production. Exigence du monteur (25/07) : « le skill doit automatiquement réfléchir et faire des
propositions sur ce type d'éléments visuels après analyse du transcript ».
```
node facecam/overlays/suggest.mjs <rendu.mp4|script.json> [--top 40] [--json out.json]
```
Le script repère les **moments** et dit pourquoi, Claude rédige les propositions sourcées par-dessus.
Motifs pondérés, tirés de ce qui a marché : **DOUTE** (« je n'ai pas la date », « je crois » → il pose la
question à voix haute, l'overlay répond : c'est le meilleur emplacement, et sur v11 c'est bien le n°1 sorti
par l'outil, score 9) · **RESSENTI** (« on sent que » → une donnée sourcée transforme l'impression en fait)
· **ÉPOQUE** → timeline datée · **COMPARE** → barres comparées · **GÉO** → carte · **CHIFFRE** ⚠️ *déjà
prononcé donc déjà dans les sous-titres* · **SUPERLATIF** → ordre de grandeur.

Filtrer les moments sortis par l'outil avec les **partis pris 1 à 6** (§⭐ plus haut) — c'est là que se
joue la qualité d'une proposition. Les deux cas d'école qui les ont fondés :
- la 1re vignette « 99 % des voitures sont électriques » a été **jetée** : elle recopiait mot pour mot le
  sous-titre (parti pris 1) ;
- sur ce même « 99 % », `small` lisait 4,9 %/80 %, `large-v3` 99 %, et le brief disait 49 % → c'est le monteur qui
  tranche, jamais la transcription (parti pris 2). Sourcer **pendant qu'on a du réseau**.

### Le FORMAT suit le vide mesuré — pas l'habitude
Il y a **trois** emplacements, et `freespace.py` les chiffre tous (`bandes_px`) : colonne gauche,
colonne droite, **bandeau haut**. Le bon format dépend de la FORME de la donnée **et** de la bande
disponible sur CE span :
| donnée | forme naturelle | emplacement retenu |
|---|---|---|
| itinéraire (8 villes, nord↔sud) | **portrait** (le tracé est vertical) | colonne droite 440×824 |
| un chiffre + son libellé | **large** (icône · valeur · libellé) | carte 700×132 dans la bande la plus large |
Mesures v11 : **globalement** (226 frames sur 7:31) gauche 467 px · droite 552 px · **haut 254 px** —
un bandeau pleine largeur est donc jouable *en principe*. Mais **par span ça change du tout au tout** :
sur `voitures-electriques` le haut ne fait plus que **146 px** (il est assis plus haut) alors que la
droite en fait **780**. ⇒ mesurer le span, pas le vlog. `chip.mjs` **auto-ajuste** le libellé
(largeur estimée → 2 lignes, sinon réduction) : un `labelDx` à la main casse au chiffre suivant.

### ⚠️ Ne jamais brûler un chiffre que whisper ne confirme pas
Sur « 49 % des voitures sont électriques », les modèles lisent **4,9 % / 19 % / 80 % / 99 %** — jamais 49.
Un chiffre à l'image est une **affirmation** : il vient du brief du monteur (ou de sa confirmation), pas d'une
transcription, et on le signale dans le `_mesures` du spec. Corriger coûte un mot + 7 s de burn.
- `freespace.py` = **visage (face_landmarker) + corps (pose_landmarker_lite)**, points visibles et dans
  le cadre uniquement (mediapipe extrapole les jambes hors champ et fausserait la boîte). On retient le
  **PIRE CAS** de la fenêtre → l'overlay ne peut pas chevaucher le sujet et ne **flippe pas** de côté.
- **⚠️ Échantillonner à 8 img/s (`--n` ≈ 8 × durée), pas 1/s.** À 1/s le span itinéraire donnait « libre à
  gauche 626 px » ⇒ panneau à gauche ; à 8/s on voit le **coude partir à x=621 px (t=414,18)** et le buste
  descendre à **550 px (t=435,30)** : le panneau de gauche **était recouvert** sur la fin — le monteur l'a vu avant
  la mesure. Un geste rapide passe entre deux échantillons espacés d'une seconde. Coût : ~35 s pour 192 frames.
- **Écarter la frame de bord du span** : à `b` exact, mediapipe lit déjà le cadrage du span SUIVANT (mesure
  aberrante). Fenêtre de mesure = `[a+0,05 ; b−0,08]`.
- `route.mjs` / `generique.mjs` : rien n'est animé par CSS/rAF — **tout l'état visuel est fonction de `t`** (`window.__seek`).
  C'est ce qui rend la capture image par image rejouable (même principe que Remotion / HyperFrames).
- Assets **dans le repo** (`facecam/assets/`, 16 Mo, donc ils voyagent avec le moteur) : `geo/` GeoJSON
  Natural Earth 50m + 110m (domaine public) · `fonts/` 9 polices OFL · `icons/` 1998 SVG Lucide (MIT).
  **Rapatriés le 25/07 avant le départ en Chine** — le pipeline n'appelle plus le réseau.
  ⚠️ Piège payé : les icônes posées par `npm i --no-save` ont été **purgées** par un `npm i` suivant. Ce qui
  doit survivre au voyage vit dans le **repo**, pas dans un `node_modules`.
- `subs.mjs` recopie les polices dans un `fonts/` **sans espace** à côté de l'ASS et imprime la commande de
  burn prête à coller (`fontsdir` dans un filtergraph + « Application Support » = échappement infernal).

### Sous-titres karaoké accent — `overlays/subs.mjs`
**CONVENTION FIGÉE (choix du monteur, 25/07, sur planche comparative de 9 polices) : `Lato Black` 58 px,
couleur d'accent du profil, `MarginV 36`** (descendu en trois fois : 108 → 70 → 48 → **36**). Raison du choix de la
police : neutre chaude et discrète, elle ne concurrence pas le Montserrat ExtraBold des panneaux
(hiérarchie : le panneau titre, le sous-titre accompagne). Ces trois valeurs sont les **défauts de
`subs.mjs`** — c'est LUI qui fait foi (`FONT` / `SIZE` / `MARGV` en tête de fichier) : ce README a déjà
divergé une fois en annonçant 48 puis 70. En cas de doute, lire le script, pas ce paragraphe.

Même mécanique que `buildKaraokeASS()` de `monte.mjs` (≤5 mots, ≤3 s, `\kf` = gap + durée) avec 4 écarts :
**couleur d'accent du profil** (Primary) sur blanc voilé (Secondary), **`large-v3`** (on brûle du TEXTE : le phrasé et la
ponctuation comptent — au prix de mots parfois avalés, « je vais à Macao, je vais à Shenzhen » → « Macao,
Shenzhen »), **lexique de noms propres** (clés explicites + rattrapage **flou** Levenshtein ≥ 0,62 : whisper
produit « Chiamen », « Qihongqing », « Pétkin », et large-v3 entend **« Tianjin » pour Chongqing**), et
**atomes insécables** (`_atomes: [["Hong","Kong"]]`) pour ne pas couper un nom en fin de ligne.
Coupe sur **micro-pause 0,32 s** > compteur de mots (le compteur casse « une ville en / fait qui entre »).
Polices dans un chemin **sans espace** (`fontsdir` dans un filtergraph : « Application Support » = enfer
d'échappement) → `~/Movies/Montage/.coulisses/facecam/fonts/`, miroir posé par `subs.mjs` lui-même.

⛔ **`\kf`, JAMAIS `\k` — et aucun contrôle de synchro ne peut faire la différence** (01/09). Les deux
tags portent exactement les mêmes durées et les mêmes timecodes ; ils ne diffèrent que par la façon de les
CONSOMMER. `\k` bascule le mot en accent **d'un coup, au DÉBUT** de sa prononciation : à l'instant où la voix
attaque, le mot est déjà entièrement accent, donc lu comme **déjà dit**. `\kf` le remplit de gauche à droite
pendant qu'il est dit et n'est plein qu'à la fin du mot. Défaut trouvé par le monteur au visionnage du master 4K du
#02 (« à 0:10 le sous-titre est déjà là et consommé alors que j'ai pas commencé à parler ») alors que TOUS
les contrôles étaient verts : synchro son 0 ms sur 7 fenêtres, zéro débordement de bloc, zéro chevauchement,
et un allumage à **0,000 s** du début de chaque mot sur 1 094 mots appariés ASS ↔ transcription. Mesuré sur
le #02 : chaque mot restait accent pendant toute sa durée — médiane 0,19 s, p90 0,48 s, **max 1,08 s**.
Deux gardes posées le jour même : `subs-blocs.mjs` **refuse** un ASS de bloc en `\k`, et
`overlays/subs-gate.mjs` mesure le film **avant** de l'encoder — il rend l'ASS sur fond noir et compte la
part d'accent parmi les pixels de glyphe à la première et à la dernière image de chaque début de bloc
(attendu ≈ 0 % puis ≈ 95 %). Validé dans les deux sens : 4 échecs sur 6 avec l'ancien ASS, 0 sur 8 avec le
neuf, en ~3 s. *Un critère vert ne couvre que la dimension qu'il regarde : trois contrôles de TIMING ne
disent rien d'un contrôle de RENDU.*

⚠️ **ET LA SONDE ELLE-MÊME S'EST TROMPÉE — dans le sens de l'alerte** (01/09, dernière passe).
Le garde annonçait deux blocs en avance (F10 +0,40 s, F23 +1,14 s) qu'aucun donneur d'horloge ne
rattrapait. Remesuré **avec la grandeur de `vad.py` elle-même** (énergie en bande 300-3400 Hz, pas
un RMS large — l'ambiance de rue porte de l'énergie hors bande vocale et le RMS large ne tranche
rien) : la parole de F10 commence à **0,04 s** et celle de F23 à **0,28 s**. Les deux « défauts »
n'existaient pas.

Cause : la remontée de `iles()` s'arrêtait à la première fenêtre sous le seuil bas — or une
**plosive** dure 20 à 60 ms et plonge sous ce seuil. L'onset tombait donc après la première
consonne dure, soit 0,5 à 1,6 s trop tard. Le paramètre `colle` disait déjà l'intention (« sans
quoi chaque plosive coupe un mot en deux ») mais n'avait été porté qu'à la FUSION des îles.

Correction, et ce qu'elle a coûté d'essais :

| Version de la remontée | F01 (parole à 2,66 s) | F10 (à 0,04 s) | Verdict |
|---|---|---|---|
| continuité stricte au seuil bas | 2,64 ✅ | 0,50 ❌ | rate les attaques |
| trou toléré de longueur fixe | **1,64** ❌ | 0,04 ✅ | un claquement de rue passe |
| **densité 60 % sur 0,2 s** | 2,58 ✅ | 0,00 ✅ | retenu |

Ce qui SÉPARE la parole de l'ambiance n'est ni le niveau ni la continuité : c'est la **densité**.
La parole tient un régime dense de syllabes et de plosives alternées ; l'ambiance ne produit que des
pics isolés. Validé dans les trois sens — les deux cas ratés, le cas connu vrai (F01, où le monteur dit
lui-même qu'il ne parle pas à 0:10) et le test de décalage connu de 2,000 s.

**Ce que ce faux positif a coûté** : cinq blocs recalés pour rien, dont F03 mis à **0,92 s de
retard**. *Un instrument qui se trompe dans le sens de l'alerte ne fait pas rater un défaut — il
fait CORRIGER ce qui n'était pas cassé, et la correction, elle, est bien réelle.* Le seul moyen de
s'en apercevoir a été de remesurer avec la même grandeur, pas de relire le code.

🛡️ **CE QUI FAIT QUE ÇA NE PEUT PLUS ARRIVER — le garde vit dans `burn.mjs`, pas dans ce README.**
Le même défaut a été signalé DEUX fois. Entre les deux, la leçon était déjà écrite ici, dans `SKILL.md`,
dans `INDEX.md` et dans `RESTITUTIONS.md` — et elle est repassée quand même, parce qu'une doctrine ne
s'exécute pas. Depuis le 01/09, `burn.mjs` **appelle `overlays/subs-controle.mjs` et refuse de brûler**
dès qu'un plan porte des sous-titres. Le burn est le seul point par lequel un ASS devient un master
livrable : c'est là que le refus doit vivre, et pas dans `subs-blocs.mjs` (qu'on contourne en éditant
l'ASS à la main) ni dans ma mémoire.

| Dimension | Ce qu'elle mesure | Sur quoi |
|---|---|---|
| **TAG** | zéro `\k` — le mot ne bascule pas en accent au début de sa prononciation | le fichier |
| **PLANCHER** | 1er mot de ligne ≥ 0,10 s — sous 3 images, un `\kf` se lit comme un `\k` | le fichier |
| **VOIX** | le sous-titre ne part pas avant la parole — **le SILENCE AVÉRÉ de tête** (`vad.py --tete`), jamais un onset | les .wav de bloc |
| **RENDU** | part d'accent à la 1re image de chaque début de bloc | des **pixels** (`subs-gate --json`) |
| **TEXTE** | graphie fausse survivante · accord après un nombre | le **texte livré** × le lexique |

Trois détails font la différence entre un garde et un décor : ① il **bloque**, il n'avertit pas ;
② une dimension qu'il ne peut pas mesurer est annoncée **NON MESURÉE** et fait échouer — sinon on le
désarme par simple omission, et *un garde silencieux est indiscernable d'un garde débranché* ; ③ les
réserves connues se **déclarent et se chiffrent** dans le plan (`subs_controle.avance_toleree`,
`accent_tolere`), jamais en baissant le seuil : une réserve non listée bloque, une réserve listée qui
**empire** bloque aussi. Désarmement délibéré : `MONTAGE_NO_SUBS_GATE=1`.

Éprouvé sur ses cas connus FAUX **avant** de servir, comme tout instrument de cette chaîne : sur l'ASS
d'avant les correctifs les 4 dimensions sortent rouges et le burn est ANNULÉ ; sur l'ASS livré les 4
sortent vertes ; sur un plan sans `subs_controle` le burn refuse en donnant le bloc JSON à coller.

⭐⭐ **LA DIMENSION VOIX MESURAIT UN ONSET — l'instrument qui a jugé le master publié se trompait**
(20/09, dette 3). Elle appelait `vad.py` nu, c'est-à-dire `bornes()[0]` : le début de la 1re île, donc
un **onset** — calé sur un pic tenu, et daté avec des seuils relatifs au **p95 du fichier qu'on lui
donne**. Sur F08 de l'EP3 (bloc de 8,5 s dont la parole monte en volume) l'attaque douce passait sous
le seuil, l'onset tombait à 1,52 s, et le garde annonçait **+1,293 s d'avance** — alors que la tête du
bloc [0 → 1,60 s], transcrite seule, dit « C'est une ville qui est plus historique ». Une réserve
chiffrée a été posée dans les DEUX plans de burn pour un défaut qui n'existait pas.

C'est mot pour mot la leçon que `parole.mjs` §(d) avait déjà payée le 19/09 : *on ne demande pas « où
commence l'île » mais « combien de SILENCE AVÉRÉ y a-t-il devant la parole »*, et *un instrument qui se
trompe DANS LE SENS DE L'ALERTE fait corriger ce qui n'était pas cassé*. « Qui d'autre a la même
forme ? » avait ici une réponse, et c'était un outil du même dossier. La correction n'est donc pas un
réglage, c'est un changement de **grandeur** : `vad.py --tete`, champ `fin` — le dernier instant où
l'on est SÛR que rien n'a encore été dit. Par construction la sonde ne peut plus accuser sans avoir
mesuré du silence.

⚠️ **La « fenêtre ÉTROITE de tête » prescrite par la note de reprise a été ÉPROUVÉE puis écartée, et
c'est mesuré** : sur un bloc qui s'ouvre 3,6 s avant la parole, `vad.py` sur une fenêtre de 2,5 s rend
`debut: null` — une fenêtre fixe ne voit pas au-delà de son bord — et l'ancien code faisait alors
`continue`, donc un faux négatif SILENCIEUX. *Une note qui décrit un remède est une hypothèse comme
une autre.* Les trois `continue` (wav absent, aucun évènement, vad muet) sont d'ailleurs devenus des
blocs **NON MESURÉS** qui font échouer la dimension : elle affichait « N blocs mesurés » en ayant
sauté des blocs sans le dire.

⚠️ **Et le banc a trouvé un angle mort que personne ne cherchait** : la recherche du 1er sous-titre
partait de `t0`, donc un évènement posé AVANT le début de son bloc — l'avance maximale possible —
sortait de la fenêtre et le contrôle mesurait le sous-titre SUIVANT. Le garde sortait vert sur le plus
gros défaut qu'il puisse y avoir. La borne basse descend désormais à la fin du bloc F précédent.

**L'invariant, exhibé AVANT de toucher à la réserve** : sur l'ASS livré, 22/22 blocs mesurés, 0 bloc
qui mord, **aucune réserve**. F08 passe de +1,293 s à **+0,093 s** (seuil 0,15) ; les 21 autres blocs
gardent leur verdict et bougent d'au plus **une fenêtre de `vad.py` (0,02 s)**, sauf F09 qui s'éloigne
du seuil (−0,26 s). La pire marge restante est F19 à +0,013 s. L'élargissement de la borne basse ne
touche **aucune** des 22 mesures (aucun évènement de l'ASS livré ne tombe dans l'élargissement).
`avance_toleree` est donc **vidé** dans les deux plans de burn — *vider la liste des exceptions est le
seul moyen de savoir s'il en reste.*

Cas connus rejouables **dans les quatre sens** : `node facecam/overlays/subs-voix-cas.mjs`
① l'ASS livré (22 blocs) doit rester muet · ② un évènement avancé de 1,00 s doit faire crier ·
③ la fenêtre fixe de 2,5 s doit se déclarer aveugle là où `--tete` voit 3,52 s · ④ `--work` sur un
dossier vide doit sortir NON MESURÉ, jamais vert.

⭐⭐ **LA 5ᵉ DIMENSION — TEXTE — ou pourquoi quatre critères verts ont laissé passer deux fautes**
(20/09). Tag, plancher, horloge, rendu : **aucun ne relit ce qui est ÉCRIT.** Les quatre étaient
verts sur un ASS qui disait « des Ouzbékistan » et « la capitale Ouïghours » — deux fautes d'accord
fabriquées par le rattrapage flou du lexique, **brûlées dans le master**, et trouvées en relisant
les noms propres À LA MAIN. *Un critère vert ne couvre que la dimension qu'il regarde* : il en
manquait une, et c'était la seule que le monteur VOIT. Deux tests, tous deux dérivés des fautes payées :
① **graphie fausse survivante** — les clés du lexique SONT la liste des graphies que whisper produit
de travers ; si l'une survit dans le texte livré, le lexique n'a pas mordu (les `_fusions` sont
testées sur la PAIRE de jetons) ; ② **accord après un nombre** — « 25 an ».
Le lexique devient donc OBLIGATOIRE dans `subs_controle` (`"lexique": "…"`), au même titre que
`plan` et `work` : sans lui la dimension se déclare **NON MESURÉE** et le burn est annulé. Réserves :
`texte_tolere`, nommées et jamais un seuil baissé.
⚠️ **Deux pièges attrapés par le banc, pas par la relecture** — et ils valent au-delà de ce fichier.
① Une `_fusion` dont le REMPLACEMENT contient la paire qu'elle corrige (`['a','voulu']` →
« l'État a voulu ») criait sur le texte DÉJÀ RÉPARÉ : *un motif que la bonne réponse contient ne
peut pas signaler un défaut.* ② Ma première exemption écartait tout mot de ≤ 2 lettres « parce que
c'est une unité » — or « 25 **an** » fait deux lettres, c'est-à-dire que le test ne mordait pas sur
son cas d'école. *Une exemption se NOMME (liste explicite, relisable) ; une exemption déduite d'une
FORME attrape ce qu'elle n'a pas vu.* Éprouvé dans les trois sens : vert sur l'ASS livré (75 graphies
testées, 6 accords), rouge sur 4 défauts injectés (4/4 attrapés), NON MESURÉE sans `--lexique`.

⛔ **LE SOUS-TITRE NE DOIT JAMAIS ARRIVER AVANT LA VOIX — et whisper ne sait pas le garantir**
(01/09). Consigne du monteur, après deux signalements : « tu ne dois pas faire apparaître le sous-titre
avant que je commence de parler […] contrôle toujours ce parallélisme quand tu poses des sous-titres. »
La cause est établie par réfutation dans `overlays/vad.py` : **whisper ne DATE pas le premier mot, il le
COLLE au début du fichier** qu'on lui donne, puis étale le texte sur la durée disponible — le même bloc
précédé de 2,000 s de silence NUMÉRIQUE ressort « Alors » à 0,000 s, dans un silence qu'on venait
d'ajouter. Ses timecodes ne sont pas une mesure acoustique. Mesuré sur le #02 : **9 blocs sur 27** en
avance de plus de 0,15 s, jusqu'à **2,64 s sur F01** — exactement le 0:10 signalé par le monteur.

La seule référence de vérité pour « quand la voix commence » est le **SIGNAL** (`vad.py`, double seuil
calé sur le sommet et non sur le plancher, validé sur un décalage CONNU de 2,000 s). Deux corrections
ont été essayées et **réfutées par la mesure**, ce qui vaut d'être écrit pour ne pas les refaire :

| Piste | Ce qui a été mesuré | Verdict |
|---|---|---|
| Décaler / étirer l'ASS après coup | sur F01 les silences de whisper à 11,76 et 15,32 s tombent DÉJÀ pile sur les pauses réelles | ❌ l'erreur est locale à la TÊTE ; tout décalage global casse un milieu juste |
| Rogner le blanc de tête et re-transcrire | l'horloge devient juste, mais whisper RE-DÉCODE : 8 blocs sur 9 abîmés, 22 mots nets perdus | ❌ *un sous-titre à l'heure mais amputé est pire qu'un sous-titre en avance* |
| **Apparier les deux et transférer les TEMPS** (`subs-recale.mjs`) | texte identique mot à mot (1 097), 9 blocs recalés, F01 +2,64 s → **−0,01 s** | ✅ retenu |

🔁 **ET IL N'Y A PAS UN DONNEUR, IL Y EN A PLUSIEURS** (01/09, 3ᵉ passe). Chercher LA bonne valeur
d'air de rognage est une impasse : 27 blocs, 27 ambiances, et l'air qui ancre bien l'un ampute
l'autre. `subs-recale.mjs --recale a,b,c` prend une LISTE de donneurs (un dossier par air : 0,00 ·
0,15 · 0,40, plus un négatif qui mord dans la parole) et retient pour **chaque bloc** celui que la
mesure désigne. Ordre de préférence écrit en clair AVANT d'être codé, sinon on règle des poids à
l'aveugle : ① ne pas partir avant la voix ② le plus synchrone en valeur absolue ③ le mieux apparié.
Un donneur sous 70 % d'appariement est écarté d'office. Mesuré sur le #02 : **10 blocs en avance → 2**.

Deux mécaniques rendent ça possible, chacune trouvée par une mesure qui ne collait pas :
- **la tête non appariée se COMPRIME, elle ne s'extrapole pas.** Quand le donneur a perdu les premiers
  mots, reporter les écarts d'origine les repousse AVANT le début du bloc : l'ASS est clampé à la
  borne et le recalage ne sert à rien (F03 restait à +0,99 s malgré 100 % d'appariement). Les deux
  bouts sont pourtant connus — l'attaque de la voix et le premier mot apparié : ces mots ont été dits
  entre les deux, on les y répartit. *Une extrapolation qui sort du domaine mesuré est une invention.*
- **l'ancrage de secours se refuse lui-même.** Forcer le 1er mot sur la voix corrige l'avance… en
  tassant 9 mots dans 0,03 s (F23), c'est-à-dire en refabriquant le « déjà consommé » par une autre
  porte. Il ne s'applique que si chaque mot garde le plancher de remplissage, sinon il imprime son
  propre refus. *Un remède qu'on n'a pas borné fabrique le défaut symétrique.*

Le principe du troisième : les deux transcriptions disent presque la même chose, l'une a le **bon texte**
(celle passée au lexique), l'autre la **bonne horloge** (celle du fichier rogné, ancrée sur la voix). On
ne choisit pas — on APPARIE les suites de mots et on donne au texte livré les temps de son jumeau. Le
texte n'est jamais touché, et c'est la garde de sortie qui le prouve. Le donneur d'horloge se fabrique
avec `subs-blocs.mjs --rogner --air 0` : là, perdre un mot est sans conséquence puisque seuls les temps
sont repris — mais l'ASS produit ainsi n'est **jamais** livrable.

⚠️ **UN `\kf` JUSTE AVEC UNE DURÉE ABSURDE PRODUIT LE DÉFAUT DU `\k`.** Dernier étage du même sujet :
whisper donne 0,01 s à « En » et 0,04 s à « aujourd'hui, ». En dessous de ~3 images, un remplissage
progressif est indiscernable d'une bascule, donc le mot est lu comme DÉJÀ DIT à l'apparition. 52 lignes
sur 229 étaient dans ce cas. D'où le **plancher `KF_MIN_CS` = 10 cs sur le PREMIER mot** (le seul dont
l'état est lu à l'apparition), le temps étant repris sur les mots suivants de la même ligne : le total
est conservé au centième, donc ni la fin de la ligne, ni la suivante, ni aucune borne de bloc ne bougent.
Posé dans `subs.mjs` (à la source) **et** dans `subs-recale.mjs` (pour réparer un ASS déjà produit).

⚠️ **UNE GARDE SE POSE SUR L'ARTEFACT LIVRÉ, PAS SUR UN ÉTAT DE PASSAGE.** La garde « texte inchangé »
de `subs-recale.mjs` s'exécutait avant le plancher et le rabotage : elle a laissé passer une **virgule
mangée** (huit champs ASS comptés au lieu de neuf), et libass lisait alors le premier mot comme un
EFFET — le mot disparaissait du rendu, invisible dans un diff de texte. Compter les champs, et vérifier
le fichier qu'on écrit.

⚠️ **libass retombe SILENCIEUSEMENT sur Helvetica** quand le `Fontname` ne matche pas : aucune erreur, juste
la mauvaise police à l'image (on a cru pendant une heure que « ExtraBold » n'était pas pris). Le nom à
donner est le **nom de famille legacy (nameID 1) qui embarque la graisse** — `Montserrat ExtraBold`,
`Poppins ExtraBold` — ou **« famille + style »** quand nameID 1 est la famille nue : `Fira Sans Black`,
`Lato Black`, `Barlow Semi Condensed ExtraBold`. La famille typographique seule (`Montserrat`, `Fira Sans`)
**échoue**. Seules les graisses standard se demandent par famille + `Bold=-1` (`Oswald`). **Vérification =
regarder la bande rendue**, pas le log (le format de `fontselect` n'est pas fiable à grepper).
Candidats installés (OFL) : Montserrat XB · Poppins XB · Archivo Black · Fira Sans Black · Lato Black ·
Barlow SemiCondensed XB · Oswald Bold · Anton · Bebas Neue. Planche de comparaison : rendre 0,7 s de vidéo
par police, extraire la frame à 0,5 s, rogner la bande basse (`crop=1920:180:0:886`), empiler.

### Comment tenir « une seule ligne à l'écran » (parti pris n°12)
Des sous-titres qui apparaissent **sur deux lignes** ne viennent presque jamais d'un retour à
la ligne : ils viennent de **deux événements ASS simultanés**, que libass EMPILE. Sur v12 la
queue de `+0,18 s` sur la fin de chaque ligne faisait cohabiter **335 événements sur 410 (82 %)**
avec le suivant. Le correctif tient en une ligne : la fin est plafonnée au début du suivant
(`end = min(dernier_mot + 0,18 ; suivant.from − 0,02)`). 335 chevauchements → **0**, à nombre
d'événements et largeurs inchangés.

**Ne pas se tromper de cause.** Un facteur moyen de largeur (0,55 em) annonçait 2 lignes
« trop larges » (1 627 px pour 1 520 utiles) : c'était **une fausse alerte à +25 %**. Mesurée
dans Chrome sur la vraie police, la ligne la plus large du corpus fait **1 308 px**. D'où
`assets/fonts/widths-<Police>.json` : la table d'avances par caractère, calibrée une fois par
Chrome (`H<c>H` moins `HH`, pour neutraliser le kerning des bords), que `subs.mjs` utilise
comme garde de largeur avec +4 % de sécurité. La garde ne se déclenche jamais sur ce vlog —
c'est voulu : elle ne change pas le rythme validé, elle empêche une régression.

Effet de bord assumé : 3 lignes sur 410 tiennent désormais moins de 0,35 s (il enchaîne sans
respirer, la ligne n'a plus que sa propre durée de parole). Le karaoké les rend naturelles.

**`--cache <f.json>` sur `subs.mjs`** : la transcription BRUTE est mise en cache, le lexique et
le découpage s'appliquant après. Itérer sur la mise en lignes ne coûte donc plus les ~4 min de
large-v3 — c'est ce qui rend une correction de sous-titres aussi rapide qu'un re-burn (2 min).

**⭐ OÙ VIVENT LES LEXIQUES ET LES `.ass` LIVRÉS : dans le REPO** (01/09). Un lexique est bâti à la
main sur les graphies **réellement produites** par whisper — c'est du travail non reproductible, et
la doctrine dit que ce qui doit survivre au voyage vit dans le dépôt, jamais dans le store ni dans
`node_modules`. Chemins canoniques :

    facecam/assets/lexiques/lexique_chine_01.json   · facecam/assets/lexiques/lexique_chine_02.json
    facecam/assets/sous-titres/VLOG_Chine_02.ass    · les 229 évènements brûlés dans le master 4K

Le reste de `.coulisses/facecam/` (cartes, `freespace`, `scored`…) est **dérivé** et se refabrique :
il reste dans le store. Une note l'y rappelle (`OU-SONT-LES-LEXIQUES.txt`).

⚠️ **`fontsdir` est le territoire de libass : on n'y range que ce qu'il sait lire** (01/09). La
table d'avances de `subs.mjs` (`widths-<Police>.json`) y dormait, et libass, qui **énumère** ce
dossier, tentait de l'ouvrir comme une police : `Error opening memory font` à chaque burn. Sans
effet sur l'image, mais un bruit permanent finit par masquer un vrai message. Elle vit désormais
dans `facecam/assets/metrics/`, et `subs.mjs` **dit** si elle est chargée — sinon « table absente »
et « table chargée » rendent le même silence, et la garde de largeur retomberait au facteur moyen
sans que personne ne le sache.

⚠️ Déplacer un `.ass` casse silencieusement un `burn-plan.json` qui le référence : **`ass=` sur un
fichier absent ne fait pas échouer ffmpeg**, il rend le film ENTIER sans sous-titres, et ça ne se
voit qu'au visionnage. Même chose pour un `fontsdir` vide — libass retombe sur une police système et
le film sort avec la mauvaise typo. `burn.mjs` contrôle donc les trois entrées (`video_in`, `subs`,
`fontsdir`) avant d'encoder quoi que ce soit.

### Comment poser un LOGO (parti pris n°9 — bloc `logos` de figure.mjs)
- **`panel: null`** → les blocs passent en coordonnées ABSOLUES dans le 1920×1080. En
  échange le logo a besoin d'une **double ombre portée** (serrée + large) : sans la carte,
  c'est elle qui donne le contraste sur un décor bruité.
- **`colorMap` remappe, il n'écrase pas.** Le remap s'applique aux `fill=`, aux `fill:`
  de style ET aux `stop-color` des dégradés — sinon un cadre en dégradé reste noir sur
  noir. Sans `colorMap`, repli monochrome blanc.
- **⚠️ Ne JAMAIS supprimer une forme parce qu'elle « ressemble à une scorie ».** J'ai
  supprimé les deux chemins en dégradé du SVG JCDecaux en les prenant pour un artefact :
  c'était **le cadre en angle de son logo**. Le réflexe correct est de regarder le logo
  officiel avant de décider ce qui est décoratif — pas d'inférer depuis le code.
- **`fill="none"` est à préserver** : sur Alstom c'est un rect de cadrage transparent,
  le rendre opaque produit un **bloc blanc** qui masque tout le mot.
- **`pad` par logo, jamais global** : les viewBox n'ont pas la même marge interne. À pad
  égal, JCDecaux rendait deux fois plus petit qu'ALSTOM.
- **Le `clip` de capture suit la boîte du logo**, pas l'ancienne : en passant de la carte
  au logo nu, le logo a bougé de 1474 à 1400 et l'ancien clip lui coupait 34 px.

### Obstacles → solutions ① le BURN d un vlog entier (payés sur v12)
- **Une estimation de largeur MOYENNE par caractère ne tient pas** pour la valeur d'une
  vignette : « 906 km » a mordu son libellé parce que 0,60 em était appliqué à tout, alors
  que le `m` de Montserrat ExtraBold vaut ~1 em et l'espace 0,28. `chip.mjs` a désormais une
  table par caractère — **et surtout le libellé est ANCRÉ AU BORD DROIT** de la carte
  (`text-anchor="end"`). Ainsi une sous-estimation rétrécit la place calculée pour le libellé
  au lieu de le pousser SUR la valeur. Le bon réflexe : rendre l'anti-collision structurelle,
  pas plus précise.
- **Formater les nombres en français dans le moteur, pas dans le spec.** Le compteur animé
  écrivait « 307000 » et « 6.6 » : deux fautes brûlées. `fmtNum` (virgule décimale + espace
  fine insécable U+202F) est **sérialisée dans la page** via `toString()`, donc l'animation
  et le calcul de mise en page partagent le même code — deux implémentations jumelles
  divergent toujours.
- **Une clé de lexique doit porter l'apostrophe** : whisper émet « d'exploitriers » d'un seul
  bloc, donc `"exploitriers"` ne matche jamais (la regex est testée sur le token entier).
- **Whisper coupe parfois un nom en DEUX tokens** (« JCD | Go » pour JCDecaux) et le lexique
  agit mot par mot : structurellement incapable de réparer ça. D'où `_fusions:
  [["JCD","Go","JCDecaux"]]` dans le lexique, qui fusionne la paire avant le découpage en lignes.
- **Un aplat de pays à .30 avale la carte.** Sur `geomap.mjs`, la Chine devenait un bloc
  moutarde et ses voisins disparaissaient : c'est le CONTOUR qui désigne, l'aplat reste sourd
  (.13). Corollaire du « juger composité » : un réglage validé sur une carte nue ne survit pas
  à une carte peuplée.
- **Les étiquettes sont clippées par la zone carte** : « Hong Kong », posé vers l'extérieur au
  sud-ouest, s'affichait « ng Kong ». On essaie le côté naturel, on **bascule** s'il déborde,
  on rabat en dernier recours — jamais un `dx` à la main.
- **Ne pas fabriquer un plan de ville : les assets s'arrêtent aux frontières.** Natural Earth
  n'a aucune rue. Le « tracé de la concession sur un plan de Shanghai » a été dessiné à la
  main puis **jeté au contrôle à l'image** : une pile de boîtes étiquetées et un Huangpu qui
  lisait comme une dalle grise en travers. La frise datée seule dit la même chose, mieux.
  Un schéma qui se fait passer pour une carte est pire qu'un schéma assumé.
- **Un cercle isochrone MENT quand la durée n'est pas proportionnelle à la distance.** Tokyo
  est à 1 760 km en 2 h 50, Hong Kong à 1 230 km en 2 h 51 : un anneau « 3 h » mettrait Hong
  Kong dedans et Tokyo dehors. Des rayons étiquetés disent la même chose sans faux savoir.
- **Une échelle commune est le propos, pas un détail.** Sur « deux rives, deux époques »,
  `vmax` est forcé à 632 sur les DEUX groupes : en auto-échelle par groupe, le Park Hotel
  (84 m) paraîtrait aussi haut que Shanghai Tower (632 m) et le schéma dirait l'inverse de
  ce qu'il démontre.
- **Ne pas inventer les points intermédiaires d'une courbe.** Faute de série annuelle fiable,
  la courbe PM2.5 ne passe que par des points recoupés deux fois (les % de baisse officiels
  redonnent les valeurs absolues), **seules les deux bornes sont étiquetées**, et le rebond
  réel de 2023 est conservé : une courbe lisse est une courbe de communication.
- **Sourcer, c'est aussi désarmer le brief.** Trois « faits » validés étaient faux et n'ont
  été rattrapés que par le sourcing : « 1er réseau de métro du monde » (Pékin 909 km >
  Shanghai 890), « 12,8 M voyageurs/jour » (10,3 M en moyenne 2024), et « 1er investisseur
  européen » (vrai en nombre d'entreprises, FAUX en valeur — l'ambassade dit 3e). Un chiffre
  validé n'est pas un chiffre vérifié : **le vérifier reste le travail**, et ça se fait tant
  qu'il y a du réseau.

### Obstacles → solutions ② GÉOMÉTRIE et LISIBILITÉ d un overlay
- **Mercator : les deux axes en RADIANS.** Mélanger degrés (x) et radians (y) écrase la carte à plat
  (vécu : les 8 villes alignées sur une seule ligne, `s = min(17,8 ; 1049)` = 17,8).
- **Un panneau à 62% d'opacité DISPARAÎT sur un décor sombre** (bambous de nuit). Mesuré à l'œil sur
  planche-contact : il faut ~0,82 d'opacité + bordure `rgba(255,255,255,.17)` + carte à `.46` de stroke.
  Corollaire : **juger l'overlay composité sur la vraie image**, jamais sur le PNG à alpha seul.
- **Anti-collision des étiquettes = globale, pas par côté.** Deux libellés ancrés de part et d'autre
  peuvent se marcher dessus : on n'écarte (`labelSpacing`) que si les **intervalles x se recouvrent**
  vraiment. Placement **vers l'intérieur** de la carte : un panneau étroit ferait déborder les noms longs.
- **Cluster serré (Hong Kong / Macao / Shenzhen à 11 px)** : écartement vertical + **ligne de rappel**
  vers le point. C'est le motif à reprendre pour toute grappe de points.
- **⚠️ whisper : une fenêtre isolée peut PERDRE son début.** `[413,9 +2,0]` a rendu « je pense que les
  gens » en **omettant « à Chiamen. Chiamen, »** pourtant présent (idem « Ensuite je remonte à Pékin »
  sur `[428,1 +1,8]`). Ce n'est pas un décalage de timestamps : c'est du contenu **avalé**. → pour valider
  un timecode de mot, **BALAYER plusieurs bornes** et confirmer par **2 modèles** ; `[414,2 +2,4]` commence
  bien par « Chiamen » (small) / « Shemen » (large-v3) ⇒ Xiamen ≈ 414,5 confirmé.
- **Timecodes du rendu ≠ somme des spans de l'EDL** : v11 = 451,831 s alors que la concat des segs de
  `.facecam_work/segs/` fait 459,88 s → **un span avait été raccourci après coup** (l'itinéraire, −8,05 s).
  → localiser un span dans le rendu final = **re-transcrire le rendu**, jamais additionner l'EDL.

### Maquette validée (25/07) — `MAQUETTE_itineraire_v11.mp4`
Span `programme-itineraire` de v11 = **411,398 → 435,381** (23,98 s). Panneau 524×824 à `x=44,y=88`
(dégagement mesuré **63 px** au sujet, sur le rendu). Villes révélées aux timecodes **mesurés** :
Shanghai 413,24 · Xiamen 414,52 · Hong Kong 420,89 · Macao 422,03 · Shenzhen 422,70 · Chongqing 424,55 ·
Pékin 428,69 · Mongolie 431,95 · badge « ≈ 1 mois » 433,98. Coût : capture 719 frames = 48 s, burn = 6,5 s.
Audio **inchangé** (−17,2 LUFS avant/après, aucun re-loudnorm).

### HyperFrames (heygen, Apache-2.0) — installé, à évaluer
`hf-overlays/node_modules/hyperframes` (v0.7.71). « Video as code » : compositions **HTML/CSS/JS**
rendues en MP4/WebM par **Chrome headless + ffmpeg**, donc **local et offline** (son `doctor` détecte
notre ffmpeg 8.1.2, Chrome système et même `whisper-cli`). Sous-commandes utiles : `render`, `snapshot`,
`inspect`, `keyframes`, `check`, `compare`, `benchmark`. Le **catalogue est un registre réseau**
(`catalog list` / `add <bloc>`) : blocs `caption-*` (karaoké pill, editorial-emphasis…), `world-map`,
`data-chart`, overlays de grain/flash → **à rapatrier tant qu'on a le réseau**. Piège d'install : `sharp`
casse en dépendance transitive (`npm i sharp @img/sharp-darwin-arm64` d'abord, puis
`npm i hyperframes --ignore-scripts`). Le **MCP** hyperframes est hébergé côté HeyGen ⇒ inutilisable en Chine.

Genèse détaillée + doctrine : mémoire `project-facecam-derushage`.

**Rattachement par ÉPISODE (31/08)** — champ `ep` par ville + bloc `episodes` dans le spec
(`stroke`, `width`, `opacity`, `dash`) et `groupGap` (respiration au changement d'épisode).
⚠️ Un **leg appartient à l'épisode de la ville où il ARRIVE** : Shanghai→Xiamen est le premier
trait de l'épisode 2, pas le dernier du 1. Sans `ep` ni `episodes` le rendu est celui d'avant
(prouvé : 3 frames du générique #01 au même md5 avant/après). Le CSS `.lab` ne force plus
`fill:#fff`, sinon une étiquette colorée serait sortie blanche.
Bloc `legend` (position, pas, taille, entrées) : chaque entrée s'allume au départ du **premier leg**
de son épisode, ou à défaut au pop de sa 1re ville — sans ce repli l'entrée d'un épisode SANS leg
(le 1er) ne serait jamais apparue.
Deux leçons d'usage, toutes deux payées sur des planches compositées :
- **Atténuer un groupe qui ne contient qu'UN point ne code rien** — ça n'efface que ce point.
- **Une couleur de faible chroma n'est pas une couleur, c'est un blanc éteint.** Un gris bleuté
  (`#8C9BA8`, C*=8,9) a été écarté au profit d'un bleu (`#7FB2D9`, C*=25,9). ⚠️ Le ΔE76 ne
  départageait PAS les deux (39,3 contre 37,9) : il pèse surtout la CLARTÉ. La grandeur qui répond
  à « couleur ou blanc éteint ? » est la **chroma**. Et le bleu retenu partage la clarté de l'accent
  (L* 70,4 vs 70,8), donc le tracé se lit comme UNE ligne — ce que « un seul tracé » demandait.

**`figure.mjs` — `showVal:false`, `unit`, `valText` (31/08)**
`barVal` écrivait `${it.v} m` **en dur** : un suffixe « mètres » hérité du premier usage (les
tours de Shanghai). Trois champs corrigent ça — `unit` par groupe, `valText` par item, et surtout
**`showVal:false`**, qui trace une barre **sans son chiffre**. C'est ce qui permet une comparaison
quand l'une des deux valeurs est **PRONONCÉE dans le film** : sur le #02, la barre de Hong Kong
donne l'échelle et seule Paris est chiffrée. Le défaut de `unit` reste `' m'` — le changer aurait
changé le sens d'un spec v12 **déjà livré** ; tout nouveau spec pose son `unit`.
Rétro-compat prouvée : `v12_S1_rives` rend un HTML identique bit à bit.

**Ce que seul le COMPOSITE révèle (31/08, 6 défauts d'un coup)**
- Le panneau réserve son haut au titre : kicker y=62, sous-titre y=94, filet y=118. **Tout contenu
  commence sous y=140** — deux specs écrivaient leur phrase par-dessus le sous-titre.
- **Une `note` est UN SEUL `<text>`** : le `\n` n'y coupe rien, il faut une note par ligne. Sans
  ça la phrase part en une ligne unique et sort du panneau (« de tout ce que la Chin »).
- Un libellé de jalon **centré** sur un jalon collé au bord est coupé : élargir la plage d'années
  pour rentrer les jalons, et poser `anchor` `start`/`end` aux extrémités.
- Aucun de ces six défauts n'était visible sur le PNG à alpha, ni lisible dans le spec.

**Une carte a une ÉCHELLE MINIMALE, et c'est une contrainte de forme (31/08)**
Une carte muette « Yangshuo à côté de Guilin » a été abandonnée : 55 km entre les deux, et le seul
fond du repo est `admin_0` (frontières de PAYS). À l'échelle où les deux points se séparent, le
cadre est **vide** ; à l'échelle où le fond dit quelque chose, les deux points se **confondent**.
Un `admin_1` n'y change rien — à 55 km l'intérieur d'une province est une surface nue.
Réflexe : avant de promettre une carte, vérifier que la DISTANCE à montrer et le FOND disponible
tiennent dans le même cadre. Sinon, parti pris n°5 : on change de forme.

**`geomap.mjs` — des POINTS NOMMÉS (31/08)**
Sans `origin`, `spokes` traçait un rayon depuis (0,0). Corrigé : **pas d'`origin` → pas de rayon**,
les spokes deviennent de simples points nommés. C'est le 4ᵉ usage du moteur, né des quatre
premières ZES — quatre villes qui n'ont ni ordre ni trajet entre elles, donc ni `route.mjs` (qui
relie) ni rayon (qui part d'un centre). Rétro-compat prouvée sur `V2_asie`, `S3_lgv`, `S4_vols`.

**La règle de l'échelle minimale coupe DANS LES DEUX SENS (31/08)**
La même mesure a tué une carte et en a autorisé une autre. Yangshuo–Guilin : 55 km, fond
`admin_0` → cadre vide. Les quatre ZES : **470 km**, et le même fond donne toute la côte plus
Taïwan → carte de 780×520 px. *Une carte n'est jamais une bonne ou une mauvaise idée en soi : elle
l'est à une DISTANCE donnée, avec un FOND donné.*

**Les positions du renderer sont des constantes, pas des estimations (31/08)**
Un libellé de frise est à `T.y ± 76`, un libellé de barre à `box.y + box.h + 30`, le filet du
titre à y=118. Deux collisions de plus ont été trouvées au composite en posant des notes « à peu
près en dessous ». Ces trois valeurs se lisent dans `figure.mjs` : on les calcule.

**`facecam/overlays/burn.mjs` — la passe unique, rejouable (31/08)**
`.coulisses/facecam/v12_burn.mjs` ne savait faire que le v12 : chemins, cadence et sous-titres
en dur. `burn.mjs` prend un **plan** (`{video_in, video_out, fps, subs?, frames, overlays}`) et
fait les deux gestes : `--capture` génère les séquences PNG, puis **une seule passe ffmpeg**
compose les N overlays et encode une fois — enchaîner un ré-encodage par overlay empilerait N
générations de pertes h264. L'audio est copié (`-c:a copy`), le loudness du master n'est pas
retouché d'un dB.
- Le **contrôle de complétude** tourne AVANT l'encodage : un PNG manquant = un trou d'une image
  dans l'animation, invisible au visionnage et coûteux à retrouver. Compte attendu = `(t1−t0)×fps`.
- **`fps` vient du plan, jamais d'une habitude** : 30/1 pour le VLOG #02, 30000/1001 pour le v12.
  *Une cadence supposée fabrique une dérive cumulative parfaitement crédible et fausse.*
- `subs` est facultatif : sans la clé, aucun filtre `ass`.
- ⚠️ `fileURLToPath(import.meta.url)`, **jamais** `new URL(...).pathname` : le repo vit dans
  « Application Support » et l'espace ressort en `%20` → `MODULE_NOT_FOUND` sur `capture.mjs`.

## ⛔ Le garde de la parole — ce qu'il refuse depuis le 18/09

`facecam/parole.mjs` est le **goulot** : `render.mjs` l'appelle et refuse de livrer s'il mord.
Il contrôlait trois défauts ; il en contrôle **cinq**, et deux de ses mesures ont changé d'objet.

| dimension | ce qu'elle refuse | où elle mesure |
|---|---|---|
| relance | une prise avortée redite juste après | **la SOURCE**, bursts découpés en **bande vocale** |
| euh | une voyelle tenue ≥ 0,30 s | le rendu (spectre stable + transcription seule) |
| queue | un mot perdu après la borne `b` | le rendu vs l'îlot source |
| borne | `b` posée dans un mot, `a` qui tronque le 1ᵉʳ mot | la source (lib.mjs, en un exemplaire) |
| **air** *(neuf)* | **un blanc > 0,30 s avant l'attaque de voix** | le rendu, `vad.py --tete` |

**Pourquoi ces deux changements, et pas un paragraphe de plus.** Sur le master du 17/09 le garde
est sorti **VERT sur les quatre spans que le monteur a signalés à la main**. Deux causes, mesurées :

1. **Il n'y avait aucun test pour « borne `a` posée trop TÔT ».** `teteTronquee` dit qu'elle est
   trop tard ; personne ne disait qu'elle est trop tôt. Les deux défauts sont **opposés**.
   Seuil livré : **0,30 s**, dérivé des verdicts du monteur (signalés : 0,92 · 1,18 · 1,84 s ;
   laissés passer : 0,00 · 0,18 s). Un seuil qui ne vient pas d'une mesure se rebaisse au
   premier cas gênant.
2. **La relance était invisible dans l'objet qu'on inspectait.** `render.mjs` comprime les
   silences, donc la pause de 0,36 s entre la fausse prise et la reprise passe sous le seuil de
   découpe : les deux prises forment UN burst, et whisper **déduplique**. Et même sur la source,
   `silencedetect` (énergie LARGE) ne voyait pas cette pause — le fond de rue ne descend jamais
   sous −26 dB. La découpe passe donc par `vad.py` (300-3400 Hz, régime dense), qui la trouve.

**Éprouvé dans les deux sens avant de servir** — cas connus FAUX : `deux-locales-25-ans` (air
0,92 s), `datong-capitale-charbon` (air 1,84 s), `disneylandisation-patrimoine` (air 1,18 s **+
relance**) ⛔. Cas connus VRAIS : `chongqing-ville-tiktok`, `moderne-et-historique`,
`tradition-et-modernite`, `mosquees-en-temples` ✓, aucun faux positif.

⚠ **Ce que le garde ne voit toujours PAS**, et qui est une dette ouverte : le défaut signalé par
Le monteur sur le **badge F09** (`architecture-sino-musulmane` + `mosquees-en-temples`). Mesuré :
0,14 s d'air (fenêtre du span) ou 0,38 s (fenêtre du bloc), un « euh » de 0,68 s présent dans la
**source** mais absent du rendu, aucune queue tronquée, aucune relance. Je n'ai pas isolé de
grandeur qui corresponde à ce qu'il décrit. **C'est écrit ici plutôt que classé faux positif :
quand le monteur re-signale ce que j'ai classé faux positif, le signalement gagne d'office.**

⚠ **Et la fenêtre fait partie de la mesure.** Les seuils de `vad.py` sont relatifs au p95 du
fichier qu'on lui donne : la même tête rend 0,14 s sur le span et 0,38 s sur 8 s. La convention
déclarée est **le wav du span** — le seuil de 0,30 s n'a de sens qu'avec elle.

### Le quitus — pourquoi le garde ne suffisait pas

`render.mjs` appelle `parole.mjs` et sortait en **code 1** quand il mordait. Mais le master
restait sur le disque, et `vlog.mjs` — l'étage qui fabrique l'épisode que le monteur REGARDE — ne lui
demandait rien. Un master recalé pouvait donc devenir l'épisode livré.

Depuis le 18/09, un contrôle réussi pose `<master>.parole.json` :

```json
{ "master": "VLOG_Chine03_facecam_v1.mp4", "empreinte": "vggw56", "etat": "OK", "detail": "…" }
```

- L'**empreinte** (taille ^ mtime, la ruse de la clé de cache de `vlog.mjs`) fait qu'un master
  re-rendu périme son quitus **tout seul** — on ne peut pas faire passer un vieux oui pour un neuf.
- Le quitus est **effacé AVANT** le contrôle : un plantage en cours de route ne doit pas laisser
  derrière lui un état qui veut dire oui par défaut.
- `MONTAGE_NO_PAROLE=1` pose un quitus `DESARME`, que `vlog.mjs` refuse aussi — désarmer le garde
  ne doit pas ressembler à l'avoir passé.
- `vlog.mjs` refuse : quitus **absent**, **périmé**, ou en état ≠ `OK`. Réserve assumée par écrit :
  `MONTAGE_QUITUS_RESERVE="<pourquoi>"`, imprimée dans la sortie.

Éprouvé sur les 4 états (absent · empreinte fausse · état ECHEC · réserve), chacun vérifié **par
son MESSAGE** et pas seulement par le code retour — un `exit 1` ne dit pas quel garde a mordu.

