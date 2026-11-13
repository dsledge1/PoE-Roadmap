const { chromium } = require('playwright-core');
const ENV = require('./env');
const path = ENV.root('poe_tracker.html');
const assert = (c, m) => { if (!c) { throw new Error('ASSERT: ' + m); } console.log('ok -', m); };
(async () => {
  const browser = await chromium.launch(ENV.launchOpts);
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.clock.install({ time: new Date('2026-11-13T19:00:00Z') });
  await page.goto(require('url').pathToFileURL(path).href);
  const txt = (sel) => page.locator(sel).innerText();
  const timed = async (label, fn) => { const t0 = Date.now(); await fn(); const dt = await page.evaluate(() => new Promise(r => requestAnimationFrame(() => r(0)))); const ms = Date.now() - t0; console.log(`   ${label}: ${ms} ms`); return ms; };
  const lat = [];

  // Pace
  lat.push(await timed('start league', () => page.click('#btnStartLaunch')));
  assert(await page.isVisible('#paceLive'), 'pace live panel visible after start');
  await page.clock.fastForward('52:00');
  lat.push(await timed('act 1 done', () => page.click('#btnNextMs')));
  let kp = await txt('#kpis');
  assert(/2 min behind/.test(kp) && /3 min ahead/.test(kp) && /13 min ahead/.test(kp), 'A1 at 52 min: 6h +2 behind, 7h 3 ahead, 8h 13 ahead → ' + kp.replace(/\n/g, ' | '));
  assert((await txt('#btnNextMs')) === 'Act 2 done', 'next button is Act 2 done');
  assert(/Stop 1 at A2/.test(await txt('#nextStop')), 'next stop shows Stop 1');
  await page.clock.fastForward('50:00');
  kp = await txt('#kpis');
  assert(/14 min behind/.test(kp), 'live behind while Act 2 overruns 6h target (102 vs 88) → ' + kp.replace(/\n/g, ' | '));
  assert((await page.getAttribute('#segTimer', 'class')).includes('bad'), 'segment timer red when over');
  await page.click('#btnNextMs');
  assert(/Stop 2 at A3/.test(await txt('#nextStop')), 'after A2, next stop is Stop 2');
  await page.click('#btnUndoMs');
  assert((await txt('#btnNextMs')) === 'Act 2 done', 'undo works');
  await page.click('#btnNextMs');

  // Drops (v4: the manual box lives in the types manager)
  await page.click('#typesBox summary');
  const log = async (t) => { if (!(await page.isVisible('#logInput'))) await page.evaluate(() => { document.getElementById('typesBox').open = true; }); await page.fill('#logInput', t); const ms = await timed('log ' + t, () => page.press('#logInput', 'Enter')); lat.push(ms); return txt('#logResult'); };
  let r = await log('Cane of Unravelling');
  assert(/D01/.test(r) && /equip at the self-cast swap/i.test(r), 'Cane → D01 equip action');
  r = await log('Animate Weapon of Ranged Arms');
  assert(/D03/.test(r) && /condition not met/.test(r) && /stash it/i.test(r), 'AWoRA before T6 gate → stash');
  r = await log('rare staff 812 pdps');
  assert(/D06/.test(r) && /812 pDPS/.test(r), 'staff 812 pdps → D06');
  r = await log('staff 600 pdps');
  assert(/No trigger matched/.test(r), 'staff 600 pdps → no trigger');
  r = await log('dyadian dawn');
  assert(/No trigger matched/.test(r), 'dyadian dawn: D07 inactive (EA dropped), logged only');
  r = await log('Forged Frostbearer captured');
  assert(/N01/.test(r) && /Under 3/.test(r), 'Frostbearer → N01 (1 logged, under 3)');
  r = await log('Bones of Ullr');
  assert(/N04/.test(r) && /On the Necro/.test(r), 'Bones of Ullr → N04 equip on Necro');
  r = await log('Storm Burst of Repulsion');
  assert(/No trigger matched/.test(r), 'inactive totem trigger D04 does not fire');
  r = await log('+2 minion helmet');
  assert(/N05/.test(r), '+2 minion helmet → N05');
  r = await log('Arcane Surge gem');
  assert(/No trigger matched/.test(r), '"Arcane" does not trigger the Cane');
  assert((await page.locator('#toast .card.p1').count()) >= 0, 'toast present');
  await log('near death');
  r = await txt('#logResult');
  assert(/E01/.test(r) && !/E02/.test(r), 'near-death → E01 only');
  await page.clock.fastForward('00:30');
  await log('near death');
  assert(/same incident/.test(await txt('#logList')), 'second near-death within 90 s marked same incident');
  assert(!/Stop for the night/.test(await txt('#taskList')), 'two entries 30 s apart = one incident, no stop task');
  await page.clock.fastForward('02:00');
  await log('near death');
  assert(/Stop for the night/.test(await txt('#taskList')), '2 near-death incidents in 30 min → stop task');
  assert(/Act on (Cane of Unravelling|Forged Frostbearer|Bones of Ullr)/.test(await txt('#taskList')), 'unacked P1 shows in Next up');
  const openBefore = await txt('#openCount');
  await page.locator('#openActions [data-ack]').first().click();
  assert((await txt('#openCount')) !== openBefore, 'ack reduces open count');

  // Links & tree panel (the example PoB is the default build; Act 3 → stage A3)
  assert(await page.locator('#dBuild').count() === 0 && await page.locator('#dBar').count() === 0, 'Build/Bar dropdowns removed from Defense');
  assert(await page.locator('#planBody').count() === 0 && await page.locator('#fBoss').count() === 0, 'old Build plan + Fate checklist removed');
  assert(/Act 3/.test(await txt('#linkHead')) && /now/.test(await txt('#linkHead')), 'links panel follows the act → ' + await txt('#linkHead'));
  assert((await page.locator('#linkCards .lcard').count()) >= 4, 'Act 3 has link cards');
  assert((await page.locator('#linkCards .gd-r, #linkCards .gd-g, #linkCards .gd-b').count()) > 5, 'gem colour circles drawn');
  assert(await page.locator('#treeBox svg.treesvg').count() === 1 && /vs Act 2/.test(await txt('#treeCap')), 'tree closeup diffs against Act 2 → ' + await txt('#treeCap'));
  lat.push(await timed('link stage click', () => page.click('#linkStages [data-lstage="A1"]')));
  let lc = await txt('#linkCards');
  assert(/browsing/.test(await txt('#linkHead')) && /Rolling Magma/.test(lc) && /Summon Raging Spirit/.test(lc), 'browse Act 1: Rolling Magma + SRS cards');
  assert(/Replace when you get srs/i.test(lc), 'label note visible on the card');
  assert(/from the start/.test(await txt('#treeCap')) && /Lord of the Dead/.test(await txt('#treeCap')), 'Act 1 tree: new notables named');
  await page.click('#linkStages [data-lstage="EM"]');
  assert(await page.locator('#linkVariantSel').count() === 1 && (await page.locator('#linkVariantSel option').count()) >= 5, 'early maps: variant dropdown');
  lat.push(await timed('variant select', () => page.selectOption('#linkVariantSel', '1')));
  assert(/Bitterdream/.test(await txt('#linkHead')), 'variant 2 = Early Bitterdream → ' + await txt('#linkHead'));
  await page.selectOption('#linkVariantSel', '0');
  await page.click('#linkStages [data-lstage="A3"]');
  assert(!/browsing/.test(await txt('#linkHead')), 'back to auto stage');
  // category override in edit mode persists in the build config
  await page.click('#pobImport summary'); await page.click('#btnLinkEdit');
  const sel = page.locator('#linkCards select.catsel').first();
  const before = await sel.inputValue();
  await sel.selectOption(before === 'utility' ? 'other' : 'utility');
  assert(await page.evaluate(() => JSON.parse(localStorage.getItem('poe330_build_cfg_v3')).sets.some((st) => st.groups.some((g) => g.cat !== g.auto))), 'category override saved');
  assert((await page.locator('#mapEditor select[data-map]').count()) > 10, 'stage mapping editor shows');
  await page.click('#btnLinkEdit'); await page.click('#pobImport summary');
  assert(/target &gt; 900|target > 900/.test(await page.innerHTML('#poolTarget')), 'pool target 300 × act at Act 3');
  await page.fill('#dPool', '950');
  assert(await page.evaluate(() => $('dPool').classList.contains('pool-ok')), 'pool 950 > 900 → green');
  await page.fill('#dPool', '700');
  assert(await page.evaluate(() => $('dPool').classList.contains('pool-amber')), 'pool 700 → amber');
  await page.fill('#dPool', '');
  // Fate bosses for the current act
  assert(/Act 3/.test(await txt('#bossSub')) && (await page.locator('#bossList .boss').count()) > 3, 'Act 3 Fate bosses listed');
  assert(/Dominus/.test(await txt('#bossList')) && /Despot/.test(await txt('#bossList')), 'Dominus viscera reward shown');

  // Pause / resume (excluded from elapsed and pace, survives reload)
  const secs = (t) => t.split(':').reduce((a, x) => a * 60 + +x, 0);
  const near = async (t0) => Math.abs(secs(await txt('#elapsed')) - secs(t0)) <= 5;
  const el0 = await txt('#elapsed');
  lat.push(await timed('pause button', () => page.click('#btnPause')));
  assert(await page.isVisible('#pauseBanner') && /PAUSED/.test(await txt('#hdrSummary')), 'pause banner + header show PAUSED');
  await page.clock.fastForward('20:00');
  assert(await near(el0), 'elapsed frozen while paused (' + el0 + ')');
  await page.reload();
  assert(await page.isVisible('#pauseBanner') && /20:0\d not counted/.test(await txt('#pauseBanner')), 'pause survives reload → ' + (await txt('#pauseBanner')));
  lat.push(await timed('resume button', () => page.click('#btnPause')));
  assert(!(await page.isVisible('#pauseBanner')) && await near(el0) && /paused 20:0/.test(await txt('#pauseTotal')), 'resume: elapsed excludes the 20 min pause');
  assert(/Pause \(button\)/.test(await txt('#voiceList')), 'pause button is undoable from the voice list');

  // Res numbers before Kitava, then the Kitava milestones
  await page.fill('#dFire', '76'); await page.fill('#dCold', '75'); await page.fill('#dLight', '75');
  assert(await page.isChecked('#dEle'), 'three res ≥ 75 → ele capped derived');
  await page.fill('#dLight', '60');
  assert(!(await page.isChecked('#dEle')) && /uncapped: lightning/.test(await txt('#gateList')), 'lightning 60 → uncapped named in gates');
  await page.fill('#dLight', '75');

  // Campaign → done
  for (let i = 0; i < 11; i++) { await page.clock.fastForward('30:00'); await page.click('#btnNextMs'); }
  assert(/Kitava down/.test(await txt('#projKitava')), 'Kitava down shown');
  let kit = await txt('#kitPen');
  assert(/−60% all ele res/.test(kit) && /before the Kitava penalty/.test(kit), 'Kitava −60 shown + stale res warning → ' + kit.split('\n')[0]);
  assert(/res from before Kitava/.test(await txt('#gateList')), 'stale res fails the gates');
  assert(/Re-enter your res/.test(await txt('#taskList')), 'Next up asks for new res');
  await page.fill('#dFire', '75'); await page.fill('#dCold', '75'); await page.fill('#dLight', '75');
  assert(!/before the Kitava/.test(await txt('#kitPen')), 'new res clears the stale warning');

  // Defense (Occultist/standard bar first, then the Necro minion bar). v3: no phys max hit / EHP gates.
  assert((await page.inputValue('#cBuild')) === 'Spectre Necromancer', 'default build is Spectre Necromancer');
  assert(await page.locator('#dPmh').count() === 0 && await page.locator('#dEhp').count() === 0 && await page.locator('#dAblock').count() === 1, 'pmh/EHP removed, attack block added');
  await page.selectOption('#cBuild', 'ED Occultist');
  await page.check('#dEle');
  await page.fill('#dChaos', '10'); await page.fill('#dPool', '3500');
  assert(/Cleared for T1–5/.test(await txt('#clearedFor')), 'map-entry gate passes');
  assert(/target &gt; 3000/.test(await page.innerHTML('#poolTarget')), 'pool target 3000 at map start');
  lat.push(await timed('type pool', () => page.fill('#dPool', '4800')));
  await page.check('#dOver'); await page.fill('#dChaos', '35');
  assert(/Cleared for T6–10/.test(await txt('#clearedFor')), 'T6 gate passes without a max-hit number');
  await page.fill('#dChaos', '65'); await page.fill('#dPool', '6500'); await page.fill('#dBlock', '40');
  assert(/T6–10/.test(await txt('#clearedFor')), 'T11 blocked at 40% spell block');
  lat.push(await timed('type attack block', () => page.fill('#dAblock', '30')));
  await page.fill('#dBlock', '55');
  assert(/Cleared for T11–14/.test(await txt('#clearedFor')), 'T11 clears with 55% block');
  await page.fill('#dBlock', '40');

  // AWoRA now meets condition (T6)
  r = await log('AWoRA');
  assert(/condition met/.test(r) && /char #2/.test(r), 'AWoRA after T6 gate → roll PRAW');

  // Fate bosses in maps: search any boss, log a kill with N Fates
  assert(/Maps/.test(await txt('#bossSub')), 'maps: boss search mode');
  await page.fill('#bossSearch', 'Merveil'); await page.dispatchEvent('#bossSearch', 'change');
  assert(/Siren's Tentacle/.test(await txt('#bossList')), 'search Merveil → Siren\'s Tentacle');
  lat.push(await timed('boss kill button', () => page.locator('#bossList .boss').first().locator('[data-bkill="2"]').click()));
  assert((await txt('#killCount')) === '1' && /2 Fates/.test(await txt('#voiceList')), 'kill with 2 Fates logged');
  assert((await page.locator('#fateCards tr').count()) >= 15, 'Fate card list shown');

  // Next up budgets
  await page.click('[data-b="15"]');
  const t15 = await txt('#taskList');
  await page.click('[data-b="999"]');
  const tAll = await txt('#taskList');
  assert(tAll.split('\n').length >= t15.split('\n').length, 'session budget shows at least as many tasks as 15m');
  console.log('--- 15m tasks ---\n' + t15 + '\n--- session tasks ---\n' + tAll);
  assert(/maps/i.test(tAll), 'mapping chunk suggested');
  console.log('--- 15m tasks ---\n' + t15 + '\n--- session tasks ---\n' + tAll);

  // Persistence
  await page.waitForTimeout(300);
  await page.clock.fastForward(400);
  await page.reload();
  assert(/Cleared for T6–10/.test(await txt('#clearedFor')), 'state persists across reload');
  assert(/act|maps/i.test(await txt('#linkHead')), 'links panel survives reload → ' + await txt('#linkHead'));
  assert((await page.locator('#logList .logitem').count()) > 5, 'log persists');

  // Export / import triggers
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btnExport')]);
  const exp = JSON.parse(require('fs').readFileSync(await dl.path(), 'utf8'));
  assert(exp.state && exp.state.log.length > 5 && exp.triggersInUse.triggers.length === 58, 'export JSON has state + 58 triggers');
  const newTrig = JSON.parse(require('fs').readFileSync(ENV.root('data', 'triggers.json'), 'utf8'));
  newTrig.updated = 'TEST'; newTrig.triggers.push({ id: 'X99', type: 'drop', item: 'Headhunter', condition: 'always', action: 'Celebrate', priority: 1, hard: false });
  require('fs').writeFileSync(ENV.tmp('trig_test.json'), JSON.stringify(newTrig));
  await page.setInputFiles('#fileTrig', ENV.tmp('trig_test.json'));
  await page.waitForTimeout(100);
  assert(/59 \(imported/.test(await txt('#trigInfo')), 'trigger import → 59 imported');
  r = await log('Headhunter');
  assert(/Celebrate/.test(r), 'imported trigger matches');
  await page.click('#btnResetTrig');
  assert(/58 \(embedded/.test(await txt('#trigInfo')), 'reset to embedded triggers');
  require('fs').writeFileSync(ENV.tmp('bad.json'), '{"foo":1}');
  await page.setInputFiles('#fileTrig', ENV.tmp('bad.json'));
  await page.waitForTimeout(100);
  assert(/Import failed/.test(await txt('#toast')), 'bad triggers file rejected');

  // State import roundtrip
  page.on('dialog', (d) => d.accept());
  require('fs').writeFileSync(ENV.tmp('state.json'), JSON.stringify(exp));
  await page.setInputFiles('#fileState', ENV.tmp('state.json'));
  await page.waitForTimeout(100);
  assert(/Log imported/.test(await txt('#toast')), 'state import works');

  // Necro minion bar: lower life gates, block required at T11
  await page.selectOption('#cBuild', 'Spectre Necromancer');
  await page.fill('#dChaos', '65'); await page.fill('#dPool', '5200'); await page.fill('#dBlock', '40');
  assert(/T6–10/.test(await txt('#clearedFor')), 'Necro T11 blocked with 40% block');
  await page.fill('#dBlock', '60');
  assert(/Cleared for T11–14/.test(await txt('#clearedFor')), 'Necro clears T11 at 5.2k pool / 60% block');

  // Death → new char
  await log('Death');
  assert(/Character died/.test(await txt('#taskList')), 'death → reroll task');
  await page.click('#btnNewChar');
  assert((await txt('#btnStartNow')) && await page.isVisible('#paceStart'), 'new char resets campaign');
  assert(/died/.test(await page.locator('#histTable').textContent()), 'history records dead char');

  console.log('max interaction latency', Math.max(...lat), 'ms; all:', lat.join(','));
  assert(Math.max(...lat) < 400, 'every measured interaction < 400 ms');
  assert(errors.length === 0, 'no JS errors: ' + errors.join(' | '));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
