// v5.2 end-to-end through the companion (--no-audio): Power Chase items link to their wiki page by themselves (generic ones
// stay plain, offline = retried later, manual edit / clear), the Configure page (open / close / sections), defense stat
// toggles, Mind Over Matter pool math, tier editing changing the panel verdict, drop & event trigger add / edit / remove,
// the near-death rule (2 in 30 min -> stop for the night) firing and being edited, v5.1 -> v5.2 migration and backup.
// Screenshots go to <tmp>/v52out/ (POE_V52_OUT overrides).
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'), http = require('http'), path = require('path');
const ENV = require('./env');
const PORT = 8815, MPORT = 8816, BASE = `http://127.0.0.1:${PORT}`, OUT = process.env.POE_V52_OUT || require('path').join(ENV.TMP, 'v52out');
fs.mkdirSync(OUT, { recursive: true });
let n = 0; const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); n++; console.log('ok -', m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = async (p, body) => (await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();

// mock poewiki: word search with plurals stemmed (like the real one: "Frostbearers" finds "Forged Frostbearer"); MOCK.down = offline
const MOCK = { down: false, titles: ['Darkness Enthroned', 'Forged Frostbearer', 'Abyss Jewel', 'Spectre'], hits: [] };
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
const CFG = ENV.tmp('voice_cfg_v52.json');
fs.writeFileSync(CFG, JSON.stringify({ port: PORT, hotkey: 'f9', tracker_html: '../poe_tracker.html', tts: false, speak_typed: false, result_timeout_ms: 1500,
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
    await say('start league'); await say('set act 3');
    assert(await ev(() => curAct()) === 3, 'campaign running, Act 3');

    // ================= Power Chase wiki links
    await ev(() => { C().chaseOn = true; C().chase = []; S.wikiCache = {}; save(); renderChase(); });
    await page.fill('#chaseNewItem', 'Darkness Enthroned');
    const addMs = await pdo('chase add (UI)', '#chaseAddForm button[type=submit]');
    assert(addMs < 400 && await ev(() => C().chase.some((x) => x.item === 'Darkness Enthroned')), `add is instant (${Math.round(addMs)} ms); the lookup runs after`);
    await page.waitForFunction(() => [...document.querySelectorAll('#chase a.clink')].some((a) => a.textContent === 'Darkness Enthroned'), null, { timeout: 8000 });
    let L = await linkOf('Darkness Enthroned');
    assert(L && L.href === 'https://www.poewiki.net/wiki/Darkness_Enthroned' && L.target === '_blank' && /noopener/.test(L.rel), 'UI add → name becomes a poewiki link (new tab): ' + JSON.stringify(L));
    const lc = await ev(() => getComputedStyle(document.querySelector('#chase a.clink')).color);
    assert(/rgb\(140, 200, 255\)|rgb\(205, 180, 255\)/.test(lc), 'readable link colour: ' + lc);
    let r = await say('add Frostbearers to my chase list');
    assert(/Added Frostbearers/.test(r.say || ''), 'voice add: ' + r.say);
    await page.waitForFunction(() => [...document.querySelectorAll('#chase a.clink')].some((a) => a.textContent === 'Frostbearers'), null, { timeout: 8000 });
    L = await linkOf('Frostbearers');
    assert(L && /Forged_Frostbearer$/.test(L.href), 'voice add: Frostbearers → the Forged Frostbearer monster page');
    MOCK.hits = [];
    await page.selectOption('#chaseTpl', 'Spectre Necromancer'); await sleep(1200);
    const tpl = await ev(() => C().chase.map((x) => ({ item: x.item, url: x.wiki && x.wiki.url, generic: !!x.wikiGeneric, checked: x.wikiChecked })));
    const generic = ['+1 Spectre chest', 'Dread boss fight', '+1/+1 wand', 'Abyss jewel'];
    assert(generic.every((g) => tpl.some((x) => x.item === g && !x.url && x.generic && x.checked)), 'template: generic items stay unlinked → ' + JSON.stringify(tpl.filter((x) => generic.includes(x.item))));
    assert(!MOCK.hits.some((h) => /abyss|spectre|wand|boss|jewel/i.test(h || '')), 'generic items are never sent to the wiki (Abyss Jewel / Spectre pages exist but are not forced) → ' + JSON.stringify(MOCK.hits));
    assert(await page.locator('#chase a.clink').count() === 2, 'exactly the two real items are links');
    await page.locator('#chase').scrollIntoViewIfNeeded();
    await page.locator('#chase').screenshot({ path: path.join(OUT, 'v52_chase_links.png') });

    // offline: nothing changes, retried later
    MOCK.down = true;
    r = await say('add Mageblood to my chase list');
    await sleep(2500);
    let mg = await ev(() => { const x = C().chase.find((y) => y.item === 'Mageblood'); return { url: x.wiki && x.wiki.url, checked: x.wikiChecked, cached: !!S.wikiCache.mageblood }; });
    assert(!mg.url && !mg.checked && !mg.cached, 'companion / wiki offline → left unlinked, nothing cached: ' + JSON.stringify(mg));
    MOCK.down = false; MOCK.titles.push('Mageblood');
    await ev(() => { CL.retryAt = 0; chaseLinkSweep(); });
    await page.waitForFunction(() => [...document.querySelectorAll('#chase a.clink')].some((a) => a.textContent === 'Mageblood'), null, { timeout: 8000 });
    assert(/\/Mageblood$/.test((await linkOf('Mageblood')).href), 'back online → the retry links it');
    // manual edit / clear
    const mid = await ev(() => C().chase.find((y) => y.item === 'Mageblood').id);
    await pdo('chase edit', `[data-cedit-btn="${mid}"]`);
    await page.fill(`.citem[data-cid="${mid}"] [data-cedit="wiki"]`, '');
    await pdo('chase save', `[data-csave="${mid}"]`);
    assert(!(await linkOf('Mageblood')) && await ev((id) => C().chase.find((y) => y.id === id).wikiManual, mid), 'editor: clearing the link leaves the name plain (and it stays that way)');
    await ev(() => { CL.retryAt = 0; chaseLinkSweep(); }); await sleep(300);
    assert(!(await linkOf('Mageblood')), 'a cleared link is not re-added by the sweep');
    await page.click(`[data-cedit-btn="${mid}"]`);
    await page.fill(`.citem[data-cid="${mid}"] [data-cedit="wiki"]`, 'https://poedb.tw/us/Mageblood');
    await page.click(`[data-csave="${mid}"]`);
    assert((await linkOf('Mageblood')).href === 'https://poedb.tw/us/Mageblood', 'editor: a pasted link is used');
    // backfill (v5.1 items had no lookup) + cache
    await ev(() => { for (const x of C().chase) if (x.item === 'Darkness Enthroned') { delete x.wiki; delete x.wikiChecked; } S.v52 = 0; save(); });
    MOCK.hits = [];
    await page.reload(); await ready();
    await page.waitForFunction(() => [...document.querySelectorAll('#chase a.clink')].some((a) => a.textContent === 'Darkness Enthroned'), null, { timeout: 8000 });
    assert(!MOCK.hits.some((h) => /darkness/i.test(h || '')), 'existing items are backfilled on load (from the cache, no new wiki request)');

    // ================= Configure page
    const opMs = await pdo('open Configure', '#btnConfigure');
    assert(await page.isVisible('#cfgPage') && await ev(() => location.hash) === '#configure' && opMs < 400, `Configure opens as a full page (${Math.round(opMs)} ms)`);
    assert((await page.locator('#cfgNav button').count()) === 5, 'sections: Defense stats, Tier checks, Triggers, Rules, General');
    await shotCfg('v52_config_defense.png');
    await page.keyboard.press('Escape'); await raf();
    assert(!(await page.isVisible('#cfgPage')) && await ev(() => location.hash) === '', 'Esc closes back to the tracker');
    await pdo('open Configure', '#btnConfigure');
    const clMs = await pdo('close Configure', '#btnCfgClose');
    assert(!(await page.isVisible('#cfgPage')) && clMs < 400, 'Close returns to the tracker');
    await page.goto(BASE + '/#configure'); await ready();
    assert(await page.isVisible('#cfgPage'), '#configure opens it straight away');

    // ---- defense stat toggles
    for (const k of ['mom', 'evade', 'suppress', 'pdr', 'ptaken', 'leech', 'endurance', 'armour']) await pdo('stat ' + k, `[data-cstat="${k}"]`, 'check', true);
    assert(await ev(() => ['mom', 'evade', 'suppress', 'pdr', 'ptaken', 'leech', 'endurance', 'armour'].every((k) => defProfile().on[k])), 'optional stats switched on');
    await pdo('stat chaos off', '[data-cstat="chaos"]', 'check', false);
    await pdo('close', '#btnCfgClose');
    const ex = await ev(() => ({ dnum: [...document.querySelectorAll('#defExtra [data-dnum]')].map((e) => e.dataset.dnum), bool: [...document.querySelectorAll('#defExtra [data-dbool]')].map((e) => e.dataset.dbool), pt: document.querySelectorAll('#defExtra [data-dpt]').length, chaosHidden: document.getElementById('dChaos').classList.contains('hidden') }));
    assert(['evade', 'suppress', 'pdr', 'leech', 'endurance', 'armour'].every((k) => ex.dnum.includes(k)) && ex.bool.includes('mom') && ex.bool.includes('overleech') && ex.pt === 4, 'Defense panel gets an input per enabled stat (+ MoM, overleech, 4 taken-as): ' + JSON.stringify(ex));
    assert(ex.chaosHidden, 'chaos switched off → hidden in the panel');
    await page.fill('#defExtra [data-dnum="evade"]', '35'); await page.fill('#defExtra [data-dnum="suppress"]', '60'); await page.fill('#defExtra [data-dpt="cold"]', '10'); await page.fill('#defExtra [data-dpt="fire"]', '5');
    await page.fill('#defExtra [data-dnum="leech"]', '900'); await page.check('#defExtra [data-dbool="overleech"]'); await blur();
    assert(await ev(() => C().def.evade === 35 && C().def.suppress === 60 && ptakenTotal() === 15 && C().def.leech === 900 && C().def.overleech === true), 'typed values saved (evade, suppression, taken-as total 15, leech + overleech)');

    // ---- Mind Over Matter pool math
    await setDefs({ life: 1000, es: 500 }); await page.fill('#dMana', '1000'); await blur();
    assert(await ev(() => effPool()) === 1500, 'MoM off: pool = life + ES = 1500');
    await page.check('#defExtra [data-dbool="mom"]'); await raf();
    assert(await ev(() => effPool()) === 2167, 'MoM on, plenty of mana: ES 500 + life ÷ 0.6 (1667) = 2167');
    assert(/MoM effective 2167/.test(await txt('#poolTarget')) && /÷ 0\.6/.test(await txt('#momNote')), 'panel shows the effective pool and the math: ' + await txt('#momNote'));
    await page.fill('#dMana', '200'); await blur();
    assert(await ev(() => effPool()) === 1700 && /mana runs out first/.test(await txt('#momNote')), 'MoM, little mana: ES 500 + life + mana (1200) = 1700, “mana runs out first”');
    await ev(() => { defProfile().on.mom = false; save(); renderDefense(); });
    assert(await ev(() => effPool()) === 1500, 'MoM stat switched off in Configure → back to life + ES');
    await ev(() => { defProfile().on.mom = true; save(); renderDefense(); });
    await page.fill('#dMana', '1000'); await blur();

    // ---- tiers: editing a threshold changes the verdict
    await ev(() => { C().campaign.done.M13 = true; C().band = 1; setDef('ele', true); setDef('over', false); setDef('chaos', 10); setDef('life', 2500); setDef('es', 500); setDef('mana', 2000); });
    await ev(() => { defProfile().on.chaos = true; save(); renderDefense(); });
    let cf = await txt('#clearedFor');
    assert(/Cleared for T1–5/.test(cf), 'maps, capped, chaos 10, MoM pool 4667 → Map entry: ' + cf);
    assert(/T6\+/.test(await txt('#gateList')) && /pool 4667 < 5000/.test(await txt('#gateList')), 'T6+ lists the 5000 pool (MoM effective pool used)');
    await page.click('#btnConfigure'); await sec('tiers');
    assert((await page.locator('.tiertab th').count()) === 7, 'tier table: Map entry, T6+, T11+, T15+, Pinnacle boss ready, Uber ready');
    await shotCfg('v52_config_tiers.png');
    await pdo('tier pool edit', '[data-treq="G01|pool|n"]', 'set', '5000');
    await pdo('close', '#btnCfgClose');
    cf = await txt('#clearedFor');
    assert(/Not cleared for maps yet/.test(cf) && /pool 4667 < 5000/.test(await txt('#gateList')), 'Map entry pool raised to 5000 → “Not cleared for maps yet”');
    await page.click('#btnConfigure'); await sec('tiers');
    await pdo('tier pool edit', '[data-treq="G01|pool|n"]', 'set', '3000');
    await pdo('tier evade', '[data-treq="G01|evade|n"]', 'set', '40');
    await pdo('close', '#btnCfgClose');
    assert(/Not cleared/.test(await txt('#clearedFor')) && /evade chance 35 < 40%/.test(await txt('#gateList')), 'new stat requirement (evade ≥ 40) shows in the missing list');
    await page.fill('#defExtra [data-dnum="evade"]', '45'); await blur();
    assert(/Cleared for T1–5/.test(await txt('#clearedFor')), 'evade 45 → cleared again');
    await ev(() => { setDef('fire', 78); setDef('cold', 76); setDef('lightning', 77); });
    await page.locator('#defense').screenshot({ path: path.join(OUT, 'v52_defense_extra_stats.png') });
    // copy / reset
    await page.click('#btnConfigure'); await sec('tiers');
    await page.click('#btnTierReset'); await raf();
    assert(await ev(() => !defProfile().custom && defProfile().tiers[0].req.pool === 3000 && defProfile().tiers[0].req.evade == null && !defProfile().on.evade), 'Reset to defaults');
    await page.selectOption('#cfgCopyFrom', { label: 'Defaults for ED Occultist' }); await page.click('#btnCfgCopy'); await raf();
    assert(await ev(() => defProfile().tiers[2].req.pool === 6000 && defProfile().tiers[2].req.block === 50), 'copy from another build (ED Occultist: T11 6000 + spell block 50)');
    await page.click('#btnTierReset'); await raf();

    // ---- drop & event triggers: add / edit / disable / remove
    await sec('triggers');
    await shotCfg('v52_config_triggers.png');
    assert(await page.locator('[data-tydel="eDeath"]').count() === 0 && await page.locator('[data-tyon="eDeath"]').count() === 1, 'built-in Death: can be turned off, has no delete');
    assert(/marks the character dead/.test(await txt('tr[data-ctid="eDeath"]')) && /counts as a near-death/.test(await txt('tr[data-ctid="eNear"]')), 'each trigger says what it does');
    await page.fill('#cfgTyName', 'Headhunter'); await page.fill('#cfgTyAlias', 'hh');
    await pdo('add type', '#cfgTypeAdd button[type=submit]');
    let hh = await ev(() => types().find((t) => t.name === 'Headhunter'));
    assert(hh && hh.kind === 'drop' && hh.aliases.includes('hh'), 'type added with its phrase');
    await sleep(200);
    r = await say('dropped a headhunter');
    assert(await ev(() => S.log[0].type === types().find((t) => t.name === 'Headhunter').id), 'voice logs the new type (companion synced): ' + r.say);
    await pdo('alias edit', `[data-tyalias="${hh.id}"]`, 'set', 'hh, head hunter');
    await pdo('alert on', `[data-tyalert="${hh.id}"]`, 'check', true);
    await pdo('say edit', `[data-tysay="${hh.id}"]`, 'set', 'Stash it now');
    hh = await ev(() => types().find((t) => t.name === 'Headhunter'));
    assert(hh.aliases.includes('head hunter') && hh.alert && hh.say === 'Stash it now', 'phrases / alert / spoken text edited');
    await sleep(200);
    r = await say('found a head hunter');
    assert(/Stash it now/.test(r.say || '') && /Headhunter/.test(await txt('#toast')), 'edited type: spoken extra + alert: ' + r.say);
    await pdo('type off', `[data-tyon="${hh.id}"]`, 'check', false);
    assert(await ev(() => matchType('dropped a headhunter') === null), 'turned off → no longer matched');
    await pdo('type on', `[data-tyon="${hh.id}"]`, 'check', true);
    await pdo('delete type', `[data-tydel="${hh.id}"]`);
    assert(await ev(() => !types().some((t) => t.name === 'Headhunter')), 'custom type deleted');

    // ---- the near-death rule (migrated S03 behaviour)
    await sec('rules');
    assert(await ev(() => rules().length === 1 && rules()[0].id === 'near2' && rules()[0].count === 2 && rules()[0].windowMin === 30 && rules()[0].mergeSec === 90), 'built-in rule: 2 near-deaths / 30 min, 90 s = one incident');
    await page.click('#btnCfgClose');
    r = await say('near death');
    assert(/First in 30 min/.test(r.say || '') && !/Stop for the night/.test(await txt('#taskList')), 'first near-death: drop a band, no stop yet: ' + r.say);
    r = await say('near death');
    assert(/same incident/.test(r.say || ''), 'second within 90 s = same incident');
    await ev(() => { for (const l of S.log) if (l.fx === 'near') l.ts -= 5 * 60000; C().campaign.start -= 10 * 60000; save(); });
    r = await say('near death');
    assert(/2 near-deaths in 30 min: END THE SESSION \(S03\)/.test(r.say || ''), 'second incident → “END THE SESSION” spoken: ' + r.say);
    assert(/Stop for the night \(S03\)/.test(await txt('#taskList')) && /2 near-deaths within 30 min\. Stash insurance items/.test(await txt('#taskList')), 'Next Up: Stop for the night (unchanged wording)');
    await page.click('#btnConfigure'); await sec('rules');
    assert(/FIRING/.test(await txt('#cfgBody')), 'rules page shows it firing');
    await shotCfg('v52_config_rules.png');
    await pdo('rule count', '[data-rid="near2"] [data-rf="count"]', 'set', '3');
    await page.click('#btnCfgClose');
    assert(!/Stop for the night/.test(await txt('#taskList')), 'count raised to 3 → no stop task');
    await page.click('#btnConfigure'); await sec('rules');
    await pdo('rule window session', '[data-rid="near2"] [data-rf="windowMin"]', 'set', '0');
    await pdo('rule count', '[data-rid="near2"] [data-rf="count"]', 'set', '2');
    await pdo('rule alert', '[data-rid="near2"] [data-rf="alert"]', 'check', true);
    assert(await ev(() => nearRule().windowMin === 0 && ruleCount(nearRule()) === 2), 'window “this session” counts both incidents');
    await page.click('#btnCfgClose');
    assert(/2 near-deaths within this session/.test(await txt('#taskList')), 'Next Up wording follows the window');
    await page.click('#btnConfigure'); await sec('rules');
    await page.click('[data-rid="near2"] [data-rreset]'); await raf();
    assert(await ev(() => JSON.stringify(nearRule()) === JSON.stringify(RULE_DEFAULTS[0])), 'Reset puts the built-in rule back');
    await pdo('rule off', '[data-rid="near2"] [data-rf="enabled"]', 'check', false);
    await page.click('#btnCfgClose');
    assert(!/Stop for the night/.test(await txt('#taskList')), 'rule turned off → no stop task');
    await page.click('#btnConfigure'); await sec('rules');
    await page.click('[data-rid="near2"] [data-rreset]'); await raf();
    // custom rule: 2 deaths-type events (Reached T6 used as a stand-in event type) → alert
    await page.click('#btnRuleAdd'); await raf();
    const rid = await ev(() => rules().at(-1).id);
    await pdo('rule match', `[data-rid="${rid}"] [data-rf="match"]`, 'set', 'type:eT6');
    await pdo('rule count', `[data-rid="${rid}"] [data-rf="count"]`, 'set', '1');
    await pdo('rule title', `[data-rid="${rid}"] [data-rf="title"]`, 'set', 'Celebrate');
    await page.click('#btnCfgClose');
    r = await say('reached T6');
    assert(/Celebrate/.test(await txt('#toast')) && /Celebrate/.test(await txt('#taskList')), 'custom rule fires: alert + Next Up');
    await page.click('#btnConfigure'); await sec('rules');
    await page.click(`[data-rid="${rid}"] [data-rdel]`); await raf();
    assert(await ev((id) => !rules().some((x) => x.id === id), rid) && await page.locator('[data-rid="near2"] [data-rdel]').count() === 0, 'custom rule deleted; built-in has no delete');

    // ---- General
    await sec('general');
    await shotCfg('v52_config_general.png');
    await pdo('pace alt', '[data-cfgpace="alt"]');
    await pdo('text 110', '[data-cfgtext="110"]');
    await pdo('hide wiki panel', '[data-cfgshow="wiki"]', 'check', false);
    assert(await ev(() => S.paceCfg.preset === 'alt' && S.ui.textPct === 110 && layout().hidden.includes('wiki')), 'General: pace, text size and panels from the page');
    assert(await page.isVisible('#textSize') && await page.isVisible('#layoutMenu'), 'quick controls stay in the header');
    await pdo('show wiki panel', '[data-cfgshow="wiki"]', 'check', true);
    await page.click('[data-cfgtext="100"]');
    assert(/Connected/.test(await txt('#cfgBody')), 'companion status shown');
    await page.click('#btnCfgClose');

    // ================= backup / restore / migration
    const bk = await ev(() => JSON.stringify(exportObj()));
    const st = JSON.parse(bk).state;
    assert(st.char.defProfile && st.rules && st.wikiCache && st.cfg, 'Download backup carries the profile, rules, wiki cache and options');
    await ev(() => { defProfile().tiers[0].req.pool = 1234; rules()[0].count = 9; save(); });
    await ev((t) => restoreFile(t, 'b.json'), bk);
    assert(await ev(() => defProfile().tiers[0].req.pool === 3000 && rules()[0].count === 2), 'Restore brings them back');
    // a v5.1 save (no profile, no rules, chase items never looked up)
    await ev(() => { const s = JSON.parse(localStorage.getItem(STORE_KEY)); delete s.rules; delete s.cfg; delete s.wikiCache; delete s.v52; delete s.char.defProfile; for (const x of s.char.chase) { delete x.wiki; delete x.wikiChecked; delete x.wikiManual; delete x.wikiGeneric; } localStorage.setItem(STORE_KEY, JSON.stringify(s)); });
    await page.reload(); await ready();
    const mig = await ev(() => ({ log: S.log.length, near: nearRule() && nearRule().count, tiers: defProfile().tiers.map((t) => t.req.pool), chase: C().chase.length }));
    assert(mig.near === 2 && JSON.stringify(mig.tiers) === JSON.stringify([3000, 5000, 5000, 5500, 6500, 8000]) && mig.log > 5, 'v5.1 → v5.2: defaults filled in, nothing lost: ' + JSON.stringify(mig));
    await page.waitForFunction(() => document.querySelectorAll('#chase a.clink').length >= 2, null, { timeout: 8000 });
    assert(true, 'v5.1 chase items get their links after the upgrade');
    await page.locator('#chase').screenshot({ path: path.join(OUT, 'v52_chase_links_after_upgrade.png') });

    const worst = lat.reduce((m, x) => (x[1] > m[1] ? x : m), ['', 0]);
    console.log('latencies ms:', lat.map((x) => x.join(' ')).join(', '));
    assert(worst[1] < 400, `every interaction < 400 ms (max ${worst[1]} ms: ${worst[0]})`);
    assert(errors.length === 0, 'no page errors ' + errors.join(' | '));
    console.log(`\n${n} v5.2 e2e checks passed`);
  } catch (e) { console.error(e); console.error(srvOut.slice(-1500)); process.exitCode = 1; }
  await browser.close(); srv.kill(); mock.close();
})();
