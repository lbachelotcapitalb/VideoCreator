#!/usr/bin/env python3
# ============================================================================
# best-take/score_video.py — BRIQUE ISOLÉE (étage 2, signaux VIDÉO).
# Généralise facemesh_probe (1 frame) : note une PLAGE [a,b] d'un rush en
# échantillonnant des frames et en agrégeant les signaux de qualité de prise :
#   - head_stability  : 1 = tête immobile ; ↓ si ça bouge (std pose + centre)
#   - eyes_open_ratio : part de frames yeux ouverts (anti "yeux fermés")
#   - gaze_ratio      : part de frames regard vers caméra (anti "yeux dans le vide")
#   - mouth_activity  : jawOpen moyen (parle vs bouche fermée)
#   - face_ratio      : part de frames avec visage détecté
# Sort du JSON pur (stdout) → consommable par le scoreur best-take (plus tard),
# se branchera sur l'EDL unifiée facecam. Ne touche à AUCUN autre module.
# 100% offline (modèle .task local). Aucun poids figé ici : on sort les signaux
# BRUTS, la pondération (λ softcodés) est décidée en aval.
#
# Usage: score_video.py <video> <a_sec> <b_sec> [step_sec=0.3] [model.task]
# ============================================================================
import sys, json, math, statistics as st, numpy as np, cv2, mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision

video = sys.argv[1]
a, b = float(sys.argv[2]), float(sys.argv[3])
step = float(sys.argv[4]) if len(sys.argv) > 4 else 0.3
model = sys.argv[5] if len(sys.argv) > 5 else \
    __import__("os").path.join(__import__("os").path.dirname(__file__), "..", "models", "face_landmarker.task")

lm = vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(
    base_options=python.BaseOptions(model_asset_path=model),
    output_face_blendshapes=True, output_facial_transformation_matrixes=True,
    num_faces=1, running_mode=vision.RunningMode.IMAGE))

cap = cv2.VideoCapture(video)
yaws, pits, rolls, cxs, cys = [], [], [], [], []
open_n = gaze_n = jaw_sum = face_n = total = 0
t = a
while t < b:
    cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000.0)
    ok, frame = cap.read()
    if not ok:
        break
    total += 1
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    res = lm.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))
    if res.face_landmarks:
        face_n += 1
        bs = {c.category_name: c.score for c in res.face_blendshapes[0]}
        g = lambda k: bs.get(k, 0.0)
        M = np.array(res.facial_transformation_matrixes[0]).reshape(4, 4)[:3, :3]
        yaws.append(math.degrees(math.atan2(-M[2, 0], math.hypot(M[0, 0], M[1, 0]))))
        pits.append(math.degrees(math.atan2(M[2, 1], M[2, 2])))
        rolls.append(math.degrees(math.atan2(M[1, 0], M[0, 0])))
        nose = res.face_landmarks[0][1]      # bout du nez = repère de position tête
        cxs.append(nose.x); cys.append(nose.y)
        if max(g("eyeBlinkLeft"), g("eyeBlinkRight")) < 0.5:
            open_n += 1
        dev = max(g("eyeLookInLeft"), g("eyeLookOutLeft"), g("eyeLookUpLeft"), g("eyeLookDownLeft"),
                  g("eyeLookInRight"), g("eyeLookOutRight"), g("eyeLookUpRight"), g("eyeLookDownRight"))
        if dev < 0.35:
            gaze_n += 1
        jaw_sum += g("jawOpen")
    t += step
cap.release()

def sd(x): return st.pstdev(x) if len(x) > 1 else 0.0
# stabilité tête : combine dispersion angulaire (deg) et positionnelle (norm), bornée 0..1
ang = sd(yaws) + sd(pits) + sd(rolls)                 # deg cumulés
pos = (sd(cxs) + sd(cys)) * 100                        # ~ % de largeur
stability = max(0.0, 1.0 - (ang / 30.0) - (pos / 10.0))

out = {
    "video": video.split("/")[-1], "a": a, "b": b, "frames": total, "faces": face_n,
    "signals": {
        "face_ratio":      round(face_n / total, 3) if total else 0,
        "head_stability":  round(stability, 3),
        "head_std_deg":    round(ang, 2),
        "eyes_open_ratio": round(open_n / face_n, 3) if face_n else 0,
        "gaze_ratio":      round(gaze_n / face_n, 3) if face_n else 0,
        "mouth_activity":  round(jaw_sum / face_n, 3) if face_n else 0,
    }
}
print(json.dumps(out, ensure_ascii=False))
