#!/usr/bin/env python3
"""Sonde offline des signaux VIDÉO du sélecteur de prises (API Tasks FaceLandmarker).
Prouve sur le vrai visage du monteur, sans réseau (modèle .task local) :
  - présence visage + pose de tête (yaw/pitch/roll) -> "tête bouge trop"
  - clignement / yeux fermés (blendshapes eyeBlink)
  - REGARD (blendshapes eyeLook In/Out/Up/Down) -> "yeux dans le vide" vs caméra
  - ouverture bouche (jawOpen) -> parle / bouche fermée (bruit cross-modal)
Usage: facemesh_probe.py <image> [modele.task]
"""
import sys, math, numpy as np, mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision

img_path = sys.argv[1]
model = sys.argv[2] if len(sys.argv) > 2 else "face_landmarker.task"
opts = vision.FaceLandmarkerOptions(
    base_options=python.BaseOptions(model_asset_path=model),
    output_face_blendshapes=True,
    output_facial_transformation_matrixes=True,
    num_faces=1,
    running_mode=vision.RunningMode.IMAGE)
lm = vision.FaceLandmarker.create_from_options(opts)
res = lm.detect(mp.Image.create_from_file(img_path))

if not res.face_landmarks:
    print("visages détectés : 0"); sys.exit(1)

bs = {c.category_name: c.score for c in res.face_blendshapes[0]}
g = lambda k: bs.get(k, 0.0)

# pose de tête depuis la matrice de transformation (rotation 3x3 -> euler deg)
M = np.array(res.facial_transformation_matrixes[0]).reshape(4, 4)
R = M[:3, :3]
yaw   = math.degrees(math.atan2(-R[2, 0], math.hypot(R[0, 0], R[1, 0])))
pitch = math.degrees(math.atan2(R[2, 1], R[2, 2]))
roll  = math.degrees(math.atan2(R[1, 0], R[0, 0]))

blink = max(g("eyeBlinkLeft"), g("eyeBlinkRight"))
gaze  = max(g("eyeLookInLeft"), g("eyeLookOutLeft"), g("eyeLookUpLeft"), g("eyeLookDownLeft"),
            g("eyeLookInRight"), g("eyeLookOutRight"), g("eyeLookUpRight"), g("eyeLookDownRight"))
jaw   = g("jawOpen")

print("visages détectés : 1   (FaceLandmarker, modèle .task local, on-device)")
print(f"  pose tête : yaw={yaw:+.1f}° pitch={pitch:+.1f}° roll={roll:+.1f}°"
      f"   -> {'DE FACE' if abs(yaw)<12 and abs(pitch)<12 else 'de trois-quarts / penché'}")
print(f"  yeux (blink {blink:.2f})        -> {'OUVERTS' if blink<0.5 else 'FERMES/clignement'}")
print(f"  regard (déviation {gaze:.2f})   -> {'vers camera' if gaze<0.35 else 'DE COTE / dans le vide'}")
print(f"  bouche (jawOpen {jaw:.2f})      -> {'parle/ouverte' if jaw>0.15 else 'fermee'}")
print(f"  (478 landmarks + {len(bs)} blendshapes dispo -> tous les signaux vidéo mesurables)")
