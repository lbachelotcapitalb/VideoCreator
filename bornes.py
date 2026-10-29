#!/usr/bin/env python3
# bornes.py — relève les FRONTIÈRES de plans d'un rendu BROUILLON, image par image.
#
# Pourquoi cet outil existe (30/08) : le monteur dicte ses coupes en lisant le TIMECODE GRAVÉ du
# brouillon (« R13 finit à 29:00 »). Pour convertir en fenêtre source il faut savoir où chaque
# plan COMMENCE dans la timeline — et cette mesure ne se déduit pas du plan.txt (les segments
# gagnent/perdent une frame à l'encodage).
#
# ⚠ NE PAS mesurer une frontière avec `ffmpeg -ss <t>` : le seek retombe sur une keyframe et le
# pts affiché ne correspond plus à l'image rendue (vécu le 30/08 : R24 montré 0,4 s après sa fin,
# j'ai failli corriger des bornes justes). Ici on lit les frames DANS L'ORDRE, sans seek.
#
# Méthode : masque du JAUNE du badge R## (drawtext fontcolor=yellow sur boîte noire à 78 %) dans
# le coin haut-gauche ; une frontière = le masque change franchement d'une frame à l'autre.
# Le fond transparaît à travers la boîte → il reste du bruit à l'intérieur d'un plan : ce sont les
# valeurs ISOLÉES qui font foi, pas les rafales à 1/30 s d'intervalle.
#
#   .venv-vision/bin/python bornes.py "<rendu brouillon.mp4>" [...]
#
# Exige un rendu en `qualite.txt = brouillon` ET `reperes.txt = on` (sinon aucun badge à lire).
import cv2, numpy as np, sys

def frontieres(path, fps=30.0):
    cap = cv2.VideoCapture(path); prev = None; out = []; i = 0
    while True:
        ok, fr = cap.read()
        if not ok: break
        roi = fr[14:76, 16:130]                      # la boîte du badge R##, en BGR
        b, g, r = roi[:, :, 0].astype(int), roi[:, :, 1].astype(int), roi[:, :, 2].astype(int)
        mask = ((r > 150) & (g > 130) & (b < 110)).astype(np.uint8)
        if prev is not None:
            d = int(np.abs(mask.astype(int) - prev.astype(int)).sum())
            if d > 60: out.append((i, i / fps, d))
        prev = mask; i += 1
    cap.release(); return out, i

if __name__ == '__main__':
    for p in sys.argv[1:]:
        f, n = frontieres(p)
        print(f"== {p.split('/')[-1]}  ({n} frames = {n/30:.2f} s)")
        print("   ", " ".join(f"{t:.3f}" for _, t, _ in f))
