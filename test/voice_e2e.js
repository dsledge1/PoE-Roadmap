// End-to-end: companion.py (--no-audio) serves the tracker; commands injected over HTTP flow via SSE into the page.
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const ENV = require('./env');
require('fs').writeFileSync(ENV.tmp('voice_cfg_v2.json'), JSON.stringify({ port: 8765, hotkey: 'f9', tracker_html: '../poe_tracker.html', tts: true, speak_typed: true, result_timeout_ms: 1200,
  research: { backend: 'openai_compatible', wiki_api: 'http://127.0.0.1:8798/w/api.php', llm_timeout_s: 2, openai_compatible: { base_url: 'http://127.0.0.1:8798/v1', model: 'mock-model' } } }));
const PORT = 8799, BASE = `http://127.0.0.1:${PORT}`;
const PY = ENV.PY;
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('ok -', m); };
const S_def = (x) => x;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const inject = async (text) => { const t = Date.now(); const r = await (await fetch(BASE + '/api/inject', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, wait: true }) })).json(); r.wall = Date.now() - t; return r; };

// Mock poewiki MediaWiki API + OpenAI-compatible endpoint on :8798 (synthetic replies; the real ones are tested in test_research.py)
const http = require('http');
const MOCK_KEY = 'e2e-mock-key-not-real-0000';
const llmCalls = [];
const mock = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); const send = (o, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (u.pathname === '/w/api.php') {
    const p = Object.fromEntries(u.searchParams);
    if (p.list === 'search') return send({ query: { search: /desecrate/i.test(p.srsearch) ? [{ title: 'Desecrate' }] : /ullr/i.test(p.srsearch) ? [{ title: 'Bones of Ullr' }] : [] } });
    const slow = (p.titles || p.page) === 'Bones of Ullr';
    const reply = () => {
      if (p.prop === 'extracts') return send({ query: { pages: [{ title: p.titles, extract: p.titles + ' is a spell that creates corpses.' }] } });
      if (p.prop === 'text') return send({ parse: { text: '<p>x</p>' } });
      return send({ parse: { wikitext: '{{Version history table row|3.30.0|\n* Creates up to 6 corpses.\n}}' } });
    };
    return slow ? setTimeout(reply, 1500) : reply();
  }
  if (u.pathname === '/v1/chat/completions') {
    let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => {
      const body = JSON.parse(b); llmCalls.push({ auth: req.headers.authorization, body });
      if (/FAILME/.test(JSON.stringify(body))) return send({ error: 'boom' }, 500);
      send({ choices: [{ message: { content: JSON.stringify({ spoken: 'Desecrate spawns corpses; 3.30 made it six.', detail: 'Grounded detail.' }) } }] });
    });
    return;
  }
  send({}, 404);
}).listen(8798);

(async () => {
  const srv = spawn(PY, [ENV.root('voice', 'companion.py'), '--no-audio', '--no-browser', '--no-tts', '--port', String(PORT), '--config', ENV.tmp('voice_cfg_v2.json')], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, OPENAI_API_KEY: MOCK_KEY } });
  let out = ''; srv.stdout.on('data', (d) => (out += d)); srv.stderr.on('data', (d) => (out += d));
  for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/api/health'); break; } catch { await sleep(100); } }
  const browser = await chromium.launch(ENV.launchOpts);
  let page = await (await browser.newContext({ viewport: { width: 1600, height: 1250 } })).newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  try {
    // queued before the page is open -> replayed on connect
    const q = await inject('start the league');
    assert(q.level === 'queued', 'command before tracker is open is queued: ' + q.say);
    await page.goto(BASE + '/');
    await page.waitForSelector('#voiceDot.v-ready', { timeout: 5000 });
    assert(/Voice ready · hold F9/.test(await page.innerText('#voiceDot')), 'voice indicator shows ready + hotkey');
    await page.waitForFunction(() => S.char.campaign.start, null, { timeout: 3000 });
    assert(true, 'queued "start the league" replayed into the page on connect');
    const times = [];
    const step = async (text, check, label) => { const r = await inject(text); times.push(r.roundtrip_ms); assert(await page.evaluate(check), `${label} → “${r.say}” (${r.roundtrip_ms} ms)`); return r; };

    let r = await step('Act 1 done', () => S.char.campaign.done.M1 > 0, 'act 1 milestone');
    r = await step('Got a Kane of Unravelling', () => S.log.some((l) => l.text === 'Cane of Unravelling' && l.ids.includes('D01')), 'misheard Cane fires D01');
    assert(r.level === 'p1' && /Cane of Unravelling logged\. Stash it as the 1B trigger/.test(r.say), 'P1 level + spoken trigger action (Necro default: Cane is the 1B trigger)');
    r = await step('Porcupine card just dropped', () => S.log.some((l) => l.text === 'The Porcupine (divination card)'), 'div card logged');
    r = await step("Finished Act 3, resistances aren't capped", () => S.char.campaign.done.M3 && !S.char.campaign.done.M4 && S.char.def.ele === false, 'act 3 (skipping act 2) + ele false');
    assert(/Also marked 1 skipped/.test(r.say) && /Stop 2/.test(r.say), 'readback mentions skipped + stop');
    r = await step('lab done', () => !!S.char.campaign.done.M4, 'lab done → Normal lab');
    r = await step('chaos res thirty and life four thousand two hundred', () => S.char.def.chaos === 30 && S.char.def.pool === 4200 && S.char.def.life === 4200, 'chaos + life');
    r = await step('es 600', () => S.char.def.pool === 4800, 'ES adds to pool');
    r = await step('res capped', () => S.char.def.ele === true, 'res capped');
    r = await step('near death', () => S.log[0].fx === 'near', 'near death');
    r = await step("what's next", () => true, 'query next');
    assert(/^Next: Act 4, by/.test(r.say), 'next answer: ' + r.say);
    r = await step('how am I doing', () => true, 'query pace');
    assert(/on 7 hour pace/.test(r.say), 'pace answer');
    r = await step('this map layout is awful', () => S.log[0].kind === 'note', 'unknown phrase kept as note');
    assert(r.level === 'unknown', 'unknown beep level');
    r = await step('died', () => S.char.alive === false, 'death');
    r = await step('undo', () => S.char.alive === true && S.log[0].kind === 'note', 'voice undo restores alive');
    // UI undo button on the voice list
    await page.click('#voiceList [data-vundo]');
    assert(await page.evaluate(() => S.log[0].kind !== 'note'), 'UI undo removes the note');
    // undo of a milestone command
    r = await step('act 4 done', () => !!S.char.campaign.done.M5, 'act 4');
    r = await step('undo', () => !S.char.campaign.done.M5, 'undo milestone');
    // typed box in the page
    await page.fill('#voiceTyped', 'killed Brutus with one fate'); await page.press('#voiceTyped', 'Enter');
    await page.waitForFunction(() => S.char.kills.some((k) => k.boss === 'Brutus' && k.fates === 1), null, { timeout: 2000 });
    assert(true, 'typed command in tracker voice box → kill logged');
    // ===== v2 =====
    // 1. multi-field dictation, one readback naming every field (real playtest lines)
    r = await step("I'm level 12, 37 cold res, 45 fire, 28 lightning, 25 chaos", () => { const d = S.char.def; return S.char.level === 12 && d.fire === 45 && d.cold === 37 && d.lightning === 28 && d.chaos === 25 && d.ele === false; }, 'level + four res in one sentence');
    assert(/Level 12\. Fire 45, cold 37, lightning 28, chaos 25, no Kitava penalty yet\. Uncapped: fire, cold, lightning\./.test(r.say), 'readback names every field: ' + r.say);
    r = await step('Resistances are 25% cold, 0% everything else', () => { const d = S.char.def; return d.cold === 25 && d.fire === 0 && d.lightning === 0 && d.chaos === 0; }, '"everything else" fills the rest');
    r = await step("Max Life's 300", () => S.char.def.life === 300, "Max Life's 300 → life");
    r = await step('Life in Energy Shield is now 512', () => S.char.def.pool === 512, 'misheard "life and ES" → pool');
    r = await step('Fire 75, cold 75, lightning 75, chaos minus 20. Life 4000 and energy shield 1200', () => { const d = S.char.def; return d.ele === true && d.chaos === -20 && d.life === 4000 && d.es === 1200 && d.pool === 5200; }, 'all res + life + ES');
    assert(/Fire, cold and lightning 75, chaos minus 20/.test(r.say) && /Elemental res capped/.test(r.say) && /Life 4000, E S 1200, pool 5200/.test(r.say), 'readback: ' + r.say);
    r = await step('undo', () => S.char.def.life === 300 && S.char.def.chaos === 0, 'undo restores every field of the batch');
    r = await step('Fire 75, cold 75, lightning 75, chaos minus 20. Life 4000 and energy shield 1200', () => S.char.def.pool === 5200, 're-apply');
    // 2. Kitava: res entered before A5 → warning, then new numbers "after Kitava penalty"
    r = await step('act 5 kitava done', () => !!S.char.campaign.done.M6 && S.char.def.resStale === true, 'Kitava 5 marks logged res stale');
    assert(r.level === 'p1' && /res dropped 30/.test(r.say) && /Tell me your new res/.test(r.say), 'Kitava warning asks for new res: ' + r.say);
    assert(await page.evaluate(() => /before the Kitava penalty/.test(document.querySelector('#kitPen').innerText)), 'page shows the stale-res warning');
    r = await step('what are my res', () => true, 'res query while stale');
    assert(/before the Kitava penalty/.test(r.say), 'res answer flags stale: ' + r.say);
    r = await step('res are 75 75 62', () => S.char.def.resStale === false && S.char.def.lightning === 62 && S.char.def.resPen === 30, 'new res after Kitava');
    assert(/after Kitava penalty minus 30/.test(r.say) && /Uncapped: lightning/.test(r.say), 'readback says after Kitava penalty: ' + r.say);
    r = await step('undo', () => S.char.def.resStale === true, 'undo brings the stale flag back');
    r = await step('undo', () => !S.char.campaign.done.M6 && S.char.def.resStale === false, 'undo the Kitava milestone clears the warning');
    // 3. pause / resume
    r = await step('pause timer', () => S.char.campaign.pauses.length === 1 && S.char.campaign.pauses[0].to == null, 'pause by voice');
    assert(/Timer paused at/.test(r.say) && await page.isVisible('#pauseBanner'), 'pause readback + banner');
    r = await step("what's my pace", () => true, 'pace while paused');
    assert(/Timer is paused/.test(r.say), 'pace answer mentions pause: ' + r.say);
    r = await step('resume', () => S.char.campaign.pauses[0].to > 0, 'resume by voice');
    assert(/Resumed\./.test(r.say), r.say);
    r = await step('undo', () => S.char.campaign.pauses[0].to == null, 'undo resume → paused again');
    r = await step('act 4 done', () => !!S.char.campaign.done.M5 && S.char.campaign.pauses[0].to > 0, 'a milestone auto-resumes the timer');
    assert(/^Timer resumed\./.test(r.say), r.say);
    r = await step('undo', () => !S.char.campaign.done.M5 && S.char.campaign.pauses[0].to == null, 'undo milestone re-pauses');
    r = await step('resume', () => S.char.campaign.pauses[0].to > 0, 'resume');
    // 4. build plan questions, answered locally
    r = await step('What is my 3 link setup now, I am in Act 1 at level 10', () => true, 'Playtest: 3-link in act 1 at level 10');
    assert(/^Act 1, level 10, 3-link: Rolling Magma with Arcane Surge and Added Lightning Damage until you get SRS, then Summon Raging Spirit with Added Lightning Damage and Minion Damage\.$/.test(r.say) && r.roundtrip_ms < 400, 'links answer in PoB order (the example build Act 1): ' + r.say);
    r = await step('Just got a 3 socket chest piece. What are my links?', () => S.log.some((l) => /3-socket chest/.test(l.text)), 'Playtest: chest drop + links');
    assert(/Act 4, 3-link: Vaal Absolution with Physical to Lightning and Spell Echo/.test(r.say), 'links for current act (4) from tracker state: ' + r.say);
    r = await step('what is my 4 link in maps', () => true, 'maps 4-link');
    assert(/^Early maps.*4-link: Vaal Absolution/.test(r.say), r.say);
    r = await step('what auras should I run', () => true, 'auras');
    assert(/auras: Herald of Purity/.test(r.say), r.say);
    r = await step('Act 1 main attack', () => true, 'category query: act 1 main attack');
    assert(/^Act 1, main attack: Rolling Magma .* until you get SRS\. Then Summon Raging Spirit/.test(r.say), r.say);
    r = await step("what's my movement", () => true, 'category query: movement');
    assert(/movement: /.test(r.say) && /Shield Charge/.test(r.say), r.say);
    r = await step('utility links in act 5', () => true, 'category query: utility act 5');
    assert(/^Act 5, utility: /.test(r.say) && /Flesh Offering/.test(r.say), r.say);
    r = await step('what are my links', () => true, 'all links summary');
    assert(/Main attack: /.test(r.say) && /Movement: /.test(r.say) && r.say.length < 440, r.say);
    // act correction (the act mix-up): we're in Act 4 now; "I'm in Act 3, not Act 4" unmarks Act 3, undo restores
    r = await step("I'm in Act 3, not Act 4.", () => !S.char.campaign.done.M3 && curAct() === 3, 'set act back to 3');
    assert(/Corrected to Act 3\. Unmarked Act 3/.test(r.say) && /undo/.test(r.say), r.say);
    r = await step('undo', () => !!S.char.campaign.done.M3 && curAct() === 4, 'undo the correction');
    r = await step('heading to act 5', () => curAct() === 4, '"heading to act 5" does not mark anything');
    r = await step('set act to 5', () => curAct() === 5 && !!S.char.campaign.done.M5, 'set act forward marks Act 4');
    r = await step('undo', () => curAct() === 4, 'undo set act forward');
    const nlog = await page.evaluate(() => S.log.length);
    r = await step('where does the cane of kulimac drop', () => true, 'Kulimac drop question');
    assert((await page.evaluate(() => S.log.length)) === nlog && !/Unravelling/.test(r.say), 'Kulimac drop question logs nothing, no Cane of Unravelling: ' + r.say);
    assert(/look it up/i.test(r.say) && /Say yes/.test(r.say), 'v4: offers a look-up: ' + r.say);
    r = await step('fate reward for dominus', () => true, 'fate_info by voice');
    assert(/Dominus/.test(r.say) && /Despot/.test(r.say), r.say);
    r = await step('any news on fates on twitter', () => true, 'news readback');
    assert(/poewiki and poedb/.test(r.say), r.say);
    r = await step('what should I do with a cane of unravelling', () => true, 'trigger question');
    assert(/^Cane of Unravelling:/.test(r.say), r.say);
    r = await step('can you hear me', () => true, 'mic check');
    assert(/loud and clear/.test(r.say), r.say);
    r = await step('how much damage does a bear do?', () => S.log[0].text === 'Question: how much damage does a bear do', 'unknown question kept as note');
    assert(/Want me to look that up\? Say yes/.test(r.say), 'v4: offers a look-up: ' + r.say);
    // 5. Fates
    r = await step('Going to try Mervail with 1 fate', () => S.log[0].text === 'Fate attempt: 1 Fate on Mervail', 'Playtest: fate attempt');
    assert(r.level === 'p1' && /over your cap of 0/.test(r.say), 'campaign cap 0 → P1 warning: ' + r.say);
    r = await step('killed Mervail with no fates', () => S.char.kills.some((k) => k.boss === 'Mervail'), 'kill readback');
    assert(/Mervail kill logged, 0 Fates/.test(r.say), r.say);
    // 6. research: immediate ack, async answer into history with link, cancel, failure fallback
    r = await inject('research desecrate');
    assert(/^Looking up desecrate\./.test(r.say) && r.wall < 400, `research ack is immediate (${r.wall} ms): ${r.say}`);
    await page.waitForFunction(() => S.log.some((l) => l.kind === 'research' && /Desecrate spawns corpses/.test(l.text)), null, { timeout: 5000 });
    assert(await page.locator('#logList a[href="https://www.poewiki.net/wiki/Desecrate"]').count() === 1, 'research answer in history with the poewiki link');
    const lc = llmCalls.at(-1);
    assert(lc.auth === 'Bearer ' + MOCK_KEY && lc.body.model === 'mock-model' && /Creates up to 6 corpses/.test(lc.body.messages[1].content) && /"level": 12/.test(lc.body.messages[1].content), 'LLM call grounded in wiki text + tracker state (sent by the page)');
    const page_html = await page.content();
    assert(!page_html.includes(MOCK_KEY), 'API key never reaches the page');
    r = await inject('look up bones of ullr');
    const r2 = await inject('never mind');
    assert(/Cancelled the lookup/.test(r2.say), 'never mind cancels: ' + r2.say);
    await sleep(2000);
    assert(!(await page.evaluate(() => S.log.some((l) => l.kind === 'research' && /ullr/i.test(l.text)))), 'cancelled lookup posts nothing');
    r = await inject('research desecrate FAILME');
    await page.waitForFunction(() => S.log.some((l) => l.kind === 'research' && /FAILME/.test(l.text)), null, { timeout: 5000 });
    assert(await page.evaluate(() => { const e = S.log.find((l) => l.kind === 'research'); return e.source === 'wiki' && /LLM failed/.test(e.note); }), 'LLM failure → plain poewiki summary + note');
    r = await step('undo', () => !S.log.some((l) => l.kind === 'research' && /FAILME/.test(l.text)), 'undo removes a research entry');
    // 7. screenshot OCR proposal (F10 path with already-OCR'd synthetic text) → confirm / undo / discard
    const OCR_TXT = 'Level 44\nMaximum Life 3,412\nMaximum Energy Shield 420\nFire Resistance 75% (82%)\nCold Resistance 75% (79%)\nLightning Resistance 68% (68%)\nChaos Resistance -12% (-12%)';
    await fetch(BASE + '/api/ocr_text', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: OCR_TXT, propose: true }) });
    await page.waitForFunction(() => S.ocrPending && S.ocrPending.fields.life === 3412, null, { timeout: 3000 });
    assert(await page.isVisible('#btnOcrApply') && S_def(await page.evaluate(() => S.char.def.life)) !== 3412, 'proposal shown, nothing applied yet');
    r = await step('confirm', () => { const d = S.char.def; return !S.ocrPending && d.life === 3412 && d.es === 420 && d.pool === 3832 && d.lightning === 68 && d.chaos === -12 && S.char.level === 44; }, 'confirm applies the screenshot values');
    assert(/^Applied\./.test(r.say) && /Uncapped: lightning/.test(r.say), r.say);
    r = await step('undo', () => S.char.def.life === 4000 && S.ocrPending && S.ocrPending.fields.life === 3412, 'undo restores old values and the pending proposal');
    r = await step('discard', () => !S.ocrPending && S.char.def.life === 4000, 'discard drops the proposal');
    // 8. near-death regressions (a real double count)
    const nd = () => page.evaluate(() => S.log.filter((l) => l.fx === 'near' && l.char === S.char.created).length);
    const nd0 = await nd();
    const dupCmd = { type: 'command', id: 'dup-near-1', transcript: 'near death', source: 'voice', actions: [{ type: 'log', text: 'Near-death (flasks empty / pool < 30%)' }] };
    await page.evaluate((m) => { onVoiceMsg(m); onVoiceMsg(m); }, dupCmd);
    await page.reload(); await page.waitForSelector('#voiceDot.v-ready');
    await page.evaluate((m) => onVoiceMsg(m), dupCmd);
    assert((await nd()) === nd0 + 1, 'same command id delivered 3x (incl. after reload) → one entry');
    const p0 = inject('near death'); await sleep(15); await page.reload(); await page.waitForSelector('#voiceDot.v-ready'); await p0; await sleep(400);
    assert((await nd()) >= nd0 + 2, 'reload right after a near-death command keeps the entry');
    assert(await page.evaluate(() => nearDeaths30()) === 1, 'entries within 90 s count as one incident');
    r = await inject('Okay, I just had a near death. Almost died to an act too rare.');
    assert(/same incident/.test(r.say), 'A real line right after another entry → "same incident", not "second in 30 min": ' + r.say);

    // two tabs: only the lock holder talks to the companion
    const page2 = await page.context().newPage(); await page2.goto(BASE + '/');
    await page2.waitForSelector('#voiceDot.v-follower');
    assert(/another tab/.test(await page2.innerText('#voiceDot')), 'second tab shows "active in another tab"');
    r = await inject('Bones of Ullr');
    await sleep(300);
    const n = await page.evaluate(() => S.log.filter((l) => l.text === 'Bones of Ullr').length);
    assert(n === 1 && r.level === 'p1', 'two tabs open: command applied exactly once');
    // closing the leader hands voice to the other tab
    const leader = page; await leader.close();
    await page2.waitForSelector('#voiceDot.v-ready', { timeout: 5000 });
    r = await inject('chaos res 45');
    assert(await page2.evaluate(() => S.char.def.chaos === 45), 'after closing leader, second tab takes over voice');
    page = page2;
    const h = await (await fetch(BASE + '/api/health')).json();
    assert(h.ok && h.pending === 0, 'health ok, nothing pending');
    times.sort((a, b) => a - b);
    console.log(`server→page→result roundtrip ms: median ${times[Math.floor(times.length / 2)]}, max ${times[times.length - 1]} (n=${times.length})`);
    assert(times[times.length - 1] < 400, 'every roundtrip < 400 ms');
    await page.evaluate(() => { document.activeElement.blur(); window.scrollTo(0, 0); });
    await page.screenshot({ path: require('path').join(ENV.OUT, 'screenshot_voice.png') });
    assert(errors.length === 0, 'no page errors ' + errors.join('|'));
  } finally { await browser.close(); srv.kill(); mock.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
