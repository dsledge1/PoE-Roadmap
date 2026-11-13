/* ---------- Helpers ---------- */
const $ = (id) => document.getElementById(id);
const now = () => Date.now();
const MIN = 60000;
const STORE_KEY = 'poe330_hcssf_tracker_v1';
const LAUNCH_TS = Date.UTC(2026, 10, 13, 19, 0, 0); // Fri Nov 13 2026, 2:00 PM ET (UTC-5)
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (s) => ' ' + String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
const uid = () => Math.random().toString(36).slice(2, 9);
const num = (v) => (v === '' || v == null || isNaN(+v) ? null : +v);
function fmtDur(ms) {
  const neg = ms < 0; ms = Math.abs(ms);
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  const out = h ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${m}:${String(ss).padStart(2, '0')}`;
  return (neg ? '−' : '') + out;
}
const fmtClock = (ts) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const fmtDay = (ts) => new Date(ts).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
function fmtDelta(min) {
  const m = Math.round(min);
  if (m === 0) return '<span class="ok">on pace</span>';
  return m < 0 ? `<span class="ok">${-m} min ahead</span>` : `<span class="bad">${m} min behind</span>`;
}
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

/* ---------- State ---------- */
function freshChar() {
  return {
    name: '', build: 'Spectre Necromancer', level: 1, band: 0, alive: true, created: now(),
    campaign: { start: null, done: {}, pauses: [] },
    def: { ele: false, over: false, fire: null, cold: null, lightning: null, chaos: null, uncapped: null, resPen: null, resStale: false, pool: null, poolManual: false, life: null, es: null, ablock: null, block: null, mana: null, armour: null, evasion: null, updated: null },
    kills: [],
  };
}
function freshState() {
  return { v: 1, pace: 't7', budget: 30, char: freshChar(), history: [], log: [], fates: { campaignOk: false, seen: [] }, chunks: {}, triggers: null, voice: { log: [], applied: [] } };
}
let S = load();
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) { window.__poeStored = true; return Object.assign(freshState(), JSON.parse(raw)); }
  } catch (e) { console.warn('load failed', e); }
  return freshState();
}
let saveTimer = null;
function save() { // debounced so typing never blocks
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 150);
}
function saveNow() { // voice commands save before answering, so a reload/replay can never apply one twice or lose it
  clearTimeout(saveTimer); saveTimer = null;
  try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) { toast('Could not save to localStorage: ' + e.message, 1); }
}
window.addEventListener('pagehide', () => { if (saveTimer) saveNow(); });
const C = () => S.char;

/* ---------- Triggers ---------- */
const trigDoc = () => S.triggers || DEFAULT_TRIGGERS;
let trigById = {};
function indexTriggers() {
  trigById = {};
  for (const t of trigDoc().triggers) trigById[t.id] = t;
}
function aliasesFor(t) {
  const base = String(t.item).replace(/\(.*?\)/g, '').split('/').map((s) => s.trim()).filter((s) => s.length > 3);
  return [...new Set([...(ALIASES[t.id] || []), ...base].map((a) => norm(a)))];
}

/* Map free text (drop or event) to trigger ids + side effects. */
function matchText(text) {
  const n = norm(text);
  const ev = EVENTS.find((e) => n.startsWith(norm(e.label).trimEnd()) || norm(e.label) === n);
  const ids = new Set(ev ? ev.ids : []);
  let fx = ev ? ev.fx : null;
  // Staff pDPS: "staff 812 pdps" -> D06 if >= 750
  let pdps = null;
  const m = n.match(/ (\d{3,4}) ?p?dps /) || n.match(/ pdps (\d{3,4}) /);
  if (m) pdps = +m[1];
  if (/ staff /.test(n) && (n.includes(' 750 ') ? true : pdps != null)) { if (pdps == null || pdps >= 750) ids.add('D06'); }
  if (!ev) {
    for (const t of trigDoc().triggers) {
      if (t.active === false) continue;
      if (!['drop', 'event'].includes(t.type) && !ALIASES[t.id]) continue;
      if (t.id === 'D06') continue;
      if (aliasesFor(t).some((a) => n.includes(a))) ids.add(t.id);
    }
    if (ids.has('E01')) ids.delete('E02'); // "near death" is not a death
    if (ids.has('E02')) fx = 'death';
    if (ids.has('E01')) fx = 'near';
    const band = n.match(/ (?:reached|in|entered) t ?(\d{1,2}) /);
    if (band) { fx = 'band' + band[1]; const t = +band[1]; ids.add(t >= 15 ? 'G04' : t >= 11 ? 'G03' : t >= 6 ? 'G02' : 'G01'); }
  }
  return { ids: [...ids].filter((id) => trigById[id]), fx, pdps };
}

/* Near-deaths within 30 min, counted as incidents: entries within 90 s of each other (voice + button, a repeated
   sentence, a replayed command) are one incident. Two separate incidents end the session (S03). */
const SAME_INCIDENT_MS = 90 * 1000;
function nearDeaths30() {
  const ts = S.log.filter((l) => l.fx === 'near' && now() - l.ts < 30 * MIN && l.char === C().created).map((l) => l.ts).sort((a, b) => a - b);
  let n = 0, last = -Infinity;
  for (const t of ts) { if (t - last > SAME_INCIDENT_MS) n++; last = t; }
  return n;
}
function stashHas(id) { return S.log.some((l) => l.kind === 'drop' && l.ids.includes(id)); }

/* Evaluate a trigger's condition against tracker state where we can; null = check it yourself. */
function evalCond(t, entry) {
  const c = C(), cl = clearedIdx();
  switch (t.id) {
    case 'D01': return { met: true, note: c.build === 'ED Occultist' ? 'You are on ED Occultist: equip at the self-cast swap.' : `You are on ${c.build}: stash it as the 1B trigger. Roll ED/Contagion/Blight Occultist if the Necro is struggling or as char #2.` };
    case 'D03': return (cl >= 1 || !c.alive) ? { met: true, note: !c.alive ? 'Main is dead: roll PRAW now.' : 'Main passes the T6 gate: roll PRAW as char #2.' } : { met: false, note: 'Main not at the T6 gate yet: stash it, roll when the main passes T6 or dies.' };
    case 'D06': return entry && entry.pdps != null ? { met: entry.pdps >= 750, note: `${entry.pdps} pDPS. Also check APS / crit for Static Strike.` } : { met: null };
    case 'D08': return { met: c.build === 'ED Occultist', note: c.build === 'ED Occultist' ? 'Equip it.' : 'Not on ED: stash it for the 1B Occultist.' };
    case 'N01': { const n = S.log.filter((l) => l.char === c.created && l.ids.includes('N01')).length; return { met: true, note: n >= 3 ? `${n} Frostbearer captures logged: swap to the Frostbearer 6L if Raise Spectre is eff. 22+.` : `${n} logged. Under 3: mixed setup, stay on the Absolution bridge.` }; }
    case 'N04': case 'N06': case 'N07': case 'N08': case 'N09': return { met: c.build === 'Spectre Necromancer', note: c.build === 'Spectre Necromancer' ? 'On the Necro: equip / plan it in.' : 'Not on the Necro: stash it in the Necro reroll tab.' };
    case 'N11': return { met: c.build === 'Spectre Necromancer' && cl >= 2 && !S.log.some((l) => l.char === c.created && l.ids.includes('N01')) };
    case 'E01': { const n = nearDeaths30(); return { met: true, note: n >= 2 ? `${n} near-deaths in 30 min: END THE SESSION (S03).` : 'First in 30 min: drop one tier band, do a gear audit.' }; }
    case 'E02': { const hard = S.log.filter((l) => l.kind === 'drop' && l.ids.some((id) => trigById[id]?.hard)).map((l) => l.text); return { met: true, note: hard.length ? 'Hard-trigger items logged: ' + [...new Set(hard)].join(', ') : 'No hard-trigger items logged: re-roll Spectre Necro (re-capture spectres). Nothing working: Boneshatter fallback (H05).' }; }
    case 'S04': return { met: c.level >= 68, note: `Char level ${c.level}.` };
    case 'G01': case 'G02': case 'G03': case 'G04': { const i = +t.id.slice(2) - 1; return { met: cl >= i, note: cl >= i ? 'Defense panel says you meet this gate.' : 'Defense panel says you do NOT meet this gate yet. Fix gear first.' }; }
    case 'H01': return { met: !['D01', 'D03', 'D05'].some(stashHas) };
    case 'T03': return { met: cl < 3, note: cl < 3 ? 'Below the T15 gate: no Ultimatum.' : 'T15 gate met; still only if you feel overpowered.' };
    default: return { met: null };
  }
}

/* ---------- Logging ---------- */
function addLog(text, kindHint, opts = {}) {
  text = text.trim();
  if (!text) return;
  const m = matchText(text);
  const kind = m.fx ? 'event' : m.ids.some((id) => trigById[id].type === 'drop') ? 'drop' : m.ids.length ? 'event' : (kindHint === 'drop' || kindHint === 'event' ? kindHint : 'note');
  const entry = { id: uid(), ts: now(), text, kind, ids: m.ids, fx: m.fx, pdps: m.pdps, acked: [], char: C().created };
  if (opts.type) entry.type = opts.type;          // v4: which drop / event type it was logged as
  if (opts.detail) entry.detail = opts.detail;
  if (m.fx === 'near' && S.log.some((l) => l.fx === 'near' && l.char === C().created && entry.ts - l.ts < SAME_INCIDENT_MS)) entry.sameIncident = true;
  S.log.unshift(entry);
  applyFx(entry);
  entry.evals = Object.fromEntries(m.ids.map((id) => [id, evalCond(trigById[id], entry)]));
  if (m.ids.includes('F05')) { const txt = text.replace(/^new fate seen:?/i, '').trim(); if (txt) S.fates.seen.push({ text: txt, verdict: 'unknown', ts: now() }); }
  save();
  renderAll();
  showResult(entry);
  return entry;
}
/* typed into the manual-add box: a custom type wins when one is named ("5 link" -> 5-link), else as before */
function manualLog(text) {
  const t = matchType(text);
  if (t && !(t.builtin && matchText(text).ids.length)) return addLog(typeLogText(t, text), t.kind, { type: t.id, detail: text.trim() });
  return addLog(text);
}
function applyFx(e) {
  const c = C();
  if (!e.fx) return;
  if (e.fx === 'death') c.alive = false;
  if (e.fx === 'lvl68') c.level = Math.max(c.level, 68);
  if (e.fx.startsWith('band')) c.band = Math.max(c.band, +e.fx.slice(4));
}
function ackTrigger(entryId, trigId) {
  const e = S.log.find((l) => l.id === entryId);
  if (e && !e.acked.includes(trigId)) e.acked.push(trigId);
  save(); renderAll();
}
function triggerCard(t, entry, opts = {}) {
  const ev = entry?.evals?.[t.id] || evalCond(t, entry);
  const metBadge = ev.met === true ? '<span class="badge met">condition met</span>' : ev.met === false ? '<span class="badge unmet">condition not met</span>' : '<span class="badge">check condition</span>';
  const acked = entry && entry.acked.includes(t.id);
  return `<div class="card p${t.priority}${acked ? ' acked' : ''}">
    <span class="badge p${t.priority}">P${t.priority}</span>${t.hard ? '<span class="badge hard">HARD</span>' : ''}${metBadge}<span class="badge">${esc(t.id)}</span><span class="badge">${esc(t.confidence || '')}</span>
    <div class="act">${esc(t.item)} → ${esc(t.action)}</div>
    ${ev.note ? `<div>${esc(ev.note)}</div>` : ''}
    <div class="dim">If: ${esc(t.condition)}</div>
    ${entry && !acked && !opts.noAck ? `<button class="sm" data-ack="${entry.id}|${t.id}">Done / dismiss</button>` : ''}
  </div>`;
}
function showResult(entry) {
  const el = $('logResult');
  if (!entry.ids.length) { el.innerHTML = `<div class="box dim">Logged “${esc(entry.text)}”. No trigger matched.</div>`; return; }
  const sorted = entry.ids.map((id) => trigById[id]).sort((a, b) => a.priority - b.priority);
  el.innerHTML = sorted.map((t) => triggerCard(t, entry)).join('');
  el.firstElementChild?.classList.add('flash');
  if (sorted[0].priority === 1) toast(`<b>${esc(sorted[0].item)}</b>: ${esc(sorted[0].action)}`, 1);
}
let toastTimer;
function toast(html, p = 3) {
  $('toast').innerHTML = `<div class="card p${p}">${html}</div>`;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => ($('toast').innerHTML = ''), 6000);
}

/* ---------- Pause ---------- */
const pauses = () => (C().campaign.pauses = C().campaign.pauses || []);
function pausedMs(t = now()) { let s = 0; for (const p of pauses()) { const b = Math.min(p.to ?? t, t); if (b > p.from) s += b - p.from; } return s; }
function isPaused() { const ps = pauses(); return ps.length > 0 && ps[ps.length - 1].to == null; }
function activeMs(t = now()) { return t - C().campaign.start - pausedMs(t); }
/* wall-clock time for a pace target in active minutes (pauses so far push targets back) */
function wallAt(activeMin) { return C().campaign.start + activeMin * MIN + pausedMs(now()); }
function pauseTimer() {
  if (!C().campaign.start) return { say: 'League timer is not running.', level: 'unknown' };
  if (isPaused()) return { say: `Already paused since ${fmtClock(pauses().at(-1).from)}.`, level: 'unknown' };
  pauses().push({ from: now(), to: null }); save(); renderAll();
  return { say: `Timer paused at ${fmtClock(now())}. Say resume when you're back.`, op: { k: 'pause' } };
}
function resumeTimer() {
  if (!isPaused()) return { say: C().campaign.start ? 'Timer is already running.' : 'League timer is not running.', level: 'unknown' };
  const p = pauses().at(-1); p.to = now(); save(); renderAll();
  return { say: `Resumed. ${Math.max(1, Math.round((p.to - p.from) / MIN))} minutes paused, not counted.`, op: { k: 'resume', from: p.from } };
}

/* ---------- Pace ---------- */
function doneCount() { const d = C().campaign.done; let i = 0; while (i < MILESTONES.length && d[MILESTONES[i].id]) i++; return i; }
function paceInfo(t = now()) {
  const camp = C().campaign;
  if (!camp.start) return null;
  const k = doneCount();
  const last = k ? MILESTONES[k - 1] : null;
  const lastTs = last ? camp.done[last.id] : camp.start;
  const lastCum = last ? activeMs(lastTs) / MIN : 0;
  const elapsed = activeMs(t) / MIN;
  const next = MILESTONES[k] || null;
  const deltas = {};
  for (const p of ['t6', 't7', 't8']) {
    const lastTarget = last ? last[p] : 0;
    let d = lastCum - lastTarget;
    if (next && elapsed > next[p]) d = Math.max(d, elapsed - next[p]); // already late for the next one
    deltas[p] = d;
  }
  const seg = next ? { pure: next.split, target: next[S.pace] - (last ? last[S.pace] : 0), elapsed: activeMs(t) - (last ? activeMs(lastTs) : 0) } : null;
  let projKitava = camp.done.M13 || null;
  if (!projKitava && next) {
    const nextDoneCum = Math.max(lastCum + seg.target, elapsed); // can't finish the current segment in the past
    projKitava = wallAt(nextDoneCum + MILESTONES[KITAVA_IDX][S.pace] - next[S.pace]);
  }
  return { k, last, next, elapsed, deltas, seg, projKitava, lastTs, paused: isPaused() };
}
function nextStop(k) { for (let i = k; i < MILESTONES.length; i++) if (MILESTONES[i].stop) return { ms: MILESTONES[i], stop: STOPS[MILESTONES[i].stop] }; return null; }
/* Mark milestones up to and including index idx (skipped ones get the same timestamp). Returns what changed. */
function completeMilestones(idx) {
  const k = doneCount();
  if (idx < k || idx >= MILESTONES.length) return null;
  let resumed = null;
  if (isPaused()) { const p = pauses().at(-1); p.to = now(); resumed = p.from; } // marking a milestone means you're playing
  const penBefore = kitavaPen(), defSnap = JSON.parse(JSON.stringify(C().def));
  const t = now(), ids = [];
  for (let i = k; i <= idx; i++) { C().campaign.done[MILESTONES[i].id] = t; ids.push(MILESTONES[i].id); }
  const penAfter = kitavaPen();
  let kit = null;
  if (penAfter > penBefore) {
    const d = C().def, had = d.resPen != null && d.resPen < penAfter;
    if (had) d.resStale = true;
    kit = { pen: penAfter, had, warn: `Kitava penalty: ${penAfter === 60 ? 'res dropped another 30, minus 60 total' : 'res dropped 30'}.${had ? ' Your logged res is from before. Tell me your new res.' : ' Tell me your res when you can.'}` };
  }
  const ms = MILESTONES[idx];
  if (ms.id === 'M15') C().band = Math.max(C().band, 1);
  const p = paceInfo();
  const logId = uid();
  S.log.unshift({ id: logId, ts: t, text: `${ms.label} · ${PACE_NAMES[S.pace]}: ${stripTags(fmtDelta(p.deltas[S.pace]))}`, kind: 'milestone', ids: [], acked: [], char: C().created });
  save(); renderAll();
  return { ids, ms, delta: p.deltas[S.pace], logId, stop: ms.stop ? STOPS[ms.stop] : null, kit, defSnap, resumed };
}
function markMilestone() {
  const r = completeMilestones(doneCount()); if (!r) return;
  toast(`<b>${esc(r.ms.label)}</b> ${fmtDelta(r.delta)}${r.stop ? `<br>Now: ${esc(r.stop.title)} (≤ ${STOP_BUDGET[S.pace]} min)` : ''}${r.kit ? `<br><span class="warn">${esc(r.kit.warn)}</span>` : ''}`, r.kit ? 1 : 2);
}
const stripTags = (h) => h.replace(/<[^>]+>/g, '');
function undoMilestone() {
  const k = doneCount(); if (!k) return;
  delete C().campaign.done[MILESTONES[k - 1].id];
  if (C().def.resStale && C().def.resPen != null && C().def.resPen >= kitavaPen()) C().def.resStale = false;
  save(); renderAll();
}

/* ---------- Defense gates ---------- */
/* Kitava: A5 takes 30% from all elemental res, A10 another 30 (−60 total). Dictated / scanned res are the in-game
   numbers, so they already include it; we only track whether they were taken before the latest Kitava. */
function kitavaPen() { const d = C().campaign.done; return d.M13 ? 60 : d.M6 ? 30 : 0; }
const ELE = ['fire', 'cold', 'lightning'];
function resKnown(d = C().def) { return ELE.every((k) => d[k] != null); }
function uncappedList(d = C().def) { return ELE.filter((k) => d[k] != null && d[k] < 75); }
/* The bar comes from the build plan (Necro = minion bar). Other builds keep their own. */
function barMode() {
  const c = C();
  if (c.build === 'Spectre Necromancer' && typeof BUILD_PLAN !== 'undefined') return BUILD_PLAN.bar;
  return (BUILDS.find((b) => b.name === c.build) || BUILDS[0]).bar;
}
function gateCheck(g) {
  const d = C().def, bar = barMode(), fails = [];
  const needBlock = g.block && (BUILDS.find((b) => b.name === C().build) || {}).spellBlock;
  if (d.resStale) fails.push('res from before Kitava: re-enter');
  else if (!d.ele) fails.push(resKnown(d) && uncappedList(d).length ? 'uncapped: ' + uncappedList(d).join(', ') : 'ele res not capped');
  if (g.overcap && !d.over) fails.push('no ~10% overcap');
  if (d.chaos == null || d.chaos < g.chaos) fails.push(`chaos ${d.chaos ?? '?'} < ${g.chaos}`);
  const pool = typeof g.pool === 'object' ? g.pool[bar] : g.pool;
  if (d.pool == null || d.pool < pool) fails.push(`pool ${d.pool ?? '?'} < ${pool}`);
  // v3: phys max hit and PoB EHP are no longer gates (playtest: not useful as typed numbers).
  // TODO(EHP): compute an EHP the way PoB does (pool, armour/evasion, block, res, per-type max hit) and gate on that.
  const ehp = 0;
  if (needBlock && (d.block == null || d.block < g.block)) fails.push(`spell block ${d.block ?? '?'} < ${g.block}%`);
  return { pass: !fails.length, fails, ehpReq: ehp };
}
function clearedIdx() { let i = -1; for (const g of GATES) { if (gateCheck(g).pass) i++; else break; } return i; }
function maxTierCleared() { const i = clearedIdx(); return i < 0 ? 0 : i === 0 ? 5 : i === 1 ? 10 : i === 2 ? 14 : 16; }

/* ---------- Fates ---------- */
function fateCalc(boss, content, tier, flags) {
  const why = [];
  const kills = C().kills.filter((k) => norm(k.boss) === norm(boss) && boss.trim());
  const killed = kills.length > 0, bestFates = kills.reduce((m, k) => Math.max(m, k.fates), -1);
  const cl = clearedIdx();
  let cap = 0, dup = false;
  if (content === 'campaign') {
    if (S.fates.campaignOk && !flags.isNew && (flags.seen || killed)) { cap = 1; why.push('Launch-intel toggle on: 1 Fate on a known campaign boss. Portal out if it goes bad.'); }
    else { why.push('Campaign: 0 Fates (F01).'); if (S.fates.campaignOk) why.push('Toggle is on, but this boss is new/unknown or you have not seen it.'); }
    return { cap, why, dup };
  }
  if (content === 'pinnacle') {
    const need = 5000, pool = C().def.pool || 0;   // TODO(EHP): use a PoB-style EHP here instead of the pool
    const ok = killed && pool >= need && cl >= 2;
    why.push(ok ? `Grim Fate OK: plain version killed on this char and pool ${pool} ≥ ${need}.` : `Grim Fate NO (F03): needs a plain kill on this char${killed ? ' ✓' : ' ✗'} and pool ≥ ${need} (${pool || '?'}).`);
    if (flags.isNew) why.push('Unknown pinnacle: 0 Fates and a portal-ready first attempt.');
    cap = ok && !flags.isNew ? 3 : 0; dup = ok && cl >= 2;
    return { cap, why, dup, grim: ok && !flags.isNew };
  }
  const t = Math.max(1, Math.min(17, tier || 1));
  const gi = t >= 11 ? 2 : t >= 6 ? 1 : 0;
  if (cl < gi) { why.push(`Not cleared for T${t}: you meet ${cl < 0 ? 'no gate' : GATES[cl].name} only. 0 Fates, fix gear first.`); return { cap: 0, why, dup }; }
  cap = GATES[gi].fateCap; why.push(`T${t} band cap: ${cap}.`);
  if (flags.isNew) { why.push('New 3.30 / unknown boss: 0 Fates (F02).'); return { cap: 0, why, dup }; }
  if (flags.deified && t < 11) { why.push('Deified area below T11: never combine with Fates (F04).'); return { cap: 0, why, dup }; }
  if (!killed) {
    if (t <= 5 && !flags.seen) { why.push('T1–5 needs a boss you have seen before.'); return { cap: 0, why, dup }; }
    cap = Math.min(cap, 1); why.push('Not killed on this char yet: max 1 (F02).');
  } else if (t >= 11 && bestFates < 1) { cap = Math.min(cap, 2); why.push('3 Fates need a prior kill at 1–2 Fates on this char.'); }
  if (flags.scary && t < 11) { cap = Math.min(cap, 1); why.push('Scary Fate type below T11: max 1.'); }
  if (flags.scary && t >= 11) why.push('Skip any Fate that adds a damage type you are weak to (phys max hit).');
  const deadly = S.fates.seen.filter((f) => f.verdict === 'deadly');
  if (deadly.length) why.push('Blacklisted: ' + deadly.map((f) => f.text).join('; '));
  dup = t >= 11 && cl >= 2;
  return { cap, why, dup };
}

/* ---------- Next up ---------- */
function buildTasks(budget) {
  const c = C(), tasks = [], p = paceInfo(), t = now();
  const add = (prio, mins, title, detail = '', chunk = null) => tasks.push({ prio, mins, title, detail, chunk });
  const hour = new Date(t).getHours();
  if (!c.alive) add(0, 0, 'Character died: reroll', evalCond(trigById.E02 || { id: 'E02' }).note + ' Use “New character” below when ready.');
  if (nearDeaths30() >= 2) add(0, 0, 'Stop for the night (S03)', '2 near-deaths within 30 min. Stash insurance items, log stats, log off.');
  else if (p && hour < 5 && t - c.campaign.start < 12 * 60 * MIN) add(0, 0, 'Midnight hard stop (S03)', 'Stash insurance items, write down life/ES/res/chaos, log off.');
  // Open P1 trigger actions (deduped by trigger, newest wins; skipped when the condition is known unmet).
  const seenIds = new Set(), openP1 = [];
  for (const e of S.log) {
    if (e.char !== c.created) continue;
    for (const id of e.ids) {
      const tr = trigById[id];
      if (!tr || tr.priority !== 1 || e.acked.includes(id) || seenIds.has(id)) continue;
      seenIds.add(id);
      if (e.evals?.[id]?.met !== false) openP1.push({ tr, note: e.evals?.[id]?.note });
    }
  }
  for (const o of openP1.slice(0, 3)) add(1, 0, `Act on ${o.tr.item}`, o.note || o.tr.action);
  if (openP1.length > 3) add(1, 0, `${openP1.length - 3} more open P1 trigger(s)`, 'See “Open trigger actions” in the log panel.');
  if (isPaused()) add(0, 0, 'Timer paused', `Since ${fmtClock(pauses().at(-1).from)}. Say “resume” or press Resume when you're back.`);
  if (c.def.resStale) add(1, 0, 'Re-enter your res (Kitava)', `Kitava −${kitavaPen()}%: your logged res is from before. Dictate it or press F10 on the Defences tab.`);
  if (!c.campaign.start) add(1, 0, 'Start the league timer', 'Launch is Fri Nov 13, 2:00 PM ET. Plan A: Spectre Necromancer, Absolution bridge (H01).');
  else if (p && p.k <= KITAVA_IDX + 2 && p.next) {
    const st = nextStop(p.k);
    add(1, Math.max(1, Math.round(p.seg.target - p.seg.elapsed / MIN)), `Next: ${p.next.label}`, `Target ${fmtClock(wallAt(p.next[S.pace]))} (${PACE_NAMES[S.pace]}). Gate: ${p.next.gate}${p.next.risk ? ' · ' + p.next.risk : ''}${st ? ` · Then ${st.stop.title}` : ''}`);
  }
  const inMaps = !!c.campaign.done.M13 || c.band > 0;
  if (inMaps) {
    const d = c.def, cl = clearedIdx();
    if (!d.updated || t - d.updated > 20 * 60 * MIN) add(2, 2, 'Update your defense numbers', 'Enter res / chaos / pool / block so gates and Fate caps are right.');
    const nextGate = GATES[cl + 1];
    if (nextGate) {
      const g = gateCheck(nextGate);
      if (!C().def.ele) { add(2, 10, CHUNKS.W4.title, `Res not capped. Needed for ${nextGate.name}.`, 'W4'); add(2, 15, CHUNKS.W5.title, 'Or essence-craft the slot.', 'W5'); }
      else if (g.fails.some((f) => f.startsWith('chaos'))) add(2, 15, 'Hunt chaos res', `For ${nextGate.name}: Fugitive Boots, Amethyst Ring, chaos-res rares. ${g.fails.join(', ')}`, 'W5');
      else if (g.fails.length) add(2, 15, CHUNKS.W7.title, `For ${nextGate.name}: ${g.fails.join(', ')}`, 'W7');
    }
    const day = c.campaign.start ? Math.floor((t - c.campaign.start) / (1440 * MIN)) + 1 : 1;
    if (day <= 7) add(2, 10, CHUNKS.W9.title, `League day ${day}. Watch for Fate reports and poedb drop sources.`, 'W9');
    const fc = cl >= 0 ? GATES[Math.min(cl, 2)].fateCap : 0;
    if (cl >= 0) add(3, budget <= 15 ? 15 : 30, budget <= 15 ? CHUNKS.W1.short : CHUNKS.W1.title, `Cleared up to T${maxTierCleared()}. Fates: up to ${fc} per the Fates panel.`, 'W1');
    if (c.build === 'Spectre Necromancer' && !S.log.some((l) => l.char === c.created && l.ids.includes('N01'))) add(2, budget <= 15 ? 15 : 30, budget <= 15 ? CHUNKS.W11.short : CHUNKS.W11.title, 'No Frostbearers logged yet. Ore/Verisium atlas nodes on (N13). Unsocket Bone Offering at the ore.', 'W11');
    if (c.build === 'Spectre Necromancer') add(3, 10, CHUNKS.W12.title, 'Targets: eff. 21 (T6), 22 + 3 spectres (T11), 25 (T15).', 'W12');
    if (c.level >= 68) add(3, 25, CHUNKS.W2.title, 'Heist via gold (S04).', 'W2');
    add(3, 10, CHUNKS.W3.title, 'Safehouse members drop a specific unique class: pick insurance.', 'W3');
    if (cl >= 0) add(3, 15, CHUNKS.W8.title, 'Use the Fates panel to check the cap first.', 'W8');
    add(4, 5, CHUNKS.W6.title, '', 'W6');
    add(4, 5, CHUNKS.W10.title, '', 'W10');
  }
  const doneToday = (k) => S.chunks[k] && sameDay(S.chunks[k], t) && !CHUNKS[k].repeat;
  const list = tasks.filter((x) => !(x.chunk && doneToday(x.chunk)));
  list.sort((a, b) => a.prio - b.prio);
  // Fill the time budget: urgent items (prio<=1) always show; others only if they fit.
  const out = []; let used = 0;
  for (const x of list) {
    if (x.prio <= 1) { out.push(x); continue; }
    if (used + x.mins <= budget || (!out.some((o) => o.prio > 1) && x.mins <= budget)) { out.push(x); used += x.mins; }
    if (out.length >= 9) break;
  }
  return out;
}

/* ---------- Stage helpers (links and tree: links.js) ---------- */
function curAct() { const d = C().campaign.done; if (d.M13 || C().band > 0) return 11; for (let a = 1; a <= 10; a++) if (!d[ACT_MS[a]]) return a; return 11; }
function hasFrost() { return S.log.some((l) => l.char === C().created && l.ids.includes('N01')); }
/* Pool colour rule (user request): green when life+ES > 300 x act (Act 1 = 300 ... Act 10 = 3000), 3000 at map start, 5000 from T6 (yellow). */
function poolTarget() {
  const c = C(), a = curAct();
  if (a <= 10) return { v: 300 * a, why: 'Act ' + a + ': 300 × act' };
  return (c.band || 0) >= 6 ? { v: 5000, why: 'T6+ yellow maps' } : { v: 3000, why: 'map start' };
}
function stateSummary() {
  const c = C(), d = c.def, st = BCFG ? stageAuto() : null;
  return { build: c.build, level: c.level, act: curAct() > 10 ? 'maps' : curAct(), stage: st ? stageTitle(st) : '', links_now: BCFG ? mainGemsNow() : [],
    res: { fire: d.fire, cold: d.cold, lightning: d.lightning, chaos: d.chaos, capped: d.ele, stale: d.resStale }, kitava_penalty: kitavaPen(),
    life: d.life, es: d.es, pool: d.pool, pool_target: poolTarget().v, attack_block: d.ablock, spell_block: d.block, paused: isPaused(), map_band: c.band, frostbearer: hasFrost() };
}
