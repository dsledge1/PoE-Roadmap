/* ---------- v4: Power Chase (endgame checklist, per character) ----------
   C().chase = [{ id, item, content, note, done, doneTs }], C().chaseOn (off during the campaign),
   S.contentTypes = editable list shared by all characters. Voice: "chase done X", "add chase item X from Delve". */
const CONTENT_TYPES = ['Delve', 'Legion (Timeless jewels)', 'Atlas Boss', 'Abyss', 'Settlers/Kingsmarch', 'Crafting', 'Expedition', 'Betrayal', 'Heist', 'Harvest', 'Essence', 'Breach', 'Ritual', 'Blight', 'Delirium', 'Ultimatum', 'Sanctum', 'Incursion', 'Bestiary', 'Maps', 'Other'];
/* v5: a colour per content type that fits the content (readable on the dark theme). First keyword match wins;
   S.ctColors[name] overrides it (Content types → colour swatch). */
const CT_COLOR_RULES = [
  [/abyss/, '#2f8a3a', 'dark green'], [/legion|timeless/, '#7a3fd0', 'deep purple'], [/breach/, '#b8326e', 'purply red'],
  [/delve|azurite|niko/, '#1f86a8', 'azurite blue-teal'], [/settler|kingsmarch|\bore\b|verisium/, '#c9a227', 'gold / ore'],
  [/atlas boss|pinnacle|uber|boss/, '#c62835', 'crimson'], [/craft|bench/, '#7d8a96', 'steel grey'], [/expedition|logbook|kirac.*expedition/, '#b5693a', 'rust / earth'],
  [/ritual/, '#e0582e', 'blood orange'], [/harvest|lifeforce/, '#5fae3c', 'leaf green'], [/heist|rogue|contract|blueprint/, '#4757b8', 'indigo'],
  [/blight|oil/, '#a3a22a', 'toxic olive'], [/essence/, '#14a6bd', 'cyan'], [/deliri|simulacrum/, '#c5ccd4', 'mist white'],
  [/ultimatum|trialmaster/, '#e8900c', 'amber'], [/sanctum/, '#d9628f', 'rose'], [/incursion|temple|alva/, '#e07a3f', 'temple orange'],
  [/bestiary|beast|einhar/, '#8a6242', 'brown'], [/betrayal|syndicate|jun/, '#5d7c8a', 'slate'], [/map|atlas/, '#4a90d9', 'map blue'],
  [/^other$|misc/, '#6b7280', 'neutral grey'],
];
const CT_FALLBACK = ['#3f9e8f', '#9a6cc9', '#c47b4c', '#5b8bd0', '#b0a040', '#c85d7a'];
function ctColor(name) {
  const k = String(name || 'Other');
  if (S.ctColors && S.ctColors[k]) return S.ctColors[k];
  const low = k.toLowerCase();
  for (const [re, c] of CT_COLOR_RULES) if (re.test(low)) return c;
  let h = 0; for (const ch of low) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return CT_FALLBACK[h % CT_FALLBACK.length];
}
const ctChip = (name, extra = '') => `<span class="ctchip" style="--cc:${ctColor(name)}"${extra}>${esc(name || 'Other')}</span>`;
const itemTypes = (x) => [x.content || 'Other', ...((x.also || []).filter((a) => a && a !== x.content))];
const hasType = (x, k) => itemTypes(x).some((t) => ckey(t) === ckey(k));
const CHASE_TEMPLATES = {
  'Spectre Necromancer': [
    { item: '+1 Spectre chest', content: 'Delve', note: 'Delve-exclusive.' },
    { item: 'Dread boss fight', content: 'Atlas Boss', note: 'For the +Minion amulet and +Minion helmet. Boss: Incarnation of Dread (pinnacle Atlas boss); poewiki lists Bonemeld (amulet, +minion spell gem levels) and The Dark Monarch (helmet, +minion spell gem levels).' },
    { item: '+1/+1 wand', content: 'Crafting', note: '' },
    { item: 'Darkness Enthroned', content: 'Abyss', note: '' },
    { item: 'Abyss jewel', content: 'Abyss', note: '', also: ['Delve'] },
    { item: 'Frostbearers', content: 'Settlers/Kingsmarch', note: 'Forged Frostbearer spectres.' },
  ],
  'ED Occultist': [
    { item: 'Timeless jewel', content: 'Legion (Timeless jewels)', note: '' },
  ],
};
const contentTypes = () => (S.contentTypes = Array.isArray(S.contentTypes) && S.contentTypes.length ? S.contentTypes : [...CONTENT_TYPES]);
function chase() { const c = C(); if (!Array.isArray(c.chase)) c.chase = []; return c.chase; }
function chaseFromTemplate(build) { return (CHASE_TEMPLATES[build] || []).map((x) => ({ id: uid(), also: [], ...x, done: false, doneTs: null })); }
function loadTemplate(build) {
  const have = new Set(chase().map((x) => ckey(x.item)));
  const add = chaseFromTemplate(build).filter((x) => !have.has(ckey(x.item)));
  for (const x of add) { chase().push(x); chaseItemAdded(x); if (!contentTypes().includes(x.content)) contentTypes().push(x.content); }
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
/* v5: "what am I watching for in Abyss" / "chase for abyss": the open items from that content (and ones that list it under
   "also from"), read out and shown filtered in the panel */
function findContent(name) {
  const n = String(name || '').trim(); if (!n) return null;
  return contentTypes().find((c) => ckey(c) === ckey(n)) || fuzzyPick(contentTypes(), (c) => [c, c.split(/[ (/]/)[0], ...c.split(/[/()]/).map((x) => x.trim()).filter(Boolean)], n, 0.7);
}
function chaseWatch(content) {
  const ct = findContent(content);
  if (!ct) return `${content} isn't one of your content types. Your list has ${contentTypes().filter((k) => chase().some((x) => hasType(x, k))).join(', ') || 'nothing yet'}.`;
  S.chaseUi.filter = ct; save(); renderChase();
  const sec = panelEl('chase'); if (sec && !layout().hidden.includes('chase')) { sec.scrollIntoView({ block: 'nearest' }); sec.classList.remove('flash'); void sec.offsetWidth; sec.classList.add('flash'); }
  const open = chaseLeft().filter((x) => hasType(x, ct)), done = chase().filter((x) => x.done && hasType(x, ct)).length;
  if (!open.length) return done ? `Nothing left from ${ct}: ${done} done.` : `Nothing on your chase list from ${ct}.`;
  const names = open.map((x) => x.item);
  const list = names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names.at(-1) : names[0];
  return `Farming ${ct}: watch for ${list}.${done ? ` ${done} already done.` : ''}${C().chaseOn ? '' : ' Power Chase is still off in the panel.'}`;
}
/* voice */
function applyChaseCmd(a, inv) {
  const prev = JSON.parse(JSON.stringify(chase())), prevCt = [...contentTypes()];
  const off = C().chaseOn ? '' : ' Power Chase is off; turn it on in the panel when maps and res are good.';
  if (a.op === 'add') {
    const item = String(a.item || '').trim(); if (!item) return { say: 'Say the item, like add chase item Darkness Enthroned from Abyss.', level: 'unknown' };
    if (chase().some((x) => ckey(x.item) === ckey(item))) return { say: `${item} is already on your chase list.`, level: 'unknown' };
    const content = pickContent(a.content || '');
    const nx = { id: uid(), item, content, note: '', also: [], done: false, doneTs: null }; chase().push(nx); chaseItemAdded(nx);
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
const CV = { edit: null };
function renderChase() {
  const el = $('chaseBody'); if (!el) return;
  const c = C(), on_ = !!c.chaseOn, list = chase(), ui = S.chaseUi || (S.chaseUi = { group: true, filter: '' });
  $('chaseOn').checked = on_;
  $('chaseSub').textContent = list.length ? `${list.filter((x) => x.done).length}/${list.length} done` : '';
  $('chase').classList.toggle('chase-off', !on_);
  const ready = curAct() > 10 && clearedIdx() >= 0;
  $('chaseHint').innerHTML = on_ ? '' : `<span class="${ready ? 'ok' : 'dim'}">${ready ? 'Maps and res look good: time to turn it on.' : 'Off during the campaign. Turn it on when maps and res are good.'}</span>`;
  el.classList.toggle('hidden', !on_);
  if (!on_) return;
  const cts = contentTypes();
  const stray = [...new Set(list.flatMap(itemTypes))].filter((k) => !cts.includes(k));   // an item whose type was deleted / renamed still gets a chip
  const used = [...cts, ...stray].filter((k) => list.some((x) => hasType(x, k)));
  if (ui.filter && !used.includes(ui.filter) && !cts.includes(ui.filter)) ui.filter = '';
  $('chaseGroup').checked = !!ui.group;
  const left = (k) => list.filter((x) => !x.done && hasType(x, k)).length;
  $('chaseChips').innerHTML = `<button type="button" class="sm ctfilter${ui.filter ? '' : ' on'}" data-ctfilter="" title="Show every content type">All <span class="dim">${list.filter((x) => !x.done).length}</span></button>` +
    used.map((k) => `<button type="button" class="sm ctfilter${ui.filter === k ? ' on' : ''}" data-ctfilter="${esc(k)}" style="--cc:${ctColor(k)}" title="Only what drops from ${esc(k)} (click again for all)">${esc(k)} <span class="dim">${left(k)}</span></button>`).join('');
  $('chaseNewContent').innerHTML = cts.map((k) => `<option>${esc(k)}</option>`).join('');
  const shown = list.filter((x) => !ui.filter || hasType(x, ui.filter));
  const tsel = (cur) => cts.map((k) => `<option${k === cur ? ' selected' : ''}>${esc(k)}</option>`).join('');
  const item = (x, inGroup) => CV.edit === x.id
    ? `<div class="citem edit" data-cid="${x.id}" style="--cc:${ctColor(x.content)}"><input data-cedit="item" value="${esc(x.item)}" title="Item name"><select data-cedit="content" title="Where it comes from">${tsel(x.content)}</select><input data-cedit="also" value="${esc((x.also || []).join(', '))}" placeholder="also from (optional), e.g. Delve" title="Other content that can drop it, comma separated"><input data-cedit="note" value="${esc(x.note || '')}" placeholder="note (optional)"><input data-cedit="wiki" value="${esc((x.wiki && x.wiki.url) || '')}" placeholder="wiki link (blank = no link)" title="Wiki page for this item. Paste a link, or clear it to leave the name unlinked.">${x.wikiManual ? `<button class="sm ghost" data-cwauto="${x.id}" title="Forget your link and look it up automatically again">auto link</button>` : ''}<button class="sm pri" data-csave="${x.id}" title="Save changes">Save</button><button class="sm ghost" data-ccancel="1" title="Discard changes">Cancel</button></div>`
    : `<div class="citem${x.done ? ' done' : ''}" data-cid="${x.id}" style="--cc:${ctColor(x.content)}">${x.wiki && x.wiki.url ? `<label><input type="checkbox" data-cdone="${x.id}"${x.done ? ' checked' : ''}></label> <b>${chaseName(x)}</b>` : `<label><input type="checkbox" data-cdone="${x.id}"${x.done ? ' checked' : ''}> <b>${esc(x.item)}</b></label>`}` +
      `${(inGroup ? (x.also || []).filter((a) => a !== x.content && a !== inGroup) : itemTypes(x)).map((t) => ctChip(t)).join('')}${inGroup && inGroup !== x.content ? ctChip(x.content, ' title="its main source"') : ''}` +
      `${x.note ? `<span class="cnote"> ${esc(x.note)}</span>` : ''}<span class="sp"></span><button class="sm ghost" data-cedit-btn="${x.id}" title="Edit item, content type, also-from and note">✎</button><button class="sm ghost" data-cdel="${x.id}" title="Delete this item">×</button></div>`;
  let html = '';
  if (ui.filter) {
    const open = shown.filter((x) => !x.done);
    html += `<div class="cwatch" style="--cc:${ctColor(ui.filter)}">Farming ${ctChip(ui.filter)}: ${open.length ? 'watch for <b>' + open.map((x) => esc(x.item)).join('</b>, <b>') + '</b>' : 'nothing open'}</div>`;
  }
  if (ui.group) {
    const groups = {};
    for (const x of shown) { const k = ui.filter || x.content || 'Other'; (groups[k] = groups[k] || []).push(x); }
    const order = Object.keys(groups).sort((a, b) => (cts.indexOf(a) + 1 || 99) - (cts.indexOf(b) + 1 || 99));
    html += order.map((k) => `<div class="cgroup" style="--cc:${ctColor(k)}"><div class="ch">${ctChip(k)} <span class="dim small">${groups[k].filter((x) => !x.done).length} left</span></div>${groups[k].map((x) => item(x, k)).join('')}</div>`).join('');
  } else html += shown.map((x) => item(x, null)).join('');
  $('chaseList').innerHTML = shown.length ? html : `<div class="dim">${list.length ? 'Nothing from ' + esc(ui.filter) + '.' : 'Nothing on the list. Add items below, or load a template.'}</div>`;
  $('ctList').innerHTML = cts.map((k, i) => `<span class="ctedit" style="--cc:${ctColor(k)}"><input type="color" value="${ctColor(k)}" data-ctcolor="${i}" title="Colour for ${esc(k)}">${ctChip(k)}${S.ctColors[k] ? `<button class="sm ghost" data-ctreset="${i}" title="Back to the default colour">↺</button>` : ''}<button class="sm ghost" data-ctdel="${i}" title="Remove the ${esc(k)} content type">×</button></span>`).join(' ');
}
function bindChase() {
  on('chaseOn', 'change', (e) => { C().chaseOn = e.target.checked; save(); renderChase(); });
  on('chaseGroup', 'change', (e) => { S.chaseUi.group = e.target.checked; save(); renderChase(); });
  on('chaseChips', 'click', (e) => { const b = e.target.closest('[data-ctfilter]'); if (!b) return; const k = b.dataset.ctfilter; S.chaseUi.filter = S.chaseUi.filter === k ? '' : k; save(); renderChase(); });
  on('chaseAddForm', 'submit', (e) => {
    e.preventDefault();
    const item = $('chaseNewItem').value.trim(); if (!item) return;
    const nx = { id: uid(), item, content: $('chaseNewContent').value, note: $('chaseNewNote').value.trim(), also: [], done: false, doneTs: null }; chase().push(nx); chaseItemAdded(nx);
    $('chaseNewItem').value = ''; $('chaseNewNote').value = ''; save(); renderChase();
  });
  on('chaseTpl', 'change', (e) => { const b = e.target.value; if (!b) return; const n = loadTemplate(b); e.target.value = ''; save(); renderChase(); toast(`${b} template: ${n} item${n === 1 ? '' : 's'} added`, 3); });
  on('ctAddForm', 'submit', (e) => {
    e.preventDefault(); const v = $('ctNew').value.trim();
    if (v && !contentTypes().includes(v)) { const oi = contentTypes().indexOf('Other'); contentTypes().splice(oi < 0 ? contentTypes().length : oi, 0, v); if ($('ctNewColor').dataset.touched) S.ctColors[v] = $('ctNewColor').value; }
    $('ctNew').value = ''; delete $('ctNewColor').dataset.touched; save(); renderChase();
  });
  on('ctNewColor', 'input', (e) => (e.target.dataset.touched = '1'));
  $('chase').addEventListener('click', (e) => {
    const d = e.target.dataset, byId = (id) => chase().find((x) => x.id === id);
    if (d.cdel) { C().chase = chase().filter((x) => x.id !== d.cdel); save(); renderChase(); }
    else if (d.ceditBtn) { CV.edit = d.ceditBtn; renderChase(); }
    else if (d.ccancel) { CV.edit = null; renderChase(); }
    else if (d.cwauto) { const x = byId(d.cwauto); if (x) { x.wikiManual = false; x.wiki = null; chaseItemAdded(x); } CV.edit = null; save(); renderChase(); }
    else if (d.csave) {
      const x = byId(d.csave), row = e.target.closest('.citem');
      if (x) {
        const g = (k) => row.querySelector(`[data-cedit="${k}"]`).value;
        const oldName = x.item, oldUrl = (x.wiki && x.wiki.url) || '', url = g('wiki').trim();
        x.item = g('item').trim() || x.item; x.content = g('content'); x.note = g('note').trim();
        if (url !== oldUrl) {
          if (url && !/^https?:\/\//i.test(url)) toast('A wiki link has to start with https://', 2);
          else { x.wikiManual = true; x.wikiChecked = true; x.wiki = url ? { url, title: x.item, source: 'manual' } : null; }
        } else if (ckey(oldName) !== ckey(x.item) && !x.wikiManual) { x.wiki = null; chaseItemAdded(x); }
        x.also = g('also').split(',').map((t) => t.trim()).filter(Boolean).map((t) => findContent(t) || pickContent(t)).filter((t) => t !== x.content);
      }
      CV.edit = null; save(); renderChase();
    }
    else if (d.ctreset != null) { delete S.ctColors[contentTypes()[+d.ctreset]]; save(); renderChase(); }
    else if (d.ctdel != null) { const k = contentTypes()[+d.ctdel]; if (chase().some((x) => hasType(x, k)) && !confirm(`Items still use “${k}”. Remove it from the list anyway?`)) return; contentTypes().splice(+d.ctdel, 1); save(); renderChase(); }
  });
  $('chase').addEventListener('change', (e) => {
    const d = e.target.dataset;
    if (d.ctcolor != null) { S.ctColors[contentTypes()[+d.ctcolor]] = e.target.value; save(); renderChase(); return; }
    const id = d.cdone; if (!id) return;
    const x = chase().find((y) => y.id === id); if (x) { x.done = e.target.checked; x.doneTs = x.done ? now() : null; save(); renderChase(); }
  });
}
