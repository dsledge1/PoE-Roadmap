/* ---------- Panel registry + v5 drag-and-drop layout ----------
   Every panel is a <section data-panel="id">; applyLayout() puts them into the four columns in the order of S.layout.cols.
   v5: drag a panel by its header (or the ⠿ handle) to move it; arrow keys on the handle move it too; the Panels menu in the
   header shows / hides panels, moves them with buttons and resets the layout. S.layout = { v: 5, cols, hidden, collapsed }. */
const PANELS = [
  { id: 'pace', name: 'Campaign pace', col: 0 },
  { id: 'next', name: 'Next up', col: 0 },          // v4: above Voice (user request)
  { id: 'voice', name: 'Voice', col: 0 },
  { id: 'log', name: 'Drops & events', col: 1 },
  { id: 'chase', name: 'Power Chase', col: 1 },
  { id: 'defense', name: 'Defense checkpoint', col: 2 },
  { id: 'fates', name: 'Fate bosses', col: 2 },
  { id: 'wiki', name: 'Wiki links', col: 2 },       // v5
  { id: 'links', name: 'Links & tree', col: 3 },
];
function defaultLayout() { const cols = [[], [], [], []]; for (const p of PANELS) cols[p.col].push(p.id); return { v: 5, cols, hidden: [], collapsed: [] }; }
function layout() {
  let L = S.layout;
  if (!L || !Array.isArray(L.cols) || L.cols.length !== 4) L = S.layout = defaultLayout();
  const placed = new Set(L.cols.flat());
  for (const p of PANELS) if (!placed.has(p.id)) L.cols[p.col].push(p.id);   // a panel added in a later version
  L.cols = L.cols.map((c) => c.filter((id, i) => PANELS.some((p) => p.id === id) && c.indexOf(id) === i));
  L.hidden = Array.isArray(L.hidden) ? L.hidden.filter((id) => PANELS.some((p) => p.id === id)) : [];
  L.collapsed = Array.isArray(L.collapsed) ? L.collapsed : [];
  L.v = 5;
  return L;
}
const panelEl = (id) => document.querySelector(`section[data-panel="${id}"]`);
const panelName = (id) => (PANELS.find((p) => p.id === id) || { name: id }).name;
function applyLayout() {
  const L = layout(), cols = [...document.querySelectorAll('main > .col')];
  L.cols.forEach((ids, ci) => { for (const id of ids) { const el = panelEl(id); if (el && cols[ci]) cols[ci].appendChild(el); } });
  for (const p of PANELS) {
    const el = panelEl(p.id); if (!el) continue;
    el.classList.toggle('hidden', L.hidden.includes(p.id));
    el.classList.toggle('collapsed', L.collapsed.includes(p.id));
    const cb = el.querySelector(':scope > h2 .pcollapse'); if (cb) { cb.textContent = L.collapsed.includes(p.id) ? '▸' : '▾'; cb.setAttribute('aria-expanded', String(!L.collapsed.includes(p.id))); }
  }
  renderLayoutMenu();
}
function layoutFromDom() {
  const L = layout();
  L.cols = [...document.querySelectorAll('main > .col')].map((c) => [...c.querySelectorAll(':scope > section[data-panel]')].map((s) => s.dataset.panel));
  return L;
}
function saveLayout() { layoutFromDom(); saveNow(); renderLayoutMenu(); }
function resetLayout() { S.layout = defaultLayout(); saveNow(); applyLayout(); toast('Layout reset to the default.', 3); }
function setHidden(id, hide) {
  const L = layout(); L.hidden = L.hidden.filter((x) => x !== id); if (hide) L.hidden.push(id);
  saveNow(); applyLayout();
}
function showPanel(id) { const L = layout(); if (L.hidden.includes(id) || L.collapsed.includes(id)) { L.hidden = L.hidden.filter((x) => x !== id); L.collapsed = L.collapsed.filter((x) => x !== id); saveNow(); applyLayout(); } }
function toggleCollapse(id) {
  const L = layout(); L.collapsed = L.collapsed.includes(id) ? L.collapsed.filter((x) => x !== id) : [...L.collapsed, id];
  saveNow(); applyLayout();
}
/* move a panel: dy -1/+1 within its column (wrapping into the next/previous column at the ends), dx -1/+1 to the next column */
function movePanel(id, dy, dx = 0) {
  const refocus = document.activeElement && document.activeElement.classList.contains('phandle') && document.activeElement.closest('section[data-panel]')?.dataset.panel === id;
  const L = layoutFromDom(); let ci = L.cols.findIndex((c) => c.includes(id)); if (ci < 0) return;
  let i = L.cols[ci].indexOf(id); L.cols[ci].splice(i, 1);
  if (dx) { ci = Math.max(0, Math.min(3, ci + dx)); i = Math.min(i, L.cols[ci].length); }
  else if (dy < 0) { if (i > 0) i--; else if (ci > 0) { ci--; i = L.cols[ci].length; } }
  else if (dy > 0) { if (i < L.cols[ci].length) i++; else if (ci < 3) { ci++; i = 0; } }
  L.cols[ci].splice(i, 0, id);
  saveNow(); applyLayout();
  const h = panelEl(id)?.querySelector('.phandle'); if (h && refocus) { h.focus({ preventScroll: true }); panelEl(id).scrollIntoView({ block: 'nearest' }); }
}
/* header controls: ⠿ drag handle (also keyboard), ▾ collapse */
function decoratePanels() {
  for (const p of PANELS) {
    const el = panelEl(p.id), h2 = el && el.querySelector(':scope > h2'); if (!h2 || h2.querySelector('.phandle')) continue;
    const hd = document.createElement('button');
    hd.type = 'button'; hd.className = 'phandle'; hd.textContent = '⠿';
    hd.title = `Drag to move the ${p.name} panel (or drag its title). Keyboard: arrow keys move it.`;
    hd.setAttribute('aria-label', `Move the ${p.name} panel`);
    h2.insertBefore(hd, h2.firstChild);
    const cb = document.createElement('button');
    cb.type = 'button'; cb.className = 'pcollapse sm ghost'; cb.textContent = '▾'; cb.dataset.pcollapse = p.id;
    cb.title = `Collapse / expand the ${p.name} panel`; cb.setAttribute('aria-label', cb.title);
    h2.appendChild(cb);
    hd.addEventListener('keydown', (e) => {
      const k = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
      if (k) { e.preventDefault(); movePanel(p.id, k[0], k[1]); }
    });
  }
}
/* pointer drag: press on the handle or the bare title, move > 6 px, the panel follows the pointer between columns (live reorder) */
const DND = { id: null };
const NO_DRAG = 'button:not(.phandle),input,select,textarea,label,a,summary,.seg';
function dndInit() {
  document.querySelector('main').addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const h2 = e.target.closest('section[data-panel] > h2'); if (!h2) return;
    if (e.target.closest(NO_DRAG) && !e.target.closest('.phandle')) return;
    const sec = h2.parentElement;
    DND.id = sec.dataset.panel; DND.x = e.clientX; DND.y = e.clientY; DND.on = false; DND.sec = sec;
    DND.from = { parent: sec.parentElement, next: sec.nextElementSibling };
    if (e.target.closest('.phandle')) e.preventDefault();
  });
  window.addEventListener('pointermove', (e) => {
    if (!DND.id) return;
    if (!DND.on) {
      if (Math.abs(e.clientX - DND.x) + Math.abs(e.clientY - DND.y) < 6) return;
      DND.on = true; DND.sec.classList.add('dragging'); document.body.classList.add('dnd');
      window.getSelection()?.removeAllRanges();
    }
    e.preventDefault();
    DND.px = e.clientX; DND.py = e.clientY;
    dndPlace(e.clientX, e.clientY);
    if (!DND.raf) DND.raf = requestAnimationFrame(dndScroll);
  }, { passive: false });
  const end = (cancel) => {
    if (!DND.id) return;
    const was = DND.on, sec = DND.sec;
    if (was) {
      sec.classList.remove('dragging'); document.body.classList.remove('dnd');
      if (cancel) DND.from.parent.insertBefore(sec, DND.from.next);
      saveLayout();
      if (!cancel) { sec.classList.remove('dropped'); void sec.offsetWidth; sec.classList.add('dropped'); DND.justDropped = true; setTimeout(() => (DND.justDropped = false), 0); }
    }
    DND.id = null; DND.sec = null;
    if (DND.raf) { cancelAnimationFrame(DND.raf); DND.raf = 0; }
  };
  window.addEventListener('pointerup', () => end(false));
  window.addEventListener('pointercancel', () => end(true));
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && DND.on) end(true); });
  document.querySelector('main').addEventListener('click', (e) => {   // swallow the click that ends a drag
    if (DND.justDropped) { e.stopPropagation(); e.preventDefault(); DND.justDropped = false; }
  }, true);
}
/* near the top / bottom edge while dragging, the page scrolls (a long page: move a panel from the bottom to the top) */
function dndScroll() {
  DND.raf = 0; if (!DND.on) return;
  const edge = 60, h = window.innerHeight, y = DND.py;
  const v = y < edge ? -Math.ceil((edge - y) / 3) : y > h - edge ? Math.ceil((y - (h - edge)) / 3) : 0;
  if (v) { const before = window.scrollY; window.scrollBy(0, v); if (window.scrollY !== before) dndPlace(DND.px, DND.py); }
  DND.raf = requestAnimationFrame(dndScroll);
}
function dndPlace(x, y) {
  const cols = [...document.querySelectorAll('main > .col')];
  let col = null, best = Infinity;
  for (const c of cols) {
    const r = c.getBoundingClientRect(); if (!r.width) continue;
    const d = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
    if (d < best) { best = d; col = c; }
  }
  if (!col) return;
  const sec = DND.sec;
  const others = [...col.querySelectorAll(':scope > section[data-panel]')].filter((s) => s !== sec && !s.classList.contains('hidden'));
  let before = null;
  for (const s of others) { const r = s.getBoundingClientRect(); if (y < r.top + r.height / 2) { before = s; break; } }
  if (before ? sec.nextElementSibling !== before || sec.parentElement !== col : sec.parentElement !== col || col.lastElementChild !== sec) {
    if (before) col.insertBefore(sec, before); else col.appendChild(sec);
  }
}
/* the Panels menu in the header: show/hide, move with buttons, reset */
function renderLayoutMenu() {
  const el = $('layoutList'); if (!el) return;
  const L = layout();
  el.innerHTML = L.cols.map((ids, ci) => `<div class="lmcol"><div class="dim small">Column ${ci + 1}</div>` + (ids.length ? ids.map((id) =>
    `<div class="lmrow" data-lmid="${id}"><label title="Show or hide the ${esc(panelName(id))} panel"><input type="checkbox" data-lmshow="${id}"${L.hidden.includes(id) ? '' : ' checked'}> ${esc(panelName(id))}</label><span class="sp"></span>` +
    `<button class="sm ghost" data-lmmove="${id}|-1|0" title="Move up">▲</button><button class="sm ghost" data-lmmove="${id}|1|0" title="Move down">▼</button>` +
    `<button class="sm ghost" data-lmmove="${id}|0|-1" title="Move to the column on the left"${ci === 0 ? ' disabled' : ''}>◀</button><button class="sm ghost" data-lmmove="${id}|0|1" title="Move to the column on the right"${ci === 3 ? ' disabled' : ''}>▶</button></div>`).join('') : '<div class="dim small">(empty)</div>') + '</div>').join('');
}
function bindLayout() {
  decoratePanels(); dndInit();
  on('btnLayoutReset', 'click', () => { if (confirm('Put every panel back where it started and show them all?')) resetLayout(); });
  $('layoutList').addEventListener('change', (e) => { const id = e.target.dataset.lmshow; if (id) setHidden(id, !e.target.checked); });
  $('layoutList').addEventListener('click', (e) => { const m = e.target.dataset.lmmove; if (m) { const [id, dy, dx] = m.split('|'); movePanel(id, +dy, +dx); } });
  document.querySelector('main').addEventListener('click', (e) => { const id = e.target.dataset && e.target.dataset.pcollapse; if (id) toggleCollapse(id); });
}

/* ---------- v4 state upgrade (runs once per load; v3 data keeps working) ---------- */
function ensureV4() {
  const c = C();
  if (!Array.isArray(c.types)) c.types = defaultTypes();
  // an existing (v3) tracker gets the build's template (the example build's list); a brand-new browser starts empty
  if (!Array.isArray(c.chase)) c.chase = window.__poeStored && !S.v4fresh && (S.v || 1) < 4 ? chaseFromTemplate(c.build) : [];
  if (c.chaseOn == null) c.chaseOn = false;
  contentTypes();
  layout();
  S.v = Math.max(S.v || 1, 4);
}

/* ---------- v5 state upgrade: pace target, text size, chase colours / grouping, wiki links, layout v5 ----------
   Everything you already have (log, characters, chase list, drop & event types, settings) is kept as it is. */
const V5_NEW_CONTENT = ['Delirium', 'Ultimatum', 'Sanctum', 'Incursion', 'Bestiary', 'Maps'];
function ensureV5() {
  const was = S.v || 1;
  paceCfg();
  S.ui = Object.assign({ textPct: 100 }, S.ui || {});
  if (!TEXT_STEPS.includes(S.ui.textPct)) S.ui.textPct = nearestStep(S.ui.textPct);
  S.chaseUi = Object.assign({ group: true, filter: '' }, S.chaseUi || {});
  S.ctColors = S.ctColors && typeof S.ctColors === 'object' ? S.ctColors : {};
  S.wikiLinks = Array.isArray(S.wikiLinks) ? S.wikiLinks : [];
  if (was < 5 && Array.isArray(S.contentTypes) && S.contentTypes.length) {   // the v4 list gets the new content types once
    const have = new Set(S.contentTypes.map(ckey)), other = S.contentTypes.indexOf('Other');
    const add = V5_NEW_CONTENT.filter((k) => !have.has(ckey(k)));
    if (add.length) S.contentTypes.splice(other < 0 ? S.contentTypes.length : other, 0, ...add);
  }
  for (const x of chase()) if (!Array.isArray(x.also)) x.also = [];
  layout();
  S.v = Math.max(S.v || 1, 5);
}

/* ---------- v4 profile files: no longer made or offered; Restore backup still reads one (older versions exported one) ---------- */
function profileObj() {
  const c = C();
  return { app: 'poe330-hcssf-tracker', kind: 'profile', version: 4, exported: new Date().toISOString(),
    character: { name: c.name, build: c.build }, buildCfg: BCFG, types: types(), chase: chase(), chaseOn: !!c.chaseOn, contentTypes: contentTypes() };
}
function importProfile(obj) {
  if (!obj || obj.kind !== 'profile' || obj.app !== 'poe330-hcssf-tracker') throw new Error('not a tracker profile (kind "profile")');
  if (!confirm('Load this v4 profile into the current character? It replaces the build (links + tree), drop & event types and the Power Chase list. Your log is kept.')) return false;
  const c = C();
  if (Array.isArray(obj.types)) c.types = obj.types;
  if (Array.isArray(obj.chase)) c.chase = obj.chase.map((x) => ({ id: x.id || uid(), item: String(x.item || ''), content: String(x.content || ''), note: String(x.note || ''), also: Array.isArray(x.also) ? x.also.map(String) : [], done: !!x.done, doneTs: x.doneTs || null })).filter((x) => x.item);
  if (obj.chaseOn != null) c.chaseOn = !!obj.chaseOn;
  if (Array.isArray(obj.contentTypes) && obj.contentTypes.length) S.contentTypes = obj.contentTypes.map(String);
  if (obj.character && obj.character.build && BUILDS.some((b) => b.name === obj.character.build)) c.build = obj.character.build;
  syncTypes();
  if (obj.buildCfg && obj.buildCfg.sets && obj.buildCfg.stages) setBcfg(obj.buildCfg, 'Profile restored.');
  else { save(); renderAll(); toast('Profile restored (no build in it).', 2); }
  return true;
}
/* Another player on this PC/browser: wipe the tracker (log, characters, voice history, build, types, chase) */
function freshProfile() {
  if (!confirm('Start a completely fresh tracker for another player?\n\nThis deletes this browser\'s log, characters, voice history, imported build and lists. Use Download backup first if you want to keep them.')) return;
  if (!confirm('Really wipe everything? This cannot be undone.')) return;
  localStorage.removeItem(STORE_KEY); localStorage.removeItem(BCFG_KEY);
  const keepUi = S.ui;
  S = freshState(); S.v4fresh = true; ensureV4(); ensureV5(); ensureV52(); ensureV53(); S.ui = keepUi || S.ui;
  BCFG = loadBcfg(); LV.svgCache = {};
  indexTriggers(); saveNow(); syncTypes(); applyLayout(); renderSuggest(); renderAll();
  $('pobImport').open = true;
  toast('Fresh tracker. Bring in your build with <b>Import PoB build</b> (PoB code, pobb.in / poe.ninja link or .xml file).', 2);
}
function openOwnPob() {
  showPanel('links');
  const d = $('pobImport'); d.open = true;
  d.scrollIntoView({ block: 'center' }); $('pobText').focus();
}
