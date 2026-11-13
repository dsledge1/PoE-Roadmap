/* ---------- Export / import ---------- */
function exportObj() { return { exported: new Date().toISOString(), app: 'poe330-hcssf-tracker', state: S, triggersInUse: trigDoc() }; }
function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function stamp() { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`; }
function readFile(input, cb) {
  const f = input.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => { try { cb(JSON.parse(r.result)); } catch (e) { toast('Import failed: ' + esc(e.message), 1); } input.value = ''; };
  r.readAsText(f);
}
/* ---------- Import checks: each control says what it takes, and the wrong file gets a friendly message ---------- */
const POB_GUIDE_URL = 'https://github.com/dsledge1/PoE-Roadmap/blob/main/docs/POB_GUIDE.md';
const ACCEPTS = { pob: 'PoB export code, pobb.in or poe.ninja/pob link, or .xml file', profile: '.json profile exported from this tracker',
  bcfg: '.json build config saved with Export build config' };
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
const JSON_HOME = { profile: 'It looks like a tracker profile: use Character → Import profile.', bcfg: 'It looks like a build config: use Links & tree → Load build config.',
  log: 'It looks like a full tracker backup: use Import log at the top.', triggers: 'It looks like a triggers file: use Import triggers at the top.', json: '' };
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
function jsonFileProblem(kind, text, name) {
  const ext = fileExt(name), takes = kind === 'profile' ? `Import profile takes a ${ACCEPTS.profile}.` : `Load build config takes a ${ACCEPTS.bcfg}.`;
  if (ext === 'xml' || /^\s*</.test(text || '')) return [`That's a .xml file, probably a Path of Building build. Import it in Links & tree → Use my own PoB. ${takes}`, null];
  if (ext && ext !== 'json') return [`A .${ext} file can't be loaded here. ${takes}`, null];
  const j = sniffJson(text);
  if (j == null) return [`That file isn't valid JSON. ${takes}`, null];
  const k = jsonKind(j);
  if (k !== kind) return [`That .json isn't a ${kind === 'profile' ? 'tracker profile' : 'build config'}. ${JSON_HOME[k] || (kind === 'profile' ? 'Make one with Export profile.' : 'Make one with Export build config.')}`.trim(), null];
  if (kind === 'profile' && j.app !== 'poe330-hcssf-tracker') return ['That profile was made by a different app. ' + takes, null];
  return ['', j];
}
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
function importProfileFile(text, name) {
  const [p, obj] = jsonFileProblem('profile', text, name);
  if (p) return showImportError('profileStatus', p);
  $('profileStatus').textContent = ''; importProfile(obj);
}
function loadBcfgFile(text, name) {
  const [p, obj] = jsonFileProblem('bcfg', text, name);
  if (p) return showImportError('pobStatus', p);
  setBcfg(obj, 'Build config loaded.');
}
function dropFile(el, cb) {
  el.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); el.classList.add('drop'); } });
  el.addEventListener('dragleave', () => el.classList.remove('drop'));
  el.addEventListener('drop', (e) => {
    const f = e.dataTransfer && e.dataTransfer.files[0]; el.classList.remove('drop'); if (!f) return;
    e.preventDefault(); const r = new FileReader(); r.onload = () => cb(String(r.result || ''), f.name); r.readAsText(f);
  });
}
function validTriggers(doc) {
  if (!doc || !Array.isArray(doc.triggers) || !doc.triggers.length) throw new Error('no "triggers" array');
  for (const t of doc.triggers) if (!t.id || !t.item || !t.action || ![1, 2, 3].includes(+t.priority)) throw new Error('trigger missing id/item/action/priority: ' + JSON.stringify(t).slice(0, 80));
  doc.triggers.forEach((t) => (t.priority = +t.priority));
  return doc;
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
    else if (ds.lstage != null) { S.linkView = ds.lstage && ds.lstage !== stageAuto() ? ds.lstage : null; save(); renderLinks(); }
    else if (ds.bkill != null) { const b = t.closest('[data-boss]'); if (b) uiCommand(`Killed ${b.dataset.boss} with ${ds.bkill} Fates (button)`, [{ type: 'kill', boss: b.dataset.boss, fates: +ds.bkill }]); }
    else if (ds.mapadd) { BCFG.stages[ds.mapadd].variants.push({ set: null, spec: null }); saveBcfg(); renderLinks(); }
    else if (ds.mapdel) { const [st, i] = ds.mapdel.split(':'); BCFG.stages[st].variants.splice(+i, 1); saveBcfg(); renderLinks(); }
    else { const b = t.closest('.boss .bh'); if (b) { const n = b.parentElement.dataset.boss; S.bossOpen = S.bossOpen === n ? null : n; save(); renderBosses(); } }
  });

  on('cBuild', 'change', (e) => { C().build = e.target.value; if (!chase().length) loadTemplate(C().build); save(); renderAll(); });
  on('btnOwnPob', 'click', openOwnPob);
  on('btnProfileExport', 'click', exportProfile);
  on('btnProfileImport', 'click', () => $('fileProfile').click());
  on('fileProfile', 'change', (e) => readText(e.target, importProfileFile));
  dropFile($('charsec'), (t, n) => (fileExt(n) === 'xml' ? importPobFile(t, n) : importProfileFile(t, n)));
  on('btnFreshProfile', 'click', freshProfile);
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
  dropFile($('pobImport'), importPobFile);
  on('btnLinkEdit', 'click', () => { LV.edit = !LV.edit; $('btnLinkEdit').classList.toggle('on', LV.edit); renderLinks(); });
  on('btnBcfgExport', 'click', exportBcfg);
  on('btnBcfgLoad', 'click', () => $('fileBcfg').click());
  on('fileBcfg', 'change', (e) => readText(e.target, loadBcfgFile));
  on('btnBcfgReset', 'click', () => { if (confirm('Throw away the imported build and edits, and go back to the default build?')) resetBcfg(); });
  on('mapPin', 'change', (e) => { S.mapStagePin = e.target.value || null; save(); renderLinks(); });
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

  on('fCampaign', 'change', (e) => { S.fates.campaignOk = e.target.checked; save(); renderBosses(); });

  on('voiceForm', 'submit', (e) => { e.preventDefault(); sendTyped($('voiceTyped').value); $('voiceTyped').value = ''; });
  on('cName', 'input', (e) => { C().name = e.target.value; save(); renderHeader(); });
  on('btnNewChar', 'click', () => {
    if (!confirm('Archive this character and start a new one? The log is kept; campaign timer, defense and boss kills reset.')) return;
    const c = C(); S.history.unshift({ name: c.name, build: c.build, level: c.level, alive: c.alive, created: c.created, band: c.band });
    S.char = freshChar();
    S.char.types = JSON.parse(JSON.stringify(c.types || defaultTypes()));   // v4: the types carry over, then are this character's own
    S.char.chase = chaseFromTemplate(S.char.build); S.char.chaseOn = false;
    save(); syncTypes(); renderAll();
  });

  on('btnExport', 'click', () => download(`poe_tracker_${stamp()}.json`, JSON.stringify(exportObj(), null, 1)));
  on('btnCopy', 'click', async () => { try { await navigator.clipboard.writeText(JSON.stringify(exportObj())); toast('Export JSON copied to clipboard'); } catch { toast('Clipboard blocked: use Export instead', 2); } });
  on('btnImportState', 'click', () => $('fileState').click());
  on('btnImportTrig', 'click', () => $('fileTrig').click());
  on('fileState', 'change', (e) => readFile(e.target, (obj) => {
    const st = obj.state || obj; if (!st.char || !Array.isArray(st.log)) throw new Error('not a tracker export');
    if (!confirm('Replace everything in this tracker with the imported file?')) return;
    S = Object.assign(freshState(), st); ensureV4(); indexTriggers(); save(); syncTypes(); applyLayout(); renderSuggest(); renderAll(); toast('Log imported');
  }));
  on('fileTrig', 'change', (e) => readFile(e.target, (obj) => {
    const doc = validTriggers(obj.triggersInUse || obj);
    S.triggers = doc; indexTriggers(); save(); renderSuggest(); renderAll(); toast(`Imported ${doc.triggers.length} triggers (updated ${esc(doc.updated || '?')})`);
  }));
  on('btnResetTrig', 'click', () => { S.triggers = null; indexTriggers(); save(); renderSuggest(); renderAll(); toast('Using embedded triggers'); });

  window.addEventListener('storage', (e) => { if (e.key === STORE_KEY) { S = load(); ensureV4(); indexTriggers(); renderAll(); } else if (e.key === BCFG_KEY) { BCFG = loadBcfg(); LV.svgCache = {}; renderLinks(); } }); // second tab stays in sync
}

/* ---------- Boot ---------- */
ensureV4();
applyLayout();
indexTriggers();
bind();
renderSuggest();
renderAll();
voiceInit();
adoptCompanionConfig(); refreshFates(); syncTypes();
window.addEventListener('resize', () => { clearTimeout(LV.rz); LV.rz = setTimeout(() => { LV.svgCache = {}; const el = $('treeBox'); if (el) el.dataset.key = ''; renderLinks(); }, 300); });
setInterval(() => { renderClock(); tickPace(); }, 1000);
setInterval(renderNext, 30000);
