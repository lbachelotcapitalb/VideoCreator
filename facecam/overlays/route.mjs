#!/usr/bin/env node
// ============================================================================
// facecam/overlays/route.mjs — génère la COMPOSITION HTML d'un itinéraire animé
// (carte + tracé pointillé qui avance dans le temps, ville par ville).
//
// Rien n'est animé par CSS/rAF : tout l'état visuel est une FONCTION du temps,
// exposée en `window.__seek(t)` (t = timecode de la vidéo finale, en secondes).
// → la capture image par image est déterministe et rejouable (pattern « frame
//   adapter » : même principe que Remotion / HyperFrames).
//
// Usage : node route.mjs <spec.json> [--out composition.html]
// Le spec porte TOUTE la géométrie mesurée (panneau dans le vide mesuré par
// freespace.py) et TOUS les timecodes mesurés (whisper mot-à-mot + sweep).
// 100% offline : GeoJSON Natural Earth + polices OFL locales, aucun réseau.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACCENT_CSS } from '../../profil.mjs';   // l'identité visuelle vit dans le profil

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(HERE, '..', 'assets');

const argv = process.argv.slice(2);
const specPath = argv[0];
if (!specPath) { console.error('usage: route.mjs <spec.json> [--out out.html]'); process.exit(1); }
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
const outPath = argv.includes('--out') ? argv[argv.indexOf('--out') + 1]
  : specPath.replace(/\.json$/, '.html');

// ---------------------------------------------------------------- projection
const D2R = Math.PI / 180;
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * D2R) / 2));
const B = spec.bbox;                     // {lon:[min,max], lat:[min,max]}
const M = spec.map;                      // {x,y,w,h} zone carte (repère panneau)
// ⚠️ les DEUX axes en unités Mercator (radians) : mélanger degrés (x) et
// radians (y) écrase la carte à plat (bug vécu : toutes les villes sur une ligne)
const x0 = B.lon[0] * D2R, x1 = B.lon[1] * D2R;
const y0 = mercY(B.lat[0]), y1 = mercY(B.lat[1]);
// on remplit la zone carte en préservant l'aspect (pas d'étirement de la Chine)
const sx = M.w / (x1 - x0), sy = M.h / (y1 - y0), s = Math.min(sx, sy);
const offX = M.x + (M.w - (x1 - x0) * s) / 2;
const offY = M.y + (M.h - (y1 - y0) * s) / 2;
const proj = (lon, lat) => [offX + (lon * D2R - x0) * s, offY + (y1 - mercY(lat)) * s];

// ------------------------------------------------- GeoJSON → chemins SVG
function ringToPath(ring) {
  let d = '';
  for (let i = 0; i < ring.length; i++) {
    const [lon, lat] = ring[i];
    if (lat <= -85 || lat >= 85) continue;
    const [X, Y] = proj(lon, lat);
    d += (i === 0 ? 'M' : 'L') + X.toFixed(1) + ',' + Y.toFixed(1);
  }
  return d ? d + 'Z' : '';
}
function featurePath(f) {
  const g = f.geometry; if (!g) return '';
  const polys = g.type === 'Polygon' ? [g.coordinates]
    : g.type === 'MultiPolygon' ? g.coordinates : [];
  let d = '';
  for (const poly of polys) for (const ring of poly) {
    // écarter les anneaux entièrement hors bbox (poids inutile dans le HTML)
    let inside = false;
    for (const [lon, lat] of ring) {
      if (lon >= B.lon[0] - 6 && lon <= B.lon[1] + 6 && lat >= B.lat[0] - 6 && lat <= B.lat[1] + 6) { inside = true; break; }
    }
    if (inside) d += ringToPath(ring);
  }
  return d;
}
const geo = JSON.parse(fs.readFileSync(path.join(ASSETS, 'geo', spec.geojson), 'utf8'));
let chinaD = '', othersD = '';
for (const f of geo.features) {
  const p = f.properties || {};
  const name = p.ADMIN || p.NAME || p.SOVEREIGNT || '';
  const d = featurePath(f);
  if (!d) continue;
  if (/^China$/i.test(name) || /^Taiwan$/i.test(name)) chinaD += d; else othersD += d;
}

// ------------------------------------------------------------- villes + legs
const C = spec.cities.map((c) => { const [X, Y] = proj(c.lon, c.lat); return { ...c, X, Y }; });
const mapCx = M.x + M.w / 2;

// placement des étiquettes : côté opposé au centre de la carte, puis
// ANTI-COLLISION (écartement vertical + ligne de rappel vers le point)
// côté : vers l'INTÉRIEUR de la carte (le panneau est étroit — un placement
// « vers l'extérieur » ferait déborder les noms longs hors du panneau).
const LAB_DY = spec.labelSpacing ?? 42;
const FS = spec.labelSize ?? 30;
for (const c of C) {
  c.side = c.forceSide || (c.X > mapCx ? 'left' : 'right');
  c.ly = c.Y + (c.dy ?? 0);
  c.lx = c.side === 'left' ? c.X - 18 : c.X + 18;
  c.lw = c.name.length * FS * 0.62;              // largeur estimée du texte
  c.bx = c.side === 'left' ? [c.lx - c.lw, c.lx] : [c.lx, c.lx + c.lw];
}
// anti-collision GLOBALE : on n'écarte que les étiquettes qui se recouvrent
// VRAIMENT en x (deux libellés de part et d'autre peuvent se marcher dessus)
const order = [...C].sort((a, b) => a.ly - b.ly);
for (let i = 1; i < order.length; i++) {
  const c = order[i];
  for (let j = 0; j < i; j++) {
    const p = order[j];
    const overlapX = c.bx[0] < p.bx[1] && p.bx[0] < c.bx[1];
    if (overlapX && c.ly - p.ly < LAB_DY) c.ly = p.ly + LAB_DY;
  }
}
// on garde tout le paquet dans la zone carte…
for (const c of C) c.ly = Math.max(M.y + 24, Math.min(M.y + M.h - 18, c.ly));
// …puis PASSE REMONTANTE : le clamp du bas écrase l'écartement (Macao collé à
// Hong Kong à 21 px au lieu de 40) → on repousse les précédentes vers le haut.
for (let i = order.length - 2; i >= 0; i--) {
  const c = order[i], n = order[i + 1];
  const overlapX = c.bx[0] < n.bx[1] && n.bx[0] < c.bx[1];
  if (overlapX && n.ly - c.ly < LAB_DY) c.ly = Math.max(M.y + 24, n.ly - LAB_DY);
}

// legs : bézier quadratique (galbe constant à droite du sens de marche), échantillonnée
const SAMPLES = 64;
const legs = [];
for (let i = 1; i < C.length; i++) {
  const a = C[i - 1], b = C[i];
  const dx = b.X - a.X, dy = b.Y - a.Y, L = Math.hypot(dx, dy) || 1;
  const bow = (spec.bow ?? 0.14) * L;
  const cx = (a.X + b.X) / 2 + (-dy / L) * bow;
  const cy = (a.Y + b.Y) / 2 + (dx / L) * bow;
  const pts = [];
  for (let k = 0; k <= SAMPLES; k++) {
    const u = k / SAMPLES, v = 1 - u;
    pts.push([
      +(v * v * a.X + 2 * v * u * cx + u * u * b.X).toFixed(2),
      +(v * v * a.Y + 2 * v * u * cy + u * u * b.Y).toFixed(2),
    ]);
  }
  legs.push({ to: i, pts, t: b.t, dur: b.draw ?? spec.legDraw ?? 0.55 });
}

// ------------------------------------------------------------------ polices
const font = (file) => 'data:font/ttf;base64,' + fs.readFileSync(path.join(ASSETS, 'fonts', file)).toString('base64');
const FONT_BOLD = font(spec.fonts?.bold ?? 'Montserrat-ExtraBold.ttf');
const FONT_MED = font(spec.fonts?.medium ?? 'Montserrat-SemiBold.ttf');

// ------------------------------------------------------------------- panneau
const P = spec.panel;                    // {x,y,w,h} dans le repère 1920x1080
const ACCENT_PROFIL = spec.color ?? ACCENT_CSS;
const dots = C.map((c, i) => `
  <g class="city" data-i="${i}">
    <circle class="halo" cx="${c.X.toFixed(1)}" cy="${c.Y.toFixed(1)}" r="16" fill="${ACCENT_PROFIL}" opacity="0"/>
    <circle class="dot"  cx="${c.X.toFixed(1)}" cy="${c.Y.toFixed(1)}" r="8" fill="${ACCENT_PROFIL}" stroke="#0b0d13" stroke-width="3"/>
    <path class="leader" d="M${c.X.toFixed(1)},${c.Y.toFixed(1)} L${c.lx.toFixed(1)},${c.ly.toFixed(1)}"
          stroke="${ACCENT_PROFIL}" stroke-width="1.4" opacity="0.55" fill="none"/>
    <text class="lab" x="${c.lx.toFixed(1)}" y="${(c.ly + 8).toFixed(1)}"
          text-anchor="${c.side === 'left' ? 'end' : 'start'}">${c.name}</text>
  </g>`).join('');

const legPaths = legs.map((l, i) => `<path class="leg" data-i="${i}" fill="none" stroke="${ACCENT_PROFIL}"
   stroke-width="4.4" stroke-linecap="round" stroke-dasharray="12 9" d=""/>`).join('');

const html = `<!doctype html><meta charset="utf-8">
<style>
 @font-face{font-family:MB;src:url(${FONT_BOLD}) format('truetype')}
 @font-face{font-family:MM;src:url(${FONT_MED}) format('truetype')}
 html,body{margin:0;padding:0;background:transparent;overflow:hidden}
 svg{display:block}
 text{font-family:MB, sans-serif; -webkit-font-smoothing:antialiased}
 .lab{font-size:30px;fill:#fff;paint-order:stroke;stroke:rgba(6,8,12,.9);stroke-width:6px;stroke-linejoin:round}
 .kicker{font-family:MM;font-size:23px;letter-spacing:.22em;fill:${ACCENT_PROFIL}}
 .sub{font-family:MM;font-size:22px;fill:rgba(255,255,255,.68);letter-spacing:.04em}
 .badge{font-family:MB;font-size:26px;fill:${ACCENT_PROFIL};letter-spacing:.08em}
</style>
<svg id="svg" width="1920" height="1080" viewBox="0 0 1920 1080" xmlns="http://www.w3.org/2000/svg">
 <defs>
  <clipPath id="mapClip"><rect x="${M.x}" y="${M.y}" width="${M.w}" height="${M.h}" rx="18"/></clipPath>
  <linearGradient id="accent" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${ACCENT_PROFIL}" stop-opacity="0"/>
    <stop offset=".35" stop-color="${ACCENT_PROFIL}" stop-opacity=".95"/>
    <stop offset="1" stop-color="${ACCENT_PROFIL}" stop-opacity="0"/>
  </linearGradient>
  <filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
    <feGaussianBlur stdDeviation="7" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <!-- ombre VOLONTAIREMENT courte : son halo compte dans le dégagement au sujet
       (à 18 de blur elle mordait visuellement sur le bras à 20 px près) -->
  <filter id="soft" x="-30%" y="-30%" width="160%" height="160%">
    <feDropShadow dx="0" dy="6" stdDeviation="11" flood-color="#000" flood-opacity=".5"/>
  </filter>
 </defs>
 <g id="panel" transform="translate(${P.x},${P.y})">
  <g filter="url(#soft)">
    <rect x="0" y="0" width="${P.w}" height="${P.h}" rx="30" fill="rgba(9,11,16,.82)"/>
  </g>
  <rect x="0" y="0" width="${P.w}" height="${P.h}" rx="30" fill="none" stroke="rgba(255,255,255,.17)" stroke-width="1.5"/>
  <!-- barre d accent retiree (le monteur 25/07 : « c est inutile ») -->
  <text class="kicker" x="34" y="62">ITINÉRAIRE</text>
  <text class="sub" id="sub" x="34" y="94">Chine · 8 étapes</text>
  <line x1="34" y1="118" x2="${P.w - 34}" y2="118" stroke="rgba(255,255,255,.10)" stroke-width="1.5"/>
  <g clip-path="url(#mapClip)">
    <rect x="${M.x}" y="${M.y}" width="${M.w}" height="${M.h}" rx="18" fill="rgba(96,132,178,.07)"/>
    <path d="${othersD}" fill="rgba(255,255,255,.05)"  stroke="rgba(255,255,255,.16)" stroke-width="1.1"/>
    <path d="${chinaD}"  fill="rgba(255,255,255,.115)" stroke="rgba(255,255,255,.46)" stroke-width="1.7"/>
    <g id="legs" filter="url(#glow)">${legPaths}</g>
    <circle id="head" r="7" fill="#fff" opacity="0" filter="url(#glow)"/>
    <g id="cities">${dots}</g>
  </g>
  <g id="badge" opacity="0">
    <rect x="34" y="${P.h - 82}" width="196" height="52" rx="26" fill="rgba(218,165,32,.10)" stroke="${ACCENT_PROFIL}" stroke-width="1.6"/>
    <text class="badge" x="132" y="${P.h - 48}" text-anchor="middle">≈ 1 MOIS</text>
  </g>
 </g>
</svg>
<script>
const SPAN=${JSON.stringify(spec.span)}, CITIES=${JSON.stringify(C.map(c => ({ t: c.t, pop: c.pop ?? 0.42 })))};
const LEGS=${JSON.stringify(legs.map(l => ({ t: l.t, dur: l.dur, pts: l.pts })))};
const IN=${JSON.stringify(spec.panelIn)}, OUT=${JSON.stringify(spec.panelOut)}, BADGE=${spec.badgeAt};
const P={x:${P.x},y:${P.y}};
// le panneau glisse depuis le BORD dont il est le plus proche (droite → +, gauche → −)
const SLIDE=${spec.slideFrom ?? (P.x + P.w / 2 > 960 ? 28 : -28)};
const cl=(v)=>Math.max(0,Math.min(1,v));
const outCubic=(u)=>1-Math.pow(1-u,3);
const overshoot=(u)=>{const c=1.70158+1;return 1+ (c+1)*Math.pow(u-1,3)+c*Math.pow(u-1,2);};
const panel=document.getElementById('panel'), head=document.getElementById('head'),
      badge=document.getElementById('badge'), legEls=[...document.querySelectorAll('.leg')],
      cityEls=[...document.querySelectorAll('.city')];
function pathPrefix(pts,p){
  // longueur cumulée → préfixe exact (le pointillé "marche" naturellement dessus)
  let tot=0; const seg=[0];
  for(let i=1;i<pts.length;i++){tot+=Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]);seg.push(tot);}
  const want=tot*p; let d='M'+pts[0][0]+','+pts[0][1]; let tip=pts[0];
  for(let i=1;i<pts.length;i++){
    if(seg[i]<=want){d+='L'+pts[i][0]+','+pts[i][1];tip=pts[i];}
    else{const u=(want-seg[i-1])/(seg[i]-seg[i-1]);
         const X=pts[i-1][0]+(pts[i][0]-pts[i-1][0])*u, Y=pts[i-1][1]+(pts[i][1]-pts[i-1][1])*u;
         d+='L'+X.toFixed(2)+','+Y.toFixed(2); tip=[X,Y]; break;}
  }
  return {d,tip};
}
window.__seek=function(t){
  // entrée / sortie du panneau
  const a=cl((t-IN[0])/(IN[1]-IN[0])), b=cl((t-OUT[0])/(OUT[1]-OUT[0]));
  const op=outCubic(a)*(1-b), dx=SLIDE*(1-outCubic(a));
  panel.setAttribute('opacity',op.toFixed(3));
  panel.setAttribute('transform','translate('+(P.x+dx).toFixed(2)+','+P.y+')');
  // tracé : chaque leg avance sur sa fenêtre, le pointillé défile
  let tip=null, drawing=false;
  legEls.forEach((el,i)=>{
    const L=LEGS[i], p=cl((t-L.t)/L.dur);
    if(p<=0){el.setAttribute('d','');return;}
    const r=pathPrefix(L.pts, outCubic(p));
    el.setAttribute('d',r.d);
    el.setAttribute('stroke-dashoffset', (-(t-SPAN[0])*24).toFixed(1));
    if(p<1){tip=r.tip;drawing=true;}
  });
  if(drawing&&tip){head.setAttribute('cx',tip[0]);head.setAttribute('cy',tip[1]);head.setAttribute('opacity','0.95');}
  else head.setAttribute('opacity','0');
  // villes : point qui pope (léger dépassement) puis étiquette
  cityEls.forEach((g,i)=>{
    const c=CITIES[i], u=cl((t-c.t)/c.pop);
    const dot=g.querySelector('.dot'), halo=g.querySelector('.halo'),
          lab=g.querySelector('.lab'), led=g.querySelector('.leader');
    if(u<=0){g.setAttribute('opacity','0');return;}
    g.setAttribute('opacity','1');
    const k=overshoot(u);
    dot.setAttribute('r',(8*k).toFixed(2));
    halo.setAttribute('opacity',(0.30*(1-u)).toFixed(3));
    halo.setAttribute('r',(10+26*u).toFixed(1));
    const lu=cl((t-(c.t+0.18))/0.34);
    lab.setAttribute('opacity',lu.toFixed(3));
    led.setAttribute('opacity',(0.55*lu).toFixed(3));
  });
  badge.setAttribute('opacity', cl((t-BADGE)/0.4).toFixed(3));
};
window.__seek(SPAN[0]);
</script>`;
fs.writeFileSync(outPath, html);
console.log('composition →', outPath, '(' + (html.length / 1024).toFixed(0) + ' Ko)');
console.log('villes projetées :');
for (const c of C) console.log('  ' + c.name.padEnd(11), 'x=' + c.X.toFixed(1), 'y=' + c.Y.toFixed(1), 'label', c.side, 'ly=' + c.ly.toFixed(1), 't=' + c.t);
