#!/usr/bin/env python3
# ============================================================================
# facecam/embed.py — embeddings de phrases LOCAUX (sens, pas mots).
# Utilisé par distill.mjs pour repérer « la même idée dite autrement » — ce que
# la similarité lexicale rate par construction (paraphrase = mots différents).
#
# Modèle = model2vec (embeddings STATIQUES) : numpy seul, pas de torch, rapide.
# Il est VENDORÉ dans models/embed-multi/ au premier appel → ensuite 100 % offline
# (le Mac voyage derrière le Great Firewall : rien ne doit dépendre du réseau).
#
# Entrée : un tableau JSON de textes sur stdin.
# Sortie : {"vectors": [[...], ...], "dim": N, "model": "..."} sur stdout.
# ============================================================================
import sys, json, os
from model2vec import StaticModel

HERE = os.path.dirname(os.path.abspath(__file__))
VENDOR = os.path.join(HERE, '..', 'models', 'embed-multi')
REMOTE = 'minishlab/potion-multilingual-128M'    # multilingue (le FR est indispensable ici)

if os.path.isdir(VENDOR):
    model = StaticModel.from_pretrained(VENDOR)      # chemin offline
    src = 'vendoré'
else:
    model = StaticModel.from_pretrained(REMOTE)      # 1er appel : télécharge…
    try:
        model.save_pretrained(VENDOR)                # …puis on le fige localement
        src = 'téléchargé + vendoré'
    except Exception:
        src = 'téléchargé (non vendoré)'

texts = json.load(sys.stdin)
vecs = model.encode(texts)
print(json.dumps({"vectors": [[float(x) for x in v] for v in vecs],
                  "dim": int(vecs.shape[1]), "model": REMOTE, "source": src}))
