/* ---------- v4: per-character drop / event types ----------
   C().types = [{ id, name, kind: 'drop'|'event', aliases: [], builtin?: EVENTS label (keeps its effect), named?: [kinds] }].
   Spoken: the companion matches them ("dropped a 4 link" -> 4-link); typed: the manual-add box in the manager.
   DEFAULT_TYPES comes from voice/default_types.json (embedded by build.js). */
const NUMW = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
function ckey(s) {
  let k = String(s || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9/+]+/g, ' ');
  k = k.replace(/\b(one|two|three|four|five|six)\b/g, (w) => NUMW[w]);
  k = k.replace(/\b(?:for|fore)\s+(?=(?:link|links|linked|l|socket|sockets)\b)/g, '4 ');
  k = k.replace(/\b([1-6])\s?l\b/g, '$1 link').replace(/\b([1-6])\s?s\b/g, '$1 socket');
  k = k.replace(/\b(?:links|linked|linker)\b/g, 'link').replace(/\b(?:sockets|socketed)\b/g, 'socket').replace(/\bcolou?rs?\b/g, 'colours');
  k = k.replace(/\bvisceras\b/g, 'viscera').replace(/\bcards\b/g, 'card').replace(/\buniques\b/g, 'unique');
  return k.replace(/\s+/g, ' ').trim();
}
/* similarity 0..1: Levenshtein ratio on the keys, with whole-word overlap as a floor */
function levRatio(a, b) {
  if (a === b) return 1; if (!a || !b) return 0;
  const m = a.length, n = b.length; let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
  return 1 - prev[n] / Math.max(m, n);
}
function similar(q, name) {
  const a = ckey(q).replace(/^the /, ''), b = ckey(name).replace(/^the /, '');
  if (!a || !b) return 0;
  if (a === b) return 1;
  const aw = a.split(' '), bw = new Set(b.split(' '));
  const overlap = aw.filter((w) => bw.has(w) || [...bw].some((x) => x.length >= 4 && w.length >= 4 && (x.startsWith(w) || w.startsWith(x)))).length / Math.max(aw.length, bw.size);
  const contains = b.includes(a) || a.includes(b) ? 0.85 : 0;
  return Math.max(levRatio(a, b), overlap, contains);
}
function fuzzyPick(list, nameOf, q, min = 0.6) {
  let best = null, bs = 0;
  for (const x of list) { const names = [].concat(nameOf(x)); for (const n of names) { const s = similar(q, n); if (s > bs) { bs = s; best = x; } } }
  return bs >= min ? best : null;
}

const defaultTypes = () => JSON.parse(JSON.stringify(typeof DEFAULT_TYPES !== 'undefined' ? DEFAULT_TYPES : []));
function types() { const c = C(); if (!Array.isArray(c.types)) c.types = defaultTypes(); return c.types; }
/* the type said / typed in free text: longest whole-word alias wins; hypotheticals ("I need a 5 link") never match a drop */
function matchType(text, opts = {}) {
  const k = ' ' + ckey(text) + ' ';
  let best = null, bl = 0;
  for (const t of types()) {
    if (opts.noBuiltin && t.builtin) continue;
    if (t.enabled === false) continue;          // v5.2: turned off in Configure
    for (const a of [t.name, ...(t.aliases || [])]) { const ak = ckey(a); if (ak.length >= 2 && k.includes(' ' + ak + ' ') && ak.length > bl) { bl = ak.length; best = t; } }
  }
  if (best && best.kind === 'drop' && / (not|no|never|need|needs|missing|without|want|wish|hope|hoping|if|going to|gonna|would|could) /.test(k.replace(/ no way /g, ' '))) return null;
  return best;
}
function typeLogText(t, text) {
  if (t.builtin) return t.builtin;
  if (t.named && text) {   // "Unique Bones of Ullr" -> "Unique: Bones of Ullr"
    let rest = ' ' + String(text).trim() + ' ';
    for (const a of [t.name, ...(t.aliases || [])].sort((x, y) => y.length - x.length)) rest = rest.replace(new RegExp('\\s(?:a |an |the )?' + a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s', 'i'), ' ');
    rest = rest.replace(/^\s*(?:dropped|found|got|looted|picked up)\s+/i, '').replace(/^[\s:,-]+|[\s:,-]+$/g, '');
    if (rest && ckey(rest) !== ckey(t.name)) return `${t.name}: ${rest}`;
  }
  return t.name;
}
function findType(name, kind) {
  const list = types().filter((t) => !kind || t.kind === kind);
  return list.find((t) => ckey(t.name) === ckey(name) || (t.aliases || []).some((a) => ckey(a) === ckey(name))) || fuzzyPick(list, (t) => [t.name, ...(t.aliases || [])], name, 0.75);
}
function addType(name, kind, aliases = []) {
  name = String(name || '').trim(); if (!name) return null;
  const t = { id: 'u' + uid(), name, kind: kind === 'event' ? 'event' : 'drop', aliases: [...new Set([name.toLowerCase(), ...aliases.map((a) => a.trim()).filter(Boolean)])] };
  types().push(t); return t;
}
/* the companion matches speech against the current character's list */
let typeSyncTimer = null;
function syncTypes() {
  if (!VOICE.served) return;
  clearTimeout(typeSyncTimer);
  typeSyncTimer = setTimeout(() => fetch('/api/custom_types', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ types: types().filter((t) => t.enabled !== false) }) }).catch(() => {}), 50);
}
function typesChanged() { save(); syncTypes(); renderTypes(); renderSuggest(); }

/* voice: "add drop type five link" / "delete event type boss down" / "rename drop type X to Y" / "add alias X to type Y" */
function applyTypeCmd(a, inv) {
  const prev = JSON.parse(JSON.stringify(types()));
  const kindW = (k) => (k === 'event' ? 'event' : 'drop');
  if (a.op === 'add') {
    const ex = types().find((t) => ckey(t.name) === ckey(a.name) || (t.aliases || []).some((x) => ckey(x) === ckey(a.name)));
    if (ex) return { say: `${ex.name} is already a ${ex.kind} type.`, level: 'unknown' };
    const t = addType(a.name, a.kind);
    inv.push({ k: 'types', prev }); typesChanged();
    return { say: `Added ${kindW(t.kind)} type ${t.name}. Say ${t.name.toLowerCase()} to log it.` };
  }
  const t = findType(a.name, a.kind || null);
  if (!t) return { say: `No ${a.kind ? a.kind + ' ' : ''}type called ${a.name}.`, level: 'unknown' };
  if (a.op === 'delete') { C().types = types().filter((x) => x !== t); inv.push({ k: 'types', prev }); typesChanged(); return { say: `Deleted ${t.kind} type ${t.name}.` }; }
  if (a.op === 'rename') { const old = t.name; t.name = a.to; t.aliases = [...new Set([...(t.aliases || []), a.to.toLowerCase()])]; inv.push({ k: 'types', prev }); typesChanged(); return { say: `Renamed ${old} to ${t.name}.` }; }
  if (a.op === 'alias') { t.aliases = [...new Set([...(t.aliases || []), a.alias])]; inv.push({ k: 'types', prev }); typesChanged(); return { say: `${t.name} now also answers to ${a.alias}.` }; }
  return { say: '', level: 'unknown' };
}

function renderTypes() {
  const el = $('typeTable'); if (!el) return;
  const ts = types();
  $('typeCount').textContent = ts.length;
  const row = (t) => `<tr data-tid="${esc(t.id)}"><td><input class="tname" data-tname="${esc(t.id)}" value="${esc(t.name)}"></td>
    <td><select data-tkind="${esc(t.id)}"><option value="drop"${t.kind === 'drop' ? ' selected' : ''}>drop</option><option value="event"${t.kind === 'event' ? ' selected' : ''}>event</option></select></td>
    <td><input class="talias" data-talias="${esc(t.id)}" value="${esc((t.aliases || []).join(', '))}" placeholder="spoken aliases, comma separated"></td>
    <td>${t.builtin ? '<span class="bi" title="Built-in: keeps the tracker effect (e.g. a death marks the character dead)">★</span>' : ''}</td>
    <td><button class="sm ghost" data-tdel="${esc(t.id)}" title="Delete type">×</button></td></tr>`;
  el.innerHTML = '<colgroup><col style="width:34%"><col style="width:62px"><col><col style="width:16px"><col style="width:26px"></colgroup><tr><th>Name</th><th>Kind</th><th>Spoken aliases</th><th></th><th></th></tr>' + ts.map(row).join('');
}
function bindTypes() {
  on('typeAddForm', 'submit', (e) => {
    e.preventDefault();
    const n = $('typeNewName').value.trim(); if (!n) return;
    if (types().some((t) => ckey(t.name) === ckey(n))) { toast(esc(n) + ' already exists', 2); return; }
    addType(n, $('typeNewKind').value, $('typeNewAlias').value.split(','));
    $('typeNewName').value = ''; $('typeNewAlias').value = ''; typesChanged();
  });
  const byId = (id) => types().find((t) => t.id === id);
  $('typeTable').addEventListener('change', (e) => {
    const d = e.target.dataset;
    if (d.tname) { const t = byId(d.tname), v = e.target.value.trim(); if (t && v) { t.name = v; typesChanged(); } }
    else if (d.tkind) { const t = byId(d.tkind); if (t) { t.kind = e.target.value; typesChanged(); } }
    else if (d.talias) { const t = byId(d.talias); if (t) { t.aliases = e.target.value.split(',').map((x) => x.trim()).filter(Boolean); typesChanged(); } }
  });
  $('typeTable').addEventListener('click', (e) => {
    const id = e.target.dataset.tdel; if (!id) return;
    const t = byId(id); if (!t) return;
    C().types = types().filter((x) => x !== t); typesChanged(); toast('Deleted type ' + esc(t.name), 3);
  });
  on('btnTypesDefault', 'click', () => { if (confirm('Replace this character\'s drop & event types with the defaults?')) { C().types = defaultTypes(); typesChanged(); } });
}
