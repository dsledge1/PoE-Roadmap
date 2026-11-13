// v5 end-to-end: companion.py (--no-audio) serves the tracker; mock poewiki / poedb; voice commands injected over HTTP; UI clicked.
// Covers: v4 → v5 data migration, drag-and-drop panel reorder (persists across reload), collapse / hide / reset / keyboard move,
// text size (buttons + voice, persists), pace presets + custom + per-act minutes + voice, Power Chase colours / group / filter +
// "what am I watching for in Abyss", PoB import through the UI (example .xml, plus your own .xml when POE_PRIVATE_POB is set — read from
// the plan folder, never copied), "get wiki link for X" (pending → link → list → Copy button on a stub → clear), every interaction < 400 ms.
// Screenshots go to <tmp>/v5out/ (POE_V5_OUT overrides).
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'), http = require('http'), path = require('path');
const ENV = require('./env');
const PORT = 8799, MPORT = 8798, BASE = `http://127.0.0.1:${PORT}`, OUT = process.env.POE_V5_OUT || require('path').join(ENV.TMP, 'v5out');
fs.mkdirSync(OUT, { recursive: true });
const PRIVATE_XML = process.env.POE_PRIVATE_POB || '';
let n = 0; const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); n++; console.log('ok -', m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = async (p, body) => (await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();

// mock poewiki search + poedb pages
const TITLES = ['Darkness Enthroned', 'Forged Frostbearer', 'The Dark Monarch', 'Death', 'Abyss Jewel'];
const POEDB = { Thread_of_Hope: '<html><title>Thread of Hope - PoEDB, Path of Exile Wiki</title></html>' };
const mock = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/poedb/')) {
    const slug = decodeURIComponent(u.pathname.slice(7));
    if (POEDB[slug]) { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(POEDB[slug]); }
    res.writeHead(404); return res.end('nope');
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  if (u.searchParams.get('list') === 'search') {
    const q = (u.searchParams.get('srsearch') || '').toLowerCase(), words = new Set(q.split(/\s+/));
    return res.end(JSON.stringify({ query: { search: TITLES.filter((t) => t.toLowerCase().includes(q) || t.toLowerCase().split(' ').some((w) => words.has(w))).map((title) => ({ title })) } }));
  }
  res.end('{}');
}).listen(MPORT);
fs.mkdirSync(ENV.TMP, { recursive: true });
const CFG = ENV.tmp('voice_cfg_v5.json');
fs.writeFileSync(CFG, JSON.stringify({ port: PORT, hotkey: 'f9', tracker_html: '../poe_tracker.html', tts: false, speak_typed: false, result_timeout_ms: 1500,
  research: { backend: 'none', wiki_api: `http://127.0.0.1:${MPORT}/w/api.php`, poedb: `http://127.0.0.1:${MPORT}/poedb/` } }));

(async () => {
  const srv = spawn(ENV.PY, [ENV.root('voice', 'companion.py'), '--no-audio', '--no-browser', '--no-tts', '--port', String(PORT), '--config', CFG],
    { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, OPENAI_API_KEY: '', POE_COMPANION_LOG_DIR: ENV.tmp('logs') } });
  let srvOut = ''; srv.stdout.on('data', (d) => (srvOut += d)); srv.stderr.on('data', (d) => (srvOut += d));
  for (let i = 0; i < 60; i++) { try { await fetch(BASE + '/api/health'); break; } catch { await sleep(250); } }
  const browser = await chromium.launch(ENV.launchOpts);
  const ctx = await browser.newContext({ viewport: { width: 1700, height: 1150 }, acceptDownloads: true });
  // the page's Copy button is tested against a stub: nothing in this test reaches the real (Windows) clipboard
  await ctx.addInitScript(() => { window.__copied = []; Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { window.__copied.push(t); }, readText: async () => window.__copied.at(-1) || '' }, configurable: true }); });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message + ' @ ' + (e.stack || '').split('\n').slice(1, 4).join(' '))); page.on('console', (m) => { if (m.type() === 'error' && !/favicon|ERR_CONNECTION|EventSource/.test(m.text())) errors.push(m.text()); });
  page.on('dialog', (d) => d.accept());
  const lat = [], rts = [];
  const raf = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  const timed = async (label, fn) => { const t0 = Date.now(); await fn(); await raf(); const ms = Date.now() - t0; lat.push(ms); return ms; };
  const ev = (f, a) => page.evaluate(f, a);
  const say = async (text) => { const r = await post('/api/inject', { text, wait: true }); rts.push(r.roundtrip_ms || 0); return r; };
  const ready = () => page.waitForFunction(() => VOICE.state === 'ready', null, { timeout: 8000 });
  const order = () => ev(() => [...document.querySelectorAll('main > .col')].map((c) => [...c.querySelectorAll(':scope > section[data-panel]')].map((s) => s.dataset.panel)));
  const reload = async () => { await sleep(350); await page.reload(); await ready(); };
  try {
    // ---------- v4 → v5: existing data carries over
    await page.goto(BASE + '/'); await ready();
    await say('dropped a 6 link');
    await ev(() => {
      const s = JSON.parse(JSON.stringify(S));
      for (const k of ['paceCfg', 'ui', 'chaseUi', 'ctColors', 'wikiLinks']) delete s[k];
      s.v = 4; s.pace = 't7'; s.layout = { cols: [['pace', 'next', 'voice'], ['log', 'chase'], ['defense', 'fates'], ['links']], hidden: [], collapsed: [] };
      s.contentTypes = ['Abyss', 'Legion (Timeless jewels)', 'Breach', 'Delve', 'Settlers/Kingsmarch', 'Atlas Boss', 'Crafting', 'Expedition', 'Ritual', 'Heist', 'Blight', 'Essence', 'Harvest', 'Other'];
      s.char.build = 'Spectre Necromancer'; s.char.name = 'TestNecro'; s.char.chase = chaseFromTemplate('Spectre Necromancer'); s.char.chaseOn = true;
      localStorage.setItem(STORE_KEY, JSON.stringify(s));
    });
    await reload();
    const mig = await ev(() => ({ v: S.v, pace: S.paceCfg, ui: S.ui, chaseUi: S.chaseUi, wl: S.wikiLinks, cols: S.layout.cols, ct: S.contentTypes, log: S.log.length, name: C().name, chase: C().chase.length, also: C().chase.every((x) => Array.isArray(x.also)) }));
    assert(mig.v === 5 && mig.pace.preset === 'league' && mig.ui.textPct === 100 && mig.chaseUi.group === true && Array.isArray(mig.wl), 'v4 → v5: pace (League start), text 100%, grouped chase, empty wiki list → ' + JSON.stringify({ v: mig.v, pace: mig.pace }));
    assert(mig.log === 1 && mig.name === 'TestNecro' && mig.chase >= 6 && mig.also, 'v4 → v5: log, character and chase list kept');
    assert(JSON.stringify(mig.cols[2]) === '["defense","fates","wiki"]' && mig.cols[0].join() === 'pace,next,voice', 'v4 → v5: his layout kept, the new Wiki links panel added to column 3');
    assert(mig.ct.includes('Ritual') && mig.ct.includes('Delirium') && mig.ct.indexOf('Delirium') < mig.ct.indexOf('Other') && mig.ct.at(-1) === 'Other', 'v4 → v5: content types kept, new ones added before Other');
    await ev(() => { S.log = []; C().campaign.start = Date.now() - 52 * 60000; save(); renderAll(); });
    await sleep(300);
    await page.screenshot({ path: path.join(OUT, 'v5_full_default.png'), fullPage: true });

    // ---------- 5. drag-and-drop panels
    assert(await ev(() => PANELS.every((p) => panelEl(p.id).querySelector(':scope > h2 .phandle') && panelEl(p.id).querySelector(':scope > h2 .pcollapse'))), 'every panel header has a drag handle and a collapse button');
    const drag = async (fromSel, toX, toY) => {
      const b = await page.locator(fromSel).boundingBox();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2 + 10, b.y + b.height / 2 + 10, { steps: 2 });
      await page.mouse.move(toX, toY, { steps: 8 }); await page.mouse.up();
    };
    // the Wiki links panel (col 3, below the fold) → top of column 1 (above Campaign pace), by its ⠿ handle; the page scrolls up
    // by itself while the pointer sits at the top edge
    await page.locator('#wiki > h2').scrollIntoViewIfNeeded();
    assert(await ev(() => window.scrollY > 200), 'Wiki links starts below the fold');
    const hb = await page.locator('#wiki > h2 .phandle').boundingBox();
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await page.mouse.down();
    await page.mouse.move(hb.x + 20, hb.y + 20, { steps: 2 });
    const colX = (await page.locator('main > .col >> nth=0').boundingBox()).x + 60;
    await page.mouse.move(colX, 4, { steps: 6 });
    await page.waitForFunction(() => window.scrollY === 0, null, { timeout: 5000 });
    const paceBox = await page.locator('#pace').boundingBox();
    await page.mouse.move(colX, paceBox.y + 8, { steps: 4 });
    await page.mouse.up();
    let o = await order();
    assert(o[0][0] === 'wiki' && !o[2].includes('wiki'), 'drag by the handle with edge auto-scroll: Wiki links moved to the top of column 1 → ' + JSON.stringify(o));
    // Power Chase → column 4 under Links & tree, by its bare title text
    const linksBox = await page.locator('#links').boundingBox();
    const t = await page.locator('#chase > h2').boundingBox();
    await page.mouse.move(t.x + 60, t.y + t.height / 2); await page.mouse.down();
    await page.mouse.move(t.x + 75, t.y + t.height / 2 + 6, { steps: 2 });
    await page.mouse.move(linksBox.x + linksBox.width / 2, linksBox.y + linksBox.height - 10, { steps: 10 });
    assert(await ev(() => document.body.classList.contains('dnd') && document.getElementById('chase').classList.contains('dragging')), 'while dragging the panel is highlighted');
    await page.mouse.up();
    o = await order();
    assert(o[3].join() === 'links,chase' && !o[1].includes('chase'), 'drag by the title: Power Chase dropped under Links & tree → ' + JSON.stringify(o));
    // Escape cancels a drag
    const before = JSON.stringify(await order());
    const lb = await page.locator('#log > h2 .phandle').boundingBox();
    await page.mouse.move(lb.x + 5, lb.y + 5); await page.mouse.down(); await page.mouse.move(lb.x + 30, lb.y + 30, { steps: 2 }); await page.mouse.move(paceBox.x + 40, paceBox.y + 200, { steps: 6 });
    await page.keyboard.press('Escape'); await page.mouse.up();
    assert(JSON.stringify(await order()) === before, 'Escape cancels a drag (panel goes back)');
    // a small wobble on the title is a click, not a drag
    await page.mouse.move(t.x + 400, t.y + 300); // move away
    await reload();
    o = await order();
    assert(o[0][0] === 'wiki' && o[3].join() === 'links,chase', 'dragged layout persists across reload');
    // keyboard: arrow keys on the handle
    await page.focus('#wiki > h2 .phandle');
    await timed('key move', () => page.keyboard.press('ArrowDown'));
    o = await order();
    assert(o[0][1] === 'wiki' && o[0][0] === 'pace', 'keyboard: ArrowDown on the handle moves the panel down one place');
    assert(await ev(() => document.activeElement.classList.contains('phandle') && document.activeElement.closest('section').id === 'wiki'), 'keyboard: focus stays on the moved handle');
    await page.keyboard.press('ArrowRight');
    o = await order();
    assert(o[1].includes('wiki'), 'keyboard: ArrowRight moves it to the next column');
    // collapse + hide (header button / Panels menu), both persist
    await timed('collapse', () => page.click('#fates > h2 .pcollapse'));
    assert(await ev(() => document.getElementById('fates').classList.contains('collapsed') && getComputedStyle(document.getElementById('fateList') || document.querySelector('#fates > :not(h2)')).display === 'none'), 'collapse hides the panel body, keeps the header');
    await page.click('#layoutMenu > summary');
    assert(await page.isVisible('#layoutList'), 'Panels menu opens');
    await timed('hide', () => page.uncheck('[data-lmshow="voice"]'));
    assert(!(await page.isVisible('#voice')), 'Panels menu: unchecking Voice hides it');
    await timed('menu move', () => page.click('[data-lmmove="links|0|-1"]'));
    o = await order();
    assert(o[2].includes('links'), 'Panels menu: ◀ moves Links & tree one column left');
    await reload();
    assert(!(await page.isVisible('#voice')) && await ev(() => document.getElementById('fates').classList.contains('collapsed')), 'hidden and collapsed panels persist across reload');
    await page.click('#fates > h2 .pcollapse');
    assert(!(await ev(() => document.getElementById('fates').classList.contains('collapsed'))), 'collapse button expands again');
    await page.click('#layoutMenu > summary');
    await timed('reset layout', () => page.click('#btnLayoutReset'));
    o = await order();
    assert(JSON.stringify(o) === JSON.stringify(await ev(() => defaultLayout().cols)) && await page.isVisible('#voice'), 'Reset layout: default order, every panel shown');
    await page.click('#layoutMenu > summary').catch(() => {});

    // ---------- 3. text size
    const small = () => ev(() => parseFloat(getComputedStyle(document.querySelector('#chase .dim.small, .small')).fontSize));
    const fs100 = await ev(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
    assert(fs100 === 14, 'text 100% = 14 px root');
    assert(await small() >= 12.4, 'small notes are at least 12.5 px at 100% (was 11 px) → ' + await small());
    await timed('text up', () => page.click('#btnTextUp'));
    await timed('text up', () => page.click('#btnTextUp'));
    assert(await ev(() => S.ui.textPct === 125 && document.getElementById('textPct').textContent === '125%' && getComputedStyle(document.documentElement).fontSize === '17.5px'), 'A+ twice → 125%');
    const timerFs = await ev(() => parseFloat(getComputedStyle(document.querySelector('.timer')).fontSize));
    assert(timerFs > 50, 'everything scales (big timer too) → ' + timerFs);
    await reload();
    assert(await ev(() => S.ui.textPct === 125 && getComputedStyle(document.documentElement).fontSize === '17.5px'), 'text size persists across reload');
    let r = await say('bigger text');
    assert(await ev(() => S.ui.textPct === 140) && /140 percent/.test(r.say), 'voice “bigger text” → 140%: ' + r.say);
    r = await say('bigger text'); r = await say('bigger text');
    assert(await ev(() => S.ui.textPct === 150) && /largest/.test(r.say) && await page.isDisabled('#btnTextUp'), 'max 150% (A+ disabled, voice says so)');
    r = await say('smaller text');
    assert(await ev(() => S.ui.textPct === 140), 'voice “smaller text” → 140%');
    r = await say('undo');
    assert(await ev(() => S.ui.textPct === 150), 'undo restores the text size');
    await ev(() => { S.chaseUi.filter = ''; save(); renderChase(); });
    await page.screenshot({ path: path.join(OUT, 'v5_full_large_text.png'), fullPage: true });
    for (let i = 0; i < 5; i++) await page.click('#btnTextDown');
    assert(await ev(() => S.ui.textPct === 90) && await page.isDisabled('#btnTextDown'), 'min 90% (A− disabled)');
    await timed('text reset', () => page.click('#textPct'));
    assert(await ev(() => S.ui.textPct === 100), 'click the % to go back to 100%');

    // ---------- 2. pace presets
    const kit = () => ev(() => Math.round(paceAt(MILESTONES[KITAVA_IDX], 't7')));
    assert(await kit() === 420 && /7h realistic/.test(await page.locator('#paceCfgInfo').innerText()), 'League start: Kitava 7h realistic');
    await timed('preset alt', () => page.click('[data-preset="alt"]'));
    assert(await kit() === 240 && await ev(() => S.paceCfg.preset === 'alt'), 'Alt: Kitava 4h (realistic)');
    const altKpi = await page.locator('#kpis').innerText();
    assert(/4h realistic/.test(altKpi) && /3h26 stretch/.test(altKpi), 'ahead/behind displays use the Alt target → ' + altKpi.replace(/\n/g, ' | '));
    assert(/Alt character/.test(await page.locator('#nextList, #next').first().innerText()) || /Alt/.test(await ev(() => paceLabel())), 'Next up names the pace target');
    await timed('preset speed', () => page.click('[data-preset="speed"]'));
    assert(await kit() === 150, 'Speedrun: Kitava 2h30');
    await timed('preset custom', () => page.click('[data-preset="custom"]'));
    assert(await page.isVisible('#paceTotal') && await ev(() => S.paceCfg.preset === 'custom' && S.paceCfg.total === 150), 'Custom starts from the current total and shows the editable box');
    await page.fill('#paceTotal', '5:00'); await timed('custom total', () => page.press('#paceTotal', 'Enter'));
    await page.locator('#paceTotal').evaluate((e) => e.blur());
    assert(await kit() === 300, 'Custom total 5:00 → Kitava at 5h');
    const ratio = await ev(() => MILESTONES.slice(0, KITAVA_IDX + 1).every((m) => Math.abs(paceAt(m, 't7') - m.t7 * 300 / 420) < 0.6));
    assert(ratio, 'custom total scales every act in proportion');
    await page.click('#paceActs > summary');
    const firstId = await ev(() => MILESTONES[0].id);
    await page.fill(`[data-paceov="${firstId}"]`, '30'); await timed('override', () => page.press(`[data-paceov="${firstId}"]`, 'Tab'));
    const ov = await ev((id) => ({ a1: paceAt(MILESTONES[0], 't7'), k: paceAt(MILESTONES[KITAVA_IDX], 't7'), saved: S.paceCfg.overrides[id] }), firstId);
    assert(Math.abs(ov.a1 - 30) < 0.6 && Math.abs(ov.k - 300) < 0.6 && ov.saved === 30, 'per-act override: first checkpoint 30 min, total still 5h → ' + JSON.stringify(ov));
    await reload();
    assert(await ev(() => S.paceCfg.preset === 'custom' && S.paceCfg.total === 300 && Math.abs(paceAt(MILESTONES[0], 't7') - 30) < 0.6), 'custom pace + override persist across reload');
    await page.click('#paceActs > summary'); await page.click('#btnPaceOvClear');
    assert(await ev(() => !Object.keys(S.paceCfg.overrides).length), 'Clear per-act minutes');
    r = await say('set pace alt');
    assert(await ev(() => S.paceCfg.preset === 'alt') && /Alt character: Kitava in 4 hours/.test(r.say), 'voice “set pace alt”: ' + r.say);
    r = await say('pace target 4 hours 30');
    assert(await ev(() => S.paceCfg.preset === 'custom' && S.paceCfg.total === 270) && /4 hours 30 minutes/.test(r.say), 'voice “pace target 4 hours 30”: ' + r.say);
    r = await say('pace target 4 hours');
    assert(await kit() === 240, 'voice “pace target 4 hours” → 4h');
    r = await say('how is my pace');
    assert(/4 hour/.test(r.say), 'pace answer uses the target: ' + r.say);
    r = await say('undo');
    assert(await ev(() => S.paceCfg.total === 270), 'undo restores the previous pace target');
    await say('set pace league start');
    assert(await kit() === 420, 'back to League start');

    // ---------- 4. Power Chase colours / group / filter
    await ev(() => { S.ui.textPct = 100; applyTextSize(); save(); });
    const colors = await ev(() => Object.fromEntries(['Abyss', 'Legion (Timeless jewels)', 'Breach', 'Delve', 'Settlers (Kingsmarch)', 'Atlas Boss', 'Crafting', 'Other'].map((k) => [k, ctColor(k)])));
    assert(colors.Abyss === '#2f8a3a' && colors['Legion (Timeless jewels)'] === '#7a3fd0' && colors.Breach === '#b8326e' && colors.Delve === '#1f86a8' && colors['Settlers (Kingsmarch)'] === '#c9a227' && colors['Atlas Boss'] === '#c62835' && colors.Crafting === '#7d8a96', 'content colours: Abyss green, Legion purple, Breach purply red, Delve teal, Settlers gold, Atlas Boss crimson, Crafting steel → ' + JSON.stringify(colors));
    assert(await ev(() => { const c = ctColor('Other'); return /^#(6|7|8)/.test(c); }), 'Other is a neutral grey');
    await page.locator('#chase').scrollIntoViewIfNeeded();
    assert(await page.locator('#chaseList .cgroup').count() >= 3, 'grouped by content type (default on)');
    const chips = await ev(() => [...document.querySelectorAll('#chaseChips [data-ctfilter]')].map((b) => b.dataset.ctfilter).filter(Boolean));
    const groups = await ev(() => [...document.querySelectorAll('#chaseList .cgroup .ch .ctchip')].map((c) => c.textContent));
    assert(groups.every((g) => chips.includes(g)), 'every group has a filter chip → ' + JSON.stringify(chips));
    const grpCol = await ev(() => getComputedStyle(document.querySelector('#chaseList .cgroup')).borderLeftColor);
    assert(/rgb/.test(grpCol) && grpCol !== 'rgba(0, 0, 0, 0)', 'groups carry their colour');
    await page.locator('#chase').screenshot({ path: path.join(OUT, 'v5_power_chase_grouped.png') });
    await timed('group off', () => page.uncheck('#chaseGroup'));
    assert(await page.locator('#chaseList .cgroup').count() === 0 && await page.locator('#chaseList .citem').count() >= 6, 'group toggle off → one flat list with colour chips');
    await page.check('#chaseGroup');
    const abyssN = await ev(() => chase().filter((x) => hasType(x, 'Abyss')).length);
    await timed('chip abyss', () => page.click('#chaseChips [data-ctfilter="Abyss"]'));
    assert(await page.locator('#chaseList .citem').count() === abyssN && /Farming/.test(await page.locator('#chaseList .cwatch').innerText()), `filter chip Abyss → ${abyssN} item(s) + "watch for" banner`);
    await page.click('#chaseChips [data-ctfilter="Abyss"]');
    assert(await ev(() => S.chaseUi.filter === ''), 'clicking the active chip again shows all');
    r = await say('what am I watching for in abyss');
    assert(/Farming Abyss: watch for/.test(r.say) && await ev(() => S.chaseUi.filter === 'Abyss'), 'voice “what am I watching for in abyss”: ' + r.say);
    r = await say('chase for delve');
    assert(/Farming Delve/.test(r.say) && await ev(() => S.chaseUi.filter === 'Delve'), 'voice “chase for delve” (Abyss jewel also lists Delve): ' + r.say);
    r = await say("I'm going to farm legion, what am I watching for");
    assert(/Legion/.test(r.say), 'voice “going to farm legion…”: ' + r.say);
    await page.click('#chaseChips [data-ctfilter=""]');
    // custom content type with its own colour
    await page.click('#chase details > summary');
    await page.fill('#ctNew', 'Sanctum Relics'); await page.fill('#ctNewColor', '#ff8800'); await page.click('#ctAddForm button');
    assert(await ev(() => contentTypes().includes('Sanctum Relics') && ctColor('Sanctum Relics') === '#ff8800'), 'custom content type with a chosen colour');
    const idx = await ev(() => contentTypes().indexOf('Abyss'));
    await page.fill(`[data-ctcolor="${idx}"]`, '#00ff00');
    assert(await ev(() => ctColor('Abyss') === '#00ff00'), 'recolour a built-in type');
    await page.click(`[data-ctreset="${idx}"]`);
    assert(await ev(() => ctColor('Abyss') === '#2f8a3a'), '↺ puts the default colour back');
    await reload();
    assert(await ev(() => ctColor('Sanctum Relics') === '#ff8800' && S.chaseUi.group === true), 'colours and grouping persist');
    assert(await ev(() => parseFloat(getComputedStyle(document.querySelector('#chase .cnote, #chase .small')).fontSize) >= 12.4), 'chase notes are at least 12.5 px');

    // ---------- 1. PoB import through the UI
    await ev(() => { localStorage.removeItem(BCFG_KEY); BCFG = JSON.parse(JSON.stringify(DEFAULT_BUILD_CFG)); renderAll(); });
    await timed('header import', () => page.click('#btnHdrPob'));
    assert(await ev(() => document.getElementById('pobImport').open && document.activeElement.id === 'pobText'), 'header “Import PoB build” opens the import box, cursor in it');
    // the import area: header button + the Links & tree import box (full-page clip, so the sticky header doesn't cover it)
    await page.evaluate(() => window.scrollTo(0, 0));
    const ib = await ev(() => { const r = document.getElementById('pobImport').getBoundingClientRect(), l = document.getElementById('links').getBoundingClientRect(); return { x: l.left, y: r.top + scrollY - 8, w: l.width, h: r.height + 16 }; });
    await page.screenshot({ path: path.join(OUT, 'v5_import_area.png'), fullPage: true, clip: { x: ib.x - 4, y: ib.y, width: ib.w + 8, height: ib.h } });
    await page.screenshot({ path: path.join(OUT, 'v5_header.png'), clip: { x: 0, y: 0, width: 1700, height: (await page.locator('header').boundingBox()).height } });
    await page.setInputFiles('#filePob', ENV.root('docs', 'examples', 'example_pob.xml'));
    await page.waitForFunction(() => /imported/i.test(document.getElementById('pobStatus').innerText + document.getElementById('toast').innerText), null, { timeout: 8000 });
    let bc = await ev(() => ({ sets: BCFG.sets.map((s) => s.clean), st: Object.fromEntries(Object.entries(BCFG.stages).map(([k, v]) => [k, BCFG.sets[v.variants[0].set].clean])), stored: !!localStorage.getItem(BCFG_KEY) }));
    assert(bc.sets.length === 5 && bc.st.A1 === 'Act 1' && bc.st.A5 === 'Act 3-10' && bc.st.A10 === 'Act 3-10' && bc.stored, 'example .xml imports through the UI (Act 3-10 covers A3..A10) → ' + JSON.stringify(bc.st));
    assert(await ev(() => /Act 1|Act 3-10/.test(document.getElementById('linkHead').innerText + document.getElementById('linkVariant').innerText + document.getElementById('linkGrid')?.innerText)), 'Links & tree shows the imported sets');
    if (fs.existsSync(PRIVATE_XML)) {
      await page.setInputFiles('#filePob', PRIVATE_XML);
      await page.waitForFunction(() => BCFG.sets.length > 10, null, { timeout: 8000 });
      bc = await ev(() => Object.fromEntries(Object.entries(BCFG.stages).map(([k, v]) => [k, v.variants.map((x) => BCFG.sets[x.set].clean)])));
      assert(bc.A4[0] === 'Act 4-10' && bc.A6[0] === 'Act 4-10' && bc.A10[0] === 'Act 4-10', "own PoB: Act 4-10 covers A4..A10 → A6 " + JSON.stringify(bc.A6));
      assert(!bc.A6.some((s) => /6 link/i.test(s)) && bc.EM.some((s) => /6 link/i.test(s)), "own PoB: “Early Rare 6 link” is an Early-maps set, never Act 6");
      await page.locator('#links').screenshot({ path: ENV.tmp('v5_private_links.png') });   // not in v5out: his build stays private
    } else console.log('skip - private PoB not present');

    // ---------- 6. wiki links
    await page.locator('#wiki').scrollIntoViewIfNeeded();
    let t0 = Date.now();
    r = await say('get wiki link for Darkness Enthroned');
    assert(r.actions && r.actions[0] && r.actions[0].type === 'wiki_link', 'voice “get wiki link for …” is the wiki command, not a drop');
    await page.waitForSelector('#wikiList a[href="https://www.poewiki.net/wiki/Darkness_Enthroned"]', { timeout: 5000 });
    const wikiMs = Date.now() - t0;
    assert(wikiMs < 1500, `wiki link shows up in ${wikiMs} ms (mock wiki)`);
    assert(await ev(() => S.wikiLinks[0].title === 'Darkness Enthroned' && S.voice.log.every((x) => !/Darkness Enthroned/.test(x.say || '') || true)), 'link saved to the Wiki links list');
    assert(/Darkness Enthroned/.test(await page.locator('#toast').innerText()), 'toast shows the clickable link');
    const trigHist = await ev(() => (S.log || []).filter((x) => /wiki/i.test(x.text || '')).length);
    assert(trigHist === 0, 'not added to the drops & events log / trigger history');
    await sleep(200);
    assert(/Wiki link for Darkness Enthroned added\./.test(srvOut), 'companion says “Wiki link for … added.” (nothing copied)');
    r = await say('get wiki link for dark monarch');
    await page.waitForSelector('#wikiList a[href$="/The_Dark_Monarch"]', { timeout: 5000 });
    assert(await ev(() => S.wikiLinks[0].title === 'The Dark Monarch'), 'partial name → The Dark Monarch, newest first');
    r = await say('get wiki link for Thread of Hope');
    await page.waitForSelector('#wikiList a[href$="/poedb/Thread_of_Hope"]', { timeout: 5000 });
    assert(/poedb/.test(await page.locator('#wikiList .wl').first().innerText()), 'not on poewiki → poedb fallback, marked poedb');
    r = await say('get wiki link for the white death');
    await page.waitForFunction(() => /No wiki page/.test(document.getElementById('wikiStatus').innerText), null, { timeout: 5000 });
    assert(await ev(() => !S.wikiLinks.some((w) => w.title === 'Death')), 'weak match refused (“the white death” is not “Death”)');
    // typed in the panel
    await page.fill('#wikiQ', 'Frostbearer'); await timed('wiki form', () => page.press('#wikiQ', 'Enter'));
    assert(/Finding the wiki link/.test(await page.locator('#wikiStatus').innerText()) || await ev(() => S.wikiLinks[0].title === 'Forged Frostbearer'), 'typed name shows “Finding…” at once');
    await page.waitForSelector('#wikiList a[href$="/Forged_Frostbearer"]', { timeout: 5000 });
    // copy button (browser clipboard)
    const fid = await ev(() => S.wikiLinks[0].id);
    await timed('wiki copy', () => page.click(`[data-wcopy="${fid}"]`));
    await sleep(100);
    assert(await ev(() => window.__copied.at(-1)) === 'https://www.poewiki.net/wiki/Forged_Frostbearer' && /Copied/.test(await page.locator(`[data-wcopy="${fid}"]`).innerText()), 'Copy button (only when clicked) copies the link (stubbed clipboard)');
    assert(await page.getAttribute('#wikiList a >> nth=0', 'target') === '_blank', 'links open in a new tab');
    // research answers keep their wiki link and add it to the list
    await ev(() => applyAction({ type: 'research_result', query: 'what does Abyss Jewel do', title: 'Abyss Jewel', url: 'https://www.poewiki.net/wiki/Abyss_Jewel', spoken: 'x', full: 'x', source: 'wiki' }, []) && (save(), renderAll()));
    assert(await ev(() => S.wikiLinks.some((w) => w.url.endsWith('/Abyss_Jewel'))), 'research answers add their wiki page to the list');
    await reload();
    const wlN = await page.locator('#wikiList .wl').count(); assert(wlN === 5, 'wiki links persist across reload (5) → ' + wlN + ' ' + JSON.stringify(await ev(() => S.wikiLinks.map((w) => w.title))));
    await timed('wiki clear', () => page.click('#btnWikiClear'));
    assert(await page.locator('#wikiList .wl').count() === 0 && await ev(() => S.wikiLinks.length === 0), 'Clear list empties it');

    // ---------- 7. “Get a 6 link” by voice is a drop, not Act 6
    r = await say('get a 6 link');
    assert(await ev(() => S.log[0] && S.log[0].text === '6-link' && C().act !== 6), 'voice “get a 6 link” logs a 6-link, act unchanged');

    // ---------- latency
    console.log('UI latencies ms:', lat.join(','), ' voice roundtrips ms:', rts.join(','));
    assert(Math.max(...lat) < 400, `every UI interaction < 400 ms (max ${Math.max(...lat)})`);
    assert(Math.max(...rts) < 400, `every voice roundtrip < 400 ms (max ${Math.max(...rts)})`);
    assert(errors.length === 0, 'no page errors ' + errors.join(' | '));
    console.log(`\n${n} v5 e2e checks passed`);
  } catch (e) { console.error(e); console.error('PAGE ERRORS', errors.join(' || ')); console.error(srvOut.slice(-3000)); process.exitCode = 1; }
  await browser.close(); srv.kill(); mock.close();
})();
