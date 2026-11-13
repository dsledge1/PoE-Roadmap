"""Research tests. The HTTP layer is mocked (MockHttp below: canned MediaWiki + OpenAI-style JSON);
one optional live poewiki call at the end (skipped with --offline or when the network is down).
Run: python test_research.py [--offline]"""
import json
import os
import queue
import sys
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import research  # noqa: E402
from research import Researcher  # noqa: E402

KEY = "test-key-not-real-0000000000"

# ---- canned wiki pages (synthetic, shaped like real poewiki API replies) ----
PAGES = {
    "Desecrate": {
        "extract": "Desecrate is a spell that creates corpses in an area and deals chaos damage over time.",
        "html": "<p>Desecrate is a spell gem.</p><table><tr><td>Level 1</td></tr></table>",
        "wikitext": "{{Item\n|rarity_id = normal\n|class_id = Active Skill Gem\n|name = Desecrate\n}}\n==Version history==\n{{Version history table header}}\n{{Version history table row|3.30.0|\n* Desecrate now creates up to 6 corpses.\n}}\n{{Version history table row|3.0.0|\n* Old change.\n}}\n{{Version history table end}}\n",
    },
    "Bones of Ullr": {
        "extract": "Bones of Ullr is a unique Silk Slippers.",
        "html": "<div>Bones of Ullr</div><div>Requires Level 22, 42 Int</div><div>+1 to Level of all Raise Zombie Gems</div><div>+1 to Level of all Raise Spectre Gems</div><div>20% increased Movement Speed</div><div>\"Flavour\"</div>",
        "wikitext": "{{Item\n|rarity_id = unique\n|name = Bones of Ullr\n}}\nOld page.",
    },
}


# v3 pages (synthetic, shaped like the live replies checked on Nov 12): sections, variants, the vendor recipe page, poedb
PAGES_V3 = {
    "Cane of Kulemak": {
        "extract": "Cane of Kulemak is a unique Serpentine Staff.",
        "html": "<p>Cane of Kulemak</p><div>1 Item acquisition</div><div>2 Version history</div><h2>Item acquisition</h2><p>Cane of Kulemak has restrictions on how it can be acquired.</p>"
                "<p>It can be acquired from the following monsters:</p><p>Catarina, Master of Undeath</p><h2>Version history</h2><p>3.10.0 Introduced</p>",
        "wikitext": "{{Item\n|rarity_id = unique\n|name = Cane of Kulemak\n}}\n",
    },
    "Cane of Kulemak (variant)": {"extract": "Variant page.", "html": "<p>x</p>", "wikitext": ""},
    "The Sword of Ages": {
        "extract": "The Sword of Ages is a unique Midnight Blade.",
        "html": "<h2>Item acquisition</h2><p>This item can drop anywhere. It can be chanced.</p>",
        "wikitext": "{{Item\n|rarity_id = unique\n}}\n{{Version history table row|3.30.0|\n* Introduced.\n}}",
    },
    "List of unique swords": {"extract": "A list.", "html": "<p>list</p>", "wikitext": ""},
    "Vendor recipe system": {
        "extract": "The vendor recipe system lets players sell combinations of items to NPC vendors for rewards.",
        "html": "<h2>Recipes</h2><p>Weapon + Rustic Sash + Blacksmith's Whetstone : Magic weapon with Increased Physical Damage</p>"
                "<p>Gems with a total of at least 40% quality : Gemcutter's Prism</p><p>Chromatic Orb : three items with linked red, green and blue sockets</p>",
        "wikitext": "",
    },
}
PAGES.update(PAGES_V3)
POEDB = {"Cane_of_Kulemak": "<div>Cane of Kulemak</div><div>Dropped by「Catarina, Master of Undeath」</div><div>Release Version3.10.0</div>"}


class MockHttp:
    def __init__(self, llm_reply=None, llm_delay=0.0, llm_error=None, wiki_down=False):
        self.calls, self.posts = [], []
        self.llm_reply, self.llm_delay, self.llm_error, self.wiki_down = llm_reply, llm_delay, llm_error, wiki_down

    def get_json(self, url, params, timeout):
        self.calls.append(params)
        if self.wiki_down:
            raise OSError("connection refused")
        if params.get("list") == "search":
            q = params["srsearch"].lower()
            return {"query": {"search": [{"title": t} for t in PAGES if q in t.lower() or t.lower() in q]}}
        t = params.get("titles") or params.get("page")
        pg = PAGES.get(t)
        if params.get("prop") == "extracts":
            return {"query": {"pages": [{"title": t, "extract": pg["extract"] if pg else ""}]}}
        if params.get("prop") == "text":
            return {"parse": {"title": t, "text": pg["html"] if pg else ""}}
        if params.get("prop") == "wikitext":
            return {"parse": {"title": t, "wikitext": pg["wikitext"] if pg else ""}}
        return {}

    def get_text(self, url, timeout):
        self.calls.append({"text": url})
        slug = url.rsplit("/", 1)[-1]
        if slug in POEDB:
            return POEDB[slug]
        raise OSError("404")

    def post_json(self, url, body, headers, timeout):
        self.posts.append((url, body, headers, timeout))
        if self.llm_delay:
            time.sleep(min(self.llm_delay, timeout + 0.5))
            if self.llm_delay > timeout:
                raise TimeoutError("timed out")
        if self.llm_error:
            raise RuntimeError(self.llm_error)
        if url.endswith("/api/chat"):
            return {"message": {"content": json.dumps(self.llm_reply)}}
        return {"choices": [{"message": {"content": json.dumps(self.llm_reply)}}]}


R = []


def check(name, cond, info=""):
    R.append((name, bool(cond)))
    print(("ok   " if cond else "FAIL ") + name + (f"  [{info}]" if info and not cond else ""))


def cfg(**kw):
    rc = {"backend": "openai_compatible", "llm_timeout_s": 2}
    rc.update(kw)
    return {"research": rc}


def main():
    offline = "--offline" in sys.argv
    os.environ.pop("OPENAI_API_KEY", None)

    # 1. missing key -> wiki only, one startup note
    r = Researcher(cfg(), http=MockHttp())
    check("no key: backend falls back to none", r.backend() == "none")
    check("no key: startup note says wiki-only", "not set" in r.startup_note() and "poewiki" in r.startup_note())
    a = r.answer("Desecrate")
    check("wiki answer: lead sentence", a["spoken"].startswith("Desecrate is a spell"), a["spoken"])
    check("wiki answer: 3.30 change mentioned", "Changed in 3.30: Desecrate now creates up to 6 corpses" in a["spoken"], a["spoken"])
    check("wiki answer: source wiki + link", a["source"] == "wiki" and a["url"].endswith("/wiki/Desecrate"))
    a = r.answer("what does bones of ullr do")
    check("query cleaned to page title", a["title"] == "Bones of Ullr", a["title"])
    check("page without 3.30 info is flagged", "no 3.30 info" in a["spoken"] and "No 3.30 information" in a["full"], a["spoken"])
    check("unique: key mods spoken", "Raise Spectre" in a["spoken"], a["spoken"])
    a = r.answer("Headhunter")
    check("unknown page: says not found", "couldn't find" in a["spoken"], a["spoken"])
    r = Researcher(cfg(), http=MockHttp(wiki_down=True))
    a = r.answer("Desecrate")
    check("wiki down: graceful message + note", "couldn't reach poewiki" in a["spoken"] and "unreachable" in a["note"], a)

    # 2. key present -> OpenAI-compatible call, grounded prompt, never leaks the key
    os.environ["OPENAI_API_KEY"] = KEY
    h = MockHttp(llm_reply={"spoken": "Desecrate makes corpses; in 3.30 it creates up to 6.", "detail": "Longer detail."})
    r = Researcher(cfg(), http=h)
    check("key set: backend openai_compatible", r.backend() == "openai_compatible")
    a = r.answer("Desecrate", state={"level": 30, "act": 4})
    url, body, headers, timeout = h.posts[0]
    check("LLM: posts to base_url/chat/completions", url == "https://api.openai.com/v1/chat/completions", url)
    check("LLM: model from config + max_completion_tokens", body["model"] == research.DEFAULT_RESEARCH["openai_compatible"]["model"] and "max_completion_tokens" in body and "temperature" not in body)
    check("LLM: bearer key only in the header", headers["Authorization"] == "Bearer " + KEY)
    prompt = body["messages"][1]["content"]
    check("LLM: prompt grounded in wiki text + tracker state", "POEWIKI PAGE: Desecrate" in prompt and "up to 6 corpses" in prompt and '"level": 30' in prompt)
    check("LLM: system prompt restricts to sources", "ONLY the SOURCES" in body["messages"][0]["content"])
    check("LLM: answer used, source llm", a["source"] == "llm" and a["spoken"].startswith("Desecrate makes corpses"), a)
    check("LLM: key not in result", KEY not in json.dumps(a))
    r = Researcher(cfg(openai_compatible={"model": "my-model", "base_url": "http://x/v1", "token_param": "max_tokens", "temperature": 0.2}), http=(h2 := MockHttp(llm_reply={"spoken": "x"})))
    r.answer("Desecrate")
    check("config: model/base_url/token_param/temperature honoured", h2.posts[0][0] == "http://x/v1/chat/completions" and h2.posts[0][1]["model"] == "my-model" and h2.posts[0][1]["max_tokens"] == 350 and h2.posts[0][1]["temperature"] == 0.2)

    # 3. failures fall back to the wiki summary
    r = Researcher(cfg(llm_timeout_s=0.5), http=MockHttp(llm_reply={"spoken": "late"}, llm_delay=3))
    t = time.perf_counter(); a = r.answer("Desecrate"); dt = time.perf_counter() - t
    check("LLM timeout -> wiki summary within budget", a["source"] == "wiki" and "timed out" in a["note"] and dt < 1.5, f"{a['note']} {dt:.2f}s")
    r = Researcher(cfg(), http=MockHttp(llm_error=f"401 invalid key {KEY}"))
    a = r.answer("Desecrate")
    check("LLM error -> wiki summary, key redacted in note", a["source"] == "wiki" and "LLM failed" in a["note"] and KEY not in a["note"] and "[redacted]" in a["note"], a["note"])
    r = Researcher(cfg(), http=MockHttp(llm_reply={"wrong": 1}))
    a = r.answer("Desecrate")
    check("LLM junk reply -> still an answer", a["spoken"], a)

    # 4. cancel
    ev = threading.Event()
    r = Researcher(cfg(llm_timeout_s=2), http=MockHttp(llm_reply={"spoken": "x"}, llm_delay=1))
    threading.Timer(0.2, ev.set).start()
    a = r.answer("Desecrate", cancel=ev)
    check("cancel during LLM call -> cancelled", a.get("cancelled"))

    # 5. ollama + none
    h3 = MockHttp(llm_reply={"spoken": "Local answer.", "detail": "d"})
    r = Researcher(cfg(backend="ollama"), http=h3)
    a = r.answer("Desecrate")
    check("ollama backend: /api/chat with format json", h3.posts[0][0].endswith("/api/chat") and h3.posts[0][1]["format"] == "json" and a["source"] == "llm")
    h4 = MockHttp()
    r = Researcher(cfg(backend="none"), http=h4)
    a = r.answer("Desecrate")
    check("backend none: no LLM call", not h4.posts and a["source"] == "wiki")

    # 6. --check-llm
    r = Researcher(cfg(), http=MockHttp(llm_reply={"spoken": "ok"}))
    out = r.check_llm()
    check("check_llm ok, no key printed", out.startswith("LLM ok") and KEY not in out, out)
    r = Researcher(cfg(), http=MockHttp(llm_error=f"401 Unauthorized for key {KEY}"))
    out = r.check_llm()
    check("check_llm fail, key redacted", out.startswith("LLM fail") and KEY not in out, out)
    os.environ.pop("OPENAI_API_KEY")
    out = Researcher(cfg(), http=MockHttp()).check_llm()
    check("check_llm without key says env var not set", "OPENAI_API_KEY is not set" in out, out)

    # 7. hub: immediate spoken ack (< 400 ms), async result pushed to the page, cancel, repeat
    import companion
    class FB:
        def __init__(self): self.said, self.last_say, self.enabled_tts = [], "", True
        def say(self, t): self.said.append(t); self.last_say = t
        def beep(self, l): pass
    os.environ["OPENAI_API_KEY"] = KEY
    fb = FB()
    hub = companion.Hub(dict(companion.DEFAULT_CONFIG), fb, researcher=Researcher(cfg(), http=MockHttp(llm_reply={"spoken": "Six corpses."}, llm_delay=0.4)))
    q = hub.add_client(); q.get()  # hello
    t = time.perf_counter(); rec = hub.handle_text("research desecrate", source="typed"); dt = (time.perf_counter() - t) * 1000
    check("research: immediate 'Looking up' ack < 400 ms", fb.said[0].startswith("Looking up desecrate") and dt < 400, f"{dt:.0f} ms {fb.said}")
    msg = q.get(timeout=5)
    act = msg["actions"][0]
    check("research: result pushed to the tracker as research_result", act["type"] == "research_result" and act["spoken"] == "Six corpses." and act["url"].endswith("Desecrate"), act)
    time.sleep(0.05)
    check("research: answer spoken after the ack", fb.said[-1] == "Six corpses.", fb.said)
    fb.last_say = ""
    hub.handle_text("repeat that", source="typed")
    check("repeat that re-reads the answer", fb.said[-1] == "Six corpses.", fb.said[-1])
    fb.said.clear()
    hub.handle_text("look up bones of ullr", source="typed")
    rec = hub.handle_text("never mind", source="typed")
    time.sleep(0.8)
    check("never mind cancels the running lookup", "Cancelled the lookup" in rec.get("say", "") and q.empty(), fb.said)
    os.environ.pop("OPENAI_API_KEY")

    # 7b. v3: filler stripping, multi-candidate titles, sections, poedb as second source, vendor recipe page
    r = Researcher(cfg(backend="none"), http=(hv := MockHttp()), name_matcher=companion.match_item)
    check("filler: 'look up X on the wiki please' -> X", research.strip_filler("look up Cane of Kulemak on the wiki please") == "Cane of Kulemak", research.strip_filler("look up Cane of Kulemak on the wiki please"))
    check("filler: 'quality gym' -> 'quality gem'", research.strip_filler("quality gym") == "quality gem")
    check("title: real page beats the (variant) page", r.find_title("cane of kulemak") == "Cane of Kulemak")
    check("title: unique beats a 'List of' page", research.title_score("The Sword of Ages", "sword of ages") > research.title_score("List of unique swords", "sword of ages"))
    a = r.answer("where does the cane of kulimac drop")
    check("drop question: acquisition section + monster spoken", "Catarina, Master of Undeath" in a["spoken"] and "restrictions" in a["spoken"], a["spoken"])
    check("drop question: poedb fetched as second source", any("poedb.tw" in str(c.get("text", "")) for c in hv.calls) and "poedb: Dropped by" in a["full"], a["full"])
    a = r.answer("where does sword of ages drop")
    check("drop question: 'can drop anywhere' + 3.30 note", "drop anywhere" in a["spoken"] and "Changed in 3.30" in a["spoken"], a["spoken"])
    a = r.answer("vendor recipe for a physical weapon")
    check("recipe: Vendor recipe system page, sash + whetstone", a["title"] == "Vendor recipe system" and "Rustic Sash" in a["spoken"] and "Whetstone" in a["spoken"], a["spoken"])
    check("recipe: no 'no 3.30 info' note", "no 3.30 info" not in a["spoken"], a["spoken"])
    a = r.answer("vendor recipe quality gem")
    check("recipe: quality gem -> Gemcutter's Prism", "Gemcutter's Prism" in a["spoken"], a["spoken"])
    hp = MockHttp(llm_reply={"spoken": "ok"}); os.environ["OPENAI_API_KEY"] = KEY
    Researcher(cfg(), http=hp, name_matcher=companion.match_item).answer("where does the cane of kulemak drop")
    pr = hp.posts[0][1]["messages"][1]["content"]
    check("LLM prompt carries the sections + poedb facts", "Item acquisition" in pr and "POEDB" in pr and "Catarina" in pr, pr[:300])
    os.environ.pop("OPENAI_API_KEY")

    # 8. live poewiki (wiki path only)
    if not offline:
        try:
            r = Researcher({"research": {"backend": "none"}}, name_matcher=companion.match_item)
            t = time.perf_counter(); a = r.answer("Raise Spectre"); dt = time.perf_counter() - t
            check("LIVE poewiki: Raise Spectre answered", a["title"] == "Raise Spectre" and len(a["spoken"]) > 30, a)
            print(f"     live: {dt*1000:.0f} ms -> {a['spoken'][:160]}")
        except Exception as e:  # noqa: BLE001
            print("skip live test:", e)
    n = sum(ok for _, ok in R)
    print(f"\n{n}/{len(R)} research checks passed")
    sys.exit(0 if n == len(R) else 1)


if __name__ == "__main__":
    main()
