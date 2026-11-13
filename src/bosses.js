/* ---------- Fate bosses: Wickerman (viscera) reward + added danger for the current act ----------
   Data: FATE_DATA (snapshot embedded at build time from voice/cache/fates.json), refreshed from the companion's /api/fates
   (poewiki "Viscera" for boss -> viscera, poedb "Wickerman" for the mods, poewiki "Fate" for what each Fate card adds). */
let FATES = typeof FATE_DATA !== 'undefined' ? FATE_DATA : { bosses: {}, fates: {} };
const UNKNOWN = 'currently unknown';
async function refreshFates() {
  if (!VOICE.served) return;
  try { const d = await (await fetch('/api/fates')).json(); if (d && d.bosses && Object.keys(d.bosses).length) { FATES = d; renderBosses(); } } catch (e) { /* offline: keep the snapshot */ }
}
const bossList = () => Object.values(FATES.bosses || {});
function bossesForAct(act) { return bossList().filter((b) => b.act === act); }
function findBoss(text) {
  const q = norm(text).replace(/^\s*the /, ' ').trim(); if (!q) return null;
  const camp = curAct() <= 10;
  let best = null, bs = 0;
  for (const b of bossList()) {
    const full = norm(b.boss).trim(), head = norm(b.boss.split(',')[0]).trim(), ws = ` ${full} `;
    let sc = full === q ? 100 : head === q ? 90 : head.startsWith(q + ' ') ? 80 : full.startsWith(q) ? 70 : ws.includes(` ${q} `) ? 50 : 0;
    if (!sc) { const qs = q.split(' ').filter((w) => w.length > 2); if (qs.length && qs.every((w) => ws.includes(' ' + w.slice(0, Math.max(3, w.length - 1))))) sc = 30; }
    if (!sc && q.length >= 4) {   // v4: Whisper spellings ("mervail", "dominous"): edit-distance on the first name
      const r = Math.max(levRatio(q, head), levRatio(q, head.replace(/^the /, '')), ...head.split(' ').filter((w) => w.length > 3).map((w) => levRatio(q, w) - 0.05));
      if (r >= 0.72) sc = Math.round(20 * r);
    }
    if (!sc) continue;
    if (b.act && camp) sc += 5;                       // in the campaign prefer the campaign version (Merveil, the Siren over the Returned)
    if (b.act === curAct()) sc += 3;
    if (sc > bs) { bs = sc; best = b; }
  }
  return best;
}
function visceraText(v) { return `${v.tier === 'Normal' ? '' : v.tier + ' '}${v.name.replace(/^(Lesser|Greater) /, '')}: ${v.reward || UNKNOWN}`; }
function bossAnswer(q) {
  const camp = curAct() <= 10;
  if (!q.boss) {
    const bs = camp ? bossesForAct(curAct()) : [];
    if (!bs.length) return { say: camp ? `No Fate bosses listed for Act ${curAct()} yet.` : 'Say the boss name: fate reward for, then the boss.', level: 'unknown' };
    S.bossOpen = null; save();
    return { say: `Act ${curAct()} Fate bosses: ${bs.map((b) => b.boss.split(',')[0]).join(', ')}. Ask for one by name.` };
  }
  const b = findBoss(q.boss);
  if (!b) return { say: `I have no Fate data for ${q.boss}. ${UNKNOWN[0].toUpperCase() + UNKNOWN.slice(1)}.`, level: 'unknown' };
  S.bossOpen = b.boss; save(); renderBosses(); scrollToBoss(b.boss);
  if (q.open) {   // v4 "fate boss Merveil": short readback, the open card has every tier
    const v = b.viscera.find((x) => x.tier === 'Normal') || b.viscera[0];
    return { say: `${b.boss.split(',')[0]}${b.act ? ', Act ' + b.act : ''}, ${b.area || 'area unknown'}. ${v ? visceraText(v) : 'Wickerman reward ' + UNKNOWN}. Opened in the Fate panel.`.replace(/\s+/g, ' ') };
  }
  const vs = b.viscera.filter((v) => v.tier !== 'Greater' || !camp);
  const known = vs.filter((v) => v.reward);
  const rew = known.length ? known.map(visceraText).join('; ') : 'Wickerman reward ' + UNKNOWN;
  return { say: `${b.boss.split(',')[0]}${b.act ? ', Act ' + b.act : ''}, ${b.area || 'area unknown'}. ${rew}. Added danger depends on the Fates you pick; boss-specific changes ${UNKNOWN}.`.replace(/\s+/g, ' ') };
}
/* v4: "fate boss X" highlights the card and scrolls to it; done after the last re-render of this command */
let BOSSFX = null;
function scrollToBoss(name) { BOSSFX = { name, until: now() + 2500, scroll: true }; renderBosses(); }
function bossFx() {
  if (!BOSSFX || now() > BOSSFX.until) return;
  const el = [...document.querySelectorAll('#bossList .boss')].find((x) => x.dataset.boss === BOSSFX.name); if (!el) return;
  el.classList.add('hl');
  if (BOSSFX.scroll) {
    BOSSFX.scroll = false;
    requestAnimationFrame(() => {
      const e2 = [...document.querySelectorAll('#bossList .boss')].find((x) => x.dataset.boss === BOSSFX.name) || el;
      const list = $('bossList'); list.scrollTop = Math.max(0, e2.offsetTop - list.offsetTop - 4);
      e2.scrollIntoView({ block: 'nearest' });
    });
  }
}
function killsOf(name) {
  const key = norm(name.split(',')[0]);
  return C().kills.filter((k) => norm(k.boss).trim() && (key.includes(norm(k.boss)) || norm(k.boss).includes(key)));
}
function bossCard(b, open) {
  const ks = killsOf(b.boss), camp = curAct() <= 10;
  const head = `<div class="bh" title="Click for rewards, danger and the kill log"><b>${esc(b.boss)}</b> <span class="dim">${esc(b.area || '')}</span>${ks.length ? ` <span class="badge met">killed ×${ks.length} (${ks.map((k) => k.fates).join('/')} Fates)</span>` : ''}<span class="chev">${open ? '▾' : '▸'}</span></div>`;
  if (!open) {   // one line: the normal-tier reward (what a campaign kill gives)
    const v = b.viscera.find((x) => x.tier === 'Normal') || b.viscera[0];
    return `<div class="boss" data-boss="${esc(b.boss)}">${head}<div class="bline ${v && v.reward ? '' : 'dim'}">${v ? esc(visceraText(v)) : 'Wickerman reward: ' + UNKNOWN}</div></div>`;
  }
  const vs = b.viscera;   // open card: every tier (Greater = the map version)
  return `<div class="boss open" data-boss="${esc(b.boss)}">${head}
    <div class="bv">${vs.map((v) => `<div><span class="badge">${esc(v.slot || '?')}</span> <span class="${v.reward ? '' : 'dim'}">${esc(visceraText(v))}</span>${v.queen ? ` <span class="dim">· Coven Queen: ${esc(v.queen)}</span>` : ''}</div>`).join('') || `<div class="dim">Wickerman reward: ${UNKNOWN}</div>`}</div>
    <div class="dim small">Added danger: depends on the Fate cards you pick (up to 3; see the list below). Boss-specific changes: ${UNKNOWN}.</div>
    <div class="row bk"><span class="dim">Killed with</span>${[0, 1, 2, 3].map((n) => `<button class="sm" data-bkill="${n}">${n}</button>`).join('')}<span class="dim">Fates</span></div></div>`;
}
function renderBosses() {
  const el = $('bossList'); if (!el) return;
  const c = C(), act = curAct();
  const open = S.bossOpen ? findBoss(S.bossOpen) : null;
  const list = act <= 10 ? bossesForAct(act) : [];
  $('bossSub').textContent = act <= 10 ? `Act ${act} · ${list.length} Fate boss${list.length === 1 ? '' : 'es'}` : 'Maps: search a boss';
  const shown = open && !list.includes(open) ? [open, ...list] : list;
  el.innerHTML = shown.length ? shown.map((b) => bossCard(b, open === b || shown.length === 1)).join('') : `<div class="dim">${act <= 10 ? 'No Fate boss data for this act: ' + UNKNOWN + '.' : 'Type a map boss name above.'}</div>`;
  bossFx();
  $('bossSuggest').innerHTML = bossList().map((b) => `<option value="${esc(b.boss)}">`).join('');
  const f = FATES.fates || {};
  $('fateCards').innerHTML = Object.entries(f).map(([k, v]) => `<tr><td><b>${esc(k)}</b></td><td>${esc(v.long || v.short || UNKNOWN)}${v.empower ? `<div class="dim">Empowered: ${esc(v.empower)}${v.duplicate ? ' · duplicate: ' + esc(v.duplicate) : ''}</div>` : ''}</td></tr>`).join('');
  $('fateSrc').innerHTML = FATES.fetched ? `Data ${esc(String(FATES.fetched).slice(0, 16).replace('T', ' '))} · <a href="https://www.poewiki.net/wiki/Viscera" target="_blank" rel="noopener">poewiki Viscera</a> · <a href="https://poedb.tw/us/Wickerman" target="_blank" rel="noopener">poedb Wickerman</a>` : 'No Fate data snapshot.';
  $('killCount').textContent = c.kills.length;
  $('killTable').innerHTML = c.kills.length ? '<tr><th>Boss</th><th>Content</th><th class="n">Fates</th><th>When</th><th></th></tr>' + c.kills.map((k, i) => `<tr><td>${esc(k.boss)}</td><td>${esc(k.content)}</td><td class="n">${k.fates}</td><td>${fmtDay(k.ts)}</td><td><button class="sm ghost" data-delkill="${i}">×</button></td></tr>`).join('') : '<tr><td class="dim">None yet.</td></tr>';
  $('fCampaign').checked = !!S.fates.campaignOk;
}
