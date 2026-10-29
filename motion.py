#!/usr/bin/env python3
"""Trajectoire caméra dans le TEMPS (ce que curate.mjs ne donne pas : il rend des agrégats —
amplitude, vitesse max, nb d'allers-retours — jamais la courbe).
Corrélation de phase de CHAQUE image contre l'image 0 (et non contre la précédente : un
panoramique lent bouge < 1 px/image et se lit 0 en différentiel), luma 640x360, pic raffiné
au sous-pixel. Répond à « commence déjà en mouvement » / « coupe à la fin du mouvement »."""
import subprocess, sys, numpy as np, os
W,H = 640,360
def flux(f):
    raw = subprocess.run(['ffmpeg','-v','error','-i',f,'-vf',f'scale={W}:{H}','-pix_fmt','gray',
                          '-f','rawvideo','-'],capture_output=True).stdout
    n = len(raw)//(W*H)
    return np.frombuffer(raw[:n*W*H],dtype=np.uint8).reshape(n,H,W).astype(np.float32)
def sub(c, p, ax):
    n = c.shape[ax]; i = p[ax]
    a,b,d = c[(p[0]-1)%n if ax==0 else p[0], (p[1]-1)%c.shape[1] if ax==1 else p[1]], c[p], \
            c[(p[0]+1)%n if ax==0 else p[0], (p[1]+1)%c.shape[1] if ax==1 else p[1]]
    den = (a - 2*b + d)
    off = 0.0 if den==0 else 0.5*(a-d)/den
    v = i + np.clip(off,-1,1)
    return v - n if v > n/2 else v
def decal(ref, im):
    A,B = np.fft.rfft2(ref), np.fft.rfft2(im)
    R = A*np.conj(B); m=np.abs(R); m[m==0]=1
    c = np.fft.irfft2(R/m, s=ref.shape)
    p = np.unravel_index(np.argmax(c), c.shape)
    return sub(c,p,1), sub(c,p,0)          # dx, dy
def profil(f, fps=30.0, larg_src=3840):
    v = flux(f); k = larg_src/W
    # DIFFÉRENTIEL (image i contre i-1) puis intégration : robuste aux grands déplacements,
    # là où la corrélation contre l'image 0 décroche dès que le recouvrement devient faible
    # (vécu : R09 rendait une vitesse médiane de 3635 px/s sur un cadre large de 3840).
    d = np.array([(0.0,0.0)] + [decal(v[i-1], v[i]) for i in range(1,len(v))]) * k
    vit = np.hypot(d[:,0], d[:,1]) * fps
    tr = np.cumsum(d, axis=0)
    return tr, vit, len(v)
if __name__=='__main__':
    f=sys.argv[1]; lab=sys.argv[2] if len(sys.argv)>2 else os.path.basename(f)
    tr,vit,n = profil(f); fps=30.0
    liss = np.convolve(vit, np.ones(7)/7, mode='same') if len(vit)>=7 else vit
    amp = np.hypot(tr[:,0]-tr[0,0], tr[:,1]-tr[0,1])
    seuil = max(0.12*liss.max(), 15.0)
    en = liss > seuil
    print(f"\n### {lab} — {n} img ({n/fps:.2f} s) · déplacement total {amp.max():.0f} px source")
    print(f"{'t':>6} {'vit px/s':>9} {'trajet px':>10}  profil")
    for i in range(0,len(vit),max(1,len(vit)//28)):
        bar='█'*int(min(34, liss[i]/max(1e-6,liss.max())*34))
        print(f"{i/fps:6.2f} {liss[i]:9.0f} {amp[i]:10.0f}  {bar}")
    print(f"→ vit médiane {np.median(liss):.0f} · max {liss.max():.0f} px/s · seuil mouvement {seuil:.0f} px/s")
    if en.any():
        a=np.argmax(en); b=len(en)-1-np.argmax(en[::-1])
        print(f"→ MOUVEMENT de t = {a/fps:.2f} s à t = {b/fps:.2f} s  (avant : {a/fps:.2f} s d'attente · après : {(len(en)-1-b)/fps:.2f} s de pose)")
    else: print("→ aucun mouvement au-dessus du seuil")
