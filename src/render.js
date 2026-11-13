/* ---------- Rendering ---------- */
function renderHeader() {
  const c = C();
  const cl = clearedIdx();
  $('hdrSummary').textContent = `${c.name || 'unnamed'} · ${c.build} · lvl ${c.level} · ${c.alive ? (cl >= 0 ? 'cleared to T' + maxTierCleared() : 'campaign') : 'DEAD'}${c.campaign.start && isPaused() ? ' · ⏸ PAUSED' : ''}`;
}
function renderClock() {
  $('hdrClock').textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
function renderPace() {
  const camp = C().campaign;
  $('paceStart').classList.toggle('hidden', !!camp.start);
  $('paceLive').classList.toggle('hidden', !camp.start);
  for (const b of $('paceSel').children) b.classList.toggle('on', b.dataset.p === S.pace);
  if (!camp.start) { $('paceSub').textContent = 'not started'; return; }
  const p = paceInfo();
  $('paceSub').textContent = `started ${fmtDay(camp.start)}`;
  $('btnNextMs').textContent = p.next ? p.next.btn : 'Campaign complete';
  $('btnNextMs').disabled = !p.next;
  $('btnUndoMs').disabled = !p.k;
  $('curLabel').textContent = p.next ? `Now: ${p.next.label}` : 'Campaign complete';
  if (p.next) {
    const st = nextStop(p.k);
    $('nextGate').innerHTML = `<b>Gate before moving on:</b> ${esc(p.next.gate)}${p.next.risk ? `<br><span class="warn">⚠ ${esc(p.next.risk)}</span>` : ''}<br><span class="dim">Target ${fmtClock(wallAt(p.next[S.pace]))} · pure split ${p.next.split} min</span>`;
    $('nextStop').innerHTML = st ? `<b>${esc(st.stop.title)}</b> <span class="dim">(after ${esc(st.ms.label)}, ≤ ${STOP_BUDGET[S.pace]} min)</span><ul style="margin:4px 0 0;padding-left:18px">${st.stop.todo.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '<span class="dim">No more fixed stops.</span>';
    $('nextStop').classList.remove('hidden');
  } else { $('nextGate').innerHTML = 'Campaign done. Use the Defense panel before white maps.'; $('nextStop').classList.add('hidden'); }
  $('msTable').innerHTML = '<tr><th>#</th><th>Checkpoint</th><th class="n">6h</th><th class="n">7h</th><th class="n">8h</th><th class="n">Actual</th><th class="n">Δ ' + S.pace.slice(1) + 'h</th></tr>' +
    MILESTONES.map((m, i) => {
      const d = camp.done[m.id];
      const act = d ? activeMs(d) / MIN : null;
      return `<tr class="${d ? 'done' : i === p.k ? 'cur' : ''}"><td>${m.id}</td><td>${esc(m.label)}${m.stop ? ` · <b>Stop ${m.stop}</b>` : ''}</td>` +
        ['t6', 't7', 't8'].map((k) => `<td class="n">${fmtClock(d ? camp.start + m[k] * MIN + pausedMs(d) : wallAt(m[k]))}</td>`).join('') +
        `<td class="n">${d ? fmtClock(d) : ''}</td><td class="n">${d ? fmtDelta(act - m[S.pace]) : ''}</td></tr>`;
    }).join('');
  tickPace(p);
}
function tickPace(p = paceInfo()) {
  if (!p) return;
  const camp = C().campaign; void camp;
  const pz = isPaused();
  $('pauseBanner').classList.toggle('hidden', !pz);
  $('pace').classList.toggle('paused', pz);
  $('btnPause').textContent = pz ? '▶ Resume' : '⏸ Pause';
  $('btnPause').classList.toggle('pri', pz);
  if (pz) { const from = pauses().at(-1).from; $('pauseBanner').innerHTML = `⏸ PAUSED since ${fmtClock(from)} · ${fmtDur(now() - from)} not counted <span class="dim">(say “resume” or press Resume)</span>`; }
  const totalP = pausedMs();
  $('pauseTotal').textContent = totalP ? `paused ${fmtDur(totalP)} total, excluded` : '';
  $('kpis').innerHTML = ['t6', 't7', 't8'].map((k) => `<div class="kpi${k === S.pace ? ' sel' : ''}"><b>${PACE_NAMES[k]}</b><span>${fmtDelta(p.deltas[k])}</span><div class="dim">Kitava by ${fmtClock(wallAt(MILESTONES[KITAVA_IDX][k]))}</div></div>`).join('');
  $('elapsed').textContent = fmtDur(p.elapsed * MIN);
  $('projKitava').textContent = C().campaign.done.M13 ? `Kitava down at ${fmtClock(C().campaign.done.M13)}` : p.projKitava ? `Projected Kitava ${fmtClock(p.projKitava)}` : '';
  if (!p.seg) { $('segTimer').textContent = '—'; $('segTarget').textContent = ''; return; }
  const tgt = p.seg.target * MIN, el = p.seg.elapsed;
  $('segTimer').textContent = fmtDur(el);
  $('segTimer').className = 'timer ' + (el > tgt ? 'bad' : el > tgt * 0.85 ? 'warn' : 'ok');
  $('segTarget').textContent = `target ${p.seg.target} min (${PACE_NAMES[S.pace]}) · ${el > tgt ? fmtDur(el - tgt) + ' over' : fmtDur(tgt - el) + ' left'}`;
  const bar = $('segBar');
  bar.style.width = Math.min(100, (el / Math.max(tgt, 1)) * 100) + '%';
  bar.style.background = el > tgt ? 'var(--bad)' : el > tgt * 0.85 ? 'var(--warn)' : 'var(--ok)';
}
function renderLog() {
  const c = C();
  const open = [];
  for (const e of S.log) {
    if (e.char !== c.created) continue;
    for (const id of e.ids) if (trigById[id] && !e.acked.includes(id)) open.push([trigById[id], e]);
  }
  open.sort((a, b) => a[0].priority - b[0].priority || b[1].ts - a[1].ts);
  $('openCount').textContent = open.length ? `${open.length} open` : 'none';
  $('openActions').innerHTML = open.length ? open.slice(0, 12).map(([t, e]) => triggerCard(t, e)).join('') : '<div class="dim">Nothing pending.</div>';
  $('logList').innerHTML = S.log.slice(0, 200).map((e) => `<div class="logitem"><time>${fmtDay(e.ts)}</time><span class="t">${esc(e.text)}${e.sameIncident ? ' <span class="badge">same incident</span>' : ''}${e.kind === 'research' ? researchExtra(e) : ''} ${e.ids.map((id) => `<span class="badge p${trigById[id]?.priority || 3}">${esc(id)}</span>`).join('')}${e.char !== c.created ? ' <span class="dim">(prev char)</span>' : ''}</span><span class="badge">${esc(e.kind)}</span><button class="sm ghost" data-del="${e.id}" title="Delete entry">×</button></div>`).join('') || '<div class="dim">No entries yet.</div>';
}
function researchExtra(e) {
  const link = e.url ? ` <a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.title || 'poewiki')}</a>` : '';
  const src = e.source ? ` <span class="badge">${esc(e.source)}</span>` : '';
  const more = e.full ? `<details class="rfull"><summary>full answer</summary><div>${esc(e.full).replace(/\n/g, '<br>')}</div></details>` : '';
  return link + src + (e.note ? ` <span class="dim">${esc(e.note)}</span>` : '') + more;
}
function renderDefense() {
  const c = C(), d = c.def;
  const setv = (id, v) => { const el = $(id); if (document.activeElement !== el) el.value = v ?? ''; };
  setv('dLevel', c.level); setv('dChaos', d.chaos); setv('dPool', d.pool); setv('dAblock', d.ablock); setv('dBlock', d.block);
  const pt = poolTarget(), pl = d.pool;
  $('dPool').classList.toggle('pool-ok', pl != null && pl > pt.v); $('dPool').classList.toggle('pool-amber', pl != null && pl <= pt.v && pl >= pt.v * 0.75); $('dPool').classList.toggle('pool-bad', pl != null && pl < pt.v * 0.75);
  $('poolTarget').innerHTML = `<span class="${pl == null ? 'dim' : pl > pt.v ? 'ok' : pl >= pt.v * 0.75 ? 'warn' : 'bad'}">target &gt; ${pt.v}</span> <span class="dim">(${esc(pt.why)})</span>`;
  setv('dFire', d.fire); setv('dCold', d.cold); setv('dLight', d.lightning); setv('dLife', d.life); setv('dEs', d.es);
  for (const [id, k] of [['dFire', 'fire'], ['dCold', 'cold'], ['dLight', 'lightning']]) $(id).classList.toggle('lowres', d[k] != null && d[k] < 75);
  const pen = kitavaPen();
  $('kitPen').innerHTML = `Kitava penalty: <b>${pen ? '−' + pen + '% all ele res' : 'none yet'}</b> <span class="dim">${pen === 30 ? '(A5 done; A10 adds another −30)' : pen === 60 ? '(A5 + A10)' : '(−30 after A5, −60 after A10)'} · enter the in-game numbers, they already include it</span>` +
    (d.resStale ? `<div class="bad">⚠ Your res was entered before the Kitava penalty (−${pen}). Re-enter it: dictate or press ${esc((VOICE.ocrKey || 'F10').toUpperCase())} on the Defences tab.</div>` : '') +
    (d.uncapped && Object.keys(d.uncapped).length ? `<div class="dim">Uncapped: ${ELE.filter((k) => d.uncapped[k] != null).map((k) => k + ' ' + d.uncapped[k]).join(' · ')}</div>` : '');
  const ob = $('ocrBox'), pend = S.ocrPending;
  if (pend) {
    ob.classList.remove('hidden');
    ob.innerHTML = `<b>Screenshot read</b> <span class="dim">(${esc(pend.source || '?')}${pend.engine ? ', ' + esc(pend.engine) : ''})</span><div>${Object.entries(pend.fields).map(([k, v]) => `<span class="badge">${esc(OCR_NAMES[k] || k)} ${v}</span>`).join(' ')}</div>${pend.partial ? '<div class="warn">⚠ Looks incomplete: only ' + Object.keys(pend.fields).length + ' values. Is the Defences tab open?</div>' : ''}<div class="row"><button class="pri sm" id="btnOcrApply">Apply</button><button class="sm ghost" id="btnOcrDiscard">Discard</button><span class="dim">or say “confirm” / “discard”</span></div>`;
  } else if (!/Reading|failed|Offence tab|Defences/.test(ob.textContent)) ob.classList.add('hidden');
  $('dEle').checked = d.ele; $('dOver').checked = d.over;
  $('defUpdated').textContent = d.updated ? 'updated ' + fmtDay(d.updated) : 'not entered yet';
  const cl = clearedIdx();
  const bar = barMode();
  $('clearedFor').innerHTML = cl < 0 ? '<span class="bad">Not cleared for maps yet</span>' : `<span class="ok">Cleared for ${esc(GATES[cl].band)}</span> <span class="dim">· Fate cap ${GATES[Math.min(cl, 2)].fateCap} · ${bar} bar</span>`;
  $('gateList').innerHTML = GATES.map((g) => { const r = gateCheck(g); return `<div class="g${r.pass ? ' pass' : ''}"><span><b>${esc(g.name)}</b> <span class="dim">${esc(g.band)}</span></span><span class="why">${r.pass ? '✔ met' : esc(r.fails.join(' · '))}</span></div>`; }).join('');
}
function renderNext() {
  for (const b of $('budgetSel').children) b.classList.toggle('on', +b.dataset.b === S.budget);
  const tasks = buildTasks(S.budget);
  $('taskList').innerHTML = tasks.map((t) => `<div class="task p${t.prio}"><span class="m">${t.mins ? t.mins + 'm' : 'now'}</span><div class="b"><b>${esc(t.title)}</b><span class="dim">${esc(t.detail)}</span></div>${t.chunk ? `<button class="sm" data-chunk="${t.chunk}">Done</button>` : ''}</div>`).join('') || '<div class="dim">Nothing to suggest. Log something or start the timer.</div>';
}
function renderChar() {
  const c = C();
  $('cBuild').value = c.build;
  if (document.activeElement !== $('cName')) $('cName').value = c.name;
  $('cStatus').innerHTML = c.alive ? '<span class="ok">alive</span>' : '<span class="bad">dead</span>';
  const doc = trigDoc();
  $('trigInfo').textContent = `Triggers: ${doc.triggers.length} (${S.triggers ? 'imported' : 'embedded'}, updated ${doc.updated || '?'})`;
  $('histTable').innerHTML = S.history.length ? '<tr><th>Name</th><th>Build</th><th class="n">Lvl</th><th>Status</th><th>Started</th></tr>' + S.history.map((h) => `<tr><td>${esc(h.name || 'unnamed')}</td><td>${esc(h.build)}</td><td class="n">${h.level}</td><td>${h.alive ? 'retired' : 'died'}</td><td>${fmtDay(h.created)}</td></tr>`).join('') : '<tr><td class="dim">None.</td></tr>';
}
function renderSuggest() {
  const items = new Set([...DROP_SUGGEST, ...trigDoc().triggers.filter((t) => t.type === 'drop').map((t) => t.item)]);
  // v4: no quick buttons (drops and events are reported by voice); the manager's manual box suggests types + items
  $('logSuggest').innerHTML = [...new Set([...types().map((t) => t.name), ...items, ...EVENTS.map((e) => e.label)])].map((v) => `<option value="${esc(v)}">`).join('');
}
function renderAll() {
  renderHeader(); renderClock(); renderPace(); renderNext(); renderLog(); renderDefense(); renderLinks(); renderBosses(); renderChar(); renderVoice(); renderTypes(); renderChase();
}
