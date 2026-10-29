#!/usr/bin/env python3
# ============================================================================
# facecam/parole.py — détecteur de VOYELLE TENUE (« euhhh ») par la MESURE.
#
# Pourquoi pas whisper : un « euh » collé à la parole (« de ce fait euhhh bah
# l'État… ») n'est pas un burst séparé, et whisper l'écrit « … » ou l'efface.
# Ce qui le distingue physiquement d'une syllabe, c'est qu'il ne s'ARTICULE
# pas : ses formants ne bougent pas. On mesure donc la STABILITÉ SPECTRALE.
#
# Un « euh » = une plage où, simultanément :
#   · l'énergie est celle de la parole (pas un silence)          -> seuil relatif
#   · le spectre ne bouge quasiment plus (cos(trame_n, trame_n-1) élevé)
#   · ça dure                                                     -> >= MIN_DUR
# Aucun de ces trois signaux ne peut halluciner.
#
# Usage: parole.py <wav 16k mono> [--min 0.30] [--sim 0.985] [--json]
# Sortie: une ligne par plage « a b duree similarite » (ou du JSON).
# ============================================================================
import sys, json, wave, math
import numpy as np

DENSITY = 0.80      # part de trames conformes exigée dans une plage
MAX_HOLE = 0.08     # trou toléré (s) — une plosive/attaque dure 20-60 ms

def read_wav(path):
    with wave.open(path, 'rb') as w:
        assert w.getsampwidth() == 2, 'attendu PCM 16 bits'
        sr = w.getframerate()
        x = np.frombuffer(w.readframes(w.getnframes()), dtype='<i2').astype(np.float32) / 32768.0
        if w.getnchannels() > 1:
            x = x.reshape(-1, w.getnchannels()).mean(axis=1)
    return x, sr

def spectra(x, sr, win=0.032, hop=0.010):
    n = int(round(win * sr)); h = int(round(hop * sr))
    if len(x) < n:
        return np.zeros((0, n // 2 + 1)), h / sr
    w = np.hanning(n).astype(np.float32)
    idx = np.arange(0, len(x) - n + 1, h)
    frames = np.stack([x[i:i + n] * w for i in idx])
    mag = np.abs(np.fft.rfft(frames, axis=1))
    return mag, h / sr

def detect(path, min_dur=0.30, sim_thr=0.985, floor_db=-32.0):
    x, sr = read_wav(path)
    mag, hop = spectra(x, sr)
    if len(mag) < 3:
        return []
    energy = mag.sum(axis=1) + 1e-12
    edb = 20 * np.log10(energy / energy.max())
    # similarité cosinus entre trames voisines, sur le spectre en amplitude
    a, b = mag[1:], mag[:-1]
    cos = (a * b).sum(axis=1) / (np.linalg.norm(a, axis=1) * np.linalg.norm(b, axis=1) + 1e-12)
    ok = (cos > sim_thr) & (edb[1:] > floor_db)
    # ⭐ DENSITÉ, PAS CONTINUITÉ (leçon vad.py du 01/09, repayée ici) : une voyelle tenue
    # n'est pas un plateau parfait — quelques trames plongent sous le seuil et une
    # exigence de continuité stricte la fragmente en morceaux trop courts pour être vus.
    # Mesuré sur le « euh » de deconcentration-economique : sim moyenne 0.9913, donc
    # AU-DESSUS du seuil, et pourtant invisible en continuité stricte. On tolère un trou
    # tant que la plage reste dense.
    runs, i, n = [], 0, len(ok)
    while i < n:
        if not ok[i]:
            i += 1; continue
        j = i; last = i; nok = 1
        while j + 1 < n:
            cand = j + 1
            span = cand - i + 1
            hit = nok + (1 if ok[cand] else 0)
            if hit / span < DENSITY and (cand - last) * hop > MAX_HOLE:
                break
            j = cand
            if ok[cand]:
                nok += 1; last = cand
        j = last                      # la plage finit sur une trame CONFORME, pas sur un trou
        d = (j - i + 1) * hop
        if d >= min_dur:
            runs.append({'a': round((i + 1) * hop, 3), 'b': round((j + 2) * hop, 3),
                         'dur': round(d, 3), 'sim': round(float(cos[i:j + 1].mean()), 4)})
        i = j + 1
    return runs

if __name__ == '__main__':
    args = sys.argv[1:]
    if not args:
        print('usage: parole.py <wav> [--min 0.30] [--sim 0.985] [--json]', file=sys.stderr)
        sys.exit(2)
    gf = lambda k, d: float(args[args.index(k) + 1]) if k in args else d
    runs = detect(args[0], gf('--min', 0.30), gf('--sim', 0.985))
    if '--json' in args:
        print(json.dumps(runs))
    else:
        for r in runs:
            print(f"{r['a']:.3f} {r['b']:.3f} {r['dur']:.3f} {r['sim']:.4f}")
