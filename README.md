# PoE-Roadmap

Companion application for Path of Exile, meant to be used to keep you on track at a glance through the campaign and as you progress through maps. Can be used to track endgame chase items as well as skill tree and gem slots through campaign. Supports OCR snapshotting of a character's stat page and voice commands to query the PoE Wiki.

It's a single web page (`poe_tracker.html`) plus an optional Windows voice companion (`voice/`). Built for the 3.30 league with Hardcore SSF in mind, but it works for any character you can describe in Path of Building.

![The tracker with the example build loaded](docs/screenshot.png)

*Screenshot: the example build (Frostbearer Spectre Necromancer) with a made-up character, Act 3.*

## Features
- **Campaign pace.** A league timer with 6 h / 7 h / 8 h target columns, a split per act, "ahead / behind" for each pace, gates before moving on, and a pause button.
- **Links & tree per stage.** Import your own Path of Building build and get Maxroll-style link cards for Act 1–10 and early, mid and late maps, sorted by category (main attack, movement, utility, auras, curse, minions). A passive tree closeup shows what's new at each stage in green. See [Making your PoB compatible](docs/POB_GUIDE.md).
- **Defense checkpoint.** Res, life, ES, pool, attack and spell block, Kitava penalties, and a coloured pool target (300 × act in the campaign, 3000 at map start, 5000 from T6).
- **Drops & events.** Your own drop and event types per character ("dropped a 4 link", "found a 5 link", "Fate card"), logged by voice or typed, with trigger actions for important drops.
- **Fate bosses.** Per-boss viscera (Wickerman) rewards from poewiki and poedb, with "currently unknown" where there's no data yet.
- **Power Chase.** An endgame checklist you switch on once you're mapping with capped res. Each item notes the content it comes from (Delve, Legion, Abyss, Atlas boss…) so you know what to farm for which upgrade.
- **Next up.** What to do in the next 15 / 30 / 60 minutes or this session.
- **Voice push-to-talk (optional).** Hold F9 and say what happened: "act 3 done", "fire 75 cold 75 lightning 60", "what are my links?", "Fate boss Merveil". Speech is transcribed on your PC with Whisper. See the [cheat sheet](docs/GETTING_STARTED.md#voice-command-cheat-sheet).
- **Screenshot reading (optional).** Press F10 on the character sheet's Defences tab and the numbers are read locally. Nothing changes until you say "confirm".
- **Research (optional).** "Research Desecrate" reads the poewiki page and, if you set an OpenAI key, gives a 1–3 sentence answer grounded in that page.
- **Profiles.** Export your build, drop and event types and chase list as one `.json` file to share or move to another PC.

## Requirements
- **Windows 10 or 11** for the voice companion. The tracker page alone runs in any modern browser (Chrome, Edge or Firefox).
- **Python 3.10+** for the voice companion (`setup.bat` installs everything else into a private `.venv`).
- **A microphone** for voice. A headset mic is fine.
- **NVIDIA GPU (optional).** Whisper runs on CUDA if you have one; on CPU it's about a second slower per command.
- **Node.js** only if you want to rebuild `poe_tracker.html` from `src/` or run the browser tests. Players don't need it.

## Quick start
1. Download the repo (Code → Download ZIP) or `git clone https://github.com/dsledge1/PoE-Roadmap.git`.
2. Double-click `voice\setup.bat` once (5–10 minutes; downloads the speech model).
3. Double-click `voice\run.bat`. The tracker opens at http://127.0.0.1:8765/.
4. In **Links & tree**, click **Use my own PoB** and paste your PoB export code, a pobb.in or poe.ninja/pob link, or choose your build's `.xml` file.

The full walkthrough, including mic setup and troubleshooting, is in **[Getting Started](docs/GETTING_STARTED.md)**. To set up your PoB so every act finds its links, read **[Making your PoB compatible](docs/POB_GUIDE.md)**.

No voice? Open `poe_tracker.html` straight from disk and type or click instead. PoB import, F10 and research need the companion running.

## Terms of Service safety
PoE-Roadmap is built to stay well clear of anything GGG forbids:
- It only reads **your screen**, and only when **you** press F10 or paste a screenshot, plus **your microphone** while you hold F9.
- It **never reads game memory**, never touches **game packets** or network traffic, and never reads or changes **game files**.
- It **never automates input**. It doesn't send keys or mouse clicks, and it doesn't block or remap keys. The F9/F10 hotkeys are listen-only, the same kind of key hook Discord and OBS use for push-to-talk, so the game still sees the key. Pick keys PoE has nothing bound to.
- Everything it knows about your character, you told it: by voice, by typing, from your own Path of Building export, or from a screenshot you triggered.

## Privacy
- **Everything is local.** Tracker data is stored in your browser's localStorage on your PC. Speech is transcribed on your PC and screenshots are read on your PC. Nothing is uploaded.
- The only network calls are the ones you ask for: "research …" lookups (poewiki.net, poedb.tw), importing a pobb.in or poe.ninja link, and the Fate data refresh (poewiki and poedb, at most every 6 hours).
- **OpenAI is optional.** If you set an `OPENAI_API_KEY` environment variable, research questions send the question plus the poewiki page text to OpenAI. The key is read from the environment only; it's never written to a file, shown in the tracker, or printed. Without a key, research gives the plain poewiki summary.
- Logs (`voice\logs\`) and your settings (`voice\config.json`) stay on your PC and are ignored by git.

## Repository layout
| Path | What it is |
|---|---|
| `poe_tracker.html` | The built tracker page (single file, no dependencies). |
| `src/` | Tracker source. `node build.js` turns it into `poe_tracker.html`. |
| `data/` | Default triggers (`triggers.json`) and the stage plan (`build_plan.json`) that the build embeds. |
| `voice/` | Windows voice companion: `companion.py`, OCR, research, PoB importer, `setup.bat`, `run.bat`, Python tests. |
| `voice/config.example.json` | Every setting with its default. The companion writes `voice\config.json` on first run. |
| `docs/` | [Getting Started](docs/GETTING_STARTED.md), [PoB guide](docs/POB_GUIDE.md), an [example PoB](docs/examples/example_pob.xml), and the per-version notes in `docs/history/`. |
| `test/` | Browser tests (Playwright). |
| `tools/` | Helper for dumping Path of Building data. |

The embedded default build is labelled **"Example build: Frostbearer Spectre Necromancer"**. Replace it with your own PoB from the tracker; you don't need to touch any code.

## Contributing
Issues and pull requests are welcome. Fork it and make it yours. See [CONTRIBUTING.md](CONTRIBUTING.md) for how to build and run the tests, and [CHANGELOG.md](CHANGELOG.md) for what changed.

## Credits
- [poewiki.net](https://www.poewiki.net/) (the community Path of Exile Wiki): research answers and Fate/viscera data.
- [poedb.tw](https://poedb.tw/): mod values and Fate boss data.
- [Path of Building Community](https://github.com/PathOfBuildingCommunity/PathOfBuilding): build format, passive tree and gem data used for the link cards and tree closeup.
- [faster-whisper](https://github.com/SYSTRAN/faster-whisper) for local speech recognition, and [RapidOCR](https://github.com/RapidAI/RapidOCR) as the fallback OCR engine.

Path of Exile is a trademark of Grinding Gear Games. This is a fan-made tool and isn't affiliated with or endorsed by Grinding Gear Games.

## License
[MIT](LICENSE)
