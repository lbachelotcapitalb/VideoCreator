# VLOG — monter une vidéo finale **landscape × facecam** (à ouvrir SEULEMENT pour cette tâche)

## Sommaire

- 0. LA TRAME — le gabarit d'un épisode (mesuré sur #01, à viser, pas à copier)
- 1. La doctrine d'entrelacement (consignes du monteur, 29/07 — révisée le 30/07)
- 2. Contrainte dure : les overlays déjà brûlés
- 3. Les frontières de sujets facecam — comment les OBTENIR (et pas les deviner)
- 4. La chronologie complète — 7 phases, dans cet ordre
- 5. Clôture
- 6-bis. ⭐ Deux horloges sur le master facecam (31/08)
- 6. Pièges rencontrés (VLOG #01)

Troisième opération de la stack, à côté de `monte.mjs` (UNE journée de B-roll) et
`facecam/render.mjs` (UNE prise parlée) : **le mariage des deux sur une seule timeline**.
Elle ne re-monte rien — elle ORDONNE des morceaux déjà validés, puis regrave les repères et
pose la musique. Outil : **`vlog.mjs`** + **`musique.mjs plan --structure`**.

> Premier passage : VLOG Chine #01 (jours 15→20 × facecam v12), 29/07/2026.
> Le plan détaillé de cette vidéo-là (contenu de chaque rush, texte de chaque sujet, raison de
> chaque adjacence) vit dans **`PLAN-VLOG-01.md`** — ce fichier-ci est la MÉTHODE, réutilisable.
>
> **le monteur, 29/07 : « c'est la trame que je souhaite pour réaliser les prochains VLOG ».**
> La forme de #01 n'est donc plus un essai, c'est le **gabarit**. §0 = la trame (ce que la vidéo
> doit être), §1 = les règles qui la fondent, §4 = la chronologie des opérations (dans l'ordre).

---

## 0. LA TRAME — le gabarit d'un épisode (mesuré sur #01, à viser, pas à copier)

```
L ─ F ─ L ─ F ─ L ─ F ─ … ─ F ─ L        ouvre sur l'image ET ferme sur l'image
│                                        alternance STRICTE, jamais L L ni F F
└─ jour 1 ─┴─ jour 2 ─┴ … chronologie paysage jour par jour, jamais mélangée
```

Deux jeux de chiffres : la version rendue le 29/07, et la **révision du 30/07** après les
retours du monteur (recollage des sujets, clôture sur l'image). C'est la colonne **rév. 30/07**
qui fait foi — la première est gardée pour montrer ce que les retours ont déplacé.

| repère | #01 (29/07) | #01 rév. 30/07 | la règle qu'on en tire |
|---|---|---|---|
| durée | 12:53,6 | **12:49,8** | 10–15 min : au-delà, la matière paysage d'un jour se répète |
| blocs | 38 = 19 `L` + 19 `F` | **31** = 16 `L` + 15 `F` | autant de bandes que de blocs, **±1 selon le bout par lequel on ouvre et on ferme** |
| cadence | 20,4 s | **24,8 s** | le « dynamisme » n'est pas une cadence à tenir : 4 s de plus par registre, et le sujet respire |
| part paysage | 5:21,3 (41,5 %) | **5:24,0 (42,1 %)** | le facecam pèse plus lourd, mais l'image ouvre, ferme et rythme |
| part facecam | 7:32,4 (58,5 %) | **7:25,8 (57,9 %)** | tout le facecam validé passe : on ne jette pas un sujet, on le place |
| bande `L` | méd. 14,8 s | méd. **19,4 s** · max 44,9 | < 6 s on n'a pas le temps de voir ; une bande longue porte **deux tendances sonores** (muet → sonore) |
| bloc `F` | méd. 20,1 s · max 54,7 | méd. **24,0 s** · max **60,2** | un bloc long n'est plus une alerte s'il est **UN sujet** ; il l'est s'il en soude deux qui n'ont rien à voir |
| sujets/bloc | 11×1 · 7×2 · 1×3 | **7×1 · 5×2 · 1×3 · 1×5** | ce n'est PAS un quota : on groupe par **unité de sujet** (cf. §1 règle 3) |
| par jour | 3 · 4 · 2 · 2 · 4 · 4 bandes | **3 · 4 · 2 · 1 · 3 · 4** | au prorata de la matière retenue du jour |

**Les 4 points fixes d'un épisode** (dans cet ordre, ils ne se négocient pas) :
1. **Cold open paysage** — 2-3 plans du premier jour, avant qu'on entende une voix.
2. **Les ancres, et leur SENS** — l'endroit où l'image et la phrase se répondent. Deux sens
   possibles, à ne pas mélanger sans le dire :
   - `←` **image puis commentaire** (convention de #01, 9 cas) : la carte du resto, PUIS
     « pourquoi les restos ne sont pas chers » ;
   - `→` **annonce puis payoff** (4 cas) : « le métro, 50 centimes », PUIS le métro. Plus fort,
     mais réservé aux images immédiatement identifiables (métro, marché, train).
   **Une ancre par jour au minimum.** Les blocs sans lien (6 sur 19 en #01) sont le prix de la
   fusion monotone — les réduire se joue en **phase Ⓑ** (garder un plan exprès pour un sujet),
   pas au merge. Audit complet des 19 raccords : `PLAN-VLOG-01.md` §4 bis.
3. **La plus longue bande paysage juste avant la fin** (le départ en train).
4. **Clôture PARLÉE, puis clôture EN IMAGE.** ⚠️ *Renversé le 30/07.* La règle disait « le dernier
   mot est parlé, jamais une image muette » ; le monteur a tranché l'inverse en voyant le rendu. La
   recommandation finale reste dite en facecam, mais **une dernière bande paysage passe après**
   (sur #01 : les tours au crépuscule, 13,5 s) et **le son descend progressivement dessus**
   jusqu'au silence. On sort du film par l'image, pas par une coupe nette sur un visage.

**Le seul vrai arbitrage** : les deux séquences étant déjà ordonnées (le paysage par la
chronologie, le facecam par son arc validé), l'entrelacement est une **fusion monotone**. On ne
choisit ni l'ordre des sujets ni l'ordre des plans — on choisit **combien de blocs tombent dans
chaque jour** et **où on coupe les bandes**. Tout le reste en découle.

---

## 1. La doctrine d'entrelacement (consignes du monteur, 29/07 — révisée le 30/07)

1. **Alternance stricte** `L · F · L · F …` — le paysage est la colonne vertébrale, le facecam
   s'insère entre les bandes. **Ouvrir ET FERMER sur le paysage.** ⚠️ *Corrigé le 30/07 :* la
   version du 29/07 disait « fermer sur le facecam », et le monteur a tranché l'inverse sur le rendu —
   « ne pas finir le VLOG sur du rush facecam mais landscape avant baisse progressive du son ».
   Le dernier mot du film est une IMAGE : la clôture parlée reste, mais une bande paysage passe
   après elle et le son descend dessus (cf. `MUSIQUE.md`, fondu de sortie).
2. **Un sujet facecam ne se coupe JAMAIS en deux.** Quand on l'intègre, on le met jusqu'au bout.
3. **UN SUJET = UN BLOC : ne jamais scinder un raisonnement.** ⚠️ *Règle réécrite le 30/07.* Elle
   disait « 1–2 sujets max par insertion » — une contrainte de FORME, qui a coupé en trois le
   raisonnement sur le coût de la vie (hôtels/salaires → pourquoi les salaires sont bas → pourquoi
   les restos ne sont pas chers) et en trois celui sur les prix. Verdict du monteur : « on est sur le
   même sujet, **tu aurais dû l'identifier**, pas de scission ça casse le sujet ».
   La question n'est donc pas « combien de sujets » mais **« est-ce que c'est le même sujet ? »** :
   si trois sujets consécutifs sont trois étages d'une même démonstration, ils forment UN bloc,
   fût-il de 60 s. Le repère : si un bloc répond à une question qu'un autre bloc a POSÉE, ils
   n'auraient jamais dû être séparés. Le nombre de bandes paysage s'ajuste ensuite, pas l'inverse.
4. **Chronologie paysage stricte, jour par jour.** Aucun entrelacement entre jours ; à l'intérieur
   d'un jour, l'ordre du tournage. Un jour peut en revanche être **découpé en plusieurs bandes**
   (c'est même nécessaire : il faut autant de bandes que de blocs).
5. **Chercher les liens** script ↔ image, et les écrire. Une adjacence sans raison est un défaut.
6. **Renuméroter** sur la timeline fusionnée + regraver le timecode, pour que le monteur itère.

### Le raisonnement qui découle de ces règles
Les deux séquences sont ORDONNÉES (le paysage par la chronologie, le facecam par son arc validé)
→ l'entrelacement est une **fusion monotone**. On ne choisit donc pas « quel sujet à côté de quel
plan » librement : on choisit **combien de blocs facecam tombent dans chaque jour**, et **où
couper les bandes**. Méthode en 3 temps :

1. Compter : `nb de blocs = nb de bandes`. Grouper les sujets en blocs de 1–2 donne N ;
   il faut donc N bandes, réparties entre les jours **au prorata de la matière** de chaque jour.
2. Poser les **ancres** : les 4-5 endroits où une image répond exactement à une phrase (le marché
   avant « manger local pour 2 € », le train avant l'itinéraire, le mall avant « la ville est un
   mall géant »). Les ancres fixent la répartition, le reste s'ajuste autour.
3. Vérifier que la répartition tombe juste sur les ancres. Si non, déplacer **une frontière de
   bande**, jamais un sujet.

**Ne PAS réordonner les sujets facecam** sans raison forte : l'ordre est un arc validé, ses
raccords ont été vérifiés par re-transcription, et la clôture est une décision explicite du monteur.

---

## 2. Contrainte dure : les overlays déjà brûlés

Un habillage brûlé qui **traverse** une frontière de sujets interdit de couper là (le panneau
apparaîtrait ou disparaîtrait en plein vol). **À vérifier AVANT de grouper les blocs** :

```bash
node -e "const j=require('<store>/.coulisses/facecam/v12_plan_burn.json');
for(const o of j.overlays) console.log(o.id, o.t0, o.t1)"
```

Croiser avec les frontières de sujets : tout overlay à cheval **soude** les sujets concernés
dans un même bloc. C'est une contrainte, pas une préférence.

Les **sous-titres** sont plus tolérants : leur fin dépasse la frontière de 0,01 à 0,4 s, donc
un mot peut rester 2-10 images de trop — masqué par la coupe franche. Le mesurer et le dire :

```bash
# combien de points de coupe traversent un événement ASS, et de combien
node -e "…" # cf. PLAN-VLOG-01.md §3, « ce que coûte la découpe »
```

---

## 3. Les frontières de sujets facecam — comment les OBTENIR (et pas les deviner)

Le rendu facecam est un **concat de segments**, un par sujet : la timeline exacte est donc la
somme cumulée des durées de `…/.facecam_work/segs/*.mp4`, réordonnée selon l'EDL de la version
rendue (`vlog_chine_vNN.edl.refined.json`). Si un segment a été raccourci après coup, l'écart
apparaît en clair (total calculé − durée ffprobe = ce qui a été retiré).

**Vérification obligatoire** : recouper chaque frontière contre la transcription du rendu final
(`v12_whisper_large.cache.json`, offsets en **millisecondes**) — à chaque frontière on doit lire
la fin d'un sujet avant et le début du suivant après. Si une seule frontière ne tombe pas juste,
la reconstruction est fausse et tout l'assemblage l'est aussi.

Sortie : `vlog/sujets.json` = `[{id:"F01", label, a, b, dur}, …]`.

---

## 4. La chronologie complète — 7 phases, dans cet ordre

```bash
cd "$HOME/Library/Application Support/Montage"
P='PATH=$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin'
```

> **Ordre non négociable.** Chaque phase consomme la preuve produite par la précédente. Sauter la
> phase Ⓐ (un jour jamais coupé) et le découvrir en phase ④ coûte un re-rendu de tous les jours.

**Ⓐ INVENTAIRE (5 min)** — `node brief.mjs` + `node etat.mjs`, puis la question qui décide de tout :
**quels jours ont un `plan.txt` VALIDÉ PAR LÉO, et quels jours n'ont jamais été coupés ?**
`RESTITUTIONS.md` fait foi (une entrée par jour monté). Lister explicitement les jours manquants
**avant** de commencer — c'est le seul poste de coût imprévisible.

**Ⓑ LES JOURS MANQUANTS** — pour chacun, la boucle jour normale, en entier et dans l'ordre :
`catalogue.mjs` → `curate.mjs` → `filmstrip.mjs` → **`lecture.mjs` : fiche écrite en aveugle**
(ce que je crois voir AVANT de vérifier) → `plan.txt` avec une raison par ligne →
**🛑 GATE 1 : FAIRE VALIDER LE PLAN DE COUPE** → `monte.mjs` → tableau dans `RESTITUTIONS.md`.

> ### 🛑 GATE 1 — le plan de coupe d'une journée se fait valider AVANT `monte.mjs`
> **Pourquoi c'est une gate et pas une politesse** : une coupe de journée est la décision la plus
> chère à défaire de toute la chaîne. Un grade se rejoue en une commande (`revlog.mjs`), une trame
> se re-monte, mais une journée mal coupée fait tomber les manifestes, donc l'épisode, donc la
> musique. Et c'est la seule phase où le skill choisit **ce qu'on garde du voyage du monteur** — pas
> comment on le montre.
>
> Ce qui est soumis, à chaque fois, dans ce format :
> 1. la **fiche de lecture** (`Réglages/lecture-<jour>.md`) telle quelle — un bloc par rush ;
> 2. le **tableau de coupe** : `R## · durée source · décision (CUT total / fenêtre) · durée gardée ·
>    pourquoi` + le bilan `avant → après` ;
> 3. les **rushs écartés**, nommés un par un avec la raison (aucun passé sous silence) ;
> 4. ~~les doutes~~ → **RIEN. le monteur, 02/08 : *« je ne veux pas avoir à aller check les rushs un à un
>    pour valider des petites choses »*.** Un plan où deux lectures se défendent, **je le tranche** et
>    j'écris la raison dans le tableau — je ne le remonte pas. Lister des doutes par rush, c'est
>    déléguer au monteur un travail de vérification qu'il ne peut faire qu'en rouvrant chaque rush : le
>    coût pour lui est énorme, l'enjeu par plan est de 2 à 3 secondes.
>
> **Ce qui remonte, c'est ce qui se juge SANS rouvrir un rush** : une règle qui vaut pour plusieurs
> plans (« un panneau qui raconte le lieu, on le garde ou pas ? » — tranché OUI le 02/08), un
> registre de journée (« ce jour-là on garde tout et on resserre »), ou un bilan chiffré. Une
> question posée au monteur doit pouvoir se répondre **de tête, en une phrase**. Sinon elle n'est pas
> pour lui.
>
> le monteur répond selon la convention maison : **go** · **consigne** (j'itère sur cette base) · **sa
> version reprise telle quelle**. Sans réponse, on ne rend pas la journée.
> Exception assumée : si le monteur a dit « débrouille-toi » ou « fais tout », on coupe — et le jour reste
> **une réserve à nommer** dans la restitution ET dans la réponse : il n'a pas le même statut que
> les autres.

**Ⓒ LES SUJETS FACECAM** — cf. §3 (reconstruction + vérification whisper) → `vlog/sujets.json`,
puis §2 (overlays brûlés à cheval) → la liste des sujets **soudés**. Ces deux sorties sont les
seules contraintes dures de la phase suivante.

> ⭐ **Lot rendu VILLE PAR VILLE : `node facecam/fusion.mjs` d'abord** (30/08). `vlog.mjs` ne lit
> qu'UNE ligne `FACECAM` et un `sujets.json` en secondes ABSOLUES du master — six mp4 de ville
> n'y entrent pas. `fusion.mjs` soude les rendus et ré-adresse les `.spans.json` en une table
> globale `F01…F36`. **L'ordre des arguments = l'ordre du master**, et il n'engage pas le montage
> (l'EDL désigne les blocs par leur id) : on le prend dans l'ordre du film pour qu'un id croissant
> soit un sujet plus tard. Preuve à faire une fois : re-transcrire 5 s au `a` de la première borne
> de chaque ville dans le master soudé, et vérifier que les mots sont ceux du label.

**① Masters de jour NUS** — un jour n'entre dans un vlog mergé qu'en version nue :
```
Réglages/reperes.txt = off     → ni badge R##, ni timecode (ils seront regravés en global)
Réglages/musique.txt = off     → pas de lit musical par jour (6 lits concaténés = 6 démarrages)
```
puis, pour chaque jour : `jour.txt` + son `plan.txt` validé → `node monte.mjs`.
Chaque rendu dépose **`vlog/parts-last.json`** (le manifeste des segments : fichier, R##, fenêtre
source) → le copier en `vlog/parts-<JJ-MM>.json`.

> ⭐ **En pratique, `node nus.mjs` fait cette phase en une commande — et il le faut** (30/08).
> `Réglages/plan.txt` est ÉCRASÉ à chaque journée et `parts-last.json` à chaque rendu : après un
> lot de 11 journées, les 11 plans de coupe validés n'existent plus nulle part comme réglage.
> Ils sont en revanche archivés **en entier** dans `projects/<stamp>/` (plan.txt + jour.txt +
> project.json), déposés par `monte.mjs` à chaque rendu. `nus.mjs` prend par jour le projet le
> plus RÉCENT, rend en nu, et n'installe `parts-<JJ-MM>.json` qu'après trois contrôles : compte
> de plans, rushs identiques au projet, et **durée du nu == durée du master badgé** (les repères
> ne changent pas la durée — c'est ce qui prouve qu'on a repris le bon montage, pas un ancien).
> Rien n'est installé partiellement : c'est tout, ou rien.
> ⚠️ Le mode nu ne réutilise AUCUN segment du cache (`rep` entre dans la clé) : compter un
> ré-encodage complet, ~10 min pour 39 plans.

> ⭐ **RE-rendre un épisode DÉJÀ monté (grade changé, épaule, filtre) : `node revlog.mjs`.**
> Le montage ne bouge pas, seule l'image change — il n'y a donc rien à re-décider. La commande
> déroule ①→③ toute seule à partir des manifestes (donc **elle ne peut pas re-couper**), pose
> `reperes`/`musique` à off, contrôle que tous les segments existent **avant** d'installer, merge,
> repose la musique et restaure les Réglages même en cas d'échec. `--dry` d'abord si tu veux voir
> le périmètre. Les ① → ③ ci-dessous restent la référence pour un épisode NEUF.

> ⚠️ Le badge est brûlé DANS le segment mais `reperes` **entre** dans la clé de cache (champ `rep`
> ajouté seulement quand c'est off, comme `mute`) : sans ça un rendu « nu » resservirait les
> segments BADGÉS du cache — panne silencieuse que seule l'image révèle.

**② LA TRAME, puis l'EDL.** D'abord poser la trame **sur le papier**, dans l'ordre du §0 :
1. grouper les 28 sujets en blocs de 1–2 (les soudés du Ⓒ d'abord, ils ne se discutent pas) → **N blocs** ;
2. donc **N bandes**, réparties par jour au prorata de la matière retenue (plancher : 2 bandes/jour) ;
3. placer les **ancres** (≥ 1 par jour), vérifier que la répartition tombe juste dessus ;
4. si ça ne tombe pas : déplacer **une frontière de bande**, jamais un sujet.
Écrire la raison de chaque adjacence AU FUR ET À MESURE, dans `PLAN-VLOG-<NN>.md` — après le
rendu, on ne les retrouve plus.

> ### 🛑 GATE 2 — la TRAME se fait valider AVANT d'écrire l'EDL
> **Pourquoi** : la trame, c'est le récit. Elle décide de ce qu'on entend après quoi, de ce que
> l'image dit du propos, de l'ordre dans lequel le voyage se raconte. C'est la seule décision
> ÉDITORIALE de tout le pipeline — tout le reste est de l'exécution mesurable. Et elle se paie
> cher : la découvrir mauvaise au visionnage, c'est re-rendre les blocs facecam, re-merger et
> re-poser la musique. Sur le #01, les retours du monteur du 30/07 ont porté **exactement** là-dessus
> (recoller les 3 blocs du coût de la vie, ne pas finir sur du facecam) — donc sur du déjà rendu.
>
> Ce qui est soumis, sur le papier, AVANT toute commande :
> 1. le **tableau de la trame** : une ligne par bloc — `L/F · jour ou sujets · durée · rôle` ;
> 2. les **chiffres du gabarit** confrontés au §0 : durée totale, nombre de blocs, cadence, part
>    paysage / facecam, bandes par jour ;
> 3. les **ancres** (≥ 1 par jour) : quelle image répond à quelle phrase, et pourquoi ;
> 4. **la raison de chaque adjacence** qui n'est pas évidente — c'est ce que le monteur arbitre vraiment ;
> 5. les **points fixes** : cold open, clôture, carton(s) de ville, générique.
>
> Même convention de réponse qu'à la GATE 1. Tant que la trame n'est pas validée, on n'écrit pas
> `Réglages/vlog.txt` et on ne lance pas `vlog.mjs`.

Puis seulement, `Réglages/vlog.txt` :
```
TITRE   …
FACECAM /…/VLOG_Chine_facecam_v12.mp4
SUJETS  /…/vlog/sujets.json
OUT     /…/Vidéos finies/VLOG … .mp4       # l'épisode agrégé vit là (le monteur 30/07)
PARLE   16-07/R02 16-07/R40   # plans PAYSAGE où le monteur commente (→ niveau `voix`)
CARTON  R001 SHANGHAI 上海    # carton de VILLE : nom au centre, en fondu

L 15-07  R01 R02          # bande paysage (segments EXACTS du manifeste)
F F01 F02                 # bloc facecam (sujets ENTIERS et contigus, autant qu'il en faut)
```

**La ligne `PARLE`** liste les plans paysage dont la prise a été gardée POUR le commentaire de
le monteur. Elle se remplit **à la main** : aucune heuristique ne les trouve seule (whisper « entend »
aussi la foule chinoise et hallucine sur du bruit de rue — sur les 10 plans paysage ≥ 4,4 s du
#01, il rend du coréen et du cingalais sur 8 d'entre eux, et du vrai français sur les 2 bons).
Le test pratique : transcrire les plans paysage LONGS (un plan long = une intention), lire les
sorties, ne garder que le français plausible. Sans cette ligne, `musique.mjs` traite le plan
comme du décor et pose la musique par-dessus la voix — le défaut du 1ᵉʳ rendu.

**La ligne `CARTON` — le nom de la ville** (le monteur, 30/07 : *« typo B au milieu de l'écran,
"Shanghai" juste premier rush c'est tout. On fera ça à chaque ville. »*). Convention figée :

| quoi | valeur | pourquoi |
|---|---|---|
| typo | **Bebas Neue 150 px**, du repo (`assets/fonts`) | condensée, elle tranche avec `Lato Black` des sous-titres : on ne confond pas un jalon de récit avec de la parole |
| couleur | accent maison **#F5F5F5** + ombre portée | la même que les sous-titres et les vignettes — une seule couleur d'accent dans tout le film |
| position | **centrée**, idéogrammes 46 px dessous | mesuré sur R001 : 5,0 % du fond plus clair que l'accent au pire instant (seuil d'alerte ~15 %) |
| apparition | **fondu 0,45 s** à l'alpha, entrée à +0,6 s du plan, sortie à −0,35 s | « l'apparition d'une typo », pas un carton qui claque. Le fondu porte sur le TEXTE, le plan continue dessous |
| combien | **UN par ville, sur le premier plan qui y arrive** | c'est un jalon de récit, pas un sous-titrage de lieu. #01 ne quitte jamais Shanghai → un seul carton |

⚠️ Ce carton est une **exception assumée au parti pris n°1** du `facecam/README.md` (« zéro
doublon : un mot qu'il prononce ne se réaffiche jamais ») — le monteur dit « Shanghai » à l'oral. Il l'a
demandé explicitement : le carton IDENTIFIE un lieu, il ne réécrit pas une phrase, exactement
comme l'exception déjà admise pour les logos de marque.

**③ Assemblage + musique, UNE commande** : `node vlog.mjs --dry` (le plan, sans encoder) puis
`node vlog.mjs`, qui assemble PUIS appelle `musique.mjs plan --structure` et rend **un seul
fichier** dans « Vidéos finies ». L'assemblage muet est un intermédiaire de `vlog/work/`,
supprimé après coup. le monteur (30/07) : « à chaque rendu agrégé tu me sors 2 vidéos, j'en veux
qu'une seule, la vraie, avec le lit musical » — il n'y a donc plus de suffixe ♪ à décoder.
`--nu` s'arrête à l'assemblage muet, pour du débogage uniquement.
- bandes paysage = **segments réutilisés tels quels**, jamais recoupés au timecode dans le master
  (le timecode d'un master dérive de ~0,05 s/plan : une coupe au timecode fait clignoter le plan
  voisin) ;
- blocs facecam = découpés aux frontières de sujets et **ré-encodés au format des segments**
  (30/1 fps, `-video_track_timescale 15360`) — sinon le concat démuxer dérive ;
- une seule passe finale grave les **badges renumérotés** (via un ASS : libass avale 150
  événements là où 150 `drawtext` feraient exploser la chaîne de filtres) + le timecode.
- sortie : `vlog/vlog.plan.json` = la timeline **mesurée** (c'est elle qui alimente ④ et le
  tableau — et c'est aussi ce que `subs-controle.mjs` lit pour juger les sous-titres).
  ⚠️ **`--dry` n'écrit PAS ce fichier** : il écrit `vlog/vlog.plan.dry.json`, dont les durées
  sont CALCULÉES et non mesurées (aucun segment encodé), avec un écart cumulatif mesuré
  jusqu'à +0,098 s sur l'EP3. Cet artefact porte `_dry` et le contrôle des sous-titres le
  REFUSE. Jusqu'au 20/09 le dry écrasait le vrai, et une réserve déclarée au millième a
  mordu à cause de ça (dette n°8).

**④ Musique** : `node musique.mjs plan "<rendu.mp4>" --structure vlog/vlog.plan.json`
→ voir `MUSIQUE.md` §timeline mixte. Deux grilles : cues longs (50-120 s) **snappés sur les
ruptures du montage**, et niveaux **par bloc** (`voix` sous le facecam, `plein`↔`lit` alterné sur
le paysage). C'est la grille fine des niveaux qui « fait varier la fixation des niveaux sonores ».
La commande **mesure l'équilibre et se corrige toute seule** : elle rend un premier mix, mesure le
LUFS des zones parlées et des zones portées par la musique, et si l'écart dépasse 1 LU elle ajuste
le gain de la voix et refait la passe (le lit musical, lui, n'est calculé qu'une fois).
Elle l'écrit dans son log — **le reporter dans la restitution**, c'est une preuve chiffrée.

**⑤ Preuve + restitution** — cf. §5.

**⑥ LE MASTER PUBLIABLE** (31/07) — tant que le monteur itère, tout ce qui précède se rend en
**brouillon** : badges `R###`/`F##` + timecode gravés, encodeur matériel. C'est un rendu de
TRAVAIL, il ne se publie pas. Quand le monteur dit « c'est bon, passe au rendu final » :

1. `Réglages/qualite.txt` = **`final`** ;
2. **`node revlog.mjs`** — et pas `node vlog.mjs` seul. La qualité est dans la clé de cache des
   segments (`q`) : poser `final` au seul étage vlog regraverait un habillage propre PAR-DESSUS
   des segments encodés en brouillon. `revlog.mjs` re-rend les 6 journées depuis les manifestes
   (donc **sans re-couper**), réinstalle, puis relance le merge et la musique ;
3. `vlog.mjs` en `final` **n'écrit aucun repère** — seuls les **cartons de ville** restent, ils
   font partie du film. S'il n'y a rien à graver du tout, il ne ré-encode même pas (`-c:v copy`) ;
4. **remettre `qualite.txt` = `brouillon`** ensuite : `revlog.mjs` sauvegarde et restaure
   `jour/plan/reperes/musique`, mais PAS la qualité — la laisser en `final` ferait payer 20×
   le prochain rendu d'itération sans que rien ne le dise.

**⑦ LE MASTER 4K** (31/07) — même chose, avec `Réglages/definition.txt` = `2160` EN PLUS de
`qualite.txt` = `final`, puis **`node revlog.mjs`** (la définition est dans la clé de cache des
segments au même titre que la qualité). Le montage ne bouge pas : mêmes plans, mêmes fenêtres,
même durée. Ce qui change tient en trois préparatifs, et **ils se font AVANT le revlog** :

| ce qu'il faut refaire en 4K | pourquoi | comment |
|---|---|---|
| le **facecam v12** | ses 11 overlays et ses sous-titres karaoké sont **brûlés** dans un fichier 1080p | `facecam/render.mjs <edl v11> --def 2160 --out …_v11_4K.mp4` → `v12_capture_tout.mjs --dsf 2` → `v12_burn.mjs --scale 2 --in …_v11_4K.mp4 --out …_v12_4K.mp4` |
| le **générique de fin** | même raison (c'est un rendu d'images) | `facecam/overlays/generique-mp4.mjs vlog/generique-01.json --out "… 4K.mp4" --dsf 2` |
| les **noms de fichiers** | sinon on écrase le master de référence | lignes `FACECAM_2160` / `GENERIQUE_2160` / `OUT_2160` de l'EDL, lues seulement à 2160 |

⭐ **LA CLÉ : ne PAS repasser les moteurs d'overlays en coordonnées 3840×2160.** Ils travaillent
en repère 1920×1080 et les 17 partis pris du monteur sont calés dessus — les convertir, c'est lui
refaire payer chaque décision. Deux leviers suffisent : `capture.mjs --dsf 2` (même mise en page,
2× les pixels, rendu **vectoriel** donc natif — mesuré : 7,07× plus d'énergie de haute fréquence
qu'un simple agrandissement ×2) et `overlay=X:Y` doublé dans le filtergraph. **Les sous-titres ASS
ne changent RIEN** : libass met un script `PlayResX 1920` à l'échelle de la sortie et rend en
vectoriel — « corriger » les tailles de police doublerait l'échelle deux fois.

⚠️ **Remettre `definition.txt` = `1080` ET `qualite.txt` = `brouillon` ensuite** : `revlog.mjs`
sauvegarde `jour/plan/reperes/musique`, ni l'une ni l'autre.

Le **générique de fin** n'est pas un fichier collé après coup : `GENERIQUE <fichier>` dans l'EDL
en fait un PLAN de la timeline (badge `GEN`), donc il traverse le même concat séparé v/a que le
reste et ne peut pas décaler le son. `OUTRO <s>` impose la durée du fondu musical pour qu'il
meure sur lui, et pas sur la bande paysage de clôture qui le précède.

---

## 5. Clôture

- **Preuve à l'image** : extraire une frame à un raccord L→F et une à un raccord F→L, les Read,
  vérifier badge + timecode + absence de double habillage. Plus une frame au **pire instant**
  (le plan le plus sombre / le badge sur fond clair).
- **La GATE, en une commande** (31/07) — elle mesure tout ce qui suit et rend un verdict :
  ```
  .venv-vision/bin/python gate.py "<master.mp4>" --ref-audio vlog/work/_raw_a.m4a --plan vlog/vlog.plan.json
  ```
  images == durée × 30 exactement · `avg_frame_rate` 30/1 · `start_time` 0 · dérive A/V < 100 ms ·
  écart au plan ≈ 0 · **synchro par corrélation croisée sur 7 fenêtres** · −14 LUFS ± 0,5 · vrai pic ·
  équilibre parole–image ≤ 1 LU · fondu de sortie · décodage intégral. Elle décode le fichier EN
  ENTIER et tranche dans numpy : c'est la seule méthode qui ait tenu sur ce projet.
- **Preuve audio** : `ffprobe`/`loudnorm` sur le rendu final, et vérifier que le niveau `voix`
  laisse bien la parole intelligible (mesure de LUFS sur une fenêtre facecam vs une fenêtre paysage).
- **Tableau de restitution** dans `RESTITUTIONS.md` : une ligne par bloc de la timeline mergée
  (`badge · origine · durée · rôle`), plus le bilan `matière disponible → matière retenue`.
- `node etat.mjs log "…"` pour que ça survive à un `/clear`.

---

## 6-bis. ⭐ Le piège du VLOG #02 : DEUX HORLOGES sur le master facecam (31/08)

Le monteur signale cinq fois le même symptôme sur le rendu du 30/08 — « un rush inutile pendant
quelques centièmes de seconde puis le bon rush direct » (F05, F06, F07, F10, F19), plus « une
transition bizarre, violente, impression de mouvement violent de caméra ». **C'était UN défaut,
systématique, et il touchait 12 des 54 bornes de blocs facecam.**

| ce qu'on croyait | ce que la mesure a dit |
|---|---|
| les bornes de `sujets.json` ont dérivé | elles tombent au **0 image près** sur les coupes réelles du master (36/36) |
| `-ss` avant `-i` n'est pas exact | il rend **image pour image** la même chose que le seek en sortie |
| la vraie cause | `sujets.json` est en **temps de CONTENU** (index ÷ 29,97), `-ss` est en **temps de PTS** — et le master soudé est VFR |

Les rendus de ville sont à cadence variable : leur pts prend jusqu'à **+3,0 images** d'avance sur
l'index, et le concat de `fusion.mjs` remet l'offset à la durée exacte en images à chaque ville —
donc le **pts RECULE** aux jonctions (3 reculs mesurés, jusqu'à 2,0 images). Aucune valeur de
`-ss` ne peut isoler la bonne image quand les pts reculent.

**La parade** : ne plus adresser le master en secondes du tout. `vlog.mjs` découpe par
`select='between(n,n0,n1-1)'` + `setpts=N/FRAME_RATE/TB`, puis `fps=30` comme avant. L'audio,
lui, est bien en temps de contenu (`fusion.mjs` le reconstruit au filtre `concat`, donc continu
et monotone) et se découpe en secondes. Coût : le décodage repart du début du master pour chaque
bloc (~5 s), payé une fois grâce au cache. Résultat mesuré : **27 blocs sur 27 propres**, compte
d'images exact, et 12 micro-segments disparus du rendu.

**Les trois leçons, dans l'ordre où elles coûtent cher :**
1. *Un compte d'images juste ne dit rien sur la PLACE de ces images dans le temps.* Les trois
   contrôles de `fusion.mjs` (images, dérive A/V, `start_time`) étaient au vert sur un master
   inutilisable. Il mesure désormais aussi son horloge (écart index↔pts, reculs de pts).
2. *Deux grandeurs qui portent la même unité ne sont pas la même horloge.* Des secondes calculées
   en cumulant des images et des secondes lues dans un conteneur se ressemblent jusqu'au jour où
   elles divergent de 100 ms.
3. *La clé de cache doit porter tout ce dont le contenu dépend* — le nom du bloc dit maintenant la
   fenêtre d'IMAGES **et** une empreinte du master (taille ⊕ date). Sans elle, re-souder le master
   après correction d'une ville resservirait des blocs périmés sans un mot.

---

## 6. Pièges rencontrés (VLOG #01)

| piège | symptôme | parade |
|---|---|---|
| `work/` est vidé par `cleanWork()` en fin de run | le manifeste de segments disparaît juste après avoir été écrit | l'écrire AUSSI hors de `work/` (`vlog/parts-last.json`) |
| la clé de cache ignorait l'état des repères | un rendu « nu » ressort avec les badges de la veille | ajouter `rep: 0` à la clé **seulement quand c'est off** (sinon on invalide tout le cache existant) |
| `ass=` re-parse son argument | filtre qui échoue sur un chemin contenant espaces/accents | écrire l'ASS dans `os.tmpdir()` |
| fps différents (30/1 vs 30000/1001) | dérive A/V au concat | ré-encoder le facecam en 30/1 + même `video_track_timescale` |
| `between(t,a,b)` vaut 1 aux DEUX bornes | le gain double pendant une frame à chaque palier | intervalles mi-ouverts `gte(t,a)*lt(t,b)` |
| « plein après CHAQUE facecam » | 100 % de plein (le facecam revient toutes les 2 bandes) → on n'entend plus jamais la rue | ~~alternance stricte `plein`↔`lit`~~ → **structure interne à la bande** (30/07) |
| alternance `plein`↔`lit` **une bande sur deux** | « tu fais un peu au hasard », le son de rue s'allume et s'éteint toutes les 15 s sans motif lisible. Le dosage était bon, c'est la CADENCE qui était fausse | tête muette → queue sonore DANS chaque bande (`MUSIQUE.md` §préférences sonores) |
| **concat démuxer `-c copy` sur v+a à la fois** | « mes lèvres ne suivent pas la bande son », « le son de R20 déborde sur R21 ». Invisible sur la durée totale (773,57 vs 773,59) : la dérive ne se voit qu'en cumulant morceau par morceau | concaténer les DEUX FLUX SÉPARÉMENT, audio recadré à la durée vidéo de chaque morceau |
| **28 morceaux avec `start_time`=0,033 s** | le démuxer insère chaque décalage comme un TROU : +0,924 s de vidéo que l'audio ne suit pas. C'était le gros morceau du désync (~1,2 s cumulés en fin de film) | re-mux `-avoid_negative_ts make_zero -muxdelay 0 -muxpreload 0` (copie de flux) avant le concat |
| un plan paysage COMMENTÉ noyé sous la musique | R011 (rayon LAWSON, 22 s) et R028 (Starbucks, 14,6 s) : le monteur avait gardé ces prises POUR le commentaire, la musique passait devant | déclarer `PARLE 16-07/R02 16-07/R40` dans l'EDL → niveau `voix` |
| un bloc facecam qui **borne en plein mot** | F23 finissait à 350,895 s, au milieu de « Vietnam » (350,52→351,10) | les frontières de sujets se vérifient sur le cache whisper AU MOT, pas à l'oreille |
| **les timestamps whisper suffisent pour couper** | ils ne suffisent pas. Sur la fin de F23, whisper plaçait le mot suivant à 348,32 ; l'attaque RÉELLE est à **348,07** (0,25 s plus tôt). Couper « juste avant 348,32 » laissait le monteur repartir dans sa phrase, visiblement — c'est exactement ce qu'il a vu | couper une phrase parlée se décide sur **TROIS** mesures, pas une : (1) l'énergie en bande voix 200-3500 Hz par fenêtres de 10 ms → le vrai silence ; (2) **les LÈVRES**, planche d'images autour du point candidat → l'articulation ANTICIPE le son ; (3) le mot de whisper seulement pour savoir *où chercher*. Ici : silence profond 347,96→348,06, lèvres au repos à 348,03, réouverture à 348,07 → coupe à **348,05** |
| le fichier de bloc facecam ne portait **que les IDs de sujets** dans son nom | corriger une frontière dans `sujets.json` ne changeait pas le nom du fichier de `vlog/work/` : il existait déjà, il était réutilisé, et le rendu gardait l'ANCIENNE découpe **sans un mot**. La coupe demandée n'était pas dans le rendu | les BORNES entrent dans le nom (`fc_11_F19-F23_288x10-348x05.mp4`) — corrigé le 30/07 |
| `new URL(import.meta.url).pathname` | chemin **pourcent-encodé** (`Application%20Support`) → tous les fichiers du moteur « introuvables » | `fileURLToPath(import.meta.url)` |
| les niveaux du monteur appliqués tels quels | la parole 3 LU sous la musique : on monte le son pour entendre, on se fait cueillir au montage suivant | mesurer l'écart réel et corriger le gain voix (2ᵉ passe automatique) |
| `assignTracks` n'interdit que 2× d'affilée | 3 cues sur le même morceau, 10/10 dans le même mood « sombre » (la préférence `facecam` ne désigne que 4 pistes) | épuiser le vivier avant de resservir + ouvrir la préférence (sous la voix la musique est déjà à 0,15) |
| les repères laissés sur `on` après coup | le jour suivant se rend en **nu** sans qu'on s'en aperçoive | **remettre `reperes.txt`/`musique.txt` à `on`** et restaurer `jour.txt`/`plan.txt` en fin de session |
| un jour jamais coupé, découvert en cours de route | tout le budget de la session part dans une boucle jour non prévue | phase Ⓐ : croiser les jours demandés avec `RESTITUTIONS.md` **avant** la première commande |
| offsets whisper lus en centisecondes | la vérification des frontières « prouve » n'importe quoi (texte hors sujet à chaque frontière) | les offsets du cache sont en **millisecondes** (`/1000`) — et si UNE frontière ne tombe pas juste, tout l'assemblage est faux |
| `catalogue.mjs` **vide** `catalogue/` avant d'indexer | des fichiers suivis par git disparaissent en silence (planches de revue, `curation.md`) | `git status` après tout re-catalogage ; ne rien ranger de durable dans `catalogue/` |

## ⛔ On nomme la ville AVANT d'en parler (le monteur, 18/09) — contrainte de trame, et refus

> « facecam chengdu après un rush landscape avec le titre jaune "Chengdu", pas avant, pareil
> pour les autres endroits **on nomme et place le titre en premier avant d'en parler**. »

Le **carton de ville précède le premier bloc facecam qui la nomme**. Mesuré sur le master du
17/09 : **5 cartons sur 8** tombaient après (Chongqing −4,47 s · Chengdu −10,31 s · Pingyao
−14,58 s · Datong −8,71 s · Urumqi −11,24 s). le monteur n'en avait vu qu'un.

**Conséquence sur les ancres.** Les adjacences « annonce puis payoff » de `PLAN-VLOG-03.md` qui
NOMMENT une ville sont caduques : le bloc ne peut plus précéder son carton. Deux remèdes, et
c'est une **décision éditoriale** — on la soumet, on ne la prend pas :
① avancer le carton sur la bande L qui précède le bloc · ② déplacer le bloc F après la bande
porteuse du carton.

**⚠ ET LE REMÈDE ÉVIDENT EST IMPOSSIBLE 4 FOIS SUR 5 — mesuré, pas supposé.** « Avancer le
carton sur la bande qui précède le bloc » suppose que cette bande montre déjà la nouvelle ville.
Les fiches de journée disent le contraire : Chengdu est précédé de **Chongqing**, Pingyao de
**Xi'an**, Datong de **Pingyao**, et Chongqing du **cold open de Yangshuo**. Le titre aurait nommé
les images de la ville d'avant — un défaut pire que celui qu'on corrige. Seul Urumqi le permettait
(J19-08 porte déjà sa gare). *Quand un remède « évident » vaut pour un cas, vérifier qu'il vaut
pour les autres AVANT de l'appliquer en série.*

**Remède retenu (18/09)** : les **2 premiers plans de la ville passent AVANT son bloc**, le reste
de la journée suit après. Invariant exhibé plutôt que « ça marche » : 181 plans avant, 181 après,
**ensemble identique**, aucun doublon, les 21 blocs facecam dans le **même ordre**, durée
inchangée. Dans l'EDL, ça se lit comme **deux lignes `L` du même jour qui se suivent** — c'est la
marque du geste, et le chemin pour le défaire.

**Le refus vit dans `vlog.mjs --dry`**, pas ici. Une trame se relit, elle ne s'exécute pas — et
2 secondes de `--dry` valent mieux que 20 minutes d'encodage. Réserve assumée : ligne
`RESERVE_CARTON <Ville>` dans l'EDL ; elle est alors **listée et chiffrée** dans la sortie, et
le compteur annonce la dette (« 3/8 · 5 en RÉSERVE DÉCLARÉE ») au lieu de dire 8/8.

## ⛔ L'horloge du master facecam se mesure (18/09)

`vlog.mjs` découpe l'**image par index** et le **son en secondes** : ça ne tient que si le master
est CFR. Mesuré sur `VLOG_Chine03_facecam_v1.mp4` : 9 031 images, **0 recul de pts**, mais 5
intervalles anormaux et `|pts(n) − n/fps|` qui passe de **+0,021 s à +0,376 s**. C'est le « son
décalé de mes paroles » signalé par le monteur.

⚠ Le garde **BLOQUE, il ne corrige pas** — et c'est délibéré. Recaler le son sur `pts` est la
piste évidente, mais la corrélation croisée du rendu contre la source laisse un résidu qui
grandit encore (+0,038 → +0,146 s) : **le bon donneur d'horloge n'est pas prouvé**. Corriger
dans une grandeur voisine non prouvée, c'est refaire le défaut symétrique de F36 (31/08).
Réserve chiffrée : `MONTAGE_HORLOGE_TOL=<secondes>`.

## ⛔ Un carton se range avec le NOM du plan, pas avec son rang (18/09)

`CARTON R166 URUMQI` désigne le **166ᵉ plan du film**. En retirant UN plan sur consigne du monteur
(« cut R162 »), les deux derniers cartons ont glissé d'un cran — URUMQI de `J20-08 R01` à `R02`,
ALMATY de `R04` à `R05` — **sans le moindre avertissement**, et le contrôle de badge ne pouvait
rien voir puisque `R166` existait toujours. C'est « un identifiant dérivé d'un ordre n'est pas un
identifiant », payé le jour même où je citais la règle en coupant le plan.

Forme désormais recommandée, stable sous toute coupe :

```
CARTON  20-08/R01 URUMQI 乌鲁木齐
```

La forme `R###` reste acceptée pour les anciens EDL, mais elle est **signalée à la lecture**. Et
le résolveur vit en **un seul exemplaire** : il en existait deux — un pour le contrôle d'ordre, un
pour la gravure — que rien n'obligeait à désigner le même plan. La conséquence aurait été muette :
le garde valide l'ordre sur un plan, ffmpeg grave le titre sur un autre.

