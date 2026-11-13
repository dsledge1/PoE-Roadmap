# Changelog

Detailed notes for each version are in [`docs/history/`](docs/history/).

## Unreleased

## 5.3.0 (Nov 13, 2026): league-launch fixes
Lab trials (done / missed, reminders before the lab), "restart timer" starts a new run and keeps the old one, "confirmed" applies a screenshot read, more wiki-link phrasings ("link for X", "wiki X"), Fate reward questions with loose boss names, area and boss-kill tracking for Acts 1–3, OCR misread fixes, and an approximate PoB-style **EHP and max hit** line on the Defense panel. [Details](docs/history/v5.3.md)

## 5.2 (Nov 13, 2026)
The ⚙ Configure page (defense stats, per-tier checks, drop and event triggers, rules, general), new defense stats (MoM, evade, suppression, armour, phys reduction, endurance charges, phys taken as), Power Chase items link to poewiki. [Details](docs/history/v5.2.md)

## 5.1 (Nov 13, 2026)
Any PoB imports (act-, level- or name-titled sets, or a single tree), level-based stage tabs, character level from the F10 screenshot. [Details](docs/history/v5.1.md)

## 5.0 (Nov 13, 2026)
One PoB import button, Download / Restore backup, pace presets, drag-and-drop panels, text size, content colour-coding in Power Chase, "get a 6 link" never becomes Act 6. [Details](docs/history/v5.md)

## 4.1.0 (Nov 13, 2026): first public release
- **Clearer import controls.** Each import says exactly what it accepts: the PoB import takes a "PoB export code, pobb.in or poe.ninja/pob link, or .xml file", and Import profile takes a ".json profile exported from this tracker". New **Choose .xml file** button (and drag and drop) for PoB builds. Every file picker has a matching `accept` filter, each control has a one-line helper and a link to the PoB guide, and the wrong file gets a friendly message that names the right button (e.g. a profile `.json` dropped on the PoB import, or a PoB `.xml` on Import profile). Bad pasted text (JSON, links from other sites, random text) is caught before it's sent.
- **Docs:** README, [Getting Started](docs/GETTING_STARTED.md), [Making your PoB compatible](docs/POB_GUIDE.md) with a worked example ([`docs/examples/example_pob.xml`](docs/examples/example_pob.xml)), CONTRIBUTING.
- **Repo layout:** the default triggers and stage plan moved to `data/`. Tests use relative paths and environment variables instead of machine-specific ones (`test/env.js`). `package.json` for the browser tests. `voice/config.example.json`.
- The embedded default build is labelled "Example build: Frostbearer Spectre Necromancer". `voice/make_defaults.py` takes the PoB as an argument.
- The companion no longer prints a traceback when the browser drops a connection mid-reply (Windows WinError 10053/10054).
- The "any news on…" reply now suggests checking pathofexile.com or Reddit.
- New tests: `test/import_ui.js` (32 checks: labels, accept filters, wrong-file messages, drag and drop, a real `.xml` import through the companion, latency under 400 ms) and `voice/test_cheatsheet.py` (59 cheat-sheet phrases).

## 4.0 (Nov 12, 2026)
Custom drop and event types per character (voice and a small manager), the Power Chase endgame checklist by content type, "Fate boss <name>" opens that boss's entry, Next up above Voice, profile export/import and "Start fresh for another player", the OCR Offence-tab guard, follow-up filters for links answers. [Details](docs/history/v4.md)

## 3.0 (Nov 12, 2026)
Per-stage links and passive tree closeup from your own PoB, act correction by voice ("I'm in act 2, not act 3"), the pool colour rule, attack and spell block, per-boss Fate rewards from poewiki and poedb, OCR fallback to rapidocr, daily log files. [Details](docs/history/v3.md)

## 2.0 (Nov 12, 2026)
Multi-field defence dictation, screenshot import (F10 / paste) with Windows OCR, Kitava penalties, pause/resume, research via poewiki plus an optional OpenAI model, a full 3.30 item name dictionary for the parser. [Details](docs/history/v2.md)

## 1.0 (Nov 12, 2026)
First version: campaign pace, defense checkpoint, drops and trigger actions, voice push-to-talk with local Whisper.
