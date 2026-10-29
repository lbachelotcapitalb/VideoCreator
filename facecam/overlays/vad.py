#!/usr/bin/env python3
# ============================================================================
# facecam/overlays/vad.py — OÙ LA VOIX COMMENCE VRAIMENT, mesuré sur le signal
#
# POURQUOI (01/09). le monteur, deux fois de suite sur le VLOG #02 : « le sous-titre est
# déjà là alors que j'ai pas commencé à parler ». La deuxième fois avait raison sur
# un point que le premier audit avait manqué : **whisper ne DATE pas le premier mot,
# il le colle au début du fichier**. Preuve par réfutation — le même bloc précédé de
# 2,000 s de silence NUMÉRIQUE sort quand même « Alors » à 0,000 s, c'est-à-dire dans
# un silence qu'on venait d'ajouter soi-même. Ses timestamps ne sont pas une mesure
# acoustique : il ÉTALE le texte sur la durée qu'on lui donne (sur le #02 : trop tôt
# au début, ~0,9 s trop tard à la fin).
#
# D'où ce module : la seule référence de vérité pour « quand la voix commence » est
# le SIGNAL, pas la transcription. Il sert à recaler les sous-titres et à contrôler
# le parallélisme voix ↔ sous-titre — consigne du monteur : *si tu comprends ce que je
# dis, tu es capable de caler les sous-titres sur mes paroles ; contrôle toujours ce
# parallélisme.*
#
# ⚠️ CE QUI A ÉTÉ PAYÉ EN L'ÉCRIVANT — un seuil calé sur le PLANCHER est faux. La
# première version prenait `p5 + 45 % du contraste`. Sur le cas de validation (le même
# fichier précédé de 2,000 s de silence), elle rendait un écart de 1,00 s au lieu de
# 2,000 : le silence numérique fait tomber le plancher à −180 dB, le contraste explose
# et le seuil s'effondre avec lui. Les deux seuils sont donc calés sur le SOMMET (p95),
# qui est la voix elle-même. *Un instrument se valide sur un décalage CONNU avant de
# servir à mesurer un décalage inconnu* — `--valider` rejoue exactement ce test.
#
# Double seuil (hystérésis), car un seuil unique date l'apex de la voyelle et non
# l'attaque du mot : le seuil HAUT déclenche sur un vrai pic tenu, puis on REMONTE
# en arrière tant qu'on reste au-dessus du seuil BAS.
#
# Usage :
#   python3 vad.py <a.wav> [b.wav …]        → onset + bornes de parole, en JSON
#   python3 vad.py --iles <a.wav>           → toutes les îles de parole
#   python3 vad.py --valider <a.wav>        → rejoue le test du décalage de 2,000 s
#   python3 vad.py --tete <a.wav>           → le BLANC DE TÊTE : combien de temps avant
#                                             que la parole n'attaque, dans ce fichier
# ============================================================================
import json
import subprocess
import sys
import tempfile
import wave

import numpy as np

PAS = 0.02          # 20 ms : plus fin que la plus courte syllabe utile
BANDE = (300, 3400)  # bande téléphonique — la voix, pas le souffle ni le rumble


def energie(path):
    """Énergie en bande vocale, une valeur par fenêtre de 20 ms (dB)."""
    w = wave.open(path)
    sr = w.getframerate()
    a = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(float) / 32768
    if w.getnchannels() > 1:
        a = a.reshape(-1, w.getnchannels()).mean(axis=1)
    win = int(sr * PAS)
    n = len(a) // win
    han = np.hanning(win)
    f = np.fft.rfftfreq(win, 1 / sr)
    band = (f >= BANDE[0]) & (f <= BANDE[1])
    E = np.empty(n)
    for i in range(n):
        p = np.abs(np.fft.rfft(a[i * win:(i + 1) * win] * han)) ** 2
        E[i] = 10 * np.log10(max(p[band].sum(), 1e-18))
    return E


def _seuils(E, haut, bas):
    hi = float(np.percentile(E, 95))
    return hi - haut, hi - bas, hi


def iles(path, haut=12.0, bas=25.0, tenue=0.20, colle=0.25, dens_fen=0.20, dens_min=0.60):
    """Îles de parole : [(début, fin), …]. `colle` fusionne deux îles séparées de
    moins de N s — sans quoi chaque plosive coupe un mot en deux."""
    E = energie(path)
    sh, sb, _ = _seuils(E, haut, bas)
    k = max(1, int(round(tenue / PAS)))
    au = E > sh
    out = []
    for i in range(len(E) - k):
        if au[i:i + k].mean() < 0.8:
            continue
        # ⚠️ LA REMONTÉE SE FAIT SUR UNE DENSITÉ, PAS SUR UNE CONTINUITÉ (01/09).
        # Première version : on remontait tant que la fenêtre précédente dépassait le seuil
        # BAS — donc la PREMIÈRE plosive arrêtait tout, or une plosive dure 20 à 60 ms et
        # plonge sous ce seuil. Mesuré : sur F10 la parole commence à 0,04 s et l'onset était
        # rendu à 0,50 ; sur F23 elle commence à 0,28 s et l'onset était rendu à 1,70. Deux
        # faux « le sous-titre est en avance » — et *un instrument qui se trompe DANS LE SENS
        # DE L'ALERTE fait corriger ce qui n'était pas cassé.*
        #
        # Deuxième version, écartée : tolérer un TROU de longueur fixe. Elle rattrapait F10 et
        # F23 mais faisait remonter F01 jusqu'à 1,64 s, sur un claquement de rue isolé, alors
        # que le monteur n'y parle qu'à partir de 2,66 s. Un trou fixe ne distingue pas une plosive
        # d'un silence : les deux sont des creux.
        #
        # Ce qui SÉPARE vraiment la parole de l'ambiance n'est ni le niveau ni la continuité,
        # c'est la DENSITÉ : la parole tient un régime dense de 0,2 s (syllabes et plosives
        # alternées), l'ambiance ne produit que des pics ISOLÉS. On remonte donc tant que la
        # fenêtre glissante de 0,2 s reste occupée à 60 % au-dessus du seuil bas.
        # Vérifié dans les trois sens : F01 2,66 s (l'ambiance de rue ne passe plus),
        # F10 0,04 s et F23 0,20 s (les plosives ne coupent plus).
        nd = max(1, int(round(dens_fen / PAS)))
        def dense_av(j):                     # densité de la fenêtre qui COMMENCE en j
            w = E[j:j + nd]
            return len(w) > 0 and float((w > sb).mean()) >= dens_min

        def dense_ar(j):                     # densité de la fenêtre qui FINIT en j
            w = E[max(0, j - nd + 1):j + 1]
            return len(w) > 0 and float((w > sb).mean()) >= dens_min

        a = i
        while a > 0 and dense_av(a - 1):
            a -= 1
        b = i
        while b < len(E) - 1 and dense_ar(b + 1):
            b += 1
        if out and a * PAS <= out[-1][1] + colle:
            out[-1] = (out[-1][0], max(out[-1][1], b * PAS))
        else:
            out.append((a * PAS, b * PAS))
    return [(round(a, 3), round(b, 3)) for a, b in out]


def bornes(path, **kw):
    """(début de la 1re île, fin de la dernière) — l'intervalle réellement parlé."""
    I = iles(path, **kw)
    return (I[0][0], I[-1][1]) if I else (None, None)


MIN_ILE = 0.30      # une île plus courte qu'une syllabe n'est pas une attaque de parole
RECOLLE = 0.60      # ...SAUF si une vraie île la suit d'assez près (cf. air_de_tete)


def air_de_tete(path, min_ile=MIN_ILE, recolle=RECOLLE, **kw):
    """Combien de temps s'écoule avant que la PAROLE n'attaque, dans ce fichier.

    ⭐ POURQUOI UN PLANCHER DE DURÉE (18/09, et c'est tout l'intérêt de la fonction).
    `iles()` rend toutes les îles, y compris celles de 0,10 s. Or un clic, une
    respiration ou un choc de micro produit exactement ça, et il porte de l'énergie
    dans la bande vocale. Sans plancher, le blanc de tête du span `deux-locales-25-ans`
    se mesure à **0,00 s** alors que le monteur n'y parle qu'à **1,62 s** : un blip de 0,10 s
    à 538,86 tenait lieu d'attaque de voix. C'est un faux négatif DANS LE SENS
    RASSURANT — celui qui fait écrire « rien à signaler » sur le défaut qu'on cherche.
    *Une île plus courte qu'une syllabe n'est pas une attaque de parole.*

    ⭐⭐ ET LE PLANCHER SEUL FABRIQUAIT L'ALERTE INVERSE (19/09). Jeter une île courte
    SANS REGARDER CE QUI LA SUIT confond deux choses opposées : un blip isolé, et le
    PREMIER MOT d'une phrase quand il est court et suivi d'une micro-pause (« En fait,
    elle est… » · « Donc j'ai souhaité… »). Dans le second cas l'air est compté jusqu'à
    l'île SUIVANTE, le garde crie, et son remède arithmétique `a → a + air` efface le
    premier mot. C'est la cause EXACTE des 4 réserves `air` de l'EP3, toutes déclarées
    le 18/09 et toutes fausses : blanc source mesuré 0,00 s, air annoncé 0,32-0,34 s.
    *Un remède a besoin de son propre garde, et une tolérance se remesure au lieu de se
    reconduire.*

    Ce qui SÉPARE les deux cas n'est pas la durée de l'île — elle est identique — c'est
    le TROU qui la suit : un mot et sa pause appartiennent à la même phrase, un blip est
    seul dans le silence. `recolle` est la largeur de ce trou. Le chiffre est DÉRIVÉ, pas
    choisi : les 4 cas à rattraper ont un trou ≤ 0,34 s ; le cas connu FAUX
    (`deux-locales-25-ans`) a un trou de ~1,5 s. 0,60 s tient au milieu, à plus du double
    de la tolérance d'air (0,30 s) et à moins de la moitié du blip. `--valider-air`
    rejoue les deux bornes.

    ⭐⭐⭐ ET LA VRAIE CAUSE ÉTAIT AILLEURS (19/09, remesurée avant d'être reconduite).
    La dette écrite le 18/09 disait : « le premier mot forme une île plus courte que
    MIN_ILE, elle est jetée ». **C'est faux.** Mesuré sur les 4 spans en réserve : aucune
    île courte n'est jetée — `iles()` rend UNE SEULE île, qui commence simplement 0,32 à
    0,44 s trop tard. Le tracé d'énergie du master montre la voix à 21, 19, 15 dB dès la
    fenêtre 0 ; c'est la REMONTÉE de `iles()` qui s'arrête sur une pause intra-phrase
    (« C'est-à-dire | que vous pouvez… »), exactement comme elle rate 0,96 s de tête sur
    `agences-francaises`. Desserrer cette remontée est interdit : c'est ce qui avait fait
    remonter F01 à 1,64 s sur un claquement de rue (01/09).
    *Une tolérance se remesure ; et la cause écrite dans une note est une hypothèse comme
    une autre.*

    La sortie n'est donc pas de réparer `iles()` mais de poser la BONNE QUESTION. « Ai-je
    ouvert le span avant que le monteur n'attaque ? » ne se répond pas par « où commence l'île »
    (un onset, calé sur un pic tenu, qui arrive toujours en retard) mais par « combien de
    SILENCE AVÉRÉ y a-t-il devant la parole ». On mesure donc le plus long creux sous le
    seuil bas entre 0 et l'onset :

      · voix dès le début, onset mal daté  → aucun creux → air ≈ 0    (les 4 réserses)
      · vrai blanc de 0,9 s puis la voix   → creux 0,9 s  → air = 0,9 (le défaut cherché)
      · blip à 0,10 s puis 1,5 s de rien   → creux 1,5 s  → air = 1,5 (le cas connu FAUX
        de `deux-locales-25-ans` reste attrapé, sans avoir besoin de MIN_ILE pour ça)

    Et le remède cesse d'être arithmétique : il pointe la FIN du creux, c'est-à-dire
    l'instant juste avant la parole — jamais `a + air`, qui supposait que tout ce qui
    précède l'onset est du silence et qui, appliqué tel quel le 18/09, supprimait des
    mots dans 4 cas sur 8.

    Rend None si le fichier ne contient AUCUNE parole : l'appelant doit alors
    déclarer la dimension NON MESURÉE, jamais conclure qu'elle est propre.
    Sinon rend {'air': s, 'fin': s} — `fin` = où couper si `air` est jugé trop grand.
    """
    I = iles(path, **kw)
    if not I:
        return None
    # onset = 1re île LONGUE, en ré-adoptant les îles courtes COLLÉES à elle (« En » + « fait, »)
    k = next((i for i, (a, b) in enumerate(I) if b - a >= min_ile), None)
    if k is None:
        return None
    while k > 0 and I[k][0] - I[k - 1][1] <= recolle:
        k -= 1
    onset = I[k][0]

    # ...puis le plus long creux AVÉRÉ dans [0, onset] : c'est lui, le blanc de tête.
    E = energie(path)
    sb = float(np.percentile(E, 95)) - kw.get('bas', 25.0)
    n = min(len(E), int(round(onset / PAS)) + 1)
    best_a = best_b = 0
    a = None
    for i in range(n):
        if E[i] <= sb:
            if a is None:
                a = i
            if i - a + 1 > best_b - best_a:
                best_a, best_b = a, i + 1
        else:
            a = None
    return {'air': round((best_b - best_a) * PAS, 3), 'fin': round(best_b * PAS, 3),
            'onset': round(onset, 3)}


MIN_SIL = 0.20      # en dessous, un creux est une plosive ou une respiration, pas une pause


def debut_de_souffle(path, t, bas=25.0, min_sil=MIN_SIL):
    """Où commence l'énoncé qui contient l'instant `t` : la FIN du dernier silence
    avéré qui le précède. Rend 0.0 s'il n'y en a aucun.

    ⭐ POURQUOI (19/09). Pour savoir si une borne `a` a AMPUTÉ un début de phrase, il faut
    élargir la fenêtre en amont et comparer les deux transcriptions. Toute la difficulté
    est de savoir JUSQU'OÙ élargir, et les deux bornes évidentes sont fausses :
      · une marge fixe (0,35 s, la version du 05/09) est trop courte — sur
        `agences-francaises` il manquait « dont certains qui ont été co- », soit 1,5 s,
        et le contrôle sortait VERT sur un défaut que le monteur a dû signaler lui-même ;
      · le début de l'ÎLOT (carte, ou `iles()`) est trop loin ET trop près à la fois :
        trop loin parce qu'un îlot contient souvent une fausse prise que `refine` a
        volontairement sautée — on comparerait alors deux contenus différents et on
        crierait sur 19 spans propres ; trop près parce que la remontée de `iles()`
        s'arrête sur les pauses intra-phrase (mesuré : elle rate 0,96 s de tête sur ce
        même `agences-francaises`).
    Ce qui sépare une fausse prise de la suite d'une phrase n'est ni la distance ni
    l'îlot : c'est une PAUSE. `refine` ne déplace jamais `a` au-delà d'un silence sans
    qu'il y en ait un. On remonte donc jusqu'au dernier creux d'au moins `min_sil`,
    mesuré dans la bande vocale comme tout le reste.
    *Une sonde se réfute avec la grandeur qu'elle mesure ; et la borne d'une comparaison
    fait partie de la comparaison.*
    """
    E = energie(path)
    sb = float(np.percentile(E, 95)) - bas
    n = min(len(E), int(round(t / PAS)))
    k = max(1, int(round(min_sil / PAS)))
    fin = 0.0
    run = 0
    for i in range(n):
        if E[i] <= sb:
            run += 1
        else:
            if run >= k:
                fin = i * PAS
            run = 0
    if run >= k:
        fin = n * PAS
    return round(fin, 3)


def blanc_de_tete(path, bas=25.0, marge=0.15):
    """Durée de silence AVÉRÉ en tête — la seule chose qu'on puisse rogner sans risque.

    `onset` répond à « où la voix commence » et sert à CONTRÔLER. Il ne sert pas à
    COUPER : il est calé sur un pic tenu, donc il tombe après les attaques douces, et
    rogner jusque-là mange des mots (38 au premier essai, 4 blocs encore avec 0,40 s
    d'air). Ici on répond à l'autre question — « jusqu'où suis-je SÛR qu'il n'y a rien » —
    en s'arrêtant à la première fenêtre qui dépasse le seuil BAS, moins une marge.
    Par construction, rien de ce qui porte de l'énergie vocale n'est coupé.
    """
    E = energie(path)
    hi = float(np.percentile(E, 95))
    sb = hi - bas
    i = 0
    while i < len(E) and E[i] <= sb:
        i += 1
    t = max(0.0, i * PAS - marge)
    return round(t, 3)


def valider(path, decalage=2.0):
    """Rejoue le test qui a réfuté la première version : le MÊME fichier précédé de
    `decalage` s de silence doit rendre un onset décalé d'exactement autant."""
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as t:
        pad = t.name
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-f', 'lavfi', '-t', str(decalage),
                    '-i', 'anullsrc=r=16000:cl=mono', '-i', path,
                    '-filter_complex', '[0:a][1:a]concat=n=2:v=0:a=1',
                    '-ar', '16000', '-ac', '1', pad], check=True)
    a, _ = bornes(path)
    b, _ = bornes(pad)
    mesure = round(b - a, 3)
    # ⚠ 18/09 : `abs(1.96 - 2.0) <= 2*PAS` est FAUX en flottant (0,040000000000000036 > 0,04),
    # donc l'auto-validation de cet instrument sortait en code 1 — l'instrument se déclarait
    # invalide sur un résultat pourtant juste à une fenêtre près. Un garde qui crie à tort
    # finit débranché ; on compare donc en ENTIERS de fenêtres, l'unité dans laquelle la
    # mesure est réellement quantifiée.
    ok = round(abs(mesure - decalage) / PAS) <= 2
    return dict(onset=a, onset_padde=b, decalage_attendu=decalage,
                decalage_mesure=mesure, ok=bool(ok))


if __name__ == '__main__':
    args = [x for x in sys.argv[1:] if not x.startswith('--')]
    if '--valider' in sys.argv:
        r = valider(args[0])
        print(json.dumps(r, ensure_ascii=False))
        sys.exit(0 if r['ok'] else 1)
    if '--blanc' in sys.argv:
        print(json.dumps({p: blanc_de_tete(p) for p in args}, ensure_ascii=False))
        sys.exit(0)
    if '--tete' in sys.argv:
        print(json.dumps({p: air_de_tete(p) for p in args}, ensure_ascii=False))
        sys.exit(0)
    if '--valider-air' in sys.argv:
        # usage : --valider-air <wav> <attendu_s> [<wav> <attendu_s> …]
        # Éprouve `air_de_tete` sur des cas CONNUS, dans les deux sens : un premier mot
        # court suivi d'une micro-pause doit rendre ~0, un blip isolé doit rendre l'air
        # réel. Sortie non nulle dès qu'un cas s'écarte de plus d'une fenêtre (0,02 s)
        # de deux. Un instrument qu'on n'a pas vu se tromper ne prouve rien.
        ok = True
        for i in range(0, len(args) - 1, 2):
            p, att = args[i], float(args[i + 1])
            r = air_de_tete(p)
            got = None if r is None else r['air']
            bon = got is not None and abs(got - att) <= 4 * PAS
            ok &= bon
            print(f"{'✓' if bon else '⛔'} {p.split('/')[-1]:44} attendu {att:.2f}s  mesuré "
                  f"{'None' if got is None else f'{got:.2f}s'}"
                  + ('' if r is None else f"  (onset {r['onset']:.2f}, fin du creux {r['fin']:.2f})"))
        sys.exit(0 if ok else 1)
    if '--iles' in sys.argv:
        print(json.dumps({p: iles(p) for p in args}, ensure_ascii=False))
        sys.exit(0)
    if '--souffle' in sys.argv:
        # usage : --souffle <wav> <t>  → fin du dernier silence avéré avant t
        print(json.dumps({args[0]: debut_de_souffle(args[0], float(args[1]))}, ensure_ascii=False))
        sys.exit(0)
    out = {}
    for p in args:
        a, b = bornes(p)
        out[p] = dict(debut=a, fin=b)
    print(json.dumps(out, ensure_ascii=False))
