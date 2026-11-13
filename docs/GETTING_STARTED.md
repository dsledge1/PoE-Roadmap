# Getting Started

This gets you from a download to a working tracker with voice, screenshot reading and your own build. It takes about 15 minutes, most of it waiting for `setup.bat`.

## 1. Download
Pick one:
- **ZIP:** on the [repo page](https://github.com/dsledge1/PoE-Roadmap), click **Code → Download ZIP** and unzip it somewhere permanent, e.g. `C:\PoE\PoE-Roadmap\`.
- **git:** `git clone https://github.com/dsledge1/PoE-Roadmap.git`

Keep the folder layout as it is: `poe_tracker.html` and the `voice\` folder must sit side by side.

## 2. Install (once)
You need **Python 3.10 or newer** from [python.org](https://www.python.org/downloads/windows/) (tick "Add python.exe to PATH" in the installer).

Double-click **`voice\setup.bat`**. It:
1. creates a private Python environment in `voice\.venv` (nothing is installed system-wide),
2. installs the packages from `voice\requirements.txt`, including NVIDIA's CUDA libraries for GPU speech recognition,
3. downloads the Whisper speech model (about 600 MB, one time),
4. runs a GPU and mic check.

Look for a line like `small.en on cuda (float16)`. If it says `cpu`, voice still works; it's about a second slower per command.

## 3. Start it (every session)
Double-click **`voice\run.bat`**. A console window opens and your browser opens **http://127.0.0.1:8765/**. Keep both open (you can minimise them). The tracker header shows `● Voice ready · hold F9` when the companion is listening.

Always use the http://127.0.0.1:8765/ address. Your data is stored per address in the browser, so a copy of `poe_tracker.html` opened from disk (`file://`) has its own, separate data. To move data across, use **Export** in one and **Import log** in the other.

Without the companion you can still open `poe_tracker.html` from disk and type or click everything. PoB import, F10, voice and research need the companion.

## 4. Choose your microphone
By default the companion uses the Windows default input device (Settings → System → Sound → Input).

To pick a specific mic instead:
1. List your mics: open a terminal in the `voice` folder and run `.venv\Scripts\python.exe companion.py --list-mics`.
2. Open `voice\config.json` (created on the first run; `voice\config.example.json` shows every setting) and set `mic_device` to part of the mic's name, e.g. `"mic_device": "USB"` or `"mic_device": "Headset"`.
3. Restart `run.bat`.

Tips: speak a few centimetres from the mic, and make sure the mic isn't muted on the device itself. Quiet dynamic mics are boosted automatically.

## 5. Push-to-talk (F9) and screenshot reading (F10)
- **F9:** hold it, say what happened, let go. You hear a beep and a short readback, and the tracker updates. You never need to look at the tracker.
- **F10:** open the character sheet's **Defences** tab in game (or Path of Building with the sidebar visible) and press F10. The companion reads the left side of the screen locally and shows what it found. Say **"confirm"** (or click Apply) to use it, or **"discard"**. On the Offence tab it tells you to switch to Defences.
- You can also paste a screenshot into the tracker page with **Ctrl+V** (take one with Win+Shift+S).

Both keys are listen-only: the game still receives them and nothing is sent to the game. Pick keys PoE has nothing bound to; change them with `hotkey` and `ocr_hotkey` in `voice\config.json` (`f8`, `scroll_lock`, `pause`, `insert`, `mouse:x1`, `mouse:x2`, `mouse:middle` also work).

## 6. Optional: OpenAI key for research answers
"Research …" always reads the poewiki page first. With an OpenAI key, a small model turns that page into a short spoken answer. Without one, you get the wiki's own summary.

Set the key once as a user environment variable (never put it in a file):
```
setx OPENAI_API_KEY "sk-your-key-here"
```
Then close and reopen `run.bat`. Check it with:
```
voice\.venv\Scripts\python.exe voice\companion.py --check-llm
```
It prints ok or fail and never prints the key. The model and endpoint are set in `research.openai_compatible` in `voice\config.json`; `research.backend` can also be `ollama` (local) or `none` (wiki only).

## 7. First run: make it yours
The tracker starts with the **Example build: Frostbearer Spectre Necromancer**. To switch to your own:

1. **Start fresh for another player** (Advanced). Use this if someone else has used the tracker in this browser. It asks twice, then clears this browser's tracker data. Skip it on a brand-new install.
2. **Import PoB build** (top of the page). It accepts a **PoB export code, pobb.in or poe.ninja/pob link, or .xml file**:
   - paste an export code (Path of Building → Import/Export Build → Generate → Copy) or a pobb.in / poe.ninja/pob link and press **Import PoB build**, or
   - choose the `.xml` (or drop it on the box) from `Documents\Path of Building\Builds\`.

   Any PoB works: act-titled, level-titled or name-titled skill sets, or just a single tree. The status line shows how each stage was mapped, and **Edit stage mapping** lets you fix anything by hand. For a clean mapping straight away, see **[Making your PoB compatible](POB_GUIDE.md)**.
3. **Name your character** in the Character section. Edit your drop and event types and your Power Chase list. **⚙ Configure** sets your defense stats, tier checks, rules and pace.
4. **Download backup** saves one `.json` with your log, characters, build and settings. **Restore backup** (Advanced) loads one. Use it to move to another PC.

Drop the wrong file on one of these and the tracker tells you which button it belongs to.

## Voice command cheat sheet
Every phrase below is checked against the parser (`voice/companion.py`, `voice/intents_v4.py`) by `voice/test_cheatsheet.py`. Several things in one breath work: "act 10 done, res not capped, chaos 40". Anything not understood is saved as a note with your exact words, so nothing is lost.

**Campaign and timer**
| Say | Does |
|---|---|
| "act 3 done", "Malachai down", "act 5 Kitava done", "lab done", "started mapping" | marks milestones (skipped ones are filled in) |
| "I'm in act 2, not act 3", "set act to 4" | corrects the act |
| "pause timer", "taking a break" / "resume", "I'm back" | pauses the league timer |
| "what's next", "how am I doing" | next step, pace |

**Defences**
| Say | Does |
|---|---|
| "fire 75 cold 75 lightning 60 chaos minus 20", "res are 76 75 75" | sets every res at once |
| "life 4000 and energy shield 1200", "pool 5200", "level 44" | life, ES, pool, level |
| "attack block 20", "spell block 15" | block |
| "what are my res" | reads them back with what's uncapped |
| "scan my defences" (or F10), then "confirm" / "discard" | screenshot reading |

**Links (from your PoB)**
| Say | Does |
|---|---|
| "what are my links", "act 1 main attack", "what's my movement" | links for the current or named stage |
| "utility links in act 5", "early maps main attack", "what are my spectres" | by category and stage |
| "main attack links only" (right after a links answer) | filters the last answer |

**Drops, events and Fates**
| Say | Does |
|---|---|
| "dropped a 4 link", "found a 5 link", "near death", "I died", "reached tier 6" | logs a drop or event |
| "add drop type mirror shard", "add event type boss down", "rename drop type X to Y", "delete drop type X" | edits your types |
| "Fate boss Merveil", "fate reward for Merveil" | opens that boss in the Fate panel and reads its rewards |
| "going to try Merveil with 1 fate", "killed Brutus with one fate" | Fate attempts and kills |

**Power Chase**
| Say | Does |
|---|---|
| "add chase item Shavronne's Wrappings from Delve" | adds an item with its content type |
| "chase done Darkness Enthroned" | ticks it off |
| "what's left on my chase" | reads what's left |

**Research and control**
| Say | Does |
|---|---|
| "research Desecrate", "look up Bones of Ullr", "wiki Forged Frostbearer" | poewiki lookup (plus OpenAI if set). Only these keywords trigger a lookup |
| "where does the Cane of Kulemak drop", "vendor recipe for a physical weapon" | drop-source question (never logs a drop), vendor recipe lookup |
| "any news on Fates?" | explains it only reads poewiki and poedb |
| "yes" (after "Want me to look that up?") | runs the offered lookup |
| "undo", "never mind", "repeat that", "mute" / "unmute" | control |

More phrasings and details: [`voice/README.md`](../voice/README.md#things-you-can-say).

## Troubleshooting
Run these from the `voice` folder (`.venv\Scripts\python.exe companion.py …`):

| Problem | Try |
|---|---|
| Voice never hears you | `--list-mics`, then set `mic_device` (step 4). Check the mic isn't muted. `--check` loads Whisper and the mic and prints the timing. |
| F9 does nothing while the game is focused | Run `run.bat` as the same Windows user as PoE, and don't run PoE as administrator. |
| A phrase does the wrong thing | `--parse "act 3 done"` shows what a sentence turns into. "undo" reverts the last command. |
| F10 reads nothing or half the numbers | Use the **Defences** tab, keep the sheet on the left of the screen, or set `"ocr_region": "full"`. `--ocr-selftest` checks the OCR engines. |
| PoB import fails | Check the status line under the box; it says what the box accepts. See the [PoB guide](POB_GUIDE.md). The companion must be running (http://127.0.0.1:8765/). |
| Research says wiki-only | The `OPENAI_API_KEY` variable isn't set for your user, or `run.bat` was started before you set it. `--check-llm` tests it. |
| Setup failed | Scroll up in the setup window for the error. Most often Python isn't on PATH or is older than 3.10. |

**Which log to share:** when you report a problem, attach today's log file, `voice\logs\companion_YYYYMMDD.log` (for example `companion_20261113.log`). It has what was heard, what it did, the readbacks, OCR results and errors. The companion never writes your API key to it, but it does contain everything you said while holding F9, so skim it before posting it publicly. Logs are kept for 14 days.
