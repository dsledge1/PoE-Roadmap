/* ---------- v5.3: lab trials, lab corrections, timer reset (new run), where-am-I, boss kills (from the Act 1-2 playtest) ---------- */
const TRIALS = [
  { id: 'lower_prison', name: 'Lower Prison', area: 'The Lower Prison', act: 1 },
  { id: 'crypt', name: 'Crypt', area: 'The Crypt', act: 2 },
  { id: 'chamber_of_sins', name: 'Chamber of Sins', area: 'The Chamber of Sins', act: 2 },
  { id: 'crematorium', name: 'Crematorium', area: 'The Crematorium', act: 3 },
  { id: 'catacombs', name: 'Catacombs', area: 'The Catacombs', act: 3 },
  { id: 'imperial_gardens', name: 'Imperial Gardens', area: 'The Imperial Gardens', act: 3 },
];
const trials = () => { const c = C(); if (!c.trials || typeof c.trials !== 'object') c.trials = {}; return c.trials; };
const trialName = (id) => (TRIALS.find((t) => t.id === id) || { name: id }).name;
const missedTrials = () => TRIALS.filter((t) => (trials()[t.id] || {}).st === 'missed');
function trialCmd(a, inv) {
  const tr = trials(), prev = JSON.parse(JSON.stringify(tr));
  let id = a.trial;
  if (!id) {
    const here = TRIALS.find((t) => C().area && norm(t.area) === norm(C().area));
    id = here ? here.id : (TRIALS.find((t) => !tr[t.id] || tr[t.id].st !== 'done') || {}).id;
  }
  if (!id) return { say: 'All six normal lab trials are already done.' };
  tr[id] = { st: a.op === 'missed' ? 'missed' : 'done', ts: now() };
  inv.push({ k: 'trials', prev });
  const lp = { band: C().band, level: C().level, alive: C().alive }, sl = S.fates.seen.length;
  const le = addLog(`Lab trial ${a.op === 'missed' ? 'missed' : 'done'}: ${trialName(id)}`, 'note'); inv.push({ k: 'log', id: le.id, prev: lp, seenLen: sl });
  save(); renderAll();
  const done = TRIALS.filter((t) => (tr[t.id] || {}).st === 'done').length, miss = missedTrials();
  if (a.op === 'missed') return { say: `Noted: ${trialName(id)} trial missed. I'll remind you before the lab.` };
  return { say: `${trialName(id)} trial done, ${done} of 6.${miss.length ? ' Still missed: ' + miss.map((t) => t.name).join(', ') + '.' : ''}` };
}
/* "no, not normal lab" / "normal lab was not done": take back the lab mark (and anything that command marked skipped) */
function unmarkLab(a, inv) {
  const id = LAB_MS[a.lab || 'normal'] || 'M4', c = C(), label = `${(a.lab || 'normal')[0].toUpperCase()}${(a.lab || 'normal').slice(1)} lab`;
  if (!c.campaign.done[id]) return { say: `${label} isn't marked done. Nothing to change.` };
  const e = V().log.find((x) => !x.undone && (x.inv || []).some((op) => op.k === 'ms' && op.ids.includes(id)));
  if (e) { voiceUndo(e.id, true); return { say: `Unmarked ${label}${e.inv.some((op) => op.k === 'ms' && op.ids.length > 1) ? ' and the steps it marked skipped' : ''}.` }; }
  const prev = { [id]: c.campaign.done[id] }; delete c.campaign.done[id];
  inv.push({ k: 'unms', prev, band: c.band }); save(); renderAll();
  return { say: `Unmarked ${label}.` };
}
/* "restart timer" / "new run": asks first; "yes" (within 30 s) starts a fresh run, the old one is kept in history */
function timerReset(a, inv) {
  const c = C();
  if (!a.confirmed) return { say: 'Reset the timer and start a new run? Say yes to reset. The old run is kept in history.', level: 'unknown' };
  const ended = now(), prev = c.campaign;
  c.runs = Array.isArray(c.runs) ? c.runs : [];
  c.runs.push({ ...JSON.parse(JSON.stringify(prev)), trials: JSON.parse(JSON.stringify(trials())), ended });
  inv.push({ k: 'run', prev, ended }, { k: 'trials', prev: JSON.parse(JSON.stringify(trials())) });
  c.campaign = { start: ended, done: {}, pauses: [] }; c.trials = {};
  save(); renderAll();
  return { say: `New run started at ${fmtClock(ended)}. The old run is saved (${c.runs.length} in history).` };
}
/* "we're in submerged passage now" / "fighting Merveil": current area (+ act when it moves forward), that area's Fate bosses */
function areaCmd(a, inv) {
  const c = C();
  let area = a.area || '', act = a.act || 0, b = null;
  if (a.boss) { b = findBoss(a.boss); if (b) { area = b.area || area; act = b.act || act; } }
  const prevArea = c.area || ''; c.area = area || prevArea; inv.push({ k: 'area', prev: prevArea });
  const parts = [];
  if (act && c.campaign.start && curAct() <= 10 && act > curAct() && !c.band) { const r = setAct({ act }, inv); parts.push(r.say); }
  const here = bossList().filter((x) => x.area && area && norm(x.area).replace(/^the /, '') === norm(area).replace(/^the /, ''));
  const open = b || here[0];
  if (open) { S.bossOpen = open.boss; scrollToBoss(open.boss); }
  const tr = TRIALS.find((t) => norm(t.area) === norm(area));
  save(); renderAll();
  const head = a.boss && !b ? `Fighting ${a.boss}.` : `${area || 'Area'}${act ? ', Act ' + act : ''}.`;
  const fate = here.length ? ` Fate boss${here.length > 1 ? 'es' : ''} here: ${here.map((x) => x.boss.split(',')[0]).join(', ')} (opened in the Fate panel).` : (b ? ` ${b.boss.split(',')[0]}'s Fate card is open.` : '');
  const trial = tr && (trials()[tr.id] || {}).st !== 'done' ? ' Lab trial in this area.' : '';
  return { say: `${parts.join(' ')} ${head}${fate}${trial}`.trim() };
}
/* "Hillock down" / "Fair Graves is dead" / "Fadeletus": a boss kill event (0 Fates), never a character death */
function bossDown(a, inv) {
  const c = C(), boss = a.boss || 'Boss';
  const prev = { band: c.band, level: c.level, alive: c.alive }, seenLen = S.fates.seen.length;
  const e = addLog(`Boss down: ${boss}`, 'event');
  inv.push({ k: 'log', id: e.id, prev, seenLen });
  const fb = findBoss(boss);
  if (fb && !c.kills.some((k) => norm(k.boss) === norm(fb.boss))) {
    const k = { boss: fb.boss, fates: 0, content: c.campaign.done.M13 || c.band ? 'map' : 'campaign', ts: now() };
    c.kills.push(k); inv.push({ k: 'kill', ts: k.ts });
  }
  if (fb && fb.area) c.area = fb.area;
  save(); renderAll();
  return { say: `${boss} down, logged.` };
}
function ensureV53() { trials(); }

/* ---------- v5.3 EHP: a Path of Building-style estimate from the numbers in the Defense panel ----------
   Max hit per type = the raw hit H where damage taken H × (1 − mitigation) equals the pool (life + ES, MoM pool with Mind Over Matter).
   Physical: armour DR = A / (A + 5·H) at that same hit (PoB 3.x; solved by bisection), + 4% per endurance charge, capped at 90%;
   the share taken as fire / cold / lightning / chaos skips armour and uses that resistance instead. Without an armour number the
   Defences tab's "estimated physical damage reduction" is used. Elemental / chaos: 1 − res (in-game value, already capped).
   EHP ~ = pool ÷ average damage taken per point of raw damage over an even mix of the five types, half attacks (attack block,
   evade) and half spells (spell block, suppression halves suppressed hits) — the expected-value way PoB averages avoidance.
   Ignores buffs, guard skills, flasks, charges other than endurance, regen / leech, enemy accuracy and penetration. */
const EHP_TYPES = [['phys', 'Phys'], ['fire', 'Fire'], ['cold', 'Cold'], ['lightning', 'Light'], ['chaos', 'Chaos']];
function physTakenFrac(d, H) {
  const pt = statOn('ptaken') ? d.ptaken || {} : {};
  const conv = PTAKEN.reduce((s, k) => s + Math.max(0, pt[k] || 0), 0) / 100, keep = Math.max(0, 1 - Math.min(1, conv));
  const endu = statOn('endurance') ? Math.max(0, d.endurance || 0) * 0.04 : 0;
  let dr;
  if (d.armour != null && d.armour > 0) dr = d.armour / (d.armour + 5 * Math.max(1, H));
  else dr = statOn('pdr') || d.pdr != null ? Math.max(0, (d.pdr || 0) / 100) : 0;
  dr = Math.min(0.9, dr + endu);
  const res = (k) => Math.min(0.9, (d[k] || 0) / 100);
  return keep * (1 - dr) + PTAKEN.reduce((s, k) => s + Math.max(0, (pt[k] || 0) / 100) * (1 - res(k)), 0);
}
function maxHitFor(type, d, pool) {
  if (type !== 'phys') { const r = Math.min(0.9, (d[type] || 0) / 100); return pool / Math.max(0.01, 1 - r); }
  let lo = pool, hi = pool * 1000;                                  // damage taken H·f(H) grows with H: bisection
  for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (mid * physTakenFrac(d, mid) < pool) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}
function ehpCalc(d = C().def) {
  const pool = effPool(d);
  if (!(pool > 0)) return null;
  const hits = {}; for (const [k] of EHP_TYPES) hits[k] = maxHitFor(k, d, pool);
  const pct = (v) => Math.max(0, Math.min(0.75, (v || 0) / 100));
  const atk = (1 - pct(d.ablock)) * (1 - (statOn('evade') ? Math.min(0.95, (d.evade || 0) / 100) : 0));
  const spl = (1 - pct(d.block)) * (1 - 0.5 * (statOn('suppress') ? Math.min(1, (d.suppress || 0) / 100) : 0));
  const avoid = 0.5 * atk + 0.5 * spl;
  const taken = EHP_TYPES.reduce((s, [k]) => s + 0.2 * (pool / hits[k]), 0) * avoid;   // pool / maxhit = damage taken per raw point
  return { pool, hits, ehp: pool / taken, atk, spl };
}
const fmtK = (v) => (v >= 10000 ? (v / 1000).toFixed(v >= 100000 ? 0 : 1) + 'k' : String(Math.round(v)));
const EHP_TIP = 'Path of Building-style estimate from the numbers above. Max hit per type: the hit H with H × (1 − mitigation) = pool (life + ES; with Mind Over Matter ES + min(life ÷ 0.6, life + mana)). Physical: armour DR = A ÷ (A + 5 × H) at that hit (PoB 3.x), + 4% per endurance charge, capped at 90%; phys taken as an element uses that resistance instead (no armour); without armour the screen’s estimated phys reduction is used. Elemental and chaos: 1 − resistance (in-game value, already capped); ES is not bypassed. EHP ~ = pool ÷ the average damage taken over an even mix of the five types, half attacks (attack block, evade) and half spells (spell block, suppression halves suppressed hits). An approximation: ignores buffs, guard skills, flasks, other charges, regen/leech, enemy accuracy and penetration.';
function renderEhp() {
  const el = $('ehpLine'); if (!el) return;
  const on_ = statOn('ehp'); el.classList.toggle('hidden', !on_); if (!on_) return;
  const e = ehpCalc();
  el.title = EHP_TIP;
  el.innerHTML = e ? `<b>Max hit:</b> ${EHP_TYPES.map(([k, n]) => `${n} ${fmtK(e.hits[k])}`).join(' · ')} <span class="ehpv">· <b>EHP ~${fmtK(e.ehp)}</b></span> <span class="tipq">ⓘ</span>` : '<span class="dim">EHP: enter life / ES (and res) to see max hits.</span>';
}
