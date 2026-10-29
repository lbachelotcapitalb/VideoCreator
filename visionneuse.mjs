#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// visionneuse.mjs — bande de montage LÉGÈRE, éditable (lecture + planche + coupes).
//
//   node visionneuse.mjs [--open]     → sert http://localhost:8765
//
// le monteur joue le dernier rendu, voit sa POSITION (tête de lecture) sur la bande, et
// ÉDITE en direct : sélectionne une portion (glisser), CLIC DROIT → couper à la tête
// de lecture / supprimer la sélection / supprimer le plan. « Revenir en arrière »
// annule le dernier geste ; « Sauvegarder » écrit les coupes dans `Réglages/plan.txt`
// (sauvegarde de l'ancien). Les gestes non sauvés vivent dans `Réglages/marques.txt`
// (survivent au rechargement) — Claude les relit aussi. Zéro dépendance, 100% local.
// Ne re-rend PAS : après sauvegarde, demander un rendu (incrémental, rapide via cache).
// ═══════════════════════════════════════════════════════════════════════════
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { TESTS } from './store.mjs';   // chemins du store : un seul endroit
import { charger as chargerCapacites } from './capacites.mjs';   // LA source des compétences

const HOME = os.homedir();
const STORE = path.join(HOME, 'Movies', 'Montage');
const INBOX = path.join(STORE, 'Landscape Rush/Déposer les rushes ici');
const OUT = TESTS;                      // la bande de montage ouvre les rendus de test (cf. store.mjs)
const REGLAGES = path.join(STORE, 'Réglages');
const MARQUES = path.join(REGLAGES, 'marques.txt');
const PLAN_FILE = path.join(REGLAGES, 'plan.txt');
const THUMBS = path.join(HOME, 'Library', 'Application Support', 'Montage', 'viewer', 'thumbs');
const PROJECTS = path.join(HOME, 'Library', 'Application Support', 'Montage', 'projects');
const PORT = 8765;
const SCALE = 14;   // px par seconde sur la bande
const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.avi', '.mkv', '.webm']);

// ---- scope jour + ordre R## : IDENTIQUE au moteur (monte.listRushes) ---------
function readJours() {
  try {
    return fs.readFileSync(path.join(REGLAGES, 'jour.txt'), 'utf8').split('\n')
      .map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
      .map((l) => { let m;
        if ((m = l.match(/^(\d{4})-?(\d{2})-?(\d{2})$/))) return m[1] + m[2] + m[3];
        if ((m = l.match(/^(\d{2})\/(\d{2})\/(\d{4})$/))) return m[3] + m[2] + m[1];
        return l.replace(/\D/g, ''); }).filter((d) => d.length === 8);
  } catch { return []; }
}
// jours depuis un fichier jour.txt arbitraire (instantané d'un montage)
function readJoursFrom(file) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#')).map((l) => { let m;
        if ((m = l.match(/^(\d{4})-?(\d{2})-?(\d{2})$/))) return m[1] + m[2] + m[3];
        if ((m = l.match(/^(\d{2})\/(\d{2})\/(\d{4})$/))) return m[3] + m[2] + m[1];
        return l.replace(/\D/g, ''); }).filter((d) => d.length === 8);
  } catch { return []; }
}
const stampOf = (n) => (n.replace(/^R\d{2,3}_/, '').match(/(\d{14})/) || [])[1] || null;
function listRushes(jours) {
  jours = jours || readJours();
  return fs.readdirSync(INBOX)
    .filter((f) => !f.startsWith('.') && VIDEO_EXT.has(path.extname(f).toLowerCase()))
    .map((f) => ({ f, st: stampOf(f) }))
    .filter((x) => !jours.length || (x.st && jours.includes(x.st.slice(0, 8))))
    .sort((a, b) => (a.st && b.st ? a.st.localeCompare(b.st) : 0))
    .map((x) => x.f);
}
function ffdur(file) {
  const o = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=nw=1:nk=1', file], { encoding: 'utf8' }).stdout || '';
  return parseFloat(o) || 0;
}
// ---- plan.txt → plans ordonnés {rid, ranges, comment, lineIdx} --------------
function readPlanLines(planPath) {
  planPath = planPath || PLAN_FILE;
  if (!fs.existsSync(planPath)) return { lines: [], plans: [] };
  const lines = fs.readFileSync(planPath, 'utf8').split('\n');
  const plans = [];
  lines.forEach((raw, i) => {
    const noc = raw.replace(/#.*$/, '').trim(); if (!noc) return;
    const m = noc.match(/^R?(\d{1,3})\b(.*)$/i); if (!m) return;
    const rest = m[2].trim();
    let ranges = null;
    if (rest) {
      ranges = rest.split(/\s+/).map((t) => {
        const mm = t.match(/^(\d+(?:[.,]\d+)?)[-–](\d+(?:[.,]\d+)?)$/);
        return mm ? [parseFloat(mm[1].replace(',', '.')), parseFloat(mm[2].replace(',', '.'))] : null;
      }).filter(Boolean);
      if (!ranges.length) ranges = null;
    }
    const cm = raw.match(/#(.*)$/);
    plans.push({ rid: parseInt(m[1], 10), ranges, comment: cm ? cm[1].trim() : '', lineIdx: i });
  });
  return { lines, plans };
}
function buildPlans(planPath, jours) {
  const rushes = listRushes(jours);
  const durs = rushes.map((f) => ffdur(path.join(INBOX, f)));
  const { plans: raw } = readPlanLines(planPath);
  let g = 0;
  const plans = raw.map((p) => {
    const idx = p.rid - 1, file = rushes[idx], dur = durs[idx] || 0;
    if (!file) return null;
    let ranges = (p.ranges && p.ranges.length ? p.ranges : [[0, dur]])
      .map(([a, b]) => [Math.max(0, a), Math.min(dur, b)]).filter(([a, b]) => b - a > 0.05);
    if (!ranges.length) ranges = [[0, dur]];
    const kept = ranges.reduce((s, [a, b]) => s + (b - a), 0);
    const rid = 'R' + String(p.rid).padStart(2, '0');
    const start = g; g += kept;
    return { rid, ridN: p.rid, file, dur: +dur.toFixed(3), ranges, kept: +kept.toFixed(3),
      start: +start.toFixed(3), comment: p.comment };
  }).filter(Boolean);
  return { plans, total: +g.toFixed(3) };
}
// tous les rendus de « Landscape Rush » = la liste des montages ouvrables
function listMontages() {
  try {
    return fs.readdirSync(OUT).filter((f) => f.toLowerCase().endsWith('.mp4'))
      .map((f) => { const m = f.match(/(\d{4}-\d{2}-\d{2}-\d{2}-\d{2})/);
        return { name: f, stamp: m ? m[1] : f.replace(/\.mp4$/i, ''), mtime: fs.statSync(path.join(OUT, f)).mtimeMs }; })
      .sort((a, b) => b.mtime - a.mtime);
  } catch { return []; }
}
const montagePath = (stamp) => { const m = listMontages().find((x) => x.stamp === stamp); return m ? path.join(OUT, m.name) : null; };
const latestRender = () => { const m = listMontages(); return m.length ? path.join(OUT, m[0].name) : null; };

function buildModel(stamp) {
  const monts = listMontages();
  const latest = monts[0] || null;
  const target = (stamp && monts.find((m) => m.stamp === stamp)) || latest;
  const isLatest = !!(target && latest && target.stamp === latest.stamp);
  // source du plan pour reconstruire la bande EXACTE de ce montage
  let planPath = PLAN_FILE, jours = readJours(), editable = false, hasSnap = false;
  if (target) {
    const snapPlan = path.join(PROJECTS, target.stamp, 'plan.txt');
    const snapJour = path.join(PROJECTS, target.stamp, 'jour.txt');
    if (isLatest) { editable = true; }                       // le dernier rendu = le montage de travail (éditable)
    else if (fs.existsSync(snapPlan)) { planPath = snapPlan; jours = fs.existsSync(snapJour) ? readJoursFrom(snapJour) : jours; hasSnap = true; }
  }
  const { plans, total } = buildPlans(planPath, jours);
  fs.mkdirSync(THUMBS, { recursive: true });
  for (const p of plans) {
    const key = stampOf(p.file) || p.rid;                    // clé par RUSH → juste quel que soit le jour
    const thumb = path.join(THUMBS, `t_${key}.jpg`);
    if (!fs.existsSync(thumb)) {
      const mid = p.ranges[0][0] + (p.ranges[0][1] - p.ranges[0][0]) / 2;
      spawnSync('ffmpeg', ['-v', 'error', '-ss', mid.toFixed(2), '-i', path.join(INBOX, p.file),
        '-frames:v', '1', '-vf', 'scale=300:-1', '-y', thumb], { stdio: ['ignore', 'ignore', 'ignore'] });
    }
    try { p.thumb = 'data:image/jpeg;base64,' + fs.readFileSync(thumb).toString('base64'); } catch { p.thumb = ''; }
  }
  const renderFile = target ? path.join(OUT, target.name) : null;
  const stale = editable && renderFile && fs.existsSync(PLAN_FILE)
    && fs.statSync(renderFile).mtimeMs < fs.statSync(PLAN_FILE).mtimeMs;
  return { plans, total, scale: SCALE,
    render: target ? target.name : null, stamp: target ? target.stamp : null,
    latestStamp: latest ? latest.stamp : null,
    montages: monts.map((m) => ({ stamp: m.stamp, name: m.name })),
    editable, hasSnap, noPlanche: !!(target && !isLatest && !hasSnap), stale, dels: readDels() };
}

// ---- marques.txt = coupes en attente (lignes « del g1 g2  # label ») --------
function readDels() {
  try {
    return fs.readFileSync(MARQUES, 'utf8').split('\n').map((l) => {
      const m = l.match(/^del\s+([\d.]+)\s+([\d.]+)\s*(?:#\s*(.*))?$/i);
      return m ? { g1: +m[1], g2: +m[2], label: (m[3] || '').trim() } : null;
    }).filter(Boolean);
  } catch { return []; }
}
function writeDels(dels) {
  if (!dels.length) { try { fs.rmSync(MARQUES, { force: true }); } catch {} return; }
  const head = '# Coupes posées à la visionneuse (en attente de sauvegarde/rendu). Claude les relit.\n'
    + '# Format : « del <global_s1> <global_s2>  # libellé ».\n';
  fs.writeFileSync(MARQUES, head + dels.map((d) => `del ${d.g1.toFixed(2)} ${d.g2.toFixed(2)}  # ${d.label}`).join('\n') + '\n');
}

// ---- maths d'intervalles (application des coupes → plan.txt) -----------------
function subtract(ranges, cut) {
  const out = [];
  for (const [a, b] of ranges) {
    if (cut[1] <= a || cut[0] >= b) { out.push([a, b]); continue; }
    if (cut[0] > a) out.push([a, Math.min(cut[0], b)]);
    if (cut[1] < b) out.push([Math.max(cut[1], a), b]);
  }
  return out.filter(([a, b]) => b - a > 0.05);
}
// mappe une coupe GLOBALE [G1,G2] vers les intervalles RUSH à retirer d'un plan
function globalToRush(plan, G1, G2) {
  const o1 = Math.max(0, G1 - plan.start), o2 = Math.min(plan.kept, G2 - plan.start);
  if (o2 <= o1) return [];
  let cum = 0; const rem = [];
  for (const [a, b] of plan.ranges) {
    const len = b - a, s = Math.max(o1, cum), e = Math.min(o2, cum + len);
    if (e > s) rem.push([a + (s - cum), a + (e - cum)]);
    cum += len;
  }
  return rem;
}
const fmtNum = (n) => (+n.toFixed(2)).toString();
function applySave(dels) {
  const { plans } = buildPlans();
  const { lines } = readPlanLines();
  const newLines = lines.slice();
  let kept = 0, removed = 0;
  // recompute chaque plan à partir de SES ranges d'origine moins TOUTES les coupes
  const rawPlans = readPlanLines().plans;
  for (const rp of rawPlans) {
    const P = plans.find((x) => x.ridN === rp.rid); if (!P) continue;
    let R = P.ranges.map(([a, b]) => [a, b]);
    for (const d of dels) for (const cut of globalToRush(P, d.g1, d.g2)) R = subtract(R, cut);
    const orig = lines[rp.lineIdx];
    const comment = (orig.match(/#.*$/) || [''])[0];
    if (!R.length) {                       // plan entièrement retiré → commenté
      newLines[rp.lineIdx] = `# R${String(rp.rid).padStart(2, '0')} ENLEVE (visionneuse) ${comment}`.trimEnd();
      removed++; continue;
    }
    const full = R.length === 1 && R[0][0] <= 0.05 && R[0][1] >= P.dur - 0.05;
    const body = full ? `R${String(rp.rid).padStart(2, '0')}`
      : `R${String(rp.rid).padStart(2, '0')} ` + R.map(([a, b]) => `${fmtNum(a)}-${fmtNum(b)}`).join(' ');
    newLines[rp.lineIdx] = comment ? `${body}   ${comment}` : body;
    kept++;
  }
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  fs.copyFileSync(PLAN_FILE, PLAN_FILE + '.bak-visionneuse');
  fs.writeFileSync(PLAN_FILE, newLines.join('\n').replace(/\n*$/, '\n')
    + `# — édité via la visionneuse le ${stamp} (${kept} plans gardés, ${removed} retirés) —\n`);
  writeDels([]);   // coupes appliquées → on vide les marques
  return { kept, removed };
}

// ---- page -------------------------------------------------------------------
function page(stamp) {
  const data = JSON.stringify(buildModel(stamp));
  return `<!doctype html><html lang=fr><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1"><title>Bande de montage</title>
<style>
:root{--bg:#0f1115;--card:#171a21;--line:#262b36;--txt:#e7eaf0;--mut:#8b93a3;--acc:#7C3AED;--cut:#D33B4D;--ok:#15924E;--amb:#B45309}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--txt);font:14px/1.4 -apple-system,Segoe UI,Roboto,sans-serif}
header{padding:12px 20px;border-bottom:1px solid var(--line);display:flex;gap:16px;align-items:center;flex-wrap:wrap}
h1{font-size:15px;margin:0;font-weight:600}.mut{color:var(--mut)}.warn{color:var(--amb);font-weight:600}
video{width:100%;max-height:52vh;background:#000;display:block}
.wrap{padding:14px 20px}
.row{display:flex;gap:10px;align-items:center;margin:8px 0;flex-wrap:wrap}
.now{font-variant-numeric:tabular-nums;font-weight:700}
.scroll{overflow-x:auto;border:1px solid var(--line);border-radius:10px;background:var(--card)}
.track{position:relative;height:96px;user-select:none;cursor:crosshair}
.blk{position:absolute;top:0;height:96px;border-right:1px solid #0009;overflow:hidden}
.blk img{width:100%;height:96px;object-fit:cover;opacity:.8;pointer-events:none}
.blk .rid{position:absolute;top:3px;left:3px;background:#000b;color:#ffd83b;font-weight:700;font-size:11px;padding:1px 4px;border-radius:4px;pointer-events:none}
.blk .du{position:absolute;bottom:3px;right:4px;background:#000b;font-size:10px;padding:0 3px;border-radius:3px;color:#cfd4de;pointer-events:none}
.blk.sel{outline:3px solid var(--acc);outline-offset:-3px;box-shadow:inset 0 0 0 9999px rgba(124,58,237,.22)}
.del{position:absolute;top:0;height:96px;background:repeating-linear-gradient(45deg,rgba(211,59,77,.35) 0,rgba(211,59,77,.35) 6px,rgba(211,59,77,.15) 6px,rgba(211,59,77,.15) 12px);border-left:2px solid var(--cut);border-right:2px solid var(--cut);pointer-events:none}
.selbox{position:absolute;top:0;height:96px;background:rgba(124,58,237,.20);border:2px solid var(--acc);pointer-events:none}
.ph{position:absolute;top:-4px;height:104px;width:2px;background:#fff;box-shadow:0 0 6px #fff;pointer-events:none;z-index:5}
.ph::before{content:'';position:absolute;top:-1px;left:-4px;border:5px solid transparent;border-top-color:#fff}
button{background:var(--card);color:var(--txt);border:1px solid var(--line);border-radius:8px;padding:8px 12px;font-size:13px;cursor:pointer}
button:hover{border-color:var(--acc)}button.save{border-color:var(--ok)}button.save:hover{background:rgba(21,146,78,.15)}
button:disabled{opacity:.4;cursor:default}
select{background:var(--card);color:var(--txt);border:1px solid var(--line);border-radius:8px;padding:7px 10px;font-size:13px;max-width:340px}
kbd{background:#222834;border:1px solid var(--line);border-radius:4px;padding:1px 5px;font-size:11px}
#menu{position:fixed;z-index:50;background:#1c2029;border:1px solid var(--line);border-radius:8px;padding:5px;display:none;min-width:230px;box-shadow:0 8px 30px #000a}
#menu div{padding:8px 10px;border-radius:6px;cursor:pointer;font-size:13px}#menu div:hover{background:var(--acc)}
#menu div.dis{opacity:.4;pointer-events:none}#menu hr{border:0;border-top:1px solid var(--line);margin:4px 2px}
.marks{white-space:pre-wrap;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 12px;min-height:34px;font-family:ui-monospace,Menlo,monospace;font-size:12.5px}
#cap{position:fixed;inset:0;background:#0f1115ee;z-index:70;display:none;overflow:auto;padding:28px 4vw 60px}
#cap h2{font-size:16px;margin:0 0 4px}#cap .ch{margin:22px 0 8px;padding-top:14px;border-top:1px solid var(--line)}
#cap .ch b{font-size:13.5px;letter-spacing:.04em;text-transform:uppercase}
.capc{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin:7px 0}
.capc.ko{opacity:.55}.capc .t{font-weight:600;font-size:13.5px}.capc .t .st{color:#ffd83b;margin-right:5px}
.capc .r{color:var(--mut);font-size:12.5px;margin:3px 0 6px}
.capc code{display:inline-block;background:#0d1016;border:1px solid var(--line);border-radius:6px;
  padding:4px 8px;font-family:ui-monospace,Menlo,monospace;font-size:12px;cursor:copy;color:#a7f3d0}
.capc code:hover{border-color:var(--acc)}
.capc .d{color:var(--mut);font-size:12px;margin-top:5px}.capc .d i{color:#cfd4de;font-style:normal}
.capc .g{color:var(--amb);font-size:12px;margin-top:4px}.capc .m{color:var(--cut);font-size:12px;margin-top:4px}
#cap .hd{display:flex;gap:14px;align-items:center;position:sticky;top:-28px;background:var(--bg);
  padding:10px 0 12px;margin:-28px 0 0;z-index:2;border-bottom:1px solid var(--line);flex-wrap:wrap}
#cap input{background:var(--card);color:var(--txt);border:1px solid var(--line);border-radius:8px;padding:7px 10px;font-size:13px;min-width:240px}
.toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:var(--ok);color:#fff;padding:10px 16px;border-radius:8px;opacity:0;transition:opacity .2s;z-index:60}
</style></head><body>
<header><h1>🎬 Bande de montage</h1>
  <select id=pick title="Choisir un montage à ouvrir"></select>
  <button id=bnew style="display:none;border-color:var(--ok)" onclick="location.href='/'">🆕 Nouveau rendu — ouvrir</button>
  <button onclick="ouvrirCap()" title="Tout ce que la stack sait faire">🧰 Compétences</button>
  <span class=mut id=meta></span></header>
<video id=v controls preload=metadata></video>
<div class=wrap>
  <div class=row>
    <span class=mut>Plan :</span> <b id=curplan>—</b>
    <span class=mut>· tête de lecture</span> <span class="now" id=curt>0:00.0</span>
    <span style=flex:1></span>
    <button class=save id=bsave onclick=save()>💾 Sauvegarder</button>
    <button id=bundo onclick=undo()>↩︎ Revenir en arrière</button>
  </div>
  <div class=scroll><div class=track id=track></div></div>
  <div class=row style=margin-top:12px><span class=mut>Coupes en attente (dans <code>marques.txt</code>) :</span></div>
  <div class=marks id=marks></div>
</div>
<div id=cap></div>
<div id=menu></div><div class=toast id=toast></div>
<script>
var M=${data}, SC=M.scale, v=document.getElementById('v'), track=document.getElementById('track');
var sel=null;           // sélection {g1,g2}
var selPlan=null;       // plan sélectionné (clic bloc)
function fmt(s){var m=Math.floor(s/60);return m+':'+ (s-m*60).toFixed(1).padStart(4,'0');}
function toast(t){var el=document.getElementById('toast');el.textContent=t;el.style.opacity=1;setTimeout(function(){el.style.opacity=0;},1400);}
// vidéo du montage choisi + sélecteur de montage
v.src='/video?stamp='+encodeURIComponent(M.stamp||'');
var pick=document.getElementById('pick');
M.montages.forEach(function(m){var o=document.createElement('option');o.value=m.stamp;
  o.textContent=m.name.replace(/^Montage /,'').replace(/\\.mp4$/,'');if(m.stamp===M.stamp)o.selected=true;pick.appendChild(o);});
pick.onchange=function(){location.href='/?m='+encodeURIComponent(pick.value);};
document.getElementById('meta').innerHTML=(M.render?'':'<span class=warn>aucun rendu</span>')
  +(M.editable?'':' <span class=warn>· lecture seule</span>')
  +(M.noPlanche?' <span class=warn>· pas de plan mémorisé pour ce rendu (bande approximative)</span>':'')
  +(M.stale?' <span class=warn>· plan modifié depuis ce rendu — demande un rendu</span>':'')
  +' · '+M.plans.length+' plans · '+fmt(M.total);
document.getElementById('bsave').disabled=!M.editable;
// veille : un nouveau rendu est apparu → propose de l'ouvrir
setInterval(function(){fetch('/latest').then(function(r){return r.json();}).then(function(j){
  if(j.stamp&&j.stamp!==M.latestStamp)document.getElementById('bnew').style.display='';});},5000);
track.style.width=Math.max(600,M.total*SC)+'px';
function planAt(t){var c=null;for(var i=0;i<M.plans.length;i++){if(t>=M.plans[i].start)c=M.plans[i];else break;}return c;}
function render(){
  track.innerHTML='';
  M.plans.forEach(function(p){
    var d=document.createElement('div');d.className='blk'+(selPlan&&selPlan.rid===p.rid?' sel':'');
    d.style.left=(p.start*SC)+'px';d.style.width=Math.max(2,p.kept*SC)+'px';d.dataset.rid=p.rid;
    d.innerHTML='<img src="'+(p.thumb||'')+'"><span class=rid>'+p.rid+'</span><span class=du>'+p.kept.toFixed(1)+'s</span>';
    track.appendChild(d);
  });
  M.dels.forEach(function(x){var d=document.createElement('div');d.className='del';
    d.style.left=(x.g1*SC)+'px';d.style.width=Math.max(2,(x.g2-x.g1)*SC)+'px';track.appendChild(d);});
  if(sel){var b=document.createElement('div');b.className='selbox';
    b.style.left=(Math.min(sel.g1,sel.g2)*SC)+'px';b.style.width=(Math.abs(sel.g2-sel.g1)*SC)+'px';track.appendChild(b);}
  var ph=document.createElement('div');ph.className='ph';ph.id='ph';ph.style.left=(v.currentTime*SC)+'px';track.appendChild(ph);
  document.getElementById('bundo').disabled=!M.dels.length;
  var mk=M.dels.map(function(x){return '– '+fmt(x.g1)+' → '+fmt(x.g2)+'   '+x.label;}).join('\\n');
  document.getElementById('marks').textContent=mk||'(aucune)';
}
v.addEventListener('timeupdate',function(){var t=v.currentTime;document.getElementById('curt').textContent=fmt(t);
  var p=planAt(t);document.getElementById('curplan').textContent=p?p.rid:'—';
  var ph=document.getElementById('ph');if(ph)ph.style.left=(t*SC)+'px';});
// --- interactions bande : position TOUJOURS relative au contenu (fix : offsetX était
//     relatif au bloc cliqué → seul le 1er plan était sélectionnable). ---
function posX(e){return e.clientX - track.getBoundingClientRect().left;}
var down=null, menu=document.getElementById('menu');
track.addEventListener('mousedown',function(e){if(e.button!==0)return;var x=posX(e);down={x:x,t:x/SC,moved:false};});
window.addEventListener('mousemove',function(e){if(!down)return;var x=posX(e);if(Math.abs(x-down.x)>4){down.moved=true;sel={g1:down.t,g2:x/SC};selPlan=null;render();}});
window.addEventListener('mouseup',function(){if(!down)return;if(!down.moved){var t=Math.max(0,down.t);v.currentTime=t;sel=null;selPlan=planAt(t);render();}down=null;});
// --- menu contextuel (clic droit) : Couper / Supprimer ---
track.addEventListener('contextmenu',function(e){e.preventDefault();var t=Math.max(0,posX(e)/SC),p=planAt(t);menu.innerHTML='';
  if(M.editable){
    add('✂ Couper ici',!!p,function(){if(p)addDel(t,p.start+p.kept,p.rid+' coupé à '+fmt(t));});
    add('🗑 Supprimer',!!(sel||p),function(){if(sel)addDel(Math.min(sel.g1,sel.g2),Math.max(sel.g1,sel.g2),'sélection');else if(p)addDel(p.start,p.start+p.kept,p.rid+' retiré');});
  }else{
    add('✏️ Éditer ce montage'+(M.hasSnap?'':' (indispo)'),M.hasSnap,activate);
  }
  menu.style.left=e.clientX+'px';menu.style.top=e.clientY+'px';menu.style.display='block';});
function add(label,on,fn){var d=document.createElement('div');d.textContent=label;if(!on)d.className='dis';else d.onclick=function(){menu.style.display='none';fn();};menu.appendChild(d);}
window.addEventListener('click',function(){menu.style.display='none';});
// couper à la tête = retirer de la tête jusqu'à la fin du plan courant (trim)
function cutHead(t){var p=planAt(t);if(!p)return;addDel(t,p.start+p.kept,p.rid+' coupé à '+fmt(t));}
// --- serveur : poser / annuler / sauver ---
function addDel(g1,g2,label){if(!M.editable){toast('lecture seule — « Éditer ce montage » d\\'abord');return;}fetch('/edit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({g1:g1,g2:g2,label:label})}).then(reload);}
function activate(){fetch('/activate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({stamp:M.stamp})}).then(function(r){return r.json();}).then(function(j){if(j.ok)location.href='/';else toast('pas de plan mémorisé pour ce montage');});}
function undo(){fetch('/edit/undo',{method:'POST'}).then(reload);}
function save(){if(!M.dels.length){toast('rien à sauvegarder');return;}
  fetch('/save',{method:'POST'}).then(function(r){return r.json();}).then(function(j){toast('Sauvegardé : '+j.kept+' gardés, '+j.removed+' retirés');reload();});}
function reload(){return fetch('/edits').then(function(r){return r.json();}).then(function(j){M.dels=j.dels;sel=null;render();});}
// raccourcis clavier
document.addEventListener('keydown',function(e){if(/INPUT|TEXTAREA/.test(e.target.tagName))return;
  if(e.key==='c'){cutHead(v.currentTime);}
  if(e.key==='Delete'||e.key==='Backspace'){if(sel){addDel(Math.min(sel.g1,sel.g2),Math.max(sel.g1,sel.g2),'sélection');}else if(selPlan){addDel(selPlan.start,selPlan.start+selPlan.kept,selPlan.rid+' retiré');}}
  if((e.key==='z')&&(e.metaKey||e.ctrlKey)){undo();}});
render();

// ─── Panneau COMPÉTENCES ───────────────────────────────────────────────────
// Lit /capacites, qui rend capacites.json enrichi des prérequis MESURÉS sur CETTE machine.
// Une compétence dont un binaire manque est grisée et dit lequel : mieux vaut le savoir ici
// qu'au milieu d'un rendu.
var CAPS=null;
function ouvrirCap(){
  var el=document.getElementById('cap'); el.style.display='block';
  if(CAPS){rendreCap();return;}
  el.innerHTML='<div class=hd><h2>Chargement…</h2></div>';
  fetch('/capacites').then(function(r){return r.json();}).then(function(j){CAPS=j;rendreCap();})
    .catch(function(e){el.innerHTML='<div class=hd><h2>Compétences indisponibles</h2>'+
      '<button onclick="fermerCap()">Fermer</button></div><p class=mut>'+e.message+'</p>';});
}
function fermerCap(){document.getElementById('cap').style.display='none';}
function rendreCap(filtre){
  var el=document.getElementById('cap'), f=(filtre||'').toLowerCase();
  var prets=CAPS.capacites.filter(function(c){return c.pret;}).length;
  var h='<div class=hd><h2>🧰 Ce que la stack sait faire</h2>'+
        '<span class=mut>'+prets+'/'+CAPS.capacites.length+' prêtes sur cette machine · ★ entrée principale · clic sur une commande = copiée</span>'+
        '<span style=flex:1></span><input id=capq placeholder="filtrer : sous-titre, musique, couper…" value="'+(filtre||'')+'">'+
        '<button onclick="fermerCap()">Fermer</button></div>';
  Object.keys(CAPS.chaines).forEach(function(k){
    var ch=CAPS.chaines[k];
    var caps=CAPS.capacites.filter(function(c){
      if(c.chaine!==k) return false;
      if(!f) return true;
      return (c.titre+' '+c.resume+' '+c.declencheurs.join(' ')+' '+c.cmd).toLowerCase().indexOf(f)>=0;
    });
    if(!caps.length) return;
    h+='<div class=ch><b>'+k+' · '+ch.titre+'</b> <span class=mut>— '+ch.sous_titre+'</span></div>';
    caps.forEach(function(c){
      h+='<div class="capc'+(c.pret?'':' ko')+'">'+
         '<div class=t>'+(c.vedette?'<span class=st>★</span>':'')+esc(c.titre)+'</div>'+
         '<div class=r>'+esc(c.resume)+'</div>'+
         '<code onclick="copier(this)">'+esc(c.cmd)+'</code>'+
         '<div class=d>dis-le comme ça : '+c.declencheurs.map(function(d){return '<i>« '+esc(d)+' »</i>';}).join(' · ')+'</div>'+
         (c.gate?'<div class=g>🛑 '+esc(c.gate)+'</div>':'')+
         (c.pret?'':'<div class=m>⚠ manque sur cette machine : '+esc(c.manquants.join(', '))+'</div>')+
         '</div>';
    });
  });
  el.innerHTML=h;
  var q=document.getElementById('capq');
  q.oninput=function(){var v=q.value;rendreCap(v);var n=document.getElementById('capq');n.focus();n.setSelectionRange(v.length,v.length);};
}
function esc(t){return String(t).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function copier(el){
  var t=el.textContent;
  if(navigator.clipboard) navigator.clipboard.writeText(t);
  else {var a=document.createElement('textarea');a.value=t;document.body.appendChild(a);a.select();document.execCommand('copy');a.remove();}
  toast('commande copiée');
}
document.addEventListener('keydown',function(e){
  if(e.key==='Escape') fermerCap();
  if(e.key==='?'&&e.target.tagName!=='INPUT') ouvrirCap();
});
</script></body></html>`;
}

function serveVideo(req, res) {
  const q = new URL(req.url, 'http://x').searchParams;
  const f = (q.get('stamp') && montagePath(q.get('stamp'))) || latestRender();
  if (!f) { res.writeHead(404); return res.end('aucun rendu'); }
  const size = fs.statSync(f).size, range = req.headers.range;
  if (range) {
    const m = range.match(/bytes=(\d+)-(\d*)/); const s = +m[1], e = m[2] ? +m[2] : size - 1;
    res.writeHead(206, { 'Content-Range': `bytes ${s}-${e}/${size}`, 'Accept-Ranges': 'bytes',
      'Content-Length': e - s + 1, 'Content-Type': 'video/mp4' });
    fs.createReadStream(f, { start: s, end: e }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Length': size, 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes' });
    fs.createReadStream(f).pipe(res);
  }
}
function body(req) { return new Promise((r) => { let b = ''; req.on('data', (c) => b += c); req.on('end', () => r(b)); }); }

http.createServer(async (req, res) => {
  const u = req.url.split('?')[0];
  const q = new URL(req.url, 'http://x').searchParams;
  try {
    if (u === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(page(q.get('m'))); }
    if (u === '/video') return serveVideo(req, res);
    if (u === '/montages') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(listMontages().map((m) => ({ stamp: m.stamp, name: m.name })))); }
    if (u === '/latest') { const m = listMontages()[0]; res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(m ? { stamp: m.stamp, name: m.name } : {})); }
    if (u === '/activate' && req.method === 'POST') {
      const { stamp: s } = JSON.parse(await body(req));
      const sp = path.join(PROJECTS, s, 'plan.txt'), sj = path.join(PROJECTS, s, 'jour.txt');
      if (fs.existsSync(sp)) {
        if (fs.existsSync(PLAN_FILE)) fs.copyFileSync(PLAN_FILE, PLAN_FILE + '.bak-avant-activation');
        fs.copyFileSync(sp, PLAN_FILE);
        if (fs.existsSync(sj)) fs.copyFileSync(sj, path.join(REGLAGES, 'jour.txt'));
        writeDels([]);
        res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: true }));
      }
      res.writeHead(400); return res.end('pas d’instantané');
    }
    if (u === '/edits') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ dels: readDels() })); }
    if (u === '/edit' && req.method === 'POST') {
      const { g1, g2, label } = JSON.parse(await body(req));
      if (g2 - g1 > 0.05) { const d = readDels(); d.push({ g1, g2, label: label || '' }); writeDels(d); }
      res.writeHead(200); return res.end('ok');
    }
    if (u === '/edit/undo' && req.method === 'POST') { const d = readDels(); d.pop(); writeDels(d); res.writeHead(200); return res.end('ok'); }
    if (u === '/edit/clear' && req.method === 'POST') { writeDels([]); res.writeHead(200); return res.end('ok'); }
    if (u === '/save' && req.method === 'POST') {
      const dels = readDels();
      const r = dels.length ? applySave(dels) : { kept: 0, removed: 0 };
      res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(r));
    }
    if (u === '/capacites') {
      // les prérequis se mesurent ICI, pas dans le manifeste : la même stack n'a pas les mêmes
      // binaires sur deux machines, et une compétence annoncée prête qui ne l'est pas ment.
      const man = chargerCapacites();
      const cache = new Map();
      const dispo = (b) => { if (!cache.has(b)) { try { spawnSync('which', [b]); cache.set(b, spawnSync('which', [b]).status === 0); } catch { cache.set(b, false); } } return cache.get(b); };
      const venv = fs.existsSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '.venv-vision/bin/python'));
      const out = { ...man, capacites: man.capacites.map((c) => {
        const manquants = (c.bin || []).filter((b) => !dispo(b));
        if ((c.py || []).length && !venv) manquants.push('environnement python vision');
        return { ...c, pret: manquants.length === 0, manquants };
      }) };
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify(out));
    }
    res.writeHead(404); res.end('nope');
  } catch (e) { res.writeHead(500); res.end('err: ' + e.message); }
}).listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`Bande de montage → ${url}`);
  if (process.argv.includes('--open')) execFile('open', [url]);
});
