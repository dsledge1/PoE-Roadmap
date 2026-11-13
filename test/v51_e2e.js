// v5.1 end-to-end through the companion (--no-audio): any PoB imports (levels / mixed / single / named), Links & tree
// follows the character level for level PoBs, voice "next tree" / "show tree Level 60", Edit stage mapping opens where you
// can see it and persists, Maps stage Early / Mid / Late switches and highlights, wiki links are clickable links (never the
// clipboard), readable link colour (WCAG contrast), character level read from a screenshot feeds the level tabs.
// Fixture PoBs: test/fixtures (public builds). Your own PoB can be tested with POE_PRIVATE_POB=path (never copied).
// Screenshots go to <tmp>/v51out/ (POE_V51_OUT overrides).
const { chromium } = require('playwright-core');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs'), http = require('http'), path = require('path');
const ENV = require('./env');
const PORT = 8805, MPORT = 8806, BASE = `http://127.0.0.1:${PORT}`, OUT = process.env.POE_V51_OUT || require('path').join(ENV.TMP, 'v51out');
fs.mkdirSync(OUT, { recursive: true });
const PRIVATE_XML = process.env.POE_PRIVATE_POB || '';
const OCR_PY = [process.env.OCR_PY].find((p) => p && fs.existsSync(p));   // Pillow + rapidocr (optional)
const FIX = (f) => ENV.root('test', 'fixtures', f);
const LEVELS = fs.readFileSync(FIX('levels_hierophant.xml'), 'utf8'), MIXED = fs.readFileSync(FIX('mixed_hierophant.xml'), 'utf8');
let n = 0; const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); n++; console.log('ok -', m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = async (p, body) => (await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
// single tree + single skill set (the levels file with only its first tree, untitled)
let k = 0;
const SINGLE = LEVELS.replace(/<Spec\b[\s\S]*?<\/Spec>/g, (m) => (k++ === 0 ? m.replace(/title="[^"]*"/, '') : '')).replace(/activeSpec="\d+"/, 'activeSpec="1"');
let j = 0; const NAMES = ['Bossing', 'Clear speed', 'Budget'];
const NAMED = LEVELS.replace(/(<Spec\b[^>]*?)title="[^"]*"/g, (m, a) => `${a}title="${NAMES[j++]}"`);

const TITLES = ['Darkness Enthroned', 'Forged Frostbearer'];
const mock = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  res.writeHead(200, { 'Content-Type': 'application/json' });
  if (u.searchParams.get('list') === 'search') {
    const q = (u.searchParams.get('srsearch') || '').toLowerCase();
    return res.end(JSON.stringify({ query: { search: TITLES.filter((t) => t.toLowerCase().includes(q)).map((title) => ({ title })) } }));
  }
  res.end('{}');
}).listen(MPORT);
fs.mkdirSync(ENV.TMP, { recursive: true });
const CFG = ENV.tmp('voice_cfg_v51.json');
fs.writeFileSync(CFG, JSON.stringify({ port: PORT, hotkey: 'f9', tracker_html: '../poe_tracker.html', tts: false, speak_typed: false, result_timeout_ms: 1500, ocr_engine: 'rapidocr',
  research: { backend: 'none', wiki_api: `http://127.0.0.1:${MPORT}/w/api.php`, poedb: `http://127.0.0.1:${MPORT}/poedb/` } }));

// WCAG relative luminance / contrast
const lum = (rgb) => { const c = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const rgbOf = (s) => (s.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);

(async () => {
  const srv = spawn(OCR_PY || ENV.PY, [ENV.root('voice', 'companion.py'), '--no-audio', '--no-browser', '--no-tts', '--port', String(PORT), '--config', CFG],
    { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, OPENAI_API_KEY: '', POE_COMPANION_LOG_DIR: ENV.tmp('logs') } });
  let srvOut = ''; srv.stdout.on('data', (d) => (srvOut += d)); srv.stderr.on('data', (d) => (srvOut += d));
  for (let i = 0; i < 60; i++) { try { await fetch(BASE + '/api/health'); break; } catch { await sleep(250); } }
  const browser = await chromium.launch(ENV.launchOpts);
  const ctx = await browser.newContext({ viewport: { width: 1700, height: 1150 } });
  // nothing in this test may reach the real clipboard: stub it and record any use
  await ctx.addInitScript(() => { window.__copied = []; Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { window.__copied.push(t); }, readText: async () => '' }, configurable: true }); });
  await ctx.route(/poewiki\.net|poedb\.tw/, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>wiki page</title><h1>wiki page</h1>' }));
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message + ' @ ' + (e.stack || '').split('\n').slice(1, 4).join(' '))); page.on('console', (m) => { if (m.type() === 'error' && !/favicon|ERR_CONNECTION|EventSource/.test(m.text())) errors.push(m.text()); });
  page.on('dialog', (d) => d.accept());
  const lat = [];
  const raf = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  // in-page latency: click → handlers → next painted frame (Playwright's own actionability waits are not counted)
  const pclick = async (label, sel) => { const ms = await ev((q) => new Promise((res) => { const el = document.querySelector(q); const t = performance.now(); el.click(); requestAnimationFrame(() => setTimeout(() => res(performance.now() - t), 0)); }), sel); lat.push([label, Math.round(ms)]); return ms; };
  const pselect = async (label, sel, val) => { const ms = await ev(([q, v]) => new Promise((res) => { const el = document.querySelector(q); const t = performance.now(); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); requestAnimationFrame(() => setTimeout(() => res(performance.now() - t), 0)); }), [sel, val]); lat.push([label, Math.round(ms)]); return ms; };
  const timed = async (label, fn) => { const t0 = Date.now(); await fn(); await raf(); const ms = Date.now() - t0; lat.push([label, ms]); return ms; };
  const ev = (f, a) => page.evaluate(f, a);
  const txt = (sel) => page.locator(sel).innerText();
  const say = (text) => post('/api/inject', { text, wait: true });
  const ready = () => page.waitForFunction(() => VOICE.state === 'ready', null, { timeout: 8000 });
  const shown = () => ev(() => stageShown());
  const tabs = () => ev(() => [...document.querySelectorAll('#linkStages [data-lstage]')].filter((b) => b.dataset.lstage).map((b) => b.textContent));
  const importXml = async (name, xml) => {
    await page.click('#btnHdrPob');
    await ev(() => { $('pobStatus').innerText = ''; });   // don't match the previous import's "Imported."
    await page.setInputFiles('#filePob', { name, mimeType: 'text/xml', buffer: Buffer.from(xml) });
    await page.waitForFunction(() => /Imported\./.test(document.getElementById('pobStatus').innerText) || /Import failed/.test(document.getElementById('pobStatus').innerText), null, { timeout: 10000 });
    await ev(() => { $('pobImport').open = false; });
    await raf();
  };
  const shotLinks = (f) => page.locator('#links').screenshot({ path: path.join(OUT, f) });
  try {
    await page.goto(BASE + '/'); await ready();
    await say('start league'); await say('set act 3');
    assert(await ev(() => curAct()) === 3, 'campaign timer running, Act 3');
    const before = await ev(() => ({ cur: $('curLabel').innerText, target: $('segTarget').innerText, tasks: $('taskList').innerText, pace: JSON.stringify(S.paceCfg), act: curAct() }));

    // ---------- Stormburst-style PoB: trees titled by level, one untitled skill set (used to import empty)
    await importXml('Stormburst.xml', LEVELS);
    assert(/Imported\./.test(await page.locator('#pobStatus').textContent()) && !/Import failed/i.test(await page.locator('#pobStatus').textContent()), 'levels PoB imports through the UI → ' + (await page.locator('#pobStatus').textContent()).slice(0, 160));
    assert(await ev(() => BCFG.mode) === 'levels' && JSON.stringify(await tabs()) === JSON.stringify(['Lv 22', 'Lv 60', 'Lv 94']), 'tabs Lv 22 / Lv 60 / Lv 94 → ' + JSON.stringify(await tabs()));
    assert(/tabs by level/.test(await txt('#linkSub')), 'sub line says tabs by level');
    assert((await page.locator('#linkCards .lcard').count()) > 3 && await page.locator('#treeBox svg.treesvg').count() === 1, 'gem cards and the tree draw (no more “no skill set / no passive tree”)');
    await page.fill('#dLevel', '30'); await raf();
    assert(await shown() === 'L22' && /now · level 30/.test(await txt('#linkHead')), 'level 30 → Level 22 tab is “now” → ' + await txt('#linkHead'));
    await timed('dLevel 70', () => page.fill('#dLevel', '70'));
    assert(await shown() === 'L60' && /Level 60/.test(await txt('#linkHead')), 'level 70 → Level 60 tab (highest stage ≤ level)');
    await page.fill('#dLevel', '10'); await raf();
    assert(await shown() === 'L22', 'below the first level → the first tab');
    await page.fill('#dLevel', '70'); await raf();
    await timed('tab Lv 94', () => page.click('#linkStages [data-lstage="L94"]'));
    assert(await shown() === 'L94' && /browsing/.test(await txt('#linkHead')) && /back to level 70/.test(await txt('#linkStages')), 'manual override: Lv 94 shown as browsing, “back to level 70” offered');
    await page.fill('#dLevel', '75'); await raf();
    assert(await shown() === 'L94', 'manual pick sticks when the level changes');
    await timed('back to level', () => page.click('#linkStages [data-lstage=""]'));
    assert(await shown() === 'L60', 'back to level → auto again');
    const after = await ev(() => ({ cur: $('curLabel').innerText, target: $('segTarget').innerText, tasks: $('taskList').innerText, pace: JSON.stringify(S.paceCfg), act: curAct() }));
    assert(after.cur === before.cur && after.target === before.target && after.pace === before.pace && after.act === before.act, 'act timer, target and pace are untouched by a level PoB');
    assert(after.tasks === before.tasks, 'Next Up unchanged by the import (' + after.tasks.length + ' chars)');
    // voice
    let r = await say('next tree');
    assert(await shown() === 'L94' && /Showing Level 94/.test(r.say || srvOut.slice(-400)), 'voice “next tree” → Level 94');
    r = await say('show tree Level 22');
    assert(await shown() === 'L22', 'voice “show tree Level 22”');
    r = await say('previous tree');
    assert(/first tree/.test(JSON.stringify(r)) || await shown() === 'L22', 'voice “previous tree” on the first tab stays there');
    await say('back to current tree');
    assert(await shown() === 'L60', 'voice “back to current tree” → follows the level again');
    await page.fill('#dLevel', '70'); await raf();
    await shotLinks('v51_levels_pob_imported.png');

    // ---------- character level from a screenshot (F10 / paste) feeds the level tabs
    await ev(() => document.activeElement && document.activeElement.blur());
    await post('/api/ocr_text', { text: 'Level 95\nLife 1317\nMana 833\nEnergy Shield 1308\nFire Resistance -60% (-60%)\nCold Resistance 18% (18%)\nLightning Resistance 75% (75%)\nChaos Resistance -60% (-60%)', propose: true });
    await page.waitForFunction(() => S.ocrPending && S.ocrPending.fields.level === 95, null, { timeout: 5000 });
    await say('confirm'); await raf();
    assert(await ev(() => C().level) === 95 && await page.inputValue('#dLevel') === '95' && await shown() === 'L94', 'screenshot level 95 → Char level 95 → Level 94 tab');
    if (OCR_PY) {
      const png = ENV.tmp('syn_header_4.png');
      execFileSync(OCR_PY, ['-c', `import sys; sys.path.insert(0, ${JSON.stringify(ENV.root('voice'))}); import ocr; ocr.synthetic_header_image(4, with_defences=False)[0].save(${JSON.stringify(png)})`]);
      const b64 = fs.readFileSync(png).toString('base64');
      await ev(async (b) => { const blob = await (await fetch('data:image/png;base64,' + b)).blob(); await ocrPaste(blob); }, b64);
      await page.waitForFunction(() => S.ocrPending && S.ocrPending.fields.level != null, null, { timeout: 15000 });
      const pend = await ev(() => S.ocrPending);
      assert(pend.fields.level === 4 && !pend.partial, 'pasted header screenshot: the round badge reads level 4 (rapidocr), offered as a normal confirm → ' + JSON.stringify(pend.fields));
      await say('confirm');
      assert(await ev(() => C().level) === 4 && await shown() === 'L22', 'level 4 applied → Level 22 tab');
    } else console.log('skip - image OCR (no Pillow/rapidocr python here)');

    // ---------- single tree + single skill set: no tabs at all
    await importXml('single.xml', SINGLE);
    assert(await ev(() => BCFG.mode) === 'single' && await page.locator('#linkStages').isHidden() && await page.locator('#mapStageSeg').isHidden(), 'single PoB: no stage tabs, no maps stage row');
    assert(/whole build/.test(await txt('#linkHead')) && (await page.locator('#linkCards .lcard').count()) > 3 && await page.locator('#treeBox svg.treesvg').count() === 1, 'single PoB: one gem layout + one tree');
    r = await say('next tree');
    assert(/one setup/.test(JSON.stringify(r)), 'voice “next tree” on a single PoB explains there is one tree');
    await shotLinks('v51_single_tree_pob.png');

    // ---------- named tabs: manual pick, persists
    await importXml('named.xml', NAMED);
    assert(await ev(() => BCFG.mode) === 'named' && JSON.stringify(await tabs()) === JSON.stringify(NAMES), 'named PoB: manual tabs ' + JSON.stringify(await tabs()));
    const budget = await ev(() => stageIds().find((s) => stageLabel(s) === 'Budget'));
    await timed('named tab', () => page.click(`#linkStages [data-lstage="${budget}"]`));
    await sleep(350); await page.reload(); await ready();
    assert(await shown() === budget && /Budget/.test(await txt('#linkHead')), 'named tab pick survives a reload');
    await say('show tree bossing');
    assert(/Bossing/.test(await txt('#linkHead')), 'voice “show tree bossing”');

    // ---------- mixed titles: acts + early game + maps + end game; trees on 3_27 / 3_28 draw on the nearest shipped tree
    await importXml('mixed.xml', MIXED);
    const mt = await tabs();
    assert(await ev(() => BCFG.mode) === 'acts' && mt.includes('A1') && mt.includes('A10') && mt.includes('Early maps') === false && mt.length >= 13, 'mixed PoB: act tabs + map tabs → ' + JSON.stringify(mt));
    await say('set act 1');
    assert(/Early Game/.test(await txt('#linkHead')), 'mixed: Act 1 uses “Early Game”');
    assert(await page.locator('#treeBox svg.treesvg').count() === 1 && /drawn on the 3_2\d tree/.test(await txt('#treeCap')), 'mixed: 3_27 tree drawn on the nearest shipped tree → ' + await txt('#treeCap'));
    await page.click('#linkStages [data-lstage="A5"]');
    assert(/Act 5/.test(await txt('#linkHead')), 'mixed: Act 5 tab');
    await page.click('#linkStages [data-lstage=""]');
    await shotLinks('v51_mixed_pob_imported.png');

    // ---------- your own PoB (act titles), when POE_PRIVATE_POB is set: Edit stage mapping + Maps stage
    const own = fs.existsSync(PRIVATE_XML);
    const xml = own ? fs.readFileSync(PRIVATE_XML, 'utf8') : MIXED;
    if (own) await importXml('Spectres.xml', xml);
    await say('set act 3');
    const st0 = await shown();
    await pclick('edit stage mapping', '#btnLinkEdit2');
    const ed = await ev(() => { const r = $('mapEditor').getBoundingClientRect(); return { vis: !$('mapEditor').classList.contains('hidden'), top: r.top, bottom: r.bottom, h: innerHeight, rows: $('mapEditor').querySelectorAll('select[data-map]').length, cur: !!$('mapEditor').querySelector('tr.cur'), curRow: (() => { const c = $('mapEditor').querySelector('tr.cur'); if (!c) return null; const b = c.getBoundingClientRect(); return { st: c.dataset.maprow, top: b.top, bottom: b.bottom, bg: getComputedStyle(c.querySelector('td')).backgroundColor }; })() }; });
    assert(ed.vis && ed.rows > 10 && ed.top >= -2 && ed.top < ed.h - 60, 'Edit stage mapping opens on screen → ' + JSON.stringify(ed));
    assert(ed.cur && ed.curRow.st === st0 && ed.curRow.top >= 0 && ed.curRow.bottom <= ed.h && ed.curRow.bg === 'rgb(42, 36, 20)', 'the current stage row is highlighted and on screen → ' + JSON.stringify(ed.curRow));
    await page.locator('#mapEditor').screenshot({ path: path.join(OUT, 'v51_stage_mapping_editor_open.png') });
    await page.screenshot({ path: path.join(OUT, 'v51_stage_mapping_editor_in_page.png') });
    const curSet = await ev((st) => String(BCFG.stages[st].variants[0].set), st0);
    const nSets = await ev(() => BCFG.sets.length);
    const newSet = String((+curSet + 1) % nSets);
    const cardsBefore = await txt('#linkCards');
    await pselect('mapping select', `#mapEditor select[data-map="${st0}:0:set"]`, newSet);
    const newName = await ev((i) => BCFG.sets[+i].clean, newSet);
    assert(new RegExp(newName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(await txt('#linkHead')) && (await txt('#linkCards')) !== cardsBefore, `mapping change re-renders the cards at once (${st0} → “${newName}”)`);
    assert(/now uses skill set/.test(await txt('#toast')), 'toast confirms the change');
    await sleep(350); await page.reload(); await ready();
    assert(await ev((st) => String(BCFG.stages[st].variants[0].set), st0) === newSet && new RegExp(newName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(await txt('#linkHead')), 'mapping change persists after reload');
    await page.click('#btnLinkEdit2');
    await page.selectOption(`#mapEditor select[data-map="${st0}:0:set"]`, curSet);
    await page.click('#btnMapDone');
    assert(await page.locator('#mapEditor').isHidden(), 'Done closes the editor');
    // Maps stage
    assert(await page.locator('#mapStageSeg').isVisible() && /Auto/.test(await txt('#mapStageSeg')), 'Maps stage row visible with Auto / Early / Mid / Late');
    await timed('map stage Early', () => page.click('#mapStageSeg [data-mappin="EM"]'));
    assert(await shown() === 'EM' && await page.locator('#mapStageSeg [data-mappin="EM"]').evaluate((b) => b.classList.contains('on')) && /pinned: Early maps/i.test(await txt('#mapStageSeg')), 'Early: shows Early maps now, button highlighted, “pinned” badge');
    const onStyle = await page.locator('#mapStageSeg [data-mappin="EM"]').evaluate((b) => getComputedStyle(b).borderColor);
    const offStyle = await page.locator('#mapStageSeg [data-mappin="MM"]').evaluate((b) => getComputedStyle(b).borderColor);
    assert(onStyle !== offStyle, 'the pinned button looks different (border ' + onStyle + ' vs ' + offStyle + ')');
    await page.click('#mapStageSeg [data-mappin="LM"]');
    assert(await shown() === 'LM' && /Late maps/.test(await txt('#linkHead')), 'Late: shows Late maps');
    await page.locator('#links').screenshot({ path: path.join(OUT, 'v51_map_stage_late_pinned.png') });
    await ev(() => { S._b = C().band; C().band = 1; S.linkView = null; save(); renderAll(); });     // mapping, white maps tier
    assert(await ev(() => mapStageAuto()) !== 'LM' && await shown() === 'LM' && /now/.test(await txt('#linkHead')), 'in maps the pin is “now” (overrides the tier)');
    await page.click('#mapStageSeg [data-mappin=""]');
    assert(await ev(() => S.mapStagePin) === null && await page.locator('#mapStageSeg [data-mappin=""]').evaluate((b) => b.classList.contains('on')), 'Auto clears the pin');
    await ev(() => { C().band = S._b || 0; delete S._b; save(); renderAll(); });
    assert(await shown() === 'EM' || await shown() === st0, 'Auto in maps follows the tier (white maps → Early maps)');
    await ev(() => { S.linkView = null; save(); renderAll(); });
    assert(await shown() === st0, 'back in the campaign the act stage is shown again');

    // ---------- wiki links: a clickable link, never the clipboard
    await say('get wiki link for Darkness Enthroned');
    await page.waitForFunction(() => (S.wikiLinks || []).some((w) => w.title === 'Darkness Enthroned'), null, { timeout: 8000 });
    await sleep(200);
    assert(/Wiki link for Darkness Enthroned added\./.test(srvOut), 'spoken: “Wiki link for Darkness Enthroned added.”');
    assert((await ev(() => window.__copied.length)) === 0, 'nothing was copied to the clipboard');
    const a = page.locator('#wikiList a', { hasText: 'Darkness Enthroned' });
    assert(await a.getAttribute('target') === '_blank' && /poewiki\.net\/wiki\/Darkness_Enthroned/.test(await a.getAttribute('href')), 'Wiki links panel: hyperlink, opens in a new tab');
    await page.locator('#wiki').scrollIntoViewIfNeeded();
    await page.locator('#wiki').screenshot({ path: path.join(OUT, 'v51_wiki_links_panel.png') });
    const [popup] = await Promise.all([page.waitForEvent('popup'), a.click()]);
    await popup.waitForLoadState();
    assert(/poewiki\.net\/wiki\/Darkness_Enthroned/.test(popup.url()), 'clicking it opens the wiki page in a new tab → ' + popup.url());
    await popup.close();
    // ---------- link colours (history, wiki, Fate panel, character help)
    await ev(() => { S.log.unshift({ id: uid(), ts: now(), kind: 'research', text: 'Research “great white beast”: The Great White Beast is in the Den, Act 2.', full: '', url: 'https://www.poewiki.net/wiki/The_Great_White_Beast', title: 'The Great White Beast', source: 'poewiki', note: '', ids: [], acked: [], char: C().created }); save(); renderAll(); });
    const hl = page.locator('#logList a').first();
    assert(await hl.count() === 1, 'history research entry has its link');
    const css = await hl.evaluate((el) => { const cs = getComputedStyle(el); let p = el, bg = 'rgba(0, 0, 0, 0)'; while (p && /rgba\(0, 0, 0, 0\)|transparent/.test(bg)) { bg = getComputedStyle(p).backgroundColor; p = p.parentElement; } return { color: cs.color, weight: cs.fontWeight, deco: cs.textDecorationLine, bg }; });
    const ratio = contrast(rgbOf(css.color), rgbOf(css.bg));
    assert(+css.weight >= 600 && ratio >= 4.5, `history link: ${css.color} weight ${css.weight} on ${css.bg} → contrast ${ratio.toFixed(2)}:1 (≥ 4.5)`);
    const ratios = {};
    for (const [name, bg] of [['--panel #161a20', [22, 26, 32]], ['--panel2 #1d222a', [29, 34, 42]], ['--bg #0d0f12', [13, 15, 18]], ['--line #2a313b', [42, 49, 59]]]) {
      ratios[name] = { link: contrast([140, 200, 255], bg).toFixed(2), visited: contrast([205, 180, 255], bg).toFixed(2) };
    }
    console.log('contrast ratios:', JSON.stringify(ratios));
    assert(Object.values(ratios).every((x) => +x.link >= 4.5 && +x.visited >= 4.5), 'link and visited colours ≥ 4.5:1 on every panel background');
    const everywhere = await ev(() => ['#wikiList a', '#logList a', '#fates a', '#charsec a', '#pobImport a'].map((s) => { const el = document.querySelector(s); return el ? [s, getComputedStyle(el).color] : [s, null]; }));
    assert(everywhere.filter(([, c]) => c).every(([, c]) => c === 'rgb(140, 200, 255)' || c === 'rgb(205, 180, 255)'), 'the same readable link colour everywhere: ' + JSON.stringify(everywhere));
    await hl.hover();
    assert(await hl.evaluate((el) => getComputedStyle(el).textDecorationLine) === 'underline', 'underline on hover');
    await page.mouse.move(5, 5);
    await page.locator('#log').scrollIntoViewIfNeeded();
    await page.locator('#log').screenshot({ path: path.join(OUT, 'v51_links_in_history.png') });

    const worst = lat.reduce((m, x) => (x[1] > m[1] ? x : m), ['', 0]);
    console.log('latencies ms:', lat.map((x) => x.join(' ')).join(', '));
    assert(worst[1] < 400, `every interaction < 400 ms (max ${worst[1]} ms: ${worst[0]})`);
    assert(errors.length === 0, 'no page errors ' + errors.join(' | '));
    console.log(`\n${n} v5.1 e2e checks passed`);
  } catch (e) { console.error(e); console.error(srvOut.slice(-1500)); process.exitCode = 1; }
  await browser.close(); srv.kill(); mock.close();
})();
