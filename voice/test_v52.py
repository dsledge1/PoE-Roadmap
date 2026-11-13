"""v5.2 tests (offline). Run: python test_v52.py
Covers: Power Chase wiki lookups (generic entries never looked up, strict name check, poedb fallback, offline = nothing
cached so it's retried, cache, concurrent lookups share the Researcher safely), the /api/wiki_lookup endpoint, and the
new Defences rows the screenshot reader fills (evade chance, spell suppression, physical damage reduction)."""
import json
import os
import sys
import threading
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
os.environ.setdefault("POE_COMPANION_LOG_DIR", os.path.join(HERE, "logs"))
import companion as c  # noqa: E402
import ocr  # noqa: E402
from research import Researcher  # noqa: E402

R = []


def check(name, cond, info=""):
    R.append(bool(cond))
    print(("ok   " if cond else "FAIL ") + name + ("" if cond else f"  [{info}]"))


TITLES = ["Darkness Enthroned", "Forged Frostbearer", "Mageblood", "Abyss Jewel", "Spectre", "Death"]
POEDB = {"Thread_of_Hope": "<title>Thread of Hope - PoEDB</title>"}


class Http:
    def __init__(self, down=False, delay=0.0):
        self.down, self.delay, self.calls = down, delay, []

    def get_json(self, url, params, timeout):
        self.calls.append(params)
        if self.delay:
            time.sleep(self.delay)
        if self.down:
            raise OSError("connection refused")
        if params.get("list") == "search":   # like the wiki's own search: words, with plurals stemmed
            q = params["srsearch"].lower()
            words = {w.rstrip("s") for w in q.split()}
            return {"query": {"search": [{"title": t} for t in TITLES if q in t.lower() or words & {w.rstrip("s") for w in t.lower().split()}]}}
        return {}

    def get_text(self, url, timeout):
        self.calls.append({"text": url})
        if self.down:
            raise OSError("connection refused")
        slug = url.rsplit("/", 1)[-1]
        if slug in POEDB:
            return POEDB[slug]
        raise OSError("404")


class FB:
    def beep(self, k): pass
    def say(self, t): pass


CFG = {"research": {"backend": "none", "poedb": "https://poedb.tw/us/"}}

# ---------------------------------------------------------------- generic entries (same rule as the page)
for name in ["Abyss jewel", "+1/+1 wand", "Dread boss fight", "+1 Spectre chest", "Timeless jewel", "6-link body armour", "Good rare gloves",
             "any upgrade", "+2 minion helmet", "Cluster jewels"]:
    check(f"generic: {name!r} is left unlinked", c.chase_generic(name))
for name in ["Darkness Enthroned", "Frostbearers", "Mageblood", "Bones of Ullr", "Thread of Hope", "Headhunter", "The Squire", "Ashes of the Stars"]:
    check(f"specific: {name!r} is looked up", not c.chase_generic(name))
_src = os.path.join(HERE, "..", "src", "config.js")
_page = _src if os.path.exists(_src) else os.path.join(HERE, "..", "poe_tracker.html")
js = open(_page, encoding="utf-8").read()
check("the page and the companion use the same generic word list", "jewels?|boss|bosses|fight|chest|wand" in js and "jewels?|boss|bosses|fight|chest|wand" in c.CHASE_GENERIC.pattern)

# ---------------------------------------------------------------- Hub.chase_wiki
http = Http()
hub = c.Hub(dict(c.DEFAULT_CONFIG), FB(), researcher=Researcher(CFG, http=http))
r = hub.chase_wiki("Darkness Enthroned")
check("Darkness Enthroned -> poewiki page", r["found"] and r["source"] == "poewiki" and r["url"] == "https://www.poewiki.net/wiki/Darkness_Enthroned" and not r["generic"], r)
r = hub.chase_wiki("Frostbearers")
check("Frostbearers -> the Forged Frostbearer monster page", r["found"] and r["title"] == "Forged Frostbearer" and r["url"].endswith("/Forged_Frostbearer"), r)
n = len(http.calls)
r = hub.chase_wiki("Abyss jewel")
check("Abyss jewel: generic, unlinked, no lookup at all", not r["found"] and r["generic"] and len(http.calls) == n, (r, http.calls[n:]))
r = hub.chase_wiki("+1 Spectre chest")
check("+1 Spectre chest: generic, unlinked (even though a 'Spectre' page exists)", not r["found"] and r["generic"] and len(http.calls) == n, r)
r = hub.chase_wiki("Thread of Hope")
check("not on poewiki -> poedb fallback", r["found"] and r["source"] == "poedb" and r["url"].endswith("/Thread_of_Hope"), r)
r = hub.chase_wiki("White Death")
check("weak match refused (White Death -> Death is not confident)", not r["found"] and not r.get("error"), r)
n = len(http.calls)
r = hub.chase_wiki("darkness enthroned")
check("second lookup comes from the cache (no HTTP)", r["found"] and r.get("cached") and len(http.calls) == n, r)
check("empty name -> nothing", not hub.chase_wiki("  ")["found"])

down = Http(down=True)
hub2 = c.Hub(dict(c.DEFAULT_CONFIG), FB(), researcher=Researcher(CFG, http=down))
r = hub2.chase_wiki("Mageblood")
check("offline: not found, with an error, nothing cached (retried later)", not r["found"] and r.get("error") and "mageblood" not in hub2.chase_wiki_cache, r)
down.down = False
r = hub2.chase_wiki("Mageblood")
check("back online: the retry links it", r["found"] and r["url"].endswith("/Mageblood"), r)

# concurrent lookups (page sweep + 'get wiki link') share one Researcher: the lock keeps the answers apart
slow = Http(delay=0.02)
hub3 = c.Hub(dict(c.DEFAULT_CONFIG), FB(), researcher=Researcher(CFG, http=slow))
out = {}
names = ["Darkness Enthroned", "Mageblood", "Frostbearers", "Thread of Hope"]
ths = [threading.Thread(target=lambda q=q: out.__setitem__(q, hub3.chase_wiki(q))) for q in names]
[t.start() for t in ths]; [t.join(10) for t in ths]
want = {"Darkness Enthroned": "Darkness_Enthroned", "Mageblood": "Mageblood", "Frostbearers": "Forged_Frostbearer", "Thread of Hope": "Thread_of_Hope"}
check("4 lookups at once each get their own page", all(out.get(q, {}).get("url", "").endswith(v) for q, v in want.items()), out)

# ---------------------------------------------------------------- the endpoint (real HTTP server, local only)
PORT = 8871
srv_hub = c.Hub(dict(c.DEFAULT_CONFIG), FB(), researcher=Researcher(CFG, http=Http()))
server = c.QuietServer(("127.0.0.1", PORT), c.make_handler(srv_hub, {**c.DEFAULT_CONFIG, "port": PORT}))
if server is not None:
    threading.Thread(target=server.serve_forever, daemon=True).start()

    def post(path, body):
        req = urllib.request.Request(f"http://127.0.0.1:{PORT}{path}", data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
        return json.loads(urllib.request.urlopen(req, timeout=5).read())
    t0 = time.perf_counter()
    r = post("/api/wiki_lookup", {"name": "Darkness Enthroned"})
    ms = (time.perf_counter() - t0) * 1000
    check(f"POST /api/wiki_lookup Darkness Enthroned -> link ({ms:.0f} ms)", r.get("found") and r["url"].endswith("/Darkness_Enthroned"), r)
    r = post("/api/wiki_lookup", {"name": "Dread boss fight"})
    check("POST /api/wiki_lookup Dread boss fight -> generic, unlinked", not r.get("found") and r.get("generic"), r)
    server.shutdown()
else:
    print("note: no make_server() helper; the endpoint is covered by test/v52_e2e.js")

# ---------------------------------------------------------------- screenshot reader: new Defences rows
GAME = """Defences
Armour: 478
Estimated Physical Damage reduction: 7%
Evasion Rating: 1073
Estimated chance to Evade Attacks: 31%
Chance to Suppress Spell Damage: 42%
Fire Resistance: 75% (82%)
Cold Resistance: 75%
Lightning Resistance: 75%
Chaos Resistance: -60%
Life: 1317
Mana: 833
Energy Shield: 1308"""
f = ocr.parse_defences_text(GAME)["fields"]
check("in-game: evade chance 31", f.get("evade") == 31, f)
check("in-game: spell suppression 42", f.get("suppress") == 42, f)
check("in-game: physical damage reduction 7", f.get("pdr") == 7, f)
check("in-game: the old fields are unchanged", f.get("armour") == 478 and f.get("evasion") == 1073 and f.get("life") == 1317 and f.get("mana") == 833 and f.get("es") == 1308 and f.get("fire") == 75 and f.get("chaos") == -60, f)
POB = """Total DPS: 12,345
Life: 4,213
Energy Shield: 210
Evade Chance: 48%
Spell Suppression: 100%
Phys. Damage Reduction: 22%
Fire Resistance: 75% (+12%)"""
f = ocr.parse_defences_text(POB)["fields"]
check("PoB sidebar: evade 48, suppression 100, phys reduction 22", f.get("evade") == 48 and f.get("suppress") == 100 and f.get("pdr") == 22, f)
f = ocr.parse_defences_text("Mana Regeneration: 12.5 per second\nChance to Evade: 5%\nPhysical Damage Reduction: 250%")["fields"]
check("no mana from a regen row; out-of-range reduction ignored", "mana" not in f and "pdr" not in f and f.get("evade") == 5, f)

print(f"\n{sum(R)}/{len(R)} v5.2 checks passed")
sys.exit(0 if all(R) else 1)
