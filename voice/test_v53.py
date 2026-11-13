"""v5.3 tests (offline). Run: python test_v53.py
Every phrase from the author's Act 1-2 playtest (2026-11-13) that went wrong, plus the fixes: confirm phrasings, lab trials
(a trial is not the lab), lab corrections, timer reset with a spoken yes, wiki-link phrasings ("the death card" -> the
Death card), Fate reward questions with ASR-mangled bosses, area / boss chatter, and the Windows OCR "00/0" misreads."""
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
os.environ.setdefault("POE_COMPANION_LOG_DIR", os.path.join(HERE, "logs"))
import companion as c  # noqa: E402
import ocr  # noqa: E402

R, MS = [], []


def check(name, cond, info=""):
    R.append(bool(cond))
    print(("ok   " if cond else "FAIL ") + name + ("" if cond else f"  [{info}]"))


def P(t):
    t0 = time.perf_counter(); out = c.parse(t); MS.append((time.perf_counter() - t0) * 1000); return out


def expect(t, want, name=None):
    got = P(t)
    ok = bool(got) and all(all(g.get(k) == v for k, v in w.items()) for g, w in zip(got, want)) and len(got) >= len(want)
    check(name or f"{t!r} -> {want}", ok, got)


# ---------------------------------------------------------------- P1.1 confirm a pending OCR read
for t in ["Confirmed.", "confirmed", "yes confirm", "apply", "looks good", "Okay, confirmed.", "confirm it", "Confirm."]:
    expect(t, [{"type": "ocr", "what": "confirm"}])

# ---------------------------------------------------------------- P1.2 lab trials are not the lab
expect("Chamber of Sins. Lab trial done.", [{"type": "trial", "op": "done", "trial": "chamber_of_sins"}], "'Chamber of Sins. Lab trial done.' -> trial, not Normal lab")
expect("lab trial done", [{"type": "trial", "op": "done", "trial": ""}])
expect("Crypt trial done", [{"type": "trial", "op": "done", "trial": "crypt"}])
expect("Lower prison trial done", [{"type": "trial", "op": "done", "trial": "lower_prison"}])
expect("crematorium trial done", [{"type": "trial", "op": "done", "trial": "crematorium"}])
expect("catacombs trial complete", [{"type": "trial", "op": "done", "trial": "catacombs"}])
expect("imperial gardens trial done", [{"type": "trial", "op": "done", "trial": "imperial_gardens"}])
expect("Note that I missed the lab trial in the prison.", [{"type": "trial", "op": "missed", "trial": "lower_prison"}])
expect("missed the lab trial in the prison", [{"type": "trial", "op": "missed", "trial": "lower_prison"}])
expect("No, not normal lab, just Chamber of Sends lab trial.", [{"type": "unmark", "lab": "normal"}, {"type": "trial", "op": "done", "trial": "chamber_of_sins"}],
       "'No, not normal lab, just Chamber of Sends lab trial.' -> unmark Normal lab + Chamber of Sins trial")
expect("Normal lab was not done.", [{"type": "unmark", "lab": "normal"}])
expect("no, not normal lab", [{"type": "unmark", "lab": "normal"}])
expect("that's wrong", [{"type": "undo"}])
expect("normal lab done", [{"type": "milestone", "lab": "normal"}], "'normal lab done' still marks the lab")
expect("Act 1 done.", [{"type": "milestone", "act": 1}])

# ---------------------------------------------------------------- P1.3 timer reset
for t in ["Restart timer.", "reset timer", "new run", "reset the timer", "start a new run"]:
    expect(t, [{"type": "timer_reset"}])
expect("Start timer.", [{"type": "start"}], "'Start timer.' is still start / resume")
expect("Pause timer.", [{"type": "pause"}])


class FB:
    def __init__(self): self.said = []
    def beep(self, k): pass
    def say(self, t): self.said.append(t)


fb = FB()
hub = c.Hub(dict(c.DEFAULT_CONFIG), fb)
pushed = []
hub.push = lambda acts, tr, source="system", wait=False: pushed.append(acts) or {"say": ""}
hub.broadcast = lambda m: None
hub.handle_text("Restart timer.", speak=False)
r = hub.handle_text("yes", speak=False)
check("'restart timer' then 'yes' -> confirmed reset sent to the page", r.get("actions") == [{"type": "timer_reset", "confirmed": True}], r)
hub.handle_text("reset timer", speak=False); hub.handle_text("Act 1 done.", speak=False); r = hub.handle_text("yes", speak=False)
check("anything said in between cancels the reset question", not any(x.get("confirmed") for x in r.get("actions") or []), r)
_src = os.path.join(HERE, "..", "src", "app.js")
_page = _src if os.path.exists(_src) else os.path.join(HERE, "..", "poe_tracker.html")
check("'1 minute paused' (not '1 minutes')", "minute${pm === 1 ? '' : 's'} paused" in open(_page, encoding="utf-8").read())

# ---------------------------------------------------------------- P1.4 wiki link phrasings
for t, q in [("Pull link for Quicksilver flask.", "Quicksilver flask"), ("pull the wiki link for Darkness Enthroned", "Darkness Enthroned"),
             ("link for Quicksilver flask", "Quicksilver flask"), ("wiki Quicksilver flask", "Quicksilver flask"),
             ("Research Link for Quicksilver Flash.", "Quicksilver Flash"), ("get wiki link for Darkness Enthroned", "Darkness Enthroned")]:
    expect(t, [{"type": "wiki_link", "query": q}])
expect("Pull the wiki link for the death card.", [{"type": "wiki_link", "query": "the death", "card": True}], "'the death card' -> card lookup ('The' kept, 'card' stripped)")
expect("wiki what drops the squire", [{"type": "research"}], "'wiki what drops X' stays research")
expect("look up Quicksilver flask", [{"type": "research", "query": "Quicksilver flask"}])


class Res:
    def __init__(self): self.q = []
    def wiki_link(self, q):
        self.q.append(q)
        return {"found": q == "death", "title": "Death", "url": "https://www.poewiki.net/wiki/Death", "source": "poewiki", "query": q} if q == "death" else {"found": False, "query": q, "closest": []}
    def backend(self): return "none"


rs = Res(); hub2 = c.Hub(dict(c.DEFAULT_CONFIG), FB(), researcher=rs)
got = []
hub2.push = lambda acts, tr, source="system", wait=False: got.extend(acts)
hub2.broadcast = lambda m: None
hub2._wiki_worker("the death", time.perf_counter())
check("'the death' card: retried without 'the' -> the Death card page (Death is a divination card on poewiki)", got and got[0].get("found") and got[0]["url"].endswith("/Death") and rs.q == ["the death", "death"], (got, rs.q))

# ---------------------------------------------------------------- P1.5 Fate reward questions
expect("What's the reward for Caliph Headstaver?", [{"type": "query", "what": "fate_info", "boss": "caliph headstaver", "strict": True}])
expect("What's the reward for Great White Beast?", [{"type": "query", "what": "fate_info", "boss": "great white beast"}])
expect("What are the Fate Boss rewards for the Great White Beast?", [{"type": "query", "what": "fate_info", "boss": "great white beast"}],
       "boss name no longer 's for the great white beast'")
expect("What fate does Nias give?", [{"type": "query", "what": "fate_info", "boss": "nias", "strict": True}], "'What fate does Nias give?' -> fate_info (not 'Campaign: zero Fates')")
expect("what fate does merveil give", [{"type": "query", "what": "fate_info", "boss": "merveil"}])
expect("fate reward for merveil", [{"type": "query", "what": "fate_info", "boss": "merveil"}])

# ---------------------------------------------------------------- P2.6 areas and boss kills
expect("Okay, we're in submerged passage now.", [{"type": "area", "area": "The Submerged Passage", "act": 1}])
expect("Alright, at the ledge now.", [{"type": "area", "area": "The Ledge", "act": 1}])
expect("Okay, we're at the prison.", [{"type": "area", "area": "The Lower Prison", "act": 1}])
expect("we're in the crypt", [{"type": "area", "area": "The Crypt", "act": 2}])
expect("Fighting Merveil.", [{"type": "area", "boss": "Merveil"}])
for t, b in [("Hilluck down.", "Hillock"), ("Hillock down", "Hillock"), ("Fairgraves is dead", "Captain Fairgraves"),
             ("Okay, Fair Graves is dead.", "Captain Fairgraves"), ("Fadeletus.", "Fidelitas"), ("Fidelitas down", "Fidelitas"),
             ("killed the weaver", "The Weaver"), ("Logmerveiled. Killed.", "Merveil")]:
    expect(t, [{"type": "boss_down", "boss": b}])
expect("Merveil dead", [{"type": "milestone", "act": 1}], "'Merveil dead' is still the Act 1 milestone")
expect("Killed Oak", [{"type": "log", "text": "Bandit killed: Oak"}], "'Killed Oak' is still the bandit choice")
expect("I died", [{"type": "log", "text": "Death (character died)"}], "'I died' is still a death")
expect("Gold 0.", [{"type": "log", "kind": "note"}], "'Gold 0.' stays a note")
expect("Cold resistance 25.", [{"type": "def", "field": "cold", "value": 25}])

# ---------------------------------------------------------------- P2.7 OCR misreads (Windows OCR text from the 11:34 read)
WIN = """Life 296
Mana 236
Maximum Energy Shield 24 40
MAXIMUM ENERGY SHIELD Versi01
ARMOUR 19
EVASION RATING 16 Name:,
FIRE RESISTANCE 00/0 (0%) earthsl
COLD RESISTANCE 00/0 (0%)
LIGHTNING RESISTANCE (26%)
CHAOS RESISTANCE 00/0 (0%)
CHANCE TO BLOCK ATTACK DAMAGE 200/0 (20%)"""
f = ocr.parse_defences_text(WIN)["fields"]
check("'00/0' -> 0%, '200/0' -> 20%", f.get("fire") == 0 and f.get("cold") == 0 and f.get("chaos") == 0 and f.get("ablock") == 20, f)
check("ES not taken from 'Versi01' (glued to letters) nor from an ambiguous header", "es" not in f, f)
f = ocr.parse_defences_text("Maximum Energy Shield 7 24 40\nLife 296")["fields"]
check("header 'Maximum Energy Shield 7 24 40' -> ES 7", f.get("es") == 7, f)
f = ocr.parse_defences_text("Maximum Energy Shield 6 24 14\nMAXIMUM ENERGY SHIELD 7")["fields"]
check("the Defences row wins over the header", f.get("es") == 7, f)

print(f"\n{sum(R)}/{len(R)} v5.3 checks passed   parse mean {sum(MS) / max(1, len(MS)):.2f} ms  max {max(MS):.1f} ms")
sys.exit(0 if all(R) else 1)
