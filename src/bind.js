/* ---------- Export / import ---------- */
function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function stamp() { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`; }
/* ---------- Import checks: each control says what it takes, and the wrong file gets a friendly message ---------- */
const POB_GUIDE_URL = 'https://github.com/dsledge1/PoE-Roadmap/blob/main/docs/POB_GUIDE.md';
const ACCEPTS = { pob: 'PoB export code, pobb.in or poe.ninja/pob link, or .xml file' };
function fileExt(name) { const m = /\.([a-z0-9]+)$/i.exec(name || ''); return m ? m[1].toLowerCase() : ''; }
function sniffJson(text) { const t = String(text || '').trim(); if (!/^[{[]/.test(t)) return null; try { return JSON.parse(t); } catch { return undefined; } }
function jsonKind(o) {
  if (!o || typeof o !== 'object') return 'json';
  if (o.kind === 'profile') return 'profile';
  if (o.sets && o.stages) return 'bcfg';
  if ((o.state && o.state.char) || (o.char && Array.isArray(o.log))) return 'log';
  if (Array.isArray(o.triggers)) return 'triggers';
  return 'json';
}
const JSON_HOME = { profile: 'It looks like a v4 tracker profile: use Character → Advanced → Restore backup.', bcfg: 'It looks like an old build config file: import the PoB build itself (code, link or .xml) instead.',
  log: 'It looks like a tracker backup: use Character → Advanced → Restore backup.', triggers: 'Trigger files aren\'t imported any more.', json: '' };
/* '' when the text (and optional file name) looks like something the PoB import takes, else a plain-language reason */
function pobInputProblem(text, name) {
  const ext = fileExt(name), t = String(text || '').trim(), takes = `The PoB import takes a ${ACCEPTS.pob}.`;
  const j = sniffJson(t);
  if (ext === 'json' || j !== null) return `That's JSON, not a Path of Building build. ${takes} ${JSON_HOME[j ? jsonKind(j) : 'json']}`.trim();
  if (name && ext !== 'xml') return `A .${ext || '?'} file can't be imported as a PoB. ${takes} In Path of Building, save the build and pick its .xml file (Documents\\Path of Building\\Builds).`;
  if (!t) return name ? 'That file is empty.' : `Nothing to import yet. Paste a ${ACCEPTS.pob}.`;
  if (t.startsWith('<')) return /<PathOfBuilding[\s>]/.test(t) ? '' : `That XML isn't a Path of Building build (no <PathOfBuilding> element). ${takes}`;
  if (/^(https?:\/\/)?(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+\//i.test(t))
    return /^(https?:\/\/)?(www\.)?(pobb\.in\/|poe\.ninja\/(poe1\/)?pob\/)/i.test(t) ? '' : `Only pobb.in and poe.ninja/pob links work. For other sites, open the build in Path of Building and copy its export code (Import/Export Build → Generate).`;
  const code = t.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/=_-]+$/.test(code) || code.length < 40) return `That doesn't look like a PoB export code. ${takes} In Path of Building: Import/Export Build → Generate → Copy.`;
  return '';
}
/* the same for a file picked or dropped on a JSON-only control ('profile' or 'bcfg'); returns [problem, parsedObject] */
function showImportError(statusId, msg) { const el = $(statusId); if (el) el.innerHTML = `<span class="bad">${esc(msg)}</span>`; toast(esc(msg), 2); }
function readText(input, cb) {
  const f = input.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => { try { cb(String(r.result || ''), f.name); } catch (e) { toast('Import failed: ' + esc(e.message), 1); } input.value = ''; };
  r.readAsText(f);
}
function importPobFile(text, name) {
  const p = pobInputProblem(text, name);
  if (p) return showImportError('pobStatus', p);
  $('pobText').value = text; importPob(text);
}
function dropFile(el, cb) {
  el.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); el.classList.add('drop'); } });
  el.addEventListener('dragleave', () => el.classList.remove('drop'));
  el.addEventListener('drop', (e) => {
    const f = e.dataTransfer && e.dataTransfer.files[0]; el.classList.remove('drop'); if (!f) return;
    e.preventDefault(); const r = new FileReader(); r.onload = () => cb(String(r.result || ''), f.name); r.readAsText(f);
  });
}
/* ---------- Events ---------- */
function on(id, ev, fn) { $(id).addEventListener(ev, fn); }
function setDef(field, val) {
  const d = C().def; d[field] = val;
  if (field === 'pool') d.poolManual = true;
  if (field === 'life' || field === 'es') { d.poolManual = false; d.pool = d.life == null && d.es == null ? null : (d.life || 0) + (d.es || 0); }
  if (ELE.includes(field)) { d.resPen = kitavaPen(); d.resStale = false; if (resKnown(d)) d.ele = ELE.every((k) => d[k] >= 75); }
  if (field === 'ele') { d.resPen = kitavaPen(); d.resStale = false; }
  d.updated = now(); save(); renderDefense(); renderLinks(); renderHeader(); renderBosses(); renderNext();
}

function bind() {
  $('cBuild').innerHTML = BUILDS.map((b) => `<option>${esc(b.name)}</option>`).join('');
  on('btnStartNow', 'click', () => { C().campaign.start = now(); save(); renderAll(); });
  on('btnStartLaunch', 'click', () => { C().campaign.start = LAUNCH_TS; save(); renderAll(); });
  on('btnSetStart', 'click', () => { const v = $('startInput').value; if (!v) return toast('Pick a date and time first'); C().campaign.start = new Date(v).getTime(); save(); renderAll(); });
  on('btnNextMs', 'click', markMilestone);
  on('btnUndoMs', 'click', undoMilestone);
  on('btnResetCampaign', 'click', () => { if (confirm('Reset the campaign timer and all milestone times?')) { C().campaign = { start: null, done: {} }; save(); renderAll(); } });
  on('paceSel', 'click', (e) => { const p = e.target.dataset.p; if (p) { S.pace = p; save(); renderPace(); renderNext(); } });
  on('budgetSel', 'click', (e) => { const b = e.target.dataset.b; if (b) { S.budget = +b; save(); renderNext(); } });

  on('logForm', 'submit', (e) => {
    e.preventDefault(); const v = $('logInput').value;
    const t = matchType(v);
    if (t && t.builtin && /^Death/.test(t.builtin) && !confirm('Log a DEATH for this character?')) return;
    manualLog(v); $('logInput').value = ''; $('logInput').focus();
  });
  bindTypes(); bindChase();
  document.body.addEventListener('click', (e) => {
    const t = e.target, ds = t.dataset;
    if (ds.ack) { const [eid, tid] = ds.ack.split('|'); ackTrigger(eid, tid); }
    else if (ds.del) { S.log = S.log.filter((l) => l.id !== ds.del); save(); renderAll(); }
    else if (ds.chunk) { S.chunks[ds.chunk] = now(); save(); renderNext(); toast('Nice. Logged ' + esc(CHUNKS[ds.chunk].title)); }
    else if (ds.delkill) { C().kills.splice(+ds.delkill, 1); save(); renderBosses(); }
    else if (ds.vundo) voiceUndo(ds.vundo);
    else if (ds.lstage != null) { if (ds.lstage) pickStage(ds.lstage); else { S.linkView = null; save(); renderLinks(); } }
    else if (ds.mappin != null) setMapPin(ds.mappin);
    else if (ds.bkill != null) { const b = t.closest('[data-boss]'); if (b) uiCommand(`Killed ${b.dataset.boss} with ${ds.bkill} Fates (button)`, [{ type: 'kill', boss: b.dataset.boss, fates: +ds.bkill }]); }
    else if (ds.mapadd) { BCFG.stages[ds.mapadd].variants.push({ set: null, spec: null }); saveBcfg(); renderLinks(); }
    else if (ds.mapdel) { const [st, i] = ds.mapdel.split(':'); BCFG.stages[st].variants.splice(+i, 1); saveBcfg(); renderLinks(); }
    else { const b = t.closest('.boss .bh'); if (b) { const n = b.parentElement.dataset.boss; S.bossOpen = S.bossOpen === n ? null : n; save(); renderBosses(); } }
  });

  on('cBuild', 'change', (e) => { C().build = e.target.value; if (!chase().length) loadTemplate(C().build); save(); renderAll(); });
  on('btnOwnPob', 'click', openOwnPob);
  on('btnHdrPob', 'click', openOwnPob);                      // v5: one obvious way in, top of the page
  on('btnBackup', 'click', downloadBackup);
  on('btnBackup2', 'click', downloadBackup);
  on('btnRestore', 'click', () => $('fileRestore').click());
  on('fileRestore', 'change', (e) => readText(e.target, restoreFile));
  dropFile($('charsec'), (t, n) => (fileExt(n) === 'xml' ? importPobFile(t, n) : restoreFile(t, n)));
  on('btnFreshProfile', 'click', freshProfile);
  bindPaceCfg(); bindTextSize(); bindWiki(); bindLayout();
  on('dLevel', 'input', (e) => { C().level = num(e.target.value) || 1; save(); renderHeader(); renderNext(); renderLinks(); });
  on('btnPause', 'click', () => uiCommand(isPaused() ? 'Resume (button)' : 'Pause (button)', [{ type: isPaused() ? 'resume' : 'pause' }]));
  document.body.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'linkVariantSel') { BCFG.active = BCFG.active || {}; BCFG.active[stageShown()] = +t.value; saveBcfg(); renderLinks(); }
    else if (t.dataset.cat) { const [si, gi] = t.dataset.cat.split(':').map(Number); BCFG.sets[si].groups[gi].cat = t.value; saveBcfg(); renderLinks(); }
    else if (t.dataset.map) editMapping(t.dataset.map, t.value);
  });
  on('btnPobImport', 'click', () => { const t = $('pobText').value, p = pobInputProblem(t); if (p) showImportError('pobStatus', p); else importPob(t); });
  on('btnPobFile', 'click', () => $('filePob').click());
  on('filePob', 'change', (e) => readText(e.target, importPobFile));
  dropFile($('links'), importPobFile);
  on('btnLinkEdit', 'click', () => toggleMapEdit());
  on('btnLinkEdit2', 'click', () => toggleMapEdit());
  on('mapEditor', 'click', (e) => { if (e.target.id === 'btnMapDone') toggleMapEdit(false); });
  on('btnBcfgReset', 'click', () => { if (confirm('Throw away the imported build and edits, and go back to the example build?')) resetBcfg(); });
  on('bossSearch', 'change', (e) => { const b = findBoss(e.target.value); if (b) { S.bossOpen = b.boss; save(); renderBosses(); } else toast('No Fate data for that boss: currently unknown', 2); e.target.value = ''; });
  on('ocrBox', 'click', (e) => {
    if (e.target.id === 'btnOcrApply') uiCommand('Apply screenshot (button)', [{ type: 'ocr', what: 'confirm' }]);
    if (e.target.id === 'btnOcrDiscard') uiCommand('Discard screenshot (button)', [{ type: 'ocr', what: 'discard' }]);
  });
  document.addEventListener('paste', (e) => {
    const it = [...(e.clipboardData?.items || [])].find((x) => x.type.startsWith('image/'));
    if (!it) return; e.preventDefault(); ocrPaste(it.getAsFile());
  });
  on('dEle', 'change', (e) => setDef('ele', e.target.checked));
  on('dOver', 'change', (e) => setDef('over', e.target.checked));
  for (const [id, f] of [['dChaos', 'chaos'], ['dFire', 'fire'], ['dCold', 'cold'], ['dLight', 'lightning'], ['dLife', 'life'], ['dEs', 'es'], ['dPool', 'pool'], ['dAblock', 'ablock'], ['dBlock', 'block']]) on(id, 'input', (e) => setDef(f, num(e.target.value)));

  bindDefStats(); bindConfig();
  on('fCampaign', 'change', (e) => { S.fates.campaignOk = e.target.checked; save(); renderBosses(); });

  on('voiceForm', 'submit', (e) => { e.preventDefault(); sendTyped($('voiceTyped').value); $('voiceTyped').value = ''; });
  on('cName', 'input', (e) => { C().name = e.target.value; save(); renderHeader(); });
  on('btnNewChar', 'click', () => {
    if (!confirm('Archive this character and start a new one? The log is kept; campaign timer, defense and boss kills reset.')) return;
    const c = C(); S.history.unshift({ name: c.name, build: c.build, level: c.level, alive: c.alive, created: c.created, band: c.band, defProfile: c.defProfile ? JSON.parse(JSON.stringify(c.defProfile)) : undefined });
    S.char = freshChar();
    S.char.types = JSON.parse(JSON.stringify(c.types || defaultTypes()));   // v4: the types carry over, then are this character's own
    S.char.chase = chaseFromTemplate(S.char.build); S.char.chaseOn = false;
    save(); syncTypes(); renderAll();
  });

  on('btnResetTrig', 'click', () => { S.triggers = null; indexTriggers(); save(); renderSuggest(); renderAll(); toast('Using the built-in triggers'); });

  window.addEventListener('storage', (e) => { if (e.key === STORE_KEY) { S = load(); ensureV4(); ensureV5(); ensureV52(); ensureV53(); indexTriggers(); applyTextSize(); renderAll(); } else if (e.key === BCFG_KEY) { BCFG = loadBcfg(); LV.svgCache = {}; renderLinks(); } }); // second tab stays in sync
}

/* ---------- Boot ---------- */
ensureV4();
ensureV5(); ensureV52(); ensureV53();
applyTextSize();
applyLayout();
indexTriggers();
bind();
renderSuggest();
renderAll();
voiceInit();
adoptCompanionConfig(); refreshFates(); syncTypes(); setTimeout(chaseLinkSweep, 1500);
window.addEventListener('resize', () => { clearTimeout(LV.rz); LV.rz = setTimeout(() => { LV.svgCache = {}; const el = $('treeBox'); if (el) el.dataset.key = ''; renderLinks(); }, 300); });
setInterval(() => { renderClock(); tickPace(); }, 1000);
setInterval(renderNext, 30000);
