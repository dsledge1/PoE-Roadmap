/* ---------- Voice companion bridge ----------
   Served by companion.py at http://127.0.0.1:<port>/ the page opens an EventSource to /api/events.
   Each "command" carries parsed actions; they are applied with the same functions the buttons use,
   then a short spoken summary is POSTed back to /api/result. Opened as file:// this is all inert. */
const VOICE = { served: /^https?:$/.test(location.protocol), state: 'off', hotkey: '', model: '', heard: '' };
const ACT_MS = { 1: 'M1', 2: 'M2', 3: 'M3', 4: 'M5', 5: 'M6', 6: 'M7', 7: 'M8', 8: 'M9', 9: 'M10', 10: 'M13' };
const LAB_MS = { normal: 'M4', cruel: 'M12', merciless: 'M14' };
const msIndex = (id) => MILESTONES.findIndex((m) => m.id === id);
const V = () => (S.voice = S.voice || { log: [], applied: [] });

function voiceInit() {
  if (!VOICE.served) { setVoiceState('off'); return; }
  // Only one tab talks to the companion, so a command is never applied twice. Other tabs wait for the lock.
  if (navigator.locks) { setVoiceState('follower'); navigator.locks.request('poe330-voice-leader', () => new Promise(() => voiceConnect())); }
  else voiceConnect();
}
function voiceConnect() {
  const es = new EventSource('/api/events');
  es.onopen = () => setVoiceState(VOICE.state === 'off' || VOICE.state === 'lost' ? 'ready' : VOICE.state);
  es.onerror = () => setVoiceState('lost');
  es.onmessage = (e) => { try { onVoiceMsg(JSON.parse(e.data)); } catch (err) { console.error('voice msg', err); } };
}
function onVoiceMsg(m) {
  if (m.type === 'hello') { VOICE.hotkey = m.hotkey; VOICE.model = m.model; VOICE.ocrKey = m.ocr_hotkey || ''; VOICE.research = m.research || ''; setVoiceState(m.status === 'idle' ? 'ready' : m.status); syncTypes(); }
  else if (m.type === 'status') setVoiceState(m.state === 'idle' ? 'ready' : m.state);
  else if (m.type === 'transcript') { VOICE.heard = m.text; renderVoice(); }
  else if (m.type === 'command') applyVoiceCommand(m);
  else if (m.type === 'wiki_pending') { WIKI.pending = m.query || ''; WIKI.status = ''; renderWiki(); }
}
function setVoiceState(st) { VOICE.state = st; renderVoiceStatus(); }

function postResult(res) {
  if (!VOICE.served) return;
  fetch('/api/result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(res) }).catch(() => {});
}
function sendTyped(text) {
  if (!VOICE.served || !text.trim()) return;
  fetch('/api/inject', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) }).catch(() => toast('Companion not reachable', 2));
}

/* ---- spoken text helpers ---- */
const shortName = (text) => text.replace(/^\?\s*/, '').replace(/\s*\(.*\)\s*$/, '').replace(/^Near-death$/, 'Near death').replace(/^Death$/, 'Death');
function spokenAction(t, ev) {
  let s = (ev && ev.note) || t.action || '';
  s = s.replace(/^You are on [^:]+:\s*/, '').replace(/\bIf [^:]{0,60}:\s*/, '').replace(/\(.*?\)/g, '').replace(/\bchar\.\w+\s*[=<>!]+\s*'?[\w ]+'?/g, '');
  s = s.replace(/\s+([.,;!])/g, '$1').replace(/\s{2,}/g, ' ');
  s = (s.split(/(?<=[.!])\s/)[0] || s).trim();
  if (s.length > 110) s = s.slice(0, 107).replace(/\s+\S*$/, '') + '…';
  return s ? s[0].toUpperCase() + s.slice(1) : '';
}
function spokenDelta(d) { const m = Math.round(d); return m === 0 ? 'on pace' : m < 0 ? `${-m} minutes ahead` : `${m} minutes behind`; }
const bandWords = (i) => (i < 0 ? 'not cleared for maps' : 'cleared for ' + tiers()[i].band.replace('–', ' to ').replace(/\s*\/.*$/, ''));
const SPOKEN_MS = { M1: 'Act 1', M2: 'Act 2', M3: 'Act 3', M4: 'Normal lab', M5: 'Act 4', M6: 'Act 5 Kitava', M7: 'Act 6', M8: 'Act 7', M9: 'Act 8', M10: 'Act 9', M11: 'Staff and skill point', M12: 'Cruel lab', M13: 'Act 10 Kitava', M14: 'Merciless lab', M15: 'Maps' };
const shortLabel = (m) => SPOKEN_MS[m.id] || m.label.replace(/\s*\(.*\)/, '');

/* ---- apply one command ---- */
const DEF_FIELDS = ['level', 'fire', 'cold', 'lightning', 'chaos', 'pool', 'block', 'ablock', 'mana', 'armour', 'evasion', 'ele', 'over'];
function applyVoiceCommand(cmd) {
  const v = V();
  if (v.applied.includes(cmd.id)) { postResult({ id: cmd.id, say: '', level: 'ok', dup: true, state: stateSummary() }); return; }
  const acts = cmd.actions || [];
  // Order: events and milestones first (so a Kitava milestone in the same sentence never marks the new res stale),
  // then every defense number as one batch with one readback, then questions (answered from the updated state).
  const defs = acts.filter((a) => a.type === 'def' || a.type === 'life_es');
  const queries = acts.filter((a) => a.type === 'query');
  const rest = acts.filter((a) => !defs.includes(a) && !queries.includes(a));
  const inv = [], says = [], levels = [];
  const run = (fn) => {
    let r;
    try { r = fn(); } catch (e) { console.error(e); r = { say: 'Something went wrong.', level: 'error' }; }
    if (r.say) says.push(r.say);
    levels.push(r.level || 'ok');
  };
  for (const a of rest) run(() => applyAction(a, inv, cmd));
  if (defs.length) run(() => applyDefs(defsToSet(defs), inv));
  for (const a of queries) run(() => applyAction(a, inv, cmd));
  const level = levels.includes('p1') ? 'p1' : levels.includes('error') ? 'error' : levels.every((l) => l === 'unknown') ? 'unknown' : 'ok';
  const say = says.join(' ').replace(/\s+/g, ' ').trim();
  if (inv.length && !acts.some((a) => a.type === 'undo')) {
    v.log.unshift({ id: cmd.id, ts: now(), transcript: cmd.transcript, source: cmd.source, say, level, inv, undone: false });
    v.log.length = Math.min(v.log.length, 30);
  } else if (!acts.some((a) => a.type === 'undo') && acts.length) {
    v.log.unshift({ id: cmd.id, ts: now(), transcript: cmd.transcript, source: cmd.source, say, level, inv: [], undone: true, info: true });
    v.log.length = Math.min(v.log.length, 30);
  }
  v.applied.push(cmd.id); if (v.applied.length > 200) v.applied.splice(0, v.applied.length - 200);
  saveNow(); renderAll(); // persisted before the answer goes out: a reload can't lose it or apply it twice
  postResult({ id: cmd.id, say, level, state: stateSummary() });
}
function defsToSet(defs) {
  const set = {};
  for (const a of defs) {
    if (a.type === 'life_es' || a.field === 'life_es') { if (a.life != null) set.life = a.life; if (a.es != null) set.es = a.es; }
    else if (DEF_FIELDS.includes(a.field)) set[a.field] = a.field === 'ele' || a.field === 'over' ? !!a.value : a.value;
  }
  return set;
}
const fmtRes = (v) => (v < 0 ? 'minus ' + -v : '' + v);
/* Apply any mix of defense fields (voice, screenshot, typed) and build one readback naming every field. */
function applyDefs(set, inv, opts = {}) {
  const c = C(), d = c.def, before = clearedIdx(), pen = kitavaPen();
  inv.push({ k: 'def', snap: { ...JSON.parse(JSON.stringify(d)), level: c.level } });
  const parts = [];
  if (set.level != null) {
    const was = c.level; c.level = set.level; parts.push(`Level ${set.level}.`);
    if (was < 68 && set.level >= 68) { const e = addLog('Reached level 68'); inv.push({ k: 'log', id: e.id, prev: { band: c.band, level: was, alive: c.alive }, seenLen: S.fates.seen.length }); parts.push('Heist unlocked: Whakano contracts.'); }
  }
  const res = ['fire', 'cold', 'lightning', 'chaos'].filter((k) => set[k] != null);
  if (res.length) {
    for (const k of res) d[k] = set[k];
    const ele = res.filter((k) => k !== 'chaos');
    if (ele.length) { d.resPen = pen; d.resStale = false; }
    if (set.uncapped) d.uncapped = set.uncapped;
    if (set.ele == null && resKnown(d) && ele.length) d.ele = ELE.every((k) => d[k] >= 75);
    if (set.over == null && set.uncapped && ELE.every((k) => set.uncapped[k] != null)) d.over = ELE.every((k) => set.uncapped[k] >= 85);
    const same = ele.length === 3 && ELE.every((k) => set[k] === set.fire);
    let txt = same ? `Fire, cold and lightning ${fmtRes(set.fire)}` : ele.map((k) => `${k} ${fmtRes(set[k])}`).join(', ');
    if (set.chaos != null) txt += (txt ? ', chaos ' : 'Chaos ') + fmtRes(set.chaos);
    if (ele.length) txt += pen ? `, after Kitava penalty minus ${pen}` : ', no Kitava penalty yet';
    parts.push(txt[0].toUpperCase() + txt.slice(1) + '.');
    if (ele.length) { const u = uncappedList(d); if (u.length) parts.push(`Uncapped: ${u.join(', ')}.`); else if (resKnown(d)) parts.push('Elemental res capped.'); }
  }
  if (set.ele != null) {
    d.ele = set.ele; d.resPen = pen; d.resStale = false;
    if (!res.length) parts.push((set.ele ? 'Res capped' : 'Res not capped') + (pen ? `, after Kitava penalty minus ${pen}.` : '.'));
  }
  if (set.over != null) { d.over = set.over; parts.push(set.over ? 'Overcapped.' : 'No overcap.'); }
  if (set.life != null || set.es != null) {
    if (set.life != null) d.life = set.life;
    if (set.es != null) d.es = set.es;
    d.poolManual = false; d.pool = (d.life || 0) + (d.es || 0);
    const bits = [];
    if (set.life != null) bits.push(`Life ${set.life}`);
    if (set.es != null) bits.push(`E S ${set.es}`);
    if (set.pool == null && (d.es || set.es != null) && (d.life || set.life != null)) bits.push(`pool ${d.pool}`);
    parts.push(bits.join(', ') + '.');
  }
  if (set.pool != null) {
    d.pool = set.pool;
    if (set.life == null && set.es == null) d.poolManual = true;
    parts.push(`Pool ${set.pool}.`);
  }
  const NAMES = { ablock: 'Attack block', block: 'Spell block' };
  const misc = ['ablock', 'block'].filter((k) => set[k] != null);
  if (misc.length) { for (const k of misc) d[k] = set[k]; parts.push(misc.map((k) => `${NAMES[k]} ${set[k]}`).join(', ') + '.'); }
  for (const k of ['mana', 'armour', 'evasion', 'evade', 'suppress', 'pdr']) if (set[k] != null) d[k] = set[k];   // v5.2: shown / checked when on in Configure
  d.updated = now();
  save(); renderAll();
  const after = clearedIdx();
  if (after !== before) parts.push(`Now ${bandWords(after)}.`);
  if (opts.prefix) parts.unshift(opts.prefix);
  return { say: parts.join(' ') };
}

function applyAction(a, inv, cmd = {}) {
  const c = C();
  switch (a.type) {
    case 'log': {
      const prev = { band: c.band, level: c.level, alive: c.alive }, seenLen = S.fates.seen.length;
      let text = a.text, kind = a.kind, type = a.custom || '';
      if (kind === 'note' && !type) {   // companion not synced yet: the page still knows this character's types
        const t = matchType(a.text);
        if (t) { text = typeLogText(t, a.text); kind = t.kind; type = t.id; }
      }
      const e = addLog(text, kind, { type, detail: a.detail || (type ? a.text : '') });
      inv.push({ k: 'log', id: e.id, prev, seenLen });
      const more = (r) => { const x = [e.typeSay, ruleSay(e, r.say)].filter(Boolean).join(' '); if (x) r.say = (r.say + ' ' + x).trim(); return r; };   // v5.2: type "also say", rules
      if (e.sameIncident) return { say: 'Near death logged, same incident as a moment ago.' };
      if (e.typeOff) return { say: `Noted. ${e.typeOff} is turned off in Configure.`, level: 'unknown' };
      if (!e.ids.length) {
        if (e.kind === 'note') return more({ say: 'Noted.', level: 'unknown' });
        if (a.match && a.match.confidence === 'low') return { say: `Did you mean ${a.match.name}?`, level: 'unknown' };
        return more({ say: `${shortName(e.text)} logged.` });
      }
      const top = e.ids.map((id) => trigById[id]).sort((x, y) => x.priority - y.priority)[0];
      const name = shortName(e.text);
      return more({ say: `${name} logged. ${spokenAction(top, e.evals[top.id])}`, level: top.priority === 1 ? 'p1' : 'ok' });
    }
    case 'set_act': return setAct(a, inv);
    case 'custom_type': return applyTypeCmd(a, inv);
    case 'chase': return applyChaseCmd(a, inv);
    case 'tree_nav': return treeNav(a);   // v5.1: "next tree", "show tree Level 60"
    case 'pace_cfg': return { say: setPaceCfg(a.preset ? { preset: a.preset } : { total: a.total }, inv) };   // v5
    case 'text_size': return { say: setTextSize(a, inv) };
    case 'wiki_link_result': return wikiLinkResult(a, inv);
    case 'yes': return { say: 'Nothing to say yes to.', level: 'unknown' };
    case 'timer_reset': return timerReset(a, inv);         // v5.3
    case 'trial': return trialCmd(a, inv);
    case 'unmark': return unmarkLab(a, inv);
    case 'area': return areaCmd(a, inv);
    case 'boss_down': return bossDown(a, inv);
    case 'ocr_notice': {
      const ob = $('ocrBox'); ob.classList.remove('hidden');
      ob.innerHTML = `<span class="bad">${esc(a.text || 'Not the Defences tab.')}</span>${a.fields && Object.keys(a.fields).length ? ` <span class="dim">(read only ${esc(ocrSummary(a.fields))}; nothing to confirm)</span>` : ''}`;
      return { say: '' };   // the companion speaks it
    }
    case 'milestone': {
      if (!c.campaign.start) return { say: 'League timer is not running. Say start league first.', level: 'unknown' };
      const k = doneCount();
      let idx = -1;
      if (a.next) idx = k;
      else if (a.id) idx = msIndex(a.id);
      else if (a.act) idx = msIndex(ACT_MS[a.act]);
      else if (a.lab) idx = a.lab === 'next' ? ['M4', 'M12', 'M14'].map(msIndex).find((i) => i >= k) ?? -1 : msIndex(LAB_MS[a.lab]);
      else if (a.kitava) idx = a.kitava === 'next' ? [msIndex('M6'), msIndex('M13')].find((i) => i >= k) ?? -1 : msIndex(a.kitava === 5 ? 'M6' : 'M13');
      if (idx < 0) return { say: 'Nothing left to mark.', level: 'unknown' };
      if (idx < k) return { say: `${shortLabel(MILESTONES[idx])} was already done.`, level: a.boss ? 'ok' : 'unknown' };
      const r = completeMilestones(idx);
      inv.push({ k: 'ms', ids: r.ids, logId: r.logId, defSnap: r.defSnap, resumed: r.resumed });
      const skipped = r.ids.length > 1 ? ` Also marked ${r.ids.length - 1} skipped.` : '';
      return { say: `${r.resumed ? 'Timer resumed. ' : ''}${shortLabel(r.ms)} done, ${spokenDelta(r.delta)}.${skipped}${r.kit ? ' ' + r.kit.warn : ''}${r.stop ? ' ' + r.stop.title.replace(/^Stop (\d) at [^:]+:/, 'Stop $1:') + '.' : ''}`, level: r.kit && r.kit.had ? 'p1' : 'ok' };
    }
    case 'def': case 'life_es': return applyDefs(defsToSet([a]), inv);
    case 'kill': {
      const content = c.campaign.done.M13 || c.band ? 'map' : 'campaign';
      const k = { boss: a.boss, fates: a.fates || 0, content: c.band ? 'T' + c.band : content, ts: now() };
      c.kills.push(k); inv.push({ k: 'kill', ts: k.ts }); save(); renderAll();
      return { say: `${a.boss} kill logged, ${k.fates} ${k.fates === 1 ? 'Fate' : 'Fates'}.` };
    }
    case 'fate_attempt': {
      const camp = !c.campaign.done.M13 && !c.band;
      const boss = a.boss || '';
      const r = fateCalc(boss, camp ? 'campaign' : 'map', c.band || 1, { seen: false, isNew: false, deified: false, scary: false });
      const n = a.fates || 0;
      const e = addLog(`Fate attempt: ${n} Fate${n === 1 ? '' : 's'}${boss ? ' on ' + boss : ''}`, 'note');
      inv.push({ k: 'log', id: e.id, prev: { band: c.band, level: c.level, alive: c.alive }, seenLen: S.fates.seen.length });
      if (n > r.cap) return { say: `Stop: ${n} Fate${n === 1 ? '' : 's'} is over your cap of ${r.cap}${boss ? ' for ' + boss : ''}. ${(r.why[0] || '').replace(/\(.*?\)/g, '')}`, level: 'p1' };
      return { say: `${n} Fate${n === 1 ? '' : 's'}${boss ? ' on ' + boss : ''} is within your cap of ${r.cap}. Good luck.` };
    }
    case 'start': {
      if (c.campaign.start) {
        if (isPaused()) { const r = resumeTimer(); if (r.op) inv.push(r.op); return r; }
        return { say: `League already started at ${fmtClock(c.campaign.start)}.`, level: 'unknown' };
      }
      inv.push({ k: 'start', prev: null }); c.campaign.start = now(); save(); renderAll();
      return { say: 'League timer started. Good luck.' };
    }
    case 'pause': { const r = pauseTimer(); if (r.op) inv.push(r.op); return r; }
    case 'resume': { const r = resumeTimer(); if (r.op) inv.push(r.op); return r; }
    case 'undo': {
      const last = V().log.find((x) => !x.undone);
      if (!last) return { say: 'Nothing to undo.', level: 'unknown' };
      voiceUndo(last.id, true);
      return { say: `Undid ${last.transcript.slice(0, 60)}.` };
    }
    case 'research_result': {
      const e = { id: uid(), ts: now(), kind: 'research', text: `Research “${a.query}”: ${a.spoken || 'no answer'}`, full: a.full || '', url: a.url || '', title: a.title || '', source: a.source || '', note: a.note || '', ids: [], acked: [], char: c.created };
      S.log.unshift(e); inv.push({ k: 'log', id: e.id, prev: { band: c.band, level: c.level, alive: c.alive }, seenLen: S.fates.seen.length });
      if (a.url) { const w = addWikiLink({ query: a.query, title: a.title, url: a.url, source: 'research' }); if (w) inv.push({ k: 'wiki', id: w.id }); }   // v5: research pages land in Wiki links too
      return { say: '' }; // the companion speaks the answer itself
    }
    case 'ocr_proposal': {
      inv.push({ k: 'ocr', prev: S.ocrPending || null });
      if (!a.fields || !Object.keys(a.fields).length) { S.ocrPending = null; return { say: 'Could not read any defense numbers from that screenshot.', level: 'unknown' }; }
      if (a.hint === 'offence') {   // v4: the Offence tab's life/mana are never offered for confirm
        S.ocrPending = null;
        const ob = $('ocrBox'); ob.classList.remove('hidden'); ob.innerHTML = '<span class="bad">That\'s the Offence tab, open Defences and press F10 again.</span>';
        return { say: "That's the Offence tab, open Defences and press F10 again.", level: 'unknown' };
      }
      const onlyLevel = Object.keys(a.fields).length === 1 && a.fields.level != null;   // v5.1: just the panel header (level badge)
      const few = !onlyLevel && (a.partial || Object.keys(a.fields).length < 4);
      S.ocrPending = { fields: a.fields, uncapped: a.uncapped || null, source: a.source || '', engine: a.engine || '', ts: now(), partial: few };
      if (few) return { say: `That read looks incomplete: only ${ocrSummary(a.fields)}. Check the Defences tab is open. Say confirm to apply anyway, or discard.`, level: 'unknown' };
      return { say: `Screenshot read: ${ocrSummary(a.fields)}. Say confirm to apply, or discard.` };
    }
    case 'ocr': {
      const pend = S.ocrPending;
      if (a.what === 'scan') return { say: 'Press the screenshot hotkey on your Defences tab, or paste a screenshot into the tracker.', level: 'unknown' };
      if (!pend) return { say: 'No screenshot values waiting.', level: 'unknown' };
      inv.push({ k: 'ocr', prev: pend });
      S.ocrPending = null;
      if (a.what === 'discard') { save(); renderAll(); return { say: 'Discarded the screenshot values.' }; }
      return applyDefs({ ...pend.fields, uncapped: pend.uncapped }, inv, { prefix: 'Applied.' });
    }
    case 'query': return answerQuery(a, inv);
    default: return { say: '', level: 'unknown' };
  }
}
const OCR_NAMES = { level: 'level', fire: 'fire', cold: 'cold', lightning: 'lightning', chaos: 'chaos', life: 'life', es: 'E S', pool: 'pool', block: 'spell block', ablock: 'attack block', mana: 'mana', armour: 'armour', evasion: 'evasion', evade: 'evade chance', suppress: 'spell suppression', pdr: 'physical damage reduction' };
const ocrSummary = (f) => Object.entries(f).map(([k, v]) => `${OCR_NAMES[k] || k} ${['fire', 'cold', 'lightning', 'chaos'].includes(k) ? fmtRes(v) : v}`).join(', ');

function answerQuery(a, inv) {
  const c = C(), d = c.def;
  switch (a.what) {
    case 'links': return { say: linkAnswer(a) };
    case 'fate_info': return bossAnswer(a);
    case 'drop_where': {
      const name = a.item || a.text || 'that';
      const m = matchText(a.item || a.text || '');
      const t = m.ids.map((id) => trigById[id]).filter((x) => x && x.type === 'drop')[0];
      return { say: `I don't have drop locations for ${name} in the tracker. Want me to look it up on poewiki? Say yes.${t ? ` It is one of your trigger items: ${spokenAction(t, evalCond(t))}` : ''}`, level: 'unknown' };
    }
    case 'news': {
      const topic = String(a.topic || '').trim(), social = /^(x|twitter|reddit|the forums?|discord|news|patch notes?)$/i.test(topic);
      return { say: `I only check poewiki and poedb; I can't read X, Twitter or Reddit. Check pathofexile.com or Reddit yourself for the latest${topic && !social ? ' on ' + topic : ''}.`, level: 'unknown' };
    }
    case 'chase': return { say: a.watch ? chaseWatch(a.content || '') : chaseSummary(a.content || '') };
    case 'hello': return { say: 'I hear you loud and clear.' };
    case 'res': {
      if (!resKnown(d) && d.chaos == null && !d.ele) return { say: 'No res logged yet. Tell me fire, cold, lightning and chaos, or press the screenshot hotkey on your Defences tab.', level: 'unknown' };
      const pen = kitavaPen();
      const parts = [];
      if (resKnown(d)) parts.push(`Fire ${fmtRes(d.fire)}, cold ${fmtRes(d.cold)}, lightning ${fmtRes(d.lightning)}`);
      else parts.push(d.ele ? 'Elemental res capped' : 'Elemental res not capped');
      if (d.chaos != null) parts.push(`chaos ${fmtRes(d.chaos)}`);
      let s = parts.join(', ') + '.';
      const u = uncappedList(d);
      if (u.length) s += ` Uncapped: ${u.map((k) => `${k} needs ${75 - d[k]}`).join(', ')}.`;
      if (d.resStale) s += ` Those are from before the Kitava penalty, now minus ${pen}. Give me new numbers.`;
      else if (pen) s += ` Kitava penalty minus ${pen} included.`;
      if (d.life != null || d.es != null) s += ` Life ${d.life ?? 0}, E S ${d.es ?? 0}.`;
      else if (d.pool != null) s += ` Pool ${d.pool}.`;
      return { say: s, level: d.resStale ? 'p1' : 'ok' };
    }
    case 'trigger': {
      const m = matchText(a.item || '');
      const ts = m.ids.map((id) => trigById[id]).filter(Boolean).sort((x, y) => x.priority - y.priority);
      if (!ts.length) return unknownQuestion(`what about ${a.item}`, inv);
      const t = ts[0];
      return { say: `${t.item}: ${spokenAction(t, evalCond(t))}` };
    }
    case 'unknown': return unknownQuestion(a.text || '', inv);
    default: return { say: voiceAnswer(a.what) };
  }
}
function unknownQuestion(text, inv) {
  const q = text.replace(/[?.!]+$/, '').trim();
  const e = addLog(`Question: ${q}`, 'note');
  inv.push({ k: 'log', id: e.id, prev: { band: C().band, level: C().level, alive: C().alive }, seenLen: S.fates.seen.length });
  return { say: "I don't know that one. Want me to look that up? Say yes.", level: 'unknown' };
}

/* "I'm in Act 2" / "I'm in Act 2, not Act 3": unmark later milestones (or mark earlier ones), undoable. */
function setAct(a, inv) {
  const c = C(), n = a.act;
  if (!c.campaign.start) return { say: 'League timer is not running. Say start league first.', level: 'unknown' };
  const target = msIndex(ACT_MS[n]), k = doneCount();
  if (curAct() === n && !(c.band > 0)) return { say: `Yes, you're in Act ${n}. Nothing to change.` };
  if (k > target || c.band > 0) {
    const ids = MILESTONES.slice(target, k).map((m) => m.id), prev = {};
    ids.forEach((id) => { prev[id] = c.campaign.done[id]; delete c.campaign.done[id]; });
    inv.push({ k: 'unms', prev, band: c.band }); c.band = 0; save(); renderAll();
    const names = ids.map((id) => SPOKEN_MS[id]);
    return { say: `Corrected to Act ${n}. Unmarked ${names.length ? names.join(', ') : 'nothing'}. Say undo to restore.` };
  }
  const r = completeMilestones(target - 1);
  inv.push({ k: 'ms', ids: r.ids, logId: r.logId, defSnap: r.defSnap, resumed: r.resumed });
  return { say: `Set to Act ${n}. Marked ${r.ids.map((id) => SPOKEN_MS[id]).join(', ')} done.${r.kit ? ' ' + r.kit.warn : ''} Say undo if that's wrong.`, level: r.kit && r.kit.had ? 'p1' : 'ok' };
}

function voiceUndo(entryId, silent) {
  const e = V().log.find((x) => x.id === entryId);
  if (!e || e.undone) return;
  const c = C();
  for (const op of [...e.inv].reverse()) {
    if (op.k === 'log') { S.log = S.log.filter((l) => l.id !== op.id); Object.assign(c, op.prev); S.fates.seen.length = Math.min(S.fates.seen.length, op.seenLen); }
    else if (op.k === 'ms') {
      op.ids.forEach((id) => delete c.campaign.done[id]); S.log = S.log.filter((l) => l.id !== op.logId);
      if (op.defSnap) c.def = op.defSnap;
      if (op.resumed) { const p = pauses().at(-1); if (p && p.from === op.resumed) p.to = null; }
    }
    else if (op.k === 'def') { const { level, ...d } = op.snap; c.def = Object.assign(c.def, d); c.level = level; }
    else if (op.k === 'kill') c.kills = c.kills.filter((k) => k.ts !== op.ts);
    else if (op.k === 'trials') c.trials = op.prev;
    else if (op.k === 'area') c.area = op.prev;
    else if (op.k === 'run') { c.campaign = op.prev; c.runs = (c.runs || []).filter((r) => r.ended !== op.ended); }
    else if (op.k === 'start') c.campaign.start = op.prev;
    else if (op.k === 'pause') { const ps = pauses(); if (ps.length && ps.at(-1).to == null) ps.pop(); }
    else if (op.k === 'resume') { const p = pauses().at(-1); if (p && p.from === op.from) p.to = null; }
    else if (op.k === 'ocr') S.ocrPending = op.prev;
    else if (op.k === 'unms') { Object.assign(c.campaign.done, op.prev); c.band = op.band || 0; }
    else if (op.k === 'types') { c.types = op.prev; syncTypes(); }
    else if (op.k === 'chase') { c.chase = op.prev; if (op.prevCt) S.contentTypes = op.prevCt; }
    else if (op.k === 'pacecfg') S.paceCfg = op.prev;
    else if (op.k === 'ui') { S.ui = Object.assign(S.ui || {}, op.prev); applyTextSize(); }
    else if (op.k === 'wiki') S.wikiLinks = (S.wikiLinks || []).filter((w) => w.id !== op.id);
  }
  e.undone = true;
  save(); renderAll();
  if (!silent) toast('Undid: ' + esc(e.transcript));
}
/* Buttons that should be undoable go through the same path as voice. */
function uiCommand(transcript, actions) { applyVoiceCommand({ id: 'ui-' + uid(), transcript, source: 'button', actions }); }

function voiceAnswer(what) {
  const c = C(), p = paceInfo();
  if (what === 'pace') {
    if (!p) return 'League timer is not running.';
    const pz = p.paused ? ' Timer is paused.' : '';
    if (!p.next) return `Campaign done. Kitava was ${spokenDelta(activeMs(c.campaign.done.M13) / MIN - paceAt(MILESTONES[KITAVA_IDX]))} on ${paceWords()} pace.`;
    const over = p.seg.elapsed / MIN - p.seg.target;
    return `${shortLabel(p.next)}: ${Math.round(Math.abs(over))} minutes ${over > 0 ? 'over' : 'left'}. Overall ${spokenDelta(p.deltas[S.pace])} on ${paceWords()} pace. Played ${fmtDur(p.elapsed * MIN)}. Kitava projected ${fmtClock(p.projKitava)}.${pz}`;
  }
  if (what === 'gate') {
    const i = clearedIdx(), g = tiers()[i + 1];
    return `You are ${bandWords(i)}.` + (g ? ` ${g.name} needs: ${gateCheck(g).fails.slice(0, 3).join(', ')}.` : '');
  }
  if (what === 'fates') {
    const i = clearedIdx();
    const camp = !c.campaign.done.M13 && !c.band;
    return camp ? (S.fates.campaignOk ? 'Campaign: one Fate on a known boss.' : 'Campaign: zero Fates.') : `Up to ${i < 0 ? 0 : tiers()[i].fateCap} Fates in your band. One on a boss you have not killed on this character.`;
  }
  // next
  if (p && p.next && p.k <= KITAVA_IDX + 2) {
    const st = nextStop(p.k);
    return `Next: ${shortLabel(p.next)}, by ${fmtClock(wallAt(paceAt(p.next)))}. Gate: ${p.next.gate.split('.')[0]}.${st && st.ms === p.next ? ' Then ' + st.stop.title.replace(/^Stop (\d) at [^:]+:/, 'stop $1:') + '.' : ''}`;
  }
  const t = buildTasks(S.budget).filter((x) => x.title);
  return t.length ? 'Next: ' + t.slice(0, 2).map((x) => x.title).join('. Then ') + '.' : 'Nothing queued.';
}

/* ---- screenshot paste → companion OCR (local; nothing leaves the PC) ---- */
async function ocrPaste(blob) {
  if (!VOICE.served) { toast('Screenshot import works when opened through the companion (run.bat).', 2); return; }
  const url = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
  $('ocrBox').classList.remove('hidden'); $('ocrBox').innerHTML = '<span class="dim">Reading screenshot…</span>';
  try {
    const r = await (await fetch('/api/ocr', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: url }) })).json();
    if (r.error) throw new Error(r.error);
    uiCommand('Pasted screenshot', [{ type: 'ocr_proposal', fields: r.fields, uncapped: r.uncapped, source: r.source, engine: r.engine, partial: r.partial, hint: r.hint }]);
  } catch (e) { $('ocrBox').innerHTML = `<span class="bad">Screenshot import failed: ${esc(e.message)}</span>`; }
}

/* ---- rendering ---- */
function renderVoiceStatus() {
  const el = $('voiceDot'); if (!el) return;
  const st = VOICE.state;
  const label = { off: 'Voice: open via companion', ready: `Voice ready · hold ${(VOICE.hotkey || 'F9').toUpperCase()}`, listening: 'Listening…', processing: 'Transcribing…', lost: 'Voice: companion not running', follower: 'Voice: active in another tab' }[st] || st;
  el.className = 'vdot v-' + st;
  el.textContent = label;
  el.title = VOICE.model ? 'Whisper: ' + VOICE.model : '';
  const k = $('ocrKeyHint'); if (k) k.textContent = (VOICE.ocrKey || 'F10').toUpperCase();
}
function renderVoice() {
  renderVoiceStatus();
  const box = $('voiceList'); if (!box) return;
  $('voiceTyped').disabled = !VOICE.served;
  $('voiceHint').textContent = VOICE.served ? (VOICE.heard ? 'Heard: “' + VOICE.heard + '”' : 'Hold the hotkey, speak, release. Or type a command.') : 'Voice works when opened through the companion (run.bat → http://127.0.0.1:8765/).';
  const log = V().log.slice(0, 12);
  box.innerHTML = log.length ? log.map((e, i) => `<div class="logitem${e.undone && !e.info ? ' dim' : ''}"><time>${fmtClock(e.ts)}</time><span class="t"><b>“${esc(e.transcript)}”</b><br><span class="dim">${esc(e.say || '')}</span></span>${e.info ? '<span class="badge">answer</span>' : e.undone ? '<span class="badge">undone</span>' : `<button class="sm" data-vundo="${e.id}">Undo</button>`}</div>`).join('') : '<div class="dim">No voice commands yet.</div>';
}
