#!/usr/bin/env python3
# ============================================================================
# facecam/pose_at.py — pose de tête à des INSTANTS précis, en BATCH.
# Un seul chargement du modèle pour N timestamps (le rechargement par appel
# était le coût dominant). Sert au régulateur anti-sur-découpe : comparer la
# pose de part et d'autre d'un raccord pour détecter un SAUT de position.
#
# Usage : pose_at.py <video> <t1,t2,t3,...> [model.task]
# Sortie: JSON {"poses":[{"t":..,"face":bool,"yaw":..,"pitch":..,"roll":..,
#                         "cx":..,"cy":..,"size":..}, ...]}
#   yaw/pitch/roll en degrés ; cx/cy = centre du visage normalisé (0..1) ;
#   size = largeur du visage normalisée (proxy de distance à la caméra).
# 100% offline (modèle .task local).
# ============================================================================
import sys, json, math, os
import numpy as np, cv2, mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision

video = sys.argv[1]
times = [float(x) for x in sys.argv[2].split(',') if x.strip() != '']
model = sys.argv[3] if len(sys.argv) > 3 else os.path.join(os.path.dirname(__file__), '..', 'models', 'face_landmarker.task')

lm = vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(
    base_options=python.BaseOptions(model_asset_path=model),
    output_face_blendshapes=False, output_facial_transformation_matrixes=True,
    num_faces=1, running_mode=vision.RunningMode.IMAGE))

cap = cv2.VideoCapture(video)
out = []
for t in times:
    cap.set(cv2.CAP_PROP_POS_MSEC, max(0.0, t) * 1000.0)
    ok, frame = cap.read()
    if not ok:
        out.append({"t": t, "face": False}); continue
    res = lm.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)))
    if not res.face_landmarks:
        out.append({"t": t, "face": False}); continue
    M = np.array(res.facial_transformation_matrixes[0]).reshape(4, 4)[:3, :3]
    pts = res.face_landmarks[0]
    xs = [p.x for p in pts]; ys = [p.y for p in pts]
    out.append({
        "t": t, "face": True,
        "yaw":   round(math.degrees(math.atan2(-M[2, 0], math.hypot(M[0, 0], M[1, 0]))), 2),
        "pitch": round(math.degrees(math.atan2(M[2, 1], M[2, 2])), 2),
        "roll":  round(math.degrees(math.atan2(M[1, 0], M[0, 0])), 2),
        "cx": round(float(np.mean(xs)), 4), "cy": round(float(np.mean(ys)), 4),
        "size": round(float(max(xs) - min(xs)), 4),
    })
cap.release()
print(json.dumps({"video": os.path.basename(video), "poses": out}))
