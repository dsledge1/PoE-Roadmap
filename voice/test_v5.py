"""v5 tests (offline). Run: python test_v5.py
Covers: pace target / text size / wiki link / "what am I watching for in Abyss" voice parsing, the "Get a 6 link" -> Act 6
PoB import fix, Researcher.wiki_link (search guard + poedb fallback, mocked HTTP), and the Hub wiki-link flow."""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("POE_COMPANION_LOG_DIR", os.path.join(os.path.dirname(os.path.abspath(__file__)), "logs"))
import companion as c  # noqa: E402
import intents_v5 as iv5  # noqa: E402
import pob_import as pi  # noqa: E402
from research import Researcher  # noqa: E402

R, MS = [], []


def check(name, cond, info=""):
    R.append(bool(cond))
    print(("ok   " if cond else "FAIL ") + name + ("" if cond else f"  [{info}]"))


def one(text, ctx=None):
    t = time.perf_counter()
    a = c.parse(text, ctx)
    MS.append((time.perf_counter() - t) * 1000)
    return a


def expect(text, want, label=None):
    got = one(text)
    ok = len(got) >= 1 and all(got[0].get(k) == v for k, v in want.items())
    check(label or f"{text!r} -> {want}", ok, got)


# ---------------------------------------------------------------- 2. pace presets by voice
for t, w in [("set pace alt", {"type": "pace_cfg", "preset": "alt"}), ("set pace to alt", {"preset": "alt"}), ("set the pace to alt character", {"preset": "alt"}),
             ("alt pace", {"preset": "alt"}), ("pace league start", {"preset": "league"}), ("set pace to league start", {"preset": "league"}),
             ("set pace speedrun", {"preset": "speed"}), ("speedrun pace", {"preset": "speed"}), ("set pace custom", {"preset": "custom"}),
             ("pace target 4 hours", {"type": "pace_cfg", "total": 240}), ("set pace target to 4 hours", {"total": 240}),
             ("pace target four hours", {"total": 240}), ("pace target 3 and a half hours", {"total": 210}),
             ("pace target 4 hours 30", {"total": 270}), ("pace target 4:30", {"total": 270}), ("pace target 250 minutes", {"total": 250}),
             ("set pace to 6 hours", {"total": 360}), ("okay set pace alt", {"preset": "alt"})]:
    expect(t, w)
for t, what in [("how is my pace", "pace"), ("what is my pace", "pace"), ("am I on pace", "pace")]:
    got = one(t)
    check(f"{t!r} stays the pace question", got and got[0].get("type") == "query" and got[0].get("what") == what, got)
check("'pace target 30 minutes' (too short) is not a pace target", not (one("pace target 30 minutes") or [{}])[0].get("type") == "pace_cfg")

# ---------------------------------------------------------------- 3. text size
for t, w in [("bigger text", {"type": "text_size", "step": 1}), ("make the text bigger", {"step": 1}), ("text bigger", {"step": 1}), ("increase text size", {"step": 1}),
             ("smaller text", {"step": -1}), ("make the text smaller", {"step": -1}), ("text smaller", {"step": -1}),
             ("text size 125", {"pct": 125}), ("set text size to 140 percent", {"pct": 140}), ("reset text size", {"pct": 100}), ("normal text size", {"pct": 100})]:
    expect(t, w)

# ---------------------------------------------------------------- 4. chase by content type
for t, content in [("what am I watching for in abyss", "abyss"), ("chase for abyss", "abyss"), ("what am I watching for in Abyss?", "abyss"),
                   ("I'm going to farm abyss, what am I watching for", "abyss"), ("what am I looking for in delve", "delve"),
                   ("chase items for legion", "legion"), ("what's on my chase list for breach", "breach"), ("what can I get from the atlas bosses", "atlas bosses")]:
    expect(t, {"type": "query", "what": "chase", "content": content, "watch": True}, f"{t!r} -> chase watch {content}")
got = one("what chase items are left")
check("'what chase items are left' is still the plain chase list (no watch)", got and got[0].get("what") == "chase" and not got[0].get("watch"), got)

# ---------------------------------------------------------------- 6. wiki link
for t, q in [("get wiki link for Darkness Enthroned", "Darkness Enthroned"), ("Get Wiki Link for Darkness Enthroned", "Darkness Enthroned"),
             ("wiki link for the dark monarch", "dark monarch"), ("get me the wiki link for Frostbearer", "Frostbearer"),
             ("give me a wiki link to abyss jewel", "abyss jewel"), ("copy the poewiki link for Bones of Ullr", "Bones of Ullr"),
             ("link me to the wiki page for Maligaro's Virtuosity", "Maligaro's Virtuosity"), ("poedb link for Ventor's Gamble", "Ventor's Gamble"),
             ("okay get wiki link for Arakaali's Fang please", "Arakaali's Fang")]:
    expect(t, {"type": "wiki_link", "query": q})
got = one("get wiki link for Darkness Enthroned")
check("'get wiki link for …' is never logged as a drop", not any(a.get("type") == "log" for a in got), got)
check("bare 'get wiki link' asks for the name (empty query)", (one("get wiki link") or [{}])[0] == {"type": "wiki_link", "query": ""}, one("get wiki link"))
got = one("what does Darkness Enthroned do")
check("a research question is still research, not a wiki link", got and got[0].get("type") != "wiki_link", got)

# ---------------------------------------------------------------- 7. "Get a 6 link" is not Act 6
for t, want in [("Get a 6 link", []), ("Get a 5 link", []), ("6 link", []), ("5L chest", []), ("6 socket", []), ("Buy a 4 link", []),
                ("Get a 6L before maps", ["EM"]), ("Act 4-10", [f"A{i}" for i in range(4, 11)]), ("Acts 4 to 10", [f"A{i}" for i in range(4, 11)]),
                ("Act 6", ["A6"]), ("act6", ["A6"]), ("A6", ["A6"]), ("a6 Kitava", ["A6"]), ("Act 6 6L", ["A6"]), ("A1-A3", ["A1", "A2", "A3"]),
                ("Acts 1-3 (6 link at A5)", ["A1", "A2", "A3"]), ("Act 2: 4L", ["A2"]), ("Early maps 6L", ["EM"])]:
    got = pi.stages_for_title(t)
    check(f"PoB set title {t!r} -> {want}", got == want, got)
check("'level 6' maps by level (A1), not Act 6", pi.stages_for_title("level 6") == ["A1"], pi.stages_for_title("level 6"))
for t, want in [("get a 6 link", "6-link"), ("I got a 6 link", "6-link"), ("dropped a 6 link", "6-link")]:
    got = one(t)
    check(f"voice {t!r} logs the {want} drop, never an act change", got and got[0].get("type") == "log" and got[0].get("text") == want and not any(a.get("type") == "set_act" for a in got), got)
got = one("set act 6")
check("explicit 'set act 6' still sets the act", got and got[0] == {"type": "set_act", "act": 6}, got)

# ---------------------------------------------------------------- Researcher.wiki_link (mocked HTTP)
TITLES = ["Darkness Enthroned", "Forged Frostbearer", "The Dark Monarch", "Death", "Abyss Jewel", "Death's Door"]
POEDB = {"Thread_of_Hope": "<html><title>Thread of Hope - PoEDB, Path of Exile Wiki</title></html>",
         "Cheap_Thing": "<html><title>Something Else - PoEDB</title></html>"}


class Http:
    def __init__(self, down=False):
        self.down, self.calls = down, []

    def get_json(self, url, params, timeout):
        self.calls.append(params)
        if self.down:
            raise OSError("connection refused")
        if params.get("list") == "search":
            q = params["srsearch"].lower()
            words = set(q.split())
            return {"query": {"search": [{"title": t} for t in TITLES if q in t.lower() or words & set(t.lower().split())]}}
        return {}

    def get_text(self, url, timeout):
        self.calls.append({"text": url})
        slug = url.rsplit("/", 1)[-1]
        if slug in POEDB:
            return POEDB[slug]
        raise OSError("404")


cfg = {"research": {"backend": "none"}}
rs = Researcher(cfg, http=Http())
r = rs.wiki_link("Darkness Enthroned")
check("wiki_link: exact title -> poewiki URL", r["found"] and r["source"] == "poewiki" and r["url"] == "https://www.poewiki.net/wiki/Darkness_Enthroned", r)
r = rs.wiki_link("dark monarch")
check("wiki_link: 'dark monarch' -> The Dark Monarch", r["found"] and r["title"] == "The Dark Monarch" and r["url"].endswith("/The_Dark_Monarch"), r)
r = rs.wiki_link("the white death")
check("wiki_link: partial-match guard refuses 'the white death' -> 'Death'", not r["found"] or r["title"] != "Death", r)
r = rs.wiki_link("Thread of Hope")
check("wiki_link: not on poewiki -> poedb fallback", r["found"] and r["source"] == "poedb" and r["url"].endswith("/Thread_of_Hope"), r)
r = rs.wiki_link("Cheap Thing")
check("wiki_link: poedb page whose title doesn't match is refused", not r["found"], r)
r = Researcher(cfg, http=Http(down=True)).wiki_link("Thread of Hope")
check("wiki_link: poewiki down -> still tries poedb", r["found"] and r["source"] == "poedb", r)
r = Researcher(cfg, http=Http(down=True)).wiki_link("Darkness Enthroned")
check("wiki_link: everything down -> not found with an error note", not r["found"] and r.get("error"), r)
check("wiki_link: empty query -> not found, no HTTP", not Researcher(cfg, http=Http()).wiki_link("")["found"])
r = rs.wiki_link("Death's Door")
check("wiki_link: apostrophes stay readable in the URL", r["url"] == "https://www.poewiki.net/wiki/Death's_Door", r)


# ---------------------------------------------------------------- Hub flow: pending -> result pushed as a link, spoken; never the clipboard (v5.1)
class FB:
    def __init__(self):
        self.said, self.beeps = [], []

    def beep(self, k):
        self.beeps.append(k)

    def say(self, t):
        self.said.append(t)


fb = FB()
hub = c.Hub(dict(c.DEFAULT_CONFIG), fb, researcher=Researcher(cfg, http=Http()))
sent, pushed = [], []
hub.broadcast = lambda m: sent.append(m)
hub.push = lambda acts, tr, source="system", wait=False: pushed.extend(acts)
hub.handle_text("get wiki link for Darkness Enthroned", speak=True)
for _ in range(100):
    if pushed:
        break
    time.sleep(0.02)
check("Hub: 'get wiki link' shows 'finding' at once", any(m.get("type") == "wiki_pending" and m.get("query") == "Darkness Enthroned" for m in sent), sent)
res = next((a for a in pushed if a.get("type") == "wiki_link_result"), None)
check("Hub: result pushed to the page with the URL", res and res["found"] and res["url"].endswith("/Darkness_Enthroned") and res["source"] == "poewiki", pushed)
check("Hub: the result carries no clipboard flag (v5.1: links are never copied)", res and "copied" not in res, res)
check("Hub: short spoken confirmation", fb.said and fb.said[-1] == "Wiki link for Darkness Enthroned added.", fb.said)
pushed.clear(); fb.said.clear()
hub.handle_text("get wiki link for the white death", speak=True)
for _ in range(100):
    if pushed:
        break
    time.sleep(0.02)
res = next((a for a in pushed if a.get("type") == "wiki_link_result"), None)
check("Hub: weak match -> not found, says so", res and not res["found"] and fb.said and fb.said[-1].startswith("I couldn't find a wiki page for"), (pushed, fb.said))
fb.said.clear()
hub.handle_text("get wiki link", speak=True)
check("Hub: no name -> asks for one", fb.said and "Say the name" in fb.said[-1], fb.said)
import inspect  # noqa: E402
src_c = inspect.getsource(c)
check("the companion has no clipboard code at all (no clip.exe, no copy_to_clipboard)", "copy_to_clipboard" not in src_c and '["clip"]' not in src_c)

# ---------------------------------------------------------------- describe()
d = [c.describe([a]) for a in [{"type": "pace_cfg", "preset": "alt"}, {"type": "pace_cfg", "total": 240}, {"type": "text_size", "step": 1}, {"type": "text_size", "pct": 125}]]
check("describe(): pace target and text size have plain descriptions", d == ["pace target alt", "pace target 4 hours", "text bigger", "text 125 percent"], d)

ms = sorted(MS)
print(f"\n{sum(R)}/{len(R)} v5 checks passed   parse mean {sum(ms) / len(ms):.2f} ms  max {ms[-1]:.1f} ms")
sys.exit(0 if all(R) else 1)
