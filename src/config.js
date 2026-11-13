/* ---------- v5.2: Configure page (defense stats + tiers, triggers + rules, general settings) ----------
   Per character: C().defProfile = { on: {stat: bool}, poolPerAct, tiers: [{ id, name, band, fateCap, req: {...} }] }.
   Shared: S.rules (count / time-window rules, e.g. 2 near-deaths in 30 min -> go to bed), S.cfg (wiki options),
   S.wikiCache (chase item wiki lookups). Everything is part of S, so Download backup / Restore carry it. */

/* ---- defense stats ---- */
const DEF_STATS = [
  { k: 'life', label: 'Life', group: 'Built-in', tip: 'Maximum life.' },
  { k: 'es', label: 'Energy Shield', group: 'Built-in', tip: 'Maximum energy shield.' },
  { k: 'mana', label: 'Mana', group: 'Built-in', tip: 'Maximum mana. With Mind Over Matter on it counts toward the effective pool.' },
  { k: 'pool', label: 'Life + ES pool', group: 'Built-in', tip: 'Life + ES (or the total you type). With Mind Over Matter on, checks use the effective pool.' },
  { k: 'res', label: 'Elemental res (fire / cold / lightning)', group: 'Built-in', req: 'bool', reqLabel: 'capped 75/75/75', tip: 'In-game numbers (Kitava penalty included).' },
  { k: 'over', label: 'Elemental overcap (~10%)', group: 'Built-in', req: 'bool', reqLabel: 'overcapped', tip: 'Overcap protects against curses and exposure.' },
  { k: 'chaos', label: 'Chaos res', group: 'Built-in', unit: '%' },
  { k: 'ablock', label: 'Attack block', group: 'Built-in', unit: '%' },
  { k: 'block', label: 'Spell block', group: 'Built-in', unit: '%' },
  { k: 'ehp', label: 'EHP / max hit (PoB-style estimate)', group: 'Built-in', input: 'none', reqLabel: 'EHP ≥', tip: 'Max hit per damage type and an average EHP, computed the way Path of Building does from the numbers in the panel. An approximation.' },
  { k: 'mom', label: 'Mind Over Matter', group: 'Optional', req: 'bool', reqLabel: 'MoM on', input: 'bool',
    tip: 'Mind Over Matter: 40% of damage taken from mana before life. Effective pool = ES + min(life ÷ 0.6, life + mana): life runs out after life ÷ 0.6 damage if mana lasts (mana ≥ ⅔ × life); otherwise mana runs dry first and you get life + mana. Mana regeneration and reservation are ignored.' },
  { k: 'evasion', label: 'Evasion rating', group: 'Optional' },
  { k: 'evade', label: 'Evade chance', group: 'Optional', unit: '%', tip: 'Chance to evade attacks (the Defences tab’s “Estimated chance to Evade Attacks”). Use it for dodge too.' },
  { k: 'suppress', label: 'Spell suppression', group: 'Optional', unit: '%', tip: 'Chance to suppress spell damage (100% is the usual goal).' },
  { k: 'armour', label: 'Armour', group: 'Optional' },
  { k: 'pdr', label: 'Physical damage reduction', group: 'Optional', unit: '%', tip: 'The Defences tab’s “Estimated Physical Damage reduction”.' },
  { k: 'endurance', label: 'Endurance charges', group: 'Optional', tip: 'Maximum endurance charges you keep up.' },
  { k: 'ptaken', label: 'Physical damage taken as', group: 'Optional', unit: '%', input: 'ptaken', reqLabel: 'total taken as ≥', tip: 'Physical damage taken as fire / cold / lightning / chaos, % each. Tiers check the total.' },
  { k: 'leech', label: 'Leech per second', group: 'Optional', input: 'leech', tip: 'Life leech per second. Tick Overleech if your leech continues at full life (e.g. Slayer).' },
];
const DSTAT = Object.fromEntries(DEF_STATS.map((s) => [s.k, s]));
const DEF_ON_DEFAULT = { ehp: true, life: true, es: true, mana: true, pool: true, res: true, over: true, chaos: true, ablock: true, block: true,
  mom: false, evasion: false, evade: false, suppress: false, armour: false, pdr: false, endurance: false, ptaken: false, leech: false };
const PTAKEN = ['fire', 'cold', 'lightning', 'chaos'];
const TIER_META = [
  { id: 'G01', name: 'Map entry', band: 'T1–5', fateCap: 1 },
  { id: 'G02', name: 'T6+', band: 'T6–10', fateCap: 2 },
  { id: 'G03', name: 'T11+', band: 'T11–14', fateCap: 3 },
  { id: 'G04', name: 'T15+', band: 'T15+ / Legion / 3-Fate red', fateCap: 3 },
  { id: 'G05', name: 'Pinnacle boss ready', band: 'Pinnacle bosses', fateCap: 3 },
  { id: 'G06', name: 'Uber ready', band: 'Uber pinnacle bosses', fateCap: 3 },
];
/* starting points: the old built-in gates (res cap, overcap, chaos 0/30/60/75, spell block 50 at T11 for spell-block builds) with
   The pool rule (3000 at map entry, 5000 from T6), then extended to pinnacle / uber. Pool per bar: relaxed / standard / melee. */
const TIER_POOL = { relaxed: [3000, 5000, 5000, 5500, 6500, 8000], standard: [3200, 5000, 6000, 7000, 8000, 10000], melee: [3200, 5000, 6000, 7000, 8000, 10000] };
function defaultTiers(build) {
  const b = BUILDS.find((x) => x.name === build) || BUILDS[BUILDS.length - 1];
  const bar = build === 'Spectre Necromancer' && typeof BUILD_PLAN !== 'undefined' && BUILD_PLAN.bar ? BUILD_PLAN.bar : b.bar;
  const pools = TIER_POOL[bar] || TIER_POOL.standard;
  const chaos = [0, 30, 60, 75, 75, 75], over = [false, true, true, true, true, true];
  return TIER_META.map((m, i) => ({ ...m, req: { res: true, over: over[i], chaos: chaos[i], pool: pools[i], ...(b.spellBlock && i >= 2 ? { block: 50 } : {}) } }));
}
function defaultProfile(build) { return { v: 1, on: { ...DEF_ON_DEFAULT }, poolPerAct: 300, poolMap: 3000, poolT6: 5000, tiers: defaultTiers(build), build }; }
function defProfile(c = C()) {
  let p = c.defProfile;
  if (!p || !Array.isArray(p.tiers)) p = c.defProfile = defaultProfile(c.build);
  else if (!p.custom && p.build !== c.build) { p.tiers = defaultTiers(c.build); p.build = c.build; }   // untouched defaults follow a build change
  p.on = { ...DEF_ON_DEFAULT, ...(p.on || {}) };
  if (!(p.poolPerAct > 0)) p.poolPerAct = 300;
  if (!(p.poolMap > 0)) p.poolMap = 3000;
  if (!(p.poolT6 > 0)) p.poolT6 = 5000;
  for (const m of TIER_META) if (!p.tiers.some((t) => t.id === m.id)) p.tiers.push(defaultTiers(c.build).find((t) => t.id === m.id));
  return p;
}
const statOn = (k) => !!defProfile().on[k];
const tiers = () => defProfile().tiers;
const tierIdx = (id) => tiers().findIndex((t) => t.id === id);
function ptakenTotal(d = C().def) { const p = d.ptaken || {}; const vals = PTAKEN.map((k) => p[k]).filter((v) => v != null); return vals.length ? vals.reduce((a, b) => a + b, 0) : null; }
/* effective pool: life + ES, or with Mind Over Matter ES + min(life / 0.6, life + mana) */
function effPool(d = C().def) {
  if (statOn('mom') && d.mom && d.life != null && !d.poolManual) {
    const life = d.life, mana = d.mana || 0;
    return Math.round((d.es || 0) + Math.min(life / 0.6, life + mana));
  }
  return d.pool;
}
function momNote(d = C().def) {
  if (!(statOn('mom') && d.mom)) return '';
  if (d.life == null) return 'MoM on: enter life and mana.';
  const capByLife = d.life / 0.6, capByMana = d.life + (d.mana || 0);
  return `MoM effective pool ${effPool(d)} = ES ${d.es || 0} + min(life ${d.life} ÷ 0.6 = ${Math.round(capByLife)}, life + mana = ${capByMana})${(d.mana || 0) < d.life * 2 / 3 ? ' · mana runs out first' : ''}`;
}
/* one tier: every enabled stat that has a requirement */
function gateCheck(g) {
  const d = C().def, on_ = defProfile().on, r = g.req || {}, fails = [];
  const lt = (label, v, min, unit = '') => fails.push(`${label} ${v ?? '?'} < ${min}${unit}`);
  if (on_.res && r.res) {
    if (d.resStale) fails.push('res from before Kitava: re-enter');
    else if (!d.ele) fails.push(resKnown(d) && uncappedList(d).length ? 'uncapped: ' + uncappedList(d).join(', ') : 'ele res not capped');
  }
  if (on_.over && r.over && !d.over) fails.push('no ~10% overcap');
  if (on_.chaos && r.chaos != null && (d.chaos == null || d.chaos < r.chaos)) fails.push(`chaos ${d.chaos ?? '?'} < ${r.chaos}`);
  if (on_.pool && r.pool != null) { const p = effPool(d); if (p == null || p < r.pool) fails.push(`pool ${p ?? '?'} < ${r.pool}`); }
  for (const k of ['life', 'es', 'mana', 'evasion', 'armour', 'endurance']) if (on_[k] && r[k] != null && (d[k] == null || d[k] < r[k])) lt(DSTAT[k].label.toLowerCase(), d[k], r[k]);
  for (const k of ['evade', 'suppress', 'pdr', 'ablock']) if (on_[k] && r[k] != null && (d[k] == null || d[k] < r[k])) lt(DSTAT[k].label.toLowerCase(), d[k], r[k], '%');
  if (on_.block && r.block != null && (d.block == null || d.block < r.block)) fails.push(`spell block ${d.block ?? '?'} < ${r.block}%`);
  if (on_.mom && r.mom && !d.mom) fails.push('Mind Over Matter off');
  if (on_.ptaken && r.ptaken != null) { const t = ptakenTotal(d); if (t == null || t < r.ptaken) lt('phys taken as', t, r.ptaken, '%'); }
  if (on_.ehp && r.ehp != null) { const e = ehpCalc(d); if (!e || e.ehp < r.ehp) fails.push(`EHP ${e ? Math.round(e.ehp) : '?'} < ${r.ehp}`); }
  if (on_.leech && r.leech != null && (d.leech == null || d.leech < r.leech)) lt('leech/s', d.leech, r.leech);
  if (on_.leech && r.overleech && !d.overleech) fails.push('no overleech');
  return { pass: !fails.length, fails, ehpReq: 0 };
}
function clearedIdx() { let i = -1; for (const g of tiers()) { if (gateCheck(g).pass) i++; else break; } return i; }
function maxTierCleared() { const i = clearedIdx(); return i < 0 ? 0 : i === 0 ? 5 : i === 1 ? 10 : i === 2 ? 14 : 16; }
/* Pool colour: green when the pool is over 300 × act in the campaign, 3000 at map start, 5000 from T6 (yellow maps). */
function poolTarget() {
  const c = C(), a = curAct(), p = defProfile();
  if (a <= 10) return { v: p.poolPerAct * a, why: `Act ${a}: ${p.poolPerAct} × act` };
  return (c.band || 0) >= 6 ? { v: p.poolT6, why: 'T6+ yellow maps' } : { v: p.poolMap, why: 'map start' };
}

/* ---- rules: count / time-window (built-in: 2 near-deaths in 30 min -> stop for the night, S03) ---- */
const RULE_DEFAULTS = [
  { id: 'near2', builtin: true, enabled: true, name: 'Go to bed after near-deaths', match: 'fx:near', count: 2, windowMin: 30, mergeSec: 90,
    title: 'Stop for the night (S03)', note: '{n} near-deaths in {window}: END THE SESSION (S03).', detail: '{count} near-deaths within {window}. Stash insurance items, log stats, log off.',
    first: 'First in {window}: drop one tier band, do a gear audit.', alert: false, say: true, nextUp: true },
];
function rules() { if (!Array.isArray(S.rules)) S.rules = JSON.parse(JSON.stringify(RULE_DEFAULTS)); return S.rules; }
const nearRule = () => rules().find((r) => r.id === 'near2');
const winWords = (r) => (r.windowMin > 0 ? `${r.windowMin} min` : 'this session');
const fillRule = (s, r, n) => String(s || '').replace(/\{n\}/g, n).replace(/\{count\}/g, r.count).replace(/\{window\}/g, winWords(r));
function ruleMatches(r, l) {
  const [k, v] = String(r.match || '').split(':');
  if (k === 'fx') return l.fx === v;
  if (k === 'type') return l.type === v;
  if (k === 'trig') return (l.ids || []).includes(v);
  return false;
}
/* session = since the league timer last started / resumed */
function sessionStart() { const c = C(); const ps = (c.campaign.pauses || []).filter((p) => p.to); return Math.max(c.campaign.start || 0, ps.length ? ps.at(-1).to : 0); }
/* incidents: matching entries within the window; entries within mergeSec of each other are one incident */
function ruleCount(r, t = now()) {
  const from = r.windowMin > 0 ? t - r.windowMin * MIN : sessionStart();
  const ts = S.log.filter((l) => l.char === C().created && ruleMatches(r, l) && l.ts >= from && l.ts <= t).map((l) => l.ts).sort((a, b) => a - b);
  let n = 0, last = -Infinity;
  for (const x of ts) { if (x - last > (r.mergeSec || 0) * 1000) n++; last = x; }
  return n;
}
function nearDeaths30() { const r = nearRule(); return r && r.enabled ? ruleCount(r) : 0; }
function nearDeathNote() {
  const r = nearRule(); if (!r || !r.enabled) return 'Near-death logged.';
  const n = ruleCount(r);
  return n >= r.count ? fillRule(r.note, r, n) : fillRule(r.first, r, n);
}
/* after a log entry: rules that just reached their count (once per incident) */
function fireRules(entry) {
  const out = [];
  if (entry.sameIncident) return out;
  for (const r of rules()) {
    if (!r.enabled || !ruleMatches(r, entry)) continue;
    const n = ruleCount(r);
    if (n < r.count) continue;
    const msg = fillRule(r.note || r.title, r, n);
    out.push({ id: r.id, n, msg, alert: !!r.alert, title: fillRule(r.title, r, n), detail: fillRule(r.detail, r, n) });
  }
  if (out.length) entry.rules = out;
  return out;
}
/* Next Up tasks from rules currently over their count */
function ruleTasks() {
  return rules().filter((r) => r.enabled && r.nextUp && ruleCount(r) >= r.count).map((r) => ({ title: fillRule(r.title, r, ruleCount(r)), detail: fillRule(r.detail, r, ruleCount(r)) }));
}
/* spoken: rule messages not already in the trigger's own note (near2 rides on E01's note) */
function ruleSay(entry, already = '') {
  return (entry.rules || []).map((x) => rules().find((r) => r.id === x.id)).filter((r) => r && r.say).map((r) => fillRule(r.note || r.title, r, ruleCount(r))).filter((m) => m && !already.includes(m)).join(' ');
}

/* ---- types: enable / disable, custom alert + spoken text ---- */
const typeOn = (t) => t && t.enabled !== false;
function typeEffects(t) {
  const bits = [t.kind === 'event' ? 'logs an event' : 'logs a drop'];
  const ev = t.builtin ? EVENTS.find((e) => e.label === t.builtin) : null;
  const FX = { death: 'marks the character dead', near: 'counts as a near-death (see rules)', lvl68: 'sets level 68' };
  if (ev && ev.fx) bits.push(FX[ev.fx] || (ev.fx.startsWith('band') ? `sets your map tier to T${ev.fx.slice(4)}` : ev.fx));
  const ids = matchText(t.builtin || t.name).ids;
  for (const id of ids.slice(0, 3)) { const tr = trigById[id]; if (tr) bits.push(`Open Trigger Action ${tr.id} (P${tr.priority}${tr.priority === 1 ? ': alert + spoken' : ''}): ${tr.item} → ${tr.action}`); }
  if (t.alert) bits.push('shows an alert');
  if (t.say) bits.push(`says “${t.say}”`);
  const rs = rules().filter((r) => r.enabled && (r.match === 'type:' + t.id || (ev && r.match === 'fx:' + ev.fx)));
  for (const r of rs) bits.push(`rule: ${r.name}`);
  return bits;
}

/* ---- Power Chase wiki links ---- */
const CHASE_GENERIC = /(^|[\s(])[+\d]|\b(jewels?|boss|bosses|fight|chest|wand|links?|linked|sockets?|craft|crafted|crafting|helmet|amulet|ring|rings|gloves|boots|belt|body armou?r|weapon|shield|maps?|cards?|currency|any|some|good|rare|uniques?|gear|items?|upgrades?|base|bases|spectres?|minions?|setup)\b/i;
const chaseGeneric = (name) => CHASE_GENERIC.test(String(name || ''));
const CL = { busy: false, timer: null };
function wikiCache() { if (!S.wikiCache || typeof S.wikiCache !== 'object') S.wikiCache = {}; return S.wikiCache; }
function chaseLinkPending() { return chase().filter((x) => !x.wikiChecked && !x.wikiManual && !chaseGeneric(x.item)); }
/* async, one at a time; adding an item is never slowed down. Offline: nothing changes, retried later. */
function chaseLinkSweep() {
  if ((S.cfg || {}).chaseWiki === false) return;
  for (const x of chase()) if (!x.wikiChecked && !x.wikiManual && chaseGeneric(x.item)) { x.wikiChecked = true; x.wiki = null; x.wikiGeneric = true; }
  const todo = chaseLinkPending();
  if (!todo.length || CL.busy || !VOICE.served) return;
  const x = todo[0], key = ckey(x.item), hit = wikiCache()[key];
  if (hit) { applyChaseLink(x, hit); save(); renderChase(); setTimeout(chaseLinkSweep, 0); return; }
  CL.busy = true;
  const item = x.item;
  fetch('/api/wiki_lookup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: item }) })
    .then((r) => r.json())
    .then((r) => {
      if (!r || r.error && !r.found) throw new Error((r && r.error) || 'lookup failed');
      const res = { found: !!r.found, title: r.title || '', url: r.url || '', source: r.source || '', generic: !!r.generic, ts: now() };
      wikiCache()[key] = res;
      const y = chase().find((z) => z.id === x.id && z.item === item);
      if (y && !y.wikiManual) applyChaseLink(y, res);
      save(); renderChase();
    })
    .catch(() => { CL.retryAt = now() + 60000; })
    .finally(() => { CL.busy = false; if (!CL.retryAt || now() >= CL.retryAt) setTimeout(chaseLinkSweep, 0); });
}
function applyChaseLink(x, res) { x.wikiChecked = true; x.wikiGeneric = !!res.generic; x.wiki = res.found && res.url ? { url: res.url, title: res.title, source: res.source } : null; }
function chaseItemAdded(x) { x.wikiChecked = false; setTimeout(chaseLinkSweep, 0); }
setInterval(() => { if (CL.retryAt && now() >= CL.retryAt) CL.retryAt = 0; chaseLinkSweep(); }, 20000);
const chaseName = (x) => (x.wiki && x.wiki.url ? `<a class="clink" href="${esc(x.wiki.url)}" target="_blank" rel="noopener" title="${esc(x.wiki.title || x.item)}${x.wiki.source && x.wiki.source !== 'poewiki' ? ' · ' + esc(x.wiki.source) : ''} (opens in a new tab)">${esc(x.item)}</a>` : esc(x.item));

/* ---- migration ---- */
function ensureV52() {
  S.cfg = Object.assign({ chaseWiki: true }, S.cfg || {});
  wikiCache(); rules();
  for (const r of RULE_DEFAULTS) if (!S.rules.some((x) => x.id === r.id)) S.rules.unshift(JSON.parse(JSON.stringify(r)));
  defProfile();
  const d = C().def;
  for (const k of ['mom', 'overleech']) if (d[k] == null) d[k] = false;
  if (!d.ptaken || typeof d.ptaken !== 'object') d.ptaken = {};
  for (const x of chase()) if (x.wikiChecked == null) x.wikiChecked = false;     // v5.1 items: one-time backfill
  S.v52 = 1;
}

/* ---- Defense panel: built-in rows follow the toggles; optional stats get inputs ---- */
const DEFX = { sig: '' };
function renderDefStats() {
  const on_ = defProfile().on, d = C().def;
  for (const el of document.querySelectorAll('#defense [data-stat]')) el.classList.toggle('hidden', !on_[el.dataset.stat]);
  const extra = DEF_STATS.filter((s) => s.group === 'Optional' && on_[s.k] && s.input !== 'none');
  renderEhp();
  const sig = extra.map((s) => s.k).join(',');
  const box = $('defExtra'); if (!box) return;
  if (sig !== DEFX.sig) {
    DEFX.sig = sig;
    box.innerHTML = extra.map((s) => {
      const tip = s.tip ? ` title="${esc(s.tip)}"` : '';
      if (s.input === 'bool') return `<label${tip}>${esc(s.label)}</label><span><label${tip}><input type="checkbox" data-dbool="${s.k}"> on <span class="tipq"${tip}>ⓘ</span></label> <span class="dim small" id="momNote"></span></span>`;
      if (s.input === 'ptaken') return `<label${tip}>${esc(s.label)} %</label><span class="resrow">${PTAKEN.map((k) => `<label>${k[0].toUpperCase() + k.slice(1, 5)} <input type="number" min="0" max="100" data-dpt="${k}"></label>`).join('')}</span>`;
      if (s.input === 'leech') return `<label${tip}>${esc(s.label)}</label><span class="resrow"><label><input type="number" min="0" step="10" data-dnum="leech"></label><label title="Leech keeps going at full life"><input type="checkbox" data-dbool="overleech"> Overleech</label></span>`;
      return `<label${tip}>${esc(s.label)}${s.unit ? ' ' + s.unit : ''}</label><input type="number" min="0" data-dnum="${s.k}"${tip}>`;
    }).join('');
  }
  for (const el of box.querySelectorAll('[data-dnum]')) if (document.activeElement !== el) el.value = d[el.dataset.dnum] ?? '';
  for (const el of box.querySelectorAll('[data-dpt]')) if (document.activeElement !== el) el.value = (d.ptaken || {})[el.dataset.dpt] ?? '';
  for (const el of box.querySelectorAll('[data-dbool]')) el.checked = !!d[el.dataset.dbool];
  const mn = $('momNote'); if (mn) mn.textContent = momNote(d);
  const mana = $('dMana'); if (mana && document.activeElement !== mana) mana.value = d.mana ?? '';
}
function bindDefStats() {
  $('defExtra').addEventListener('input', (e) => {
    const t = e.target, d = C().def;
    if (t.dataset.dnum) setDef(t.dataset.dnum, num(t.value));
    else if (t.dataset.dpt) { d.ptaken = d.ptaken || {}; d.ptaken[t.dataset.dpt] = num(t.value); setDef('ptaken', d.ptaken); }
  });
  $('defExtra').addEventListener('change', (e) => { const t = e.target; if (t.dataset.dbool) setDef(t.dataset.dbool, t.checked); });
  on('dMana', 'input', (e) => setDef('mana', num(e.target.value)));
}

/* ---- the Configure page ---- */
const CFG = { open: false, sec: 'defense' };
const CFG_SECS = [['defense', 'Defense stats'], ['tiers', 'Tier checks'], ['triggers', 'Drop & event triggers'], ['rules', 'Rules'], ['general', 'General']];
function openConfig(sec) {
  CFG.open = true; if (sec) CFG.sec = sec;
  $('cfgPage').classList.remove('hidden'); document.body.classList.add('cfg-open');
  renderConfig(); $('cfgPage').scrollTop = 0; $('btnCfgClose').focus({ preventScroll: true });
  if (location.hash !== '#configure') history.replaceState(null, '', '#configure');
}
function closeConfig() {
  CFG.open = false; $('cfgPage').classList.add('hidden'); document.body.classList.remove('cfg-open');
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  renderAll();
}
function renderConfig() {
  if (!CFG.open) return;
  $('cfgNav').innerHTML = CFG_SECS.map(([k, n]) => `<button type="button" class="${CFG.sec === k ? 'on' : ''}" data-cfgsec="${k}">${esc(n)}</button>`).join('');
  $('cfgChar').textContent = `${C().name || 'unnamed'} · ${C().build}`;
  const f = { defense: cfgDefense, tiers: cfgTiers, triggers: cfgTriggers, rules: cfgRules, general: cfgGeneral }[CFG.sec] || cfgDefense;
  $('cfgBody').innerHTML = f();
  if (CFG.sec === 'general') renderLayoutMenuInto('cfgLayout');
}
function cfgDefense() {
  const p = defProfile();
  const row = (s) => `<tr><td><label><input type="checkbox" data-cstat="${s.k}"${p.on[s.k] ? ' checked' : ''}> ${esc(s.label)}</label></td><td class="dim small">${esc(s.tip || '')}</td></tr>`;
  return `<h3>Defense checkpoint stats <span class="dim small">for ${esc(C().name || 'this character')}</span></h3>
    <p class="dim">Pick what the Defense checkpoint panel shows and checks. Tier checks only use stats that are on. The screenshot reader (F10) fills life, ES, mana, armour, evasion, block, res, evade chance, spell suppression and physical damage reduction when they're on screen.</p>
    <div class="cfgcols"><div><h4>Built-in</h4><table class="cfgtab">${DEF_STATS.filter((s) => s.group === 'Built-in').map(row).join('')}</table></div>
    <div><h4>Optional</h4><table class="cfgtab">${DEF_STATS.filter((s) => s.group === 'Optional').map(row).join('')}</table></div></div>
    <h4>Pool colour</h4><div class="row"><label>Campaign: <input type="number" id="cfgPoolPerAct" min="50" step="50" value="${p.poolPerAct}" style="width:6em"> × act</label><label>Map start: <input type="number" data-cpool="poolMap" min="0" step="100" value="${p.poolMap}" style="width:6em"></label><label>T6+: <input type="number" data-cpool="poolT6" min="0" step="100" value="${p.poolT6}" style="width:6em"></label><span class="dim small">The pool box turns green above the target, amber within 75%, red below.</span></div>`;
}
function reqCell(t, s, on_) {
  const r = t.req || {}, dis = on_[s.k] ? '' : ' disabled title="Turn this stat on in Defense stats to check it"';
  if (s.req === 'bool' || s.k === 'mom') return `<label><input type="checkbox" data-treq="${t.id}|${s.k}|b"${r[s.k] ? ' checked' : ''}${dis}> ${esc(s.reqLabel || 'required')}</label>`;
  if (s.k === 'leech') return `≥ <input type="number" min="0" data-treq="${t.id}|leech|n" value="${r.leech ?? ''}" placeholder="—"${dis}> <label><input type="checkbox" data-treq="${t.id}|overleech|b"${r.overleech ? ' checked' : ''}${dis}> overleech</label>`;
  return `${esc(s.reqLabel || '≥')} <input type="number" data-treq="${t.id}|${s.k}|n" value="${r[s.k] ?? ''}" placeholder="—"${dis}>${s.unit ? ' ' + s.unit : ''}`;
}
function cfgTiers() {
  const p = defProfile(), on_ = p.on, ts = p.tiers;
  const stats = DEF_STATS.filter((s) => on_[s.k]);
  const others = [...S.history.filter((h) => h.defProfile).map((h, i) => [`h${i}`, `${h.name || 'unnamed'} (${h.build})`]), ...BUILDS.map((b, i) => [`b${i}`, `Defaults for ${b.name}`])];
  return `<h3>Tier checks <span class="dim small">for ${esc(C().name || 'this character')}</span></h3>
    <p class="dim">For each tier, what has to be true. Empty = not checked. Tiers count in order: you're cleared for a tier when it and every tier before it pass. <b>The defaults are a starting point</b>: the old built-in checks with the 3000 / 5000 pool rule, extended to T15, pinnacle and uber. Change them to fit your build.</p>
    <div class="row"><label>Copy from <select id="cfgCopyFrom"><option value="">choose…</option>${others.map(([v, n]) => `<option value="${v}">${esc(n)}</option>`).join('')}</select></label><button class="sm" id="btnCfgCopy" type="button">Copy</button><span class="sp"></span><button class="sm ghost" id="btnTierReset" type="button" title="Back to the defaults for ${esc(C().build)}">Reset to defaults</button></div>
    <div class="tierwrap"><table class="cfgtab tiertab"><tr><th>Stat</th>${ts.map((t) => { const r = gateCheck(t); return `<th>${esc(t.name)}<div class="dim small">${esc(t.band)}</div><div class="${r.pass ? 'ok' : 'bad'} small" data-tierstate="${t.id}">${r.pass ? '✔ met now' : 'not met'}</div></th>`; }).join('')}</tr>` +
    stats.map((s) => `<tr><td>${esc(s.label)}</td>${ts.map((t) => `<td>${reqCell(t, s, on_)}</td>`).join('')}</tr>`).join('') +
    `<tr><td>Fate cap</td>${ts.map((t) => `<td><input type="number" min="0" max="3" data-tfate="${t.id}" value="${t.fateCap}"></td>`).join('')}</tr></table></div>
    ${DEF_STATS.some((s) => !on_[s.k]) ? `<div class="dim small">Turned off (not checked): ${DEF_STATS.filter((s) => !on_[s.k]).map((s) => esc(s.label)).join(', ')}.</div>` : ''}`;
}
function cfgTriggers() {
  const ts = types();
  const row = (t) => `<tr class="${typeOn(t) ? '' : 'off'}" data-ctid="${esc(t.id)}">
    <td><input type="checkbox" data-tyon="${esc(t.id)}"${typeOn(t) ? ' checked' : ''} title="On / off"></td>
    <td><input data-tyname="${esc(t.id)}" value="${esc(t.name)}">${t.builtin ? ' <span class="bi" title="Built-in: can be turned off, not deleted">★</span>' : ''}</td>
    <td><select data-tykind="${esc(t.id)}"><option value="drop"${t.kind === 'drop' ? ' selected' : ''}>drop</option><option value="event"${t.kind === 'event' ? ' selected' : ''}>event</option></select></td>
    <td><input data-tyalias="${esc(t.id)}" value="${esc((t.aliases || []).join(', '))}" placeholder="spoken phrases, comma separated"></td>
    <td class="small">${typeEffects(t).map(esc).join('<br>')}</td>
    <td><label title="Show an alert when it's logged"><input type="checkbox" data-tyalert="${esc(t.id)}"${t.alert ? ' checked' : ''}> alert</label><input data-tysay="${esc(t.id)}" value="${esc(t.say || '')}" placeholder="also say…" title="Spoken after it's logged (optional)"></td>
    <td>${t.builtin ? '' : `<button class="sm ghost" data-tydel="${esc(t.id)}" title="Delete this type">×</button>`}</td></tr>`;
  return `<h3>Drop & event triggers <span class="dim small">${ts.length} types for ${esc(C().name || 'this character')}</span></h3>
    <p class="dim">Each type is something you say or type (“dropped a 5 link”, “near death”). It logs a drop or an event; some also fire an Open Trigger Action from the plan (P1 ones alert and are read out), change the tracker (a death marks the character dead) or count toward a rule. ★ built-ins can be turned off but not deleted.</p>
    <form id="cfgTypeAdd" class="row"><input id="cfgTyName" placeholder="new type, e.g. Mageblood" required><select id="cfgTyKind"><option value="drop">drop</option><option value="event">event</option></select><input id="cfgTyAlias" placeholder="spoken phrases, comma separated"><button class="sm pri" type="submit">Add type</button><span class="sp"></span><button class="sm ghost" type="button" id="btnCfgTypesReset" title="Replace this character's types with the defaults">Reset to defaults</button></form>
    <table class="cfgtab trigtab"><tr><th>On</th><th>Name</th><th>Kind</th><th>Spoken phrases</th><th>What it does</th><th>Extra</th><th></th></tr>${ts.map(row).join('')}</table>`;
}
function cfgRules() {
  const opts = (cur) => [['fx:near', 'Near-death'], ['fx:death', 'Death'], ...types().filter((t) => !['eNear', 'eDeath'].includes(t.id)).map((t) => ['type:' + t.id, t.name])].map(([v, n]) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(n)}</option>`).join('');
  const row = (r) => `<div class="rulebox${r.enabled ? '' : ' off'}" data-rid="${esc(r.id)}">
    <div class="row"><label><input type="checkbox" data-rf="enabled"${r.enabled ? ' checked' : ''}> <input data-rf="name" value="${esc(r.name)}" class="rname"></label>${r.builtin ? '<span class="bi" title="Built-in: can be turned off or reset, not deleted">★</span>' : ''}<span class="sp"></span>${r.builtin ? '<button class="sm ghost" data-rreset="1" type="button">Reset</button>' : '<button class="sm ghost" data-rdel="1" type="button" title="Delete rule">×</button>'}</div>
    <div class="row">When <input type="number" min="1" max="20" data-rf="count" value="${r.count}" style="width:4em"> × <select data-rf="match">${opts(r.match)}</select> within <input type="number" min="0" max="1440" data-rf="windowMin" value="${r.windowMin}" style="width:5em"> min <span class="dim small">(0 = this session: since the timer started or last resumed)</span> · repeats within <input type="number" min="0" max="3600" data-rf="mergeSec" value="${r.mergeSec}" style="width:5em"> s count as one</div>
    <div class="grid2"><label>Title</label><input data-rf="title" value="${esc(r.title)}"><label>Spoken / card note</label><input data-rf="note" value="${esc(r.note)}"><label>Next Up detail</label><input data-rf="detail" value="${esc(r.detail)}"></div>
    <div class="row">Then: <label><input type="checkbox" data-rf="say"${r.say ? ' checked' : ''}> say it</label><label><input type="checkbox" data-rf="alert"${r.alert ? ' checked' : ''}> alert</label><label><input type="checkbox" data-rf="nextUp"${r.nextUp ? ' checked' : ''}> Next Up task</label><span class="dim small">now: ${ruleCount(r)} / ${r.count}${r.enabled && ruleCount(r) >= r.count ? ' · <span class="bad">FIRING</span>' : ''} · {n} = count, {window} = the window</span></div></div>`;
  return `<h3>Rules</h3><p class="dim">Rules watch how often something happens. The built-in one is the S03 safety rule: 2 near-deaths within 30 minutes (repeats within 90 s are one incident) put “Stop for the night” at the top of Next Up and say “END THE SESSION”.</p>
    ${rules().map(row).join('')}<div class="row"><button class="sm pri" id="btnRuleAdd" type="button">Add rule</button></div>`;
}
function cfgGeneral() {
  const p = paceCfg();
  return `<h3>General</h3>
    <h4>Campaign pace target</h4><div class="row">${Object.entries(PACE_PRESETS).map(([k, x]) => `<button type="button" class="sm${p.preset === k ? ' on' : ''}" data-cfgpace="${k}" title="${esc(x.title)}">${esc(x.name)} <span class="dim">${esc(x.hint)}</span></button>`).join('')}${p.preset === 'custom' ? `<label>Total to Kitava (min) <input type="number" id="cfgPaceTotal" min="30" max="1440" value="${paceTotal()}" style="width:6em"></label>` : ''}<span class="dim small">Per-act minutes: in the Campaign pace panel.</span></div>
    <h4>Text size</h4><div class="row"><span class="seg">${TEXT_STEPS.map((v) => `<button type="button" class="sm${S.ui.textPct === v ? ' on' : ''}" data-cfgtext="${v}">${v}%</button>`).join('')}</span></div>
    <h4>Panels</h4><div id="cfgLayout"></div><div class="row"><button class="sm" type="button" id="btnCfgLayoutReset">Reset layout</button></div>
    <h4>Content types and colours <span class="dim small">(Power Chase)</span></h4><div class="ctlist">${contentTypes().map((k, i) => `<span class="ctedit" style="--cc:${ctColor(k)}"><input type="color" value="${ctColor(k)}" data-cfgctcolor="${i}" title="Colour for ${esc(k)}">${ctChip(k)}<button class="sm ghost" data-cfgctdel="${i}" title="Remove ${esc(k)}">×</button></span>`).join('')}</div>
    <form class="row" id="cfgCtAdd"><input id="cfgCtNew" placeholder="new content type"><button class="sm" type="submit">Add</button></form>
    <h4>Companion and wiki</h4><div class="row"><span>${VOICE.served ? '<span class="ok">Connected</span> (voice, F10 screenshots, research, wiki lookups)' : '<span class="warn">Not connected</span>: open the tracker through the companion (run.bat) for voice, screenshots and wiki lookups'}</span></div>
    <div class="row"><label><input type="checkbox" id="cfgChaseWiki"${S.cfg.chaseWiki !== false ? ' checked' : ''}> Link Power Chase items to their wiki page</label><span class="dim small">${Object.keys(wikiCache()).length} looked up · ${chaseLinkPending().length} waiting</span><button class="sm" type="button" id="btnCfgWikiRetry">Look up now</button><button class="sm ghost" type="button" id="btnCfgWikiClear" title="Forget the cached lookups and check every item again">Re-check all</button></div>`;
}
function renderLayoutMenuInto(id) {
  const L = layout(), el = $(id); if (!el) return;
  el.innerHTML = PANELS.map((p) => `<label class="cfgpanel"><input type="checkbox" data-cfgshow="${p.id}"${L.hidden.includes(p.id) ? '' : ' checked'}> ${esc(p.name)}</label>`).join('');
}
function cfgSaved(msg, custom) { if (custom) defProfile().custom = true; save(); const s = $('cfgSaved'); if (s) { s.textContent = msg || 'Saved'; s.classList.remove('flash'); void s.offsetWidth; s.classList.add('flash'); } }
function bindConfig() {
  on('btnConfigure', 'click', () => openConfig());
  on('btnCfgClose', 'click', closeConfig);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && CFG.open) closeConfig(); });
  on('cfgNav', 'click', (e) => { const b = e.target.closest('[data-cfgsec]'); if (b) { CFG.sec = b.dataset.cfgsec; renderConfig(); } });
  const page = $('cfgPage');
  page.addEventListener('change', (e) => {
    const t = e.target, d = t.dataset, p = defProfile();
    if (d.cstat) { p.on[d.cstat] = t.checked; cfgSaved(`${DSTAT[d.cstat].label} ${t.checked ? 'on' : 'off'}`, 1); renderDefense(); renderConfig(); return; }
    if (d.cpool) { const v = num(t.value); if (v > 0) { p[d.cpool] = v; cfgSaved('', 1); renderDefense(); } return; }
    if (t.id === 'cfgPoolPerAct') { const v = num(t.value); if (v > 0) { p.poolPerAct = v; cfgSaved('', 1); renderDefense(); } return; }
    if (d.treq) {
      const [tid, k, kind] = d.treq.split('|'), tier = p.tiers.find((x) => x.id === tid); if (!tier) return;
      if (kind === 'b') tier.req[k] = t.checked; else { const v = num(t.value); if (v == null) delete tier.req[k]; else tier.req[k] = v; }
      cfgSaved(`${tier.name} updated`, 1); renderDefense(); renderNext(); renderHeader();
      for (const x of p.tiers) { const el = page.querySelector(`[data-tierstate="${x.id}"]`); if (el) { const r = gateCheck(x); el.className = (r.pass ? 'ok' : 'bad') + ' small'; el.textContent = r.pass ? '✔ met now' : 'not met'; } }
      return;
    }
    if (d.tfate) { const tier = p.tiers.find((x) => x.id === d.tfate); if (tier) { tier.fateCap = Math.max(0, Math.min(3, num(t.value) || 0)); cfgSaved('', 1); } return; }
    const ty = (id) => types().find((x) => x.id === id);
    if (d.tyon) { const x = ty(d.tyon); if (x) { x.enabled = t.checked; typesChanged(); cfgSaved(`${x.name} ${t.checked ? 'on' : 'off'}`); renderConfig(); } return; }
    if (d.tyname) { const x = ty(d.tyname), v = t.value.trim(); if (x && v) { x.name = v; typesChanged(); cfgSaved(); } return; }
    if (d.tykind) { const x = ty(d.tykind); if (x) { x.kind = t.value; typesChanged(); cfgSaved(); renderConfig(); } return; }
    if (d.tyalias) { const x = ty(d.tyalias); if (x) { x.aliases = t.value.split(',').map((s) => s.trim()).filter(Boolean); typesChanged(); cfgSaved(); renderConfig(); } return; }
    if (d.tyalert) { const x = ty(d.tyalert); if (x) { x.alert = t.checked; typesChanged(); cfgSaved(); renderConfig(); } return; }
    if (d.tysay) { const x = ty(d.tysay); if (x) { x.say = t.value.trim(); typesChanged(); cfgSaved(); renderConfig(); } return; }
    if (d.rf) {
      const box = t.closest('[data-rid]'), r = rules().find((x) => x.id === box.dataset.rid); if (!r) return;
      const k = d.rf;
      if (t.type === 'checkbox') r[k] = t.checked;
      else if (['count', 'windowMin', 'mergeSec'].includes(k)) r[k] = Math.max(k === 'count' ? 1 : 0, num(t.value) || 0);
      else r[k] = t.value;
      cfgSaved(`Rule “${r.name}” saved`); renderNext(); renderConfig(); return;
    }
    if (t.id === 'cfgPaceTotal') { setPaceCfg({ total: num(t.value) }); cfgSaved('Pace target saved'); return; }
    if (d.cfgshow) { setHidden(d.cfgshow, !t.checked); renderLayoutMenu(); cfgSaved(); return; }
    if (d.cfgctcolor != null) { S.ctColors[contentTypes()[+d.cfgctcolor]] = t.value; cfgSaved(); renderChase(); renderConfig(); return; }
    if (t.id === 'cfgChaseWiki') { S.cfg.chaseWiki = t.checked; cfgSaved(); if (t.checked) chaseLinkSweep(); return; }
  });
  page.addEventListener('click', (e) => {
    const t = e.target.closest('button'); if (!t) return;
    const d = t.dataset, p = defProfile();
    if (t.id === 'btnTierReset') { if (!confirm('Reset the tier checks for this character to the defaults?')) return; p.tiers = defaultTiers(C().build); p.on = { ...DEF_ON_DEFAULT }; p.poolPerAct = 300; p.custom = false; p.build = C().build; cfgSaved('Reset to defaults'); renderAll(); renderConfig(); }
    else if (t.id === 'btnCfgCopy') {
      const v = $('cfgCopyFrom').value; if (!v) return;
      const src = v[0] === 'h' ? S.history.filter((h) => h.defProfile)[+v.slice(1)].defProfile : defaultProfile(BUILDS[+v.slice(1)].name);
      const cp = JSON.parse(JSON.stringify(src)); C().defProfile = { ...cp, build: C().build, custom: true }; cfgSaved('Copied'); renderAll(); renderConfig();
    }
    else if (t.id === 'btnCfgTypesReset') { if (!confirm("Replace this character's drop & event types with the defaults?")) return; C().types = defaultTypes(); typesChanged(); cfgSaved(); renderConfig(); }
    else if (d.tydel) { const x = types().find((y) => y.id === d.tydel); if (!x || x.builtin) return; C().types = types().filter((y) => y !== x); typesChanged(); cfgSaved(`Deleted ${x.name}`); renderConfig(); }
    else if (t.id === 'btnRuleAdd') { rules().push({ id: 'r' + uid(), builtin: false, enabled: true, name: 'New rule', match: 'fx:death', count: 2, windowMin: 0, mergeSec: 60, title: 'Take a break', note: '{n} in {window}: take a break.', detail: '{count} within {window}.', first: '', alert: true, say: true, nextUp: true }); cfgSaved(); renderConfig(); }
    else if (d.rdel || d.rreset) {
      const box = t.closest('[data-rid]'), i = rules().findIndex((x) => x.id === box.dataset.rid); if (i < 0) return;
      if (d.rdel) rules().splice(i, 1); else rules()[i] = JSON.parse(JSON.stringify(RULE_DEFAULTS.find((x) => x.id === rules()[i].id)));
      cfgSaved(); renderNext(); renderConfig();
    }
    else if (d.cfgpace) { setPaceCfg({ preset: d.cfgpace }); cfgSaved('Pace target saved'); renderConfig(); }
    else if (d.cfgtext) { setTextSize({ pct: +d.cfgtext }); renderLinks(); cfgSaved(); renderConfig(); }
    else if (t.id === 'btnCfgLayoutReset') { resetLayout(); renderLayoutMenu(); renderConfig(); }
    else if (d.cfgctdel != null) { const k = contentTypes()[+d.cfgctdel]; if (chase().some((x) => hasType(x, k)) && !confirm(`Items still use “${k}”. Remove it anyway?`)) return; contentTypes().splice(+d.cfgctdel, 1); cfgSaved(); renderChase(); renderConfig(); }
    else if (t.id === 'btnCfgWikiRetry') { CL.retryAt = 0; chaseLinkSweep(); setTimeout(renderConfig, 400); }
    else if (t.id === 'btnCfgWikiClear') { S.wikiCache = {}; for (const x of chase()) if (!x.wikiManual) { x.wikiChecked = false; x.wiki = null; } CL.retryAt = 0; cfgSaved(); chaseLinkSweep(); renderChase(); renderConfig(); }
  });
  page.addEventListener('submit', (e) => {
    e.preventDefault();
    if (e.target.id === 'cfgTypeAdd') {
      const n = $('cfgTyName').value.trim(); if (!n) return;
      if (types().some((t) => ckey(t.name) === ckey(n))) { toast(esc(n) + ' already exists', 2); return; }
      addType(n, $('cfgTyKind').value, $('cfgTyAlias').value.split(',')); typesChanged(); cfgSaved(`Added ${n}`); renderConfig();
    } else if (e.target.id === 'cfgCtAdd') {
      const v = $('cfgCtNew').value.trim(); if (v && !contentTypes().includes(v)) { const oi = contentTypes().indexOf('Other'); contentTypes().splice(oi < 0 ? contentTypes().length : oi, 0, v); cfgSaved(); renderChase(); renderConfig(); }
    }
  });
  if (location.hash === '#configure') openConfig();
  window.addEventListener('hashchange', () => { if (location.hash === '#configure') { if (!CFG.open) openConfig(); } else if (CFG.open) closeConfig(); });
}
