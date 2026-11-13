/* ---------- Build config: per-stage links + passive tree (PoB import, voice/pob_import.py) ----------
   BCFG = {sets:[{clean, tag, groups:[{name, links, note, cat, auto, gems:[{n, c, sup, lvl, en}]}]}], specs:[{clean, nodes, treeVersion, classId}],
           stages:{A1:{variants:[{set, spec}]}, …, EM/MM/LM}, active:{EM,MM,LM}}. Stored on its own key (it is big) and exportable. */
const BCFG_KEY = 'poe330_build_cfg_v3';
const STAGE_IDS = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10', 'EM', 'MM', 'LM'];
const STAGE_NAME = { A1: 'Act 1', A2: 'Act 2', A3: 'Act 3', A4: 'Act 4', A5: 'Act 5', A6: 'Act 6', A7: 'Act 7', A8: 'Act 8', A9: 'Act 9', A10: 'Act 10', EM: 'Early maps', MM: 'Mid maps', LM: 'Late maps' };
const CAT_ORDER = ['main', 'movement', 'utility', 'auras', 'curse', 'minions', 'other'];
const CAT_NAME = { main: 'Main attack', movement: 'Movement', utility: 'Utility', auras: 'Auras', curse: 'Curse', minions: 'Minions', other: 'Other' };
const ACT_END_LVL = [12, 23, 33, 40, 45, 50, 55, 60, 64, 69];
const TREES = typeof TREE_DATA !== 'undefined' ? { ...TREE_DATA } : {};
let BCFG = loadBcfg();
const LV = { svgCache: {}, edit: false };

function loadBcfg() {
  try { const r = localStorage.getItem(BCFG_KEY); if (r) return JSON.parse(r); } catch (e) { console.warn('build cfg', e); }
  return typeof DEFAULT_BUILD_CFG !== 'undefined' ? JSON.parse(JSON.stringify(DEFAULT_BUILD_CFG)) : null;
}
function saveBcfg() { LV.svgCache = {}; try { localStorage.setItem(BCFG_KEY, JSON.stringify(BCFG)); } catch (e) { toast('Could not save the build config: ' + e.message, 1); } }
function setBcfg(cfg, why) { BCFG = cfg; BCFG.active = BCFG.active || { EM: 0, MM: 0, LM: 0 }; saveBcfg(); S.linkView = null; save(); renderAll(); if (why) toast(why, 2); }
function resetBcfg() { localStorage.removeItem(BCFG_KEY); BCFG = loadBcfg(); LV.svgCache = {}; S.linkView = null; save(); renderAll(); toast('Build reset to the default (your PoB).', 2); }

/* ---- stages ---- */
function mapStageAuto() { const t = C().band || 0; return t >= 14 ? 'LM' : t >= 6 ? 'MM' : 'EM'; }
function stageAuto() { const a = curAct(); return a <= 10 ? 'A' + a : (S.mapStagePin || mapStageAuto()); }
function stageShown() { return S.linkView || stageAuto(); }
function stageForQuery(q = {}) {
  if (q.stage) return q.stage;
  if (q.act) return 'A' + Math.min(10, Math.max(1, q.act));
  if (q.maps) return curAct() > 10 ? stageAuto() : 'EM';
  if (q.level) { const i = ACT_END_LVL.findIndex((l) => q.level <= l); return i < 0 ? 'EM' : 'A' + (i + 1); }
  return stageAuto();
}
const prevStage = (st) => (st === 'A1' ? null : st === 'EM' ? 'A10' : st === 'MM' ? 'EM' : st === 'LM' ? 'MM' : 'A' + (+st.slice(1) - 1));
function variantOf(st) {
  const s = BCFG && BCFG.stages[st]; if (!s || !s.variants.length) return null;
  return s.variants[Math.min((BCFG.active || {})[st] || 0, s.variants.length - 1)];
}
const setOf = (v) => (v && v.set != null ? BCFG.sets[v.set] : null);
const specOf = (v) => (v && v.spec != null ? BCFG.specs[v.spec] : null);
function groupsOf(st) { const s = setOf(variantOf(st)); return s ? s.groups.filter((g) => g.en !== false && g.gems.length) : []; }
function byCat(st) { const out = {}; for (const g of groupsOf(st)) (out[g.cat] = out[g.cat] || []).push(g); return out; }
function stageTitle(st) { const v = variantOf(st), s = setOf(v); return STAGE_NAME[st] + (st.length === 2 && /M$/.test(st) && s ? ' · ' + s.clean : ''); }

/* ---- spoken answers ---- */
const SAY_FIX = (s) => s.replace(/\bsrs\b/gi, 'SRS').replace(/\bhop\b/gi, 'Herald of Purity');
function noteSpoken(note) {
  if (!note) return '';
  let m = note.match(/^(?:replace|remove|swap)(?: it| this)? when (?:you )?(get|have|find|reach) (.+)$/i);
  if (m) return `until you ${m[1].toLowerCase()} ${SAY_FIX(m[2])}`;
  m = note.match(/^replace (.+?) (after|at|when) (.+)$/i);
  if (m) return `replaces ${SAY_FIX(m[1])} ${m[2].toLowerCase()} ${SAY_FIX(m[3])}`;
  return '(' + SAY_FIX(note) + ')';
}
function groupSpoken(g, withNote = true) {
  const on = g.gems.filter((x) => x.en !== false);
  const act = on.filter((x) => !x.sup).map((x) => x.n), sup = on.filter((x) => x.sup).map((x) => x.n.replace(/ Support$/, ''));
  const head = act.length ? act.join(' and ') : sup.shift() || g.name;
  const tail = sup.length ? ' with ' + (sup.length > 1 ? sup.slice(0, -1).join(', ') + ' and ' + sup.at(-1) : sup[0]) : '';
  const note = withNote && g.note ? ' ' + noteSpoken(g.note) : '';
  return head + tail + note;
}
function linkAnswer(q = {}) {
  if (!BCFG) return 'No build loaded. Import your Path of Building in the Links panel.';
  const st = stageForQuery(q), where = stageTitle(st), cats = byCat(st);
  const focus = q.focus || 'all';
  if (focus === 'spectres') {
    const gs = groupsOf(st).filter((g) => g.gems.some((x) => /Raise Spectre/.test(x.n)));
    return gs.length ? `${where}, spectres: ` + gs.map((g) => groupSpoken(g)).join('. ') + '.' : `${where}: no Raise Spectre in this setup.`;
  }
  if (focus === 'swap') {
    const gs = groupsOf(st).filter((g) => /swap/i.test(g.slot || ''));
    return gs.length ? `${where}, weapon swap: ` + gs.map((g) => groupSpoken(g)).join('. ') + '.' : `${where}: no weapon-swap gems in this setup.`;
  }
  if (q.links && (focus === 'main' || focus === 'all')) {
    // main groups in PoB order ("X until you get SRS, then SRS ..."), skipping ones labelled for a higher level ("Lvl 12 Absolution")
    const lvl = q.level || C().level, all = cats.main || [];
    if (!all.length) return `${where}: no main attack set.`;
    let gs = all.filter((g) => { const m = /\blvl\s*(\d+)/i.exec(g.name || ''); return !m || +m[1] <= lvl; });
    if (!gs.length) gs = all.slice(0, 1);
    const cut = (g) => ({ ...g, gems: g.gems.filter((x) => x.en !== false).slice(0, q.links) });
    const txt = gs.map((g, i) => (i ? 'then ' : '') + groupSpoken(cut(g))).join(', ');
    const short = gs.every((g) => g.gems.filter((x) => x.en !== false).length < q.links) ? ` Fewer than ${q.links} gems in this setup.` : '';
    return SAY_FIX(`${where}${q.level ? ', level ' + q.level : ''}, ${q.links}-link: ${txt}.${short}`).replace(/\.\./g, '.');
  }
  if (focus !== 'all') {
    const gs = cats[focus] || [];
    if (!gs.length) return `${where}: no ${CAT_NAME[focus].toLowerCase()} links in your build${focus === 'curse' && (cats.utility || []).some((g) => g.gems.some((x) => /Conductivity|Despair|Elemental Weakness|Frostbite|Flammability|Vulnerability|Punishment|Temporal Chains|Enfeeble/.test(x.n))) ? '; your curse is in a utility group' : ''}.`;
    const txt = gs.map((g, i) => (i ? (focus === 'main' ? 'Then ' : '') : '') + groupSpoken(g)).join(focus === 'main' ? '. ' : '. ');
    return SAY_FIX(`${where}, ${CAT_NAME[focus].toLowerCase()}: ${txt}.`).replace(/\.\./g, '.');
  }
  const parts = [];
  for (const k of CAT_ORDER) {
    const gs = cats[k]; if (!gs) continue;
    parts.push(`${CAT_NAME[k]}: ` + (k === 'main' ? gs.map((g) => groupSpoken(g, false)).join(', then ') : gs.map((g) => groupSpoken(g, false)).join('; ')));
  }
  let s = `${where}. ` + parts.join('. ') + '.';
  if (s.length > 420) s = s.slice(0, 400).replace(/[;,.]?\s+\S*$/, '') + '. More on screen.';
  return SAY_FIX(s);
}
function mainGemsNow() { const g = (byCat(stageAuto()).main || [])[0]; return g ? g.gems.filter((x) => x.en !== false).map((x) => x.n) : []; }

/* ---- passive tree closeup (SVG) ---- */
async function treeData(ver) {
  if (TREES[ver]) return TREES[ver];
  if (!VOICE.served) return null;
  try { const d = await (await fetch('/api/tree/' + ver)).json(); if (d && d.nodes) { TREES[ver] = d; return d; } } catch (e) { console.warn('tree', e); }
  return null;
}
function treeDiff(st) {
  const sp = specOf(variantOf(st)); if (!sp) return null;
  const pst = prevStage(st), psp = pst ? specOf(variantOf(pst)) : null;
  const alloc = new Set(sp.nodes.map(String)), prev = new Set(psp && psp !== sp ? psp.nodes.map(String) : []);
  const fresh = new Set([...alloc].filter((id) => !prev.has(id)));
  return { sp, psp: psp !== sp ? psp : null, pst, alloc, prev, fresh, ver: sp.treeVersion || BCFG.treeVersion || '3_29' };
}
function treeSvg(T, D, opts = {}) {
  const N = T.nodes, start = T.starts && T.starts[String(D.sp.classId)];
  const isNew = (id) => D.fresh.has(id) && N[id] && N[id][2] !== 's';
  const ptsOf = (ids) => ids.filter((id) => N[id]).map((id) => N[id]);
  // crop: the new nodes, plus the allocated nodes next to them (the path), plus the class start when it is close
  let focus = [...D.fresh].filter((id) => N[id] && N[id][2] !== 's');
  if (!focus.length) focus = [...D.alloc].filter((id) => N[id]);
  let pts = ptsOf(focus);
  if (!pts.length) return '<div class="dim">No tree nodes for this stage.</div>';
  const bb = (ps) => ps.reduce((b, p) => [Math.min(b[0], p[0]), Math.min(b[1], p[1]), Math.max(b[2], p[0]), Math.max(b[3], p[1])], [1e9, 1e9, -1e9, -1e9]);
  let [x0, y0, x1, y1] = bb(pts);
  if (start && N[start]) {
    const s = N[start], w = Math.max(x1 - x0, 1200), h = Math.max(y1 - y0, 900);
    if (s[0] > x0 - w * 0.8 && s[0] < x1 + w * 0.8 && s[1] > y0 - h * 0.8 && s[1] < y1 + h * 0.8) [x0, y0, x1, y1] = [Math.min(x0, s[0]), Math.min(y0, s[1]), Math.max(x1, s[0]), Math.max(y1, s[1])];
  }
  const pad = 260; x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
  let w = x1 - x0, h = y1 - y0;
  const AR = opts.ar || 1.45;                       // keep a landscape box: readable at a glance
  if (w / h < AR) { const nw = h * AR; x0 -= (nw - w) / 2; w = nw; } else { const nh = w / AR; y0 -= (nh - h) / 2; h = nh; }
  if (w < 1700) { const k = 1700 / w; x0 -= (w * k - w) / 2; y0 -= (h * k - h) / 2; w *= k; h *= k; }
  const inBox = (p) => p[0] >= x0 - 200 && p[0] <= x0 + w + 200 && p[1] >= y0 - 200 && p[1] <= y0 + h + 200;
  const px = w / (opts.px || 720);                  // tree units per screen pixel
  const out = [];
  out.push(`<svg class="treesvg" viewBox="${Math.round(x0)} ${Math.round(y0)} ${Math.round(w)} ${Math.round(h)}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Passive tree, ${D.fresh.size} new points">`);
  out.push(`<rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="#0b0d10"/>`);
  const eUn = [], eAl = [], eNew = [];
  for (const e of T.edges) {
    const a = String(e[0]), b = String(e[1]), A = N[a], B = N[b]; if (!A || !B || (!inBox(A) && !inBox(B))) continue;
    if (A[2] === 's' || B[2] === 's') { if (!(D.alloc.has(a) || D.alloc.has(b)) || !(a === start || b === start)) continue; }
    const d = e.length > 2 ? `M${A[0]} ${A[1]}A${e[2]} ${e[2]} 0 0 ${e[3]} ${B[0]} ${B[1]}` : `M${A[0]} ${A[1]}L${B[0]} ${B[1]}`;
    const both = D.alloc.has(a) && D.alloc.has(b);
    (both && (isNew(a) || isNew(b)) ? eNew : both ? eAl : eUn).push(d);
  }
  out.push(`<path d="${eUn.join('')}" stroke="#3b3a34" stroke-width="${(1.6 * px).toFixed(1)}" fill="none"/>`);
  out.push(`<path d="${eAl.join('')}" stroke="#c8a24a" stroke-width="${(3 * px).toFixed(1)}" fill="none"/>`);
  out.push(`<path d="${eNew.join('')}" stroke="#5fe37a" stroke-width="${(3.6 * px).toFixed(1)}" fill="none"/>`);
  const R = { p: 4.5, n: 7.5, k: 10, m: 6.5, j: 6, s: 13 };
  const labels = [];
  for (const id in N) {
    const n = N[id]; if (!inBox(n)) continue;
    const k = n[2], r = (R[k] || 4.5) * px, al = D.alloc.has(id), nw = isNew(id);
    if (k === 'm' && !al) continue;               // unallocated masteries are noise at this zoom
    if (k === 's') {
      if (id !== start) continue;
      out.push(`<circle cx="${n[0]}" cy="${n[1]}" r="${r}" fill="#1a1d22" stroke="#c8a24a" stroke-width="${2 * px}"/><text x="${n[0]}" y="${n[1] + r + 12 * px}" font-size="${11 * px}" fill="#c8a24a" text-anchor="middle">${esc(n[3] || 'Start')}</text>`);
      continue;
    }
    const fill = nw ? '#5fe37a' : al ? '#c8a24a' : '#20252c', stroke = nw ? '#c9ffd3' : al ? '#f0d58a' : '#555b63';
    out.push(`<circle cx="${n[0]}" cy="${n[1]}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${(k === 'n' || k === 'k' ? 1.6 : 1) * px}"${nw && (k === 'n' || k === 'k') ? ` filter="url(#glow)"` : ''}><title>${esc(n[3] || (k === 'p' ? 'Small passive' : ''))}${nw ? ' (new)' : al ? ' (allocated)' : ''}</title></circle>`);
    if ((k === 'n' || k === 'k' || (k === 'm' && nw)) && (al || opts.allLabels)) labels.push({ x: n[0], y: n[1] - r - 4 * px, t: n[3] || '', nw });
  }
  for (const l of labels) {   // keep labels inside the crop (they were clipped at the edges)
    const fs = (l.nw ? 12 : 10.5) * px, half = l.t.length * fs * 0.3 + 4 * px;
    l.x = Math.min(Math.max(l.x, x0 + half), x0 + w - half); l.y = Math.max(l.y, y0 + fs + 2 * px);
  }
  for (const l of labels) out.push(`<text x="${l.x}" y="${l.y}" font-size="${(l.nw ? 12 : 10.5) * px}" font-weight="${l.nw ? 700 : 500}" fill="${l.nw ? '#b8ffc6' : '#e9d9a8'}" stroke="#0b0d10" stroke-width="${3 * px}" paint-order="stroke" text-anchor="middle">${esc(l.t)}</text>`);
  out.push(`<defs><filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${4 * px}" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`);
  out.push('</svg>');
  return out.join('');
}
function treeMini(T, D, box) {   // whole-tree overview with the crop box
  const all = Object.values(T.nodes); let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const n of all) { x0 = Math.min(x0, n[0]); y0 = Math.min(y0, n[1]); x1 = Math.max(x1, n[0]); y1 = Math.max(y1, n[1]); }
  const bg = all.filter((n, i) => i % 3 === 0).map((n) => `<circle cx="${n[0]}" cy="${n[1]}" r="70" fill="#2a2e35"/>`).join('');
  const dots = [...D.alloc].filter((id) => T.nodes[id]).map((id) => { const n = T.nodes[id]; return `<circle cx="${n[0]}" cy="${n[1]}" r="260" fill="${D.fresh.has(id) ? '#5fe37a' : '#c8a24a'}"/>`; }).join('');
  return `<svg class="treemini" viewBox="${x0} ${y0} ${x1 - x0} ${y1 - y0}"><rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="#0b0d10" rx="600"/>${bg}${dots}${box ? `<rect x="${box[0]}" y="${box[1]}" width="${box[2]}" height="${box[3]}" fill="none" stroke="#fff" stroke-width="120" opacity=".6"/>` : ''}</svg>`;
}
async function renderTree(st) {
  const el = $('treeBox'); if (!el) return;
  const D = treeDiff(st);
  if (!D) { el.innerHTML = '<div class="dim">No passive tree mapped to this stage. Assign one in “Edit mapping”.</div>'; $('treeCap').textContent = ''; return; }
  const key = st + '|' + (BCFG.active || {})[st] + '|' + D.sp.clean + '|' + (D.psp ? D.psp.clean : '');
  const T = await treeData(D.ver);
  if (!T) { el.innerHTML = `<div class="dim">Tree data ${esc(D.ver)} not available here (open the tracker through the companion).</div>`; return; }
  if (!LV.svgCache[key]) {
    const svg = treeSvg(T, D, { px: Math.max(480, el.clientWidth || 720) });
    const m = svg.match(/viewBox="([-\d. ]+)"/), box = m ? m[1].split(' ').map(Number) : null;
    LV.svgCache[key] = svg + treeMini(T, D, box);
  }
  if (el.dataset.key !== key) { el.innerHTML = LV.svgCache[key]; el.dataset.key = key; }
  const nb = [...D.fresh].filter((id) => T.nodes[id] && (T.nodes[id][2] === 'n' || T.nodes[id][2] === 'k')).map((id) => T.nodes[id][3]);
  const pts = [...D.fresh].filter((id) => T.nodes[id] && T.nodes[id][2] !== 's' && T.nodes[id][2] !== 'm').length;
  $('treeCap').innerHTML = `<b>${esc(D.sp.clean)}</b>: <span class="ok">+${pts} point${pts === 1 ? '' : 's'}</span>${D.pst ? ` vs ${esc(STAGE_NAME[D.pst])}` : ' from the start'}${nb.length ? ` · new notables: <b>${nb.map(esc).join(', ')}</b>` : ''} <span class="dim">· ${D.alloc.size} allocated · tree ${esc(D.ver)}</span>`;
}

/* ---- right-hand panel ---- */
const GEMDOT = (c) => `<i class="gd gd-${c || 'w'}"></i>`;
function cardHtml(g, si, gi) {
  const sel = LV.edit ? `<select class="catsel" data-cat="${si}:${gi}">${CAT_ORDER.map((k) => `<option value="${k}"${k === g.cat ? ' selected' : ''}>${CAT_NAME[k]}${k === g.auto ? ' (auto)' : ''}</option>`).join('')}</select>` : '';
  const gems = g.gems.map((x) => `<div class="gm${x.sup ? ' sup' : ''}${x.en === false ? ' off' : ''}">${x.sup ? '<span class="tw">└</span>' : ''}${GEMDOT(x.c)}<span>${esc(x.n)}</span>${x.lvl ? `<small>${x.lvl}</small>` : ''}</div>`).join('');
  return `<div class="lcard c-${g.cat}"><div class="lh"><span class="lt">${esc(g.name)}</span>${g.links ? `<span class="badge">${esc(g.links)}</span>` : ''}${g.slot ? `<span class="badge">${esc(g.slot)}</span>` : ''}</div>${g.note ? `<div class="ln">${esc(g.note)}</div>` : ''}${gems}${sel}</div>`;
}
function renderLinks() {
  const box = $('linkCards'); if (!box) return;
  if (!BCFG) { box.innerHTML = '<div class="dim">No build loaded. Paste a PoB code below.</div>'; return; }
  const auto = stageAuto(), st = stageShown();
  $('linkSub').textContent = `${BCFG.name || 'Build'} · ${BCFG.sets.length} skill sets, ${BCFG.specs.length} trees${BCFG.source && BCFG.source.kind === 'default' ? ' · default' : ''}`;
  $('linkStages').innerHTML = STAGE_IDS.map((id) => `<button class="sm${id === st ? ' on' : ''}${id === auto ? ' auto' : ''}" data-lstage="${id}" title="${STAGE_NAME[id]}">${id}</button>`).join('') + (S.linkView ? ' <button class="sm ghost" data-lstage="">back to current</button>' : '');
  const s = BCFG.stages[st] || { variants: [] };
  $('linkVariant').innerHTML = s.variants.length > 1 ? `<label class="dim">Variant <select id="linkVariantSel">${s.variants.map((v, i) => `<option value="${i}"${i === ((BCFG.active || {})[st] || 0) ? ' selected' : ''}>${esc((setOf(v) || {}).clean || 'set ' + i)}${specOf(v) ? ' · tree ' + esc(specOf(v).clean) : ''}</option>`).join('')}</select></label>` : '';
  const v = variantOf(st), set = setOf(v);
  $('linkHead').innerHTML = `<b>${esc(STAGE_NAME[st])}</b>${st === auto ? ' <span class="badge met">now</span>' : ' <span class="badge">browsing</span>'} <span class="dim">${set ? 'skill set “' + esc(set.clean) + '”' : 'no skill set'}${v && v.setInherited ? ' (inherited)' : ''}</span>`;
  if (!set) { box.innerHTML = '<div class="dim">No skill set mapped to this stage.</div>'; }
  else {
    const si = v.set, gs = set.groups.map((g, gi) => [g, gi]).filter(([g]) => g.gems.length);
    gs.sort((a, b) => CAT_ORDER.indexOf(a[0].cat) - CAT_ORDER.indexOf(b[0].cat) || a[1] - b[1]);
    box.innerHTML = gs.map(([g, gi]) => cardHtml(g, si, gi)).join('');
  }
  renderTree(st);
  renderMapping();
}
function renderMapping() {
  const el = $('mapEditor'); if (!el || !BCFG || !LV.edit) { if (el) el.innerHTML = ''; return; }
  const setOpts = (cur) => `<option value="">—</option>` + BCFG.sets.map((s, i) => `<option value="${i}"${i === cur ? ' selected' : ''}>${esc(s.clean)}</option>`).join('');
  const specOpts = (cur) => `<option value="">—</option>` + BCFG.specs.map((s, i) => `<option value="${i}"${i === cur ? ' selected' : ''}>${esc(s.clean)}</option>`).join('');
  el.innerHTML = `<table class="maptab"><tr><th>Stage</th><th>Skill set</th><th>Tree</th><th></th></tr>` + STAGE_IDS.map((st) => (BCFG.stages[st].variants.length ? BCFG.stages[st].variants : [{ set: null, spec: null }]).map((v, i) => `<tr><td>${i ? '' : STAGE_NAME[st]}</td><td><select data-map="${st}:${i}:set">${setOpts(v.set)}</select></td><td><select data-map="${st}:${i}:spec">${specOpts(v.spec)}</select></td><td>${i ? `<button class="sm ghost" data-mapdel="${st}:${i}">×</button>` : `<button class="sm ghost" data-mapadd="${st}" title="add a variant">+</button>`}</td></tr>`).join('')).join('') + '</table>' +
    ((BCFG.unassigned && (BCFG.unassigned.sets.length || BCFG.unassigned.specs.length)) ? `<div class="dim small">Not mapped by title: ${[...BCFG.unassigned.sets.map((i) => BCFG.sets[i].clean), ...BCFG.unassigned.specs.map((i) => 'tree ' + BCFG.specs[i].clean)].map(esc).join(', ')}</div>` : '');
}
function editMapping(key, val) {
  const [st, i, what] = key.split(':'); const s = BCFG.stages[st];
  if (!s.variants.length) s.variants.push({ set: null, spec: null });
  s.variants[+i][what] = val === '' ? null : +val; delete s.variants[+i][what + 'Inherited']; delete s.inherited;
  saveBcfg(); renderLinks();
}
async function importPob(text) {
  const st = $('pobStatus');
  if (!text.trim()) return;
  if (!VOICE.served) { st.innerHTML = '<span class="bad">Import runs in the companion: open the tracker with run.bat (http://127.0.0.1:8765/), or run companion.py --import-pob.</span>'; return; }
  st.textContent = 'Importing…';
  try {
    const r = await (await fetch('/api/pob_import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) })).json();
    if (!r.ok) throw new Error(r.error || 'import failed');
    setBcfg(r.config, 'Build imported.');
    st.innerHTML = `<pre class="small">${esc(r.summary)}</pre>`;
  } catch (e) { st.innerHTML = `<span class="bad">Import failed: ${esc(e.message)}. The PoB import takes a ${esc(ACCEPTS.pob)} (<a href="${POB_GUIDE_URL}" target="_blank" rel="noopener">PoB setup guide</a>).</span>`; }
}
async function adoptCompanionConfig() {   // `companion.py --import-pob` writes voice/build_config.json; adopt it when newer
  if (!VOICE.served) return;
  try {
    const d = await (await fetch('/api/build_config')).json();
    if (!d || d.none || !d.sets) return;
    const t = (d.source || {}).imported || '', mine = (BCFG && BCFG.source && BCFG.source.imported) || '';
    if (t && t > mine) setBcfg(d, 'Loaded the build imported with companion.py --import-pob.');
  } catch (e) { /* offline */ }
}
function exportBcfg() {
  const blob = new Blob([JSON.stringify(BCFG, null, 1)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'poe330_build_config.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
