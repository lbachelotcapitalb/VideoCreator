#!/usr/bin/env node
// ============================================================================
// facecam/overlays/geomap.mjs — COMPOSITION HTML d'un schéma CARTOGRAPHIQUE
//
// Pendant de `route.mjs` (qui, lui, ne sait faire qu'un itinéraire ville→ville).
// Ici on veut les autres formes géographiques du vocabulaire : pays mis en
// couleur (carte muette), corridors qui se tracent (réseau), rayons depuis un
// point (distances/durées). Un seul moteur pour les trois — la doctrine dit que
// le FORMAT suit la donnée, pas qu'il faut un script par vidéo.
//
// Même contrat que route.mjs, et c'est le point important : AUCUNE animation
// CSS/rAF, tout l'état visuel est fonction de `t` via `window.__seek(t)`.
// → capture image par image déterministe et rejouable.
//
// Usage : node geomap.mjs <spec.json> [--out composition.html]
//
// Spec :
//  span      [a,b]            fenêtre du rendu final (secondes)
//  panel     {x,y,w,h}        panneau (mesuré par freespace.py) ; kicker/sub optionnels
//  geojson   "ne_50m…"        fichier de assets/geo
//  bbox      {lon:[..],lat:[..]}
//  map       {x,y,w,h}        zone carte DANS le repère 1920×1080
//  accent      ["China",…]      pays peints en accent
//  grey      ["Japan",…]      pays en gris marqué (les autres restent très sourds)
//  spokes    [{name,lon,lat,t,note}]      rayons depuis `origin` + étiquette
//            ⚠️ SANS `origin`, aucun rayon n'est tracé : les spokes deviennent de simples
//            POINTS NOMMÉS sur la carte. C'est le 4e usage du moteur, ajouté le 31/08 pour
//            les quatre premières ZES — quatre villes qui n'ont ni ordre ni trajet entre
//            elles, donc ni `route` (qui relie) ni rayon (qui part d'un centre).
//            Avant ce correctif, un spoke sans origin traçait un rayon depuis (0,0).
//  origin    {name,lon,lat,t}
//  corridors [{pts:[[lon,lat],…],t,dur}]  polylignes qui se tracent
//  stats     [{t,text}]                   lignes de chiffres sous la carte
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACCENT_CSS } from '../../profil.mjs';   // l'identité visuelle vit dans le profil

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(HERE, '..', 'assets');
const argv = process.argv.slice(2);
const specPath = argv[0];
if (!specPath) { console.error('usage: geomap.mjs <spec.json> [--out out.html]'); process.exit(1); }
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
const outPath = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : specPath.replace(/\.json$/, '.html');
const ACCENT_PROFIL = spec.color ?? ACCENT_CSS;

// ---------------------------------------------------------------- projection
// ⚠️ les DEUX axes en unités Mercator (radians) : mélanger degrés en x et
// radians en y écrase la carte à plat (bug payé sur route.mjs).
const D2R = Math.PI / 180;
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * D2R) / 2));
const B = spec.bbox, M = spec.map;
const x0 = B.lon[0] * D2R, x1 = B.lon[1] * D2R;
const y0 = mercY(B.lat[0]), y1 = mercY(B.lat[1]);
const s = Math.min(M.w / (x1 - x0), M.h / (y1 - y0));   // aspect préservé
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
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  let d = '';
  for (const poly of polys) for (const ring of poly) {
    // on jette les anneaux entièrement hors bbox : poids inutile dans le HTML
    let inside = false;
    for (const [lon, lat] of ring) {
      if (lon >= B.lon[0] - 6 && lon <= B.lon[1] + 6 && lat >= B.lat[0] - 6 && lat <= B.lat[1] + 6) { inside = true; break; }
    }
    if (inside) d += ringToPath(ring);
  }
  return d;
}
const geo = JSON.parse(fs.readFileSync(path.join(ASSETS, 'geo', spec.geojson), 'utf8'));
const ACCENT_PROFIL_SET = new Set(spec.accent || []);
const GREY_SET = new Set(spec.grey || []);
// `contour` = pays désignés par un CONTOUR accent et rien d'autre (pas d'aplat).
// Choix du monteur pour la carte muette : le trait jaune dit « déjà fait », l'aplat
// est réservé au sujet de la vidéo. Un aplat gris de plus noyait la hiérarchie.
const CONT_SET = new Set(spec.contour || []);
let dOcre = '', dGrey = '', dCont = '', dRest = '';
for (const f of geo.features) {
  const p = f.properties || {};
  const names = [p.ADMIN, p.NAME, p.NAME_LONG, p.SOVEREIGNT, p.NAME_FR].filter(Boolean);
  const d = featurePath(f);
  if (!d) continue;
  if (names.some((n) => ACCENT_PROFIL_SET.has(n))) dOcre += d;
  else if (names.some((n) => CONT_SET.has(n))) dCont += d;
  else if (names.some((n) => GREY_SET.has(n))) dGrey += d;
  else dRest += d;
}
// contrôle : un nom de pays qui ne matche RIEN est une faute silencieuse (le pays
// reste sourd et personne ne le voit à l'image) → on le dit à l'opérateur.
const seen = new Set();
for (const f of geo.features) for (const k of ['ADMIN', 'NAME', 'NAME_LONG', 'SOVEREIGNT', 'NAME_FR'])
  if (f.properties?.[k]) seen.add(f.properties[k]);
const manquants = [...ACCENT_PROFIL_SET, ...GREY_SET, ...CONT_SET].filter((n) => !seen.has(n));

// ------------------------------------------------------------------ polices
const font = (f) => 'data:font/ttf;base64,' + fs.readFileSync(path.join(ASSETS, 'fonts', f)).toString('base64');
const FB = font(spec.fonts?.bold ?? 'Montserrat-ExtraBold.ttf');
const FM = font(spec.fonts?.medium ?? 'Montserrat-SemiBold.ttf');

// ------------------------------------------------------------ rayons (spokes)
const O = spec.origin ? (() => { const [X, Y] = proj(spec.origin.lon, spec.origin.lat); return { ...spec.origin, X, Y }; })() : null;
const SP = (spec.spokes || []).map((k) => { const [X, Y] = proj(k.lon, k.lat); return { ...k, X, Y }; });
// étiquette placée vers l'EXTÉRIEUR (au-delà du point, dans le prolongement du
// rayon) puis rabattue dans la zone carte : un libellé vers l'intérieur se
// marcherait dessus avec l'origine, qui est le point le plus dense.
const LABW = (s, size) => s.length * size * 0.60;       // largeur estimée, Montserrat
for (const k of SP) {
  const dx = k.X - (O?.X ?? M.x), dy = k.Y - (O?.Y ?? M.y), L = Math.hypot(dx, dy) || 1;
  k.lx = k.X + (dx / L) * 22;
  k.ly = k.Y + (dy / L) * 22 + (k.dy ?? 0);
  // ⚠️ le libellé est CLIPPÉ par la zone carte : « Hong Kong », posé vers
  // l'extérieur au sud-ouest, sortait par la gauche et s'affichait « ng Kong ».
  // On essaie le côté naturel, on BASCULE s'il déborde, on rabat en dernier recours.
  const w = Math.max(LABW(k.name, 27), LABW(k.note || '', 23));
  const lo = M.x + 12, hi = M.x + M.w - 12;
  const fits = (side) => side === 'end' ? k.lx - w >= lo : k.lx + w <= hi;
  const nat = dx >= 0 ? 'start' : 'end';
  k.side = fits(nat) ? nat : (fits(nat === 'end' ? 'start' : 'end') ? (nat === 'end' ? 'start' : 'end') : nat);
  if (!fits(k.side)) k.lx = k.side === 'end' ? lo + w : hi - w;
}

// --------------------------------------------------------------- corridors
const SAMPLES = 48;
const CORR = (spec.corridors || []).map((c) => {
  const pts = [];
  for (let i = 1; i < c.pts.length; i++) {
    const [a, b] = [c.pts[i - 1], c.pts[i]];
    for (let k = 0; k <= SAMPLES; k++) {           // interpolation en lon/lat
      const u = k / SAMPLES;
      const P = proj(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u);
      if (i === 1 || k > 0) pts.push([+P[0].toFixed(1), +P[1].toFixed(1)]);
    }
  }
  return { t: c.t, dur: c.dur ?? 0.9, pts };
});

// ------------------------------------------------------------------ panneau
const P = spec.panel;
const spokeSVG = SP.map((k, i) => `
  <g class="spoke" data-i="${i}" opacity="0">
    ${O ? `<path class="ray" d="M${(O.X).toFixed(1)},${(O.Y).toFixed(1)} L${k.X.toFixed(1)},${k.Y.toFixed(1)}"
          stroke="${ACCENT_PROFIL}" stroke-width="2.6" stroke-dasharray="9 7" fill="none" opacity=".72"/>` : ''}
    <circle cx="${k.X.toFixed(1)}" cy="${k.Y.toFixed(1)}" r="7" fill="${ACCENT_PROFIL}" stroke="#0b0d13" stroke-width="3"/>
    <text class="city" x="${k.lx.toFixed(1)}" y="${(k.ly - 4).toFixed(1)}" text-anchor="${k.side}">${k.name}</text>
    <text class="note" x="${k.lx.toFixed(1)}" y="${(k.ly + 24).toFixed(1)}" text-anchor="${k.side}">${k.note || ''}</text>
  </g>`).join('');
const corrSVG = CORR.map((c, i) => `<path class="corr" data-i="${i}" d="" fill="none" stroke="${ACCENT_PROFIL}"
   stroke-width="3.4" stroke-linecap="round" opacity=".9"/>`).join('');
const statSVG = (spec.stats || []).map((st, i) => `
  <text class="stat" data-i="${i}" x="34" y="${(P.h - 34 - (spec.stats.length - 1 - i) * 40)}" opacity="0">${st.text}</text>`).join('');
const originSVG = O ? `
  <g id="origin" opacity="0">
    <circle cx="${O.X.toFixed(1)}" cy="${O.Y.toFixed(1)}" r="10" fill="#fff" stroke="${ACCENT_PROFIL}" stroke-width="3.4"/>
    <text class="origin" x="${O.X.toFixed(1)}" y="${(O.Y + 38).toFixed(1)}" text-anchor="middle">${O.name}</text>
  </g>` : '';

const html = `<!doctype html><meta charset="utf-8">
<style>
 @font-face{font-family:MB;src:url(${FB}) format('truetype')}
 @font-face{font-family:MM;src:url(${FM}) format('truetype')}
 html,body{margin:0;padding:0;background:transparent;overflow:hidden}
 svg{display:block}
 text{font-family:MB,sans-serif;-webkit-font-smoothing:antialiased}
 .kicker{font-family:MM;font-size:23px;letter-spacing:.22em;fill:${ACCENT_PROFIL}}
 .sub{font-family:MM;font-size:22px;fill:rgba(255,255,255,.68);letter-spacing:.04em}
 .city{font-size:27px;fill:#fff;paint-order:stroke;stroke:rgba(6,8,12,.9);stroke-width:6px;stroke-linejoin:round}
 .note{font-family:MM;font-size:23px;fill:${ACCENT_PROFIL};paint-order:stroke;stroke:rgba(6,8,12,.9);stroke-width:5px;stroke-linejoin:round}
 .origin{font-size:25px;fill:${ACCENT_PROFIL};paint-order:stroke;stroke:rgba(6,8,12,.95);stroke-width:6px;stroke-linejoin:round}
 .stat{font-family:MB;font-size:27px;fill:rgba(255,255,255,.94)}
</style>
<svg width="1920" height="1080" viewBox="0 0 1920 1080" xmlns="http://www.w3.org/2000/svg">
 <defs>
  <clipPath id="mapClip"><rect x="${M.x}" y="${M.y}" width="${M.w}" height="${M.h}" rx="18"/></clipPath>
  <linearGradient id="accent" x1="0" y1="0" x2="0" y2="1">
   <stop offset="0" stop-color="${ACCENT_PROFIL}" stop-opacity="0"/>
   <stop offset=".35" stop-color="${ACCENT_PROFIL}" stop-opacity=".95"/>
   <stop offset="1" stop-color="${ACCENT_PROFIL}" stop-opacity="0"/>
  </linearGradient>
  <filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
   <feGaussianBlur stdDeviation="6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <!-- ombre courte VOLONTAIREMENT : son halo compte dans le dégagement au sujet -->
  <filter id="soft" x="-30%" y="-30%" width="160%" height="160%">
   <feDropShadow dx="0" dy="6" stdDeviation="11" flood-color="#000" flood-opacity=".5"/>
  </filter>
 </defs>
 <g id="panel" transform="translate(${P.x},${P.y})">
  <g filter="url(#soft)"><rect width="${P.w}" height="${P.h}" rx="30" fill="rgba(9,11,16,.82)"/></g>
  <rect width="${P.w}" height="${P.h}" rx="30" fill="none" stroke="rgba(255,255,255,.17)" stroke-width="1.5"/>
  <!-- barre d accent retiree (le monteur 25/07 : « c est inutile ») -->
  ${spec.kicker ? `<text class="kicker" x="34" y="62">${spec.kicker}</text>` : ''}
  ${spec.sub ? `<text class="sub" x="34" y="94">${spec.sub}</text>` : ''}
  ${spec.kicker ? `<line x1="34" y1="118" x2="${P.w - 34}" y2="118" stroke="rgba(255,255,255,.10)" stroke-width="1.5"/>` : ''}
  ${statSVG}
 </g>
 <g clip-path="url(#mapClip)">
  <rect x="${M.x}" y="${M.y}" width="${M.w}" height="${M.h}" rx="18" fill="rgba(96,132,178,.07)"/>
  <g id="mapg" opacity="0">
   <path d="${dRest}" fill="rgba(255,255,255,.045)" stroke="rgba(255,255,255,.13)" stroke-width="1"/>
   <path id="grey" d="${dGrey}" fill="rgba(255,255,255,.13)" stroke="rgba(255,255,255,.42)" stroke-width="1.4"/>
   <path id="cont" d="${dCont}" fill="none" stroke="${ACCENT_PROFIL}" stroke-width="${spec.contourWidth ?? 2.2}" stroke-linejoin="round"/>
   <!-- remplissage accent VOLONTAIREMENT sourd : à .30 la Chine devenait un bloc
        moutarde qui avalait la carte et ses voisins. C'est le CONTOUR qui désigne,
        pas l'aplat. Réglable par spec via ocreFill. -->
   <path id="accent" d="${dOcre}" fill="rgba(218,165,32,${spec.ocreFill ?? 0.13})" stroke="${spec.ocreStroke ?? ACCENT_PROFIL}" stroke-width="${spec.ocreStrokeWidth ?? 2}"/>
   <g id="corridors" filter="url(#glow)">${corrSVG}</g>
   ${originSVG}
   <g id="spokes">${spokeSVG}</g>
  </g>
 </g>
</svg>
<script>
const SPAN=${JSON.stringify(spec.span)};
const IN=${JSON.stringify(spec.panelIn)}, OUT=${JSON.stringify(spec.panelOut)};
const MAPIN=${JSON.stringify(spec.mapIn ?? spec.panelIn)};
const OCREAT=${spec.ocreAt ?? 'null'}, OCREFILL=${spec.ocreFill ?? 0.13};
const SP=${JSON.stringify(SP.map((k) => ({ t: k.t })))};
const CORR=${JSON.stringify(CORR)};
const STATS=${JSON.stringify((spec.stats || []).map((s) => ({ t: s.t })))};
const ORIGIN_T=${spec.origin?.t ?? 'null'};
const P={x:${P.x},y:${P.y}};
const SLIDE=${spec.slideFrom ?? (P.x + P.w / 2 > 960 ? 28 : -28)};
const cl=(v)=>Math.max(0,Math.min(1,v));
const outCubic=(u)=>1-Math.pow(1-u,3);
const panel=document.getElementById('panel'), mapg=document.getElementById('mapg'),
      accent=document.getElementById('accent'), origin=document.getElementById('origin'),
      spokes=[...document.querySelectorAll('.spoke')],
      corrs=[...document.querySelectorAll('.corr')],
      stats=[...document.querySelectorAll('.stat')];
function prefix(pts,p){
  // longueur cumulée → préfixe EXACT du tracé (le trait "avance" vraiment)
  let tot=0; const seg=[0];
  for(let i=1;i<pts.length;i++){tot+=Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]);seg.push(tot);}
  const want=tot*p; let d='M'+pts[0][0]+','+pts[0][1];
  for(let i=1;i<pts.length;i++){
    if(seg[i]<=want) d+='L'+pts[i][0]+','+pts[i][1];
    else{const u=(want-seg[i-1])/(seg[i]-seg[i-1]);
         d+='L'+(pts[i-1][0]+(pts[i][0]-pts[i-1][0])*u).toFixed(1)+','+(pts[i-1][1]+(pts[i][1]-pts[i-1][1])*u).toFixed(1);
         break;}
  }
  return d;
}
window.__seek=function(t){
  const a=cl((t-IN[0])/(IN[1]-IN[0])), b=cl((t-OUT[0])/(OUT[1]-OUT[0]));
  const op=outCubic(a)*(1-b);
  panel.setAttribute('opacity',op.toFixed(3));
  panel.setAttribute('transform','translate('+(P.x+SLIDE*(1-outCubic(a))).toFixed(2)+','+P.y+')');
  const ma=cl((t-MAPIN[0])/(MAPIN[1]-MAPIN[0]));
  mapg.setAttribute('opacity',(outCubic(ma)*(1-b)).toFixed(3));
  // la Chine se "remplit" à son propre timecode quand on veut la détacher du reste
  if(OCREAT!==null&&accent){const u=outCubic(cl((t-OCREAT)/0.7));
    accent.setAttribute('fill','rgba(218,165,32,'+(OCREFILL*u).toFixed(3)+')');
    accent.setAttribute('stroke-opacity',u.toFixed(3));}
  if(origin&&ORIGIN_T!==null) origin.setAttribute('opacity',outCubic(cl((t-ORIGIN_T)/0.4)).toFixed(3));
  spokes.forEach((g,i)=>{
    const u=outCubic(cl((t-SP[i].t)/0.5));
    g.setAttribute('opacity',u.toFixed(3));
    const ray=g.querySelector('.ray');
    // le rayon se TRACE (dasharray animé par offset) au lieu d'apparaître d'un bloc
    if(ray) ray.setAttribute('stroke-dashoffset',(-(t-SPAN[0])*18).toFixed(1));
  });
  corrs.forEach((el,i)=>{
    const c=CORR[i], p=cl((t-c.t)/c.dur);
    el.setAttribute('d', p<=0 ? '' : prefix(c.pts,outCubic(p)));
  });
  stats.forEach((el,i)=>el.setAttribute('opacity',outCubic(cl((t-STATS[i].t)/0.45)).toFixed(3)));
};
window.__seek(SPAN[0]);
</script>`;
fs.writeFileSync(outPath, html);
console.log('composition →', outPath, '(' + (html.length / 1024).toFixed(0) + ' Ko)');
if (manquants.length) console.log('⚠️  pays NON trouvés dans le GeoJSON (ils resteront sourds) :', manquants.join(' · '));
console.log(`  accent: ${(spec.accent || []).length} · gris: ${(spec.grey || []).length} · rayons: ${SP.length} · corridors: ${CORR.length} · stats: ${(spec.stats || []).length}`);
for (const k of SP) console.log(`  ${k.name.padEnd(12)} x=${k.X.toFixed(0)} y=${k.Y.toFixed(0)} t=${k.t} « ${k.note || ''} »`);
