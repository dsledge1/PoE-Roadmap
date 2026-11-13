/* ---------- v4: panel registry (groundwork for drag-and-drop) + profiles ----------
   Every panel is a <section data-panel="id">; applyLayout() puts them into the four columns in the order of
   S.layout.cols (falls back to PANELS). A later drag-and-drop only has to rewrite S.layout and call applyLayout(). */
const PANELS = [
  { id: 'pace', name: 'Campaign pace', col: 0 },
  { id: 'next', name: 'Next up', col: 0 },          // v4: above Voice (user request)
  { id: 'voice', name: 'Voice', col: 0 },
  { id: 'log', name: 'Drops & events', col: 1 },
  { id: 'chase', name: 'Power Chase', col: 1 },
  { id: 'defense', name: 'Defense checkpoint', col: 2 },
  { id: 'fates', name: 'Fate bosses', col: 2 },
  { id: 'links', name: 'Links & tree', col: 3 },
];
function defaultLayout() { const cols = [[], [], [], []]; for (const p of PANELS) cols[p.col].push(p.id); return { v: 4, cols, hidden: [] }; }
function layout() {
  let L = S.layout;
  if (!L || !Array.isArray(L.cols) || L.cols.length !== 4) L = S.layout = defaultLayout();
  const placed = new Set(L.cols.flat());
  for (const p of PANELS) if (!placed.has(p.id)) L.cols[p.col].push(p.id);   // a panel added in a later version
  L.cols = L.cols.map((c) => c.filter((id) => PANELS.some((p) => p.id === id)));
  L.hidden = Array.isArray(L.hidden) ? L.hidden : [];
  return L;
}
function applyLayout() {
  const L = layout(), cols = [...document.querySelectorAll('main > .col')];
  L.cols.forEach((ids, ci) => { for (const id of ids) { const el = document.querySelector(`section[data-panel="${id}"]`); if (el && cols[ci]) cols[ci].appendChild(el); } });
  for (const p of PANELS) { const el = document.querySelector(`section[data-panel="${p.id}"]`); if (el) el.classList.toggle('hidden', L.hidden.includes(p.id)); }
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

/* ---------- profiles: build config + drop/event types + Power Chase, as one JSON file ---------- */
function profileObj() {
  const c = C();
  return { app: 'poe330-hcssf-tracker', kind: 'profile', version: 4, exported: new Date().toISOString(),
    character: { name: c.name, build: c.build }, buildCfg: BCFG, types: types(), chase: chase(), chaseOn: !!c.chaseOn, contentTypes: contentTypes() };
}
function exportProfile() { download(`poe_profile_${(C().name || 'player').replace(/[^\w-]+/g, '_')}_${stamp()}.json`, JSON.stringify(profileObj(), null, 1)); }
function importProfile(obj) {
  if (!obj || obj.kind !== 'profile' || obj.app !== 'poe330-hcssf-tracker') throw new Error('not a tracker profile (kind "profile")');
  if (!confirm('Load this profile into the current character? It replaces the build (links + tree), drop & event types and the Power Chase list. Your log is kept.')) return;
  const c = C();
  if (Array.isArray(obj.types)) c.types = obj.types;
  if (Array.isArray(obj.chase)) c.chase = obj.chase.map((x) => ({ id: x.id || uid(), item: String(x.item || ''), content: String(x.content || ''), note: String(x.note || ''), done: !!x.done, doneTs: x.doneTs || null })).filter((x) => x.item);
  if (obj.chaseOn != null) c.chaseOn = !!obj.chaseOn;
  if (Array.isArray(obj.contentTypes) && obj.contentTypes.length) S.contentTypes = obj.contentTypes.map(String);
  if (obj.character && obj.character.build && BUILDS.some((b) => b.name === obj.character.build)) c.build = obj.character.build;
  syncTypes();
  if (obj.buildCfg && obj.buildCfg.sets && obj.buildCfg.stages) setBcfg(obj.buildCfg, 'Profile loaded.');
  else { save(); renderAll(); toast('Profile loaded (no build in it).', 2); }
}
/* Another player on this PC/browser: wipe the tracker (log, characters, voice history, build, types, chase) */
function freshProfile() {
  if (!confirm('Start a completely fresh tracker for another player?\n\nThis deletes this browser\'s log, characters, voice history, imported build and lists. Export first if you want to keep them.')) return;
  if (!confirm('Really wipe everything? This cannot be undone.')) return;
  localStorage.removeItem(STORE_KEY); localStorage.removeItem(BCFG_KEY);
  S = freshState(); S.v4fresh = true; ensureV4();
  BCFG = loadBcfg(); LV.svgCache = {};
  indexTriggers(); saveNow(); syncTypes(); applyLayout(); renderSuggest(); renderAll();
  $('pobImport').open = true;
  toast('Fresh tracker. Paste your own PoB in Links &amp; tree → “Use my own PoB”.', 2);
}
function openOwnPob() {
  const d = $('pobImport'); d.open = true;
  d.scrollIntoView({ block: 'center' }); $('pobText').focus();
}
