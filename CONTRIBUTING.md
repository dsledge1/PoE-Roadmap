# Contributing

Thanks for helping. Bug reports, phrasings the parser misses, PoB setups that don't map, and pull requests are all welcome. Forks are welcome too: it's MIT licensed, so make it yours.

## Ground rules
- **Stay TOS-safe.** No reading game memory, no packet inspection, no touching game files, no input automation (no sending keys or clicks, no blocking keys). Screen reading only on a user-triggered screenshot. Pull requests that cross this line won't be merged.
- **Keep it local and private.** No telemetry. Network calls only when the user asks (research, link import, Fate data refresh). API keys come from environment variables only and are never logged, stored or shown.
- **Never commit personal data:** `voice/config.json`, `voice/logs/`, screenshots of your game, your private PoB, or anything with your Windows user path in it. `.gitignore` covers the usual ones; check `git status` before you commit.

## Reporting a problem
Open an issue with:
- what you said or clicked, what you expected, and what happened,
- the relevant lines from `voice\logs\companion_YYYYMMDD.log` (skim it first: it contains everything you said),
- for PoB mapping problems, the import summary from the tracker, and a pobb.in link if you're happy to share the build.

## Project layout
- `src/*.js`, `src/body.html`, `src/style.css`: the tracker page. `build.js` concatenates them, plus `data/triggers.json`, `data/build_plan.json`, `src/gen/*.json` and `voice/default_types.json`, into the single file `poe_tracker.html`.
- `src/gen/`: generated data (the example build, a slim passive tree, a Fate data snapshot). `python voice/make_defaults.py path/to/build.xml` regenerates it from a PoB; without an argument it keeps the example build and refreshes the tree and Fate data.
- `voice/companion.py`: the local server (http://127.0.0.1:8765/), push-to-talk, Whisper, the voice parser and text-to-speech. `voice/intents_v4.py` holds the v4 intents, `ocr.py` the screenshot reader, `research.py` the poewiki/OpenAI lookup, `pob_import.py` the PoB importer, `fates.py` the Fate data.
- `voice/pobdata/`: tree and gem data exported from Path of Building with `tools/dump_pob_data.lua`.

## Build
```
node build.js
```
Always rebuild and commit `poe_tracker.html` together with your `src/` changes, so people who download the repo get a working page.

## Tests
Python (from `voice/`, with the venv from `setup.bat` or any Python 3.10+ with `voice/requirements.txt` installed):
```
python test_parser.py
python test_parser_holdout.py
python test_parser_v3.py
python test_parser_v4.py
python test_rare_names.py
python test_cheatsheet.py
python test_ocr.py            # image stage needs Pillow + rapidocr-onnxruntime
python test_research.py --offline
python test_v3_data.py
python test_v5.py
python test_v51.py
python test_v52.py
python test_v53.py           # v5.3: the Act 1-2 playtest phrases, lab trials, timer reset, Fate questions, areas and boss kills
```
Browser tests use Playwright with your installed Chrome, Chromium or Edge:
```
npm install
npm test                      # test/test.js (tracker page) + test/import_ui.js (import controls)
npm run test:e2e              # voice_e2e, v4, v5, v5.1, v5.2, v5.3 e2e: start the companion with --no-audio and a mock wiki/LLM (v5.3 includes the EHP hand-checks)
```
Settings for the tests (environment variables): `CHROME_PATH` (browser binary, if not found automatically), `PY` (Python with the voice requirements; default `python3`, or `voice\.venv\Scripts\python.exe` on Windows), `POE_TEST_TMP` (scratch folder), `POE_TEST_OUT` (UI screenshots). Set `POE_COMPANION_LOG_DIR` to a temp folder so test runs don't write into `voice/logs`. `npm run screenshot` regenerates `docs/screenshot.png`.

Every UI interaction in the browser tests must stay under 400 ms, and the voice parser tests print their timings.

Optional private fixtures, never committed: `POE_REFERENCE_POB=path\to\build.xml` runs the extra importer checks in `test_v3_data.py`, and `POE_OCR_REAL_SAMPLE=path\to\defences.png` adds a real-screenshot OCR check to `test_ocr.py` (`POE_OCR_LV4` / `POE_OCR_LV97` for Character-panel screenshots). `POE_PRIVATE_POB=path\to\build.xml` adds your own PoB to `test_v51.py`, `test/v5_e2e.js` and `test/v51_e2e.js`. `OCR_PY` (a Python with Pillow + rapidocr) turns on the image checks in `test/v51_e2e.js`.

## Adding a voice phrase
1. Add the phrase and its expected actions to the matching `voice/test_parser*.py` (or `test_cheatsheet.py` if it belongs in the docs).
2. Change the parser in `companion.py` / `intents_v4.py` until all parser tests pass again, including the holdout set.
3. If players should know about it, add it to the cheat sheet in `docs/GETTING_STARTED.md` and `voice/README.md`.

## Pull requests
- One topic per PR, with a short description of what changed and how you tested it.
- Run the Python tests and `npm test` before you push.
- Add an entry to `CHANGELOG.md` under "Unreleased".
