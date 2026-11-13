// v4 end-to-end: companion.py (--no-audio) serves the tracker; voice commands are injected over HTTP; UI is clicked.
// Covers custom drop/event types, Power Chase, Fate boss open+scroll, follow-ups, news, yes-offer, OCR Offence guard,
// layout (Next up above Voice), profiles. Screenshots go to test/env.js OUT (a temp folder).
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const ENV = require('./env');
const PORT = 8797, BASE = `http://127.0.0.1:${PORT}`, OUT = ENV.OUT;
const PY = ENV.PY;
let n = 0; const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); n++; console.log('ok -', m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = async (p, body) => (await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
const inject = (text) => post('/api/inject', { text, wait: true });
// mock poewiki (search finds nothing) so a 'yes' research runs offline
const http = require('http');
const mock = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(req.url.includes('list=search') ? { query: { search: [] } } : {})); }).listen(8796);
fs.writeFileSync(ENV.tmp('voice_cfg_v4.json'), JSON.stringify({ port: PORT, hotkey: 'f9', tracker_html: '../poe_tracker.html', tts: false, speak_typed: false, result_timeout_ms: 1200,
  research: { backend: 'none', wiki_api: 'http://127.0.0.1:8796/w/api.php', poedb: '' } }));

(async () => {
  const srv = spawn(PY, [ENV.root('voice', 'companion.py'), '--no-audio', '--no-browser', '--no-tts', '--port', String(PORT), '--config', ENV.tmp('voice_cfg_v4.json')], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, OPENAI_API_KEY: '' } });
  let srvOut = ''; srv.stdout.on('data', (d) => (srvOut += d)); srv.stderr.on('data', (d) => (srvOut += d));
  for (let i = 0; i < 60; i++) { try { await fetch(BASE + '/api/health'); break; } catch { await sleep(250); } }
  const browser = await chromium.launch(ENV.launchOpts);
  const ctx = await browser.newContext({ viewport: { width: 1700, height: 1200 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/favicon|ERR_CONNECTION|EventSource/.test(m.text())) errors.push(m.text()); });
  page.on('dialog', (d) => d.accept());
  const lat = [], rts = [];
  const timed = async (label, fn) => { const t0 = Date.now(); await fn(); await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r()))); const ms = Date.now() - t0; lat.push(ms); return ms; };
  const ev = (f, a) => page.evaluate(f, a);
  const say = async (text) => { const r = await inject(text); rts.push(r.roundtrip_ms || 0); return r; };
  try {
    // ---------- an existing v3 tracker: no types / chase / layout yet
    await page.goto(BASE + '/');
    await page.waitForFunction(() => VOICE.state === 'ready', null, { timeout: 8000 });
    await ev(() => { const s = JSON.parse(JSON.stringify(S)); delete s.char.types; delete s.char.chase; delete s.char.chaseOn; delete s.layout; delete s.v4fresh; s.v = 1; s.char.build = 'Spectre Necromancer'; localStorage.setItem(STORE_KEY, JSON.stringify(s)); });
    await page.reload(); await page.waitForFunction(() => VOICE.state === 'ready', null, { timeout: 8000 });
    assert(await ev(() => C().chase.length === 6 && C().chase.some((x) => x.item === 'Dread boss fight' && x.content === 'Atlas Boss')), 'v3 → v4: the Necro Power Chase defaults (6 items, Dread boss fight = Atlas Boss)');
    assert(await ev(() => C().types.length === DEFAULT_TYPES.length && C().chaseOn === false), 'v3 → v4: default drop/event types, Power Chase off');
    // ---------- layout
    const order = await ev(() => [...document.querySelectorAll('main > .col')].map((c) => [...c.querySelectorAll(':scope > section')].map((s) => s.id)));
    assert(order[0].join() === 'pace,next,voice', 'column 1: pace, Next up above Voice → ' + JSON.stringify(order));
    assert(order[1].join() === 'log,chase', 'column 2: Drops & events, Power Chase');
    assert(await ev(() => document.querySelectorAll('section[data-panel]').length === PANELS.length), 'every panel has data-panel and is in the registry');
    assert(!(await ev(() => !!document.getElementById('quickEvents') || !!document.querySelector('[data-quick]'))), 'quick event buttons are gone');
    assert(!(await page.isVisible('#logInput')), 'manual-add box is tucked into the types manager');
    await page.screenshot({ path: OUT + '/v4_full_layout.png' });

    // ---------- voice: granular drops
    const nlog = () => ev(() => S.log.length);
    for (const [text, want, type] of [['dropped a 4 link', '4-link', 't4l'], ['found a 5 link', '5-link', 't5l'], ['Found a 5-link!', '5-link', 't5l'],
      ['got a six link', '6-link', 't6l'], ['dropped a 6 socket', '6-socket', 't6s'], ['found a 4 link with the right colours', '3/4-link, right colours', 'trgb'],
      ['dropped a fate card', 'Fate card', 'tfate'], ['got some viscera', 'Viscera', 'tvisc'], ['dropped a unique', 'Unique', 'tuniq']]) {
      const r = await say(text);
      assert(await ev(([w, t]) => S.log[0].text === w && S.log[0].type === t && S.log[0].kind === 'drop', [want, type]), `voice “${text}” → ${want} (${r.roundtrip_ms} ms, “${r.say}”)`);
    }
    let r = await say('found a unique Bones of Ullr');
    assert(await ev(() => S.log[0].text === 'Unique: Bones of Ullr' && S.log[0].ids.includes('N04')), 'unique by name keeps the name and fires its trigger: ' + r.say);
    const before = await nlog();
    for (const q of ['did you see that 5 link?', 'where do 6 links drop?', 'is a 6 socket worth it?', 'what does a fate card do?']) await say(q);
    assert(await ev((b) => S.log.filter((l) => l.kind === 'drop').length === S.log.filter((l) => l.kind === 'drop').length && S.log.length === b, before), 'questions log no drops (4 questions, log unchanged)');
    r = await say('near death');
    assert(await ev(() => S.log[0].fx === 'near'), 'built-in event still has its effect (near-death)');

    // ---------- voice: types
    r = await say('add drop type mirror shard');
    assert(await ev(() => C().types.some((t) => t.name === 'Mirror shard' && t.kind === 'drop')) && /Added drop type Mirror shard/.test(r.say), 'voice add drop type: ' + r.say);
    await sleep(200);   // page → companion sync
    r = await say('found a mirror shard');
    assert(await ev(() => S.log[0].text === 'Mirror shard' && S.log[0].type.startsWith('u')), 'the new type logs by voice right away: ' + r.say);
    r = await say('add event type boss down');
    await sleep(150);
    r = await say('boss down');
    assert(await ev(() => S.log[0].text === 'Boss down' && S.log[0].kind === 'event'), 'custom event type logs as an event');
    r = await say('rename drop type mirror shard to mirror fragment');
    assert(await ev(() => C().types.some((t) => t.name === 'Mirror fragment')), 'voice rename: ' + r.say);
    r = await say('delete drop type mirror fragment');
    assert(await ev(() => !C().types.some((t) => t.name === 'Mirror fragment')), 'voice delete: ' + r.say);
    r = await say('undo');
    assert(await ev(() => C().types.some((t) => t.name === 'Mirror fragment')), 'undo restores the deleted type: ' + r.say);

    // ---------- voice: Fate boss
    r = await say('fate boss merveil');
    assert(await ev(() => /Merveil/.test(S.bossOpen)) && /Opened in the Fate panel/.test(r.say) && r.say.length < 200, 'fate boss merveil → open + short readback: ' + r.say);
    const vis = await ev(() => { const el = document.querySelector('#bossList .boss.open'), box = document.getElementById('bossList').getBoundingClientRect(), b = el.getBoundingClientRect(); return el.classList.contains('hl') && b.top >= box.top - 2 && b.bottom <= box.bottom + 2; });
    assert(vis, 'the Merveil card is scrolled into view and highlighted');
    await sleep(300); await page.locator('#fates').screenshot({ path: OUT + '/v4_fate_boss_merveil.png' });
    for (const t of ['Fate boss: Dominus', 'fate boss mervail', 'Pull up the Fate boss from Merveil.', "What's the Fate boss effect for Merveil?", 'what does merveil give', 'show me merveil fate']) {
      r = await say(t);
      assert(await ev(() => !!S.bossOpen) && /Opened in the Fate panel/.test(r.say), `“${t}” opens ${await ev(() => S.bossOpen)}`);
    }

    // ---------- voice: Power Chase
    r = await say('chase done darkness enthroned');
    assert(await ev(() => C().chase.find((x) => x.item === 'Darkness Enthroned').done) && /5 left/.test(r.say), 'chase done Darkness Enthroned: ' + r.say);
    assert(await ev(() => !S.log.some((l) => l.text === 'Darkness Enthroned' && Date.now() - l.ts < 5000)), '…and no Darkness Enthroned drop was logged');
    r = await say("add chase item Shavronne's Wrappings from Delve");
    assert(await ev(() => C().chase.some((x) => x.item === "Shavronne's Wrappings" && x.content === 'Delve')), 'add chase item … from Delve: ' + r.say);
    r = await say("what's left on my chase?");
    assert(/6 left/.test(r.say) && /Delve: \+1 Spectre chest, Shavronne's Wrappings/.test(r.say), 'chase query: ' + r.say);
    r = await say('undo');
    assert(await ev(() => !C().chase.some((x) => x.item === "Shavronne's Wrappings")), 'undo removes the added chase item');
    r = await say('chase done dread boss');
    assert(await ev(() => C().chase.find((x) => x.item === 'Dread boss fight').done), 'fuzzy chase match (“dread boss”): ' + r.say);

    // ---------- follow-ups, news, yes
    r = await say('What link should I be using?');
    r = await say('Main attack links only.');
    assert(/main attack/i.test(r.say) && !/Noted/.test(r.say), 'follow-up “Main attack links only.” → ' + r.say.slice(0, 80));
    r = await say('just the movement');
    assert(/movement/i.test(r.say), 'follow-up “just the movement” → ' + r.say.slice(0, 80));
    r = await say('Is there any new information on X?');
    assert(/poewiki and poedb/.test(r.say) && /can't read X/.test(r.say) && /Check pathofexile\.com/.test(r.say), 'news question: ' + r.say);
    r = await say("Research on Twitter if there's any new information.");
    assert(!r.research && /Check pathofexile\.com/.test(r.say), 'no wiki lookup on “Twitter”: ' + r.say);
    r = await say('What map is Bar Kulin?');
    assert(/Want me to look that up\? Say yes/.test(r.say), 'unknown question offers a look-up: ' + r.say);
    r = await say('yes');
    assert(/Looking up map is Bar Kulin/.test(r.say), '“yes” within 20 s runs it: ' + r.say);
    await page.waitForFunction(() => S.log[0].kind === 'research', null, { timeout: 8000 });
    assert(await ev(() => /couldn't find a page for 'Bar Kulin'/.test(S.log[0].text)), 'research says it found no page (no guessing): ' + (await ev(() => S.log[0].text)));
    r = await say('yes');
    assert(/Nothing to say yes to/.test(r.say), 'a second yes has nothing to confirm');

    // ---------- OCR guard (texts from a real 23:21 read)
    const OFF = "Life 93\nMana 128\nOffence Defence Misc Charges\nMAIN HAND CHANCE TO HIT 82%\nATTACKS PER SECOND 1.65\nMAIN HAND ACCURACY RATING 34\nMAIN HAND CRITICAL STRIKE CHANCE 8.3%";
    await post('/api/ocr_text', { text: OFF, propose: true }); await sleep(400);
    assert(await ev(() => !S.ocrPending && /Offence tab/.test(document.getElementById('ocrBox').textContent)), 'Offence tab: notice, nothing to confirm');
    await page.locator('#defense').screenshot({ path: OUT + '/v4_ocr_offence_notice.png' });
    r = await say('confirm');
    assert(/No screenshot values waiting/.test(r.say), 'confirm after the Offence tab applies nothing: ' + r.say);
    await post('/api/ocr_text', { text: 'Life 93\nFIRE RESISTANCE 0% (0%)\nMana 128', propose: true }); await sleep(400);
    assert(await ev(() => S.ocrPending && S.ocrPending.partial && /Looks incomplete/.test(document.getElementById('ocrBox').textContent)), 'partial read (3 fields): warning before confirm');
    r = await say('discard');
    await post('/api/ocr_text', { text: 'Life 93\nMana 128\nARMOUR 31\nEVASION RATING 40\nFIRE RESISTANCE 0% (0%)\nCOLD RESISTANCE 9% (9%)\nLIGHTNING RESISTANCE 9% (9%)\nCHAOS RESISTANCE 0% (0%)\nCHANCE TO BLOCK ATTACK DAMAGE 20% (20%)', propose: true }); await sleep(400);
    assert(await ev(() => S.ocrPending && !S.ocrPending.partial && Object.keys(S.ocrPending.fields).length === 9), 'full Defences read: 9 fields, no warning');
    r = await say('confirm');
    assert(/Applied/.test(r.say), 'confirm still applies a full read: ' + r.say.slice(0, 60));

    // ---------- UI: types manager
    await page.click('#typesBox summary');
    await page.fill('#typeNewName', 'Exalted Orb'); await page.fill('#typeNewAlias', 'exalt, ex');
    await timed('add type', () => page.click('#typeAddForm button[type=submit]'));
    assert(await ev(() => C().types.some((t) => t.name === 'Exalted Orb' && t.aliases.includes('exalt'))), 'manager: add a type with aliases');
    const tid = await ev(() => C().types.find((t) => t.name === 'Exalted Orb').id);
    await page.fill(`[data-tname="${tid}"]`, 'Exalt'); await timed('rename type', () => page.press(`[data-tname="${tid}"]`, 'Enter'));
    await page.locator(`[data-tname="${tid}"]`).blur();
    assert(await ev((id) => C().types.find((t) => t.id === id).name === 'Exalt', tid), 'manager: rename a type');
    await page.selectOption(`[data-tkind="${tid}"]`, 'event');
    assert(await ev((id) => C().types.find((t) => t.id === id).kind === 'event', tid), 'manager: change the kind');
    await page.fill('#logInput', '5 link'); await timed('manual log', () => page.press('#logInput', 'Enter'));
    assert(await ev(() => S.log[0].text === '5-link' && S.log[0].type === 't5l'), 'manual box: “5 link” → 5-link');
    await page.fill('#logInput', 'Cane of Unravelling'); await page.press('#logInput', 'Enter');
    assert(await ev(() => S.log[0].ids.includes('D01')), 'manual box: trigger items still work');
    await page.evaluate(() => document.querySelector('#typeTable tr:last-child').scrollIntoView({ block: 'nearest' })); await page.locator('#typesBox').screenshot({ path: OUT + '/v4_types_manager.png' });
    await timed('delete type', () => page.click(`[data-tdel="${tid}"]`));
    assert(await ev((id) => !C().types.some((t) => t.id === id), tid), 'manager: delete a type');

    // ---------- UI: Power Chase
    assert(!(await page.isVisible('#chaseBody')), 'Power Chase starts off (campaign)');
    await timed('chase on', () => page.check('#chaseOn'));
    assert(await page.isVisible('#chaseList'), 'toggle shows the checklist');
    assert((await page.locator('#chaseList .cgroup').count()) >= 4, 'grouped by content type');
    await page.fill('#chaseNewItem', 'Ventor\'s Gamble'); await page.selectOption('#chaseNewContent', 'Expedition'); await page.fill('#chaseNewNote', 'res ring');
    await timed('chase add', () => page.click('#chaseAddForm button[type=submit]'));
    const vid = await ev(() => C().chase.find((x) => x.item === "Ventor's Gamble" && x.content === 'Expedition' && x.note === 'res ring').id);
    assert(vid, 'UI add item with content + note');
    await timed('chase edit', () => page.click(`[data-cedit-btn="${vid}"]`));
    await page.fill(`[data-cid="${vid}"] [data-cedit="note"]`, 'chaos res ring'); await timed('chase save', () => page.click(`[data-csave="${vid}"]`));
    assert(await ev((id) => C().chase.find((x) => x.id === id).note === 'chaos res ring', vid), 'UI edit item');
    await timed('chase done', () => page.check(`[data-cdone="${vid}"]`));
    assert(await ev((id) => C().chase.find((x) => x.id === id).done, vid), 'UI tick done');
    await timed('chase filter', () => page.click('#chaseChips [data-ctfilter="Abyss"]'));
    assert((await page.locator('#chaseList .citem').count()) === 2, 'filter by content: Abyss shows 2 items');
    await page.click('#chaseChips [data-ctfilter=""]');
    await page.selectOption('#chaseTpl', 'ED Occultist');
    assert(await ev(() => C().chase.some((x) => x.item === 'Timeless jewel' && x.content === 'Legion (Timeless jewels)')), 'Occultist template: Timeless jewel → Legion');
    await page.click('#chase details summary'); await page.fill('#ctNew', 'Sanctum'); await page.click('#ctAddForm button');
    assert(await ev(() => contentTypes().includes('Sanctum')), 'content types are editable');
    await page.locator('#chase').screenshot({ path: OUT + '/v4_power_chase.png' });
    await timed('chase delete', () => page.click(`[data-cdel="${vid}"]`));
    assert(await ev((id) => !C().chase.some((x) => x.id === id), vid), 'UI delete item');

    // ---------- profiles
    await page.click('#btnOwnPob');
    assert(await ev(() => document.getElementById('pobImport').open && document.activeElement.id === 'pobText'), '“Use my own PoB” opens the import box, cursor in it');
    await page.locator('#links').screenshot({ path: OUT + '/v4_links_own_pob.png' });
    // v5: the profile export / import became Download backup / Advanced → Restore backup (one file, includes the build)
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btnBackup')]);
    const pf = ENV.tmp('backup_v5.json'); await dl.saveAs(pf);
    const prof = JSON.parse(fs.readFileSync(pf, 'utf8'));
    assert(prof.kind === 'backup' && prof.version === 5 && prof.buildCfg && prof.buildCfg.sets && prof.state.char.types.some((t) => t.name === 'Boss down') && prof.state.char.chase.length >= 7, 'backup: build + types + chase');
    await page.fill('#cName', 'TestNecro');
    await page.click('#advBox > summary');
    await timed('fresh profile', () => page.click('#btnFreshProfile'));
    const fresh = await ev(() => ({ log: S.log.length, hist: S.history.length, voice: (S.voice || { log: [] }).log.length, chase: C().chase.length, types: C().types.length, name: C().name, def: JSON.stringify(BCFG) === JSON.stringify(bcfgNorm(JSON.parse(JSON.stringify(DEFAULT_BUILD_CFG)))), custom: C().types.some((t) => t.id.startsWith('u')), stored: localStorage.getItem(BCFG_KEY) }));
    assert(fresh.log === 0 && fresh.hist === 0 && fresh.voice === 0 && fresh.chase === 0 && fresh.name === '' && fresh.def && !fresh.custom && !fresh.stored, 'fresh profile: no log, chars, voice history, chase or custom types; default demo build → ' + JSON.stringify(fresh));
    await page.reload(); await page.waitForTimeout(300);
    assert(await ev(() => C().chase.length === 0 && S.log.length === 0), 'fresh profile survives a reload empty');
    await page.click('#advBox > summary');
    await page.setInputFiles('#fileRestore', pf); await page.waitForTimeout(300);
    assert(await ev(() => C().types.some((t) => t.name === 'Boss down') && C().chase.some((x) => x.item === 'Timeless jewel') && C().chase.find((x) => x.item === 'Darkness Enthroned').done), 'restore brings back types and chase (done states kept)');
    assert(await ev(() => S.log.length > 0 && BCFG.sets.length === JSON.parse(localStorage.getItem(BCFG_KEY)).sets.length), 'restore brings back the log and build');
    await page.waitForFunction(() => VOICE.state === 'ready', null, { timeout: 8000 }); await sleep(200);
    r = await say('boss down');
    assert(await ev(() => S.log[0] && S.log[0].text === 'Boss down'), 'imported types sync to the companion (voice logs “boss down”)');

    // ---------- latency
    console.log('UI latencies ms:', lat.join(','), ' voice roundtrips ms:', rts.join(','));
    assert(Math.max(...lat) < 400, `every UI interaction < 400 ms (max ${Math.max(...lat)})`);
    assert(Math.max(...rts) < 400, `every voice roundtrip < 400 ms (max ${Math.max(...rts)})`);
    assert(errors.length === 0, 'no page errors ' + errors.join(' | '));
    console.log(`\n${n} v4 e2e checks passed`);
  } catch (e) { console.error(e); console.error(srvOut.slice(-2000)); process.exitCode = 1; }
  await browser.close(); srv.kill(); mock.close();
})();
