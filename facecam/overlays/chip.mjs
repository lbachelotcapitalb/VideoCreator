#!/usr/bin/env node
// ============================================================================
// facecam/overlays/chip.mjs — VIGNETTE DE CHIFFRE au format LARGE (horizontal)
//
// Pendant de `route.mjs` (carte, format portrait). Un chiffre est une donnée
// HORIZONTALE : [icône] [valeur] [libellé]. On ne le force donc pas dans une
// colonne — on le pose dans la bande libre la plus large, MESURÉE pour CE span
// par `freespace.py` (le bandeau du haut peut faire 254 px sur un span et 146 sur
// le suivant : jamais de géométrie par habitude).
//
// Même contrat que route.mjs : aucune animation CSS/rAF, tout est fonction de t
// via `window.__seek(t)` → capture image par image déterministe.
// Le compteur monte de 0 à la valeur (easing) : c'est ce qui rend le chiffre vivant.
//
// Usage : node chip.mjs <spec.json> [--out composition.html]
// Spec  : { span:[a,b], chips:[ {t, dur, value, unit, label, icon, card:{x,y,w,h}} ] }
//         `icon` = nom d'un SVG de assets/icons (Lucide, MIT), sans extension.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACCENT_CSS } from '../../profil.mjs';   // l'identité visuelle vit dans le profil

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(HERE, '..', 'assets');
const argv = process.argv.slice(2);
const spec = JSON.parse(fs.readFileSync(argv[0], 'utf8'));
const out = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : argv[0].replace(/\.json$/, '.html');
const ACCENT_PROFIL = spec.color ?? ACCENT_CSS;

const font = (f) => 'data:font/ttf;base64,' + fs.readFileSync(path.join(ASSETS, 'fonts', f)).toString('base64');
const FB = font(spec.fonts?.bold ?? 'Montserrat-ExtraBold.ttf');
const FM = font(spec.fonts?.medium ?? 'Montserrat-SemiBold.ttf');

// icône Lucide : on récupère juste le contenu du <svg> pour le re-styler (currentColor)
function icon(name) {
  const p = path.join(ASSETS, 'icons', name + '.svg');
  if (!fs.existsSync(p)) return '';
  const s = fs.readFileSync(p, 'utf8');
  const m = s.match(/<svg[^>]*>([\s\S]*)<\/svg>/);
  return m ? m[1] : '';
}

// Largeurs estimées (pas de mesure de texte en Node) : facteurs calibrés sur
// Montserrat. On s'en sert pour AUTO-AJUSTER — un `labelDx` à la main casse dès
// que la valeur change de longueur (« 49 % » vs « 50 000 »). La frame extraite
// reste le juge final.
// FORMAT FRANÇAIS du nombre : virgule décimale, espace fine insécable par millier.
// Sans ça le compteur écrit « 307000 » et « 6.6 » — deux fautes brûlées dans l'image.
// La fonction est SÉRIALISÉE dans la page (`fmtNum.toString()`) : le compteur animé
// et l'estimation de largeur ci-dessous partagent donc exactement le même code —
// deux implémentations jumelles finiraient par diverger et décaler la mise en page.
function fmtNum(n, d) {
  const s = n.toFixed(d).split('.');
  s[0] = s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return s.join(',');
}

// ⚠️ un facteur MOYEN par caractère ne suffit pas pour la valeur : « 906 km » a
// mordu son libellé parce que le `m` d'ExtraBold vaut ~1 em et l'espace ~0,28,
// là où 0,60 était appliqué à tout. Table par caractère, calibrée sur Montserrat
// ExtraBold, avec un défaut par classe (chiffre / lettre).
const CW = { ' ': 0.30, ' ': 0.30, ',': 0.32, '.': 0.32, '-': 0.40, '%': 0.98,
  m: 1.00, w: 0.92, i: 0.30, l: 0.32, j: 0.32, t: 0.48, f: 0.44, r: 0.50, s: 0.56,
  k: 0.68, c: 0.60, G: 0.80, M: 1.00, T: 0.68 };
const wVal = (s, size) =>
  [...s].reduce((a, c) => a + (CW[c] ?? (/\d/.test(c) ? 0.62 : 0.68)), 0) * size;
const wLab = (s, size) => s.length * size * 0.52;      // SemiBold, bas-de-casse
function fitLabel(text, avail, size) {
  if (wLab(text, size) <= avail) return { lines: [text], size };
  // 1) couper en deux lignes sur l'espace le plus proche du milieu
  const words = text.split(' ');
  if (words.length > 1) {
    let best = null, bestD = 1e9;
    for (let k = 1; k < words.length; k++) {
      const a = words.slice(0, k).join(' '), b = words.slice(k).join(' ');
      const d = Math.abs(a.length - b.length);
      if (d < bestD) { bestD = d; best = [a, b]; }
    }
    const s2 = Math.round(size * 0.92);
    if (Math.max(wLab(best[0], s2), wLab(best[1], s2)) <= avail) return { lines: best, size: s2 };
  }
  // 2) sinon on réduit jusqu'à ce que ça rentre (plancher : lisibilité)
  let s = size;
  while (s > 18 && wLab(text, s) > avail) s -= 1;
  return { lines: [text], size: s };
}

const cards = spec.chips.map((c, i) => {
  const C = c.card, r = C.h / 2;
  const iconSize = Math.round(C.h * 0.42);
  const ix = 32, iy = (C.h - iconSize) / 2;
  const vx = ix + iconSize + 26;                       // valeur après l'icône
  const vSize = Math.round(C.h * 0.52);
  const lSize0 = Math.round(C.h * 0.235);
  const valText = fmtNum(c.value, c.decimals ?? 0) + (c.unit || '');
  // Le libellé est ANCRÉ AU BORD DROIT de la carte (`text-anchor="end"`), pas posé
  // après la valeur : ainsi une sous-estimation de la largeur de la valeur rétrécit
  // seulement la place calculée pour le libellé — elle ne peut plus le pousser SUR
  // la valeur (« 906 km » collé à « 21 lignes » avant ce correctif).
  const lRight = C.w - 30;
  const lLeft = c.labelDx != null ? vx + c.labelDx : vx + wVal(valText, vSize) + 30;
  const fit = fitLabel(c.label, lRight - lLeft, lSize0);
  const lSize = fit.size;
  const lab = (txt, dy) => `<text class="lab" x="${lRight.toFixed(0)}" y="${dy.toFixed(0)}"` +
    ` text-anchor="end" font-size="${lSize}" fill="rgba(255,255,255,.92)">${txt}</text>`;
  const labelSVG = fit.lines.length === 1
    ? lab(fit.lines[0], C.h / 2 + lSize * 0.36)
    : fit.lines.map((L, k) => lab(L, C.h / 2 + (k === 0 ? -lSize * 0.22 : lSize * 1.02))).join('');
  return `
 <g class="chip" data-i="${i}" transform="translate(${C.x},${C.y})" opacity="0">
   <g filter="url(#soft)"><rect width="${C.w}" height="${C.h}" rx="${r}" fill="rgba(9,11,16,.84)"/></g>
   <rect width="${C.w}" height="${C.h}" rx="${r}" fill="none" stroke="rgba(255,255,255,.16)" stroke-width="1.5"/>
   <!-- pas de barre d'accent à gauche : le monteur, 25/07 — « c'est inutile ». La valeur
        est déjà en accent, l'icône aussi : un troisième rappel de la couleur ne dit rien. -->
   <g transform="translate(${ix},${iy}) scale(${iconSize / 24})" stroke="${ACCENT_PROFIL}" stroke-width="2"
      fill="none" stroke-linecap="round" stroke-linejoin="round">${icon(c.icon || 'zap')}</g>
   <text class="val" x="${vx}" y="${(C.h / 2 + vSize * 0.36).toFixed(0)}" font-size="${vSize}" fill="${ACCENT_PROFIL}">${fmtNum(0, c.decimals ?? 0)}${c.unit || ''}</text>
   ${labelSVG}
 </g>`;
}).join('');

const html = `<!doctype html><meta charset="utf-8">
<style>
 @font-face{font-family:MB;src:url(${FB}) format('truetype')}
 @font-face{font-family:MM;src:url(${FM}) format('truetype')}
 html,body{margin:0;padding:0;background:transparent;overflow:hidden}
 .val{font-family:MB;letter-spacing:-.01em}
 .lab{font-family:MM;letter-spacing:.01em}
</style>
<svg width="1920" height="1080" viewBox="0 0 1920 1080" xmlns="http://www.w3.org/2000/svg">
 <defs><filter id="soft" x="-30%" y="-30%" width="160%" height="160%">
   <feDropShadow dx="0" dy="6" stdDeviation="11" flood-color="#000" flood-opacity=".5"/></filter></defs>
 ${cards}
</svg>
<script>
const CH=${JSON.stringify(spec.chips.map((c) => ({ t: c.t, dur: c.dur ?? 4.5, value: c.value, unit: c.unit || '',
  decimals: c.decimals ?? 0, inDur: c.inDur ?? 0.42, outDur: c.outDur ?? 0.35, x: c.card.x, y: c.card.y })))};
const fmt=${fmtNum.toString()};
const cl=(v)=>Math.max(0,Math.min(1,v));
const outCubic=(u)=>1-Math.pow(1-u,3);
const els=[...document.querySelectorAll('.chip')];
window.__seek=function(t){
  els.forEach((g,i)=>{
    const c=CH[i];
    const a=cl((t-c.t)/c.inDur);                       // entrée
    const b=cl((t-(c.t+c.dur-c.outDur))/c.outDur);     // sortie
    const op=outCubic(a)*(1-b);
    g.setAttribute('opacity',op.toFixed(3));
    // glisse de 16 px vers le haut à l'entrée : la carte "arrive", elle n'apparaît pas
    g.setAttribute('transform','translate('+c.x+','+(c.y+16*(1-outCubic(a))).toFixed(2)+')');
    // compteur : 0 → valeur sur 0,55 s après l'entrée (le chiffre se construit)
    const u=outCubic(cl((t-c.t)/0.55));
    g.querySelector('.val').textContent=fmt(c.value*u,c.decimals)+c.unit;
  });
};
window.__seek(${spec.span[0]});
</script>`;
fs.writeFileSync(out, html);
console.log('composition →', out);
for (const c of spec.chips) console.log(`  ${c.value}${c.unit || ''} « ${c.label} » à t=${c.t} dans ${JSON.stringify(c.card)}`);
