// Makes docs/screenshot.png for the README (example build, made-up character).
const { chromium } = require('playwright-core');
const ENV = require('./env');
(async () => {
  const b = await chromium.launch(ENV.launchOpts);
  const page = await (await b.newContext({ viewport: { width: 1600, height: 1250 } })).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.clock.install({ time: new Date('2026-11-13T19:00:00Z') });
  await page.goto(require('url').pathToFileURL(ENV.root('poe_tracker.html')).href);
  await page.fill('#cName', 'ExampleWitch');
  await page.click('#btnStartLaunch');
  await page.clock.fastForward('48:00'); await page.click('#btnNextMs');
  await page.clock.fastForward('47:00'); await page.click('#btnNextMs');
  await page.clock.fastForward('21:00');
  await page.evaluate(() => { const d = document.getElementById('typesBox'); if (d) d.open = true; }); for (const t of ['Orb of Chance', 'Fugitive Boots', 'rare staff 780 pdps', 'Seething Fury']) { await page.fill('#logInput', t); await page.press('#logInput', 'Enter'); }
  await page.check('#dEle'); await page.fill('#dChaos', '-12'); await page.fill('#dPool', '1650'); await page.fill('#dLevel', '24');
  await page.clock.fastForward('07:00');
  await page.evaluate(() => (document.getElementById('toast').innerHTML = ''));
  await page.evaluate(() => { document.activeElement.blur(); window.scrollTo(0, 0); });
  await page.screenshot({ path: ENV.root('docs', 'screenshot.png'), fullPage: false });
  console.log('errors:', errs);
  await b.close();
})();
