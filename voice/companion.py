#!/usr/bin/env python3
"""
PoE 3.30 HC SSF voice companion.

Serves the tracker at http://127.0.0.1:<port>/, listens (listen-only) for a push-to-talk key,
records the mic while it is held, transcribes locally with faster-whisper, parses the words into
tracker actions, pushes them to the open tracker page over Server-Sent Events, and reads back a
short confirmation with Windows TTS plus a beep.

It never sends keystrokes or mouse input, and never reads game memory, files or network traffic.
The hotkey hook is the same kind Discord/OBS push-to-talk uses: it observes the key, it does not block
or synthesize anything.

Python 3.10+. Heavy dependencies (faster-whisper, sounddevice, pynput, pywin32) are imported lazily,
so the parser and server can be tested without them:  python companion.py --no-audio
"""
from __future__ import annotations

import argparse
import json
import os
import queue
import re
import sys
import threading
import time
import uuid
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))
from research import DEFAULT_RESEARCH, Researcher  # noqa: E402
DEFAULT_CONFIG = {
    "port": 8765,
    "hotkey": "f9",                 # "f9", "f8", "scroll_lock", "pause", "insert", "mouse:x1", "mouse:x2", "mouse:middle"
    "tracker_html": "../poe_tracker.html",
    "model": "small.en",            # GPU model
    "cpu_model": "small.en",        # used when CUDA is unavailable (base.en = faster, less accurate)
    "device": "auto",               # "auto" | "cuda" | "cpu"
    "beam_size": 2,
    "mic_device": "",               # substring of the input device name, e.g. "Q2U" or "Samson"; "" = Windows default
    "max_record_s": 15,
    "preroll_ms": 300,              # audio kept from just before the key went down
    "tail_ms": 150,                 # keep recording this long after release (people let go early)
    "tts": True,
    "tts_volume": 80,               # 0-100
    "tts_rate": 2,                  # SAPI rate -10..10
    "beep_volume": 0.25,            # 0.0-1.0
    "speak_typed": True,            # read back commands typed into the tracker's voice box too
    "result_timeout_ms": 1200,
    "ocr_hotkey": "f10",            # screenshot -> read the Defences tab / PoB sidebar ("" = off). Listen-only, like F9
    "ocr_engine": "auto",           # "auto" (Windows OCR, then rapidocr) | "windows" | "rapidocr"
    "ocr_region": "left",           # "left" half of the screen (character panel / PoB sidebar), "full", or [x, y, w, h] fractions
    "research": DEFAULT_RESEARCH,   # "research X" lookups: poewiki first, then the LLM backend below (see README)
}

# --------------------------------------------------------------------------------------------
# Rolling log file: voice/logs/companion_YYYYMMDD.log (transcripts, parsed actions, readbacks, errors)
# --------------------------------------------------------------------------------------------
class DayLog:
    KEEP_DAYS = 14

    def __init__(self, folder=None):
        self.dir = Path(folder or os.environ.get("POE_COMPANION_LOG_DIR") or HERE / "logs")
        self.lock = threading.Lock()
        self.enabled = True

    def path(self):
        return self.dir / ("companion_" + time.strftime("%Y%m%d") + ".log")

    def write(self, kind, msg):
        if not self.enabled:
            return
        line = f"{time.strftime('%H:%M:%S')} [{kind}] {msg}".replace("\r", " ")
        try:
            with self.lock:
                self.dir.mkdir(parents=True, exist_ok=True)
                with open(self.path(), "a", encoding="utf-8") as f:
                    f.write(line.rstrip("\n") + "\n")
        except Exception:
            pass

    def prune(self):
        try:
            cutoff = time.time() - self.KEEP_DAYS * 86400
            for f in self.dir.glob("companion_*.log"):
                if f.stat().st_mtime < cutoff:
                    f.unlink()
        except Exception:
            pass


LOG = DayLog()


def _log_uncaught(exc_type, exc, tb):
    import traceback
    LOG.write("error", "".join(traceback.format_exception(exc_type, exc, tb)).strip())
    sys.__excepthook__(exc_type, exc, tb)


def _log_thread_exc(args):
    import traceback
    LOG.write("error", f"thread {args.thread.name if args.thread else '?'}: " + "".join(traceback.format_exception(args.exc_type, args.exc_value, args.exc_traceback)).strip())


# --------------------------------------------------------------------------------------------
# Vocabulary
# --------------------------------------------------------------------------------------------
# kind: trigger (fires a tracker trigger), unique, divcard, currency, base
# Each entry: canonical name sent to the tracker, plus misheard / short aliases.
CATALOG = [
    # Tracker trigger items (canonical names match trigger aliases in the tracker)
    ("Cane of Unravelling", "trigger", ["cane of unravelling", "cane of unraveling", "kane of unravelling", "kane of unraveling",
                                         "cain of unravelling", "cain of unraveling", "cane of unravel", "cane unravelling", "the cane"]),
    ("Animate Weapon of Ranged Arms", "trigger", ["animate weapon of ranged arms", "animated weapon of ranged arms", "animate weapon of range arms",
                                                  "animate weapon ranged arms", "ranged arms", "awora", "a w o r a", "aurora gem"]),
    ("Storm Burst of Repulsion", "trigger", ["storm burst of repulsion", "stormburst of repulsion", "storm burst repulsion", "storm bursts of repulsion"]),
    ("Dyadian Dawn", "trigger", ["dyadian dawn", "diadian dawn", "dyadian don", "diadian don", "dyadin dawn", "diodian dawn", "dye adian dawn", "dyadian"]),
    ("The Sword of Ages", "trigger", ["sword of ages", "the sword of ages", "sort of ages", "sword of agis"]),
    ("Seething Fury", "trigger", ["seething fury", "seeding fury", "seething furry", "seething fury shield"]),
    ("Allelopathy", "trigger", ["allelopathy", "alleopathy", "allelopathie", "alelopathy", "allopathy", "allele pathy"]),
    ("Artillery Quiver", "trigger", ["artillery quiver", "artillery quivers"]),
    ("Orb of Chance", "trigger", ["orb of chance", "chance orb", "chance orbs"]),
    ("Fugitive Boots", "trigger", ["fugitive boots", "fugitive boot"]),
    ("Apothecary's Gloves", "trigger", ["apothecary's gloves", "apothecarys gloves", "apothecary gloves"]),
    ("Two-Toned Boots", "trigger", ["two toned boots", "two tone boots", "2 toned boots", "2 tone boots"]),
    # Spectre Necromancer (1A) triggers, v3 Nov 12
    ("Forged Frostbearer captured", "trigger", ["forged frostbearer", "frostbearer", "frostbearers", "frost bearer", "frost bearers",
                                                 "forged frost bearer", "forest bearer", "frost barer", "got frostbearers", "captured frostbearer"]),
    ("Verisium Outcrop found", "trigger", ["verisium", "verisium outcrop", "verisium ore", "verisium deposit", "varisium", "verizium", "very sium"]),
    ("Bones of Ullr", "trigger", ["bones of ullr", "bones of uller", "bones of ulr", "bones of ole", "bones of ula", "bones of oolar"]),
    ("The Jinxed Juju", "trigger", ["jinxed juju", "the jinxed juju", "jinx juju", "jinxed jujus"]),
    ("Darkness Enthroned", "trigger", ["darkness enthroned", "darkness and throned", "darkness in throned"]),
    ("The Dark Monarch", "trigger", ["dark monarch", "the dark monarch"]),
    ("Femurs of the Saints", "trigger", ["femurs of the saints", "femurs of the saint", "femur of the saints", "femurs"]),
    ("Raise Spectre 21", "trigger", ["raise spectre 21", "21 raise spectre", "vaal raise spectre", "level 21 raise spectre", "21 spectre gem", "raised spectre 21"]),
    ("+1 minion wand", "trigger", ["1 minion wand", "plus 1 minion wand", "minion wand"]),
    ("+1 minion shield", "trigger", ["1 minion shield", "plus 1 minion shield", "minion shield"]),
    ("+2 minion helmet", "trigger", ["2 minion helmet", "plus 2 minion helmet", "2 minion helm", "minion helmet", "minion helm"]),
    ("Ghastly Eye Jewel", "trigger", ["ghastly eye jewel", "ghastly eye", "ghastly i jewel"]),
    ("Bone Ring", "trigger", ["bone ring", "bone rings"]),
    ("Replica Stampede", "unique", ["replica stampede"]),
    # Common SSF uniques worth logging
    ("Tabula Rasa", "unique", ["tabula rasa", "tabula"]),
    ("Goldrim", "unique", ["goldrim", "gold rim"]),
    ("Wanderlust", "unique", ["wanderlust"]),
    ("Lifesprig", "unique", ["lifesprig", "life sprig"]),
    ("Axiom Perpetuum", "unique", ["axiom perpetuum"]),
    ("Seven-League Step", "unique", ["seven league step", "7 league step"]),
    ("Kaom's Sign", "unique", ["kaom's sign", "kaoms sign", "chaoms sign"]),
    ("Light of Meaning", "unique", ["light of meaning"]),
    ("Glorious Vanity", "unique", ["glorious vanity"]),
    ("Lethal Pride", "unique", ["lethal pride"]),
    ("Elegant Hubris", "unique", ["elegant hubris"]),
    ("Brutal Restraint", "unique", ["brutal restraint"]),
    ("Militant Faith", "unique", ["militant faith"]),
    ("Badge of the Brotherhood", "unique", ["badge of the brotherhood"]),
    ("Ralakesh's Impatience", "unique", ["ralakesh's impatience", "ralakesh impatience", "ralakeshs impatience"]),
    ("The Covenant", "unique", ["the covenant"]),
    ("Rumi's Concoction", "unique", ["rumi's concoction", "rumis concoction", "rumi concoction"]),
    ("Algor Mortis", "unique", ["algor mortis"]),
    ("Agnerod West", "unique", ["agnerod west", "agnerod"]),
    ("Timeclasp", "unique", ["timeclasp", "time clasp"]),
    ("Honourhome", "unique", ["honourhome", "honorhome", "honour home", "honor home"]),
    ("Rain of Splinters", "unique", ["rain of splinters"]),
    ("Mageblood", "unique", ["mageblood", "mage blood"]),
    ("Headhunter", "unique", ["headhunter", "head hunter"]),
    # Divination cards
    ("The Porcupine", "divcard", ["porcupine", "the porcupine"]),
    ("Humility", "divcard", ["humility"]),
    ("Rain of Chaos", "divcard", ["rain of chaos"]),
    ("Her Mask", "divcard", ["her mask"]),
    ("Emperor's Luck", "divcard", ["emperor's luck", "emperors luck"]),
    ("The Gambler", "divcard", ["the gambler", "gambler"]),
    ("Lantador's Lost Love", "divcard", ["lantador's lost love", "lantadors lost love"]),
    ("The Hermit", "divcard", ["the hermit", "hermit"]),
    ("The Scholar", "divcard", ["the scholar", "scholar"]),
    ("Loyalty", "divcard", ["loyalty"]),
    ("The Lover", "divcard", ["the lover"]),
    ("The Union", "divcard", ["the union"]),
    ("Destined to Crumble", "divcard", ["destined to crumble"]),
    ("The Carrion Crow", "divcard", ["carrion crow", "the carrion crow"]),
    ("The Lord in Black", "divcard", ["lord in black", "the lord in black"]),
    ("Boon of Justice", "divcard", ["boon of justice"]),
    ("Three Faces in the Dark", "divcard", ["three faces in the dark", "3 faces in the dark"]),
    ("The Twins", "divcard", ["the twins"]),
    ("The Inventor", "divcard", ["the inventor"]),
    ("Chaotic Disposition", "divcard", ["chaotic disposition"]),
    ("The Hoarder", "divcard", ["the hoarder", "hoarder"]),
    ("Lucky Connections", "divcard", ["lucky connections"]),
    ("Abandoned Wealth", "divcard", ["abandoned wealth"]),
    ("The Sephirot", "divcard", ["the sephirot", "sephirot"]),
    ("The Saint's Treasure", "divcard", ["the saint's treasure", "saints treasure"]),
    ("The Fiend", "divcard", ["the fiend"]),
    ("The Doctor", "divcard", ["the doctor"]),
    ("House of Mirrors", "divcard", ["house of mirrors"]),
    ("Seven Years Bad Luck", "divcard", ["seven years bad luck", "7 years bad luck"]),
    ("The Apothecary", "divcard", ["the apothecary"]),
    ("Unrequited Love", "divcard", ["unrequited love"]),
    ("The Demon", "divcard", ["the demon"]),
    ("The Enlightened", "divcard", ["the enlightened"]),
    ("The Celestial Stone", "divcard", ["the celestial stone", "celestial stone"]),
    ("The Rabbit's Foot", "divcard", ["the rabbit's foot", "rabbits foot", "rabbit's foot"]),
    ("The Survivalist", "divcard", ["the survivalist"]),
    ("The Wrath", "divcard", ["the wrath"]),
    # Currency
    ("Divine Orb", "currency", ["divine orb", "divine", "a divine"]),
    ("Exalted Orb", "currency", ["exalted orb", "exalt", "exalted"]),
    ("Chaos Orb", "currency", ["chaos orb"]),
    ("Orb of Fusing", "currency", ["orb of fusing", "fusing", "fusings"]),
    ("Jeweller's Orb", "currency", ["jeweller's orb", "jewellers orb", "jeweler's orb", "jewelers orb"]),
    ("Vaal Orb", "currency", ["vaal orb", "vall orb"]),
    ("Regal Orb", "currency", ["regal orb", "regal"]),
    ("Orb of Alchemy", "currency", ["orb of alchemy", "alchemy orb", "alch"]),
    ("Gemcutter's Prism", "currency", ["gemcutter's prism", "gemcutters prism", "gcp"]),
    ("Ancient Orb", "currency", ["ancient orb"]),
    ("Mirror of Kalandra", "currency", ["mirror of kalandra", "mirror"]),
]

# Words whose presence makes a phrase a drop report even when no catalog item matched.
DROP_VERBS = r"\b(dropped|drop|got|found|picked up|looted|look at that|just got|i have|we got|i got|nice)\b"

# Initial prompt: steers Whisper towards PoE spellings. Kept short (Whisper only uses ~224 tokens).
INITIAL_PROMPT = (
    "Path of Exile hardcore log. Act 1 done. Act 10 done, Kitava down. Cruel lab done. Merciless lab. Normal lab. "
    "Resistances capped. Chaos res 30. Life 4200. Energy shield 2500. Attack block 20. Spell block 50. I'm in Act 2, not Act 3. "
    "Near death. Undo. What's next? How am I doing? Reached T6. Killed the boss with 2 Fates. "
    "Got a Cane of Unravelling. Animate Weapon of Ranged Arms. Storm Burst of Repulsion. Dyadian Dawn. "
    "Seething Fury. The Sword of Ages. Allelopathy. The Porcupine card. Staff with 780 pDPS. Orb of Chance. Divine Orb. "
    "Forged Frostbearer. Verisium. Bones of Ullr. Jinxed Juju. Darkness Enthroned. Dark Monarch. Femurs of the Saints. Raise Spectre 21. "
    "Fire 75, cold 75, lightning 60, chaos minus 20. Life and energy shield 5200. Pause timer. Resume. What are my links? Act 3 main attack. "
    "What's my movement? Fate reward for Merveil. Research Desecrate. Vendor recipe for a quality gem. Malachai down. Cane of Kulemak."
)

# --------------------------------------------------------------------------------------------
# Text normalisation + number words
# --------------------------------------------------------------------------------------------
UNITS = {"zero": 0, "oh": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9,
         "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16,
         "seventeen": 17, "eighteen": 18, "nineteen": 19}
TENS = {"twenty": 20, "thirty": 30, "forty": 40, "fourty": 40, "fifty": 50, "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90}
SCALES = {"hundred": 100, "thousand": 1000, "k": 1000, "grand": 1000}


def words_to_numbers(text: str) -> str:
    """'four thousand two hundred' -> '4200', 'forty two hundred' -> '4200', 'minus twelve' -> '-12', '4.2k' -> '4200'."""
    text = re.sub(r"(\d+(?:\.\d+)?)\s?k\b", lambda m: str(int(round(float(m.group(1)) * 1000))), text)
    text = re.sub(r"(?<=\d),(?=\d{3}\b)", "", text)          # 4,200 -> 4200
    text = re.sub(r"(\d+)\s*%", r"\1", text)
    toks = text.split()
    out, i = [], 0
    while i < len(toks):
        t = toks[i]
        if t in UNITS or t in TENS or (t == "a" and i + 1 < len(toks) and toks[i + 1] in ("hundred", "thousand")) or \
                (re.fullmatch(r"\d+(\.\d+)?", t) and i + 1 < len(toks) and toks[i + 1] in SCALES):
            total, cur, j, used = 0, 0.0, i, False
            while j < len(toks):
                w = toks[j]
                if w in UNITS: cur += UNITS[w]
                elif w in TENS: cur += TENS[w]
                elif w == "a" and j + 1 < len(toks) and toks[j + 1] in ("hundred", "thousand"): cur += 1
                elif re.fullmatch(r"\d+(\.\d+)?", w) and not used: cur += float(w)
                elif w in SCALES and (cur or total):
                    if SCALES[w] == 100: cur *= 100
                    else: total += (cur or 1) * SCALES[w]; cur = 0
                elif w == "point" and j + 1 < len(toks) and toks[j + 1] in UNITS:
                    cur += UNITS[toks[j + 1]] / 10.0; j += 1
                elif w == "and" and j + 1 < len(toks) and (toks[j + 1] in UNITS or toks[j + 1] in TENS) and (total or cur >= 100):
                    pass
                else:
                    break
                used = True
                j += 1
            val = total + cur
            out.append(str(int(round(val))) if abs(val - round(val)) < 1e-6 else str(val))
            i = j
        else:
            out.append(t); i += 1
    s = " ".join(out)
    s = re.sub(r"\b(?:minus|negative)\s+(\d+)", r"-\1", s)
    return s


ACT_WORDS = {"won": 1, "one": 1, "to": 2, "too": 2, "two": 2, "tree": 3, "three": 3, "for": 4, "four": 4, "fore": 4,
             "five": 5, "six": 6, "sex": 6, "seven": 7, "eight": 8, "ate": 8, "nine": 9, "ten": 10, "tin": 10}
ACT_PREFIX = r"(?:act|acts|axe|ax|ac|akt|ect)"


def normalise(text: str) -> str:
    s = text.lower().replace("’", "'")
    s = re.sub(r"[“”\"!?;:]", " ", s)
    s = re.sub(r"(?<!\d)[.](?!\d)|[.](?=\s|$)", " ", s)
    s = re.sub(r"-", " ", s)
    s = re.sub(r"\bt[ -]?(\d{1,2})\b", r"t\1", s)
    s = re.sub(r"\b(aren't|arent|aren t)\b", "are not", s)
    s = re.sub(r"\b(isn't|isnt|isn t)\b", "is not", s)
    s = re.sub(r"\b(i'm|im)\b", "i am", s)
    s = re.sub(r"\b(what's|whats)\b", "what is", s)
    s = re.sub(r"\b(how's|hows)\b", "how is", s)
    # common Whisper mishearings seen in the TTS + music tests
    s = re.sub(r"\b(act \w+)'s\b", r"\1 is", s)
    s = re.sub(r"\b(we're|were|we re)\b(?= (?:in|on|at|still|actually|only) act)", "we are", s)
    s = re.sub(r"\b(life|es|shield|res|resistance|resistances|chaos|ehp|block|level|pool|hit|health|hp)'s\b", r"\1 is", s)
    s = re.sub(r"\b(residential|residence|resident|resistant|resi|resis)\b(?=\s+-?\d)", "res", s)
    s = re.sub(r"(?<!the )(?<!all )\brest\b(?=\s+-?\d)", "res", s)
    s = re.sub(r"\b(ain't|aint|on capped|un capped|in capped|uncap)\b", "not capped", s)
    s = re.sub(r"\breach\b", "reached", s)
    s = re.sub(r"\b(fire|cold|lightning|lightening|lighting)s\b", r"\1", s)                  # "18 lightnings as well"
    s = re.sub(r"\b(skill|quality|support) (gym|jim|gems?)\b", r"\1 gem", s)                  # Whisper: "quality skill gym"
    s = re.sub(r"\b(attack|spell) blocks?\b", r"\1 block", s)
    s = re.sub(rf"\b{ACT_PREFIX}\s+(i{{1,3}}|iv|v|vi{{1,3}}|ix|x)\b", lambda m: "act " + str(["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"].index(m.group(1)) + 1), s)
    s = re.sub(r"\b(act \w+|lab|kitava|reached|res|chaos|life)\s*,\s*", r"\1 ", s)   # "act 3, done" / "reach, t6"
    s = re.sub(r"^kill\b", "killed", s)
    s = re.sub(r"\s+", " ", s).strip()
    # act homophones only right after "act": "act for done" -> "act 4 done"
    s = re.sub(rf"\b{ACT_PREFIX}\s+({'|'.join(ACT_WORDS)})\b", lambda m: f"act {ACT_WORDS[m.group(1)]}", s)
    s = words_to_numbers(s)
    s = re.sub(rf"\b{ACT_PREFIX}\s*(\d{{1,2}})\b", r"act \1", s)
    s = re.sub(r"\btier (\d{1,2})\b", r"t\1", s)
    # "life and ES" (Whisper often hears "life in / an energy shield") is the combined pool
    s = re.sub(r"\b(?:max(?:imum)? )?life (?:and|in|an|n|&|plus|\+) (?:max(?:imum)? )?(?:es|e s|energy shield|shield)\b(?: (?:pool|total|combined))?", "pool", s)
    s = re.sub(r"\b(combined|total) (life )?pool\b", "pool", s)
    s = re.sub(r"\b(staff and (the )?skill point|staff and skill points)\b", "staffskillpoint", s)
    return s


# --------------------------------------------------------------------------------------------
# Fuzzy item matching
# --------------------------------------------------------------------------------------------
try:
    from rapidfuzz import fuzz
except ImportError:  # tiny fallback so --no-audio tests can still run without rapidfuzz
    import difflib

    class fuzz:  # type: ignore
        @staticmethod
        def ratio(a, b):
            return 100.0 * difflib.SequenceMatcher(None, a, b).ratio()

try:
    from name_index import get_index  # full 3.30 name dictionary (uniques, cards, gems, …)
except ImportError:
    import sys as _sys
    if str(HERE) not in _sys.path:
        _sys.path.insert(0, str(HERE))
    from name_index import get_index

if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))
import intents_v4 as iv4  # noqa: E402  (v4: custom types, Power Chase, Fate boss, follow-ups, news)
iv4.NORM = normalise
iv4.FUZZ = fuzz

_ALIAS_INDEX = []  # (alias_tokens, alias_str, canonical, kind)
for canon, kind, aliases in CATALOG:
    for a in aliases + [canon]:
        a2 = re.sub(r"\s+", " ", re.sub(r"[-'’]", " ", a.lower())).strip()
        a2 = words_to_numbers(a2)
        _ALIAS_INDEX.append((a2.split(), a2, canon, kind))
_SEEN = set()
_ALIAS_INDEX = [x for x in _ALIAS_INDEX if not (x[1] in _SEEN or _SEEN.add(x[1]))]


def _match_catalog(clause: str):
    """Best curated-catalog item, compared word-window by word-window (so 'cane' never matches 'arcane')."""
    toks = re.sub(r"[-'’]", " ", clause).split()
    best = None
    for atoks, astr, canon, kind in _ALIAS_INDEX:
        n = len(atoks)
        if len(astr) < 6:
            need = 100           # short aliases ('alch', 'gcp') must be exact
        elif len(astr) < 10:
            need = 87
        else:
            need = 82
        for w in {max(1, n - 1), n, n + 1}:
            for i in range(0, max(0, len(toks) - w) + 1):
                cand = " ".join(toks[i:i + w])
                if not cand:
                    continue
                sc = 100.0 if cand == astr else max(fuzz.ratio(cand, astr), fuzz.ratio(cand.replace(" ", ""), astr.replace(" ", "")) - 2)
                if sc >= need:
                    key = (sc, len(astr), 1 if kind == "trigger" else 0)
                    if best is None or key > best[0]:
                        best = (key, canon, kind, sc, astr)
    if not best:
        return None
    return {"name": best[1], "kind": best[2], "score": round(best[3], 1), "confidence": "high", "alias": best[4]}


def match_item(clause: str):
    """Curated trigger aliases first, then the full 3.30 name dictionary."""
    trig = _match_catalog(clause)
    try:
        extra = get_index().match(clause)
    except Exception:
        extra = None
    cardish = bool(re.search(r"\b(divination |div )?cards?\b", clause))
    fateish = bool(re.search(r"\bfates?\b", clause))
    # A type hint can override a weak or differently-named catalog hit
    # (e.g. "Apothecary card" must be the card, not Apothecary's Gloves).
    if extra and extra.get("confidence") == "high":
        if cardish and extra["kind"] == "divcard" and (
            not trig or trig["kind"] != "trigger" or trig["name"] != extra["name"]
        ):
            if not (trig and trig["kind"] == "trigger" and trig["score"] >= 95 and not cardish):
                return extra
        if fateish and extra["kind"] == "fate" and (not trig or trig["kind"] != "trigger"):
            return extra
    # A short curated alias inside a longer, different item name must not win: "where does the cane of
    # kulimac drop" hit Cane of Unravelling's old alias "the cane" (exact, 100) over Cane of Kulemak (86.7).
    if trig and extra and extra.get("confidence") == "high" and extra["name"] != trig["name"] and extra.get("score", 0) >= 84:
        alias_words = len(trig.get("alias", "").split())
        extra_words = len(re.sub(r"[-'’]", " ", extra["name"]).split())
        if alias_words < extra_words and alias_words <= 2:
            trig = None
    if trig:
        trig = {k: v for k, v in trig.items() if k != "alias"}
        return trig
    return extra


# --------------------------------------------------------------------------------------------
# Parser: utterance -> list of actions
# --------------------------------------------------------------------------------------------
NEG = r"\b(not|no|never|uncapped|missing|under|below|short|low|need|needs|without|isn|aren|nope)\b"
DONE = r"\b(done|finished|finish|complete|completed|cleared|clear|beat|beaten|over|through|killed|down|dead|died|did|ascended)\b"
KITAVA = r"\b(kitava|kitavas|ketava|kitaba|katava|kit ava|kitavah|kataba|chitava|kittava)\b"
LAB = r"\b(lab|labs|labyrinth|lav|lad|lap)\b"


def split_clauses(s: str):
    parts = re.split(r"\s*(?:,|\band then\b|\bthen\b|\band also\b|\balso\b|\bbut\b|\bplus\b|\band\b)\s*", s)
    return [p.strip() for p in parts if p and p.strip()]


QWORDS = r"^(what|whats|what's|where|when|how|which|who|should|shall|do i|does|did i|can i|could i|can you hear|do you hear|are you there|is my|are my|is the|am i|tell me|give me my|remind me)\b"
CONTROL_UNDO = r"(please )?(undo|undo that|undo last|undo the last( one)?|scratch that|cancel that|delete that|that's wrong|that is wrong|wrong)( please)?"
SOFT_CANCEL = r"(okay |ok |oh )?(never ?mind|nevermind|forget it|forget that|cancel( it| the research| research)?|stop( it| that| looking| the research)?)( please)?"
RESEARCH_RE = r"^(?:(?:okay|ok|hey|please|so|um|uh)[,\s]+)*(?:(?:can|could|would) you\s+)?(?:please\s+)?(?:research|look up|lookup|look it up|wiki|search the wiki for|search wiki for|check the wiki for|check the wiki on|wiki search|search poewiki for|poewiki)\b[\s,:]*(?:for\s+|about\s+|on\s+)?(.*)$"
PAUSE_RE = (r"^(?:(?:okay|ok|alright|all right|hey|so)\s+)*(?:please\s+)?(?:"
            r"pause(?: the)?(?: timer| clock| run| league| tracker)?(?: please)?(?: for (?:a (?:bit|minute|sec|second|while)|dinner|lunch|food))?"
            r"|(?:hold|stop|freeze) the (?:timer|clock)"
            r"|(?:i am |i will be )?(?:stepping|heading|going) (?:out|away|afk)(?: for (?:a (?:bit|minute|while)|dinner|lunch|food))?(?: pause(?: the)?(?: timer)?)?"
            r"|(?:i am )?(?:going to|gonna) (?:grab |get |make )?(?:dinner|lunch|food|eat|a snack)(?: pause(?: the)?(?: timer)?)?"
            r"|(?:i will )?be right back|brb|i am afk|afk|going afk|taking a (?:quick )?break|break time|time out"
            r")$")
RESUME_RE = (r"^(?:(?:okay|ok|alright|all right|and|so)\s+)*(?:"
             r"resume(?: the)?(?: timer| clock| run)?|unpause(?: the)?(?: timer| clock)?|un pause(?: the)?(?: timer)?"
             r"|(?:i am |we are )?back(?: again| now)?(?: resume(?: the)?(?: timer)?)?|i am back from (?:dinner|lunch|food|break)"
             r"|(?:restart|start|continue) the (?:timer|clock) again|continue(?: the)? (?:timer|clock)|timer back on|break over|break is over"
             r")$")
CONFIRM_RE = r"(?:yes |yeah |yep )?(?:confirm|apply( that| it| those| the scan| screenshot| the screenshot)?|accept( that| it)?|looks good|that is right|that's right|save (?:that|it|those))( please)?"
DISCARD_RE = r"(?:no |nope )?(?:discard|reject|throw (?:that|it) away|dismiss)( that| it| the scan| the screenshot)?( please)?"


def parse(transcript: str, ctx: dict | None = None):
    """Return a list of actions. Never returns [] for non-empty speech: unknown text becomes a note.
    ctx (optional, from the Hub): {"last_links": {"ts": epoch, "q": {...}}} for follow-ups like 'main attack links only'."""
    raw = (transcript or "").strip()
    if not raw:
        return []
    s = normalise(raw)
    if not s:
        return []
    # Whole-utterance intents first
    if re.fullmatch(SOFT_CANCEL, s):
        return [{"type": "undo", "soft": True}]          # cancels a running lookup, else undoes
    if re.fullmatch(CONTROL_UNDO, s) or re.match(r"^(undo|scratch that|cancel that)\b", s):
        return [{"type": "undo"}]
    if re.fullmatch(r"(please )?(say that again|repeat( that| it| the answer| the last answer)?|what did you say|come again|read (that|it) again)( please)?", s):
        return [{"type": "local", "what": "repeat"}]
    if re.fullmatch(r"(mute|be quiet|voice off|stop talking|quiet)( voice| please)?", s):
        return [{"type": "local", "what": "mute"}]
    if re.fullmatch(r"(unmute|voice on|talk to me|speak)( voice| please)?", s):
        return [{"type": "local", "what": "unmute"}]
    if re.fullmatch(iv4.YES_RE, s):
        return [{"type": "yes"}]                          # the Hub turns it into the offered look-up (or OCR confirm)
    tc = iv4.parse_type_cmd(raw)
    if tc:
        return [tc]
    cc = iv4.parse_chase_cmd(raw)
    if cc:
        return [cc]
    fb = iv4.parse_fate_boss(s)
    if fb:
        return [fb]
    fu = iv4.parse_link_followup(s, LINK_CATS)
    if fu:
        last = (ctx or {}).get("last_links") or {}
        recent = last and time.time() - float(last.get("ts", 0)) < 60
        if recent or re.search(r"\b(links?|gems?|setup|set up)\b", s):
            q = {"type": "query", "what": "links", "links": None, "focus": fu, "followup": bool(recent)}
            if recent:
                for k in ("act", "stage", "maps", "level"):
                    if (last.get("q") or {}).get(k) is not None:
                        q[k] = last["q"][k]
            q.update(link_stage(s))
            return [q]
    sa = parse_set_act(s) or parse_set_act(words_to_numbers(re.sub(r"\s+", " ", re.sub(r"[^\w\s']", " ", raw.lower().replace("i'm", "i am"))).strip()))
    if sa:
        return [sa]
    m = re.match(RESEARCH_RE, s)
    if m:
        q = iv4.strip_trailing_filler(_research_query(raw) or m.group(1).strip())
        if q and (iv4.is_social(q) or re.search(iv4.NEWSWORDS, normalise(raw))):
            return [{"type": "query", "what": "news", "topic": iv4.news_topic(normalise(raw)) or q, "social": True}]
        return [{"type": "research", "query": q}] if q else [{"type": "log", "text": raw, "kind": "note"}]
    rq = parse_recipe(s)
    if rq:
        return [rq]
    nw = re.search(r"\b(?:any )?(?:news|updates?|announcements?)\b.*?\b(?:on|about|for|regarding)\s+(?:the\s+)?(.+)$|\bwhat is the latest (?:on|about|with)\s+(?:the\s+)?(.+)$", s)
    if not nw and re.search(iv4.NEWSWORDS, s) and (re.search(r"\b(is there|are there|any|what is the latest|got any|heard any|anything new)\b", s)
                                                 or re.search(r"\b(x|twitter|reddit|forums?|discord)\b", s)):
        return [{"type": "query", "what": "news", "topic": iv4.news_topic(s) or "", "social": iv4.is_social(s)}]
    if nw and re.search(r"\b(is there|are there|any|what is the latest|got any|heard any|what is the news|what are the news|latest news|x|twitter|reddit|forums?|discord)\b|^(?:(?:okay|ok|so|hey)\s+)*news\b", s):
        topic = (nw.group(1) or nw.group(2) or "").strip()
        topic = re.sub(r"^(?:(?:twitter|x|reddit|discord|the forums?)\s+)+(?:about|on|regarding)\s+(?:the\s+)?", "", topic)
        return [{"type": "query", "what": "news", "topic": topic}]
    if re.fullmatch(PAUSE_RE, s):
        return [{"type": "pause"}]
    if re.fullmatch(RESUME_RE, s):
        return [{"type": "resume"}]
    if re.fullmatch(CONFIRM_RE, s):
        return [{"type": "ocr", "what": "confirm"}]
    if re.fullmatch(DISCARD_RE, s):
        return [{"type": "ocr", "what": "discard"}]
    if re.fullmatch(r"(scan|read|check|import) (my )?(defen[cs]es|character sheet|char sheet|sheet|stats|screen)( please)?|screenshot( my)?( defen[cs]es| stats)?", s):
        return [{"type": "ocr", "what": "scan"}]
    if re.search(r"\bnew fate\b|\bfate seen\b", s):
        txt = re.sub(r".*?\b(new fate|fate seen)\b( seen)?( is| says| called)?", "", raw, flags=re.I).strip(" ,.:")
        txt = re.sub(r"^(new fate|fate seen)\s*:?\s*", "", txt, flags=re.I)
        return [{"type": "log", "text": "New Fate seen: " + (txt or raw)}]

    # Questions are pulled out sentence by sentence; the rest is parsed as one statement (as before).
    sentences = [x for x in re.split(r"(?<=[?!.])\s+(?=\S)", raw) if x.strip()]
    questions, statements = [], []
    split = []
    for sent in sentences:   # "Act 5 done, what are my res?" -> statement + question
        m = re.match(r"^(.*?\w.*?)(?:,|;|\band\b|\bso\b|\bnow\b)\s+((?:what|what's|whats|where|how|which|should i|can i|is my|are my|am i|do i)\b.*)$", sent, flags=re.I)
        if m and not re.match(QWORDS, normalise(m.group(1))):
            split += [m.group(1), m.group(2)]
        else:
            split.append(sent)
    sentences = split
    for sent in sentences:
        ns = normalise(sent)
        if not ns:
            continue
        if sent.rstrip().endswith("?") or re.match(QWORDS, ns):
            questions.append((sent, ns))
        else:
            statements.append(sent)
    if len(sentences) == 1 and not questions:
        q = parse_query(s)
        if q:
            return [q]
    actions, qacts = [], []
    if statements:
        actions = parse_statement(" ".join(statements))
    for sent, ns in questions:
        q = parse_query(ns) or parse_question(ns)
        if q is None:
            # A real question ("where does the Cane of Kulimac drop?") never logs anything. Only exclamations
            # ("what a drop, Mageblood!") and statements Whisper ended with "?" ("Act 4 done?") are statements.
            exclaim = re.match(r"^(what an? |what (?:a |an )?(?:nice|great|sick|insane|huge|lucky)\b|how about that\b|look at that\b)", ns)
            if exclaim or not re.match(QWORDS, ns):
                sub = parse_statement(sent)
                if exclaim:
                    sub = [a for a in sub if a.get("type") == "log"]
                if any(a.get("kind") != "note" for a in sub):
                    actions.extend(sub); continue
            q = {"type": "query", "what": "unknown", "text": sent.strip()}
        qacts.append(q)
    # a link/socket count said in the statement ("3 socket chest") feeds a bare "what are my links?"
    sockets = re.search(r"\b([1-6]) ?(?:socket|sockets|socketed|link|links|linked|l)\b", normalise(" ".join(statements))) if statements else None
    for q in qacts:
        if q.get("what") == "links" and q.get("links") is None and sockets:
            q["links"] = int(sockets.group(1))
            if q.get("focus") == "all":
                q["focus"] = "main"
    actions = [a for a in actions if a.get("kind") != "note" or not qacts]  # the question replaces the note
    actions.extend(qacts)
    if not actions:
        actions = [{"type": "log", "text": raw, "kind": "note"}]
    return dedupe(actions)


def _research_query(raw: str) -> str:
    m = re.match(r"^\W*(?:(?:okay|ok|hey|please|so|um|uh)[,\s]+)*(?:(?:can|could|would) you\s+)?(?:please\s+)?"
                 r"(?:research|look\s+up|lookup|look\s+it\s+up|wiki|search the wiki for|search wiki for|check the wiki for|check the wiki on|wiki search|search poewiki for|poewiki)\b[\s,:]*(?:for\s+|about\s+|on\s+)?(.*)$",
                 raw.strip(), flags=re.I)
    if not m:
        return ""
    q = m.group(1).strip(" .?!,")
    q = re.sub(r"^(?:the\s+)?(?:wiki|poewiki|poedb)(?:\s+page)?\s+(?:for|on|about)\s+", "", q, flags=re.I)   # "look up the wiki for unearth"
    q = re.sub(r"\b(skill|quality|support)\s+(?:gyms?|jims?)\b", r"\1 gem", q, flags=re.I)                   # Whisper: "quality gym"
    return q


def parse_statement(text: str):
    s = normalise(text)
    if not s:
        return []
    s = re.sub(r"\bstaff\s*,\s*", "staff ", s)   # "a staff, 780 pdps"
    actions, defs = [], {}
    clauses = split_clauses(s)
    for c in clauses:
        actions.extend(parse_clause(c, defs))
    # numbers for every defence field, read across the whole statement (lists span clauses)
    nums = parse_defense_numbers(s)
    if nums:
        have_num = {a["field"] for a in actions if a.get("type") == "def"}
        for f in ("level", "fire", "cold", "lightning", "chaos", "pool", "block", "ablock"):
            if f in nums:
                actions = [a for a in actions if not (a.get("type") == "def" and a.get("field") == f)]
                actions.append({"type": "def", "field": f, "value": nums[f]})
        if any(f in nums for f in ("fire", "cold", "lightning")):
            # numbers win over a "capped" word only when all three were given
            if all(f in nums for f in ("fire", "cold", "lightning")):
                actions = [a for a in actions if not (a.get("type") == "def" and a.get("field") == "ele")]
        # "lightning is 48" is a number, not a fuzzy Lightning Coil drop
        actions = [a for a in actions if not (a.get("type") == "log" and a.get("kind") == "drop" and (a.get("match") or {}).get("score", 100) < 90)]
        if "life" in nums: defs["life"] = nums["life"]
        if "es" in nums: defs["es"] = nums["es"]
        del have_num
    if "life" in defs or "es" in defs:
        actions.append({"type": "def", "field": "life_es", "life": defs.get("life"), "es": defs.get("es")})
    # a fate attempt ("try it again with 1 Fate") is a reminder of the cap, not a kill
    fa = re.search(r"\b(?:try|trying|attempt|attempting|going to|gonna|about to|run|running|do|doing|fight|fighting|facing|taking on)\b.*?\bwith (\d|no|zero) (?:fates?|faiths?|fades?)\b", s)
    if fa and not any(a["type"] == "kill" for a in actions):
        n = 0 if fa.group(1) in ("no", "zero") else int(fa.group(1))
        boss = re.search(r"\b(?:try|trying|attempt|attempting|fight|fighting|facing|taking on)\s+(?!it\b|again\b|him\b|her\b|that\b|this\b)(.+?)\s+(?:again\s+)?with\b", s)
        actions.append({"type": "fate_attempt", "fates": n, "boss": (boss.group(1).title() if boss else "")})
    # "Lunaris and Solaris down" is a boss kill, not a fuzzy "Vix Lunaris" drop
    if any(a.get("type") == "milestone" and a.get("boss") for a in actions):
        actions = [a for a in actions if not (a.get("type") == "log" and a.get("kind") == "drop" and (a.get("match") or {}).get("confidence") != "high")]
    if not actions or all(a.get("kind") == "note" for a in actions):
        bt = iv4.match_custom(s, builtin=True)     # a built-in event said with one of its (custom) aliases
        if bt:
            actions = [iv4.custom_action(bt, s)]
    if not actions:
        # a generic item with a socket / link count ("just got a 3 socket chest piece")
        base = re.search(r"\b(chest|chest piece|body armour|body armor|armour|helmet|helm|boots|gloves|wand|shield|ring|amulet|belt|sceptre|scepter|staff|jewel|flask|quiver|bow|sword|axe|mace|dagger|claw|talisman)\b", s)
        if base and re.search(DROP_VERBS, s):
            soc = re.search(r"\b([1-6]) ?(socket|sockets|link|links|linked|l)\b", s)
            what = re.sub(r"^.*?\b(?:dropped|drop|got|found|picked up|looted|have|nice)\b\s*(?:a |an |the |me )?", "", s).strip() or base.group(1)
            label = (f"{soc.group(1)}-{'link' if 'link' in soc.group(2) or soc.group(2) == 'l' else 'socket'} " if soc else "") + base.group(1)
            actions.append({"type": "log", "text": f"Drop: {label} ({what})" if soc else f"Drop: {what}", "kind": "drop"})
    return actions



def dedupe(actions):
    out, seen = [], set()
    for a in actions:
        k = json.dumps({x: y for x, y in a.items() if not (a.get("type") == "milestone" and x == "boss")}, sort_keys=True)
        if k not in seen:
            seen.add(k); out.append(a)
    return out


LINK_CATS = {
    "main": r"main attack|main skill|main damage|main spell|damage skill|attack skill|main links?|primary skill|clear skill",
    "movement": r"movement(?: skill)?|mobility|movement links?|dash|blink",
    "utility": r"utility(?: skills?| links?| gems?)?|utilities",
    "auras": r"auras?|heralds?|reservation|reserve",
    "curse": r"curses?|hex(?:es)?|curse setup|curse links?",
    "minions": r"minions?|spectres?|zombies?|golems?|skeletons?|minion links?|minion setup",
    "other": r"other(?: links| skills| gems)?|misc(?:ellaneous)?|rest of (?:my|the) (?:links|gems|skills)",
}
_CAT_RE = "|".join(f"(?P<{k}>{v})" for k, v in LINK_CATS.items())


def link_stage(s: str) -> dict:
    """'act 3' / 'in a5' / 'early maps' / 'mid maps' / 'late maps' / 'maps' -> stage hints for a links query."""
    out = {}
    a = re.search(r"\b(?:act ?|a)(\d{1,2})\b", s)
    if a and 1 <= int(a.group(1)) <= 10:
        out["act"] = int(a.group(1))
    m = re.search(r"\b(early|mid|middle|late|end ?game|red|yellow|white)\s+(?:game\s+)?maps?\b|\b(early|mid|late) mapping\b", s)
    if m:
        w = (m.group(1) or m.group(2) or "").replace(" ", "")
        out["stage"] = {"early": "EM", "white": "EM", "mid": "MM", "middle": "MM", "yellow": "MM", "late": "LM", "red": "LM", "endgame": "LM"}.get(w, "EM")
        out["maps"] = True
    elif re.search(r"\b(maps?|mapping|endgame|atlas)\b", s):
        out["maps"] = True
    return out


def link_category(s: str):
    m = re.search(rf"\b(?:{_CAT_RE})\b", s)
    return m.lastgroup if m else None


def parse_query(s: str):
    fb = iv4.parse_fate_boss(s)
    if fb:
        return fb
    cq = iv4.parse_chase_query(s)
    if cq:
        return cq
    fi = parse_fate_info(s)
    if fi:
        return fi
    # stand-alone category / stage link requests without a question word: "act 1 main attack", "act 5 utility links"
    cat = link_category(s)
    if cat and re.fullmatch(rf"(?:(?:okay|ok|so|hey|and)\s+)*(?:(?:give me|tell me|show me|show|read)\s+)?(?:my\s+|the\s+)?(?:(?:act|a) ?\d{{1,2}}\s+|(?:early|mid|late)\s+maps?\s+|maps?\s+)?(?:my\s+)?(?:{LINK_CATS[cat]})(?:\s+(?:links?|gems?|skills?|setup|set up))?(?:\s+(?:for|in|at|during)\s+(?:the\s+)?(?:(?:act|a) ?\d{{1,2}}|(?:early|mid|late)\s+maps?|maps?))?(?:\s+please)?", s):
        return dict({"type": "query", "what": "links", "links": None, "focus": cat}, **link_stage(s))
    if re.fullmatch(r"(?:(?:okay|ok|so|hey)\s+)*(?:my\s+)?(?:(?:act|a) ?\d{1,2}|(?:early|mid|late)\s+maps?|maps?) (?:links?|gems?|setup|skills?)(?: please)?", s):
        return dict({"type": "query", "what": "links", "links": None, "focus": "all"}, **link_stage(s))
    if re.search(r"\b(what is next|what next|what now|what do i do(?! with| if| about)|next up|what should i do(?! with| if| about)|what am i doing next|where am i at|what is the next|what is (my|the) (next |current )?(stop|checkpoint|milestone))\b", s):
        return {"type": "query", "what": "next"}
    if re.search(r"\b(how am i doing|how is my pace|how is the pace|am i (ahead|behind|on pace)|pace check|what is my pace|how far (ahead|behind)|status( report)?|how are we doing|time check|how much time|how long have i (been playing|played))\b", s):
        return {"type": "query", "what": "pace"}
    if re.search(r"\b(what (map )?tier|cleared for|what can i run|which tier|gate check|what gate)\b", s):
        return {"type": "query", "what": "gate"}
    if re.search(r"\bhow many fates\b|\bfate cap\b|\bfates allowed\b|\bcan i (use|add|run) (a |any )?fates?\b|\bfate rules?\b|\bshould i (use|run|add) (a |any )?fates?\b", s):
        return {"type": "query", "what": "fates"}
    return None


LINKWORDS = r"\b(link|links|linked|link up|setup|set up|gems?|sockets?|socket|skills?|supports?|auras?|spectres?|spectre setup|movement|swap|weapon swap|main skill)\b"


def parse_question(s: str):
    """Local Q&A intents for a question sentence (already normalised)."""
    if re.fullmatch(r"(okay |ok |hey )?(can|do) you hear me( now| okay| ok)?|is this (thing )?(on|working)|mic check|are you (there|listening|on)", s):
        return {"type": "query", "what": "hello"}
    lv = re.search(r"\b(?:level|lvl|lv)\s+(\d{1,3})\b", s) or re.search(r"\b(\d{1,3}) (?:level|lvl)\b", s)
    act = re.search(r"\bact (\d{1,2})\b", s)
    level = int(lv.group(1)) if lv and 1 <= int(lv.group(1)) <= 100 else None
    actn = int(act.group(1)) if act and 1 <= int(act.group(1)) <= 10 else None
    maps = bool(re.search(r"\b(maps?|mapping|endgame|t\d{1,2})\b", s))
    dw = parse_drop_where(s)
    if dw:
        return dw
    cat = link_category(s)
    definition = re.match(r"^what (?:is|are) (?:a|an) ", s)      # "what is a skill gem" is a wiki question, not my links
    if (re.search(LINKWORDS, s) or cat) and not definition and not re.search(r"\b(price|cost|drop|drops|where do i (get|find))\b", s):
        n = re.search(r"\b([1-6]) ?(?:link|links|linked|l|socket|sockets|slot)\b", s)
        focus = "all"
        if re.search(r"\b(weapon swap|swap)\b", s): focus = "swap"
        elif re.search(r"\b(which|what) spectres?\b|\bspectres? should\b|\bwhat should i raise\b|\b(?:what|which) (?:are|is) (?:my|the) spectres?\b|\bmy spectres?\b", s): focus = "spectres"
        elif cat: focus = cat
        elif n: focus = "main"
        q = {"type": "query", "what": "links", "links": int(n.group(1)) if n else None, "focus": focus}
        if level: q["level"] = level
        q.update(link_stage(s))
        if actn: q["act"] = actn
        if maps: q["maps"] = True
        return q
    if re.search(r"\b(res|resist|resists|resistance|resistances|uncapped|capped|cap my|defen[cs]es|chaos res|my life|my es|energy shield|my pool|block|attack block|spell block)\b", s):
        return {"type": "query", "what": "res"}
    if re.search(r"\b(stop|checkpoint|milestone|segment|split)\b", s):
        return {"type": "query", "what": "next"}
    if re.search(r"\b(pace|ahead|behind|time|timer|paused|clock|elapsed)\b", s):
        return {"type": "query", "what": "pace"}
    if re.search(r"\bfates?\b", s):
        return {"type": "query", "what": "fates"}
    if re.search(r"\bwhat level\b|\bmy level\b", s):
        return {"type": "query", "what": "res"}
    m = re.search(r"\b(?:what (?:do|should) i do with|what (?:do|should) i do if i (?:find|get|drop)|what about|what is the plan for|plan for|should i (?:use|equip|roll|keep|wear)|what does|what is|what if i (?:find|get))\s+(?:a |an |the )?(.+)$", s)
    if m:
        item = match_item(m.group(1))
        if item and item.get("confidence") == "high":
            return {"type": "query", "what": "trigger", "item": item["name"], "kind": item["kind"]}
    return None


def parse_fate_info(s: str):
    """'what is the fate reward and added danger for merveil' / 'wickerman for dominus' / 'what does malachai's fate give'."""
    if not re.search(r"\b(fates?|faiths?|wickerman|viscera|added danger|fate reward)\b", s):
        return None
    m = (re.search(r"\b(?:fates?|faiths?|wickerman|viscera)\b(?:\s+(?:reward|rewards|info|information|danger|dangers|mods?|bonus|piece|boss|effect|effects|entry|details))*"
                   r"(?:\s+and\s+(?:the\s+)?(?:added\s+)?(?:danger|dangers|mechanics?|mods?))?\s+(?:for|on|of|at|from)\s+(?:the\s+)?(.+?)(?:\s+(?:fight|boss|encounter))?$", s)
         or re.search(r"\b(?:what does|what do)\s+(?:the\s+)?(.+?)(?:'s| s)?\s+(?:fate|wickerman|viscera)\s+(?:give|do|add)\b", s)
         or re.search(r"\b(?:added danger|fate reward)\b.*?\b(?:for|on|of|at)\s+(?:the\s+)?(.+)$", s)
         or re.search(r"\bwhat (?:does|do|will)\s+(?:the\s+)?(.+?)\s+(?:drop|give|add)\s+(?:for|with)\s+(?:a\s+|the\s+)?(?:fates?|faiths?|wickerman)\b", s)
         or re.search(r"\b(?:fates?|faiths?|wickerman|viscera)\s+(?:info|information|rewards?|danger)\s+(?!for\b|on\b|of\b|at\b)(?:the\s+)?(.+)$", s))
    if not m:
        return None
    boss = re.sub(r"\b(please|now|again)\b", "", m.group(1)).strip(" ,.")
    if not boss or re.fullmatch(r"(it|this|that|him|her|this boss|that boss|my|me|a boss|bosses|all|every boss)", boss):
        boss = ""
    if re.match(r"^(i|my|a|an)\b", boss) or len(boss) > 40:
        return None
    return {"type": "query", "what": "fate_info", "boss": boss, "open": bool(boss)}


def parse_drop_where(s: str):
    """'where does the cane of kulimac drop' / 'where do i find X' / 'what drops X' / 'how do i get X'."""
    m = (re.search(r"\bwhere (?:does|do|can|could|would|will|did|is)\s+(?:i\s+(?:get|find|farm)\s+|you\s+(?:get|find)\s+)?(?:a |an |the )?(.+?)\s+(?:drop|drops|dropped|come from|spawn|spawns|located|found)\b", s)
         or re.search(r"\bwhere (?:do|can|could|should) i (?:get|find|farm) (?:a |an |the )?(.+?)$", s)
         or re.search(r"\bwhat (?:drops|gives) (?:a |an |the )?(.+?)$", s)
         or re.search(r"\b(?:which|what) (?:boss|bosses|monster|monsters|map|maps|area|areas|zone|zones|act|league mechanic|mechanic) (?:drops|drop|gives|give|has) (?:a |an |the )?(.+?)$", s)
         or re.search(r"\bwho drops (?:a |an |the )?(.+?)$", s)
         or re.search(r"\b(?:drop location|drop source|drop locations|drop sources) (?:of|for) (?:a |an |the )?(.+?)$", s)
         or re.search(r"\bwhere (?:is|are) (?:a |an |the )?(.+?) (?:dropping|drop)\b", s))
    if not m:
        return None
    what = m.group(1).strip()
    item = match_item(what)
    q = {"type": "query", "what": "drop_where", "text": what}
    if item and item.get("confidence") == "high":
        q.update(item=item["name"], kind=item["kind"])
    return q


def parse_recipe(s: str):
    """Vendor-recipe questions go straight to research (Vendor recipe system page)."""
    mk = re.fullmatch(r"(?:(?:okay|ok|hey|so|um|uh)\s+)*how (?:do|can|could|should) (?:i|you|we) (?:make|craft|vendor for|get from (?:a )?vendor) (?:a |an |some |the )?(.+?)(?: please)?", s)
    if mk:
        return {"type": "research", "query": "vendor recipe " + mk.group(1).strip(), "topic": "recipe"}
    if re.search(r"\b(vendor recipe|vendor recipes|recipe|recipes)\b", s) and not re.search(r"\b(undo|cancel)\b", s):
        q = re.sub(r"^(?:(?:okay|ok|hey|so|um|uh)\s+)*(?:(?:what|which) is (?:the )?|what are (?:the )?|tell me (?:the )?|how do i (?:do |use )?(?:the )?|is there (?:a |any )?)?", "", s)
        return {"type": "research", "query": q.strip(), "topic": "recipe"}
    return None


# "I'm in Act 2" / "I'm in Act 2, not Act 3" / "actually act 2 not 3" / "set act to 2" / "we're still in act 2"
SET_ACT_RE = (r"^(?:(?:no|nope|okay|ok|so|actually|wait|sorry|correction|hey|um|uh)\s+)*"
              r"(?:(?:i am|we are|i am actually|i am still|we are still|still|actually|i am only|we are only|i am currently|currently|this is|it is)\s+)?"
              r"(?:(?:in|on|at)\s+)?act (\d{1,2})(?:\s+(?:now|actually|still|right now))?"
              r"(?:\s+(?:not|and not|rather than|instead of)\s+(?:in\s+)?(?:act\s+)?(\d{1,2}))?(?:\s+(?:now|actually|yet|please))?$")


def parse_set_act(s: str):
    s = re.sub(r"\s+", " ", s.replace(",", " ")).strip()
    m = re.fullmatch(r"(?:(?:please|okay|ok)\s+)?(?:set|change|correct|fix|move)(?: the| my)? act(?: to| back to)? (\d{1,2})(?: please)?", s) \
        or re.fullmatch(SET_ACT_RE, s)
    if not m:
        return None
    n = int(m.group(1))
    if not 1 <= n <= 10:
        return None
    # a bare "act 3" is not a correction, and "act 3 done" never reaches here (fullmatch)
    if re.fullmatch(r"(?:okay |ok |so )?act \d{1,2}", s):
        return None
    out = {"type": "set_act", "act": n}
    if m.lastindex and m.lastindex >= 2 and m.group(2):
        out["was"] = int(m.group(2))
    return out


def parse_clause(c: str, defs: dict):
    acts = []
    # --- death / near death (near first, and "died to X" is a death but "kitava died" is not)
    if re.search(r"\b(near death|neardeath|near deaf|nearly died|nearly dead|almost died|almost dead|close call|that was close|so close to dying|nearly lost)\b", c):
        return [{"type": "log", "text": "Near-death (flasks empty / pool < 30%)"}]
    if re.search(KITAVA, c) is None and (
            re.search(r"\b(i|i've|ive|i have|i just|just|character|char|my guy|he|she)\s+(just\s+)?(died|is dead|am dead|got killed|got one shot|got oneshot|rip)\b", c)
            or re.fullmatch(r"(i am )?(dead|died|rip|r i p|i died)( again)?", c)
            or re.search(r"\b(i am dead|i died|died to|got (one|1) shot|(one|1) shotted|oneshotted|character died|character is dead|rip my|rest in peace)\b", c)):
        return [{"type": "log", "text": "Death (character died)"}]

    # --- bandits (Act 2: Ziz kills all three)
    b = re.search(r"\b(?:killed|kill|beat|helped|help|sided with)\s+(oak|kraityn|kraitin|kratin|alira|elira|a lira)\b", c)
    if b:
        name = {"oak": "Oak", "alira": "Alira", "elira": "Alira", "a lira": "Alira"}.get(b.group(1), "Kraityn")
        return [{"type": "log", "text": f"Bandit killed: {name}" if b.group(0).startswith(("kill", "beat")) else f"Bandit helped: {name}"}]
    if re.search(r"\b(killed|kill|did|done with)\b.*\b(all|3|three|the)\s+(\d\s+)?bandits\b|\bbandits\b.*\b(killed|dead|done)\b", c):
        return [{"type": "log", "text": "Bandits: all killed"}]

    # --- start league
    if re.search(r"\b(start|started|starting|begin) (the )?(league|timer|campaign|clock|run)\b|\bleague (has )?(started|start|is live)\b|\bwe are live\b", c):
        return [{"type": "start"}]

    # --- act correction inside a longer sentence
    sa = parse_set_act(c)
    if sa:
        return [sa]
    # --- milestones
    m = parse_milestone(c)
    if m:
        acts.append(m)

    # --- defence numbers / res
    acts.extend(parse_defense(c, defs))

    # --- tiers reached
    t = re.search(r"\b(?:reached|hit|in|entered|into|running|started|first|made it to|got to|doing)\s+(?:my\s+)?(?:first\s+)?t(\d{1,2})\b", c) \
        or re.search(r"\bt(\d{1,2})\s+(?:maps?\s+)?(?:now|reached|unlocked|started)\b", c)
    if t and 1 <= int(t.group(1)) <= 17:
        acts.append({"type": "log", "text": f"Reached T{int(t.group(1))}"})
    elif re.search(r"\b(white maps|start(ed|ing)? mapping|first map|in maps)\b", c) and not m:
        acts.append({"type": "milestone", "id": "M15"})

    # --- Atlas / slot / heist events
    if re.search(r"\batlas (is )?(open|opened|unlocked)\b|\bopened the atlas\b", c):
        acts.append({"type": "log", "text": "Atlas opened"})
    if re.search(r"\b(second|2nd|2) (map )?(device )?slot\b", c):
        acts.append({"type": "log", "text": "Second map-device slot unlocked"})

    # --- boss kill with fates (not Kitava, that is a milestone)
    k = re.search(r"\b(?:killed|beat|downed|did)\s+(?:the\s+)?(.+?)(?:\s+with\s+(\d|no|zero)\s+(?:fates?|faiths?|faith|fade|fades))?$", c)
    if k and (not m or m.get("boss")) and not re.search(KITAVA, c) and not re.search(LAB, c) and re.search(r"\b(fates?|faiths?|boss)\b", c):
        boss = re.sub(r"\b(boss|map boss)\b", "", k.group(1)).strip() or "map boss"
        n = k.group(2)
        acts.append({"type": "kill", "boss": boss.title(), "fates": 0 if n in (None, "no", "zero") else int(n)})

    # --- v4: the character's own drop / event types ("dropped a 4 link", "found a 5 link", "a unique, Bones of Ullr")
    ct = iv4.match_custom(c)
    if ct and not (m and ct.get("kind") == "drop" and not re.search(DROP_VERBS, c)):
        acts.append(iv4.custom_action(ct, c, match_item(c) if ct.get("named") else None))
        return acts

    # --- drops
    staff = re.search(r"\bstaff\b.*?\b(\d{3,4})\s*(?:p ?dps|pdps|physical|phys|dps)\b", c) or re.search(r"\b(\d{3,4})\s*(?:p ?dps|pdps|physical dps|phys dps)\s+staff\b", c)
    if staff:
        acts.append({"type": "log", "text": f"Staff {staff.group(1)} pDPS", "kind": "drop"})
        return acts
    if re.search(r"\b(6|six) ?(link|linked|l)\b", c) and not acts and not re.search(iv4.HYPO, c):
        acts.append({"type": "log", "text": "6-link: " + c, "kind": "drop"})
        return acts
    item = match_item(c)
    if item and not (m and item["kind"] != "trigger"):
        suffix = {
            "divcard": " (divination card)",
            "gem": " (gem)",
            "fate": " (fate)",
            "thread": " (thread)",
            "viscera": " (viscera)",
        }.get(item["kind"], "")
        text = item["name"] + suffix
        if item.get("confidence") == "low":
            text = "? " + text
        n = re.search(r"\b(\d{1,2})\s", c + " ")
        # Don't treat a number that is part of the item name ("Seven Years Bad Luck" -> 7) as a quantity.
        name_nums = set(re.findall(r"\d+", words_to_numbers(re.sub(r"[-'’]", " ", item["name"].lower()))))
        if item["kind"] in ("divcard", "currency") and n and int(n.group(1)) > 1 and not re.search(r"\bact\b", c) \
                and n.group(1) not in name_nums:
            text = f"{n.group(1)}x {text}"
        acts.append({"type": "log", "text": text, "kind": "drop", "match": item})
    elif not acts and re.search(r"\b(card|div card|divination)\b", c) and re.search(DROP_VERBS, c):
        acts.append({"type": "log", "text": "Div card: " + c, "kind": "note"})
    return acts


NOT_YET = r"\b(not|almost|nearly|about to|going to|gonna|before|until|till|when|once|if|soon|halfway|half way|yet)\b"
ACT_BOSSES = [
    (r"merveil|marveil|merville|marvel", 1),
    (r"vaal oversoul|oversoul|over soul", 2),
    (r"dominus|dominous|domenus", 3),
    (r"malachai|malakai|malachi|malakay|malachy|the nightmare", 4),
    (r"brine king|tsoagoth|soagoth", 6),
    (r"arakaali|arakali|arakhali|arrakali", 7),
    (r"lunaris and solaris|solaris and lunaris|lunaris|solaris", 8),
    (r"depraved trinity|the trinity", 9),
]


def parse_milestone(c: str):
    if re.search(r"\bstaffskillpoint\b|\bgot the staff\b|\bskill point\b.*\bstaff\b", c):
        return {"type": "milestone", "id": "M11"}
    lab = re.search(LAB, c)
    if lab and (re.search(DONE, c) or re.search(r"\b(ascend|ascended|ascendancy|enchant)\b", c) or re.search(r"\b(normal|cruel|merciless|crude|crew|cool|merciful)\b", c)) \
            and not re.search(r"\b(uber|eternal)\b", c) and not re.search(r"\b(start|starting|going to|gonna|about to|doing)\b", c):
        which = "next"
        if re.search(r"\bnormal\b", c): which = "normal"
        elif re.search(r"\b(cruel|crude|crew|cool)\b", c): which = "cruel"
        elif re.search(r"\b(merciless|merciful)\b", c): which = "merciless"
        return {"type": "milestone", "lab": which}
    if re.fullmatch(r"(okay |ok )?(normal|cruel|merciless)( is)? (done|finished|complete|cleared)", c):
        return {"type": "milestone", "lab": re.search(r"normal|cruel|merciless", c).group(0)}
    if re.search(r"\bascended\b", c):
        return {"type": "milestone", "lab": "next"}
    if re.search(KITAVA, c) and (re.search(DONE, c) or re.search(r"\b(kill|killed|beat|down|dead)\b", c)):
        a = re.search(r"\bact (5|10)\b", c) or re.search(KITAVA + r" (?:act )?(5|10)\b", c) or re.search(r"\b(5|10) " + KITAVA[2:], c)
        return {"type": "milestone", "kitava": int(a.group(a.lastindex)) if a else "next"}
    def blocked(mt):   # "almost done with act 3", "act 3 is not done yet" (look only around the phrase itself)
        return re.search(NOT_YET, c[max(0, mt.start() - 22):mt.end() + 6]) is not None
    # arrival: only unambiguous phrases ("entering act 4", "made it to act 4") -> act 3 done.
    # "heading to / moving to / going to act N" is intent, not arrival: it no longer marks anything.
    a = re.search(r"\b(?:starting|started|entering|entered|on to|onto|now in|welcome to|made it to|arrived in|arrived at|just got to|got to|reached)\s+act (\d{1,2})\b", c)
    if a and 2 <= int(a.group(1)) <= 10 and not re.search(DONE, c) and not blocked(a):
        return {"type": "milestone", "act": int(a.group(1)) - 1}
    # completion: the done word must belong to the act ("act 3 done", "finished act 3", "act 3 boss down")
    a = re.search(r"\bact (\d{1,2})(?: (?:is|has been|was|now|finally|officially|all|boss|is now))* (?:done|finished|complete|completed|cleared|over|beaten|beat|finito|dusted)\b", c) \
        or re.search(r"\b(?:done|finished|finish|completed|complete|cleared|beat|beaten|through)(?: with)?(?: the)? act (\d{1,2})\b", c) \
        or re.search(r"\bact (\d{1,2}) boss(?: is| was)? (?:down|dead|killed|done|beaten)\b", c)
    if a and 1 <= int(a.group(1)) <= 10 and not blocked(a):
        return {"type": "milestone", "act": int(a.group(1))}
    # act bosses: "Malachai down", "killed Merveil", "Dominus is dead"
    for pat, n in ACT_BOSSES:
        bm = re.search(rf"\b(?:{pat})\b", c)
        if bm and not blocked(bm) and (re.search(rf"\b(?:{pat})(?:'s| s)?(?: is| was| finally| now)* (?:down|dead|done|killed|beaten|beat|dusted)\b", c)
                                                 or re.search(rf"\b(?:killed|beat|downed|did|finished)(?: off)?(?: the)? (?:{pat})\b", c)):
            return {"type": "milestone", "act": n, "boss": True}
    if re.fullmatch(r"(act|checkpoint|milestone|this act|that act|segment)( is)? (done|finished|complete|cleared)", c) \
            or re.fullmatch(r"(next( milestone| checkpoint)?|mark( it)?|done with (this|the) act|finished (this|the) act)", c):
        return {"type": "milestone", "next": True}
    return None


def _num_after(c: str, words: str):
    m = re.search(rf"\b(?:{words})\b(?:\s+(?:res|resist|resistance|resistances|rez|is|at|of|to|now|are|=|was|on|about|around|roughly|like))*\s+(-?\d+(?:\.\d+)?)\b", c)
    if m: return float(m.group(1))
    m = re.search(rf"(-?\d+(?:\.\d+)?)\s+(?:{words})\b", c)
    return float(m.group(1)) if m else None


def parse_defense(c: str, defs: dict):
    """Per-clause boolean defence facts (capped / not capped / overcapped / chaos capped).
    Numbers are read once for the whole statement by parse_defense_numbers()."""
    acts = []
    resword = r"\b(res|ress|rez|resist|resists|resistance|resistances|resi|elemental|ele|fire|cold|lightning)\b"
    has_chaos = re.search(r"\b(chaos|kaos|cayos|chaus)\b", c)
    if has_chaos and _num_after(c, "chaos|kaos|cayos|chaus") is None and re.search(r"\bcapped\b", c) and not re.search(NEG, c):
        acts.append({"type": "def", "field": "chaos", "value": 75})
    if re.search(r"-?\d", re.sub(r"\b(act|t)\s?\d+\b", "", c)) and re.search(r"\b(fire|cold|lightning|all|ele|elemental|everything else)\b", c):
        return acts   # numbers given: the number parser sets them
    ele_ctx = re.search(resword, c) and not (has_chaos and not re.search(r"\b(ele|elemental|fire|cold|lightning|all)\b", c))
    if re.search(r"\bover ?capp?(ed)?\b|\bovercap\b", c):
        neg = re.search(NEG, c) is not None
        acts.append({"type": "def", "field": "over", "value": not neg})
        if not neg:
            acts.append({"type": "def", "field": "ele", "value": True})
    elif ele_ctx and re.search(r"\b(uncapped|low|missing)\b", c):
        acts.append({"type": "def", "field": "ele", "value": False})
    elif re.search(r"\b(cap|capped|caps|capt|kept|maxed)\b", c) and (ele_ctx or re.fullmatch(r"(all )?capped", c)):
        acts.append({"type": "def", "field": "ele", "value": re.search(NEG, c) is None})
    return acts


# keyword -> field. Order matters: longer phrases first. A trailing "res/resistance" is absorbed.
_RES = r"(?:\s+(?:res|ress|rez|resist|resists|resistance|resistances))?"
DEF_KEYWORDS = [
    ("pool", r"pool|life pool"),
    ("block", r"spell block(?: chance)?|spellblock|block spells?|spell block chance|chance to block spells?(?: damage)?"),
    ("ablock", r"attack block(?: chance)?|block attacks?|chance to block attacks?(?: damage)?|block(?: chance)?"),
    ("level", r"character level|char level|level|lvl"),
    ("all", r"(?:all|every)(?: (?:ele|elemental))? (?:res|resists?|resistances?)|(?:ele|elemental) (?:res|resists?|resistances?)|(?:res|resists|resistances) (?:are )?all|all three|all ele|all elemental"),
    ("else", r"everything else|all else|all the rest|the rest|all others|the others|others|other (?:res|resists?|resistances?)|everything"),
    ("fire", r"fire" + _RES),
    ("cold", r"cold" + _RES),
    ("lightning", r"(?:lightning|lightening|lighting)" + _RES),
    ("chaos", r"(?:chaos|kaos|cayos|chaus)" + _RES),
    ("life", r"max(?:imum)? life|life|health|hit points|hp"),
    ("es", r"max(?:imum)? energy shield|energy shield|e s|es|ees|(?<!minion )(?<!a )shield(?! charge)"),
]
_DEF_RE = re.compile(r"(?P<num>-?\d+(?:\.\d+)?)|" + "|".join(rf"(?P<{f}>\b(?:{p})\b)" for f, p in DEF_KEYWORDS))
DEF_RANGE = {"level": (1, 100), "fire": (-200, 90), "cold": (-200, 90), "lightning": (-200, 90), "chaos": (-200, 90),
             "all": (-200, 90), "else": (-200, 90), "life": (1, 20000), "es": (0, 30000), "pool": (1, 50000),
             "block": (0, 90), "ablock": (0, 90)}
RES_FIELDS = ("fire", "cold", "lightning", "chaos")


def parse_defense_numbers(s: str) -> dict:
    """Pair numbers with defence keywords across one statement, in either order:
    'level 12, 37 cold res, 45 fire, 28 lightning, 25 chaos' / 'cold 25, 0 everything else' / 'life 4200 es 600'.
    Returns {field: int}; 'all' -> fire/cold/lightning, 'else' -> every res (incl. chaos) not named."""
    if not re.search(r"\d", s):
        return {}
    t = s
    t = re.sub(r"\bact \d{1,2}\b|\bt\d{1,2}\b|" + KITAVA + r" (?:act )?(?:5|10)\b|\b(?:5|10) " + KITAVA[2:], " ", t)
    cap_else = re.search(r"\b(everything else|all else|all the rest|the rest|all others|the others|others|everything)( is| are)? (?:capped|maxed|max|fine|good)\b", t)
    if cap_else:   # "lightning 48, everything else capped" = the other elemental res at 75 (chaos not implied)
        t = t[:cap_else.start()] + cap_else.group(1) + " 75" + t[cap_else.end():]
    pre = {}
    named = {m.lastgroup for m in _DEF_RE.finditer(t) if m.group("num") is None}
    # "res are 76 75 75 (and chaos minus 20)": fire, cold, lightning (, chaos) in character-sheet order
    m3 = re.search(r"\b(?:res|resists|resistances?|resistance)\b(?: (?:are|is|at|of|now))*[ :]+(-?\d+)[ ,/]+(?:and )?(-?\d+)[ ,/]+(?:and )?(-?\d+)(?:[ ,/]+(?:and )?(?:chaos(?: res)? )?(-?\d+))?\b", t)
    if m3 and not named & {"fire", "cold", "lightning", "all"}:
        vals = [int(x) for x in m3.groups() if x is not None]
        if all(-200 <= v <= 90 for v in vals):
            pre = dict(zip(("fire", "cold", "lightning", "chaos"), vals))
            t = t[:m3.start()] + " " + t[m3.end():]
    elif not named & {"fire", "cold", "lightning", "chaos", "all", "else"}:   # bare "res 75" / "all res 60" = all three elemental
        m1 = re.search(r"\b(?:all )?(?:res|resists|resistances?|resistance)\b(?: (?:are|is|at|of|now|all))* (-?\d+)\b", t)
        if m1 and -200 <= int(m1.group(1)) <= 90:
            pre = {f: int(m1.group(1)) for f in ("fire", "cold", "lightning")}
            t = t[:m1.start()] + " " + t[m1.end():]
    t = re.sub(r"\b\d+ ?(?:sockets?|socketed|links?|linked|l|fates?|faiths?|portals?|minutes?|mins?|hours?|seconds?|divines?|chaos orbs?|exalts?|x)\b", " ", t)
    t = re.sub(r"\bwith (?:\d|no|zero) (?:fates?|faiths?)\b", " ", t)
    t = re.sub(r"\b(?:level|lvl) \d+ (?=(?:raise |vaal )?(?:spectre|spectres|gem|gems|absolution|srs|raging|zombie|support|supports)\b)", " ", t)
    t = re.sub(r"\b(?:raise )?spectres?(?: gem)? (?:is |at )?(?:level )?\d+\b", " ", t)
    t = re.sub(r"\b\d{3,4} ?(?:p ?dps|pdps|physical dps|phys dps|dps)\b", " ", t)
    toks = []
    for m in _DEF_RE.finditer(t):
        if m.group("num") is not None:
            toks.append(("N", float(m.group("num"))))
        else:
            f = m.lastgroup
            if toks and toks[-1][0] == "K" and set(toks[-1][1]) <= set(RES_FIELDS) and f in RES_FIELDS:
                toks[-1] = ("K", toks[-1][1] + (f,))          # "fire and cold 40" -> both
            else:
                toks.append(("K", (f,)))
    if not any(k == "N" for k, _ in toks) or not any(k == "K" for k, _ in toks):
        return pre
    # best pairing of adjacent (K,N)/(N,K) tokens: most pairs, then fewest orientation switches, then K-first
    n = len(toks)
    best = [None] * (n + 2)
    best[n] = best[n + 1] = (0, 0, 0, [])

    def better(a, b):
        return b is None or (a[0], -a[1], a[2]) > (b[0], -b[1], b[2])
    for i in range(n - 1, -1, -1):
        cand = best[i + 1]
        if i + 1 < n and toks[i][0] != toks[i + 1][0]:
            kf = toks[i][0] == "K"
            rest = best[i + 2]
            sw = rest[1] + (1 if rest[3] and rest[3][0][2] != kf else 0)
            c = (rest[0] + 1, sw, rest[2] + (1 if kf else 0), [((toks[i] if kf else toks[i + 1])[1], (toks[i + 1] if kf else toks[i])[1], kf)] + rest[3])
            if better(c, cand):
                cand = c
        best[i] = cand
    out, else_val, all_val = {}, None, None
    for fields, val, _kf in best[0][3]:
        for f in fields:
            lo, hi = DEF_RANGE[f]
            if not (lo <= val <= hi):
                continue
            if f == "else": else_val = int(val)
            elif f == "all": all_val = int(val)
            else: out.setdefault(f, int(val))
    if all_val is not None:
        for f in ("fire", "cold", "lightning"):
            out.setdefault(f, all_val)
    if else_val is not None and any(f in out for f in RES_FIELDS):
        for f in RES_FIELDS:
            if f == "chaos" and cap_else:
                continue
            out.setdefault(f, else_val)
    if pre:
        out.update(pre)
        return out
    if not any(f in out for f in ("fire", "cold", "lightning", "chaos", "all")) and "fire" not in out:
        # a bare "res 75" / "resistances are 60" with no element named = all three elemental
        m = re.search(r"\b(?:res|resists|resistances?|resistance)\b(?: (?:are|is|at|of|now|all))* (-?\d+)\b", t)
        if m and not re.search(r"\b(fire|cold|lightning|chaos)\b", t) and -200 <= int(m.group(1)) <= 90:
            for f in ("fire", "cold", "lightning"):
                out[f] = int(m.group(1))
    return out


def describe(actions) -> str:
    """Fallback spoken text when the tracker page is not connected."""
    bits = []
    for a in actions:
        t = a["type"]
        if t == "log":
            if (a.get("match") or {}).get("confidence") == "low":
                bits.append("did you mean " + a["match"]["name"])
            else:
                bits.append(a["text"].lstrip("? ").split(" (")[0])
        elif t == "milestone": bits.append("milestone")
        elif t == "def": bits.append(a.get("field", "defense"))
        elif t == "kill": bits.append(f"{a['boss']} kill")
        elif t == "start": bits.append("league start")
        elif t == "undo": bits.append("undo")
        elif t == "query": bits.append("question")
        elif t == "pause": bits.append("pause")
        elif t == "resume": bits.append("resume")
        elif t == "fate_attempt": bits.append("fate attempt")
        elif t == "set_act": bits.append(f"act {a['act']}")
        elif t == "research": bits.append("research")
        elif t == "ocr": bits.append("screenshot " + a.get("what", ""))
    return ", ".join(bits) or "nothing"


# --------------------------------------------------------------------------------------------
# Feedback: beeps + TTS (Windows SAPI via pywin32; pyttsx3 fallback; print elsewhere)
# --------------------------------------------------------------------------------------------
class Feedback:
    TONES = {  # (freq Hz, ms) sequences
        "listen": [(880, 40)],
        "ok": [(660, 60), (990, 80)],
        "unknown": [(330, 160)],
        "p1": [(1320, 70), (0, 40), (1320, 70), (0, 40), (1320, 90)],
        "error": [(220, 120), (0, 40), (220, 120)],
        "queued": [(520, 90), (0, 40), (520, 90)],
    }

    def __init__(self, cfg):
        self.cfg = cfg
        self.enabled_tts = bool(cfg.get("tts", True))
        self.last_say = ""
        self._q = queue.Queue()
        self._sd = None
        try:
            import numpy as np  # noqa: F401
            import sounddevice as sd
            self._sd = sd
        except Exception:
            pass
        threading.Thread(target=self._tts_worker, daemon=True).start()

    def beep(self, kind):
        vol = float(self.cfg.get("beep_volume", 0.25))
        if vol <= 0:
            return
        seq = self.TONES.get(kind, self.TONES["ok"])
        if self._sd is not None:
            try:
                import numpy as np
                sr = 22050
                parts = []
                for f, ms in seq:
                    n = int(sr * ms / 1000)
                    if f == 0:
                        parts.append(np.zeros(n, dtype=np.float32)); continue
                    t = np.arange(n) / sr
                    env = np.minimum(1, np.minimum(t, t[::-1]) / 0.006)  # 6 ms fade, no clicks
                    parts.append((np.sin(2 * np.pi * f * t) * env * vol).astype(np.float32))
                self._sd.play(np.concatenate(parts), sr, blocking=False)
                return
            except Exception:
                pass
        if sys.platform == "win32":
            import winsound
            threading.Thread(target=lambda: [winsound.Beep(f, ms) if f else time.sleep(ms / 1000) for f, ms in seq], daemon=True).start()

    def say(self, text):
        if not text:
            return
        self.last_say = text
        print("  🔊", text, flush=True)
        if self.enabled_tts:
            self._q.put(text)

    def _tts_worker(self):
        speak = None
        if sys.platform == "win32":
            try:
                import pythoncom
                import win32com.client
                pythoncom.CoInitialize()
                voice = win32com.client.Dispatch("SAPI.SpVoice")
                voice.Volume = int(self.cfg.get("tts_volume", 80))
                voice.Rate = int(self.cfg.get("tts_rate", 2))
                speak = lambda t: voice.Speak(t, 1 | 2)  # SVSFlagsAsync | SVSFPurgeBeforeSpeak: newest message wins
            except Exception as e:
                print("SAPI unavailable, trying pyttsx3:", e)
        if speak is None:
            try:
                import pyttsx3
                eng = pyttsx3.init()
                eng.setProperty("volume", int(self.cfg.get("tts_volume", 80)) / 100)
                eng.setProperty("rate", 200 + 15 * int(self.cfg.get("tts_rate", 2)))
                def speak(t):
                    eng.say(t); eng.runAndWait()
            except Exception:
                speak = lambda t: None
        while True:
            t = self._q.get()
            while not self._q.empty():  # drop stale messages
                t = self._q.get()
            try:
                speak(t)
            except Exception as e:
                print("TTS error:", e); LOG.write("error", f"TTS: {e}")


# --------------------------------------------------------------------------------------------
# Command hub: parse -> push to tracker page -> wait for result -> feedback
# --------------------------------------------------------------------------------------------
class Hub:
    def __init__(self, cfg, feedback: Feedback, researcher=None):
        self.cfg, self.fb = cfg, feedback
        self.clients = []            # list of queue.Queue, newest last
        self.lock = threading.Lock()
        self.pending = {}            # id -> cmd awaiting a result (replayed when a tracker connects; the page dedupes by id)
        self.results = {}            # id -> (threading.Event, result dict)
        self.history = []            # recent commands with timings, for /api/last
        self.status = "idle"
        self.page_state = {}         # compact tracker state the page sends with each result (used by research)
        self.research = researcher or Researcher(cfg, name_matcher=match_item)
        self.job = None              # running research: {"id", "query", "cancel": Event, "t0"}
        self.last_answer = ""
        self.ocr_busy = False
        self.last_links = None       # {"ts", "q"}: 'main attack links only' within 60 s refines it
        self.offer = None            # {"ts", "query"}: 'Want me to look that up? Say yes' (20 s)
        self.last_ocr_ts = 0.0

    # --- SSE clients
    def add_client(self):
        q = queue.Queue()
        with self.lock:
            self.clients.append(q)
            pend = [c for c in self.pending.values() if time.time() - c["ts"] < 600]
        q.put({"type": "hello", "status": self.status, "hotkey": self.cfg["hotkey"], "ocr_hotkey": self.cfg.get("ocr_hotkey", ""),
               "model": self.cfg.get("_model_desc", ""), "research": self.research.backend()})
        for c in sorted(pend, key=lambda c: c["ts"]):
            q.put({"type": "command", **c})
        return q

    def remove_client(self, q):
        with self.lock:
            if q in self.clients:
                self.clients.remove(q)

    def broadcast(self, msg):
        with self.lock:
            for q in self.clients:
                q.put(msg)

    def set_status(self, state, detail=""):
        self.status = state
        self.broadcast({"type": "status", "state": state, "detail": detail})

    # --- results from the page
    def post_result(self, res):
        cid = res.get("id")
        if isinstance(res.get("state"), dict):
            self.page_state = res["state"]
        with self.lock:
            self.pending.pop(cid, None)
            ev = self.results.get(cid)
        if ev:
            ev[1].update(res); ev[0].set()

    def push(self, actions, transcript, source="system", wait=False):
        """Send actions to the tracker without speaking (research answers, OCR proposals). Queued if no page is open."""
        cid = uuid.uuid4().hex[:10]
        cmd = {"id": cid, "ts": time.time(), "transcript": transcript, "actions": actions, "source": source}
        ev = (threading.Event(), {})
        with self.lock:
            self.results[cid] = ev
            self.pending[cid] = cmd
            target = list(self.clients)
        for q in target:
            q.put({"type": "command", **cmd})
        if wait and target:
            ev[0].wait(self.cfg.get("result_timeout_ms", 1200) / 1000)
        with self.lock:
            self.results.pop(cid, None)
        return ev[1]

    # --- research (async; the spoken ack is immediate)
    def start_research(self, query, rec):
        if self.job:
            self.job["cancel"].set()
        job = {"id": uuid.uuid4().hex[:8], "query": query, "cancel": threading.Event(), "t0": time.perf_counter()}
        self.job = job
        threading.Thread(target=self._research_worker, args=(job,), daemon=True).start()
        say = f"Looking up {query[:60]}."
        self.fb.beep("ok"); self.fb.say(say)
        rec.update(say=say, level="ok", research=job["id"])

    def _research_worker(self, job):
        try:
            res = self.research.answer(job["query"], state=self.page_state, cancel=job["cancel"])
        except Exception as e:  # noqa: BLE001
            res = {"query": job["query"], "spoken": "The lookup failed.", "full": str(e)[:200], "source": "error", "url": "", "title": ""}
        if job["cancel"].is_set() or res.get("cancelled"):
            return
        if self.job is job:
            self.job = None
        res["ms"] = round((time.perf_counter() - job["t0"]) * 1000)
        self.last_answer = res.get("spoken", "")
        self.push([{"type": "research_result", **{k: res.get(k, "") for k in ("query", "title", "url", "spoken", "full", "source", "note", "ms")}}],
                  f"research: {job['query']}", source="research")
        self.fb.beep("ok"); self.fb.say(res.get("spoken") or "No answer found.")
        self._remember({"transcript": "research: " + job["query"], "actions": [], "source": "research", "say": res.get("spoken", ""),
                        "research_ms": res["ms"], "research_source": res.get("source"), "note": res.get("note", "")})

    def cancel_research(self):
        j, self.job = self.job, None
        if j:
            j["cancel"].set()
            return j["query"]
        return None

    # --- screenshot OCR (F10 / "scan my defences" / paste)
    def start_ocr(self, image=None, rec=None):
        if self.ocr_busy:
            return
        self.ocr_busy = True
        if image is None:
            self.fb.beep("listen")
        threading.Thread(target=self._ocr_worker, args=(image,), daemon=True).start()
        if rec is not None:
            rec.update(say="Scanning.", level="ok")

    def ocr_image(self, image, region=None):
        import ocr as ocrmod
        t = time.perf_counter()
        if region is None and image.size[0] >= 1600 and image.size[0] > image.size[1]:
            region = "left"          # a full-screen screenshot: read the character panel side
        out = ocrmod.read_defences(image, self.cfg.get("ocr_engine", "auto"), region=region)
        out["ms"] = round((time.perf_counter() - t) * 1000)
        return out

    def _ocr_worker(self, image):
        try:
            import ocr as ocrmod
            img = image if image is not None else ocrmod.capture_screen(self.cfg.get("ocr_region", "left"))
            out = self.ocr_image(img)
        except Exception as e:  # noqa: BLE001
            self.ocr_busy = False
            self.fb.beep("error"); self.fb.say("Screen reading failed. " + str(e)[:80])
            print("OCR error:", e, flush=True)
            import traceback
            LOG.write("error", "OCR: " + traceback.format_exc().strip())
            return
        LOG.write("ocr", f"engine={out.get('engine')} method={out.get('method', '')} ms={out.get('ms')} fields={json.dumps(out.get('fields'))} "
                  f"fallback={out.get('fallback')} text={out.get('text', '')[:600]!r}")
        self.ocr_busy = False
        self.deliver_ocr(out)

    def deliver_ocr(self, out):
        fields = out.get("fields") or {}
        if not fields:
            self.fb.beep("unknown"); self.fb.say("I couldn't read any defence numbers. Open the character sheet, Defences tab, and try again.")
            return
        if out.get("hint") == "offence":       # v4: never offer a confirm on the Offence tab's life/mana
            say = "That's the Offence tab, open Defences and press F10 again."
            self.push([{"type": "ocr_notice", "text": say, "fields": fields}], "screenshot scan", source="ocr", wait=False)
            self.fb.beep("unknown"); self.fb.say(say)
            return
        self.last_ocr_ts = time.time()
        res = self.push([{"type": "ocr_proposal", "fields": fields, "uncapped": out.get("uncapped", {}), "source": out.get("source", "?"),
                          "engine": out.get("engine", ""), "ms": out.get("ms"), "partial": bool(out.get("partial")), "hint": out.get("hint", "")}],
                        "screenshot scan", source="ocr", wait=True)
        if res.get("say"):
            self.fb.beep(res.get("level", "ok")); self.fb.say(res["say"])
        else:
            self.fb.beep("queued"); self.fb.say(f"Read {len(fields)} values. Open the tracker to confirm.")

    # --- main entry
    def handle_text(self, transcript, source="voice", t_release=None, asr_ms=None, speak=True):
        t0 = time.perf_counter()
        actions = parse(transcript, {"last_links": self.last_links})
        parse_ms = (time.perf_counter() - t0) * 1000
        rec = {"transcript": transcript, "actions": actions, "source": source, "parse_ms": round(parse_ms, 2), "asr_ms": asr_ms}
        if not actions:
            self.fb.beep("unknown")          # v4: empty speech just beeps
            rec["say"] = "(beep: nothing heard)"
            self._remember(rec); return rec
        if actions[0]["type"] == "yes":
            off, self.offer = self.offer, None
            if off and time.time() - off["ts"] < 20:
                actions = [{"type": "research", "query": off["query"]}]
                rec["actions"] = actions
            elif time.time() - self.last_ocr_ts < 120:
                actions = [{"type": "ocr", "what": "confirm"}]
                rec["actions"] = actions
            else:
                say = "Nothing to say yes to."
                self.fb.beep("unknown")
                if speak: self.fb.say(say)
                rec.update(say=say, level="unknown"); self._remember(rec); return rec
        for a in actions:
            if a.get("type") == "query" and a.get("what") == "links":
                self.last_links = {"ts": time.time(), "q": a}
        off_q = next((a for a in actions if a.get("type") == "query" and a.get("what") in ("unknown", "drop_where")), None)
        self.offer = {"ts": time.time(), "query": offer_query(off_q)} if off_q else None
        local = [a for a in actions if a["type"] == "local"]
        if local:
            w = local[0]["what"]
            if w == "repeat": self.fb.say(self.fb.last_say or self.last_answer or "Nothing yet.")
            elif w == "mute": self.fb.say("Voice off."); time.sleep(0.05); self.fb.enabled_tts = False
            elif w == "unmute": self.fb.enabled_tts = True; self.fb.say("Voice on.")
            self.fb.beep("ok"); rec["say"] = w; self._remember(rec); return rec
        if actions[0]["type"] == "research":
            self.start_research(actions[0]["query"], rec)
            self._remember(rec); return rec
        if actions[0].get("type") == "undo" and actions[0].get("soft") and self.job:
            q = self.cancel_research()
            say = f"Cancelled the lookup for {q[:40]}."
            self.fb.beep("ok"); self.fb.say(say); rec.update(say=say, level="ok")
            self._remember(rec); return rec
        if actions[0]["type"] == "ocr" and actions[0].get("what") == "scan":
            self.start_ocr(rec=rec)
            if speak: self.fb.say("Scanning.")
            self._remember(rec); return rec
        cid = uuid.uuid4().hex[:10]
        cmd = {"id": cid, "ts": time.time(), "transcript": transcript, "actions": actions, "source": source}
        ev = (threading.Event(), {})
        with self.lock:
            self.results[cid] = ev
            self.pending[cid] = cmd
            target = list(self.clients)   # only the tracker tab holding the voice lock is connected (see voice.js)
        t_push = time.perf_counter()
        if target:
            for q in target:
                q.put({"type": "command", **cmd})
            ev[0].wait(self.cfg.get("result_timeout_ms", 1200) / 1000)
        res = ev[1]
        rec.update(id=cid, roundtrip_ms=round((time.perf_counter() - t_push) * 1000, 1))
        if t_release is not None:
            rec["release_to_feedback_ms"] = round((time.perf_counter() - t_release) * 1000, 1)
        if res:
            level = res.get("level", "ok")
            rec["say"], rec["level"] = res.get("say", ""), level
            if speak:
                self.fb.beep(level); self.fb.say(res.get("say", ""))
        else:
            rec["say"] = ("Saved. Open the tracker to apply: " if not target else "Tracker didn't answer. Saved: ") + describe(actions)
            rec["level"] = "queued"
            if speak:
                self.fb.beep("queued"); self.fb.say("Saved. Tracker not open." if not target else "Saved. Tracker slow.")
        with self.lock:
            self.results.pop(cid, None)
        self._remember(rec)
        return rec

    def note_empty(self, why, ms=None):
        """Empty transcript or a too-short press: a beep, no speech, and one log line (v3 said "Didn't catch that")."""
        self.fb.beep("unknown")
        LOG.write("voice", f"empty: {why}" + (f" audio_ms={ms}" if ms is not None else ""))

    def _remember(self, rec):
        rec["at"] = time.strftime("%H:%M:%S")
        self.history.append(rec)
        del self.history[:-50]
        print(f"[{rec['at']}] {rec['source']}: {rec['transcript']!r} -> {json.dumps(rec['actions'])[:300]}", flush=True)
        timing = {k: rec[k] for k in ("parse_ms", "asr_ms", "roundtrip_ms", "release_to_feedback_ms", "research_ms") if rec.get(k) is not None}
        LOG.write(rec.get("source", "?"), f"heard={rec.get('transcript')!r} actions={json.dumps(rec.get('actions'))} "
                  f"say={rec.get('say', '')!r} level={rec.get('level', '')} {json.dumps(timing) if timing else ''}"
                  + (f" note={rec['note']!r}" if rec.get("note") else ""))


# --------------------------------------------------------------------------------------------
# HTTP server
# --------------------------------------------------------------------------------------------
_tree_cache = {}


def offer_query(q):
    """The research query offered after an unknown question ('What map is Bar Kulin?' -> 'map is Bar Kulin')."""
    if q.get("item"):
        return q["item"]
    t = (q.get("text") or "").strip().rstrip("?.!")
    t = re.sub(r"^(?:what|where|which|how|who|when|why)\s+(?:is|are|does|do|did|can|should)?\s*(?:the\s+)?", "", t, flags=re.I)
    return t or (q.get("text") or "")


def make_handler(hub: Hub, cfg):
    html_path = (HERE / cfg["tracker_html"]).resolve() if not os.path.isabs(cfg["tracker_html"]) else Path(cfg["tracker_html"])

    class H(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *a):
            pass

        def _send(self, code, body: bytes, ctype="application/json"):
            try:
                self.send_response(code)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(body)
            except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
                pass   # the browser/client went away mid-reply (Windows WinError 10053/10054); nothing to do

        def _json(self, obj, code=200):
            self._send(code, json.dumps(obj).encode())

        def _body(self):
            n = int(self.headers.get("Content-Length") or 0)
            if n > 25_000_000:
                raise ValueError("too big")
            return json.loads(self.rfile.read(n) or b"{}") if n else {}

        def _local_only(self):
            # Only accept requests from this machine, from our own page (blocks other websites poking the API).
            origin = self.headers.get("Origin")
            if origin and not re.match(r"^http://(127\.0\.0\.1|localhost):%d$" % cfg["port"], origin):
                self._json({"error": "forbidden origin"}, 403); return False
            return True

        def do_GET(self):
            p = self.path.split("?")[0]
            if p in ("/", "/index.html", "/poe_tracker.html"):
                try:
                    self._send(200, html_path.read_bytes(), "text/html; charset=utf-8")
                except FileNotFoundError:
                    self._send(404, f"Tracker not found at {html_path}".encode(), "text/plain")
            elif p == "/favicon.ico":
                self._send(204, b"", "image/x-icon")
            elif p == "/api/health":
                self._json({"ok": True, "clients": len(hub.clients), "status": hub.status, "hotkey": cfg["hotkey"],
                            "model": cfg.get("_model_desc", ""), "audio": cfg.get("_audio", False), "pending": len(hub.pending)})
            elif p == "/api/last":
                self._json(hub.history[-20:])
            elif p == "/api/build_config":   # written by `companion.py --import-pob`; the page adopts it if newer
                f = HERE / "build_config.json"
                self._send(200, f.read_bytes()) if f.exists() else self._json({"none": True})
            elif p.startswith("/api/tree/"):
                ver = re.sub(r"[^0-9_]", "", p.rsplit("/", 1)[-1])
                try:
                    import pob_import
                    self._json(_tree_cache.setdefault(ver, pob_import.slim_tree(ver)))
                except Exception as e:  # noqa: BLE001
                    self._json({"error": f"no tree data for {ver}: {e}"}, 404)
            elif p == "/api/fates":
                import fates
                d = fates.load()
                threading.Thread(target=fates.refresh, daemon=True).start()   # refresh in the background when stale
                self._json(d or {"none": True})
            elif p == "/api/events":
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Connection", "keep-alive")
                self.end_headers()
                q = hub.add_client()
                try:
                    while True:
                        try:
                            msg = q.get(timeout=15)
                            data = "data: " + json.dumps(msg) + "\n\n"
                        except queue.Empty:
                            data = ": ping\n\n"
                        self.wfile.write(data.encode()); self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
                    pass
                finally:
                    hub.remove_client(q)
            else:
                self._send(404, b"not found", "text/plain")

        def do_POST(self):
            if not self._local_only():
                return
            p = self.path.split("?")[0]
            try:
                body = self._body()
            except Exception:
                return self._json({"error": "bad json"}, 400)
            if p == "/api/result":
                hub.post_result(body); self._json({"ok": True})
            elif p == "/api/inject":   # typed command from the tracker's voice box (and tests)
                text = str(body.get("text", ""))[:500]
                rec = {}
                def run():
                    rec.update(hub.handle_text(text, source=body.get("source", "typed"), speak=cfg.get("speak_typed", True)))
                th = threading.Thread(target=run, daemon=True); th.start()
                if body.get("wait"):
                    th.join(3); self._json(rec)
                else:
                    self._json({"ok": True, "actions": parse(text)})
            elif p == "/api/parse":
                self._json({"actions": parse(str(body.get("text", "")))})
            elif p == "/api/custom_types":   # v4: the page sends the current character's drop / event types
                n = iv4.set_types(body.get("types") or [])
                self._json({"ok": True, "types": n})
            elif p == "/api/ocr":       # pasted screenshot from the tracker page (data URL); OCR runs locally
                try:
                    import ocr as ocrmod
                    out = hub.ocr_image(ocrmod.image_from_data_url(str(body.get("image", ""))))
                    self._json({"ok": True, **{k: out.get(k) for k in ("fields", "uncapped", "source", "engine", "ms", "partial", "hint")}})
                except Exception as e:  # noqa: BLE001
                    self._json({"ok": False, "error": str(e)[:200]})
            elif p == "/api/pob_import":   # PoB code / pobb.in or poe.ninja URL / XML pasted into the tracker
                try:
                    import pob_import
                    out = pob_import.import_build(str(body.get("text", "")))
                    out["source"] = {"kind": "import", "imported": time.strftime("%Y-%m-%dT%H:%M:%S")}
                    LOG.write("import", pob_import.summary(out).replace("\n", " / ")[:800])
                    self._json({"ok": True, "config": out, "summary": pob_import.summary(out)})
                except Exception as e:  # noqa: BLE001
                    LOG.write("error", f"PoB import: {e}")
                    self._json({"ok": False, "error": str(e)[:200]})
            elif p == "/api/ocr_text":  # tests / manual: parse already-OCR'd text
                import ocr as ocrmod
                out = ocrmod.parse_defences_text(str(body.get("text", "")))
                h = ocrmod.tab_hint(str(body.get("text", "")), out.get("fields") or {})
                if h:
                    out["partial"], out["hint"] = True, h
                if body.get("propose"):   # same path as F10 after OCR: proposal to the page, spoken readback
                    out["engine"] = "text"
                    threading.Thread(target=hub.deliver_ocr, args=(dict(out),), daemon=True).start()
                self._json({"ok": True, **out})
            else:
                self._send(404, b"not found", "text/plain")

    return H


# --------------------------------------------------------------------------------------------
# Audio: mic recorder + push-to-talk listener + Whisper
# --------------------------------------------------------------------------------------------
def add_cuda_dll_dirs():
    """pip's nvidia-cublas-cu12 / nvidia-cudnn-cu12 wheels put DLLs under site-packages/nvidia/*/bin."""
    if sys.platform != "win32":
        return
    import site
    for sp in site.getsitepackages() + [site.getusersitepackages()]:
        base = Path(sp) / "nvidia"
        if base.is_dir():
            for b in base.glob("*/bin"):
                try:
                    os.add_dll_directory(str(b))
                    os.environ["PATH"] = str(b) + os.pathsep + os.environ.get("PATH", "")
                except Exception:
                    pass


class Transcriber:
    def __init__(self, cfg):
        from faster_whisper import WhisperModel
        add_cuda_dll_dirs()
        dev = cfg.get("device", "auto")
        self.model = None
        tries = []
        if dev in ("auto", "cuda"):
            tries.append((cfg.get("model", "small.en"), "cuda", "float16"))
        if dev in ("auto", "cpu"):
            tries.append((cfg.get("cpu_model", "small.en"), "cpu", "int8"))
        err = None
        for name, d, ct in tries:
            try:
                t = time.perf_counter()
                kw = dict(device=d, compute_type=ct, cpu_threads=min(8, os.cpu_count() or 4))
                try:
                    self.model = WhisperModel(name, local_files_only=True, **kw)   # no network once downloaded
                except Exception as e:
                    if "cuda" in str(e).lower() or "cudnn" in str(e).lower() or "cublas" in str(e).lower():
                        raise
                    self.model = WhisperModel(name, **kw)
                self.desc = f"{name} on {d} ({ct})"
                self._warm()
                print(f"Whisper ready: {self.desc} in {time.perf_counter() - t:.1f}s", flush=True)
                break
            except Exception as e:
                err = e
                print(f"Could not load {name} on {d}: {e}", flush=True)
                self.model = None
        if self.model is None:
            raise RuntimeError(f"No Whisper model could be loaded: {err}")
        self.beam = int(cfg.get("beam_size", 2))

    def _warm(self):
        import numpy as np
        list(self.model.transcribe(np.zeros(16000, dtype=np.float32), language="en", beam_size=1)[0])

    def transcribe(self, audio):
        segs, _ = self.model.transcribe(
            audio, language="en", beam_size=self.beam, temperature=0.0, initial_prompt=INITIAL_PROMPT,
            condition_on_previous_text=False, without_timestamps=True, vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 400, "speech_pad_ms": 250, "threshold": 0.45},
            no_speech_threshold=0.6, log_prob_threshold=-1.0, compression_ratio_threshold=2.4,
            max_new_tokens=60,   # commands are short; stops runaway hallucination loops
        )
        text = " ".join(s.text.strip() for s in segs if s.no_speech_prob < 0.8).strip()
        # Whisper can echo a long run of the prompt on near-silence: drop that (short commands are kept).
        if len(text) > 60 and text in INITIAL_PROMPT:
            return ""
        return text


def prepare_audio(chunks, sr_in):
    import numpy as np
    if not chunks:
        return None
    a = np.concatenate(chunks).astype(np.float32).flatten()
    if sr_in != 16000:  # linear resample is fine for speech
        n = int(len(a) * 16000 / sr_in)
        a = np.interp(np.linspace(0, len(a) - 1, n), np.arange(len(a)), a).astype(np.float32)
    a = a - float(a.mean())
    # gentle high-pass (~120 Hz): subtract a 64-sample moving average to drop speaker bass rumble
    y = a - np.convolve(a, np.ones(64) / 64, mode="same")
    peak = float(np.max(np.abs(y)) or 1e-6)
    if peak < 0.5:  # quiet dynamic mic (Q2U): boost, capped at 20x
        y = y * min(20.0, 0.5 / peak)
    return np.clip(y, -1, 1).astype(np.float32)


class Recorder:
    def __init__(self, cfg):
        import numpy as np
        import sounddevice as sd
        self.np, self.sd, self.cfg = np, sd, cfg
        dev = None
        want = (cfg.get("mic_device") or "").lower()
        if want:
            for i, d in enumerate(sd.query_devices()):
                if d["max_input_channels"] > 0 and want in d["name"].lower():
                    dev = i; break
            if dev is None:
                print(f"Mic '{cfg['mic_device']}' not found, using the default input.", flush=True)
        info = sd.query_devices(dev, "input")
        self.name = info["name"]
        self.sr = 16000
        try:
            sd.check_input_settings(device=dev, samplerate=16000, channels=1)
        except Exception:
            self.sr = int(info["default_samplerate"])
        self.recording = False
        self.chunks = []
        self.ring = []
        self.ring_max = int(self.sr * cfg.get("preroll_ms", 300) / 1000)
        self.lock = threading.Lock()
        self.stream = sd.InputStream(device=dev, samplerate=self.sr, channels=1, dtype="float32", blocksize=int(self.sr * 0.02), callback=self._cb)
        self.stream.start()   # always open: no start-up delay, and we keep a short pre-roll
        print(f"Mic: {self.name} @ {self.sr} Hz", flush=True)

    def _cb(self, indata, frames, t, status):
        block = indata[:, 0].copy()
        with self.lock:
            if self.recording:
                self.chunks.append(block)
            else:
                self.ring.append(block)
                total = sum(len(b) for b in self.ring)
                while self.ring and total - len(self.ring[0]) >= self.ring_max:
                    total -= len(self.ring.pop(0))

    def start(self):
        with self.lock:
            self.chunks = list(self.ring); self.ring = []; self.recording = True
            self.t_start = time.time()

    def stop(self):
        time.sleep(self.cfg.get("tail_ms", 150) / 1000)
        with self.lock:
            self.recording = False
            chunks, self.chunks = self.chunks, []
        return chunks

    def too_long(self):
        return self.recording and time.time() - self.t_start > self.cfg.get("max_record_s", 15)


def parse_hotkey(spec):
    spec = spec.strip().lower()
    if spec.startswith("mouse:"):
        return ("mouse", spec.split(":", 1)[1])
    return ("key", spec)


class PushToTalk:
    """Listen-only hotkey. pynput listeners observe events; they never inject or suppress any."""

    def __init__(self, cfg, on_down, on_up):
        self.kind, self.name = parse_hotkey(cfg["hotkey"])
        self.on_down, self.on_up, self.held = on_down, on_up, False
        if self.kind == "mouse":
            from pynput import mouse
            btn = getattr(mouse.Button, self.name, None)
            if btn is None:
                raise ValueError(f"Unknown mouse button '{self.name}'. Use x1, x2 or middle.")
            self.target = btn
            self.listener = mouse.Listener(on_click=self._click)
        else:
            from pynput import keyboard
            self.target = getattr(keyboard.Key, self.name, None) or keyboard.KeyCode.from_char(self.name)
            self.listener = keyboard.Listener(on_press=self._press, on_release=self._release)
        self.listener.daemon = True
        self.listener.start()

    def _match(self, key):
        return key == self.target or (getattr(key, "char", None) and getattr(self.target, "char", None) == key.char)

    def _press(self, key):
        if self._match(key) and not self.held:   # ignore auto-repeat
            self.held = True; self.on_down()

    def _release(self, key):
        if self._match(key) and self.held:
            self.held = False; self.on_up()

    def _click(self, x, y, button, pressed):
        if button == self.target:
            (self._press if pressed else self._release)(button)


class KeyTap:
    """Listen-only single-key trigger (the OCR screenshot key). Observes the key, never blocks or injects."""

    def __init__(self, spec, on_tap):
        self.kind, self.name = parse_hotkey(spec)
        self.on_tap, self.held = on_tap, False
        if self.kind == "mouse":
            from pynput import mouse
            self.target = getattr(mouse.Button, self.name)
            self.listener = mouse.Listener(on_click=lambda x, y, b, p: (b == self.target and p and self.on_tap()))
        else:
            from pynput import keyboard
            self.target = getattr(keyboard.Key, self.name, None) or keyboard.KeyCode.from_char(self.name)
            self.listener = keyboard.Listener(on_press=self._press, on_release=self._release)
        self.listener.daemon = True
        self.listener.start()

    def _press(self, key):
        if (key == self.target or (getattr(key, "char", None) and getattr(self.target, "char", None) == key.char)) and not self.held:
            self.held = True; self.on_tap()

    def _release(self, key):
        if key == self.target or (getattr(key, "char", None) and getattr(self.target, "char", None) == key.char):
            self.held = False


def start_ocr_hotkey(hub: Hub, cfg):
    spec = (cfg.get("ocr_hotkey") or "").strip().lower()
    if not spec or spec == cfg["hotkey"].strip().lower():
        return None
    try:
        k = KeyTap(spec, lambda: hub.start_ocr())
        print(f"Screenshot key: press {spec.upper()} with the character sheet (Defences tab) or PoB open.", flush=True)
        return k
    except Exception as e:  # noqa: BLE001
        print(f"Screenshot key disabled: {e}", flush=True)
        return None


def run_audio(hub: Hub, cfg, fb: Feedback):
    rec = Recorder(cfg)
    asr = Transcriber(cfg)
    cfg["_model_desc"] = asr.desc
    cfg["_audio"] = True
    jobs = queue.Queue()

    def down():
        rec.start(); fb.beep("listen"); hub.set_status("listening")

    def up():
        t_rel = time.perf_counter()
        chunks = rec.stop()
        jobs.put((chunks, t_rel))

    def worker():
        while True:
            chunks, t_rel = jobs.get()
            audio = prepare_audio(chunks, rec.sr)
            if audio is None or len(audio) < 16000 * 0.3:
                hub.note_empty("press too short", 0 if audio is None else round(len(audio) / 16))
                hub.set_status("idle"); continue
            hub.set_status("processing")
            t = time.perf_counter()
            try:
                text = asr.transcribe(audio)
            except Exception as e:
                print("ASR error:", e); fb.beep("error"); hub.set_status("idle"); continue
            asr_ms = round((time.perf_counter() - t) * 1000)
            hub.broadcast({"type": "transcript", "text": text, "asr_ms": asr_ms})
            if text:
                hub.handle_text(text, source="voice", t_release=t_rel, asr_ms=asr_ms)
            else:
                hub.note_empty("no speech recognised", round(len(audio) / 16))
            hub.set_status("idle")

    def watchdog():
        while True:
            time.sleep(0.5)
            if rec.too_long():
                up()

    threading.Thread(target=worker, daemon=True).start()
    threading.Thread(target=watchdog, daemon=True).start()
    PushToTalk(cfg, down, up)
    print(f"Push-to-talk: hold {cfg['hotkey'].upper()} and speak, release to send.", flush=True)


# --------------------------------------------------------------------------------------------
class QuietServer(ThreadingHTTPServer):
    """A browser closing a connection mid-request (Windows WinError 10053/10054) is normal; don't print a traceback for it."""
    daemon_threads = True

    def handle_error(self, request, client_address):
        if isinstance(sys.exc_info()[1], (ConnectionAbortedError, ConnectionResetError, BrokenPipeError)):
            return
        super().handle_error(request, client_address)


def load_config(path: Path):
    cfg = json.loads(json.dumps(DEFAULT_CONFIG))
    if path.exists():
        try:
            user = json.loads(path.read_text(encoding="utf-8"))
            for k, v in user.items():
                if k == "research" and isinstance(v, dict):   # deep-merge so new defaults survive an old config.json
                    for kk, vv in v.items():
                        if isinstance(vv, dict) and isinstance(cfg["research"].get(kk), dict):
                            cfg["research"][kk].update(vv)
                        else:
                            cfg["research"][kk] = vv
                else:
                    cfg[k] = v
        except Exception as e:
            print(f"config.json unreadable ({e}); using defaults", flush=True)
    else:
        path.write_text(json.dumps(DEFAULT_CONFIG, indent=2), encoding="utf-8")
    return cfg


def _safe_console():
    """Windows consoles (cp1252 / cp437) can't encode every character OCR or Whisper returns; never crash on a print."""
    for st in (sys.stdout, sys.stderr):
        try:
            st.reconfigure(errors="replace")
        except Exception:  # noqa: BLE001
            pass


def main(argv=None):
    _safe_console()
    ap = argparse.ArgumentParser(description="PoE tracker voice companion")
    ap.add_argument("--config", default=str(HERE / "config.json"))
    ap.add_argument("--port", type=int)
    ap.add_argument("--hotkey")
    ap.add_argument("--no-audio", action="store_true", help="server + parser only (no mic, hotkey or Whisper)")
    ap.add_argument("--no-tts", action="store_true")
    ap.add_argument("--no-browser", action="store_true")
    ap.add_argument("--parse", metavar="TEXT", help="print the parsed actions for TEXT and exit")
    ap.add_argument("--list-mics", action="store_true")
    ap.add_argument("--download-models", action="store_true", help="fetch the Whisper models now (setup.bat runs this)")
    ap.add_argument("--check", action="store_true", help="load Whisper + mic, report device and a timing, then exit")
    ap.add_argument("--check-llm", action="store_true", help="one tiny call to the research LLM backend; prints ok/fail (never the key)")
    ap.add_argument("--research", metavar="QUESTION", help="run one research lookup and print the answer")
    ap.add_argument("--ocr-file", metavar="IMAGE", help="OCR a saved screenshot and print the defence fields it read")
    ap.add_argument("--ocr-engine", choices=["auto", "windows", "rapidocr"], help="engine for --ocr-file / --ocr-selftest")
    ap.add_argument("--ocr-selftest", nargs="?", const="auto", metavar="ENGINE", help="OCR a synthetic Defences image and print PASS/FAIL (auto|windows|rapidocr)")
    ap.add_argument("--import-pob", metavar="CODE_URL_OR_FILE", help="import a Path of Building build (export code, pobb.in / poe.ninja URL, or .xml file) into build_config.json")
    ap.add_argument("--fetch-fates", action="store_true", help="refresh the Fate / Viscera boss data cache from poewiki + poedb")
    a = ap.parse_args(argv)
    if a.parse:
        print(json.dumps(parse(a.parse), indent=1)); return
    if a.list_mics:
        import sounddevice as sd
        for i, d in enumerate(sd.query_devices()):
            if d["max_input_channels"] > 0:
                print(i, d["name"])
        return
    cfg = load_config(Path(a.config))
    if a.check_llm:
        r = Researcher(cfg, name_matcher=match_item)
        print(r.startup_note()); print(r.check_llm()); return
    if a.research:
        r = Researcher(cfg, name_matcher=match_item)
        print(r.startup_note()); print(json.dumps(r.answer(a.research), indent=1)); return
    if a.ocr_file or a.ocr_selftest:
        import ocr as ocrmod
        from PIL import Image
        eng = a.ocr_engine or (a.ocr_selftest if a.ocr_selftest else cfg.get("ocr_engine", "auto"))
        t = time.perf_counter()
        try:
            if a.ocr_selftest:
                img, expect = ocrmod.synthetic_defences_image()
                out = ocrmod.read_defences(img, eng)
            else:
                img, expect = Image.open(a.ocr_file), None
                out = ocrmod.read_defences(img, eng, region="left" if img.size[0] >= 1600 and img.size[0] > img.size[1] else None)
        except ocrmod.OcrUnavailable as x:
            print(f"engine={eng} FAIL: {x}")
            LOG.write("ocr", f"cli {eng} unavailable: {x}")
            sys.exit(1)
        ms = 1000 * (time.perf_counter() - t)
        print(f"engine={out.get('engine')} method={out.get('method', '-')} {ms:.0f} ms")
        if out.get("fallback"):
            print("fell back after:", "; ".join(out["fallback"]))
        if out.get("missing"):
            print("no number read for:", ", ".join(out["missing"]), "(auto mode would add rapidocr)")
        print("fields:", json.dumps(out["fields"]))
        if expect is not None:
            bad = {k: (v, out["fields"].get(k)) for k, v in expect.items() if out["fields"].get(k) != v}
            print("PASS" if not bad else "FAIL " + json.dumps(bad))
        else:
            print("text:\n" + out.get("text", ""))
        return
    if a.import_pob:
        import pob_import
        src = a.import_pob
        if os.path.isfile(src):
            src = Path(src).read_text(encoding="utf-8", errors="replace")
        cfg_out = pob_import.import_build(src)
        cfg_out["source"] = {"kind": "import", "imported": time.strftime("%Y-%m-%dT%H:%M:%S"), "file": os.path.basename(a.import_pob)}
        dest = HERE / "build_config.json"
        dest.write_text(json.dumps(cfg_out), encoding="utf-8")
        print(pob_import.summary(cfg_out)); print("wrote", dest); return
    if a.fetch_fates:
        import fates
        d = fates.refresh(force=True)
        print(fates.summary(d)); return
    if a.download_models:
        from faster_whisper import download_model
        for m in {cfg["model"], cfg["cpu_model"]}:
            print("downloading", m, "->", download_model(m)); 
        return
    if a.check:
        import numpy as np
        asr = Transcriber(cfg)
        t = time.perf_counter(); asr.transcribe(np.zeros(16000 * 3, dtype=np.float32)); print(f"3 s of audio: {1000 * (time.perf_counter() - t):.0f} ms on {asr.desc}")
        try:
            r = Recorder(cfg); print("mic ok:", r.name)
        except Exception as e:
            print("mic problem:", e)
        return
    if a.port: cfg["port"] = a.port
    if a.hotkey: cfg["hotkey"] = a.hotkey
    if a.no_tts: cfg["tts"] = False
    sys.excepthook = _log_uncaught
    threading.excepthook = _log_thread_exc
    LOG.prune()
    LOG.write("start", f"companion v4 port={cfg['port']} hotkey={cfg['hotkey']} ocr={cfg.get('ocr_hotkey')}/{cfg.get('ocr_engine')} python={sys.version.split()[0]}")
    fb = Feedback(cfg)
    hub = Hub(cfg, fb)
    srv = QuietServer(("127.0.0.1", cfg["port"]), make_handler(hub, cfg))
    srv.daemon_threads = True
    url = f"http://127.0.0.1:{cfg['port']}/"
    print(f"Tracker: {url}", flush=True)
    print(hub.research.startup_note(), flush=True)
    LOG.write("start", hub.research.startup_note())

    def _prefetch_fates():
        try:
            import fates
            LOG.write("fates", fates.summary(fates.refresh()).replace("\n", " / "))
        except Exception as e:  # noqa: BLE001
            LOG.write("error", f"fates prefetch: {e}")
    threading.Thread(target=_prefetch_fates, daemon=True).start()

    def _prewarm_ocr():   # v4: the first F10 read took 8 s cold (rapidocr model load); load it in the background now
        if cfg.get("ocr_engine", "auto") == "windows":
            return
        try:
            import ocr as ocrmod
            ms = ocrmod.prewarm()
            LOG.write("ocr", f"rapidocr pre-warmed in {ms} ms")
        except Exception as e:  # noqa: BLE001
            LOG.write("ocr", f"rapidocr pre-warm skipped: {e}")
    threading.Thread(target=_prewarm_ocr, daemon=True).start()
    print(f"Log file: {LOG.path()}", flush=True)
    if not a.no_audio:
        try:
            run_audio(hub, cfg, fb)
        except Exception as e:
            print(f"Voice input disabled: {e}", flush=True); LOG.write("error", f"voice input disabled: {e}")
        start_ocr_hotkey(hub, cfg)
    if not a.no_browser:
        import webbrowser
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever(poll_interval=0.2)
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
