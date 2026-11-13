"""v5.3 intents (from the author's Act 1-2 playtest, 2026-11-13): confirm phrasings, lab trials (a trial is not the lab),
corrections, timer reset, more wiki-link phrasings, Fate reward questions, where-am-I chatter and boss kills."""
from __future__ import annotations

import re

FUZZ = None        # set by companion (rapidfuzz.fuzz or its fallback)
FILL = r"^(?:(?:okay|ok|alright|all right|right|so|um|uh|and|hey|well|yeah|yep|now)[,\s]+)*"

# ------------------------------------------------------------------ confirm
CONFIRM2 = FILL + r"(?:yes\s+|yeah\s+)?(?:confirmed|confirm(?:ed)? (?:it|that|those|the read|the scan)|apply (?:it|that)|that looks good|looks right|looks correct)(?:\s+please|\s+thanks)?$"

# ------------------------------------------------------------------ lab trials (normal lab: 6 trials, acts 1-3; unchanged in 3.29/3.30)
TRIALS = [
    ("lower_prison", "The Lower Prison", 1, ["lower prison", "prison"]),
    ("crypt", "The Crypt", 2, ["crypt", "the crypt"]),
    ("chamber_of_sins", "The Chamber of Sins", 2, ["chamber of sins", "chamber of sin", "chamber of sends", "chamber of sense", "chambers of sins", "chamber"]),
    ("crematorium", "The Crematorium", 3, ["crematorium"]),
    ("catacombs", "The Catacombs", 3, ["catacombs", "catacomb"]),
    ("imperial_gardens", "The Imperial Gardens", 3, ["imperial gardens", "imperial garden", "gardens"]),
]


def trial_id(s: str) -> str:
    best, bl = "", 0
    for tid, _n, _a, al in TRIALS:
        for a in al:
            if re.search(r"\b" + re.escape(a) + r"\b", s) and len(a) > bl:
                best, bl = tid, len(a)
    if not best and FUZZ:
        for tid, _n, _a, al in TRIALS:
            for a in al:
                for m in re.finditer(r"\b\w+(?:\s+\w+){0,2}\b", s):
                    if len(a) >= 6 and FUZZ.ratio(m.group(0), a) >= 85 and len(a) > bl:
                        best, bl = tid, len(a)
    return best


def parse_trial(s: str):
    if not re.search(r"\btrials?\b", s):
        return None
    if re.search(r"\b(missed|skipped|forgot|didn t do|did not do|no)\b.*\btrial\b|\btrial\b.*\b(missed|skipped)\b", s):
        return {"type": "trial", "op": "missed", "trial": trial_id(s)}
    if re.search(r"\b(done|complete|completed|finished|got|did)\b", s) or re.search(r"\btrial\b\s*$", s):
        return {"type": "trial", "op": "done", "trial": trial_id(s)}
    return None


# corrections: "no, not normal lab (, just X lab trial)", "normal lab was not done", "unmark normal lab"
def parse_correction(s: str):
    m = re.search(r"\b(?:not|wasn t|was not|isn t|is not|didn t|did not|unmark|undo)\b.*?\b(normal|cruel|merciless|uber)?\s*lab\b|\b(normal|cruel|merciless)\s+lab\s+(?:was|is)\s+not\b|\b(normal|cruel|merciless)\s+lab\s+(?:wasn t|isn t)\b", s)
    if not m or not re.search(r"\b(no|not|wasn t|isn t|didn t|unmark|undo)\b", s):
        return None
    if re.search(r"\b(go|going|do|doing|run|running)\b", s) and not re.search(r"\b(done|marked)\b", s) and not re.match(FILL + r"no\b", s):
        return None
    lab = next((g for g in m.groups() if g), "normal")
    out = [{"type": "unmark", "lab": lab}]
    t = trial_id(s)
    if t and re.search(r"\btrial\b", s):
        out.append({"type": "trial", "op": "done", "trial": t})
    return out


# ------------------------------------------------------------------ timer reset / new run
TIMER_RESET = FILL + r"(?:let s\s+|let us\s+|please\s+)?(?:restart|reset|start over|redo)\s+(?:the\s+)?(?:league\s+|campaign\s+|run\s+)?(?:timer|clock|run)(?:\s+please)?$|" + FILL + r"(?:start\s+(?:a\s+)?)?new run(?:\s+please)?$|" + FILL + r"start (?:the\s+)?(?:timer|run|campaign) over$"

# ------------------------------------------------------------------ wiki links
_WL = r"(?:get|give|send|grab|show|find|pull(?:\s+up)?|copy|fetch|research|look up)?\s*(?:me\s+)?(?:the\s+|a\s+)?"
WIKI3 = [
    FILL + r"(?:pull|grab|get|give me|fetch|research)\s+(?:the\s+|a\s+)?(?:wiki\s+)?link\s+(?:for|to|on|of)\s+(.+)$",
    FILL + r"link\s+(?:for|to)\s+(.+)$",
    FILL + r"(?:research|look up)\s+(?:the\s+)?(?:wiki\s+)?link\s+(?:for|to|on|of)\s+(.+)$",
    FILL + r"wiki\s+(?!link\b|links\b|search\b|for\b|about\b|on\b)(.+)$",
]


def clean_wiki_query(q: str):
    q = re.sub(r"[\s.,!?]+$", "", q.strip())
    q = re.sub(r"\s+(?:please|thanks|thank you)$", "", q, flags=re.I)
    card = bool(re.search(r"\s(?:divination\s+)?card$", q, re.I))
    q = re.sub(r"\s+(?:divination\s+)?card$", "", q, flags=re.I)
    q = re.sub(r"^(?:the\s+)?(?:wiki\s+)?(?:page\s+)?(?:for|on|about)\s+", "", q, flags=re.I)
    if not card:
        q = re.sub(r"^the\s+", "", q, flags=re.I)       # keep "The" for cards ("The Wolf", "The Doctor")
    return q.strip(), card


def parse_wiki3(raw: str, s: str):
    r = re.sub(r"\s+", " ", (raw or "").strip()).strip(" .!?")
    rl = r.lower()
    for i, rx in enumerate(WIKI3):
        m = re.match(rx, rl)
        if not m:
            continue
        q0 = r[m.start(1):m.end(1)]
        if i == 3 and re.match(r"^(what|how|where|who|which|when|why|is|are|does|do)\b", q0, re.I):
            return None          # "wiki what drops X" stays research
        q, card = clean_wiki_query(q0)
        if len(q) < 2:
            return {"type": "wiki_link", "query": ""}
        out = {"type": "wiki_link", "query": q[:80]}
        if card:
            out["card"] = True
        return out
    return None


# ------------------------------------------------------------------ Fate reward questions
FATE_Q = [
    r"^(?:what s|what is|whats|what are)\s+(?:the\s+)?(?:fate\s+|fate boss\s+)?(?:reward|rewards)\s+(?:for|from|of)\s+(?:the\s+)?(.+)$",
    r"^what (?:fate|fates|reward|rewards) (?:does|do|will) (?:the\s+)?(.+?) (?:give|drop|have)(?: me)?$",
    r"^(?:what s|what is|whats|what are)\s+(?:the\s+)?(?:fate|faith)\s*boss(?:es)?\s+(?:reward|rewards)\s+(?:for|from|of)\s+(?:the\s+)?(.+)$",
]


def parse_fate_q(s: str):
    s2 = re.sub(FILL, "", s)
    for rx in FATE_Q:
        m = re.match(rx, s2)
        if m:
            boss = re.sub(r"\b(please|now|again)\b", "", m.group(1)).strip(" ,.")
            boss = re.sub(r"^(?:the\s+)", "", boss)
            if not boss or re.fullmatch(r"(it|this|that|him|her|this boss|that boss|my|me|bosses|all)", boss):
                return {"type": "query", "what": "fate_info", "boss": "", "open": False}
            return {"type": "query", "what": "fate_info", "boss": boss, "open": True, "strict": True}
    return None


# ------------------------------------------------------------------ areas (acts 1-3) and campaign bosses
AREAS = [
    (1, "The Twilight Strand", ["twilight strand", "strand"]), (1, "Lioneye's Watch", ["lioneye s watch", "lioneyes watch", "lioneye watch"]),
    (1, "The Coast", ["coast"]), (1, "The Mud Flats", ["mud flats", "mudflats"]), (1, "The Tidal Island", ["tidal island"]),
    (1, "The Submerged Passage", ["submerged passage"]), (1, "The Flooded Depths", ["flooded depths"]), (1, "The Ledge", ["ledge"]),
    (1, "The Climb", ["climb"]), (1, "The Lower Prison", ["lower prison", "prison"]), (1, "The Upper Prison", ["upper prison"]),
    (1, "Prisoner's Gate", ["prisoner s gate", "prisoners gate"]), (1, "The Ship Graveyard", ["ship graveyard"]),
    (1, "The Ship Graveyard Cave", ["ship graveyard cave"]), (1, "The Cavern of Wrath", ["cavern of wrath"]), (1, "The Cavern of Anger", ["cavern of anger"]),
    (2, "The Southern Forest", ["southern forest"]), (2, "The Forest Encampment", ["forest encampment"]), (2, "The Old Fields", ["old fields"]),
    (2, "The Crossroads", ["crossroads"]), (2, "The Den", ["the den"]), (2, "The Riverways", ["riverways", "riverway"]),
    (2, "The Western Forest", ["western forest"]), (2, "The Weaver's Chambers", ["weaver s chambers", "weavers chambers", "weaver chambers"]),
    (2, "The Wetlands", ["wetlands"]), (2, "The Vaal Ruins", ["vaal ruins"]), (2, "The Northern Forest", ["northern forest"]),
    (2, "The Caverns", ["the caverns"]), (2, "The Ancient Pyramid", ["ancient pyramid", "pyramid"]), (2, "The Chamber of Sins", ["chamber of sins"]),
    (2, "The Crypt", ["crypt"]), (2, "The Broken Bridge", ["broken bridge"]), (2, "The Fellshrine Ruins", ["fellshrine ruins", "fellshrine"]),
    (3, "The City of Sarn", ["city of sarn"]), (3, "The Sarn Encampment", ["sarn encampment"]), (3, "The Slums", ["slums"]),
    (3, "The Crematorium", ["crematorium"]), (3, "The Sewers", ["sewers"]), (3, "The Marketplace", ["marketplace"]),
    (3, "The Catacombs", ["catacombs"]), (3, "The Battlefront", ["battlefront"]), (3, "The Docks", ["the docks"]),
    (3, "The Solaris Temple", ["solaris temple"]), (3, "The Ebony Barracks", ["ebony barracks"]), (3, "The Lunaris Temple", ["lunaris temple"]),
    (3, "The Imperial Gardens", ["imperial gardens"]), (3, "The Library", ["the library"]), (3, "The Archives", ["archives"]),
    (3, "The Sceptre of God", ["sceptre of god", "scepter of god"]), (3, "The Upper Sceptre of God", ["upper sceptre of god", "upper scepter of god"]),
]
# campaign bosses (acts 1-10, the ones people call out); spoken mangles from the 2026-11-13 test map in by fuzzy match
BOSSES = ["Hillock", "Brutus", "Captain Fairgraves", "Merveil", "Fidelitas", "The Weaver", "The Great White Beast", "Oak", "Kraityn", "Alira",
          "Vaal Oversoul", "Chetus", "Piety", "Dominus", "Gravicius", "General Gravicius", "Daresso", "Kaom", "Malachai", "Voll", "Kitava",
          "Shavronne", "Doedre", "Maligaro", "Brine King", "Tolman", "Arakaali", "Lunaris", "Solaris", "Avarius", "Innocence", "Garukhan",
          "Tukohama", "Abberath", "Ralakesh", "Shakari", "Yugul", "Kosis", "Omniphobia", "Calaf", "Ryslatha", "Tsoagoth", "Jorgin"]
_BOSS_ALIASES = {"fair graves": "Captain Fairgraves", "fairgraves": "Captain Fairgraves", "captain fair graves": "Captain Fairgraves",
                 "hilluck": "Hillock", "hillock": "Hillock", "fadeletus": "Fidelitas", "fidelitas": "Fidelitas", "fedelitas": "Fidelitas",
                 "great white beast": "The Great White Beast", "merveil": "Merveil", "mervail": "Merveil", "merveille": "Merveil", "weaver": "The Weaver",
                 "brine king": "Brine King", "vaal oversoul": "Vaal Oversoul", "oversoul": "Vaal Oversoul"}


def boss_of(name: str, min_score: int = 80) -> str:
    n = re.sub(r"^(?:the|captain|general)\s+", "", re.sub(r"[^\w\s]", " ", name.lower())).strip()
    n = re.sub(r"\s+", " ", n)
    if not n:
        return ""
    if n in _BOSS_ALIASES:
        return _BOSS_ALIASES[n]
    best, bs = "", 0
    for b in BOSSES:
        for cand in {b.lower(), re.sub(r"^(?:the|captain|general)\s+", "", b.lower())}:
            sc = 100 if n == cand else (FUZZ.ratio(n, cand) if FUZZ and len(n) >= 4 else 0)
            if sc > bs:
                best, bs = b, sc
    for a, b in _BOSS_ALIASES.items():
        sc = FUZZ.ratio(n, a) if FUZZ and len(n) >= 4 else 0
        if sc > bs:
            best, bs = b, sc
    return best if bs >= min_score else ""


def area_of(s: str):
    best, bl = None, 0
    for act, name, al in AREAS:
        for a in al:
            if re.search(r"\b" + re.escape(a) + r"\b", s) and len(a) > bl:
                best, bl = (act, name), len(a)
    return best


_KILL = r"(?:down|dead|is dead|s dead|killed|is down|s down|done|defeated|dies|died|is done)"


def parse_boss_area(s: str):
    s2 = re.sub(FILL, "", s).strip()
    # "<boss> down / is dead / killed", "killed <boss>", bare "<boss>" (ASR "Fadeletus.")
    m = re.match(r"^(?:log\s+)?(?:we\s+)?(?:killed|beat|downed)\s+(?:the\s+)?(.+?)$", s2) or re.match(r"^(?:log\s*)?(.+?)\s+" + _KILL + r"$", s2)
    if m:
        b = boss_of(m.group(1))
        if b:
            return {"type": "boss_down", "boss": b}
    if len(s2.split()) <= 3:
        b = boss_of(s2, 86)
        if b:
            return {"type": "boss_down", "boss": b}
    m = re.match(r"^(?:we re |we are |i m |i am )?(?:fighting|at|vs|versus)\s+(?:the\s+)?(.+?)(?:\s+now)?$", s2)
    if m and m.group(1).split()[0] not in ("the", "a"):
        b = boss_of(m.group(1), 85)
        if b:
            return {"type": "area", "boss": b}
    m = re.match(r"^(?:we re |we are |i m |i am |now )?(?:in|at|entering|entered|into|heading to|going to|on)\s+(?:the\s+)?(.+?)(?:\s+now)?$", s2)
    if m:
        ar = area_of(" " + m.group(1) + " ")
        if ar:
            return {"type": "area", "area": ar[1], "act": ar[0]}
    return None


def parse_v53(raw: str, s: str):
    """raw = transcript, s = companion.normalise(raw). Returns a list of actions or None."""
    s = re.sub(r"\s+", " ", re.sub(r"[^\w\s]", " ", s.lower())).strip()
    if re.fullmatch(CONFIRM2, s):
        return [{"type": "ocr", "what": "confirm"}]
    if re.fullmatch(TIMER_RESET, s):
        return [{"type": "timer_reset"}]
    c = parse_correction(s)
    if c:
        return c
    t = parse_trial(s)
    if t:
        return [t]
    w = parse_wiki3(raw, s)
    if w:
        return [w]
    f = parse_fate_q(s)
    if f:
        return [f]
    b = parse_boss_area(s)
    if b:
        return [b]
    return None
