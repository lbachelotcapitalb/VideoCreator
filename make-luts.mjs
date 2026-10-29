// make-luts.mjs — génère des LUT .cube FILMIQUES par calcul (100 % offline, aucun download).
// Écrit dans ~/Movies/Montage/Réglages/LUTs/. Chaque LUT = une fonction de transfert RGB
// (WB → contraste filmique → split-tone ombres/hautes → saturation), échantillonnée sur une
// grille 33³. Format .cube standard (rouge = dimension la plus rapide, sortie clampée [0,1]).
// Déposer une VRAIE LUT .cube dans ce dossier la rend aussi sélectionnable (cf. lut.txt).
import fs from 'node:fs';
import path from 'node:path';
import { REGLAGES } from './store.mjs';   // les chemins du store : un seul endroit

const OUT = path.join(REGLAGES, 'LUTs');
fs.mkdirSync(OUT, { recursive: true });
const N = 33;
const clamp = (x) => x < 0 ? 0 : x > 1 ? 1 : x;
const lerp = (a, b, t) => a + (b - a) * t;
const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// courbe en S filmique douce autour de 0,5 (contraste sans clipper) — k = force
function sCurve(x, k) {
  const y = 0.5 + (x - 0.5) * (1 + k) - k * (x - 0.5) ** 3 * 4;
  return clamp(y);
}
// split-tone : teinte les ombres et les hautes vers 2 couleurs, pondéré par la luma
function splitTone(r, g, b, shadow, high, amt) {
  const L = luma(r, g, b);
  const wS = (1 - L) ** 1.4, wH = L ** 1.4;            // masques ombres / hautes
  return [
    r + amt * (shadow[0] * wS + high[0] * wH),
    g + amt * (shadow[1] * wS + high[1] * wH),
    b + amt * (shadow[2] * wS + high[2] * wH),
  ];
}
function saturate(r, g, b, s) {
  const L = luma(r, g, b);
  return [lerp(L, r, s), lerp(L, g, s), lerp(L, b, s)];
}

// ── Looks : chacun (r,g,b in [0,1]) → [r,g,b] out ──────────────────────────────
const LOOKS = {
  // Blockbuster teal-orange : ombres cyan, chairs/hautes orangées, contraste net.
  cine_teal_orange(r, g, b) {
    [r, g, b] = [r * 1.02, g, b * 1.02];               // léger froid neutre
    r = sCurve(r, 0.22); g = sCurve(g, 0.22); b = sCurve(b, 0.24);
    [r, g, b] = splitTone(r, g, b, [-0.02, 0.02, 0.06], [0.06, 0.015, -0.05], 1.0);
    [r, g, b] = saturate(r, g, b, 1.12);
    return [r, g, b];
  },
  // Film chaud type Kodak : WB chaud, mids jaune-vert, hautes qui roulent en douceur.
  kodak_warm(r, g, b) {
    [r, g, b] = [r * 1.06, g * 1.01, b * 0.92];        // WB chaud
    r = sCurve(r, 0.12); g = sCurve(g, 0.12); b = sCurve(b, 0.10);
    [r, g, b] = splitTone(r, g, b, [0.02, 0.015, -0.01], [0.03, 0.02, -0.03], 0.8);
    b = clamp(b - 0.02 * (luma(r, g, b) ** 2));         // hautes légèrement crème
    [r, g, b] = saturate(r, g, b, 1.06);
    return [r, g, b];
  },
  // Nuit ciné : noirs PROFONDS cyan-bleu, lumières ville chaudes, contraste marqué. Pensé pour
  // la matière du monteur (déambulation nocturne) comme ALTERNATIVE au LOOK STUDIO — calé NUIT (doctrine
  // « noirs profonds, expo basse »), pas un look jour délavé.
  nuit_cine(r, g, b) {
    // expo basse + noirs profonds : gamma d'assombrissement (>1) puis pied tiré vers le bas.
    r = r ** 1.20; g = g ** 1.20; b = b ** 1.20;         // assombrit mids/bas, garde 1→1
    const lift = -0.055;
    r = clamp(r + lift * (1 - r)); g = clamp(g + lift * (1 - g)); b = clamp(b + lift * (1 - b));
    r = sCurve(r, 0.22); g = sCurve(g, 0.20); b = sCurve(b, 0.18);
    [r, g, b] = splitTone(r, g, b, [-0.03, 0.01, 0.07], [0.05, 0.02, -0.03], 1.0); // ombres bleues / hautes ambre
    [r, g, b] = saturate(r, g, b, 1.10);
    return [r, g, b];
  },
};

for (const [name, fn] of Object.entries(LOOKS)) {
  const lines = [`TITLE "${name}"`, `LUT_3D_SIZE ${N}`, 'DOMAIN_MIN 0 0 0', 'DOMAIN_MAX 1 1 1'];
  for (let bi = 0; bi < N; bi++)
    for (let gi = 0; gi < N; gi++)
      for (let ri = 0; ri < N; ri++) {
        const [R, G, B] = fn(ri / (N - 1), gi / (N - 1), bi / (N - 1));
        lines.push(`${clamp(R).toFixed(6)} ${clamp(G).toFixed(6)} ${clamp(B).toFixed(6)}`);
      }
  const f = path.join(OUT, `${name}.cube`);
  fs.writeFileSync(f, lines.join('\n') + '\n');
  console.log('écrit', f, `(${lines.length} lignes)`);
}
console.log('Dossier LUTs :', OUT);
