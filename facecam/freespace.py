#!/usr/bin/env python3
# ============================================================================
# facecam/freespace.py — OÙ EST LE VIDE ? (mesure, jamais au jugé)
#
# Échantillonne N frames sur une fenêtre [t0,t1] d'une vidéo et mesure la boîte
# réellement OCCUPÉE par la personne (visage mediapipe + corps/épaules pose
# mediapipe si le modèle est là), en PIRE CAS sur toute la fenêtre : un overlay
# calé sur le pire cas ne chevauche jamais le sujet, et ne « flippe » pas de
# côté d'un plan à l'autre (stabilité > optimalité).
#
# Usage : freespace.py <video> <t0> <t1> [--n 24] [--margin 0.02] [--json out]
# Sortie: JSON { frames:[…], occupied:{x0,x1,y0,y1} (norm + px), free:{left,right},
#                side:"left"|"right", safe:{x,y,w,h} en px }
#   side = côté LIBRE recommandé (le plus large), safe = rectangle utilisable.
# 100% offline (modèles .task locaux).
# ============================================================================
import sys, json, os
import numpy as np, cv2, mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision

args = [a for a in sys.argv[1:]]
def opt(name, default=None, cast=str):
    if name in args:
        i = args.index(name); v = args[i + 1]; del args[i:i + 2]; return cast(v)
    return default
n      = opt('--n', 24, int)
margin = opt('--margin', 0.02, float)   # marge de sécurité, en fraction de largeur
outj   = opt('--json', None, str)
video, t0, t1 = args[0], float(args[1]), float(args[2])

HERE   = os.path.dirname(os.path.abspath(__file__))
MODELS = os.path.join(HERE, '..', 'models')
FACE   = os.path.join(MODELS, 'face_landmarker.task')
POSE   = os.path.join(MODELS, 'pose_landmarker_lite.task')

face_lm = vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(
    base_options=python.BaseOptions(model_asset_path=FACE),
    output_face_blendshapes=False, output_facial_transformation_matrixes=False,
    num_faces=1, running_mode=vision.RunningMode.IMAGE))
pose_lm = None
if os.path.exists(POSE):
    pose_lm = vision.PoseLandmarker.create_from_options(vision.PoseLandmarkerOptions(
        base_options=python.BaseOptions(model_asset_path=POSE),
        num_poses=1, running_mode=vision.RunningMode.IMAGE))

cap = cv2.VideoCapture(video)
W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)); H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
times = [t0 + (t1 - t0) * i / max(1, n - 1) for i in range(n)]

frames, X0, X1, Y0, Y1 = [], [], [], [], []
for t in times:
    cap.set(cv2.CAP_PROP_POS_MSEC, max(0.0, t) * 1000.0)
    ok, frame = cap.read()
    if not ok:
        frames.append({"t": round(t, 3), "ok": False}); continue
    img = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
    rec = {"t": round(t, 3), "ok": True, "face": False, "pose": False}
    xs, ys = [], []
    fr = face_lm.detect(img)
    if fr.face_landmarks:
        rec["face"] = True
        fx = [p.x for p in fr.face_landmarks[0]]; fy = [p.y for p in fr.face_landmarks[0]]
        rec["faceBox"] = [round(min(fx), 4), round(max(fx), 4), round(min(fy), 4), round(max(fy), 4)]
        xs += fx; ys += fy
    if pose_lm is not None:
        pr = pose_lm.detect(img)
        if pr.pose_landmarks:
            # on ne garde que les points VISIBLES et dans le cadre (les jambes
            # extrapolées hors champ par mediapipe fausseraient la boîte)
            px = [p.x for p in pr.pose_landmarks[0]
                  if getattr(p, 'visibility', 1) > 0.6 and -0.02 <= p.x <= 1.02 and -0.02 <= p.y <= 1.02]
            py = [p.y for p in pr.pose_landmarks[0]
                  if getattr(p, 'visibility', 1) > 0.6 and -0.02 <= p.x <= 1.02 and -0.02 <= p.y <= 1.02]
            if px:
                rec["pose"] = True
                rec["poseBox"] = [round(min(px), 4), round(max(px), 4), round(min(py), 4), round(max(py), 4)]
                xs += px; ys += py
    if xs:
        X0.append(min(xs)); X1.append(max(xs)); Y0.append(min(ys)); Y1.append(max(ys))
    frames.append(rec)
cap.release()

if not X0:
    print(json.dumps({"error": "aucun sujet détecté sur la fenêtre", "frames": frames})); sys.exit(2)

# PIRE CAS sur la fenêtre (l'overlay doit tenir sur TOUTE la durée)
ox0, ox1 = min(X0), max(X1)
oy0, oy1 = min(Y0), max(Y1)
free_left, free_right = ox0, 1.0 - ox1
free_top, free_bottom = oy0, 1.0 - oy1
side = "left" if free_left > free_right else "right"
if side == "left":
    sx, sw = margin, max(0.0, free_left - 2 * margin)
else:
    sx, sw = ox1 + margin, max(0.0, free_right - 2 * margin)

res = {
    "video": os.path.basename(video), "window": [t0, t1], "n": n, "size": [W, H],
    "poseModel": bool(pose_lm),
    "occupied": {"norm": [round(ox0, 4), round(ox1, 4), round(oy0, 4), round(oy1, 4)],
                 "px": [round(ox0 * W), round(ox1 * W), round(oy0 * H), round(oy1 * H)]},
    # 3 emplacements possibles, en PIXELS : deux colonnes + un BANDEAU LARGE en haut.
    # Le format de l'overlay se choisit là-dedans (un tracé d'itinéraire est vertical
    # → colonne ; un chiffre est horizontal → bandeau), jamais par habitude.
    "free": {"left": round(free_left, 4), "right": round(free_right, 4),
             "top": round(free_top, 4), "bottom": round(free_bottom, 4)},
    "bandes_px": {"gauche": round(free_left * W), "droite": round(free_right * W),
                  "haut": round(free_top * H), "bas": round(free_bottom * H)},
    "side": side,
    "safe": {"x": round(sx * W), "y": round(margin * H), "w": round(sw * W), "h": round((1 - 2 * margin) * H)},
    "frames": frames,
}
print(json.dumps(res, indent=1))
if outj:
    open(outj, 'w').write(json.dumps(res, indent=1))
