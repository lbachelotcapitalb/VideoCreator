#!/usr/bin/env node
// ============================================================================
// facecam/overlays/generique.mjs — composition HTML d'un GÉNÉRIQUE DE FIN
// plein cadre (1920x1080) : fond noir, silhouette du pays qui se DESSINE, puis
// tracé blanc progressif de l'itinéraire ville par ville, puis une signature
// texte (« La suite bientôt »), puis fondu au noir.
//
// Même contrat que route.mjs : rien n'est animé par CSS/rAF, tout l'état visuel
// est une FONCTION du temps exposée en `window.__seek(t)` → capture image par
// image déterministe via capture.mjs (pattern « frame adapter »).
// Différence avec route.mjs : PAS de panneau, PAS d'alpha à préserver, PAS
// d'accent — c'est un plan à part entière, pas un overlay posé sur une image.
//
// Usage : node generique.mjs <spec.json> [--out composition.html]
// Le spec porte les villes (lon/lat), la bbox, la durée et les temps clés ; les
// durées de tracé sont CALCULÉES par distance (une étape de 30 km ne peut pas
// se dessiner aussi lentement qu'une de 1500 km, ni disparaître en 2 images).
// 100% offline : GeoJSON Natural Earth + polices OFL locales, aucun réseau.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(HERE, '..', 'assets');

const argv = process.argv.slice(2);
const specPath = argv[0];
if (!specPath) { console.error('usage: generique.mjs <spec.json> [--out out.html]'); process.exit(1); }
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
const outPath = argv.includes('--out') ? argv[argv.indexOf('--out') + 1]
  : specPath.replace(/\.json$/, '.html');

const W = 1920, H = 1080;

// ---------------------------------------------------------------- projection
// ⚠️ les DEUX axes en unités Mercator (radians) — mélanger degrés et radians
// écrase la carte à plat (bug vécu sur route.mjs, cf. son en-tête).
const D2R = Math.PI / 180;
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * D2R) / 2));
const B = spec.bbox;                     // {lon:[min,max], lat:[min,max]}
const M = spec.map;                      // {x,y,w,h} zone carte dans le cadre
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
// renvoie la LISTE des anneaux (un sous-chemin chacun) et non une chaîne unique :
// le générique a besoin de distinguer l'anneau principal des îlots (cf. plus bas).
function featureRings(f, pad = 8) {
  const g = f.geometry; if (!g) return [];
  const polys = g.type === 'Polygon' ? [g.coordinates]
    : g.type === 'MultiPolygon' ? g.coordinates : [];
  const out = [];
  for (const poly of polys) for (const ring of poly) {
    let inside = false;
    for (const [lon, lat] of ring) {
      if (lon >= B.lon[0] - pad && lon <= B.lon[1] + pad
        && lat >= B.lat[0] - pad && lat <= B.lat[1] + pad) { inside = true; break; }
    }
    if (!inside) continue;
    const d = ringToPath(ring);
    if (!d) continue;
    // périmètre projeté : sert à isoler le continent des îlots
    let per = 0;
    for (let i = 1; i < ring.length; i++) {
      const [ax, ay] = proj(ring[i - 1][0], ring[i - 1][1]);
      const [bx, by] = proj(ring[i][0], ring[i][1]);
      per += Math.hypot(bx - ax, by - ay);
    }
    out.push({ d, per });
  }
  return out;
}
const geo = JSON.parse(fs.readFileSync(path.join(ASSETS, 'geo', spec.geojson), 'utf8'));
const HERO = new RegExp(spec.hero ?? '^China$', 'i');
let heroRings = [], othersD = '';
for (const f of geo.features) {
  const p = f.properties || {};
  const name = p.ADMIN || p.NAME || p.SOVEREIGNT || '';
  const rings = featureRings(f);
  if (!rings.length) continue;
  if (HERO.test(name)) heroRings.push(...rings); else othersD += rings.map((r) => r.d).join('');
}
// ⚠️ le pointillé SVG REDÉMARRE à chaque sous-chemin : une silhouette dessinée
// d'un seul `path` multi-anneaux fait apparaître les îlots d'un coup, puis le
// continent en rafale (mesuré : rien pendant 0,7 s, puis 90 % en 0,4 s).
// → on dessine le CONTINENT seul (un anneau = un sous-chemin = un trait continu)
//   et on fait apparaître les îlots en fondu derrière.
heroRings.sort((a, b) => b.per - a.per);
const mainD = heroRings.length ? heroRings[0].d : '';
const islesD = heroRings.slice(1).map((r) => r.d).join('');
const heroD = mainD + islesD;

// ------------------------------------------------------------ villes + legs
const C = spec.cities.map((c) => { const [X, Y] = proj(c.lon, c.lat); return { ...c, X, Y }; });

// distance orthodromique (km) — sert à doser la durée de tracé de chaque étape
function haversine(a, b) {
  const R = 6371, dLat = (b.lat - a.lat) * D2R, dLon = (b.lon - a.lon) * D2R;
  const q = Math.sin(dLat / 2) ** 2
    + Math.cos(a.lat * D2R) * Math.cos(b.lat * D2R) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(q));
}
const dists = [];
for (let i = 1; i < C.length; i++) dists.push(haversine(C[i - 1], C[i]));
const dMax = Math.max(...dists);
const DUR_MIN = spec.legMin ?? 0.30, DUR_SPAN = spec.legSpan ?? 0.75;
const GAP = spec.legGap ?? 0.12;
// racine (^0.55) et non proportionnalité stricte : sinon Shenzhen→Hong Kong
// (30 km) se dessinerait en 2 images — illisible — et Chengdu→Pékin mangerait
// la moitié du générique.
const legDur = dists.map((d) => +(DUR_MIN + DUR_SPAN * Math.pow(d / dMax, 0.55)).toFixed(3));

// ------------------------------------------------- ÉPISODES (rattachement visuel)
// Chaque ville porte `ep` (1,2,3…). Un LEG appartient à l'épisode de la ville où il
// ARRIVE : Shanghai→Xiamen est le premier trait de l'épisode 2. Le style d'un épisode
// (couleur, épaisseur, opacité, pointillé) vit dans `spec.episodes`, et `spec.groupGap`
// ajoute une respiration au CHANGEMENT d'épisode — un « temps » de plus, sans couleur.
// Sans `ep` ni `episodes`, le rendu est celui d'avant (tout blanc, même épaisseur).
const EP_DEF = { stroke: '#fff', width: spec.strokeWidth ?? 3.4, opacity: 1, dash: null };
const epStyle = (n) => ({ ...EP_DEF, ...((spec.episodes ?? {})[String(n)] ?? {}) });
for (const c of C) c.ep = c.ep ?? 1;
const GROUP_GAP = spec.groupGap ?? 0;

// horloge : la 1re ville pope à `spec.startAt`, puis chaque leg s'enchaîne
let clock = spec.startAt ?? 1.9;
C[0].t = +clock.toFixed(3);
const legs = [];
for (let i = 1; i < C.length; i++) {
  const a = C[i - 1], b = C[i];
  const bump = (i === 1 ? (spec.firstPop ?? 0.34) : GAP) + (b.ep !== a.ep ? GROUP_GAP : 0);
  const t = +(clock + bump).toFixed(3);
  const dx = b.X - a.X, dy = b.Y - a.Y, L = Math.hypot(dx, dy) || 1;
  const bow = (b.bow ?? spec.bow ?? 0.12) * L;
  const cx = (a.X + b.X) / 2 + (-dy / L) * bow;
  const cy = (a.Y + b.Y) / 2 + (dx / L) * bow;
  const pts = [];
  const SAMPLES = 64;
  for (let k = 0; k <= SAMPLES; k++) {
    const u = k / SAMPLES, v = 1 - u;
    pts.push([
      +(v * v * a.X + 2 * v * u * cx + u * u * b.X).toFixed(2),
      +(v * v * a.Y + 2 * v * u * cy + u * u * b.Y).toFixed(2),
    ]);
  }
  legs.push({ t, dur: legDur[i - 1], pts, km: Math.round(dists[i - 1]), ep: b.ep });
  b.t = +(t + legDur[i - 1] * 0.86).toFixed(3);   // la ville pope avant la fin du trait
  clock = t + legDur[i - 1];
}
const routeEnd = +clock.toFixed(3);

// ------------------------------------------- étiquettes : côté + anti-collision
const LAB_DY = spec.labelSpacing ?? 40;
const FS = spec.labelSize ?? 32;
const mapCx = M.x + M.w / 2;
for (const c of C) {
  c.side = c.forceSide || (c.X > mapCx ? 'right' : 'left');
  c.ly = c.Y + (c.dy ?? 0);
  c.lx = (c.X + (c.dx ?? 0)) + (c.side === 'left' ? -20 : 20);
  c.lw = c.name.length * FS * 0.66;
  c.bx = c.side === 'left' ? [c.lx - c.lw, c.lx] : [c.lx, c.lx + c.lw];
}
const order = [...C].sort((a, b) => a.ly - b.ly);
for (let i = 1; i < order.length; i++) {
  const c = order[i];
  for (let j = 0; j < i; j++) {
    const p = order[j];
    if (c.bx[0] < p.bx[1] && p.bx[0] < c.bx[1] && c.ly - p.ly < LAB_DY) c.ly = p.ly + LAB_DY;
  }
}
// plancher = AU-DESSUS de la signature : une étiquette qui descend dans le titre
// est illisible (vécu : « Guangzhou » chevauchait « LA SUITE BIENTÔT »)
const LAB_FLOOR = (spec.titleY ?? 960) - (spec.titleClearance ?? 100);

// ⭐ LA SIGNATURE DE FIN EST OPTIONNELLE, ET SON ABSENCE SE DEMANDE EXPLICITEMENT (20/09).
// le monteur, sur l'EP3 : « pas de "La suite bientôt" dans le générique ». Trois pièges dans un
// geste qui a l'air d'être d'un caractère :
//   ① le DÉFAUT de ce champ était précisément le texte à retirer (`spec.title ?? 'LA SUITE
//     BIENTÔT'`), donc le mettre à `null` ou le SUPPRIMER du spec le fait RÉAPPARAÎTRE.
//     Sémantique posée : champ ABSENT = comportement historique (les specs #01 et #02 ne
//     bougent pas) · chaîne VIDE = pas de signature. L'opt-out est explicite, jamais déduit.
//   ② le texte n'est pas seul : un FILET horizontal (`tline`) le surmonte. Retirer le texte
//     en laissant le filet donne un tiret blanc suspendu au milieu du noir — *on retire
//     l'objet, pas son libellé.*
//   ③ le groupe `#title` RESTE dans le DOM, vide : l'animation le cherche par id et lui
//     pose une opacité. Le supprimer casserait le script à l'image où il l'anime.
// ⚠️ Le MINUTAGE ne bouge pas (`titleAt`, `fadeOut`, `duration`) : la durée du générique
// décide de celle du film et du fondu musical posé dessus. Un seul réglage par tour.
const TITRE = spec.title ?? 'LA SUITE BIENTÔT';
for (const c of C) c.ly = Math.max(46, Math.min(LAB_FLOOR, c.ly));
// passe remontante : le clamp du bas écrase l'écartement (cf. route.mjs)
for (let i = order.length - 2; i >= 0; i--) {
  const c = order[i], n = order[i + 1];
  if (c.bx[0] < n.bx[1] && n.bx[0] < c.bx[1] && n.ly - c.ly < LAB_DY) c.ly = Math.max(46, n.ly - LAB_DY);
}

// ------------------------------------------------------------------ polices
const esc = (t) => String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const font = (f) => 'data:font/ttf;base64,' + fs.readFileSync(path.join(ASSETS, 'fonts', f)).toString('base64');
const FONT_BOLD = font(spec.fonts?.bold ?? 'Montserrat-ExtraBold.ttf');
const FONT_MED = font(spec.fonts?.medium ?? 'Montserrat-SemiBold.ttf');

// ------------------------------------------------------------------- timings
const T = {
  outline: spec.outlineDraw ?? [0.15, 2.05],
  title: spec.titleAt ?? +(routeEnd + 0.45).toFixed(2),
  fade: spec.fadeOut ?? [(spec.duration ?? 15) - 1.6, spec.duration ?? 15],
  dur: spec.duration ?? 15,
};

// ------------------------------------------------------------------ LÉGENDE
// Le rattachement par épisode se code par la COULEUR du trait (le monteur, 31/08 : « un
// seul tracé, couleur différente par épisode, avec légende »). Une couleur sans
// légende n'est pas un code, c'est une décoration : chaque entrée s'allume au
// moment où SON épisode commence à se tracer — le spectateur apprend le code
// pile quand il en a besoin, et l'épisode 3 ne se dévoile pas d'avance.
const LG = spec.legend ?? null;
const legendItems = LG ? (LG.items ?? []).map((it) => {
  const e = epStyle(it.ep);
  // t = départ du 1er leg de cet épisode ; à défaut (ép. sans leg, ex. le 1er),
  // le pop de sa 1re ville. Sans ça la 1re entrée n'apparaîtrait jamais.
  const lg = legs.find((l) => l.ep === it.ep);
  const cy = C.find((c) => c.ep === it.ep);
  return { ...it, stroke: e.stroke, width: e.width, opacity: e.opacity,
           t: +(lg ? lg.t : (cy ? cy.t : 0)).toFixed(3) };
}) : [];
const legendSvg = !LG ? '' : `<g id="legend">` + legendItems.map((it, i) => {
  const y = (LG.y ?? 800) + i * (LG.gap ?? 46);
  const x = LG.x ?? 70, sw = LG.swatch ?? 46;
  return `<g class="lgi" data-i="${i}" opacity="0">
    <line x1="${x}" y1="${y}" x2="${x + sw}" y2="${y}" stroke="${it.stroke}"
          stroke-width="${it.width}" stroke-linecap="round" stroke-opacity="${it.opacity}"/>
    <text class="lgt" x="${x + sw + 18}" y="${y + 9}" fill="${it.stroke}">${esc(it.text)}</text>
  </g>`;
}).join('') + `</g>`;

const dots = C.map((c, i) => { const e = epStyle(c.ep); return `
  <g class="city" data-i="${i}" opacity="0">
    <circle class="halo" cx="${c.X.toFixed(1)}" cy="${c.Y.toFixed(1)}" r="14" fill="none" stroke="${e.stroke}" stroke-width="1.6" opacity="0"/>
    <circle class="dot"  cx="${c.X.toFixed(1)}" cy="${c.Y.toFixed(1)}" r="6" fill="${e.stroke}"/>
    <path class="leader" d="M${c.X.toFixed(1)},${c.Y.toFixed(1)} L${c.lx.toFixed(1)},${c.ly.toFixed(1)}"
          stroke="${e.stroke}" stroke-width="1.1" opacity="0" fill="none"/>
    <text class="lab" x="${(c.lx + (c.side === 'left' ? -8 : 8)).toFixed(1)}" y="${(c.ly + 10).toFixed(1)}"
          text-anchor="${c.side === 'left' ? 'end' : 'start'}" opacity="0" fill="${e.stroke}">${c.name}</text>
  </g>`; }).join('');

const legPaths = legs.map((l, i) => { const e = epStyle(l.ep); return `<path class="leg" data-i="${i}" fill="none" stroke="${e.stroke}"
   stroke-width="${e.width}" stroke-opacity="${e.opacity}"${e.dash ? ` stroke-dasharray="${e.dash}"` : ''}
   stroke-linecap="round" stroke-linejoin="round" d=""/>`; }).join('');

const html = `<!doctype html><meta charset="utf-8">
<style>
 @font-face{font-family:MB;src:url(${FONT_BOLD}) format('truetype')}
 @font-face{font-family:MM;src:url(${FONT_MED}) format('truetype')}
 html,body{margin:0;padding:0;background:#000;overflow:hidden}
 svg{display:block}
 .lgt{font-family:MM,sans-serif;font-size:${LG?.size ?? 26}px;letter-spacing:.10em;-webkit-font-smoothing:antialiased}
 .lab{font-family:MM,sans-serif;font-size:${FS}px;letter-spacing:.06em;-webkit-font-smoothing:antialiased}
 .title{font-family:MB,sans-serif;font-size:${spec.titleSize ?? 58}px;fill:#fff;letter-spacing:.30em}
</style>
<svg id="svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
 <defs>
  <filter id="glow" x="-70%" y="-70%" width="240%" height="240%">
    <feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
 </defs>
 <rect x="0" y="0" width="${W}" height="${H}" fill="#000"/>
 <g id="stage">
   <!-- pays voisins : contexte muet, jamais dessiné -->
   <path id="others" d="${othersD}" fill="none" stroke="#fff" stroke-width="1" opacity="0"/>
   <path id="heroFill" d="${heroD}" fill="#fff" opacity="0" stroke="none"/>
   <!-- îlots : fondu (ils ne peuvent pas partager le trait continu du continent) -->
   <path id="isles" d="${islesD}" fill="none" stroke="#fff" stroke-width="1.5" opacity="0"/>
   <!-- continent : UN seul sous-chemin → pathLength=1 + dashoffset 1→0 le dessine
        d'un trait, sans redémarrage de pointillé -->
   <path id="hero" d="${mainD}" fill="none" stroke="#fff" stroke-width="1.7"
         pathLength="1" stroke-dasharray="1 1" stroke-dashoffset="1" opacity=".78"/>
   <g id="legs" filter="url(#glow)">${legPaths}</g>
   <circle id="head" r="6" fill="#fff" opacity="0" filter="url(#glow)"/>
   <g id="cities">${dots}</g>
   ${legendSvg}
 </g>
 <g id="title" opacity="0">${!TITRE ? '' : `
   <line id="tline" x1="${W / 2 - 60}" y1="${(spec.titleY ?? 960) - 46}" x2="${W / 2 + 60}" y2="${(spec.titleY ?? 960) - 46}"
         stroke="#fff" stroke-width="1.4" opacity=".55"/>
   <text class="title" x="${W / 2}" y="${spec.titleY ?? 960}" text-anchor="middle" dx="${((spec.titleSize ?? 58) * 0.30 / 2).toFixed(1)}">${TITRE}</text>`}
 </g>
 <rect id="veil" x="0" y="0" width="${W}" height="${H}" fill="#000" opacity="0"/>
</svg>
<script>
const LEGS=${JSON.stringify(legs.map(l => ({ t: l.t, dur: l.dur, pts: l.pts })))};
const CITIES=${JSON.stringify(C.map(c => ({ t: c.t, pop: c.pop ?? 0.40, op: epStyle(c.ep).opacity })))};
const T=${JSON.stringify(T)};
const LEGEND=${JSON.stringify(legendItems.map((it) => ({ t: it.t })))};
const cl=(v)=>Math.max(0,Math.min(1,v));
const outCubic=(u)=>1-Math.pow(1-u,3);
const inOut=(u)=>u<.5?4*u*u*u:1-Math.pow(-2*u+2,3)/2;
const overshoot=(u)=>{const c=1.70158+1;return 1+(c+1)*Math.pow(u-1,3)+c*Math.pow(u-1,2);};
const hero=document.getElementById('hero'), heroFill=document.getElementById('heroFill'),
      isles=document.getElementById('isles'),
      others=document.getElementById('others'), head=document.getElementById('head'),
      title=document.getElementById('title'), veil=document.getElementById('veil'),
      legEls=[...document.querySelectorAll('.leg')], cityEls=[...document.querySelectorAll('.city')],
      lgEls=[...document.querySelectorAll('.lgi')];
function pathPrefix(pts,p){
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
  // 1) la silhouette se DESSINE (dashoffset 1 → 0), puis un remplissage très sourd
  const o=cl((t-T.outline[0])/(T.outline[1]-T.outline[0]));
  hero.setAttribute('stroke-dashoffset',(1-inOut(o)).toFixed(4));
  heroFill.setAttribute('opacity',(0.055*cl((t-T.outline[0]-0.5)/1.2)).toFixed(3));
  isles.setAttribute('opacity',(0.78*cl((t-T.outline[0]-0.9)/0.9)).toFixed(3));
  others.setAttribute('opacity',(0.13*cl((t-T.outline[0]-0.7)/1.4)).toFixed(3));
  // 2) le tracé avance leg par leg
  let tip=null,drawing=false;
  legEls.forEach((el,i)=>{
    const L=LEGS[i], p=cl((t-L.t)/L.dur);
    if(p<=0){el.setAttribute('d','');return;}
    const r=pathPrefix(L.pts,outCubic(p));
    el.setAttribute('d',r.d);
    if(p<1){tip=r.tip;drawing=true;}
  });
  if(drawing&&tip){head.setAttribute('cx',tip[0]);head.setAttribute('cy',tip[1]);head.setAttribute('opacity','1');}
  else head.setAttribute('opacity','0');
  // 3) villes : point qui pope (léger dépassement), halo qui s'ouvre, puis étiquette
  cityEls.forEach((g,i)=>{
    const c=CITIES[i], u=cl((t-c.t)/c.pop);
    if(u<=0){g.setAttribute('opacity','0');return;}
    g.setAttribute('opacity',String(c.op ?? 1));
    const k=overshoot(u);
    g.querySelector('.dot').setAttribute('r',(6*k).toFixed(2));
    g.querySelector('.halo').setAttribute('opacity',(0.5*(1-u)).toFixed(3));
    g.querySelector('.halo').setAttribute('r',(8+26*u).toFixed(1));
    const lu=cl((t-(c.t+0.14))/0.36);
    g.querySelector('.lab').setAttribute('opacity',lu.toFixed(3));
    g.querySelector('.leader').setAttribute('opacity',(0.42*lu).toFixed(3));
  });
  // 4) signature : fondu + légère montée
  const s=cl((t-T.title)/0.85);
  title.setAttribute('opacity',outCubic(s).toFixed(3));
  title.setAttribute('transform','translate(0,'+(16*(1-outCubic(s))).toFixed(2)+')');
  // 5) fondu au noir
  // 4) légende : chaque entrée s'allume au départ de SON épisode
  lgEls.forEach((g,i)=>{ g.setAttribute('opacity', cl((t-LEGEND[i].t)/0.40).toFixed(3)); });
  veil.setAttribute('opacity',cl((t-T.fade[0])/(T.fade[1]-T.fade[0])).toFixed(3));
};
window.__seek(0);
</script>`;
fs.writeFileSync(outPath, html);
console.log('composition →', outPath, '(' + (html.length / 1024).toFixed(0) + ' Ko)');
console.log(`\n  étape                x       y     label   t(pop)   étape suivante`);
for (let i = 0; i < C.length; i++) {
  const c = C[i], l = legs[i];
  console.log('  ' + c.name.padEnd(18) + String(c.X.toFixed(0)).padStart(5)
    + String(c.Y.toFixed(0)).padStart(6) + '  ' + c.side.padEnd(6)
    + String(c.t.toFixed(2)).padStart(7)
    + (l ? `   ${String(l.km).padStart(5)} km → ${l.dur.toFixed(2)} s @ ${l.t.toFixed(2)}` : ''));
}
console.log(`\n  tracé fini ${routeEnd.toFixed(2)} s · titre ${T.title.toFixed(2)} s · fondu ${T.fade[0]}→${T.fade[1]} s · durée ${T.dur} s`);
