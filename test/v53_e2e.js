// v5.3 end-to-end through the companion (--no-audio, hotkey ` as a custom key): the Act 1-2 test phrases on the page —
// "Confirmed." applies a pending screenshot read, lab trials (not the lab) + missed-trial reminder, "no, not normal lab"
// unmarks, "restart timer" + "yes" starts a new run (old run kept), "1 minute paused", wiki-link phrasings, Fate reward
// questions with mangled boss names, area / boss chatter ("Fair Graves is dead" is a boss kill, never a death), EHP.
// Screenshot: <tmp>/v53out/ (POE_V53_OUT overrides).
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'), http = require('http'), path = require('path');
const ENV = require('./env');
const PORT = 8825, MPORT = 8826, BASE = `http://127.0.0.1:${PORT}`, OUT = process.env.POE_V53_OUT || require('path').join(ENV.TMP, 'v53out');
fs.mkdirSync(OUT, { recursive: true });
let n = 0; const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); n++; console.log('ok -', m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = async (p, body) => (await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();

// mock poewiki: word search with plurals stemmed (like the real one: "Frostbearers" finds "Forged Frostbearer"); MOCK.down = offline
const MOCK = { down: false, titles: ['Darkness Enthroned', 'Forged Frostbearer', 'Quicksilver Flask', 'Death'], hits: [] };
const mock = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  MOCK.hits.push(u.searchParams.get('srsearch') || u.pathname);
  if (MOCK.down) { res.writeHead(503); return res.end('down'); }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  if (u.searchParams.get('list') === 'search') {
    const q = (u.searchParams.get('srsearch') || '').toLowerCase(), words = new Set(q.split(/\s+/).map((w) => w.replace(/s$/, '')));
    return res.end(JSON.stringify({ query: { search: MOCK.titles.filter((t) => t.toLowerCase().includes(q) || t.toLowerCase().split(' ').some((w) => words.has(w.replace(/s$/, '')))).map((title) => ({ title })) } }));
  }
  res.end('{}');
}).listen(MPORT);
fs.mkdirSync(ENV.TMP, { recursive: true });
const CFG = ENV.tmp('voice_cfg_v53.json');
fs.writeFileSync(CFG, JSON.stringify({ port: PORT, hotkey: '`', tracker_html: '../poe_tracker.html', tts: false, speak_typed: false, result_timeout_ms: 1500,
  research: { backend: 'none', wiki_api: `http://127.0.0.1:${MPORT}/w/api.php`, poedb: `http://127.0.0.1:${MPORT}/poedb/`, wiki_timeout_s: 2, poedb_timeout_s: 1 } }));

(async () => {
  const srv = spawn(ENV.PY, [ENV.root('voice', 'companion.py'), '--no-audio', '--no-browser', '--no-tts', '--port', String(PORT), '--config', CFG],
    { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, OPENAI_API_KEY: '', POE_COMPANION_LOG_DIR: ENV.tmp('logs') } });
  let srvOut = ''; srv.stdout.on('data', (d) => (srvOut += d)); srv.stderr.on('data', (d) => (srvOut += d));
  for (let i = 0; i < 60; i++) { try { await fetch(BASE + '/api/health'); break; } catch { await sleep(250); } }
  const browser = await chromium.launch(ENV.launchOpts);
  const ctx = await browser.newContext({ viewport: { width: 1700, height: 1150 } });
  await ctx.addInitScript(() => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => {}, readText: async () => '' }, configurable: true }); });
  await ctx.route(/poewiki\.net|poedb\.tw/, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>wiki page</title><h1>wiki page</h1>' }));
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message + ' @ ' + (e.stack || '').split('\n').slice(1, 4).join(' ')));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|ERR_CONNECTION|EventSource/.test(m.text())) errors.push(m.text()); });
  page.on('dialog', (d) => d.accept());
  const lat = [];
  const ev = (f, a) => page.evaluate(f, a);
  const raf = () => ev(() => new Promise((r) => requestAnimationFrame(() => r())));
  // in-page latency: event -> handlers -> next painted frame
  const pdo = async (label, sel, how = 'click', val) => {
    const ms = await ev(([q, h, v]) => new Promise((res) => {
      const el = document.querySelector(q); if (!el) throw new Error('no element ' + q);
      const t = performance.now();
      if (h === 'click') el.click();
      else if (h === 'check') { el.checked = v; el.dispatchEvent(new Event('change', { bubbles: true })); }
      else { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
      requestAnimationFrame(() => setTimeout(() => res(performance.now() - t), 0));
    }), [sel, how, val]);
    lat.push([label, Math.round(ms)]); return ms;
  };
  const txt = (sel) => ev((q) => document.querySelector(q).textContent, sel);
  const say = (text) => post('/api/inject', { text, wait: true });
  const ready = () => page.waitForFunction(() => VOICE.state === 'ready', null, { timeout: 8000 });
  const blur = () => ev(() => document.activeElement && document.activeElement.blur());
  const setDefs = (o) => ev((x) => { for (const [k, v] of Object.entries(x)) setDef(k, v); }, o);
  const sec = async (k) => { await pdo('section ' + k, `[data-cfgsec="${k}"]`); };
  const linkOf = (name) => ev((nm) => { const a = [...document.querySelectorAll('#chase a.clink')].find((x) => x.textContent === nm); return a ? { href: a.href, target: a.target, rel: a.rel } : null; }, name);
  const shotCfg = (f) => page.screenshot({ path: path.join(OUT, f), fullPage: false });
  try {
    await page.goto(BASE + '/'); await ready();
    assert(await ev(() => VOICE.hotkey) === '`' && /`/.test(await txt('#voiceDot')), 'backtick hotkey from config.json still shown: ' + await txt('#voiceDot'));
    await say('start league');
    let r;
    // ---- P1.1 "Confirmed." applies a pending read
    await ev(() => { S.ocrPending = { fields: { life: 296, mana: 236, es: 7 }, uncapped: null, source: 'poe', engine: 'windows', ts: now(), partial: false }; save(); renderDefense(); });
    r = await say('Confirmed.');
    assert(await ev(() => C().def.life === 296 && C().def.es === 7 && !S.ocrPending) && /Applied/.test(r.say || ''), '“Confirmed.” applies the screenshot read: ' + r.say);
    // ---- P1.2 lab trials
    r = await say('Note that I missed the lab trial in the prison.');
    assert(await ev(() => trials().lower_prison.st === 'missed') && /missed/.test(r.say), 'missed trial noted: ' + r.say);
    assert(/Missed lab trial: Lower Prison/.test(await txt('#taskList')), 'Next Up reminds about the missed trial before the lab');
    const k0 = await ev(() => doneCount());
    r = await say('Chamber of Sins. Lab trial done.');
    assert(await ev(() => trials().chamber_of_sins.st === 'done' && !C().campaign.done.M4) && await ev(() => doneCount()) === k0, '“Chamber of Sins. Lab trial done.” marks the trial, not Normal lab: ' + r.say);
    r = await say('normal lab done');
    assert(await ev(() => !!C().campaign.done.M4), 'normal lab done still marks the lab (and skips): ' + r.say);
    r = await say('No, not normal lab, just Chamber of Sends lab trial.');
    assert(await ev(() => !C().campaign.done.M4) && await ev(() => doneCount()) === k0 && /Unmarked Normal lab/.test(r.say || ''), 'correction unmarks Normal lab and what it skipped: ' + r.say);
    r = await say('Normal lab was not done.');
    assert(/isn't marked/.test(r.say || ''), 'second correction: nothing to unmark (not “already done”): ' + r.say);
    // ---- P1.3 timer reset + pluralisation
    await say('Act 1 done.');
    r = await say('Restart timer.');
    assert(/Say yes to reset/.test(r.say || '') && await ev(() => !!C().campaign.done.M1), '“Restart timer.” asks first: ' + r.say);
    const oldStart = await ev(() => C().campaign.start);
    await sleep(20);
    r = await say('yes');
    assert(await ev((o) => C().runs.length === 1 && C().runs[0].start === o && C().campaign.start > o && !Object.keys(C().campaign.done).length && !Object.keys(trials()).length, oldStart), '“yes” starts a new run, old run kept in history: ' + r.say);
    await say('pause timer'); r = await say('start timer');
    assert(/Resumed\. 1 minute paused/.test(r.say || ''), '“1 minute paused” (singular): ' + r.say);
    // ---- P1.4 wiki phrasings
    for (const [t, title] of [['Pull link for Quicksilver flask.', 'Quicksilver Flask'], ['Pull the wiki link for the death card.', 'Death']]) {
      await ev(() => { S.wikiLinks = []; save(); });
      await say(t);
      await page.waitForFunction((tt) => S.wikiLinks.some((w) => w.title === tt), title, { timeout: 8000 });
      assert(true, `“${t}” → Wiki links: ${title}`);
    }
    assert(await ev(() => !S.log.some((l) => /Pull link/i.test(l.text))), 'never logged as a note');
    // ---- P1.5 Fate reward questions
    r = await say("What's the reward for Caliph Headstaver?");
    assert(/Calaf/.test(r.say || ''), 'Caliph Headstaver → Calaf, Headstaver: ' + r.say);
    r = await say('What are the Fate Boss rewards for the Great White Beast?');
    assert(/Great White Beast/.test(r.say || '') && !/s for the/.test(r.say), 'Great White Beast question: ' + r.say);
    r = await say('What fate does Nias give?');
    assert(/didn't catch the boss name/.test(r.say || '') && !/zero Fates/.test(r.say), 'unknown boss: “didn’t catch the boss name”, not “Campaign: zero Fates”: ' + r.say);
    // ---- P2.6 areas / bosses
    r = await say("Okay, we're in submerged passage now.");
    assert(await ev(() => C().area) === 'The Submerged Passage', 'area set: ' + r.say);
    r = await say('Fighting Merveil.');
    assert(await ev(() => /Merveil/.test(S.bossOpen || '')) && /Merveil/.test(r.say), 'fighting Merveil → his Fate card opens: ' + r.say);
    r = await say('Okay, Fair Graves is dead.');
    assert(await ev(() => C().alive && S.log[0].text === 'Boss down: Captain Fairgraves' && S.log[0].kind === 'event') && r.level !== 'p1' && !/Hard-trigger/.test(r.say || ''), '“Fair Graves is dead” → boss kill event, not a death / P1: ' + JSON.stringify(r));
    assert(await ev(() => C().kills.some((k) => /Fairgraves/.test(k.boss))), 'kill recorded for the Fate panel (0 Fates)');
    r = await say('Fadeletus.');
    assert(await ev(() => S.log[0].text === 'Boss down: Fidelitas'), '“Fadeletus.” → Fidelitas down');
    await ev(() => addLog('Okay, Fair Graves is dead.'));
    assert(await ev(() => C().alive), 'typed “Fair Graves is dead” never marks the character dead');
    // ---- P3.8 EHP (hand-calculated)
    const E = (def, on) => ev(([d, o]) => { const c = C(); c.def = Object.assign({ fire: 0, cold: 0, lightning: 0, chaos: 0, ablock: 0, block: 0, armour: null, pdr: null, endurance: 0, ptaken: {}, mom: false, mana: 0, poolManual: false }, d); Object.assign(defProfile().on, { mom: false, endurance: false, ptaken: false, evade: false, suppress: false }, o || {}); const e = ehpCalc(); return e && { ...e.hits, ehp: e.ehp, pool: e.pool }; }, [def, on]);
    const near = (a, b, tol = 0.5) => Math.abs(a - b) <= tol;
    let e = await E({ life: 1000, es: 0, pool: 1000, fire: 75, cold: 75, lightning: 75, chaos: 0 });
    assert(near(e.fire, 4000) && near(e.cold, 4000) && near(e.chaos, 1000) && near(e.phys, 1000) && near(e.ehp, 1818.18, 0.1), 'EHP: 1000 pool, 75/75/75, 0 chaos → fire 4000, chaos 1000, phys 1000, EHP 1818 (1000 ÷ 0.55): ' + JSON.stringify(e));
    e = await E({ life: 1000, es: 0, pool: 1000, armour: 5000 });
    assert(near(e.phys, 1618.03, 0.1), 'armour 5000: max phys hit solves H·(1 − 5000/(5000+5H)) = 1000 → 1618: ' + e.phys);
    e = await E({ life: 1000, es: 0, pool: 1000, endurance: 3 }, { endurance: true });
    assert(near(e.phys, 1136.36, 0.1), '3 endurance charges (12%) → 1000 ÷ 0.88 = 1136: ' + e.phys);
    e = await E({ life: 1000, es: 0, pool: 1000, cold: 75, ptaken: { cold: 20 } }, { ptaken: true });
    assert(near(e.phys, 1176.47, 0.1), '20% phys taken as cold (75% cold res) → 1000 ÷ 0.85 = 1176: ' + e.phys);
    const e0 = await E({ life: 1000, es: 0, pool: 1000, fire: 75, cold: 75, lightning: 75 });
    e = await E({ life: 1000, es: 0, pool: 1000, fire: 75, cold: 75, lightning: 75, ablock: 50, block: 50 });
    assert(near(e.ehp, e0.ehp * 2, 0.5), '50% attack + 50% spell block → EHP doubles: ' + e0.ehp.toFixed(0) + ' → ' + e.ehp.toFixed(0));
    e = await E({ life: 1000, es: 0, pool: 1000, evade: 50, suppress: 100 }, { evade: true, suppress: true });
    const e1 = await E({ life: 1000, es: 0, pool: 1000 });
    assert(near(e.ehp, e1.ehp / (0.5 * 0.5 + 0.5 * 0.5), 0.5), 'evade 50% (attacks) + 100% suppression (spells ×0.5) → avoid factor 0.5: ' + e.ehp.toFixed(0));
    e = await E({ life: 1000, es: 0, pool: 1000, mana: 1000, mom: true }, { mom: true });
    assert(e.pool === 1667 && near(e.chaos, 1667), 'Mind Over Matter pool (1000 life, 1000 mana) → 1667 feeds every max hit');
    // the panel line
    await ev(() => { const c = C(); c.def = Object.assign(c.def, { life: 2400, es: 600, pool: 3000, mana: 600, fire: 76, cold: 75, lightning: 77, chaos: -20, armour: 1500, evasion: 900, ablock: 20, block: 25, ele: true, poolManual: false, mom: false }); Object.assign(defProfile().on, { mom: false, evade: false, suppress: false, endurance: false, ptaken: false }); save(); renderDefense(); });
    const line = await txt('#ehpLine');
    assert(/Max hit: Phys [\d.k]+ · Fire [\d.k]+ · Cold [\d.k]+ · Light [\d.k]+ · Chaos [\d.k]+/.test(line) && /EHP ~[\d.k]+/.test(line), 'Defense panel line: ' + line);
    assert(/approximation/i.test(await ev(() => $('ehpLine').title)) && /A ÷ \(A \+ 5 × H\)/.test(await ev(() => $('ehpLine').title)), 'tooltip cites the formulas and says it is an approximation');
    await pdo('EHP off', '#btnConfigure'); await pdo('stat ehp', '[data-cstat="ehp"]', 'check', false); await pdo('close', '#btnCfgClose');
    assert(await ev(() => $('ehpLine').classList.contains('hidden')), 'EHP can be switched off in Configure');
    await pdo('EHP on', '#btnConfigure'); await pdo('stat ehp', '[data-cstat="ehp"]', 'check', true); await pdo('close', '#btnCfgClose');
    await page.locator('#defense').scrollIntoViewIfNeeded();
    await page.locator('#defense').screenshot({ path: path.join(OUT, 'v53_defense_ehp.png') });
    lat.push(['type life', Math.round(await ev(() => new Promise((res) => { const el = $('dLife'); const t = performance.now(); el.value = '2500'; el.dispatchEvent(new Event('input', { bubbles: true })); requestAnimationFrame(() => setTimeout(() => res(performance.now() - t), 0)); })))]);

    const worst = lat.reduce((m, x) => (x[1] > m[1] ? x : m), ['', 0]);
    console.log('latencies ms:', lat.map((x) => x.join(' ')).join(', '));
    assert(worst[1] < 400, `every interaction < 400 ms (max ${worst[1]} ms: ${worst[0]})`);
    assert(errors.length === 0, 'no page errors ' + errors.join(' | '));
    console.log(`\n${n} v5.3 e2e checks passed`);
  } catch (e) { console.error(e); console.error(srvOut.slice(-1500)); process.exitCode = 1; }
  await browser.close(); srv.kill(); mock.close();
})();
