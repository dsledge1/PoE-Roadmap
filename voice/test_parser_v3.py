"""v3 parser cases: every line from the author's v2 session log plus the v3 features (act correction, categories,
Fate boss info, drop-where, recipes, news, block). Run: python test_parser_v3.py"""
import os, sys, time, tempfile
os.environ.setdefault("POE_COMPANION_LOG_DIR", tempfile.mkdtemp(prefix="poelog_"))
from companion import parse
from test_parser import sig as sig2


def sig(a):
    t, w = a["type"], a.get("what")
    if t == "set_act": return f"set_act:{a['act']}" + (f"/was={a['was']}" if a.get("was") else "")
    if t == "milestone" and a.get("boss"): return f"ms:boss=act{a['act']}"
    if t == "query" and w == "links":
        extra = "".join(f"/{k}={a[k]}" for k in ("level", "act", "stage") if a.get(k) is not None)
        return f"q:links/{a.get('links')}/{a.get('focus')}{extra}"
    if t == "query" and w == "fate_info": return "q:fate_info/" + a["boss"]
    if t == "query" and w == "drop_where": return "q:drop_where/" + (a.get("item") or "?" + a["text"])
    if t == "query" and w == "news": return "q:news/" + a["topic"]
    if t == "research" and a.get("topic") == "recipe": return "recipe:" + a["query"]
    return sig2(a)


CASES = [
    # --- questions never log drops (Kulimac false positive), drop-where answers
    ("where does the cane of kulimac drop", ["q:drop_where/Cane of Kulemak"]),
    ("Where does the Cane of Kulimac drop?", ["q:drop_where/Cane of Kulemak"]),
    ("where does the cane of kulemak drop?", ["q:drop_where/Cane of Kulemak"]),
    ("where does sword of ages drop", ["q:drop_where/The Sword of Ages"]),
    ("where do I find the porcupine card", ["q:drop_where/The Porcupine"]),
    ("which boss drops the cane of unravelling", ["q:drop_where/Cane of Unravelling"]),
    ("who drops the cane of unravelling", ["q:drop_where/Cane of Unravelling"]),
    ("is the cane of unravelling good?", ["q:unknown"]),
    ("did I just get a divine?", ["q:unknown"]),
    ("what do I do with a cane of unravelling", ["q:trigger/Cane of Unravelling"]),
    ("I found the cane", ["log:Cane of Unravelling"]),
    ("what an exalted orb, wow", ["log:Exalted Orb"]),
    # --- act correction (the act mix-up)
    ("I'm in Act 2, not Act 3.", ["set_act:2/was=3"]),
    ("I'm in act 2 not act 3", ["set_act:2/was=3"]),
    ("I'm in Act 2. not act 3", ["set_act:2/was=3"]),
    ("I am in act 5 not act 6", ["set_act:5/was=6"]),
    ("im in act 4", ["set_act:4"]),
    ("we're in act 3", ["set_act:3"]),
    ("actually I'm in act 2", ["set_act:2"]),
    ("no, act 3", ["set_act:3"]),
    ("set act to 4", ["set_act:4"]),
    ("set act 7", ["set_act:7"]),
    ("correct act to 6", ["set_act:6"]),
    # --- milestones only on clear completion phrases
    ("Act 1 done.", ["ms:act=1"]),
    ("Act 1 done. Going to try Merveil with 1 fate", ["ms:act=1", "fate:Merveil/1"]),
    ("act 2 is done", ["ms:act=2"]),
    ("act two's done", ["ms:act=2"]),
    ("act 3's done", ["ms:act=3"]),
    ("finished act 3", ["ms:act=3"]),
    ("act 4 complete", ["ms:act=4"]),
    ("entering act 4", ["ms:act=3"]),
    ("made it to act 6", ["ms:act=5"]),
    ("starting act 3", ["ms:act=2"]),
    ("just got to act 7", ["ms:act=6"]),
    ("Malachai down", ["ms:boss=act4"]),
    ("Merveil is dead", ["ms:boss=act1"]),
    ("killed Dominus", ["ms:boss=act3"]),
    ("Oversoul down", ["ms:boss=act2"]),
    ("Arakaali down", ["ms:boss=act7"]),
    ("Lunaris and Solaris down", ["ms:boss=act8"]),
    ("Kitava down", ["ms:kitava=next"]),
    ("heading to act 3", ["note"]),
    ("moving to act 4", ["note"]),
    ("almost done with act 2", ["note"]),
    ("about to finish act 3", ["note"]),
    ("going to finish act 5 soon", ["note"]),
    ("not done with act 2 yet", ["note"]),
    # --- per-stage link categories
    ("Act 1 main attack", ["q:links/None/main/act=1"]),
    ("act 1 main attack", ["q:links/None/main/act=1"]),
    ("what's my movement", ["q:links/None/movement"]),
    ("what is my movement skill", ["q:links/None/movement"]),
    ("utility links in act 5", ["q:links/None/utility/act=5"]),
    ("what are my links", ["q:links/None/all"]),
    ("what are my links in act 3", ["q:links/None/all/act=3"]),
    ("act 3 links", ["q:links/None/all/act=3"]),
    ("what auras in act 6", ["q:links/None/auras/act=6"]),
    ("what's my curse", ["q:links/None/curse"]),
    ("early maps main attack", ["q:links/None/main/stage=EM"]),
    ("late maps links", ["q:links/None/all/stage=LM"]),
    ("what minions in act 8", ["q:links/None/minions/act=8"]),
    ("what is my 4 link", ["q:links/4/main"]),
    ("what are my spectres", ["q:links/None/spectres"]),
    ("what spectres should I use", ["q:links/None/spectres"]),
    ("What is my 3 link setup now, I am in Act 1 at level 10", ["q:links/3/main/level=10/act=1"]),
    ("what is a skill gym", ["q:unknown"]),
    # --- Fate boss info
    ("fate reward for merveil", ["q:fate_info/merveil"]),
    ("fates for malachai", ["q:fate_info/malachai"]),
    ("wickerman reward for the oversoul", ["q:fate_info/oversoul"]),
    ("what does dominus drop for fates", ["q:fate_info/dominus"]),
    ("fate info brutus", ["q:fate_info/brutus"]),
    ("what fates are in this act", ["q:fates"]),
    ("killed brutus with one fate", ["kill:Brutus/1"]),
    # --- research: recipes, gym -> gem, filler
    ("what's the vendor recipe for a physical weapon", ["recipe:vendor recipe for a physical weapon"]),
    ("vendor recipe quality gems", ["recipe:vendor recipe quality gem"]),
    ("how do I make a whetstone", ["recipe:vendor recipe whetstone"]),
    ("research quality gym", ["research:quality gem"]),
    ("look up the wiki for unearth", ["research:unearth"]),
    # --- news readback (research is wiki-only)
    ("any news on fates", ["q:news/fates"]),
    ("news on the league", ["q:news/league"]),
    ("what's the news on twitter about fates", ["q:news/fates"]),
    # --- follow-up res phrasing
    ("18 lightning as well", ["def:lightning=18"]),
    ("and 20 fire", ["def:fire=20"]),
    ("75 cold 75 fire and 18 lightning as well", ["def:fire=75", "def:cold=75", "def:lightning=18"]),
    ("fire is 75, cold is 75 and lightning 18 as well", ["def:fire=75", "def:cold=75", "def:lightning=18"]),
    ("my lightnings are 40", ["def:lightning=40"]),
    ("cold res 30 and lightning 40", ["def:cold=30", "def:lightning=40"]),
    # --- block (attack + spell), EHP / max hit removed
    ("attack block 20", ["def:ablock=20"]),
    ("spell block 15", ["def:block=15"]),
    ("block chance 20", ["def:ablock=20"]),
    ("chance to block 25", ["def:ablock=25"]),
    ("my attack block is 24 and spell block 10", ["def:ablock=24", "def:block=10"]),
    ("my pool is 900", ["def:pool=900"]),
    ("life 1200", ["def:life_es=1200/None"]),
    ("what is my block", ["q:res"]),
]


def run(verbose=True):
    ok, fails, t = 0, [], 0.0
    for phrase, exp in CASES:
        t0 = time.perf_counter(); acts = parse(phrase); t += time.perf_counter() - t0
        got = sorted(sig(a) for a in acts)
        if got == sorted(exp): ok += 1
        else: fails.append((phrase, exp, got))
    if verbose:
        for p, e, g in fails: print(f"FAIL {p!r}\n   expected {e}\n   got      {g}")
        print(f"\nv3 parser cases: {ok}/{len(CASES)}   mean parse time {1000 * t / len(CASES):.2f} ms")
    return ok, len(CASES), fails


def test_parser_v3():
    ok, n, fails = run(verbose=False)
    assert ok == n, fails


if __name__ == "__main__":
    ok, n, _ = run()
    sys.exit(0 if ok == n else 1)
