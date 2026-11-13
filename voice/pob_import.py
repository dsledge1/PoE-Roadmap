"""Path of Building import -> per-stage links + passive trees for the tracker's right-hand panel.

Accepts a PoB export code, a pobb.in or poe.ninja/pob URL, or the XML itself. Skill sets and tree specs are
mapped to stages by title, tolerantly: "Act 1", "A1", "act1", "Act 4-10" (a range), "Lvl70 Early mapping",
"Early ...", "Mid ...", "Late ...", "Min-Max ...". A "{n}" tag pairs a skill set with the tree that has the same tag.
PoB colour codes (^0-^9, ^xRRGGBB) are stripped everywhere. Each socket group is auto-classified
(main / movement / utility / auras / curse / minions / other); the page lets you override it.

Output ("build config", stored by the page in localStorage and exportable):
  {version, name, className, ascendancy, treeVersion, sets:[...], specs:[...], stages:{A1: {variants:[{set, spec}]}, ...}}
Usage: python companion.py --import-pob <code | url | file.xml>     (or POST /api/pob_import {"text": ...})
"""
from __future__ import annotations

import base64
import json
import math
import re
import urllib.request
import xml.etree.ElementTree as ET
import zlib
from difflib import SequenceMatcher
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = HERE / "pobdata"
STAGES = ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9", "A10", "EM", "MM", "LM"]
STAGE_LABEL = {**{f"A{i}": f"Act {i}" for i in range(1, 11)}, "EM": "Early maps", "MM": "Mid maps", "LM": "Late maps"}
CATS = ["main", "movement", "utility", "auras", "curse", "minions", "other"]
CAT_LABEL = {"main": "Main attack", "movement": "Movement", "utility": "Utility", "auras": "Auras", "curse": "Curse",
             "minions": "Minions", "other": "Other"}
# approx. level at the END of each act (for "lvl N" titles without an act)
ACT_END_LEVEL = [(12, "A1"), (23, "A2"), (33, "A3"), (40, "A4"), (45, "A5"), (50, "A6"), (55, "A7"), (60, "A8"), (64, "A9"), (69, "A10")]
UA = "PoE-HCSSF-tracker/3.0 (personal; PoB import)"

_GEMS = None


def gems():
    global _GEMS
    if _GEMS is None:
        try:
            _GEMS = json.loads((DATA / "gems.json").read_text(encoding="utf-8"))
        except Exception:
            _GEMS = {}
    return _GEMS


def strip_codes(s: str) -> str:
    s = re.sub(r"\^x[0-9A-Fa-f]{6}|\^\d", "", s or "")
    return re.sub(r"\s+", " ", s).strip()


def tag_of(title: str):
    m = re.search(r"\{(\d+)\}", title or "")
    return int(m.group(1)) if m else None


def clean_title(title: str) -> str:
    return re.sub(r"\s*\{\d+\}\s*", " ", strip_codes(title)).strip()


# ------------------------------------------------------------------ decoding
def fetch_text(url: str, timeout=10) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def decode(src: str, fetch=fetch_text) -> str:
    """Return PoB XML from an export code, a pobb.in / poe.ninja URL, or XML text."""
    s = (src or "").strip()
    if s.startswith("<"):
        return s
    m = re.match(r"^(?:https?://)?(?:www\.)?pobb\.in/(?:u/[^/]+/)?([A-Za-z0-9_-]+)", s)
    if m:
        s = fetch(f"https://pobb.in/{m.group(1)}/raw").strip()
    else:
        m = re.match(r"^(?:https?://)?(?:www\.)?poe\.ninja/(?:poe1/)?pob/(?:raw/)?([A-Za-z0-9_-]+)", s)
        if m:
            s = fetch(f"https://poe.ninja/pob/raw/{m.group(1)}").strip()
        elif re.match(r"^https?://", s):
            s = fetch(s).strip()
    if s.startswith("<"):
        return s
    code = re.sub(r"\s+", "", s).replace("-", "+").replace("_", "/")
    code += "=" * (-len(code) % 4)
    raw = base64.b64decode(code)
    for wbits in (zlib.MAX_WBITS, -zlib.MAX_WBITS, zlib.MAX_WBITS | 32):
        try:
            return zlib.decompress(raw, wbits).decode("utf-8", "replace")
        except zlib.error:
            continue
    raise ValueError("not a PoB export code, URL or XML")


# ------------------------------------------------------------------ stage mapping
# v5: a number is an act only with explicit act context: "Act 6", "Acts 4-10", "A6" / "a6" (no space). Free text such as
# "Get a 6 link", "5L", "6 socket" or "level 6" is never read as an act (the article "a" used to turn "a 6 link" into Act 6).
_NOT_ACT_AFTER = r"(?!\s*(?:-|–)?\s*(?:l\b|link|links|linked|s\b|sock|socket|sockets|socketed|off\b|ex\b|div|c\b|chaos))"
_ACT_RANGE = re.compile(r"\b(?:acts?\s*(\d{1,2})|a(\d{1,2}))\s*(?:-|–|to|through|thru)\s*(?:acts?\s*|a)?(\d{1,2})\b" + _NOT_ACT_AFTER)
_ACT_ONE = re.compile(r"\b(?:acts?\s*(\d{1,2})|a(\d{1,2}))\b" + _NOT_ACT_AFTER)


def stages_for_title(title: str, level_hint=None):
    """'Act 1' -> [A1]; 'Act 4-10' -> [A4..A10]; 'A3' / 'act3' -> [A3]; 'Lvl70 Early mapping' -> [EM]; 'Mid' -> [MM].
    'Get a 6 link' / '5L chest' / '6 socket' / 'level 6 gems' never name an act."""
    t = clean_title(title).lower()
    m = _ACT_RANGE.search(t)
    if m:
        lo, hi = int(m.group(1) or m.group(2)), int(m.group(3))
        if 1 <= lo <= hi <= 10:
            return [f"A{i}" for i in range(lo, hi + 1)]
    m = _ACT_ONE.search(t)
    if m and 1 <= int(m.group(1) or m.group(2)) <= 10 and not re.search(r"\b(maps?|mapping)\b", t):
        return [f"A{int(m.group(1) or m.group(2))}"]
    if re.search(r"\b(early game|early leveling|early levelling|league start(?:er)?)\b", t):
        return ["A1"]                                  # v5.1: "Early Game" is the campaign start, not early maps
    if re.search(r"\b(min-?max|endgame|end game|late|red maps?|t1[4-7])\b", t):
        return ["LM"]
    if re.search(r"\b(mid|middle|yellow maps?)\b", t):
        return ["MM"]
    if re.search(r"\b(early|white maps?|mapping|maps|map start|lvl ?7\d|level ?7\d)\b", t):
        return ["EM"]
    # a character level picks the act it is reached in ("Lvl 30" -> A3); a bare number only next to "lvl"/"level",
    # and never a socket / link count ("6 link, level gems" is not level 6)
    m = re.search(r"\b(?:lvl|level|lv)\s*(\d{1,3})\b", t)
    if m:
        lv = int(m.group(1))
        for end, st in ACT_END_LEVEL:
            if lv <= end:
                return [st]
        return ["EM"]
    if re.search(r"\b(campaign|leveling|levelling)\b", t):
        return ["A1"]
    return []


# ------------------------------------------------------------------ v5.1: generic PoBs (levels, named stages, one setup)
_LEVEL_WHOLE = re.compile(r"^(?:(?:lvl|level|lv|l)\s*\.?\s*)?(\d{1,3})\s*\+?$")
_LEVEL_ANY = re.compile(r"(?:^|\b)(?:lvl|level|lv)\s*\.?\s*(\d{1,3})\b|^l(\d{1,3})\b")


def level_of(title: str):
    """'22' / 'Level 22' / 'Lvl 22' / 'lv22' / 'L22' / 'Level 60 setup' -> 22 / 60; None when the title names no level."""
    t = clean_title(title).lower().strip()
    m = _LEVEL_WHOLE.match(t) or _LEVEL_ANY.search(t)
    if not m:
        return None
    lv = int(next(g for g in m.groups() if g))
    return lv if 1 <= lv <= 100 else None


def map_stage_of(title: str):
    """Only clear map words: 'Early Mapping' -> EM, 'Red Maps/VoidStones' / 'End Game' -> LM, 'Yellow maps' -> MM."""
    t = clean_title(title).lower()
    if re.search(r"\b(red maps?|late maps?|late game|end ?game|min-?max|pinnacle|ubers?|voidstones?|t1[1-7])\b", t):
        return "LM"
    if re.search(r"\b(mid maps?|middle maps?|yellow maps?|mid ?game|mid mapping)\b", t):
        return "MM"
    if re.search(r"\b(early maps?|early mapping|white maps?|map start|starting maps|first maps|mapping|maps?)\b", t):
        return "EM"
    return None


def has_act_title(title: str) -> bool:
    t = clean_title(title).lower()
    return bool(_ACT_RANGE.search(t) or _ACT_ONE.search(t))


EARLY_WORDS = re.compile(r"\b(early|start|starter|leveling|levelling|campaign|league start)\b", re.I)


def _pair(sets_i, specs_j, sets, specs):
    """Variants for one stage: each skill set with its best tree (same {n} tag, then most similar title, then PoB order);
    trees nobody took become their own variants (with the first set)."""
    vs, free = [], list(specs_j)
    for i in sets_i:
        pick = next((j for j in free if sets[i]["tag"] is not None and specs[j]["tag"] == sets[i]["tag"]), None)
        if pick is None and free:
            best = max(free, key=lambda j: (_sim(sets[i]["clean"], specs[j]["clean"]), -free.index(j)))
            pick = best
        if pick is not None:
            free.remove(pick)
        vs.append({"set": i, "spec": pick})
    for j in free:
        vs.append({"set": sets_i[0] if sets_i else None, "spec": j})
    return vs


def generic_stages(sets, specs):
    """Stages for a PoB without act titles. Returns (mode, stageList, stageMeta, stages).
    mode: 'levels' (titles are character levels), 'named' (tabs named after the PoB titles; clear map words go to
    Early / Mid / Late maps) or 'single' (one setup: no tabs)."""
    tabs, order = {}, 0

    def tab_for(title):
        nonlocal order
        lv, ms = level_of(title), map_stage_of(title)
        if ms:
            return ms, {"label": STAGE_LABEL[ms], "kind": "map", "sort": 1000 + STAGES.index(ms)}
        if lv:
            return f"L{lv}", {"label": f"Level {lv}", "kind": "level", "level": lv, "sort": lv}
        key = clean_title(title).lower()
        for tid, t in tabs.items():
            if t["kind"] == "named" and t["key"] == key:
                return tid, t
        order += 1
        early = bool(EARLY_WORDS.search(title))
        return f"N{order}", {"label": clean_title(title)[:40], "kind": "named", "key": key, "sort": (0.5 if early else 2000) + order / 1000}

    pool_sets, pool_specs = [], []
    for kind, items, pool in (("sets", sets, pool_sets), ("specs", specs, pool_specs)):
        for i, x in enumerate(items):
            if not x.get("titled"):
                pool.append(i)
                continue
            tid, meta = tab_for(x["title"])
            t = tabs.setdefault(tid, {**meta, "sets": [], "specs": []})
            t[kind].append(i)
    # one titled set and the trees by level / name (or the other way round): the lone set is shared, not a tab of its own
    for kind, pool in (("sets", pool_sets), ("specs", pool_specs)):
        own = [tid for tid, t in tabs.items() if t[kind] and not t["sets" if kind == "specs" else "specs"]]
        if len(own) == 1 and len(tabs) > 1 and tabs[own[0]]["kind"] == "named" and not pool and len(tabs[own[0]][kind]) == 1:
            pool.append(tabs[own[0]][kind][0]); del tabs[own[0]]
    if len(tabs) <= 1:
        t = next(iter(tabs.values()), {"sets": [], "specs": []})
        si, pj = t["sets"] + pool_sets, t["specs"] + pool_specs
        vs = [{"set": si[k] if k < len(si) else (si[0] if si else None), "spec": pj[k] if k < len(pj) else (pj[0] if pj else None)}
              for k in range(max(len(si), len(pj), 1))]
        meta = {"ALL": {"label": t.get("label") or "Build", "kind": "single"}}
        return "single", ["ALL"], meta, {"ALL": {"variants": vs if (si or pj) else []}}
    ids = sorted(tabs, key=lambda k: tabs[k]["sort"])
    stages = {}
    need_set = [k for k in ids if not tabs[k]["sets"]]
    need_spec = [k for k in ids if not tabs[k]["specs"]]
    for tid in ids:
        t = tabs[tid]
        vs = _pair(t["sets"], t["specs"], sets, specs)
        for v in vs:
            if v["set"] is None and pool_sets:
                v["set"] = pool_sets[need_set.index(tid)] if len(pool_sets) == len(need_set) > 1 else pool_sets[0]
            if v["spec"] is None and pool_specs:
                v["spec"] = pool_specs[need_spec.index(tid)] if len(pool_specs) == len(need_spec) > 1 else pool_specs[0]
        if not vs:
            vs = [{"set": pool_sets[0] if pool_sets else None, "spec": pool_specs[0] if pool_specs else None}]
        stages[tid] = {"variants": vs}
    prev = None                                         # still missing: the stage before's set / tree
    for tid in ids:
        for v in stages[tid]["variants"]:
            if v["set"] is None and prev and prev["set"] is not None:
                v["set"] = prev["set"]; v["setInherited"] = True
            if v["spec"] is None and prev and prev["spec"] is not None:
                v["spec"] = prev["spec"]; v["specInherited"] = True
        prev = stages[tid]["variants"][0]
    mode = "levels" if any(tabs[k]["kind"] == "level" for k in ids) else "named"
    meta = {k: {x: tabs[k][x] for x in ("label", "kind", "level") if x in tabs[k]} for k in ids}
    return mode, ids, meta, stages


# ------------------------------------------------------------------ classification
SECTION_HINTS = [(r"main", "main"), (r"utility|utilities", "utility"), (r"auras?|reserv", "auras"), (r"curses?|hex", "curse"),
                 (r"spectres?|minions?|zombies?|golems?", "minions"), (r"movement|mobility", "movement")]
MOVE_RE = r"\b(mobility|movement|move|dash|blink|leap|charge|travel)\b"
LABEL_HINTS = [(MOVE_RE, "movement"), (r"\b(main ?dmg|main damage|main skill|main attack|main|dmg)\b", "main"),
               (r"\b(auras?|heralds?)\b", "auras"), (r"\b(curses?|hex)\b", "curse"), (r"\b(guard|trigger|utility|extras?|offering)\b", "utility")]
TANK_MINIONS = {"Raise Zombie", "Summon Stone Golem", "Summon Flame Golem", "Summon Ice Golem", "Summon Lightning Golem", "Summon Chaos Golem",
                "Summon Carrion Golem", "Animate Guardian", "Summon Skeletons", "Summon Phantasm", "Summon Holy Relic", "Summon Skitterbots"}


def gem_info(name: str):
    g = gems().get(name) or gems().get(re.sub(r"^Vaal ", "", name)) or {}
    tags = set(g.get("t") or [])
    c = g.get("c", "w")
    if c == "w":    # no attribute requirement in the data: fall back to the attribute tag
        c = "r" if "strength" in tags else "g" if "dexterity" in tags else "b" if "intelligence" in tags else "w"
    return c, bool(g.get("s")) or name.endswith(" Support"), tags


def gem_kind(name, tags):
    if tags & {"movement", "travel", "blink"}:
        return "movement"
    if tags & {"aura", "herald"} or name.startswith("Herald of"):
        return "auras"
    if tags & {"curse", "hex", "mark"}:
        return "curse"
    if tags & {"guard", "warcry", "offering", "trigger"} or name in ("Convocation", "Desecrate", "Bone Offering", "Flesh Offering", "Spirit Offering", "Arcanist Brand"):
        return "utility"
    if "minion" in tags and name not in ("Absolution", "Vaal Absolution", "Summon Raging Spirit", "Raise Spectre"):
        return "minions"
    return "damage"


def classify(group, section=None):
    label = (group.get("name") or group["label"]).lower()          # hints from the name only, never the (note)
    note = (group.get("note") or "").lower()
    actives = [g for g in group["gems"] if not g["sup"]]
    kinds = [gem_kind(g["n"], set(g.get("tags") or [])) for g in actives]
    for pat, cat in LABEL_HINTS:
        if re.search(pat, label):
            if cat == "main" and actives and all(k in ("minions",) for k in kinds) and not re.search(r"dmg|damage", label):
                break
            return cat
    if re.search(r"\b(replace|instead of)\b.*\b(srs|main|absolution|spectre|rolling magma)\b", note) and "damage" in kinds + \
            ["damage" if any(g["n"] in ("Absolution", "Vaal Absolution", "Summon Raging Spirit", "Raise Spectre") for g in actives) else ""]:
        return "main"
    if re.search(r"\bbefore minions\b", label):
        return "main"
    if section == "main":
        if any(g["n"] in ("Raise Spectre", "Absolution", "Vaal Absolution", "Summon Raging Spirit") for g in actives) or "damage" in kinds or "dmg" in label:
            return "main"
        if actives and all(g["n"] in TANK_MINIONS for g in actives):
            return "minions"
        return "main"
    if section in CATS:
        return section
    if not kinds:
        return "other"
    for k in ("movement", "auras", "curse"):
        if kinds and kinds[0] == k:
            return k
    if "damage" in kinds:
        return "damage"            # resolved per set: main vs other
    if all(k == "minions" for k in kinds):
        return "minions"
    if "utility" in kinds:
        return "utility"
    if "curse" in kinds:
        return "curse"
    return "other"


def label_parts(raw_label: str):
    """'^63L Lvl 12 Absolution (Replace SRS after Merveil)' -> ('Lvl 12 Absolution', '3L', 'Replace SRS after Merveil')."""
    s = strip_codes(raw_label)
    links = None
    m = re.match(r"^(\d(?:-\d)?)\s?([LS])\b\s*", s)
    if m:
        links, s = m.group(1) + m.group(2), s[m.end():]
    note = None
    m = re.search(r"\(([^)]*)\)?\s*$", s)
    if m and m.group(1).strip():
        note, s = m.group(1).strip(), s[:m.start()].strip()
    return s.strip(" -:") or None, links, note


def parse_set(ss, main_group_idx=None):
    groups, section = [], None
    for gi, g in enumerate(ss.findall("Skill")):
        label = g.attrib.get("label") or ""
        gs = g.findall("Gem")
        clean = strip_codes(label)
        if not gs:
            m = re.match(r"^=+\s*(.*?)\s*=*$", clean)
            if m:
                txt = m.group(1).lower()
                section = None
                for pat, cat in SECTION_HINTS:
                    if txt and re.search(pat, txt):
                        section = cat; break
            continue           # separators and section headers are not cards
        gl = []
        for x in gs:
            name = x.attrib.get("nameSpec") or x.attrib.get("skillId") or "?"
            if not x.attrib.get("nameSpec") and x.attrib.get("gemId"):
                name = gems().get("#" + (x.attrib.get("skillId") or ""), name)
            col, sup, tags = gem_info(name)
            gl.append({"n": name, "c": col, "sup": sup, "lvl": int(x.attrib.get("level") or 0) or None,
                       "q": int(x.attrib.get("quality") or 0) or None, "en": x.attrib.get("enabled", "true") != "false", "tags": sorted(tags & {
                           "movement", "travel", "blink", "aura", "herald", "curse", "hex", "mark", "guard", "warcry", "offering", "trigger", "minion",
                           "spell", "attack", "totem"})})
        # actives first (keep their order), supports after: the card shows "Active └ support └ support"
        gl = [x for x in gl if not x["sup"]] + [x for x in gl if x["sup"]]
        name, links, note = label_parts(label)
        grp = {"label": clean, "name": name or (gl[0]["n"] if gl else "Group"), "links": links, "note": note,
               "slot": g.attrib.get("slot"), "en": g.attrib.get("enabled", "true") != "false", "gems": gl, "order": gi}
        grp["auto"] = classify(grp, section)
        groups.append(grp)
    # resolve plain damage groups: labelled mains stay; otherwise the biggest damage group (first on ties) is main
    has_main = any(g["auto"] == "main" for g in groups)
    dmg = [g for g in groups if g["auto"] == "damage"]
    if dmg and not has_main:
        best = max(dmg, key=lambda g: (len(g["gems"]), -g["order"]))
        best["auto"] = "main"
    for g in groups:
        if g["auto"] == "damage":
            g["auto"] = "other"
        g["cat"] = g["auto"]
        for x in g["gems"]:
            x.pop("tags", None)
    return groups


def parse_spec(sp):
    nodes = [int(x) for x in (sp.attrib.get("nodes") or "").split(",") if x.strip().isdigit()]
    return {"title": strip_codes(sp.attrib.get("title") or "Default"), "clean": clean_title(sp.attrib.get("title") or "Default"),
            "tag": tag_of(sp.attrib.get("title")), "treeVersion": sp.attrib.get("treeVersion") or "", "classId": int(sp.attrib.get("classId") or 0),
            "ascendClassId": int(sp.attrib.get("ascendClassId") or 0), "nodes": nodes,
            "masteries": sp.attrib.get("masteryEffects") or ""}


def _sim(a, b):
    a = re.sub(r"\b(lvl|level|lvling|leveling)\s*\d*\b|\{\d+\}", " ", a.lower())
    b = re.sub(r"\b(lvl|level|lvling|leveling)\s*\d*\b|\{\d+\}", " ", b.lower())
    return SequenceMatcher(None, a.split(), b.split()).ratio()


def import_build(src: str, fetch=fetch_text) -> dict:
    xml = decode(src, fetch)
    root = ET.fromstring(xml)
    b = root.find("Build")
    battr = b.attrib if b is not None else {}
    skills = root.find("Skills")
    sets = []
    for ss in (skills.findall("SkillSet") if skills is not None else []):
        t = ss.attrib.get("title") or "Default"
        sets.append({"id": ss.attrib.get("id"), "title": strip_codes(t), "clean": clean_title(t), "tag": tag_of(t),
                     "stages": stages_for_title(t), "groups": parse_set(ss), "titled": bool(clean_title(ss.attrib.get("title") or ""))})
    if skills is not None and not sets:      # old PoB: groups directly under <Skills>
        sets.append({"id": "1", "title": "Default", "clean": "Default", "tag": None, "stages": [], "groups": parse_set(skills), "titled": False})
    tree = root.find("Tree")
    specs = [parse_spec(sp) for sp in (tree.findall("Spec") if tree is not None else [])]
    for sp, el in zip(specs, tree.findall("Spec") if tree is not None else []):
        sp["stages"] = stages_for_title(sp["title"])
        sp["titled"] = bool(clean_title(el.attrib.get("title") or ""))
    if not any(has_act_title(x["title"]) for x in sets + specs if x.get("titled")):
        return _finish(root, battr, sets, specs, *generic_stages(sets, specs))     # v5.1: no "Act N" titles anywhere
    stages = {}
    # acts: tree by its own Act title, skill set by title (ranges allowed); gaps inherit from the stage before
    for st in STAGES[:10]:
        si = next((i for i, s in enumerate(sets) if st in s["stages"]), None)
        pi = next((i for i, p in enumerate(specs) if st in p["stages"] and p["tag"] is None), None)
        if pi is None:
            pi = next((i for i, p in enumerate(specs) if st in p["stages"]), None)
        stages[st] = {"variants": [{"set": si, "spec": pi}] if si is not None or pi is not None else []}
    used_specs = {v["spec"] for st in STAGES[:10] for v in stages[st]["variants"] if v["spec"] is not None}
    for st in STAGES[10:]:
        vs = []
        for i, s in enumerate(sets):
            if st not in s["stages"]:
                continue
            pi = None
            if s["tag"] is not None:
                pi = next((j for j, p in enumerate(specs) if p["tag"] == s["tag"]), None)
            if pi is None:      # untagged pairing: most similar spec title in the same stage, else a spec no stage claimed
                def lvl(x):
                    m = re.search(r"\b(?:lvl|level|lv)\s*(\d{1,3})", x.lower())
                    return int(m.group(1)) if m else None

                def score(p):
                    sc = _sim(s["clean"], p["clean"])
                    a, b = lvl(s["clean"]), lvl(p["clean"])
                    if a and b and abs(a - b) > 10:
                        sc -= 0.5
                    return sc
                free = [(j, p) for j, p in enumerate(specs) if j not in used_specs and
                        (p["tag"] is None or not any(x["tag"] == p["tag"] for x in sets))]
                cand = sorted([(j, score(p)) for j, p in free if st in p["stages"]], key=lambda x: -x[1])
                lv_match = [j for j, p in free if st in p["stages"] and lvl(p["clean"]) and lvl(s["clean"]) and abs(lvl(p["clean"]) - lvl(s["clean"])) <= 5]
                if cand and cand[0][1] >= 0.34:
                    pi = cand[0][0]
                elif lv_match:
                    pi = lv_match[0]
                else:
                    loose = [j for j, p in free if not p["stages"]]
                    if loose:
                        pi = loose[0]
            if pi is not None:
                used_specs.add(pi)
            vs.append({"set": i, "spec": pi})
        stages[st] = {"variants": vs}
    # fill gaps: a stage with no set/spec inherits the previous stage's
    prev = None
    for st in STAGES:
        v = stages[st]["variants"]
        if not v and prev:
            stages[st] = {"variants": [dict(prev)], "inherited": True}
        else:
            for x in v:
                if x["set"] is None and prev:
                    x["set"] = prev["set"]; x["setInherited"] = True
                if x["spec"] is None and prev:
                    x["spec"] = prev["spec"]; x["specInherited"] = True
        if stages[st]["variants"]:
            prev = stages[st]["variants"][0]
    # v5.1: a second tree with the same map-stage title (PoB copies) becomes one more variant of that stage
    used = {v["spec"] for st in stages.values() for v in st["variants"]}
    for j, p in enumerate(specs):
        ms = [x for x in p["stages"] if x in ("EM", "MM", "LM")]
        if j in used or not ms or stages[ms[0]].get("inherited"):
            continue
        vs = stages[ms[0]]["variants"]
        if vs and not any(v.get("setInherited") or v.get("specInherited") for v in vs):
            si = max((v["set"] for v in vs if v["set"] is not None), key=lambda i: _sim(sets[i]["clean"], p["clean"]), default=None)
            vs.append({"set": si, "spec": j}); used.add(j)
    # v5.1: a set or tree with no act / map / level meaning at all gets its own named tab (pick it by hand)
    ids, meta = list(STAGES), {st: {"label": STAGE_LABEL[st], "kind": "act" if st.startswith("A") else "map"} for st in STAGES}
    claimed_s = {v["set"] for st in stages.values() for v in st["variants"]}
    claimed_p = {v["spec"] for st in stages.values() for v in st["variants"]}
    n = 0
    for i, x in enumerate(sets):
        if x.get("titled") and not x["stages"] and i not in claimed_s:
            n += 1; tid = f"N{n}"
            pj = next((j for j, p in enumerate(specs) if not p["stages"] and j not in claimed_p and p["clean"].lower() == x["clean"].lower()), None)
            if pj is not None:
                claimed_p.add(pj)
            ids.append(tid); meta[tid] = {"label": x["clean"][:40], "kind": "named"}; stages[tid] = {"variants": [{"set": i, "spec": pj}]}
    for j, p in enumerate(specs):
        if p.get("titled") and not p["stages"] and j not in claimed_p:
            n += 1; tid = f"N{n}"
            ids.append(tid); meta[tid] = {"label": p["clean"][:40], "kind": "named"}; stages[tid] = {"variants": [{"set": None, "spec": j}]}
    return _finish(root, battr, sets, specs, "acts", ids, meta, stages)


def _finish(root, battr, sets, specs, mode, ids, meta, stages):
    assigned_sets = {v["set"] for s in stages.values() for v in s["variants"]}
    assigned_specs = {v["spec"] for s in stages.values() for v in s["variants"]}
    tv = next((p["treeVersion"] for p in specs if p["treeVersion"]), "")
    name = strip_codes((root.find("Notes").text or "").split("\n")[0])[:60] if root.find("Notes") is not None and root.find("Notes").text else ""
    cfg = {"version": 4, "name": f"{battr.get('ascendClassName') or battr.get('className') or 'Build'} (PoB)",
           "className": battr.get("className", ""), "ascendancy": battr.get("ascendClassName", ""), "level": int(battr.get("level") or 0) or None,
           "treeVersion": tv, "notes_title": name, "sets": sets, "specs": specs, "stages": stages, "active": {k: 0 for k in ids},
           "mode": mode, "stageList": ids, "stageMeta": meta,
           "unassigned": {"sets": [i for i in range(len(sets)) if i not in assigned_sets], "specs": [i for i in range(len(specs)) if i not in assigned_specs]}}
    return cfg


def summary(cfg) -> str:
    mode = cfg.get("mode", "acts")
    out = [f"{cfg['name']}: {len(cfg['sets'])} skill sets, {len(cfg['specs'])} trees (tree {cfg['treeVersion'] or '?'})."]
    if mode != "acts":
        out.append({"levels": "  No act names: one tab per level (it follows your character level; pick another tab any time).",
                    "named": "  No act names: one tab per setup, you pick which one shows.",
                    "single": "  One setup: shown for the whole campaign, no tabs."}[mode])
    for st in cfg.get("stageList") or STAGES:
        if st not in STAGES:
            vs = cfg["stages"][st]["variants"]
            parts = [f"{cfg['sets'][v['set']]['clean'] if v['set'] is not None else '-'} / tree '{cfg['specs'][v['spec']]['clean'] if v['spec'] is not None else '-'}'"
                     + (" (inherited)" if v.get("setInherited") or v.get("specInherited") else "") for v in vs]
            out.append(f"  {cfg['stageMeta'][st]['label']}: " + (" | ".join(parts) or "-"))
            continue
        vs = cfg["stages"][st]["variants"]
        if not vs:
            out.append(f"  {st:3} -"); continue
        parts = []
        for v in vs:
            s = cfg["sets"][v["set"]]["clean"] if v["set"] is not None else "-"
            p = cfg["specs"][v["spec"]]["clean"] if v["spec"] is not None else "-"
            parts.append(f"{s} / tree '{p}'" + (" (inherited)" if v.get("setInherited") or v.get("specInherited") or cfg["stages"][st].get("inherited") else ""))
        out.append(f"  {st:3} " + " | ".join(parts))
    if cfg["unassigned"]["sets"] or cfg["unassigned"]["specs"]:
        out.append("  not mapped (assign in the tracker's Build editor): " + ", ".join(
            [cfg["sets"][i]["clean"] for i in cfg["unassigned"]["sets"]] + ["tree '" + cfg["specs"][i]["clean"] + "'" for i in cfg["unassigned"]["specs"]]))
    return "\n".join(out)


# ------------------------------------------------------------------ slim tree for the page
def slim_tree(ver: str) -> dict:
    """Node positions (PoB orbit maths), kinds, names of notables/keystones/masteries, and edges (line or arc)."""
    want, ver = ver, nearest_tree(ver)
    t = json.loads((DATA / f"tree_{ver}.json").read_text(encoding="utf-8"))
    radii, spo = t["orbitRadii"], t["skillsPerOrbit"]
    a16 = [0, 30, 45, 60, 90, 120, 135, 150, 180, 210, 225, 240, 270, 300, 315, 330]
    a40 = [0, 10, 20, 30, 40, 45, 50, 60, 70, 80, 90, 100, 110, 120, 130, 135, 140, 150, 160, 170, 180, 190, 200, 210, 220, 225, 230, 240,
           250, 260, 270, 280, 290, 300, 310, 315, 320, 330, 340, 350]

    def ang(o, i):
        n = spo[o]
        if n == 16: return math.radians(a16[i % 16])
        if n == 40: return math.radians(a40[i % 40])
        return 2 * math.pi * i / n
    pos, nodes = {}, {}
    for nid, n in t["nodes"].items():
        g = t["groups"].get(str(n["g"]))
        if not g:
            continue
        a = ang(n["o"], n["i"]); r = radii[n["o"]]
        x, y = g[0] + math.sin(a) * r, g[1] - math.cos(a) * r
        pos[nid] = (x, y, a)
        e = [round(x), round(y), n["k"]]
        if n["k"] in ("n", "k", "m", "s", "j"):
            e.append(n.get("n") or "")
        nodes[nid] = e
    edges = []
    seen = set()
    for nid, n in t["nodes"].items():
        if nid not in pos:
            continue
        for o in n.get("out") or []:
            o = str(o)
            if o not in pos or (min(nid, o), max(nid, o)) in seen:
                continue
            m = t["nodes"][o]
            if n["k"] == "s" or m["k"] == "s" or n["k"] == "m" or m["k"] == "m":
                if not (n["k"] == "s" or m["k"] == "s"):
                    continue
            seen.add((min(nid, o), max(nid, o)))
            if n["g"] == m["g"] and n["o"] == m["o"] and n["o"] > 0:
                d = (pos[o][2] - pos[nid][2]) % (2 * math.pi)
                sweep = 1 if d <= math.pi else 0
                edges.append([int(nid), int(o), radii[n["o"]], sweep])
            else:
                edges.append([int(nid), int(o)])
    starts = {str(c): nid for nid, n in t["nodes"].items() if n.get("k") == "s" for c in ([n.get("cs")] if not isinstance(n.get("cs"), list) else n["cs"])}
    return {"v": ver, "requested": want, "nodes": nodes, "edges": edges, "starts": starts, "classes": t.get("classes")}


def nearest_tree(ver: str) -> str:
    """v5.1: a PoB made on another patch (3_27, 3_28) uses the closest tree we ship; node ids barely change between patches."""
    have = sorted(p.stem[5:] for p in DATA.glob("tree_*.json"))
    if ver in have or not have:
        return ver
    key = lambda v: tuple(int(x) for x in re.findall(r"\d+", v)) or (0,)
    w = key(ver)
    return min(have, key=lambda v: (abs((key(v)[0] - w[0]) * 100 + (key(v)[1:2] or (0,))[0] - (w[1:2] or (0,))[0]), -key(v)[-1]))


def stats_for(ver: str, ids):
    t = json.loads((DATA / f"tree_{nearest_tree(ver)}.json").read_text(encoding="utf-8"))
    return {str(i): t["nodes"][str(i)].get("st") for i in ids if str(i) in t["nodes"] and t["nodes"][str(i)].get("st")}


if __name__ == "__main__":
    import sys
    src = Path(sys.argv[1]).read_text(encoding="utf-8") if len(sys.argv) > 1 and Path(sys.argv[1]).exists() else sys.argv[1]
    print(summary(import_build(src)))
