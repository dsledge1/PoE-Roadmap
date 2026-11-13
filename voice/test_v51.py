"""v5.1 tests (offline). Run: python test_v51.py
Covers: any PoB imports (act titles, level titles, map/named titles, a single tree + skill set, mixed files, mismatched
counts), level/map title parsing, nearest shipped tree for an unshipped patch, the "next tree" / "show tree Level 60"
voice commands, and that the wiki-link flow never touches the clipboard."""
import hashlib
import os
import re
import sys
import time
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
os.environ.setdefault("POE_COMPANION_LOG_DIR", os.path.join(HERE, "logs"))
import companion as c  # noqa: E402
import pob_import as pi  # noqa: E402

R, MS = [], []
FIX = os.path.join(HERE, "..", "test", "fixtures")
LEVELS = open(os.path.join(FIX, "levels_hierophant.xml"), encoding="utf-8").read()
MIXED = open(os.path.join(FIX, "mixed_hierophant.xml"), encoding="utf-8").read()


def check(name, cond, info=""):
    R.append(bool(cond))
    print(("ok   " if cond else "FAIL ") + name + ("" if cond else f"  [{info}]"))


def variants(cfg, sid):
    return [(v["set"], v["spec"]) for v in cfg["stages"].get(sid, {}).get("variants", [])]


def edit(xml, specs=None, sets=None, keep_specs=None, keep_sets=None):
    """Retitle / drop Spec and SkillSet elements of a PoB XML (titles None = remove the title)."""
    root = ET.fromstring(xml)
    tree, skills = root.find("Tree"), root.find("Skills")
    sp, ss = tree.findall("Spec"), skills.findall("SkillSet")
    if keep_specs is not None:
        for i, e in enumerate(sp):
            if i not in keep_specs:
                tree.remove(e)
        sp = tree.findall("Spec")
        tree.set("activeSpec", "1")
    if keep_sets is not None:
        for i, e in enumerate(ss):
            if i not in keep_sets:
                skills.remove(e)
        ss = skills.findall("SkillSet")
        skills.set("activeSkillSet", ss[0].get("id"))
    for lst, titles in ((sp, specs), (ss, sets)):
        if titles is None:
            continue
        for e, t in zip(lst, titles):
            if t is None:
                e.attrib.pop("title", None)
            else:
                e.set("title", t)
    return ET.tostring(root, encoding="unicode")


# ---------------------------------------------------------------- title parsing
for t, want in [("22", 22), ("Level 22", 22), ("Lvl 22", 22), ("lvl. 22", 22), ("lv22", 22), ("L22", 22), ("level 60 setup", 60),
                ("94", 94), ("Lv 90+", 90), ("6L", None), ("Act 5", None), ("Early Mapping", None), ("0", None), ("250", None)]:
    check(f"level_of({t!r}) = {want}", pi.level_of(t) == want, pi.level_of(t))
for t, want in [("Early Mapping", "EM"), ("White maps", "EM"), ("Yellow Maps", "MM"), ("Mid game", "MM"), ("Red Maps/VoidStones", "LM"),
                ("End Game Super Tanky Setup", "LM"), ("Uber bossing", "LM"), ("T16 farming", "LM"), ("Bossing", None), ("Act 5", None), ("Early Game", None)]:
    check(f"map_stage_of({t!r}) = {want}", pi.map_stage_of(t) == want, pi.map_stage_of(t))
check("'Early Game' = the campaign start (Act 1)", pi.stages_for_title("Early Game") == ["A1"], pi.stages_for_title("Early Game"))

# ---------------------------------------------------------------- Stormburst (levels as tree titles, one untitled skill set) used to import empty
t0 = time.perf_counter()
cl = pi.import_build(LEVELS)
MS.append((time.perf_counter() - t0) * 1000)
check("levels PoB: mode 'levels'", cl["mode"] == "levels", cl["mode"])
check("levels PoB: tabs Level 22 / 60 / 94 sorted by level", cl["stageList"] == ["L22", "L60", "L94"] and [cl["stageMeta"][s]["label"] for s in cl["stageList"]] == ["Level 22", "Level 60", "Level 94"], cl["stageList"])
check("levels PoB: each level gets its own tree", [variants(cl, s)[0][1] for s in cl["stageList"]] == [2, 0, 1], [variants(cl, s) for s in cl["stageList"]])
check("levels PoB: the one skill set is shared by every level", all(variants(cl, s)[0][0] == 0 for s in cl["stageList"]))
check("levels PoB: nothing left unassigned", not cl.get("unassigned", {}).get("sets") and not cl.get("unassigned", {}).get("specs"), cl.get("unassigned"))
sl = pi.summary(cl)
check("levels PoB: summary lists the levels (not 13 empty act lines)", "Level 22:" in sl and "Level 94:" in sl and "Act 1" not in sl and "no skill set" not in sl.lower(), sl)

# ---------------------------------------------------------------- mixed titles: acts + early game + maps + end game
cm = pi.import_build(MIXED)
check("mixed PoB: act mode (it names acts)", cm["mode"] == "acts" and cm["stageList"][:10] == [f"A{i}" for i in range(1, 11)], cm["stageList"])
sets = [s["clean"] for s in cm["sets"]]
specs = [s["clean"] for s in cm["specs"]]
def set_of(sid): return sets[variants(cm, sid)[0][0]] if variants(cm, sid) else None
def spec_of(sid): return specs[variants(cm, sid)[0][1]] if variants(cm, sid) else None
check("mixed: Act 1 = 'Early Game'", set_of("A1") == "Early Game" and spec_of("A1") == "Early Game", (set_of("A1"), spec_of("A1")))
check("mixed: Act 5 = 'Act 5'", set_of("A5") == "Act 5", set_of("A5"))
check("mixed: Act 8 uses the 'Act 8' tree", spec_of("A8") == "Act 8", spec_of("A8"))
check("mixed: Act 10 = 'Act 10'", set_of("A10") == "Act 10" and spec_of("A10") == "Act 10", (set_of("A10"), spec_of("A10")))
check("mixed: Early maps = 'Early Mapping'", set_of("EM") == "Early Mapping", set_of("EM"))
lm = [(sets[a], specs[b]) for a, b in variants(cm, "LM")]
check("mixed: late maps has the red-maps, EV/suppress and end-game variants", len(lm) >= 3 and any("End Game" in a for a, _ in lm) and any("SUPPRESS" in a for a, _ in lm), lm)
used_sets = {a for sid in cm["stageList"] for a, _ in variants(cm, sid)}
check("mixed: every skill set is used somewhere", used_sets == set(range(len(sets))), (used_sets, sets))
check("mixed: trees on 3_27 / 3_28 (not shipped) fall back to a shipped tree", pi.nearest_tree("3_27") in ("3_26", "3_29") and pi.nearest_tree("3_28") in ("3_26", "3_29") and pi.nearest_tree("3_29") == "3_29")
st = pi.slim_tree("3_27")
check("slim_tree('3_27') draws on the nearest tree and says so", st.get("requested") == "3_27" and st.get("nodes"), list(st)[:6])

# ---------------------------------------------------------------- a single tree + one skill set → no tabs at all
one = edit(LEVELS, specs=[None], keep_specs=[0])
c1 = pi.import_build(one)
check("single PoB: mode 'single', one stage, no tabs", c1["mode"] == "single" and c1["stageList"] == ["ALL"] and variants(c1, "ALL") == [(0, 0)], (c1["mode"], c1["stageList"], c1["stages"]))
check("single PoB: summary says it's one setup", "Act 1" not in pi.summary(c1), pi.summary(c1))
one_t = edit(LEVELS, specs=["Main"], keep_specs=[0])
c1t = pi.import_build(one_t)
check("one titled tree + one set still = single (no lone tab)", c1t["mode"] == "single", c1t["mode"])

# ---------------------------------------------------------------- named titles only → manual tabs
named = edit(LEVELS, specs=["Bossing", "Clear speed", "Budget"])
cn = pi.import_build(named)
check("named PoB: mode 'named' with three manual tabs", cn["mode"] == "named" and len(cn["stageList"]) == 3, (cn["mode"], cn["stageList"]))
check("named PoB: tab labels are the PoB titles", sorted(cn["stageMeta"][s]["label"] for s in cn["stageList"]) == ["Bossing", "Budget", "Clear speed"], cn["stageMeta"])
check("named PoB: every tab has the shared skill set", all(variants(cn, s) and variants(cn, s)[0][0] == 0 for s in cn["stageList"]))
leveling = edit(LEVELS, specs=["Endgame bossing", "Leveling", "Budget"])
cg = pi.import_build(leveling)
check("named + map words: 'Endgame bossing' → late maps, 'Leveling' tab sorts first", "LM" in cg["stageList"] and cg["stageMeta"][cg["stageList"][0]]["label"] == "Leveling", (cg["stageList"], cg["stageMeta"]))

# ---------------------------------------------------------------- mismatched counts: titled sets by level, more trees than sets
mm = edit(MIXED, sets=["Level 12", "Level 40", "Level 68", "Level 80", None, None, None],
          specs=["Lvl 12", "Lvl 40", "Lvl 68", "Lvl 80", "lv 90", None, None, None, None], keep_specs=[0, 1, 2, 3, 4, 5, 6, 7, 8])
cmm = pi.import_build(mm)
check("mismatch: level mode with 5 level tabs", cmm["mode"] == "levels" and cmm["stageList"] == ["L12", "L40", "L68", "L80", "L90"], cmm["stageList"])
check("mismatch: every level tab has a skill set and a tree", all(variants(cmm, s) for s in cmm["stageList"]), {s: variants(cmm, s) for s in cmm["stageList"]})
check("mismatch: 'lv 90' (tree only) keeps the previous / untitled skill set", variants(cmm, "L90")[0][0] is not None, variants(cmm, "L90"))
sets_only = edit(LEVELS, specs=[None, None, None])
cso = pi.import_build(sets_only)
check("three untitled trees + one untitled set → still imports (single or named, never empty)", cso["stageList"] and all(variants(cso, s) for s in cso["stageList"]), (cso["mode"], cso["stageList"]))

# ---------------------------------------------------------------- act-titled builds are unchanged from v5
ex = os.path.join(HERE, "..", "test", "fixtures", "example_pob.xml")
if not os.path.exists(ex):
    ex = os.path.join(HERE, "..", "docs", "examples", "example_pob.xml")
if os.path.exists(ex):
    ce = pi.import_build(open(ex, encoding="utf-8").read())
    check("example act PoB: still act mode, Act 5 uses 'Act 3-10'", ce["mode"] == "acts" and ce["sets"][variants(ce, "A5")[0][0]]["clean"] == "Act 3-10")
dav = os.environ.get("POE_PRIVATE_POB", "")     # optional: your own act-staged PoB (never committed)
if dav and os.path.exists(dav):
    cd_ = pi.import_build(open(dav, encoding="utf-8").read())
    h = hashlib.md5(pi.summary(cd_).encode()).hexdigest()
    check("own act PoB: summary identical to v5", h == "bd40fcfb22ac4457eb8da0fca4aa6f1a", h)
for xml in (LEVELS, MIXED, one, named, mm):
    t0 = time.perf_counter(); pi.import_build(xml); MS.append((time.perf_counter() - t0) * 1000)
check("every import < 400 ms", max(MS) < 400, max(MS))

# ---------------------------------------------------------------- voice: switch trees
PMS = []
def p(text):
    t0 = time.perf_counter(); a = c.parse(text); PMS.append((time.perf_counter() - t0) * 1000); return a
for text, want in [("next tree", {"type": "tree_nav", "dir": 1}), ("next stage", {"type": "tree_nav", "dir": 1}), ("go to the next stage", {"type": "tree_nav", "dir": 1}),
                   ("previous tree", {"type": "tree_nav", "dir": -1}), ("last tree", {"type": "tree_nav", "dir": -1}),
                   ("show tree Level 60", {"type": "tree_nav", "name": "level 60"}), ("show tree lvl 94", {"type": "tree_nav", "name": "lvl 94"}),
                   ("switch tree to early mapping", {"type": "tree_nav", "name": "early mapping"}), ("show the act 5 tree", {"type": "tree_nav", "name": "act 5"}),
                   ("show the tree for red maps", {"type": "tree_nav", "name": "red maps"}), ("back to current tree", {"type": "tree_nav", "auto": True}),
                   ("show me my tree", {"type": "tree_nav", "auto": True})]:
    got = p(text)
    check(f"voice {text!r} → {want}", got == [want], got)
for text, typ in [("what are my links", "query"), ("what are my links in act 5", "query"), ("set act 5", "set_act"), ("early maps main attack", "query")]:
    got = p(text)
    check(f"voice {text!r} still → {typ}", got and got[0]["type"] == typ, got)
check("tree_nav described in the voice log", "tree" in c.describe([{"type": "tree_nav", "dir": 1}]), c.describe([{"type": "tree_nav", "dir": 1}]))

# ---------------------------------------------------------------- wiki links never touch the clipboard
src = open(os.path.join(HERE, "companion.py"), encoding="utf-8").read()
check("companion: no clipboard code (clip.exe / copy_to_clipboard gone)", "copy_to_clipboard" not in src and not re.search(r"""\[\s*["']clip["']""", src))
check("companion: spoken confirmation is 'Wiki link for X added.'", 'Wiki link for {res[\'title\']} added.' in src)

print(f"\n{sum(R)}/{len(R)} v5.1 checks passed   import max {max(MS):.1f} ms   parse mean {sum(PMS)/len(PMS):.2f} ms")
sys.exit(0 if all(R) else 1)
