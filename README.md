# VideoCreator

**Une stack de montage vidéo qui tourne entièrement sur votre machine.** Pas de compte, pas
d'abonnement, pas d'envoi : aucun appel réseau dans le pipeline. Les rushs, les transcriptions
et les rendus ne quittent jamais le disque.

Elle est faite pour un usage précis et l'assume : **du parlé face caméra qu'on veut serrer**, et
**des plans d'ambiance qu'on veut monter vite**. Ce qu'elle sait faire de mieux, c'est enlever ce
qui traîne — les silences, les faux départs, les « euh », les phrases dites deux fois — sans jamais
couper un mot.

## Ce qu'elle sait faire

```bash
node capacites.mjs          # les 53 compétences, avec la commande de chacune
node capacites.mjs --json   # la même chose pour un outil
```

| Chaîne | Ce qu'elle couvre | Compétences | Point d'entrée |
|---|---|---|---|
| **A — Parole** | dérusher des rushs parlés, couper les vides | 16 | `node facecam/map.mjs` |
| **B — Voir** | bande de montage, pellicules, mesures | 6 | `node visionneuse.mjs` |
| **C — Habillage** | sous-titres, overlays, miniature | 14 | `node facecam/overlays/subs.mjs` |
| **D — Paysage** | catalogue, montage d'une journée, vlog, musique | 11 | `node monte.mjs` |
| **E — Chaîne** | état, rangement, preuve, restitution | 6 | `node brief.mjs` `.venv-vision/bin/python gate.py` |

Ce tableau n'est pas écrit à la main : il vient de `capacites.json`, la source unique que lisent
aussi la bande de montage et l'agent. `node capacites.mjs --check` refuse un manifeste qui a
dérivé du code — script disparu, doc morte, prérequis non déclaré.

## Installer

```bash
brew install ffmpeg whisper-cpp aubio node
npm install                                  # puppeteer-core, pour les overlays HTML
```

Les modèles de transcription (whisper.cpp) ne sont pas dans le dépôt — ils pèsent trop. Ils se
posent dans `models/`, et se prennent chez leur auteur :

```bash
mkdir -p models
curl -L -o models/ggml-small.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin      # ~466 Mo, la passe rapide
curl -L -o models/ggml-large-v3.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin   # ~2,9 Go, la passe finale
```

Quatre variables suffisent à déplacer la stack ; sans elles, tout retombe sur les
emplacements par défaut :

| Variable | Ce qu'elle déplace | Défaut |
|---|---|---|
| `MONTAGE_HOME` | le moteur | le dossier du dépôt |
| `MONTAGE_STORE` | la matière (rushs, rendus, réglages) | `~/Movies/Montage` |
| `MONTAGE_MODELS` | les modèles de transcription | `<moteur>/models` |
| `MONTAGE_PROFIL` | l'identité visuelle et les préférences | `profil/defaut.json` |

```bash
node arbo.mjs --apply       # pose l'arborescence du store
node capacites.mjs          # vérifie ce qui est prêt sur votre machine
```

## Commencer par le dérushage parlé

```bash
node facecam/map.mjs "<dossier de rushs>"   # ce qui est dit, et où
node facecam/subjects.mjs                    # les sujets, et leurs reprises
node facecam/pick.mjs                        # la meilleure prise de chaque sujet
# … vous écrivez l'EDL : un sujet, une prise
node facecam/refine.mjs <edl.json>           # les bornes se posent sur le vrai parlé
node facecam/relances.mjs --apply            # les faux départs sautent
node facecam/render.mjs <edl.json>           # le master
```

Le rendu appelle lui-même le **garde de la parole** : il refuse de livrer un master où
subsiste une relance, un « euh » tenu, une queue coupée ou une borne posée au milieu d'un mot.
Une exception se déclare explicitement dans l'EDL — elle ne se glisse pas en silence.

## La bande de montage

```bash
node visionneuse.mjs --open
```

Un serveur local : le rendu se joue, la tête de lecture avance sur la bande, une portion se
sélectionne à la souris et se coupe au clic droit. Le bouton **🧰 Compétences** (ou la touche
`?`) ouvre le catalogue complet — filtrable, la commande se copie au clic, et ce qui manque
sur votre machine est grisé en le disant.

## Le profil : ce qui vous appartient

`profil/defaut.json` porte ce qui n'est pas du moteur — couleur d'accent, polices, look par
défaut, préférences sonores, trame d'épisode. La couleur est déclarée **une fois** ; le moteur
en dérive le CSS, le `0xRRGGBB` de ffmpeg et le `&HAABBGGRR` de l'ASS (qui est en BGR — c'est
cette inversion, faite à la main, qui sortait un sous-titre bleu).

Le profil livré est **neutre** (accent clair, polices libres, look de base, aucune direction artistique imposée). Remplacez-le par le vôtre : c'est le geste d'appropriation.

## Ce que la doctrine impose, et pourquoi

**Prévenu tout de suite :** `docs/` n'est pas un manuel de référence. Ce sont les journaux d'un
monteur — datés, adossés à des tournages précis, écrits pour ne pas repayer la même erreur. On y
lit « le 30/08, R24 montré 0,4 s après sa fin » plutôt que « paramètres de la fonction X ». Le
chemin d'entrée, lui, est court : ce README, puis `node capacites.mjs`, puis la chaîne A.
Quelques-uns de ces journaux sont restés privés tout en étant cités : `docs/NON-PUBLIE.md` dit
lesquels, et ce qu'ils contenaient.

Les documents de `docs/` ne sont pas de la documentation d'API : ce sont des leçons payées.
Trois règles traversent toute la stack et expliquent la forme du code :

- **On mesure la sortie, jamais l'intention.** Un `exit 0` n'est pas une preuve. Chaque garde
  a un contrôle positif : `--self-test` casse volontairement ce qu'il surveille et exige de
  le voir. Un contrôle qui ne sait pas voir un défaut ne prouve pas son absence.
- **Ce qui décide du contenu appartient à la clé de cache.** Un segment rendu en brouillon ne
  doit jamais ressortir comme un master : la qualité fait partie de son identité.
- **Deux décisions se prennent avec un humain** — le plan de coupe, et la trame d'un épisode.
  Le reste s'automatise.

## Licences

Le code est sous licence MIT (`LICENSE`). Les polices embarquées sont toutes sous
**SIL Open Font License 1.1** — vérifié dans les métadonnées de chaque fichier, pas supposé ;
le texte et les copyrights sont dans `facecam/assets/fonts/`. Les icônes viennent de
[Lucide](https://lucide.dev) (MIT, licence jointe) et les contours de pays de
[Natural Earth](https://www.naturalearthdata.com) (domaine public).

## Versions

Ce dépôt est **généré** depuis un dépôt de travail privé, par transformation reproductible :
le périmètre publié est dérivé de `capacites.json`, les données personnelles ne sont pas
recopiées mais écartées, et une garde vérifie le résultat avant publication. Les versions
suivantes suivront le même chemin — voir `CHANGELOG.md`.
