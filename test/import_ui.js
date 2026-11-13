// Import controls: each one says exactly what it accepts, file pickers have matching `accept`, and the wrong file or text
// gets a friendly message (file:// page). Then the real path through the companion: a .xml file picked in Links & tree imports.
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'), zlib = require('zlib'), url = require('url');
const ENV = require('./env');
let n = 0; const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); n++; console.log('ok -', m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const XML = fs.readFileSync(ENV.root('docs', 'examples', 'example_pob.xml'), 'utf8');
const file = (name, text) => { const p = ENV.tmp(name); fs.writeFileSync(p, text); return p; };

(async () => {
  const browser = await chromium.launch(ENV.launchOpts);
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1100 }, acceptDownloads: true })).newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  const lat = [];
  const timed = async (fn) => { const t0 = Date.now(); await fn(); await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r()))); lat.push(Date.now() - t0); };
  const txt = (sel) => page.locator(sel).innerText();
  let srv;
  try {
    await page.goto(url.pathToFileURL(ENV.root('poe_tracker.html')).href);
    await page.click('#btnOwnPob');
    // ---- labels, helpers, accept attributes, guide link
    assert(/Accepts: PoB export code, pobb\.in or poe\.ninja\/pob link, or \.xml file/.test(await txt('#pobAccepts')), 'PoB import says what it accepts');
    assert(/Import profile accepts: \.json profile exported from this tracker/.test(await txt('#profileAccepts')), 'profile import says what it accepts');
    assert(await page.getAttribute('#filePob', 'accept') === '.xml,text/xml,application/xml', 'PoB file picker accept = .xml');
    assert(await page.getAttribute('#fileProfile', 'accept') === '.json,application/json', 'profile picker accept = .json');
    assert(await page.getAttribute('#fileBcfg', 'accept') === '.json,application/json', 'build config picker accept = .json');
    assert((await txt('#btnPobImport')) === 'Import PoB' && (await txt('#btnPobFile')) === 'Choose .xml file' && (await txt('#btnProfileImport')) === 'Import profile (.json)', 'button labels name the input');
    const hrefs = await page.$$eval('a[href$="docs/POB_GUIDE.md"]', (as) => as.map((a) => a.closest('#pobImport,#charsec') && a.closest('#pobImport,#charsec').id));
    assert(hrefs.includes('pobImport') && hrefs.includes('charsec'), 'PoB guide linked under both controls');
    assert(/PoB export code, pobb\.in or poe\.ninja\/pob link/.test(await page.getAttribute('#btnOwnPob', 'title')), '“Use my own PoB” tooltip names the inputs');

    // ---- wrong files on the PoB import
    const profile = await page.evaluate(() => JSON.stringify(profileObj()));
    const bcfg = await page.evaluate(() => JSON.stringify(BCFG));
    await timed(() => page.setInputFiles('#filePob', file('my_profile.json', profile)));
    await page.waitForFunction(() => /JSON/.test(document.getElementById('pobStatus').innerText));
    let s = await txt('#pobStatus');
    assert(/That's JSON, not a Path of Building build/.test(s) && /Character → Import profile/.test(s), '.json profile on the PoB import → points to Import profile: ' + s);
    await timed(() => page.setInputFiles('#filePob', file('cfg.json', bcfg))); await sleep(50);
    assert(/Load build config/.test(await txt('#pobStatus')), '.json build config on the PoB import → points to Load build config');
    await timed(() => page.setInputFiles('#filePob', file('notes.txt', 'hello'))); await sleep(50);
    assert(/A \.txt file can't be imported as a PoB/.test(await txt('#pobStatus')), '.txt on the PoB import → friendly error');
    await timed(() => page.setInputFiles('#filePob', file('other.xml', '<?xml version="1.0"?><svg></svg>'))); await sleep(50);
    assert(/isn't a Path of Building build/.test(await txt('#pobStatus')), 'non-PoB .xml → friendly error');
    // ---- wrong text pasted
    for (const [text, re, label] of [[profile, /That's JSON/, 'pasted JSON'], ['https://maxroll.gg/poe/pob/abc123', /Only pobb\.in and poe\.ninja\/pob links work/, 'other site link'],
      ['hello there', /doesn't look like a PoB export code/, 'random text'], ['', /Nothing to import yet/, 'empty box']]) {
      await page.fill('#pobText', text); await timed(() => page.click('#btnPobImport'));
      assert(re.test(await txt('#pobStatus')), `${label} → ${await txt('#pobStatus')}`);
    }
    // ---- valid inputs pass the checks (file:// has no companion, so they stop at the companion notice)
    const code = zlib.deflateSync(Buffer.from(XML)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
    for (const [text, label] of [[code, 'export code'], ['https://pobb.in/AbC123xyz', 'pobb.in link'], ['poe.ninja/pob/xyz9', 'poe.ninja link'], [XML, 'XML text']]) {
      await page.fill('#pobText', text); await timed(() => page.click('#btnPobImport'));
      assert(/Import runs in the companion/.test(await txt('#pobStatus')), `valid ${label} accepted (goes to the companion)`);
    }
    await timed(() => page.setInputFiles('#filePob', file('example_pob.xml', XML))); await sleep(50);
    assert(/Import runs in the companion/.test(await txt('#pobStatus')) && (await page.inputValue('#pobText')).includes('<PathOfBuilding'), 'valid .xml file accepted and shown in the box');
    // ---- drop a .json on the PoB import
    await page.evaluate((t) => { const dt = new DataTransfer(); dt.items.add(new File([t], 'dropped.json', { type: 'application/json' })); const el = document.getElementById('pobImport');
      el.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true })); el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }, profile);
    await sleep(100);
    assert(/That's JSON/.test(await txt('#pobStatus')), 'dropped .json on the PoB import → friendly error');

    // ---- wrong files on the profile import
    await timed(() => page.setInputFiles('#fileProfile', file('build.xml', XML))); await sleep(50);
    s = await txt('#profileStatus');
    assert(/That's a \.xml file, probably a Path of Building build/.test(s) && /Use my own PoB/.test(s), '.xml on the profile import → points to Use my own PoB: ' + s);
    await timed(() => page.setInputFiles('#fileProfile', file('cfg2.json', bcfg))); await sleep(50);
    assert(/isn't a tracker profile/.test(await txt('#profileStatus')) && /Load build config/.test(await txt('#profileStatus')), 'build config on the profile import → points to Load build config');
    const backup = await page.evaluate(() => JSON.stringify(exportObj()));
    await timed(() => page.setInputFiles('#fileProfile', file('backup.json', backup))); await sleep(50);
    assert(/Import log/.test(await txt('#profileStatus')), 'full backup on the profile import → points to Import log');
    await timed(() => page.setInputFiles('#fileProfile', file('broken.json', '{"kind": "profile",'))); await sleep(50);
    assert(/isn't valid JSON/.test(await txt('#profileStatus')), 'broken JSON → friendly error');
    await timed(() => page.setInputFiles('#fileProfile', file('code.txt', code))); await sleep(50);
    assert(/A \.txt file can't be loaded here/.test(await txt('#profileStatus')), '.txt on the profile import → friendly error');
    await timed(() => page.setInputFiles('#fileBcfg', file('build2.xml', XML))); await sleep(50);
    assert(/Use my own PoB/.test(await txt('#pobStatus')), '.xml on Load build config → points to Use my own PoB');
    // ---- the right profile still loads
    await timed(() => page.setInputFiles('#fileProfile', file('good_profile.json', profile))); await sleep(100);
    assert((await txt('#profileStatus')) === '' && /Profile loaded/.test(await txt('#toast')), 'a real profile still imports and clears the message');

    // ---- through the companion: a .xml file picked in Links & tree really imports
    const PORT = 8794;
    fs.writeFileSync(ENV.tmp('voice_cfg_import.json'), JSON.stringify({ port: PORT, tracker_html: '../poe_tracker.html', tts: false, speak_typed: false, research: { backend: 'none' } }));
    srv = spawn(ENV.PY, [ENV.root('voice', 'companion.py'), '--no-audio', '--no-browser', '--no-tts', '--port', String(PORT), '--config', ENV.tmp('voice_cfg_import.json')],
      { stdio: 'ignore', env: { ...process.env, POE_COMPANION_LOG_DIR: ENV.tmp('logs') } });
    for (let i = 0; i < 80; i++) { try { await fetch(`http://127.0.0.1:${PORT}/api/health`); break; } catch { await sleep(250); } }
    await page.goto(`http://127.0.0.1:${PORT}/`); await page.waitForFunction(() => VOICE.served, null, { timeout: 8000 });
    await page.click('#btnOwnPob');
    await page.setInputFiles('#filePob', file('example_pob.xml', XML));
    await page.waitForFunction(() => /Build imported|Necromancer \(PoB\)/.test(document.getElementById('pobStatus').innerText + document.getElementById('toast').innerText), null, { timeout: 8000 });
    const got = await page.evaluate(() => ({ n: BCFG.sets.length, a5: BCFG.sets[BCFG.stages.A5.variants[0].set].clean }));
    assert(got.n === 5 && got.a5 === 'Act 3-10', 'served: example .xml imports (5 skill sets; Act 5 uses “Act 3-10”) → ' + JSON.stringify(got));

    console.log('import UI latencies ms:', lat.join(','));
    assert(Math.max(...lat) < 400, `every import interaction < 400 ms (max ${Math.max(...lat)})`);
    assert(errors.length === 0, 'no page errors ' + errors.join(' | '));
    console.log(`\n${n} import UI checks passed`);
  } catch (e) { console.error(e); process.exitCode = 1; }
  await browser.close(); if (srv) srv.kill();
})();
