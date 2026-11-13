# PoE tracker voice companion

Hold **F9**, say what happened ("Cane of Unravelling dropped", "act 3 done", "fire 75 cold 75 lightning 60 chaos minus 20",
"what are my links?"), let go. Within about a second you hear a beep and a short readback, and the tracker updates.
You never need to look at the tracker.

**Game safety:** the companion only *listens* for the hotkey (the same kind of low-level key hook Discord and OBS
push-to-talk use). It never sends keys or mouse input, never reads game memory, files or network traffic, and never
blocks the key. Speech is transcribed locally and screenshots are read locally. The only network calls are the ones you ask for
with "research …" (poewiki.net, plus OpenAI if you set a key).

## Setup (once)
1. Put this whole folder (the repo or the release zip) somewhere, e.g. `C:\PoE\PoE-Roadmap\` (`poe_tracker.html` and the `voice\` folder side by side).
2. Double-click `voice\setup.bat`. It creates `voice\.venv`, installs the packages (including NVIDIA's CUDA 12 cuBLAS/cuDNN
   wheels for NVIDIA GPUs), downloads the Whisper model (small.en, ~480 MB), and runs a GPU + mic check. Takes 5–10 minutes.
   - The check line should say `small.en on cuda (float16)`. If it says `cpu`, voice still works (about 1 s slower per command).
3. Windows → Settings → Sound → Input: set your mic as the default input (or put part of its name in `"mic_device"` in `voice\config.json`, e.g. `"mic_device": "USB"`; copy `config.example.json` to `config.json` first).

## Every session
1. Double-click `voice\run.bat`. It opens **http://127.0.0.1:8765/** in your browser. Keep that tab open (it can be minimised).
   The header shows `● Voice ready · hold F9`.
2. Play. Hold F9 to talk. Beeps: rising two-tone = done, single low tone = saved as a note (not understood),
   three fast high tones = **P1 trigger**, double mid tone = saved but the tracker tab isn't open (it's applied when you open it).

## Move your existing log over (once)
The served tracker lives at a different address than the `file://` copy, so it starts empty.
In the old file:// tracker click **Export**, then in the http://127.0.0.1:8765/ tracker click **Import log** and pick that file.
From then on, always use the http://127.0.0.1:8765/ address (the plain file still works without voice).

## Things you can say
| Say | Does |
|---|---|
| "Got a Cane of Unravelling", "Porcupine card just dropped", "staff with 812 pDPS", "just got a 3 socket chest piece" | logs the drop and reads back any trigger action |
| "Act 3 done", "finished act ten", "entering act 4" / "made it to act 4" (= act 3 done), "Malachai down", "Merveil is dead", "lab done", "cruel lab done", "act 5 Kitava done", "Kitava 10 done", "got the staff and skill point", "started mapping" | campaign milestones (skipped ones are filled in). v3: only clear completion phrases count. "Heading to act 3", "almost done with act 2", "about to finish act 3", "not done with act 2 yet" are just notes |
| **"I'm in Act 2, not Act 3"**, "I'm in act 4", "set act to 5", "actually I'm in act 2" | corrects the act: unmarks later milestones (or marks the ones before), reads back what changed, "undo" restores it |
| "Fire 75, cold 75, lightning 60, chaos minus 20", "res are 76 75 75", "all res 75, chaos minus 30", "cold 25, 0 everything else", "lightning 48, everything else capped", "level 12, 37 cold res, 45 fire, 28 lightning, 25 chaos" | sets **every** res field at once; the readback names each one, says "after Kitava penalty minus 30" once Kitava is done, and lists what's uncapped |
| "Life 4000 and energy shield 1200", "max life 2950", "ES 600", "life and ES 5200" / "pool 5200", "attack block 20", "spell block 15", "block chance 25" (= attack block), "level 68", "res capped", "18 lightning as well", "and 20 fire" | life and ES stay separate; pool = life + ES (or say the total). v3: EHP and phys max hit are gone (they're kept as notes if you say them) |
| "Pause timer", "taking a break" / "Resume", "I'm back" (or the ⏸ button) | pauses the league timer; paused time doesn't count toward pace. Marking a milestone resumes automatically |
| "What are my links?", **"Act 1 main attack"**, "what's my movement", "utility links in act 5", "act 3 links", "early maps main attack", "what auras in act 6", "what's my curse", "what are my spectres", "What is my 3 link setup now, I'm in act 1 at level 10", "what's my 4 link in maps" | instant answers from your imported PoB, per stage and category (main attack, movement, utility, auras, curse, minions, other), in PoB order with your label notes: "Rolling Magma with Arcane Surge and Added Lightning Damage until you get SRS, then Summon Raging Spirit with …" |
| "Fate reward for Merveil", "fates for Malachai", "what does Dominus drop for fates", "wickerman reward for the Oversoul", "fate info Brutus" | the boss's viscera (Wickerman reward) per tier from poewiki + poedb, "currently unknown" where the wiki has nothing yet. With no boss name: the Fate bosses of your current act |
| **"Fate boss Merveil"**, "What's the Fate boss effect for Merveil?", "pull up the Fate boss from Merveil", "what does Brutus give", "show me Malachai fate" | v4: opens, scrolls to and highlights the boss in the Fate panel and reads a short summary (fuzzy names) |
| **"Dropped a 4 link"**, "found a 5 link", "got a 6 socket", "4 link with the right colours", "Fate card dropped", "add drop type mirror shard", "add event type boss down", "rename drop type X to Y", "delete drop type X" | v4: your drop/event types (edit them in Drops & events). Questions and "if I find…" never log |
| **"Chase done Darkness Enthroned"**, "add chase item Shavronne's Wrappings from Delve", "what's left on my chase" | v4: the Power Chase checklist |
| "Main attack links only", "just the movement" (within a minute of a links answer) | v4: filters the last links answer |
| "Yes" (within 20 s of "Want me to look that up?") | v4: runs the lookup. Not the default |
| "Where does the Cane of Kulemak drop?", "which boss drops X", "where do I find the Porcupine card" | never logs a drop. Says the tracker has no drop data and to say "research X" (poewiki + poedb) |
| "What's the vendor recipe for a physical weapon", "vendor recipe quality gems", "how do I make a whetstone" | research on the Vendor recipe system page |
| "Any news on Fates?", "news on the league", "check Twitter/Reddit for …" | says it only checks poewiki and poedb, can't read X/Twitter/Reddit, and suggests checking pathofexile.com or Reddit yourself (no lookup) |
| "What are my res?", "What should I do with a Cane of Unravelling?", "What's next?", "How am I doing?", "What tier am I cleared for?", "What are the Fate rules?", "Can you hear me?" | instant local answers |
| "Going to try Mervail with 1 Fate", "fighting Brutus with 2 fates" | checks against your Fate cap; triple beep if it's over |
| "Near death", "I died", "reached tier 6", "atlas opened", "killed Brutus with one fate", "killed Oak" / "helped Alira" | events, Fate kills, bandits. Two near-deaths within 90 s count as one incident |
| **"Research Desecrate"**, "look up Bones of Ullr", "wiki Forged Frostbearer" | says "Looking up…" right away, then 1–3 sentences a few seconds later; the full answer + poewiki link go in History. Only these keywords trigger a lookup |
| "Never mind" (cancels a running lookup, otherwise undo), "repeat that" (re-reads the last answer) | research control |
| **F10** (in game, on the character sheet's Defences tab or the PoB sidebar), "scan my defences", or Ctrl+V a screenshot into the tracker | reads the numbers locally; "confirm" / "discard" (or the buttons) |
| "Undo" / "scratch that", "repeat", "mute" / "unmute" | control. Undo works for every command above |

A question nobody can answer locally ("is Kitava hard?") is kept as a note and the readback suggests "say research …".

Several things in one breath work: "act 10 done, res not capped, chaos 40".
Anything not understood is still saved as a note with your exact words, so nothing is lost. There's also a text box in the tracker's Voice panel.

The companion ships with a full 3.30 name dictionary (`poe_names.json`: every unique, divination card, skill/support gem, currency, Thread, and announced Fate). Trigger items still take priority. Rare lucky drops (Mageblood, The Apothecary, Hide of the Vendigo, Empower, …) are recognised by fuzzy and phonetic matching, including Whisper mishearings like "porky pine" → The Porcupine and a leading "The" or trailing "card". A low-confidence match is logged with a "?" and the readback asks "did you mean X?". Unmatched speech is still saved as a note.

To regenerate the dictionary after a patch: `python build_names.py` (needs network; uses the official trade API plus the 3.30 item-filter names). The Whisper prompt stays short and build-focused — the long tail is matched after transcription, not stuffed into the prompt.


## Research (optional cloud LLM, poewiki always first)
"Research X" first reads the poewiki page (MediaWiki API), then, if an OpenAI key is available, asks a small fast model to answer
**only from that page text and your tracker state**. If the key is missing, the call fails, or it takes longer than 8 s, you get
the plain poewiki summary instead. Answers say so when the wiki page has no 3.30 information.

Set the key once in Windows (never in a file): Start → "Edit environment variables for your account" → New →
`OPENAI_API_KEY` = your key. Or in a terminal: `setx OPENAI_API_KEY "sk-..."`, then open a new terminal / restart run.bat.
Check it with `voice\.venv\Scripts\python.exe voice\companion.py --check-llm` (prints ok/fail, never the key).
Without the key the console says once at startup that research is wiki-only.

## Screenshot import (F10 / paste)
Open the character sheet's **Defences** tab (or PoB with the sidebar visible) and press **F10**. The companion grabs the left 40%
of the screen, upscales it 2–3×, reads it with the built-in Windows OCR (no internet, nothing sent anywhere), and the tracker shows what it read.
v3: if Windows OCR fails for **any** reason (winrt 3.2.1's "Invalid parameter count" included) it falls back to rapidocr automatically
(now installed by setup.bat) and the reason goes in the log. Windows OCR on a real Windows 11 PC reads the labels but drops the small
coloured fire/cold/lightning numbers, so in `auto` mode a read with a label but no number is redone by rapidocr (engine shows "windows+rapidocr"). It reads life, mana, ES, armour, evasion, attack + spell block, and res. A pasted full-screen screenshot is cropped the same way.
v4: on the **Offence** tab it says "That's the Offence tab, open Defences and press F10 again." with no confirm. Under 4 fields it warns "That read looks incomplete" first. Under 6 fields, auto mode retries with rapidocr, which is pre-warmed at startup so the first F10 isn't slow.
Nothing changes until you say "confirm" (or press Apply); "discard" throws it away; "undo" works after confirming.
You can also paste a screenshot (Win+Shift+S, then Ctrl+V on the tracker page). In-game "75% (82%)" means 82 uncapped;
PoB's "75% (+12%)" means 87 uncapped. F10 is listen-only like F9: it isn't blocked and nothing is sent to the game.

### Test OCR on the PC (one line each, PowerShell, in the PoE-Roadmap folder)
```
cd voice; .\.venv\Scripts\python.exe companion.py --ocr-selftest windows      # Windows OCR on a synthetic Defences image: PASS/FAIL + ms
.\.venv\Scripts\python.exe companion.py --ocr-selftest                          # auto: Windows OCR, rapidocr on failure (shows the fallback reason)
.\.venv\Scripts\python.exe companion.py --ocr-file C:\path\shot.png --ocr-engine windows   # a real screenshot: fields + raw text
```

## Build: your Path of Building (links + tree)
The tracker ships with an example build (Frostbearer Spectre Necromancer: 17 skill sets, 23 trees) as the default build. How to name things in your own PoB: `docs/POB_GUIDE.md`. To load a new version:
paste a PoB export code, a pobb.in or poe.ninja/pob link, or the XML into **Links & tree → Import Path of Building** and press Import
(goes through the companion), or run `python companion.py --import-pob <code|url|file.xml>` (writes `voice/build_config.json`; the tracker picks it up on its next start).
- Stages: Act 1…Act 10 from the skill sets/trees titled "Act N" (a set titled "Act 4-10" covers acts 4–10, each with its own Act N tree); Early / Mid / Late maps from the map sets, paired with trees by their {n} tag, with a variant dropdown (first one is the default). Colour codes (^6, ^xRRGGBB) are stripped.
- Categories come from your socket group labels and "==== Main Skills / Utility / Auras / Support Spectres ====" headers, else from the gems. **Edit mapping + categories** lets you change any group's category and which set/tree each stage uses. Saved in the browser; **Export build config** saves a JSON copy.
- The tree closeup shows the nodes new versus the previous stage (green), already allocated (gold), the class start, and the new notables in the caption.

## Fate bosses
The Fate panel lists the bosses of your current act with their viscera rewards (Lesser / normal / Greater) from the poewiki Viscera page,
poedb's Wickerman page for the mod values, and the Fate card list. Missing data says "currently unknown". The companion refreshes it
in the background (cache `voice/cache/fates.json`, at most every 6 h); `python companion.py --fetch-fates` forces it. Click a boss for
details and the "killed with 0/1/2/3 Fates" buttons.

## Logs
Every voice command (what was heard, the actions, the readback, timings), OCR results and errors, TTS errors, PoB imports and crashes go to
`voice\logs\companion_YYYYMMDD.log` (14 days kept). Send that file when something goes wrong.

## config.json (created on first run)
`hotkey` (`f9`, `f8`, `scroll_lock`, `pause`, `insert`, `mouse:x1`, `mouse:x2`, `mouse:middle`), `tts` (true/false),
`tts_volume` 0–100, `tts_rate` −10..10, `beep_volume` 0–1, `mic_device`, `model` (GPU, default `small.en`),
`cpu_model` (default `small.en`; `base.en` is faster but clearly less accurate with music), `device` (`auto`/`cuda`/`cpu`), `port` (8765). Restart run.bat after editing.

New in v2:
- `ocr_hotkey` (`f10`; `""` turns it off), `ocr_engine` (`auto` = Windows OCR then rapidocr, `windows`, `rapidocr`), `ocr_region` (`left`, `full`, or `[x, y, w, h]` as screen fractions).
- `research.backend`: `openai_compatible` (default), `ollama` (local, `research.ollama.base_url` / `model`), or `none` (poewiki only).
- `research.openai_compatible`: `base_url` (`https://api.openai.com/v1`), `model` (`gpt-6-luna`, any chat model works), `api_key_env` (`OPENAI_API_KEY`: the *name* of the environment variable, not the key), `max_tokens` (350), `token_param` (`max_completion_tokens`; use `max_tokens` for older OpenAI-compatible servers), `temperature` (unset).
- `research.llm_timeout_s` (8), `research.wiki_timeout_s` (4), `research.max_spoken_chars` (260), `research.wiki_api`.

The hotkey isn't blocked, so the game sees it too. Pick a key PoE has nothing bound to (Options → Input).

## Troubleshooting
- `python companion.py --check`: loads Whisper and the mic and prints the timing.
- `python companion.py --list-mics`: lists input devices.
- `python companion.py --parse "act 3 done"`: shows what a sentence turns into.
- `python companion.py --check-llm`: one tiny test call to the research model (ok/fail, never prints the key).
- `python companion.py --research "Bones of Ullr"`: runs one lookup in the console.
- `python companion.py --ocr-file shot.png [--ocr-engine windows|rapidocr]`: reads a saved screenshot and prints the fields and text.
- `python companion.py --ocr-selftest [windows|rapidocr]`: OCR on a built-in synthetic image, PASS/FAIL.
- `python companion.py --import-pob <code|url|xml file>` / `--fetch-fates`: see above.
- F10 reads nothing: make sure the Defences tab is on the left 40% of the screen, or set `"ocr_region": "full"`. The log says which engine ran and why Windows OCR failed.
- If F9 does nothing while the game is focused, run run.bat as the same user that runs PoE (don't run PoE as admin).

## Cheat sheet
```
F9 hold = talk            F10 = read Defences tab           Ctrl+V screenshot into tracker = same
"act 3 done"   "Malachai down"   "act 5 kitava done"   "lab done"   "pause timer" / "resume"
"I'm in act 2, not act 3"   "set act to 4"   (then "undo" if wrong)
"fire 75 cold 75 lightning 60 chaos minus 20"   "res are 76 75 75"   "18 lightning as well"
"life 4000 and energy shield 1200"   "pool 5200"   "attack block 20"   "spell block 15"   "level 44"
"what are my links"   "act 1 main attack"   "what's my movement"   "utility links in act 5"   "early maps main attack"
"my 3 link in act 1 at level 10"   "what auras"   "what are my spectres"   "4 link in maps"
"fate reward for merveil"   "fates for malachai"   "killed Brutus with one fate"   "going to try Merveil with 1 fate"
"where does X drop" (→ say research X)   "vendor recipe for a physical weapon"
"what are my res"   "what's next"   "how am I doing"   "what about bones of ullr"   "near death"
"research desecrate"   "look up X"   "wiki X"   "never mind"   "repeat that"
"confirm" / "discard" (screenshot)   "undo"   "mute" / "unmute"
```
