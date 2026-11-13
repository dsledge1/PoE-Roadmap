// Rebuilds poe_tracker.html from src/ and the plan's triggers.json. Usage: node build.js [path/to/triggers.json]
const fs = require('fs'), path = require('path');
const dir = __dirname, src = (f) => fs.readFileSync(path.join(dir, 'src', f), 'utf8');
// Data lives in data/ (repo layout); the older layout kept it in ../plan/. The first one found wins.
const pick = (...c) => c.find((p) => fs.existsSync(p)) || c[0];
const trigPath = process.argv[2] || pick(path.join(dir, 'data', 'triggers.json'), path.join(dir, '..', 'plan', 'triggers.json'));
const triggers = JSON.parse(fs.readFileSync(trigPath, 'utf8'));
const planPath = pick(path.join(dir, 'data', 'build_plan.json'), path.join(dir, '..', 'plan', 'necro', 'build_plan.json'));
const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
// The example build (voice/make_defaults.py from a PoB) is the default build (voice/make_defaults.py writes src/gen/*.json); the slim tree and Fate data snapshot ride along.
const gen = (f) => { const p = path.join(dir, 'src', 'gen', f); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null; };
const bcfg = gen('default_build.json'), fates = gen('fates.json');
const typesDoc = JSON.parse(fs.readFileSync(path.join(dir, 'voice', 'default_types.json'), 'utf8'));   // v4: one list for the page and the companion
const trees = fs.existsSync(path.join(dir, 'src', 'gen')) ? fs.readdirSync(path.join(dir, 'src', 'gen')).filter((f) => /^tree_.*\.json$/.test(f)) : [];
const treeJs = '{' + trees.map((f) => JSON.stringify(f.slice(5, -5)) + ':' + gen(f)).join(',') + '}';
const js = `const DEFAULT_TRIGGERS = ${JSON.stringify(triggers)};\nconst BUILD_PLAN = ${JSON.stringify(plan)};\n` +
  (bcfg ? `const DEFAULT_BUILD_CFG = ${bcfg};\n` : '') + `const TREE_DATA = ${treeJs};\n` + (fates ? `const FATE_DATA = ${fates};\n` : '') + `const DEFAULT_TYPES = ${JSON.stringify(typesDoc.types)};\n` +
  src('data.js') + src('app.js') + src('types.js') + src('chase.js') + src('layout.js') + src('links.js') + src('bosses.js') + src('render.js') + src('voice.js') + src('v5.js') + src('config.js') + src('v53.js') + src('bind.js');
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PoE 3.30 HC SSF Tracker</title>
<!-- Built ${new Date().toISOString()} from src/ + data/triggers.json. Manual logging only: no game interaction. -->
<style>${src('style.css')}</style></head><body>
${src('body.html')}
<script>
"use strict";
${js.replace(/<\/script/gi, '<\\/script')}
</script></body></html>
`;
fs.writeFileSync(path.join(dir, 'poe_tracker.html'), html);
console.log('wrote poe_tracker.html', html.length, 'bytes,', triggers.triggers.length, 'triggers,', bcfg ? JSON.parse(bcfg).sets.length + ' skill sets' : 'no default build', '· trees', trees.join(' '), fates ? '· fates snapshot' : '', '·', typesDoc.types.length, 'default types');
