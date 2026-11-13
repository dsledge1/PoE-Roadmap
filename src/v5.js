/* ---------- v5 (Nov 13, 2026): pace targets, text size, wiki links, backup / restore ---------- */

/* ---- campaign pace targets ----
   The plan's three columns (6h stretch / 7h realistic / 8h fallback to A10 Kitava) are scaled to the chosen target.
   S.paceCfg = { preset: 'league'|'alt'|'speed'|'custom', total: realistic minutes to A10 Kitava (custom), overrides: { M1: minutes, … } }.
   Custom: the total is fixed; acts with an override keep their minutes and the other acts share what is left, in proportion. */
const PACE_PRESETS = {
  league: { name: 'League start', hint: '≈6–8 h', total: 420, title: 'First character of the league: 6 h stretch, 7 h realistic, 8 h fallback to A10 Kitava' },
  alt: { name: 'Alt character', hint: '≈3.5–4.5 h', total: 240, title: 'Second / third character: about 3.5–4.5 h to A10 Kitava' },
  speed: { name: 'Speedrun', hint: '≈2–3 h', total: 150, title: 'Racing pace: about 2–3 h to A10 Kitava' },
  custom: { name: 'Custom', hint: 'your target', title: 'Your own total (time to A10 Kitava); optional minutes per act below' },
};
const PACE_BASE = { t6: 360, t7: 420, t8: 480 };      // the plan's A10 Kitava times
const PACE_BASE_NAMES = { t6: 'stretch', t7: 'realistic', t8: 'fallback' };
const STOP_BUDGET_BASE = { ...STOP_BUDGET };
function paceCfg() {
  let p = S.paceCfg;
  if (!p || typeof p !== 'object' || !PACE_PRESETS[p.preset]) p = S.paceCfg = { preset: 'league', total: 420, overrides: {} };
  if (!p.overrides || typeof p.overrides !== 'object') p.overrides = {};
  if (!(p.total >= 30 && p.total <= 1440)) p.total = PACE_PRESETS[p.preset].total || 420;
  return p;
}
const paceTotal = () => { const p = paceCfg(); return p.preset === 'custom' ? p.total : PACE_PRESETS[p.preset].total; };
const fmtH = (min) => { const m = Math.round(min), h = Math.floor(m / 60), r = m % 60; return h ? `${h}h${r ? String(r).padStart(2, '0') : ''}` : `${r}m`; };
const PACE = { key: '', t: null, warn: '' };
function paceTable() {
  const p = paceCfg(), total = paceTotal(), ov = p.preset === 'custom' ? p.overrides : {};
  const key = JSON.stringify([p.preset, total, ov]);
  if (PACE.t && PACE.key === key) return PACE.t;
  const segs = (col) => MILESTONES.map((m, i) => m[col] - (i ? MILESTONES[i - 1][col] : 0));
  const s7 = segs('t7'), isOv = (i) => ov[MILESTONES[i].id] != null && ov[MILESTONES[i].id] >= 0;
  let fixed = 0, free = 0;
  for (let i = 0; i <= KITAVA_IDX; i++) { if (isOv(i)) fixed += +ov[MILESTONES[i].id]; else free += s7[i]; }
  let fFree = free ? (total - fixed) / free : 1;
  PACE.warn = '';
  if (fFree < 0.15) { PACE.warn = `Your per-act minutes (${fmtH(fixed)}) leave almost nothing for the other acts in ${fmtH(total)}.`; fFree = 0.15; }
  const fAll = total / PACE_BASE.t7;
  const t = {};
  for (const col of ['t6', 't7', 't8']) {
    const sc = segs(col); let cum = 0; t[col] = {};
    MILESTONES.forEach((m, i) => {
      const ratio = s7[i] ? sc[i] / s7[i] : 1;            // stretch / fallback keep the plan's shape around realistic
      const seg = isOv(i) ? +ov[m.id] * ratio : sc[i] * (i <= KITAVA_IDX ? fFree : fAll);
      cum += seg; t[col][m.id] = Math.round(cum * 10) / 10;
    });
  }
  PACE.t = t; PACE.key = key;
  for (const col of ['t6', 't7', 't8']) {
    PACE_NAMES[col] = `${fmtH(t[col][MILESTONES[KITAVA_IDX].id])} ${PACE_BASE_NAMES[col]}`;
    STOP_BUDGET[col] = Math.max(2, Math.round(STOP_BUDGET_BASE[col] * Math.min(1, fAll)));
  }
  return t;
}
const paceAt = (m, col = S.pace) => paceTable()[col][m.id];
const segTarget = (m, col = S.pace) => { const i = MILESTONES.indexOf(m); return paceAt(m, col) - (i > 0 ? paceAt(MILESTONES[i - 1], col) : 0); };
const paceWords = (col = S.pace) => { const m = Math.round(paceAt(MILESTONES[KITAVA_IDX], col)), h = Math.floor(m / 60), r = m % 60; return h ? `${h} hour${r ? ' ' + r : ''}` : `${r} minute`; };
function paceLabel() { const p = paceCfg(); return p.preset === 'custom' ? `Custom ${fmtH(paceTotal())}` : PACE_PRESETS[p.preset].name; }
function parseDuration(v) {     // "4", "4.5", "4:30", "4h30", "270m" -> minutes
  const s = String(v || '').trim().toLowerCase(); let m;
  if ((m = /^(\d{1,2}):(\d{2})$/.exec(s))) return +m[1] * 60 + +m[2];
  if ((m = /^(\d{1,2})\s*h\s*(\d{1,2})?\s*m?$/.exec(s))) return +m[1] * 60 + (+m[2] || 0);
  if ((m = /^(\d{2,4})\s*m(in)?$/.exec(s))) return +m[1];
  if ((m = /^(\d{1,2}(?:[.,]\d+)?)\s*(h|hours?)?$/.exec(s))) return Math.round(parseFloat(m[1].replace(',', '.')) * 60);
  return null;
}
/* one entry point for the buttons, the custom fields and voice; returns the spoken summary */
function setPaceCfg(ch, inv) {
  const p = paceCfg(), prev = JSON.parse(JSON.stringify(p));
  if (ch.preset) { if (ch.preset === 'custom' && p.preset !== 'custom') p.total = paceTotal(); p.preset = ch.preset; }
  if (ch.total != null) { p.preset = 'custom'; p.total = Math.max(30, Math.min(1440, Math.round(ch.total))); }
  if (ch.override) { const [id, v] = ch.override; if (v == null || v === '') delete p.overrides[id]; else p.overrides[id] = Math.max(0, Math.round(+v)); }
  if (ch.clearOverrides) p.overrides = {};
  if (inv) inv.push({ k: 'pacecfg', prev });
  paceTable(); save(); renderPace(); renderNext();
  const t = paceTable(), K = MILESTONES[KITAVA_IDX].id;
  return `Pace target ${p.preset === 'custom' ? 'custom' : PACE_PRESETS[p.preset].name}: Kitava in ${spokenH(t.t7[K])}, stretch ${spokenH(t.t6[K])}, fallback ${spokenH(t.t8[K])}.${PACE.warn ? ' ' + PACE.warn : ''}`;
}
const spokenH = (min) => { const m = Math.round(min), h = Math.floor(m / 60), r = m % 60; return (h ? `${h} hour${h === 1 ? '' : 's'}` : '') + (r ? `${h ? ' ' : ''}${r} minutes` : ''); };
function renderPaceCfg() {
  const p = paceCfg(), t = paceTable(), K = MILESTONES[KITAVA_IDX].id;
  for (const b of $('pacePreset').children) b.classList.toggle('on', b.dataset.preset === p.preset);
  $('paceCustomBox').classList.toggle('hidden', p.preset !== 'custom');
  if (document.activeElement !== $('paceTotal')) $('paceTotal').value = fmtH(p.total).replace(/^(\d+)h$/, '$1:00').replace(/^(\d+)h(\d\d)$/, '$1:$2');
  $('paceCfgInfo').innerHTML = `Kitava (A10): <b>${fmtH(t.t6[K])}</b> stretch · <b>${fmtH(t.t7[K])}</b> realistic · <b>${fmtH(t.t8[K])}</b> fallback${PACE.warn ? ` <span class="warn">${esc(PACE.warn)}</span>` : ''}`;
  for (const b of $('paceSel').children) b.textContent = fmtH(t[b.dataset.p][K]);
  $('paceActs').classList.toggle('hidden', p.preset !== 'custom');
  if (p.preset !== 'custom' || !$('paceActs').open) return;
  if ($('paceActTable').contains(document.activeElement)) return;
  $('paceActTable').innerHTML = '<tr><th>Checkpoint</th><th class="n">Target (min)</th><th class="n">Your minutes</th></tr>' + MILESTONES.slice(0, KITAVA_IDX + 1).map((m) =>
    `<tr><td>${esc(m.label)}</td><td class="n">${Math.round(segTarget(m, 't7'))}</td><td class="n"><input type="number" min="0" max="600" step="1" data-paceov="${m.id}" value="${p.overrides[m.id] ?? ''}" placeholder="auto" title="Minutes for this part of the campaign. Leave empty to share the rest of the total in proportion."></td></tr>`).join('');
}
function bindPaceCfg() {
  $('pacePreset').innerHTML = Object.entries(PACE_PRESETS).map(([k, v]) => `<button type="button" data-preset="${k}" title="${esc(v.title)}">${esc(v.name)} <span class="dim">${esc(v.hint)}</span></button>`).join('');
  on('pacePreset', 'click', (e) => { const b = e.target.closest('[data-preset]'); if (b) { setPaceCfg({ preset: b.dataset.preset }); if (b.dataset.preset === 'custom') $('paceTotal').focus(); } });
  on('paceTotal', 'change', (e) => { const v = parseDuration(e.target.value); if (v == null || v < 30) { toast('Type the time to A10 Kitava, like 4, 4.5, 4:30 or 270m', 2); renderPaceCfg(); return; } setPaceCfg({ total: v }); });
  on('paceActs', 'toggle', renderPaceCfg);
  on('paceActTable', 'change', (e) => { const id = e.target.dataset.paceov; if (id) { setPaceCfg({ override: [id, e.target.value === '' ? null : +e.target.value] }); $('paceActTable').innerHTML = ''; renderPaceCfg(); } });
  on('btnPaceOvClear', 'click', () => { setPaceCfg({ clearOverrides: true }); $('paceActTable').innerHTML = ''; renderPaceCfg(); });
}

/* ---- text size (whole page; every font size is in rem) ---- */
const TEXT_STEPS = [90, 100, 110, 125, 140, 150];
const nearestStep = (v) => TEXT_STEPS.reduce((b, x) => (Math.abs(x - v) < Math.abs(b - v) ? x : b), 100);
function applyTextSize() {
  const pct = (S.ui && S.ui.textPct) || 100;
  document.documentElement.style.fontSize = (14 * pct / 100) + 'px';
  document.documentElement.classList.toggle('text-lg', pct >= 125);
  const el = $('textPct'); if (el) el.textContent = pct + '%';
  if ($('btnTextDown')) { $('btnTextDown').disabled = pct <= TEXT_STEPS[0]; $('btnTextUp').disabled = pct >= TEXT_STEPS.at(-1); }
}
function setTextSize(ch, inv) {
  const before = S.ui.textPct, i = TEXT_STEPS.indexOf(nearestStep(before));
  const pct = ch.pct != null ? nearestStep(ch.pct) : TEXT_STEPS[Math.max(0, Math.min(TEXT_STEPS.length - 1, i + (ch.step || 0)))];
  if (inv) inv.push({ k: 'ui', prev: { textPct: before } });
  S.ui.textPct = pct; save(); applyTextSize();
  LV.svgCache = {}; const tb = $('treeBox'); if (tb) tb.dataset.key = '';
  if (pct === before) return ch.step > 0 ? `Text is already at the largest size, ${pct} percent.` : ch.step < 0 ? `Text is already at the smallest size, ${pct} percent.` : `Text size ${pct} percent.`;
  return `Text size ${pct} percent.`;
}
function bindTextSize() {
  on('btnTextUp', 'click', () => setTextSize({ step: 1 }));
  on('btnTextDown', 'click', () => setTextSize({ step: -1 }));
  on('textPct', 'click', () => setTextSize({ pct: 100 }));
}

/* ---- wiki links: "get wiki link for X" (the companion finds the page, copies it, says so); recent links, clickable ---- */
const WIKI = { pending: '', status: '' };
const POEWIKI_SEARCH = 'https://www.poewiki.net/index.php?search=';
function addWikiLink(x) {
  if (!x || !x.url) return null;
  S.wikiLinks = (S.wikiLinks || []).filter((w) => w.url !== x.url);
  const e = { id: uid(), ts: now(), query: String(x.query || ''), title: String(x.title || x.query || x.url), url: String(x.url), source: String(x.source || '') };
  S.wikiLinks.unshift(e); S.wikiLinks.length = Math.min(S.wikiLinks.length, 40);
  return e;
}
function wikiLinkResult(a, inv) {
  WIKI.pending = '';
  if (!a.found || !a.url) {
    WIKI.status = `No wiki page for “${a.query}”.${(a.closest || []).length ? ' Closest: ' + a.closest.slice(0, 3).join(', ') + '.' : ''}`;
    renderWiki(); return { say: '', level: 'unknown' };
  }
  const e = addWikiLink(a); WIKI.status = '';
  if (inv) inv.push({ k: 'wiki', id: e.id });
  save(); renderWiki();
  const row = document.querySelector(`#wikiList [data-wid="${e.id}"]`); if (row) row.classList.add('flash');
  toast(`Wiki link added: <a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.title)}</a>${e.source === 'poedb' ? ' <span class="dim">· poedb</span>' : ''}`, 3);
  return { say: '' };            // the companion says "Wiki link for X added."
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back */ }
  const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
  let ok = false; try { ok = document.execCommand('copy'); } catch { ok = false; } ta.remove(); return ok;
}
function renderWiki() {
  const el = $('wikiList'); if (!el) return;
  const list = S.wikiLinks || [];
  $('wikiStatus').innerHTML = WIKI.pending ? `<span class="dim">Finding the wiki link for “${esc(WIKI.pending)}”…</span>` : WIKI.status ? `<span class="warn">${esc(WIKI.status)}</span>` : '';
  $('wikiSub').textContent = list.length ? `${list.length} recent` : '';
  el.innerHTML = list.length ? list.map((w) => `<div class="logitem wl" data-wid="${w.id}"><time>${fmtClock(w.ts)}</time><span class="t"><a href="${esc(w.url)}" target="_blank" rel="noopener" title="${esc(w.url)}">${esc(w.title)}</a>${w.source && w.source !== 'poewiki' ? ` <span class="badge">${esc(w.source)}</span>` : ''}${w.query && ckey(w.query) !== ckey(w.title) ? ` <span class="dim small">for “${esc(w.query)}”</span>` : ''}</span><button class="sm" data-wcopy="${w.id}" title="Copy this link to the clipboard">Copy</button><button class="sm ghost" data-wdel="${w.id}" title="Remove from the list">×</button></div>`).join('')
    : '<div class="dim">No links yet. Say “get wiki link for Darkness Enthroned”, or type a name above. Research answers add their wiki page here too.</div>';
}
function bindWiki() {
  on('wikiForm', 'submit', (e) => {
    e.preventDefault(); const q = $('wikiQ').value.trim(); if (!q) return;
    $('wikiQ').value = '';
    if (VOICE.served) { WIKI.pending = q; WIKI.status = ''; renderWiki(); sendTyped('get wiki link for ' + q); return; }
    addWikiLink({ query: q, title: 'Search poewiki: ' + q, url: POEWIKI_SEARCH + encodeURIComponent(q), source: 'search' }); save(); renderWiki();
  });
  on('btnWikiClear', 'click', () => { if (!(S.wikiLinks || []).length || confirm('Clear the wiki links list?')) { S.wikiLinks = []; WIKI.status = ''; save(); renderWiki(); } });
  on('wikiList', 'click', async (e) => {
    const d = e.target.dataset, w = (S.wikiLinks || []).find((x) => x.id === (d.wcopy || d.wdel));
    if (d.wdel) { S.wikiLinks = S.wikiLinks.filter((x) => x.id !== d.wdel); save(); renderWiki(); }
    else if (d.wcopy && w) { const ok = await copyText(w.url); e.target.textContent = ok ? 'Copied' : 'Copy failed'; setTimeout(() => (e.target.textContent = 'Copy'), 1500); }
  });
}

/* ---- backup (download) and restore (advanced) ---- */
function exportObj() { return { exported: new Date().toISOString(), app: 'poe330-hcssf-tracker', kind: 'backup', version: 5, state: S, buildCfg: BCFG, triggersInUse: trigDoc() }; }
function downloadBackup() { download(`poe_tracker_backup_${stamp()}.json`, JSON.stringify(exportObj(), null, 1)); toast('Backup downloaded (.json). Keep it somewhere safe; Character → Advanced → Restore backup reads it.', 3); }
const RESTORE_TAKES = 'Restore backup takes a .json backup made with Download backup.';
function restoreProblem(text, name) {
  const ext = fileExt(name);
  if (ext === 'xml' || /^\s*</.test(text || '')) return ['That\'s a .xml file, probably a Path of Building build. Use Import PoB build (header or Links & tree) for builds. ' + RESTORE_TAKES, null];
  if (ext && ext !== 'json') return [`A .${ext} file can't be restored. ${RESTORE_TAKES}`, null];
  const j = sniffJson(text);
  if (j == null) return [`That file isn't valid JSON. ${RESTORE_TAKES}`, null];
  const k = jsonKind(j);
  if (k === 'log' || k === 'profile') return ['', j];
  if (k === 'bcfg') return ['That\'s an old build config file. Builds now come from Path of Building: use Import PoB build with the PoB code, link or .xml.', null];
  if (k === 'triggers') return ['That\'s a triggers file. Trigger files aren\'t imported any more; the tracker uses its built-in triggers.', null];
  return [`That .json isn't a tracker backup. ${RESTORE_TAKES}`, null];
}
function restoreFile(text, name) {
  const [p, obj] = restoreProblem(text, name);
  if (p) return showImportError('restoreStatus', p);
  $('restoreStatus').textContent = '';
  if (jsonKind(obj) === 'profile') { importProfile(obj); return; }
  const st = obj.state || obj;
  if (!confirm('Replace everything in this tracker with this backup? (Download a backup of the current state first if you want to keep it.)')) return;
  S = Object.assign(freshState(), st); ensureV4(); ensureV5(); ensureV52(); ensureV53(); indexTriggers();
  if (obj.buildCfg && obj.buildCfg.sets && obj.buildCfg.stages) { BCFG = obj.buildCfg; saveBcfg(); }
  saveNow(); syncTypes(); applyLayout(); applyTextSize(); renderSuggest(); renderAll(); toast('Backup restored.', 2);
}
