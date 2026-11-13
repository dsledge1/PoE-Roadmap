"""v5 voice intents (Nov 13, 2026): pace targets, text size, "get wiki link for X", "what am I watching for in Abyss".
Pure text parsing; nothing here touches the game. companion.parse() calls parse_v5() before the older intents."""
from __future__ import annotations

import re

FILL = r"^(?:(?:okay|ok|hey|please|so|um|uh|and|alright|right|now)[,\s]+)*(?:(?:can|could|would) you\s+)?(?:please\s+)?"

# ------------------------------------------------------------------ pace targets
PRESET_WORDS = [
    ("league", r"league(?:\s+start)?|league\s+starter|first\s+char(?:acter)?|main(?:\s+char(?:acter)?)?|normal|default|standard|six\s+to\s+eight|6\s+to\s+8"),
    ("alt", r"alt|alts|alternate|alternative|alt\s+char(?:acter)?|second\s+char(?:acter)?|third\s+char(?:acter)?|reroll|re\s+roll"),
    ("speed", r"speed\s*run|speedrun|speedrunning|speed\s+running|race|racing|fast"),
    ("custom", r"custom"),
]
_PACE_HEAD = r"(?:set\s+(?:the\s+|my\s+)?pace(?:\s+target)?(?:\s+(?:to|as))?|pace(?:\s+target)?(?:\s+(?:to|is))?|use\s+(?:the\s+)?|switch\s+(?:the\s+)?pace\s+to|switch\s+to|change\s+(?:the\s+)?pace\s+to)"
_NUMW = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10, "twelve": 12}


def _hours(s: str):
    """'4 hours' -> 240, '3 and a half hours' -> 210, '4 hours 30' / '4 hours and 30 minutes' -> 270, '4:30' -> 270,
    '3.5 hours' -> 210, '250 minutes' -> 250. None if no duration."""
    s = re.sub(r"\b(" + "|".join(_NUMW) + r")\b", lambda m: str(_NUMW[m.group(1)]), s.lower())
    s = s.replace("an hour and a half", "1.5 hours").replace("a half", "half")
    m = re.search(r"\b(\d{1,2}):(\d{2})\b", s)
    if m:
        return int(m.group(1)) * 60 + int(m.group(2))
    m = re.search(r"\b(\d{1,3})\s*(?:minutes|mins?)\b", s)
    h = re.search(r"\b(\d{1,2}(?:\.\d+)?)\s*(?:(?:and\s+)?(half|a\s+quarter|quarter|three\s+quarters?))?\s*(?:hours?|hrs?|h)\b", s)
    if h:
        tot = float(h.group(1)) * 60
        frac = h.group(2) or ""
        tot += 30 if "half" in frac else 45 if "three" in frac else 15 if "quarter" in frac else 0
        rest = s[h.end():]
        mm = re.match(r"\s*(?:and\s+)?(\d{1,2})(?:\s*(?:minutes|mins?))?\b", rest)
        if mm:
            tot += int(mm.group(1))
        return round(tot)
    if m:
        return int(m.group(1))
    return None


def parse_pace(s: str, raw: str = ""):
    r = re.sub(r"\s+", " ", s.strip(" .!?")).lower()
    if not re.search(r"\bpace\b|\bspeed\s*run|\balt\s+char", r):
        return None
    if re.search(r"\b(how|what|am i|are we)\b", r) and not re.search(r"\b(set|target|switch|change|use)\b", r):
        return None                                   # "how is my pace" stays the pace question
    m = re.match(FILL + _PACE_HEAD + r"\s*(.+)$", r)
    if not m:
        m = re.match(FILL + r"(?:i am |i'm )?(?:on |playing )?(?:an? |my )?(.+?)\s+pace$", r)   # "alt pace", "speedrun pace"
    if not m:
        return None
    rest = m.group(1).strip()
    mins = _hours(rest)
    if mins is None and raw:
        mm = re.search(r"\b(\d{1,2}):(\d{2})\b", raw)
        mins = int(mm.group(1)) * 60 + int(mm.group(2)) if mm else None
    if mins is not None and 60 <= mins <= 1200:
        return {"type": "pace_cfg", "total": mins}
    rest = re.sub(r"^(?:the\s+|an?\s+)", "", rest)
    rest = re.sub(r"\s+(?:pace|preset|target|mode|please)$", "", rest).strip()
    for key, pat in PRESET_WORDS:
        if re.fullmatch(rf"(?:{pat})(?:\s+(?:pace|preset|target|mode))?", rest):
            return {"type": "pace_cfg", "preset": key}
    return None


# ------------------------------------------------------------------ text size
def parse_text_size(s: str):
    r = re.sub(r"\s+", " ", s.strip(" .!?")).lower()
    if not re.search(r"\b(text|font|letters|writing|words)\b", r):
        return None
    m = re.match(FILL + r"(?:set\s+)?(?:the\s+)?(?:text|font)(?:\s+size)?\s+(?:to\s+)?(\d{2,3})(?:\s*(?:percent|%))?$", r)
    if m:
        return {"type": "text_size", "pct": int(m.group(1))}
    if re.match(FILL + r"(?:reset|normal|default)\s+(?:the\s+)?(?:text|font)(?:\s+size)?$|^(?:text|font)(?:\s+size)?\s+(?:normal|default|reset)$", r):
        return {"type": "text_size", "pct": 100}
    if re.match(FILL + r"(?:make\s+(?:the\s+)?(?:text|font|letters|writing|words)\s+)?(?:bigger|larger|large|increase)(?:\s+(?:the\s+)?(?:text|font)(?:\s+size)?)?(?:\s+please)?$", r) \
            or re.match(FILL + r"(?:bigger|larger)\s+(?:text|font)$|^(?:text|font)\s+(?:bigger|larger|up)$|^(?:zoom in|increase (?:the )?(?:text|font)(?: size)?)$", r):
        return {"type": "text_size", "step": 1}
    if re.match(FILL + r"(?:make\s+(?:the\s+)?(?:text|font|letters|writing|words)\s+)?(?:smaller|tinier|decrease|shrink)(?:\s+(?:the\s+)?(?:text|font)(?:\s+size)?)?(?:\s+please)?$", r) \
            or re.match(FILL + r"(?:smaller)\s+(?:text|font)$|^(?:text|font)\s+(?:smaller|down)$|^(?:zoom out|decrease (?:the )?(?:text|font)(?: size)?)$", r):
        return {"type": "text_size", "step": -1}
    return None


# ------------------------------------------------------------------ wiki link
WIKI_LINK_RE = (FILL + r"(?:get|give|send|grab|show|find|pull(?:\s+up)?|copy|fetch)?\s*(?:me\s+)?(?:the\s+|a\s+)?"
                r"(?:poe\s*)?(?:wiki|poewiki|poe\s+wiki|poedb)\s+(?:link|links|url|page\s+link|address)s?\s*(?:for|to|on|of|about)?\s*[:,]?\s*(?:the\s+)?(.+)$")
WIKI_LINK_RE2 = FILL + r"(?:link|links)\s+(?:me\s+)?(?:to\s+)?(?:the\s+)?(?:wiki|poewiki)\s+(?:page\s+)?(?:for|on|about|of)\s+(?:the\s+)?(.+)$"


def parse_wiki_link(raw: str):
    r = re.sub(r"\s+", " ", (raw or "").strip()).strip(" .!?")
    if re.fullmatch(FILL + r"(?:get|give|send|grab|show|find|copy|fetch)?\s*(?:me\s+)?(?:the\s+|a\s+)?(?:poe\s*)?(?:wiki|poewiki|poedb)\s+(?:link|url)s?", r, re.I):
        return {"type": "wiki_link", "query": ""}          # "get wiki link" with no name: ask for one
    m = re.match(WIKI_LINK_RE, r, re.I) or re.match(WIKI_LINK_RE2, r, re.I)
    if not m:
        return None
    q = m.group(1).strip(" .,:;!?\"'“”")
    q = re.sub(r"\s+(?:please|thanks|thank you)$", "", q, flags=re.I).strip()
    q = re.sub(r"^(?:the\s+)?(?:wiki\s+)?(?:page\s+)?(?:for|on|about)\s+", "", q, flags=re.I).strip()
    if not q or len(q) < 2:
        return {"type": "wiki_link", "query": ""}
    return {"type": "wiki_link", "query": q[:80]}


# ------------------------------------------------------------------ Power Chase by content type
_WATCH = r"(?:watching|looking|watch|look|farming|hunting|hunt|farm|chasing|chase|keeping an eye out)"
CHASE_FOR = [
    FILL + rf"(?:what|which)(?:\s+(?:items?|stuff|things?|uniques?))?\s+(?:am i|are we|should i be|do i)\s+{_WATCH}(?:\s+out)?\s+for\s+(?:in|from|at|while\s+(?:i\s+am\s+|i'm\s+)?(?:farming|running|doing|in))\s+(?:the\s+)?(.+)$",
    FILL + rf"(?:what|which)(?:\s+(?:items?|stuff|things?))?\s+(?:am i|are we|should i be|do i)\s+{_WATCH}(?:\s+out)?\s+for\s+(?:in|from)?\s*(?:the\s+)?(.+?)\s+(?:content|league mechanic|mechanic)$",
    FILL + rf"(?:i am|i'm|we are|we're)\s+(?:going to |gonna |about to )?(?:farm|farming|run|running|do|doing)\s+(?:some\s+)?(?:the\s+)?(.+?)\s*,?\s*(?:what|which)(?:\s+items?)?\s+(?:am i|should i be|do i|are we)\s+{_WATCH}(?:\s+out)?\s+for$",
    FILL + r"(?:power\s+)?chase\s+(?:items?\s+)?(?:for|in|from)\s+(?:the\s+)?(.+)$",
    FILL + r"(?:what|which)(?:\s+(?:chase\s+)?items?)?\s+(?:can i|do i|could i)\s+(?:get|find|farm)\s+(?:in|from)\s+(?:the\s+)?(.+)$",
    FILL + r"(?:what\s+is\s+)?(?:on\s+)?(?:my\s+)?(?:power\s+)?chase\s+list\s+(?:for|in|from)\s+(?:the\s+)?(.+)$",
]


def parse_chase_for(s: str):
    r = re.sub(r"\s+", " ", s.strip(" .!?")).lower()
    for pat in CHASE_FOR:
        m = re.match(pat, r)
        if m:
            c = re.sub(r"\s+(?:please|right now|now|today|tonight)$", "", m.group(1).strip(" ,.")).strip()
            c = re.sub(r"^(?:some|the)\s+", "", c)
            if c and len(c) <= 40 and not re.search(r"\b(left|done|remaining)\b", c):
                return {"type": "query", "what": "chase", "content": c, "watch": True}
    return None


# ------------------------------------------------------------------ v5.1: switch the Links & tree stage by voice
_TREE = r"(?:tree|trees|stage|setup|build stage|skill tree|passive tree|pob tab|tab)"


def parse_tree_nav(s: str):
    r = re.sub(r"\s+", " ", s.strip(" .!?")).lower()
    if not re.search(r"\b(tree|stage|setup|tab)\b", r):
        return None
    if re.match(FILL + rf"(?:go\s+to\s+(?:the\s+)?|show\s+(?:me\s+)?(?:the\s+)?|switch\s+to\s+(?:the\s+)?)?next\s+{_TREE}$", r):
        return {"type": "tree_nav", "dir": 1}
    if re.match(FILL + rf"(?:go\s+to\s+(?:the\s+)?|show\s+(?:me\s+)?(?:the\s+)?|switch\s+to\s+(?:the\s+)?)?(?:previous|prev|last)\s+{_TREE}$", r) or \
            re.match(FILL + rf"(?:go\s+)?back\s+(?:one|a)\s+{_TREE}$", r):
        return {"type": "tree_nav", "dir": -1}
    if re.match(FILL + rf"(?:(?:go\s+)?back\s+to\s+(?:the\s+)?)?(?:current|auto|automatic)\s+{_TREE}$|^(?:show\s+(?:me\s+)?)?my\s+(?:current\s+)?{_TREE}$|^{_TREE}\s+(?:back\s+to\s+)?(?:auto|current)$", r):
        return {"type": "tree_nav", "auto": True}
    m = re.match(FILL + rf"(?:show|open|switch(?:\s+the)?\s+{_TREE}\s+to|switch\s+to|go\s+to|use)\s+(?:me\s+)?(?:the\s+)?(?:{_TREE}\s+(?:for\s+|called\s+)?)?(.+?)(?:\s+{_TREE})?$", r)
    if m and re.search(rf"\b{_TREE}\b", r):
        name = m.group(1).strip(" ,.")
        if name and not re.fullmatch(r"(?:my|the|a|next|previous)", name) and len(name) <= 40:
            return {"type": "tree_nav", "name": name}
    return None


def parse_v5(raw: str, s: str):
    """raw = transcript, s = companion.normalise(raw). Returns one action or None."""
    return parse_wiki_link(raw) or parse_text_size(s) or parse_pace(s, raw) or parse_chase_for(s) or parse_tree_nav(s)
