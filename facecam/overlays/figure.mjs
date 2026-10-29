#!/usr/bin/env node
// ============================================================================
// facecam/overlays/figure.mjs — COMPOSITION HTML d'un schéma NON cartographique
//
// Troisième moteur de la famille, après `route.mjs` (itinéraire) et `geomap.mjs`
// (pays, corridors, rayons). Ici les formes qui ne sont pas géographiques :
//   bars     barres datées et étiquetées (une skyline EST un histogramme de
//            hauteurs : ça sert autant à comparer deux rives qu'à dater des tours)
//            · `unit` (par groupe) : le suffixe de la valeur. ⚠️ défaut ' m', hérité du
//              premier usage (les tours de Shanghai) et GARDÉ pour que le spec v12 rende
//              à l'identique — un spec livré ne doit pas changer de sens sous lui.
//              Tout nouveau spec pose son `unit` explicitement.
//            · `showVal:false` (par item) : la barre est tracée SANS son chiffre. C'est
//              ce qui permet de comparer deux valeurs quand l'une est PRONONCÉE par le monteur
//              dans le film : on montre le rapport, on ne réécrit pas ce qu'il dit.
//            · `valText` (par item) : le texte de la valeur, si le simple nombre + unité
//              ne suffit pas (« 9 580 € »).
//   curve    courbe qui se trace, avec ses deux bornes chiffrées
//   timeline frise horizontale à jalons datés
//   sketch   schéma tracé à la main (polygones/chemins en repère PANNEAU), pour
//            ce qu'aucun jeu de données local ne contient — un plan de ville par
//            exemple : Natural Earth s'arrête aux frontières, pas aux rues.
//
// Contrat commun aux trois moteurs, et c'est ce qui rend la capture rejouable :
// AUCUNE animation CSS/rAF, tout l'état visuel est fonction de `t` via
// `window.__seek(t)`.
//
// Usage : node figure.mjs <spec.json> [--out composition.html]
// Toutes les coordonnées des blocs sont en repère PANNEAU (0,0 = coin du panneau).
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACCENT_CSS } from '../../profil.mjs';   // l'identité visuelle vit dans le profil

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(HERE, '..', 'assets');
const argv = process.argv.slice(2);
const specPath = argv[0];
if (!specPath) { console.error('usage: figure.mjs <spec.json> [--out out.html]'); process.exit(1); }
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
const outPath = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : specPath.replace(/\.json$/, '.html');
const ACCENT_PROFIL = spec.color ?? ACCENT_CSS;
// `panel: null` = AUCUN encadré : les blocs sont alors posés en coordonnées ABSOLUES
// dans le 1920×1080. Demandé par le monteur pour les logos (« pas d'encadré quand tu donnes
// des logos ») — une marque se pose sur l'image, elle n'a pas besoin d'une carte.
const NU = !spec.panel;
const P = spec.panel ?? { x: 0, y: 0, w: 1920, h: 1080 };

const font = (f) => 'data:font/ttf;base64,' + fs.readFileSync(path.join(ASSETS, 'fonts', f)).toString('base64');
const FB = font(spec.fonts?.bold ?? 'Montserrat-ExtraBold.ttf');
const FM = font(spec.fonts?.medium ?? 'Montserrat-SemiBold.ttf');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const anim = [];            // { sel, t, dur, kind } → piloté par __seek
let svg = '';
let uid = 0;

// ----------------------------------------------------------------- bars
// Un groupe = un titre + n barres. La hauteur est proportionnelle à `v` (m), donc
// deux groupes côte à côte se COMPARENT vraiment (c'est le propos de S1').
for (const g of spec.bars || []) {
  const G = g.box;                                  // {x,y,w,h}
  const vmax = g.vmax ?? Math.max(...g.items.map((i) => i.v));
  const n = g.items.length;
  const gap = g.gap ?? 12;
  const bw = (G.w - gap * (n - 1)) / n;
  svg += `<g class="grp">
   <text class="grpTitle" x="${G.x}" y="${G.y - 42}">${esc(g.title)}</text>
   <text class="grpSub" x="${G.x}" y="${G.y - 16}">${esc(g.sub || '')}</text>
   <line x1="${G.x - 6}" y1="${G.y + G.h}" x2="${G.x + G.w + 6}" y2="${G.y + G.h}" stroke="rgba(255,255,255,.22)" stroke-width="1.5"/>`;
  g.items.forEach((it, k) => {
    const h = Math.max(6, (it.v / vmax) * G.h);
    const x = G.x + k * (bw + gap);
    const y = G.y + G.h - h;
    const id = 'b' + uid++;
    // la barre POUSSE depuis le sol : scale-y ancré en bas (transform-origin en dur,
    // les navigateurs ne l'appliquent pas de façon fiable sur du SVG en % )
    svg += `<g id="${id}" opacity="0">
      <rect class="bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}"
            rx="3" fill="${it.accent ? ACCENT_PROFIL : 'rgba(255,255,255,.30)'}"/>
      <text class="barYear" x="${(x + bw / 2).toFixed(1)}" y="${(G.y + G.h + 30).toFixed(1)}" text-anchor="middle">${esc(it.year)}</text>
      ${it.showVal === false ? '' : `<text class="barVal" x="${(x + bw / 2).toFixed(1)}" y="${(y - 12).toFixed(1)}" text-anchor="middle">${esc(it.valText ?? (it.v + (g.unit ?? ' m')))}</text>`}
     </g>`;
    anim.push({ id, t: it.t, dur: it.dur ?? 0.5, kind: 'grow', x0: x, y1: G.y + G.h, h });
  });
  svg += `</g>`;
}

// ----------------------------------------------------------------- curve
// Deux bornes chiffrées + le tracé qui avance : c'est la forme d'une baisse.
for (const c of spec.curves || []) {
  const C = c.box;
  const xs = c.points.map((p) => p[0]), ys = c.points.map((p) => p[1]);
  const xmin = c.xmin ?? Math.min(...xs), xmax = c.xmax ?? Math.max(...xs);
  const ymin = c.ymin ?? 0, ymax = c.ymax ?? Math.max(...ys) * 1.12;
  const px = (v) => C.x + ((v - xmin) / (xmax - xmin)) * C.w;
  const py = (v) => C.y + C.h - ((v - ymin) / (ymax - ymin)) * C.h;
  const pts = c.points.map(([a, b]) => [+px(a).toFixed(1), +py(b).toFixed(1)]);
  const id = 'c' + uid++;
  svg += `<g>
   <line x1="${C.x}" y1="${C.y + C.h}" x2="${C.x + C.w}" y2="${C.y + C.h}" stroke="rgba(255,255,255,.22)" stroke-width="1.5"/>
   <line x1="${C.x}" y1="${C.y}" x2="${C.x}" y2="${C.y + C.h}" stroke="rgba(255,255,255,.14)" stroke-width="1.5"/>
   <path id="${id}" d="" fill="none" stroke="${ACCENT_PROFIL}" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round"/>`;
  for (const m of c.marks || []) {
    const mid = 'm' + uid++;
    const X = px(m.x), Y = py(m.y);
    svg += `<g id="${mid}" opacity="0">
      <circle cx="${X.toFixed(1)}" cy="${Y.toFixed(1)}" r="8" fill="${ACCENT_PROFIL}" stroke="#0b0d13" stroke-width="3"/>
      <text class="markVal" x="${X.toFixed(1)}" y="${(Y + (m.below ? 46 : -26)).toFixed(1)}" text-anchor="${m.anchor || 'middle'}">${esc(m.value)}</text>
      <text class="markLab" x="${X.toFixed(1)}" y="${(Y + (m.below ? 74 : -2)).toFixed(1)}" text-anchor="${m.anchor || 'middle'}">${esc(m.label)}</text>
     </g>`;
    anim.push({ id: mid, t: m.t, dur: 0.4, kind: 'fade' });
  }
  svg += `</g>`;
  anim.push({ id, t: c.t, dur: c.dur ?? 1.4, kind: 'draw', pts });
}

// -------------------------------------------------------------- timeline
for (const tl of spec.timelines || []) {
  const T = tl.box;                                  // {x,y,w}
  svg += `<g><line x1="${T.x}" y1="${T.y}" x2="${T.x + T.w}" y2="${T.y}" stroke="rgba(255,255,255,.20)" stroke-width="2"/>`;
  const y0 = tl.years[0], y1 = tl.years[1];
  for (const j of tl.marks) {
    const X = T.x + ((j.year - y0) / (y1 - y0)) * T.w;
    const id = 'j' + uid++;
    const up = j.up !== false;
    svg += `<g id="${id}" opacity="0">
      <line x1="${X.toFixed(1)}" y1="${T.y}" x2="${X.toFixed(1)}" y2="${(T.y + (up ? -20 : 20)).toFixed(1)}" stroke="${ACCENT_PROFIL}" stroke-width="2.4"/>
      <circle cx="${X.toFixed(1)}" cy="${T.y}" r="6.5" fill="${ACCENT_PROFIL}" stroke="#0b0d13" stroke-width="2.6"/>
      <text class="jYear" x="${X.toFixed(1)}" y="${(T.y + (up ? -32 : 50)).toFixed(1)}" text-anchor="${j.anchor || 'middle'}">${esc(j.year)}</text>
      <text class="jLab"  x="${X.toFixed(1)}" y="${(T.y + (up ? -58 : 76)).toFixed(1)}" text-anchor="${j.anchor || 'middle'}">${esc(j.label)}</text>
     </g>`;
    anim.push({ id, t: j.t, dur: 0.42, kind: 'fade' });
  }
  svg += `</g>`;
}

// ---------------------------------------------------------------- sketch
// Schéma dessiné : ce que les assets locaux ne contiennent pas (un plan de ville).
// Chaque élément a son propre timecode → le schéma se CONSTRUIT, il n'apparaît pas.
for (const sk of spec.sketches || []) {
  for (const el of sk.items) {
    const id = 's' + uid++;
    const style = el.kind === 'zone'
      ? `fill="${el.accent ? 'rgba(218,165,32,.22)' : 'rgba(255,255,255,.07)'}" stroke="${el.accent ? ACCENT_PROFIL : 'rgba(255,255,255,.34)'}" stroke-width="${el.accent ? 2.4 : 1.6}"`
      : el.kind === 'water'
        ? `fill="rgba(96,132,178,.30)" stroke="rgba(140,180,225,.45)" stroke-width="1.6"`
        : `fill="none" stroke="${el.accent ? ACCENT_PROFIL : 'rgba(255,255,255,.5)'}" stroke-width="${el.w ?? 3}"${el.dash ? ` stroke-dasharray="${el.dash}"` : ''}`;
    svg += `<g id="${id}" opacity="0"><path d="${el.d}" ${style} stroke-linejoin="round" stroke-linecap="round"/>`;
    if (el.text) svg += `<text class="skLab" x="${el.tx}" y="${el.ty}" text-anchor="${el.anchor || 'middle'}"${el.accent ? ` fill="${ACCENT_PROFIL}"` : ''}>${esc(el.text)}</text>`;
    svg += `</g>`;
    anim.push({ id, t: el.t, dur: el.dur ?? 0.45, kind: 'fade' });
  }
}

// ------------------------------------------------------------------ notes
// `*…*` met le fragment en ACCENT_PROFIL GRAS *dans* la phrase : un chiffre doit ressortir
// sans qu'on ait à le sortir de sa phrase. C'est ce qui permet un encadré unique
// portant une phrase courte plutôt que deux vignettes de chiffres nus.
const emph = (s) => esc(s).split(/\*/).map((part, i) =>
  i % 2 ? `<tspan class="em">${part}</tspan>` : part).join('');
for (const nt of spec.notes || []) {
  const id = 'n' + uid++;
  const size = nt.size ? ` font-size="${nt.size}"` : '';
  svg += `<text id="${id}" class="note${nt.accent ? ' noteAcc' : ''}" x="${nt.x}" y="${nt.y}"${size} opacity="0"${nt.anchor ? ` text-anchor="${nt.anchor}"` : ''}>${emph(nt.text)}</text>`;
  anim.push({ id, t: nt.t, dur: nt.dur ?? 0.45, kind: 'fade' });
}

// ------------------------------------------------------------------ logos
// Un logo de marque vaut mieux qu'un nom composé : on cite QUI a fait la chose.
// Les SVG (assets/logos/) sont dépouillés de leurs `fill` pour être teintés en
// blanc — sinon un logo à aplats sombres disparaît sur la carte sombre.
for (const lg of spec.logos || []) {
  const p = path.join(ASSETS, 'logos', lg.file + '.svg');
  if (!fs.existsSync(p)) { console.error(`⚠️  logo introuvable : ${p}`); continue; }
  const raw = fs.readFileSync(p, 'utf8');
  const vb = (raw.match(/viewBox="([^"]+)"/) || [])[1];
  if (!vb) { console.error(`⚠️  ${lg.file}.svg sans viewBox — non exploitable`); continue; }
  const [vx, vy, vw, vh] = vb.split(/[\s,]+/).map(Number);
  // ⚠️ NE PAS toucher aux `fill="none"` : le SVG Alstom porte un rect de cadrage
  // transparent que le dépouillement rendait opaque — il devenait un bloc blanc
  // qui masquait entièrement le mot. On ne retire que les fills de COULEUR.
  // ⚠️ ERREUR CORRIGÉE : la version précédente SUPPRIMAIT les formes peintes par un
  // dégradé, en les prenant pour des scories. Le « rectangle fantôme » que je voyais
  // à gauche de JCDecaux était en fait LE CADRE EN ANGLE DE SON LOGO. On ne jette
  // plus rien : on REMAPPE les couleurs (`colorMap`), fills et arrêts de dégradé
  // compris, pour qu'un logo sombre reste lisible sur une image sombre tout en
  // gardant ce qui l'identifie (l'anneau rouge d'Alstom, par exemple).
  let inner = (raw.match(/<svg[^>]*>([\s\S]*)<\/svg>/) || [, ''])[1]
    .replace(/<\?xml[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  const map = lg.colorMap;
  if (map) {
    for (const [de, vers] of Object.entries(map)) {
      const re = new RegExp(de.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      inner = inner.replace(re, vers);
    }
  } else {
    // sans colorMap : teinte monochrome (les fills de couleur sautent et le groupe
    // impose sa couleur). `fill="none"` est PRÉSERVÉ — sur Alstom c'est le rect de
    // cadrage, et le rendre opaque produisait un bloc blanc masquant tout le mot.
    inner = inner.replace(/\sfill="(?!none)(?!url\()[^"]*"/g, '')
      .replace(/fill\s*:\s*(?!none)(?!url\()[^;"]*;?/g, '');
  }
  const B = lg.box, pad = lg.pad ?? 34;
  const s = Math.min((B.w - 2 * pad) / vw, (B.h - 2 * pad) / vh);
  const ox = B.x + (B.w - vw * s) / 2 - vx * s;
  const oy = B.y + (B.h - vh * s) / 2 - vy * s;
  const id = 'g' + uid++;
  // sans encadré, le logo est seul face au décor : une ombre portée douce lui donne
  // le contraste que la carte fournissait avant (bambous de nuit = fond bruité).
  const ombre = lg.shadow === false ? '' : ' filter="url(#logoSoft)"';
  svg += `<g id="${id}" opacity="0"${ombre}><g transform="translate(${ox.toFixed(1)},${oy.toFixed(1)}) scale(${s.toFixed(4)})" fill="${lg.color ?? '#ffffff'}">${inner}</g></g>`;
  anim.push({ id, t: lg.t, dur: lg.dur ?? 0.45, kind: 'fade' });
  console.log(`  logo ${lg.file} : viewBox ${vw}×${vh} → ×${s.toFixed(3)} dans ${B.w}×${B.h}`);
}

const html = `<!doctype html><meta charset="utf-8">
<style>
 @font-face{font-family:MB;src:url(${FB}) format('truetype')}
 @font-face{font-family:MM;src:url(${FM}) format('truetype')}
 html,body{margin:0;padding:0;background:transparent;overflow:hidden}
 svg{display:block}
 text{font-family:MB,sans-serif;-webkit-font-smoothing:antialiased}
 .kicker{font-family:MM;font-size:23px;letter-spacing:.22em;fill:${ACCENT_PROFIL}}
 .sub{font-family:MM;font-size:22px;fill:rgba(255,255,255,.68);letter-spacing:.04em}
 .grpTitle{font-size:27px;fill:#fff;letter-spacing:.02em}
 .grpSub{font-family:MM;font-size:20px;fill:rgba(255,255,255,.60)}
 .barYear{font-family:MM;font-size:20px;fill:rgba(255,255,255,.72)}
 .barVal{font-family:MB;font-size:20px;fill:${ACCENT_PROFIL}}
 .markVal{font-family:MB;font-size:34px;fill:${ACCENT_PROFIL}}
 .markLab{font-family:MM;font-size:21px;fill:rgba(255,255,255,.72)}
 .jYear{font-family:MB;font-size:24px;fill:${ACCENT_PROFIL}}
 .jLab{font-family:MM;font-size:20px;fill:rgba(255,255,255,.80)}
 .skLab{font-family:MM;font-size:21px;fill:rgba(255,255,255,.84)}
 .note{font-family:MM;font-size:22px;fill:rgba(255,255,255,.88)}
 .noteAcc{font-family:MB;font-size:24px;fill:${ACCENT_PROFIL}}
 .em{font-family:MB;fill:${ACCENT_PROFIL}}
</style>
<svg width="1920" height="1080" viewBox="0 0 1920 1080" xmlns="http://www.w3.org/2000/svg">
 <defs>
  <linearGradient id="accent" x1="0" y1="0" x2="0" y2="1">
   <stop offset="0" stop-color="${ACCENT_PROFIL}" stop-opacity="0"/>
   <stop offset=".35" stop-color="${ACCENT_PROFIL}" stop-opacity=".95"/>
   <stop offset="1" stop-color="${ACCENT_PROFIL}" stop-opacity="0"/>
  </linearGradient>
  <!-- ombre courte VOLONTAIREMENT : son halo compte dans le dégagement au sujet -->
  <filter id="soft" x="-30%" y="-30%" width="160%" height="160%">
   <feDropShadow dx="0" dy="6" stdDeviation="11" flood-color="#000" flood-opacity=".5"/>
  </filter>
  <!-- pour un logo posé SANS carte : deux ombres, une serrée pour détacher le tracé
       du décor, une large pour asseoir la marque sans dessiner de rectangle. -->
  <filter id="logoSoft" x="-40%" y="-40%" width="180%" height="180%">
   <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#000" flood-opacity=".85"/>
   <feDropShadow dx="0" dy="6" stdDeviation="16" flood-color="#000" flood-opacity=".6"/>
  </filter>
 </defs>
 <g id="panel" transform="translate(${P.x},${P.y})">
  ${NU ? '' : `<g filter="url(#soft)"><rect width="${P.w}" height="${P.h}" rx="30" fill="rgba(9,11,16,.84)"/></g>
  <rect width="${P.w}" height="${P.h}" rx="30" fill="none" stroke="rgba(255,255,255,.17)" stroke-width="1.5"/>`}
  ${spec.kicker ? `<text class="kicker" x="34" y="62">${esc(spec.kicker)}</text>` : ''}
  ${spec.sub ? `<text class="sub" x="34" y="94">${esc(spec.sub)}</text>` : ''}
  ${spec.kicker ? `<line x1="34" y1="118" x2="${P.w - 34}" y2="118" stroke="rgba(255,255,255,.10)" stroke-width="1.5"/>` : ''}
  ${svg}
 </g>
</svg>
<script>
const SPAN=${JSON.stringify(spec.span)};
const IN=${JSON.stringify(spec.panelIn)}, OUT=${JSON.stringify(spec.panelOut)};
const A=${JSON.stringify(anim)};
const P={x:${P.x},y:${P.y}};
const SLIDE=${spec.slideFrom ?? (P.x + P.w / 2 > 960 ? 28 : -28)};
const cl=(v)=>Math.max(0,Math.min(1,v));
const outCubic=(u)=>1-Math.pow(1-u,3);
const panel=document.getElementById('panel');
const els=A.map(a=>document.getElementById(a.id));
function prefix(pts,p){
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
  panel.setAttribute('opacity',(outCubic(a)*(1-b)).toFixed(3));
  panel.setAttribute('transform','translate('+(P.x+SLIDE*(1-outCubic(a))).toFixed(2)+','+P.y+')');
  A.forEach((o,i)=>{
    const el=els[i]; if(!el) return;
    const u=outCubic(cl((t-o.t)/o.dur));
    if(o.kind==='draw'){ el.setAttribute('d', u<=0?'':prefix(o.pts,u)); return; }
    el.setAttribute('opacity',u.toFixed(3));
    // la barre pousse depuis le sol : on compose la mise à l'échelle autour de y1
    if(o.kind==='grow') el.setAttribute('transform',
      'translate(0,'+(o.y1*(1-u)).toFixed(2)+') scale(1,'+Math.max(0.001,u).toFixed(4)+')');
  });
};
window.__seek(SPAN[0]);
</script>`;
fs.writeFileSync(outPath, html);
console.log('composition →', outPath, '(' + (html.length / 1024).toFixed(0) + ' Ko)');
console.log(`  barres: ${(spec.bars || []).reduce((n, g) => n + g.items.length, 0)} · courbes: ${(spec.curves || []).length} · frises: ${(spec.timelines || []).length} · schéma: ${(spec.sketches || []).reduce((n, s) => n + s.items.length, 0)} · notes: ${(spec.notes || []).length}`);
console.log(`  ${anim.length} éléments animés, de t=${Math.min(...anim.map((a) => a.t)).toFixed(2)} à t=${Math.max(...anim.map((a) => a.t)).toFixed(2)}`);
