#!/usr/bin/env python3
# =============================================================================
# gate.py — LA GATE DE CLÔTURE D'UN MASTER, mesurée et rejouable.
#
# À lancer avec l'interpréteur du venv vision (numpy) :
#   "$HOME/Library/Application Support/Montage/.venv-vision/bin/python" gate.py <master.mp4>
#        [--ref-audio vlog/work/_raw_a.m4a] [--plan vlog/vlog.plan.json]
#        [--compare "<autre master>"] [--rapide]
#
# POURQUOI CE FICHIER EXISTE (31/07). La gate du master 1080p a été passée à la main :
# une dizaine de commandes ffmpeg/ffprobe et deux tranchages numpy tapés dans le terminal.
# Au master suivant (le 4K), plus rien n'était rejouable — et c'est justement une gate,
# donc la seule chose qui décide si on livre. Trois fois sur ce projet une SONDE DE
# COMMODITÉ a fabriqué une panne (`-ss` avant `-i`, `astats reset=`, `volumedetect` avec
# `-ss` après `-i`). Les mesures ci-dessous décodent donc le fichier EN ENTIER et
# tranchent dans numpy — c'est la seule méthode qui ait tenu.
#
# Ce que ça mesure, dans l'ordre de la gate :
#   1. définition · images == durée × fps EXACTEMENT · avg_frame_rate · start_time
#   2. dérive A/V (durée du FLUX vidéo contre durée du FLUX audio)
#   3. écart au plan (vlog.plan.json)
#   4. SYNCHRO RÉELLE par corrélation croisée contre le son d'origine, ≥ 7 fenêtres
#   5. loudness intégré · vrai pic · LRA
#   6. équilibre parole / image (LUFS des blocs facecam contre les bandes paysage)
#   7. fondu de sortie, mesuré par décodage intégral
#   8. décodage intégral sans erreur
# =============================================================================
import argparse, json, os, re, subprocess, sys, tempfile
import numpy as np

FF = 'ffmpeg'
FP = 'ffprobe'


def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, **kw)


def probe(path, stream, entries):
    r = run([FP, '-v', 'error', '-select_streams', stream, '-show_entries', entries,
             '-of', 'json', path])
    return json.loads(r.stdout or '{}')


def frame_count(path):
    """Le COMPTE D'IMAGES, seule mesure exacte — le champ `duration` d'un conteneur ne
    l'est pas (un mp4 déclare n/fps, un mpegts (n-1)/fps : piège payé le 31/07)."""
    r = run([FP, '-v', 'error', '-select_streams', 'v:0', '-count_packets',
             '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0', path])
    return int(r.stdout.strip())


def decode_audio(path, sr=8000):
    """Décodage INTÉGRAL en mono float32. Pas de `-ss`, pas de fenêtre : on tranche après,
    dans numpy. C'est la parade aux trois fausses pannes de ce projet."""
    r = subprocess.run([FF, '-v', 'error', '-i', path, '-vn', '-map', '0:a:0',
                        '-ac', '1', '-ar', str(sr), '-f', 'f32le', '-'],
                       capture_output=True)
    return np.frombuffer(r.stdout, dtype=np.float32), sr


def envelope(x, sr, ms=1):
    """Enveloppe d'énergie à `ms` — c'est elle qu'on corrèle, pas la forme d'onde :
    deux encodages AAC ne sont jamais identiques échantillon par échantillon."""
    n = max(1, int(sr * ms / 1000))
    m = (len(x) // n) * n
    return np.abs(x[:m]).reshape(-1, n).mean(axis=1), 1000.0 / ms


def lag_ms(a, b, sr_env, max_ms=400):
    """Décalage de `a` par rapport à `b`, par corrélation croisée en FFT."""
    a = a - a.mean()
    b = b - b.mean()
    n = 1 << int(np.ceil(np.log2(len(a) + len(b))))
    c = np.fft.irfft(np.fft.rfft(a, n) * np.conj(np.fft.rfft(b, n)), n)
    c = np.concatenate([c[-max_ms:], c[:max_ms + 1]])
    return int(np.argmax(c)) - max_ms


def loudness(path, af=None):
    """loudnorm en analyse seule → LUFS intégré, vrai pic, LRA."""
    cmd = [FF, '-v', 'info', '-i', path, '-vn']
    if af:
        cmd += ['-af', af + ',loudnorm=I=-14:TP=-1:LRA=11:print_format=json']
    else:
        cmd += ['-af', 'loudnorm=I=-14:TP=-1:LRA=11:print_format=json']
    cmd += ['-f', 'null', '-']
    r = run(cmd)
    m = re.search(r'\{[^{}]*"input_i"[^{}]*\}', r.stderr, re.S)
    if not m:
        return None
    d = json.loads(m.group(0))
    return float(d['input_i']), float(d['input_tp']), float(d['input_lra'])


def db(x):
    return 20 * np.log10(max(float(np.sqrt(np.mean(x ** 2))), 1e-12))


def main():
    p = argparse.ArgumentParser()
    p.add_argument('master')
    p.add_argument('--ref-audio', default=None, help="son d'origine de l'assemblage (_raw_a.m4a)")
    p.add_argument('--plan', default=None, help='vlog/vlog.plan.json')
    p.add_argument('--fps', type=float, default=30.0)
    p.add_argument('--rapide', action='store_true', help='saute le décodage vidéo intégral')
    a = p.parse_args()
    M = a.master
    ok = True
    print(f'\n══════ GATE — {os.path.basename(M)} ══════\n')

    # 1. forme du fichier -----------------------------------------------------
    v = probe(M, 'v:0', 'stream=width,height,avg_frame_rate,start_time,duration,bit_rate,codec_name')['streams'][0]
    au = probe(M, 'a:0', 'stream=codec_name,sample_rate,channels,duration,bit_rate')['streams'][0]
    n = frame_count(M)
    dur_img = n / a.fps
    size = os.path.getsize(M)
    print(f'définition        : {v["width"]}×{v["height"]}  ({v["codec_name"]})')
    print(f'images · durée    : {n} images → {dur_img:.6f} s')
    print(f'avg_frame_rate    : {v["avg_frame_rate"]}' + ('  ✅' if v['avg_frame_rate'] == f'{int(a.fps)}/1' else '  ❌'))
    ok &= v['avg_frame_rate'] == f'{int(a.fps)}/1'
    st = float(v.get('start_time', 0))
    print(f'start_time vidéo  : {st:.6f} s' + ('  ✅' if abs(st) < 1e-6 else '  ❌'))
    ok &= abs(st) < 1e-6
    print(f'poids · débit     : {size/1e9:.2f} Go · {int(v.get("bit_rate",0))/1e6:.1f} Mb/s vidéo'
          f' · {int(au.get("bit_rate",0))/1e3:.0f} kb/s {au["codec_name"]} {au["sample_rate"]} Hz {au["channels"]}ch')

    # 2. dérive A/V ------------------------------------------------------------
    dv, da = float(v.get('duration', 0)), float(au.get('duration', 0))
    drift = abs(da - dv)
    print(f'dérive A/V        : {drift*1000:.0f} ms  (vidéo {dv:.3f} s · audio {da:.3f} s)'
          + ('  ✅' if drift < 0.100 else '  ❌'))
    ok &= drift < 0.100

    # 3. écart au plan ---------------------------------------------------------
    if a.plan and os.path.exists(a.plan):
        plan = json.load(open(a.plan))
        pieces = plan if isinstance(plan, list) else plan.get('pieces', plan.get('timeline', []))
        total = sum(float(x.get('dur', x.get('duration', 0))) for x in pieces)
        print(f'écart au plan     : {dur_img-total:+.2f} s  (plan {total:.2f} s)'
              + ('  ✅' if abs(dur_img - total) < 0.05 else '  ❌'))
        ok &= abs(dur_img - total) < 0.05

    # 4. synchro réelle --------------------------------------------------------
    if a.ref_audio and os.path.exists(a.ref_audio):
        x, sr = decode_audio(M)
        y, _ = decode_audio(a.ref_audio)
        ex, fe = envelope(x, sr)
        ey, _ = envelope(y, sr)
        print('\nsynchro (corrélation croisée contre le son d\'origine, enveloppe 1 ms, fenêtres 30 s)')
        lags = []
        for t in (60, 120, 240, 360, 480, 600, 700):
            i0, i1 = int(t * fe), int((t + 30) * fe)
            if i1 > len(ex) or i1 > len(ey):
                continue
            L = lag_ms(ex[i0:i1], ey[i0:i1], fe)
            lags.append(L)
            print(f'  t={t:>3} s : {L:+d} ms' + ('  ✅' if abs(L) <= 1 else '  ❌'))
        ok &= bool(lags) and max(abs(l) for l in lags) <= 1
        print(f'  → {len(lags)} fenêtres, pire cas {max((abs(l) for l in lags), default=0)} ms')
    else:
        x, sr = decode_audio(M)

    # 5. loudness --------------------------------------------------------------
    lo = loudness(M)
    if lo:
        I, TP, LRA = lo
        print(f'\nloudness          : {I:.1f} LUFS' + ('  ✅' if abs(I + 14) <= 0.5 else '  ❌')
              + f' · vrai pic {TP:.1f} dBTP' + ('  ✅' if TP <= -1.0 else '  ⚠️')
              + f' · LRA {LRA:.1f}')
        ok &= abs(I + 14) <= 0.5

    # 6. équilibre parole / image ---------------------------------------------
    if a.plan and os.path.exists(a.plan):
        plan = json.load(open(a.plan))
        pieces = plan if isinstance(plan, list) else plan.get('pieces', plan.get('timeline', []))
        t = 0.0
        spans = {'F': [], 'L': []}
        for pc in pieces:
            d = float(pc.get('dur', pc.get('duration', 0)))
            k = pc.get('kind', 'L')
            parle = bool(pc.get('parle'))
            spans['F' if (k == 'F' or parle) else 'L'].append((t, t + d))
            t += d
        res = {}
        for k, sp in spans.items():
            sel = '+'.join(f'between(t,{s:.3f},{e:.3f})' for s, e in sp)
            r = loudness(M, af=f"aselect='{sel}',asetpts=N/SR/TB")
            res[k] = r[0] if r else None
        if res['F'] is not None and res['L'] is not None:
            ecart = abs(res['F'] - res['L'])
            print(f'équilibre         : parole {res["F"]:.1f} LUFS · image {res["L"]:.1f} LUFS'
                  f' → {ecart:.1f} LU' + ('  ✅' if ecart <= 1.0 else '  ❌'))
            ok &= ecart <= 1.0

    # 7. fondu de sortie -------------------------------------------------------
    print('\nfondu de sortie (RMS par fenêtre de 1 s, décodage intégral)')
    T = len(x) / sr
    for t in [T - 20, T - 12, T - 8, T - 5, T - 3, T - 1.5]:
        i0, i1 = int(max(0, t) * sr), int(min(T, t + 1) * sr)
        print(f'  {t:7.1f} s : {db(x[i0:i1]):6.1f} dB')
    fin = db(x[int((T - 0.5) * sr):])
    print(f'  dernière demi-seconde : {fin:.1f} dB' + ('  ✅' if fin < -40 else '  ❌'))
    ok &= fin < -40

    # 8. décodage intégral -----------------------------------------------------
    if not a.rapide:
        r = run([FF, '-v', 'error', '-i', M, '-f', 'null', '-'])
        errs = [l for l in r.stderr.splitlines() if l.strip()]
        print(f'\ndécodage intégral : {len(errs)} erreur(s)' + ('  ✅' if not errs else '  ❌'))
        for l in errs[:10]:
            print('   ', l)
        ok &= not errs

    print(f'\n══════ {"✅ GATE PASSÉE" if ok else "❌ GATE ÉCHOUÉE"} ══════\n')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
