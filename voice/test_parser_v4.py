"""v4 parser + regression tests (offline). Run: python test_parser_v4.py
Covers: custom drop / event types, Power Chase, Fate boss lookups, link follow-ups, news, yes-offers, research query
cleanup, the OCR Offence-tab guard, and every line from the author's live v3 log (Nov 12, 23:06-23:22 ET)."""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("POE_COMPANION_LOG_DIR", os.path.join(os.path.dirname(os.path.abspath(__file__)), "logs"))
import companion as c  # noqa: E402
import intents_v4 as iv4  # noqa: E402
import ocr  # noqa: E402

R = []


def check(name, cond, info=""):
    R.append(bool(cond))
    print(("ok   " if cond else "FAIL ") + name + ("" if cond else f"  [{info}]"))


def logs(acts):
    return [a for a in acts if a.get("type") == "log"]


def one(text, ctx=None):
    t = time.perf_counter()
    a = c.parse(text, ctx)
    ms = (time.perf_counter() - t) * 1000
    one.ms.append(ms)
    return a


one.ms = []

# ---------------------------------------------------------------- custom types (defaults)
iv4.set_types(iv4.DEFAULT_TYPES)
DROPS = [
    ("dropped a 4 link", "4-link"), ("Dropped a 4 link.", "4-link"), ("found a 4l", "4-link"), ("got a four linked chest", "4-link"),
    ("found a 5 link", "5-link"), ("Found a 5 link!", "5-link"), ("found a 5-link", "5-link"), ("found a five link", "5-link"),
    ("got a six link", "6-link"), ("6L!", "6-link"), ("dropped a 6 socket", "6-socket"), ("found a six socket staff", "6-socket"),
    ("found a 4 link with the right colours", "3/4-link, right colours"), ("found a three link red green blue", "3/4-link, right colours"),
    ("4 link with the right colors", "3/4-link, right colours"),
    ("dropped a unique", "Unique"), ("found a unique Bones of Ullr", "Unique: Bones of Ullr"),
    ("dropped a fate card", "Fate card"), ("got some viscera", "Viscera"), ("no way, a 6 link!", "6-link"),
]
for text, want in DROPS:
    a = logs(one(text))
    check(f"drop {text!r} -> {want}", len(a) == 1 and a[0]["text"] == want and a[0]["kind"] == "drop" and a[0].get("custom"), a)
for text in ["I need a 5 link", "if I find a 6 link I'll scream", "still no 6 link", "I want a 4 link with the right colours"]:
    a = one(text)
    check(f"hypothetical {text!r} logs no drop", not any(x.get("kind") == "drop" for x in a), a)
a = one("Act 3 done, found a 5 link")
check("milestone + 5-link in one sentence", any(x.get("type") == "milestone" for x in a) and any(x.get("text") == "5-link" for x in logs(a)), a)
# the old v3 behaviour still holds next to the types
for text, want in [("found bones of ullr", "Bones of Ullr"), ("near death", "Near-death (flasks empty / pool < 30%)"), ("I died", "Death (character died)"),
                   ("reached tier 6", "Reached T6"), ("staff 812 pdps", "Staff 812 pDPS")]:
    a = logs(one(text))
    check(f"v3 still: {text!r} -> {want}", a and a[0]["text"] == want, a)

# questions never log drops
for text in ["did you see that 5 link?", "where do 6 links drop?", "is a 6 socket worth it?", "what does a fate card do?",
             "should I use a 4 link with the right colours?", "how do I get a 6 link?", "what is a unique?", "who drops viscera?"]:
    a = one(text)
    check(f"question {text!r} logs nothing", not logs(a), a)
a = one("is a 6 socket worth it?")
check("'a 6 socket' is not read as act 6", not any(x.get("act") == 6 for x in a), a)

# synced types (a custom type from the page)
iv4.set_types(iv4.DEFAULT_TYPES + [{"id": "u1", "name": "Mirror shard", "kind": "drop", "aliases": ["mirror shard", "shard of the mirror"]},
                                   {"id": "u2", "name": "Boss down", "kind": "event", "aliases": ["boss down", "boss is down"]}])
a = logs(one("found a mirror shard"))
check("synced custom drop type", a and a[0]["text"] == "Mirror shard" and a[0]["custom"] == "u1", a)
a = logs(one("boss is down"))
check("synced custom event type", a and a[0]["text"] == "Boss down" and a[0]["kind"] == "event", a)
iv4.set_types(iv4.DEFAULT_TYPES)
a = one("found a mirror shard")
check("after the page removes it, no custom match", not any(x.get("custom") == "u1" for x in a), a)

# type commands
CMDS = [
    ("add drop type five link", {"op": "add", "kind": "drop", "name": "Five link"}),
    ("Add event type boss killed.", {"op": "add", "kind": "event", "name": "Boss killed"}),
    ("add a new drop type called mirror shard", {"op": "add", "kind": "drop", "name": "Mirror shard"}),
    ("delete drop type five link", {"op": "delete", "kind": "drop", "name": "Five link"}),
    ("remove event type boss killed", {"op": "delete", "kind": "event", "name": "Boss killed"}),
    ("rename drop type mirror to mirror shard", {"op": "rename", "name": "Mirror", "to": "Mirror shard"}),
    ("add alias shiny to type mirror shard", {"op": "alias", "name": "Mirror shard", "alias": "shiny"}),
]
for text, want in CMDS:
    a = one(text)
    check(f"type cmd {text!r}", len(a) == 1 and a[0]["type"] == "custom_type" and all(a[0].get(k) == v for k, v in want.items()), a)

# ---------------------------------------------------------------- Power Chase
CH = [
    ("chase done darkness enthroned", {"op": "done", "item": "darkness enthroned"}),
    ("Chase done: Darkness Enthroned.", {"op": "done", "item": "Darkness Enthroned"}),
    ("chase complete the +1 spectre chest", {"op": "done", "item": "the +1 spectre chest"}),
    ("mark chase item abyss jewel done", {"op": "done", "item": "abyss jewel"}),
    ("darkness enthroned chase done", {"op": "done", "item": "darkness enthroned"}),
    ("chase undo darkness enthroned", {"op": "undone", "item": "darkness enthroned"}),
    ("add chase item Shavronne's Wrappings from Delve", {"op": "add", "item": "Shavronne's Wrappings", "content": "Delve"}),
    ("add chase item X from Delve", {"op": "add", "item": "X", "content": "Delve"}),
    ("add chase item Ventor's Gamble", {"op": "add", "item": "Ventor's Gamble", "content": ""}),
    ("add a timeless jewel to my chase from legion", {"op": "add", "item": "A timeless jewel", "content": "Legion"}),
    ("remove chase item ventor's gamble", {"op": "delete", "item": "ventor's gamble"}),
]
for text, want in CH:
    a = one(text)
    check(f"chase {text!r}", len(a) == 1 and a[0]["type"] == "chase" and all(a[0].get(k) == v for k, v in want.items()), a)
for text in ["what's left on my chase?", "chase list", "what is left on the power chase", "show my chase"]:
    a = one(text)
    check(f"chase query {text!r}", len(a) == 1 and a[0].get("what") == "chase", a)
a = one("chase done darkness enthroned")
check("v3 bug fixed: 'chase done darkness enthroned' is not a drop", not logs(a), a)
a = one("add chase item Shavronne's Wrappings from Delve")
check("v3 bug fixed: 'add chase item …' is not a drop", not logs(a), a)

# ---------------------------------------------------------------- Fate boss
FB = [("fate boss merveil", "merveil"), ("Fate boss: Dominus", "dominus"), ("fate boss Merveil", "merveil"), ("fate boss for brutus", "brutus"),
      ("Pull up the Fate boss from Merveil.", "merveil"), ("What's the Fate boss effect for Merveil?", "merveil"),
      ("what does merveil give", "merveil"), ("fate reward merveil", "merveil"), ("show me merveil fate", "merveil"),
      ("show me the fate boss for kitava", "kitava"), ("fate reward for dominus", "dominus")]
for text, boss in FB:
    a = one(text)
    check(f"fate boss {text!r} -> {boss}", len(a) == 1 and a[0].get("what") == "fate_info" and a[0].get("boss") == boss and a[0].get("open"), a)
a = one("what does a cane of unravelling give")
check("'what does <item> give' is not a Fate boss", not (a and a[0].get("what") == "fate_info"), a)
a = one("how many fates can I use?")
check("fate count question unchanged", a and a[0].get("what") == "fates", a)

# ---------------------------------------------------------------- link follow-ups
now = time.time()
ctx = {"last_links": {"ts": now - 10, "q": {"type": "query", "what": "links", "act": 3}}}
for text, focus in [("Main attack links only.", "main"), ("just the movement", "movement"), ("utility ones", "utility"), ("only auras", "auras"),
                    ("what about movement", "movement")]:
    a = one(text, ctx)
    check(f"follow-up {text!r} -> {focus}", len(a) == 1 and a[0].get("what") == "links" and a[0].get("focus") == focus, a)
a = one("utility ones", ctx)
check("follow-up keeps the act of the first question", a[0].get("act") == 3, a)
a = one("Main attack links only.")
check("'Main attack links only.' is a links query even without context", a and a[0].get("what") == "links" and a[0].get("focus") == "main", a)
a = one("utility ones", {"last_links": {"ts": now - 120, "q": {}}})
check("after 60 s 'utility ones' is no longer a follow-up", not (a and a[0].get("what") == "links"), a)

# ---------------------------------------------------------------- news / research cleanup / yes
for text, topic in [("Is there any new information on X?", "x"), ("Research on X if there's any new information.", "x"),
                    ("Research on Twitter if there's any new information.", "twitter"), ("any news on fates on twitter", None),
                    ("is there any new info about the patch notes", None), ("check reddit for news about covens", None)]:
    a = one(text)
    ok = len(a) == 1 and a[0].get("what") == "news" and (topic is None or a[0].get("topic") == topic)
    check(f"news {text!r}", ok, a)
for text in ["Research on X if there's any new information.", "Research on Twitter if there's any new information."]:
    a = one(text)
    check(f"no wiki lookup on {text!r}", not any(x.get("type") == "research" for x in a), a)
check("trailing filler stripped", iv4.strip_trailing_filler("X if there's any new information") == "X", iv4.strip_trailing_filler("X if there's any new information"))
for text in ["yes", "Yes.", "yeah", "yes please", "go ahead", "look it up", "sure"]:
    a = one(text)
    check(f"yes {text!r}", a == [{"type": "yes"}], a)
a = one("yes confirm")
check("'yes confirm' is still the OCR confirm", a and a[0].get("type") == "ocr" and a[0].get("what") == "confirm", a)
check("offer query: 'What map is Bar Kulin?'", c.offer_query({"text": "What map is Bar Kulin?"}) == "map is Bar Kulin", c.offer_query({"text": "What map is Bar Kulin?"}))
check("offer query uses the matched item", c.offer_query({"item": "Cane of Kulemak", "text": "the cane of kulimac"}) == "Cane of Kulemak")

# ---------------------------------------------------------------- the author's live v3 log (Nov 12, 23:06-23:22 ET): every line
LIVE = [
    ("What link should I be using?", lambda a: a[0].get("what") == "links" and a[0].get("focus") == "all"),
    ("Main attack links only.", lambda a: a[0].get("what") == "links" and a[0].get("focus") == "main"),
    ("What main attack link should I be using?", lambda a: a[0].get("what") == "links" and a[0].get("focus") == "main"),
    ("Now level 5.", lambda a: a == [{"type": "def", "field": "level", "value": 5}]),
    ("Just finished Act 1.", lambda a: a == [{"type": "milestone", "act": 1}]),
    ("OK, finish Act 2.", lambda a: a == [{"type": "milestone", "act": 2}]),
    ("Life is 800 and ES is 300.", lambda a: a == [{"type": "def", "field": "life_es", "life": 800, "es": 300}]),
    ("Research where Cane of Kulemak drops.", lambda a: a[0].get("type") == "research" and "Kulemak" in a[0]["query"]),
    ("Is there any new information on X?", lambda a: a[0].get("what") == "news"),
    ("Research on X if there's any new information.", lambda a: a[0].get("what") == "news"),
    ("Research on Twitter if there's any new information.", lambda a: a[0].get("what") == "news"),
    ("OK, mark Act 3 done.", lambda a: a == [{"type": "milestone", "act": 3}]),
    ("What's the Fate boss effect for Merveil?", lambda a: a[0].get("what") == "fate_info" and a[0].get("boss") == "merveil"),
    ("Pull up the Fate boss from Merveil.", lambda a: a[0].get("what") == "fate_info" and a[0].get("boss") == "merveil"),
    ("What map is Bar Kulin?", lambda a: a[0].get("what") == "unknown"),
    ("Research map for the White Death.", lambda a: a[0].get("type") == "research"),
    ("Research Database for the White Death.", lambda a: a[0].get("type") == "research"),
    ("Okay, normal lab done.", lambda a: a == [{"type": "milestone", "lab": "normal"}]),
    ("Confirm.", lambda a: a == [{"type": "ocr", "what": "confirm"}]),
    ("Confirm", lambda a: a == [{"type": "ocr", "what": "confirm"}]),
]
for text, ok in LIVE:
    a = one(text, ctx if text == "Main attack links only." else None)
    check(f"live log {text!r}", a and ok(a), a)

import research  # noqa: E402
for q, want in [("map for the White Death", "the White Death"), ("Database for the White Death", "the White Death"), ("poedb for the white death", "the white death"),
                ("map is Bar Kulin", "Bar Kulin"), ("X if there's any new information", "X")]:
    got = research.Researcher({"research": {"backend": "none"}}).clean_query(q)
    check(f"research query {q!r} -> {want!r}", got == want, got)
check("coverage: 'Death' covers half of 'the white death'", research.coverage("Death", "the white death") == 0.5)
check("coverage: fuzzy 'kulimac' ~ 'Kulemak'", research.coverage("Cane of Kulemak", "the cane of kulimac") == 1.0)

# ---------------------------------------------------------------- OCR: Offence tab / partial reads (texts from the 23:21 log)
OFF = ("177FPS\nCHARACTER\nIntelligence\nLioneye's Watch 52\nLife 93\nMana 128\n14 14\nOffence Defence Misc Charges Item Fi\n"
       "Main HaND ChaNCe TO HIT 82% Name:\nMAIN HAND CHANCE TO HIT EVASIVE MONSTERS 75%\nATTACKS PER SECOND 1.65 what\nMAIN HAND ACCURACY RATING 34\n"
       "MAIN HAND ATTACK SPEED MODIFIER +10%\nMAIN HAND CRITICAL STRIKE CHANCE 8.3%")
DEF = ("Life 93\nMana 128\nOffence Defence Misc Charges\nARMOUR 31\nEVASION RATING 40\nFIRE RESISTANCE 0% (0%)\nCOLD RESISTANCE 9% (9%)\n"
       "LIGHTNING RESISTANCE 9% (9%) #Nigh\nCHAOS RESISTANCE 0% (0%) #Toter\nCHANCE TO BLOCK ATTACK DAMAGE 20% (20%)")
f = ocr.parse_defences_text(OFF)["fields"]
check("Offence tab text reads only life + mana", f == {"life": 93, "mana": 128}, f)
check("Offence tab detected", ocr.tab_hint(OFF, f) == "offence", ocr.tab_hint(OFF, f))
f = ocr.parse_defences_text(DEF)["fields"]
check("Defences tab: 9 fields, no warning", len(f) == 9 and ocr.tab_hint(DEF, f) == "", (f, ocr.tab_hint(DEF, f)))
p = "Life 93\nFIRE RESISTANCE 0% (0%)\nMana 128"
f = ocr.parse_defences_text(p)["fields"]
check("3 fields on the Defences tab -> partial warning", ocr.tab_hint(p, f) == "partial", ocr.tab_hint(p, f))


class FakeWin:   # Windows OCR that returns the Offence tab: auto mode must still try rapidocr (few fields)
    calls = 0


def fake_windows(img):
    FakeWin.calls += 1
    return [(ln, 0, i * 20, 300, 16) for i, ln in enumerate(OFF.splitlines())]


def fake_rapid(img):
    fake_rapid.calls += 1
    return [(ln, 0, i * 20, 300, 16) for i, ln in enumerate(OFF.splitlines())]


fake_rapid.calls = 0
orig_w, orig_r = ocr.windows_ocr_boxes, ocr.rapid_ocr_boxes
ocr.windows_ocr_boxes, ocr.rapid_ocr_boxes = fake_windows, fake_rapid
try:
    out = ocr.read_defences(object(), "auto")      # the fake engines ignore the image
    check("auto: few fields from Windows -> rapidocr re-reads", fake_rapid.calls == 1 and out["engine"] == "windows+rapidocr", out.get("engine"))
    check("auto: Offence tab flagged after both engines", out.get("hint") == "offence" and out.get("partial"), out.get("hint"))
finally:
    ocr.windows_ocr_boxes, ocr.rapid_ocr_boxes = orig_w, orig_r


class FB:     # Hub feedback stub: records beeps and speech
    def __init__(self):
        self.said, self.beeps, self.last_say, self.enabled_tts = [], [], "", True

    def beep(self, k):
        self.beeps.append(k)

    def say(self, t):
        self.said.append(t); self.last_say = t


fb = FB()
hub = c.Hub(dict(c.DEFAULT_CONFIG), fb)
hub.deliver_ocr({"fields": {"life": 93, "mana": 128}, "hint": "offence", "partial": True})
check("Hub: Offence tab says so and offers no confirm", fb.said and fb.said[-1] == "That's the Offence tab, open Defences and press F10 again." and hub.last_ocr_ts == 0.0, fb.said)
rec = hub.handle_text("", speak=True)
fb.said.clear()
hub.note_empty("press too short", 120)
check("Hub: empty / short press only beeps (no speech)", fb.said == [] and fb.beeps[-1] == "unknown", (fb.said, fb.beeps[-3:]))
started = []
hub.start_research = lambda q, rec: started.append(q) or rec.update(say="Looking up " + q, level="ok")
hub.handle_text("What map is Bar Kulin?", speak=False)
check("Hub: unknown question leaves a 20 s offer", hub.offer and hub.offer["query"] == "map is Bar Kulin", hub.offer)
hub.handle_text("yes", speak=False)
check("Hub: 'yes' within 20 s runs the offered research", started == ["map is Bar Kulin"], started)
hub.offer = {"ts": time.time() - 30, "query": "old"}
fb.said.clear()
hub.handle_text("yes", speak=True)
check("Hub: 'yes' after 20 s does nothing", started == ["map is Bar Kulin"] and fb.said[-1:] == ["Nothing to say yes to."], (started, fb.said))
hub.handle_text("What link should I be using?", speak=False)
check("Hub: a links query is remembered for follow-ups", hub.last_links and time.time() - hub.last_links["ts"] < 2)

# ---------------------------------------------------------------- defaults file
names = [t["name"] for t in iv4.DEFAULT_TYPES]
check("default types include the granular drops", all(n in names for n in ["4-link", "5-link", "6-link", "6-socket", "3/4-link, right colours", "Unique", "Fate card", "Viscera"]), names)
check("default types keep the old events", all(n in names for n in ["Death", "Near-death", "Reached T6", "Frostbearer captured", "Verisium Outcrop found"]), names)

ms = sorted(one.ms)
print(f"\n{sum(R)}/{len(R)} v4 parser checks passed   parse mean {sum(ms) / len(ms):.2f} ms  p95 {ms[int(len(ms) * 0.95)]:.2f} ms  max {ms[-1]:.1f} ms")
sys.exit(0 if all(R) else 1)
