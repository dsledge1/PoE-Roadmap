// Shared test settings. Override with env vars: CHROME_PATH (Chrome/Chromium/Edge binary), PY (Python with voice/requirements),
// POE_TEST_TMP (scratch folder), POE_TEST_OUT (where UI screenshots go).
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const TMP = process.env.POE_TEST_TMP || path.join(os.tmpdir(), 'poe-tracker-test');
const OUT = process.env.POE_TEST_OUT || path.join(TMP, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const CHROME = process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find((p) => fs.existsSync(p));
const PY = process.env.PY || (process.platform === 'win32' ? path.join(ROOT, 'voice', '.venv', 'Scripts', 'python.exe') : 'python3');
const launchOpts = { executablePath: CHROME, args: ['--no-sandbox'] };
module.exports = { ROOT, TMP, OUT, CHROME, PY, launchOpts, tmp: (f) => path.join(TMP, f), root: (...p) => path.join(ROOT, ...p) };
