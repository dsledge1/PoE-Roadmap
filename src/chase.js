/* ---------- v4: Power Chase (endgame checklist, per character) ----------
   C().chase = [{ id, item, content, note, done, doneTs }], C().chaseOn (off during the campaign),
   S.contentTypes = editable list shared by all characters. Voice: "chase done X", "add chase item X from Delve". */
const CONTENT_TYPES = ['Delve', 'Legion (Timeless jewels)', 'Atlas Boss', 'Abyss', 'Settlers/Kingsmarch', 'Crafting', 'Expedition', 'Betrayal', 'Heist', 'Harvest', 'Essence', 'Breach', 'Ritual', 'Blight', 'Other'];
const CHASE_TEMPLATES = {
  'Spectre Necromancer': [
    { item: '+1 Spectre chest', content: 'Delve', note: 'Delve-exclusive.' },
    { item: 'Dread boss fight', content: 'Atlas Boss', note: 'For the +Minion amulet and +Minion helmet. Boss: Incarnation of Dread (pinnacle Atlas boss); poewiki lists Bonemeld (amulet, +minion spell gem levels) and The Dark Monarch (helmet, +minion spell gem levels).' },
    { item: '+1/+1 wand', content: 'Crafting', note: '' },
    { item: 'Darkness Enthroned', content: 'Abyss', note: '' },
    { item: 'Abyss jewel', content: 'Abyss', note: '' },
    { item: 'Frostbearers', content: 'Settlers/Kingsmarch', note: 'Forged Frostbearer spectres.' },
  ],
  'ED Occultist': [
    { item: 'Timeless jewel', content: 'Legion (Timeless jewels)', note: '' },
  ],
};
const contentTypes = () => (S.contentTypes = Array.isArray(S.contentTypes) && S.contentTypes.length ? S.contentTypes : [...CONTENT_TYPES]);
function chase() { const c = C(); if (!Array.isArray(c.chase)) c.chase = []; return c.chase; }
function chaseFromTemplate(build) { return (CHASE_TEMPLATES[build] || []).map((x) => ({ id: uid(), ...x, done: false, doneTs: null })); }
function loadTemplate(build) {
  const have = new Set(chase().map((x) => ckey(x.item)));
  const add = chaseFromTemplate(build).filter((x) => !have.has(ckey(x.item)));
  for (const x of add) { chase().push(x); if (!contentTypes().includes(x.content)) contentTypes().push(x.content); }
  return add.length;
}
function pickContent(name) {
  if (!name) return '';
  const hit = contentTypes().find((c) => ckey(c) === ckey(name)) || fuzzyPick(contentTypes(), (c) => [c, c.split(/[ (/]/)[0]], name, 0.7);
  if (hit) return hit;
  const nn = name.trim().replace(/^\w/, (x) => x.toUpperCase());
  contentTypes().push(nn); return nn;
}
const chaseLeft = () => chase().filter((x) => !x.done);
function chaseSummary(content) {
  const left = chaseLeft().filter((x) => !content || ckey(x.content) === ckey(content) || similar(content, x.content) >= 0.7);
  if (!chase().length) return 'Your Power Chase list is empty. Say add chase item, then the item and where it comes from.';
  if (!left.length) return content ? `Nothing left from ${content}.` : 'Power Chase complete. Nothing left.';
  const by = {};
  for (const x of left) (by[x.content || 'Other'] = by[x.content || 'Other'] || []).push(x.item);
  const parts = Object.entries(by).map(([k, v]) => `${k}: ${v.join(', ')}`);
  return `${left.length} left. ${parts.join('. ')}.`;
}
/* voice */
function applyChaseCmd(a, inv) {
  const prev = JSON.parse(JSON.stringify(chase())), prevCt = [...contentTypes()];
  const off = C().chaseOn ? '' : ' Power Chase is off; turn it on in the panel when maps and res are good.';
  if (a.op === 'add') {
    const item = String(a.item || '').trim(); if (!item) return { say: 'Say the item, like add chase item Darkness Enthroned from Abyss.', level: 'unknown' };
    if (chase().some((x) => ckey(x.item) === ckey(item))) return { say: `${item} is already on your chase list.`, level: 'unknown' };
    const content = pickContent(a.content || '');
    chase().push({ id: uid(), item, content, note: '', done: false, doneTs: null });
    inv.push({ k: 'chase', prev, prevCt }); save(); renderChase();
    return { say: `Added ${item}${content ? ' from ' + content : ''} to your chase list.${off}` };
  }
  const x = fuzzyPick(chase(), (y) => [y.item, y.item.replace(/^[+\d/ ]+/, '')], String(a.item || '').replace(/^the /i, ''), 0.55);
  if (!x) return { say: `No chase item like ${a.item}.`, level: 'unknown' };
  if (a.op === 'delete') { C().chase = chase().filter((y) => y !== x); inv.push({ k: 'chase', prev, prevCt }); save(); renderChase(); return { say: `Removed ${x.item} from your chase list.` }; }
  if (a.op === 'undone') { x.done = false; x.doneTs = null; inv.push({ k: 'chase', prev, prevCt }); save(); renderChase(); return { say: `${x.item} is open again. ${chaseLeft().length} left.` }; }
  if (x.done) return { say: `${x.item} was already done.`, level: 'unknown' };
  x.done = true; x.doneTs = now(); inv.push({ k: 'chase', prev, prevCt }); save(); renderChase();
  const n = chaseLeft().length;
  return { say: `${x.item} done. ${n ? n + ' left' : 'Power Chase complete'}.${off}` };
}

/* ---- panel ---- */
const CV = { filter: '', edit: null };
function renderChase() {
  const el = $('chaseBody'); if (!el) return;
  const c = C(), on_ = !!c.chaseOn, list = chase();
  $('chaseOn').checked = on_;
  $('chaseSub').textContent = list.length ? `${list.filter((x) => x.done).length}/${list.length} done` : '';
  $('chase').classList.toggle('chase-off', !on_);
  const ready = curAct() > 10 && clearedIdx() >= 0;
  $('chaseHint').innerHTML = on_ ? '' : `<span class="${ready ? 'ok' : 'dim'}">${ready ? 'Maps and res look good: time to turn it on.' : 'Off during the campaign. Turn it on when maps and res are good.'}</span>`;
  el.classList.toggle('hidden', !on_);
  if (!on_) return;
  const cts = contentTypes();
  $('chaseFilter').innerHTML = `<option value="">All content</option>` + cts.filter((k) => list.some((x) => x.content === k)).map((k) => `<option${CV.filter === k ? ' selected' : ''}>${esc(k)}</option>`).join('');
  $('chaseNewContent').innerHTML = cts.map((k) => `<option>${esc(k)}</option>`).join('');
  const shown = list.filter((x) => !CV.filter || x.content === CV.filter);
  const groups = {};
  for (const x of shown) (groups[x.content || 'Other'] = groups[x.content || 'Other'] || []).push(x);
  const order = Object.keys(groups).sort((a, b) => (cts.indexOf(a) + 1 || 99) - (cts.indexOf(b) + 1 || 99));
  const item = (x) => CV.edit === x.id
    ? `<div class="citem edit" data-cid="${x.id}"><input data-cedit="item" value="${esc(x.item)}"><select data-cedit="content">${cts.map((k) => `<option${k === x.content ? ' selected' : ''}>${esc(k)}</option>`).join('')}</select><input data-cedit="note" value="${esc(x.note || '')}" placeholder="note (optional)"><button class="sm pri" data-csave="${x.id}">Save</button><button class="sm ghost" data-ccancel="1">Cancel</button></div>`
    : `<div class="citem${x.done ? ' done' : ''}" data-cid="${x.id}"><label><input type="checkbox" data-cdone="${x.id}"${x.done ? ' checked' : ''}> <b>${esc(x.item)}</b></label>${x.note ? `<span class="dim small"> ${esc(x.note)}</span>` : ''}<span class="sp"></span><button class="sm ghost" data-cedit-btn="${x.id}" title="Edit">✎</button><button class="sm ghost" data-cdel="${x.id}" title="Delete">×</button></div>`;
  $('chaseList').innerHTML = order.length ? order.map((k) => `<div class="cgroup"><div class="ch"><span class="badge">${esc(k)}</span> <span class="dim small">${groups[k].filter((x) => !x.done).length} left</span></div>${groups[k].map(item).join('')}</div>`).join('')
    : `<div class="dim">Nothing on the list. Add items below, or load a template.</div>`;
  $('ctList').innerHTML = cts.map((k, i) => `<span class="badge ct">${esc(k)} <button class="sm ghost" data-ctdel="${i}" title="Remove content type">×</button></span>`).join(' ');
}
function bindChase() {
  on('chaseOn', 'change', (e) => { C().chaseOn = e.target.checked; save(); renderChase(); });
  on('chaseFilter', 'change', (e) => { CV.filter = e.target.value; renderChase(); });
  on('chaseAddForm', 'submit', (e) => {
    e.preventDefault();
    const item = $('chaseNewItem').value.trim(); if (!item) return;
    chase().push({ id: uid(), item, content: $('chaseNewContent').value, note: $('chaseNewNote').value.trim(), done: false, doneTs: null });
    $('chaseNewItem').value = ''; $('chaseNewNote').value = ''; save(); renderChase();
  });
  on('chaseTpl', 'change', (e) => { const b = e.target.value; if (!b) return; const n = loadTemplate(b); e.target.value = ''; save(); renderChase(); toast(`${b} template: ${n} item${n === 1 ? '' : 's'} added`, 3); });
  on('ctAddForm', 'submit', (e) => { e.preventDefault(); const v = $('ctNew').value.trim(); if (v && !contentTypes().includes(v)) contentTypes().push(v); $('ctNew').value = ''; save(); renderChase(); });
  $('chase').addEventListener('click', (e) => {
    const d = e.target.dataset, byId = (id) => chase().find((x) => x.id === id);
    if (d.cdel) { C().chase = chase().filter((x) => x.id !== d.cdel); save(); renderChase(); }
    else if (d.ceditBtn) { CV.edit = d.ceditBtn; renderChase(); }
    else if (d.ccancel) { CV.edit = null; renderChase(); }
    else if (d.csave) {
      const x = byId(d.csave), row = e.target.closest('.citem');
      if (x) { const g = (k) => row.querySelector(`[data-cedit="${k}"]`).value; x.item = g('item').trim() || x.item; x.content = g('content'); x.note = g('note').trim(); }
      CV.edit = null; save(); renderChase();
    }
    else if (d.ctdel != null) { const k = contentTypes()[+d.ctdel]; if (chase().some((x) => x.content === k) && !confirm(`Items still use “${k}”. Remove it from the list anyway?`)) return; contentTypes().splice(+d.ctdel, 1); save(); renderChase(); }
  });
  $('chase').addEventListener('change', (e) => {
    const id = e.target.dataset.cdone; if (!id) return;
    const x = chase().find((y) => y.id === id); if (x) { x.done = e.target.checked; x.doneTs = x.done ? now() : null; save(); renderChase(); }
  });
}
