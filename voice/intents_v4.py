"""v4 voice intents (pure functions, no I/O except reading the default type list and the Fate cache).

- custom drop / event types: "add drop type five link", "delete event type boss down", plus matching what
  he says ("dropped a 4 link", "found a 5 link") against the character's own types (synced from the page)
- Power Chase: "chase done Darkness Enthroned", "add chase item Shavronne's Wrappings from Delve", "what's left on my chase"
- Fate boss lookups: "fate boss Merveil", "pull up the Fate boss from Merveil", "what does Merveil give"
- link follow-ups ("main attack links only" right after a links question), news questions, "yes" to a look-up offer
"""
from __future__ import annotations

import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
NORM = None          # companion.normalise (set by companion at import; avoids a circular import)
FUZZ = None          # rapidfuzz.fuzz or the difflib fallback (set by companion)

FILL = r"^(?:(?:okay|ok|hey|please|so|um|uh|and|alright|right)[,\s]+)*(?:(?:can|could|would) you\s+)?(?:please\s+)?"


def _norm(s: str) -> str:
    return NORM(s) if NORM else re.sub(r"\s+", " ", s.lower()).strip()


def ckey(s: str) -> str:
    """Comparison key for type names / aliases and what he said: numbers as digits, 4l / 4-link / four linked -> '4 link'."""
    s = _norm(s or "")
    s = re.sub(r"[^\w\s/+]", " ", s)
    s = re.sub(r"\b(?:for|fore)\s+(?=(?:link|links|linked|l|socket|sockets)\b)", "4 ", s)
    s = re.sub(r"\b([1-6])\s?l\b", r"\1 link", s)
    s = re.sub(r"\b([1-6])\s?s\b", r"\1 socket", s)
    s = re.sub(r"\b(?:links|linked|linker)\b", "link", s)
    s = re.sub(r"\b(?:sockets|socketed)\b", "socket", s)
    s = re.sub(r"\bcolou?rs?\b", "colours", s)
    s = re.sub(r"\bvisceras\b", "viscera", s)
    s = re.sub(r"\bcards\b", "card", s)
    s = re.sub(r"\buniques\b", "unique", s)
    return re.sub(r"\s+", " ", s).strip()


# ------------------------------------------------------------------ custom types
def load_default_types():
    try:
        return json.loads((HERE / "default_types.json").read_text(encoding="utf-8"))["types"]
    except Exception:  # noqa: BLE001
        return []


DEFAULT_TYPES = load_default_types()
TYPES = list(DEFAULT_TYPES)


def set_types(types):
    """The page syncs the current character's list (POST /api/custom_types)."""
    global TYPES
    clean = []
    for t in types or []:
        if not isinstance(t, dict) or not str(t.get("name", "")).strip():
            continue
        clean.append({"id": str(t.get("id") or ""), "name": str(t["name"])[:80], "kind": "event" if t.get("kind") == "event" else "drop",
                      "aliases": [str(a)[:80] for a in (t.get("aliases") or []) if str(a).strip()][:20],
                      **({"builtin": str(t["builtin"])} if t.get("builtin") else {}),
                      **({"named": list(t["named"])} if isinstance(t.get("named"), list) else {})})
    TYPES = clean
    return len(clean)


HYPO = r"\b(not|no|never|need|needs|needed|missing|without|want|wanted|wish|hope|hoping|looking for|if|going to|gonna|about to|would|could|chance|any)\b"


def match_custom(clause: str, builtin: bool = False):
    """Best type whose name or alias is said as whole words; the longest alias wins ('4 link with the right colours' > '4 link')."""
    k = " " + ckey(clause) + " "
    best = None
    for t in TYPES:
        if bool(t.get("builtin")) != builtin:
            continue
        for a in [t["name"]] + list(t.get("aliases") or []):
            ak = ckey(a)
            if len(ak) < 2 or f" {ak} " not in k:
                continue
            if best is None or len(ak) > best[0]:
                best = (len(ak), t)
    if not best:
        return None
    t = best[1]
    if t.get("kind", "drop") == "drop" and re.search(HYPO, re.sub(r" no (?:way|freaking way|shot) ", " ", k)):
        return None          # "I need a 5 link", "if I find a 6 link" never log
    return t


def custom_action(t, clause, item=None):
    text = t.get("builtin") or t["name"]
    act = {"type": "log", "text": text, "kind": t.get("kind", "drop"), "custom": t.get("id", ""), "detail": clause}
    named = t.get("named")
    if named and item and item.get("confidence") == "high" and item.get("kind") in named and ckey(item["name"]) != ckey(t["name"]):
        act["text"] = f"{t['name']}: {item['name']}"
        act["match"] = item
    return act


def _clean_name(s: str) -> str:
    s = re.sub(r"^[\"'“‘]+|[\"'”’]+$", "", s.strip().strip(" .!?,:")).strip()
    return (s[:1].upper() + s[1:])[:60]


def parse_type_cmd(raw: str):
    r = re.sub(r"\s+", " ", (raw or "").strip()).strip(" .!?")
    m = re.match(FILL + r"(?:add|create|make|new)\s+(?:a\s+)?(?:new\s+)?(drop|event)\s+type\s*(?:called\s+|named\s+|for\s+)?[:,]?\s*(.+)$", r, re.I)
    if m:
        return {"type": "custom_type", "op": "add", "kind": m.group(1).lower(), "name": _clean_name(m.group(2))}
    m = re.match(FILL + r"(?:delete|remove)\s+(?:the\s+)?(?:(drop|event)\s+)?type\s*[:,]?\s*(.+)$", r, re.I)
    if m:
        return {"type": "custom_type", "op": "delete", "kind": (m.group(1) or "").lower(), "name": _clean_name(m.group(2))}
    m = re.match(FILL + r"rename\s+(?:the\s+)?(?:(drop|event)\s+)?type\s+(.+?)\s+to\s+(.+)$", r, re.I)
    if m:
        return {"type": "custom_type", "op": "rename", "kind": (m.group(1) or "").lower(), "name": _clean_name(m.group(2)), "to": _clean_name(m.group(3))}
    m = re.match(FILL + r"add\s+(?:the\s+)?(?:alias|nickname)\s+(.+?)\s+to\s+(?:the\s+)?(?:(drop|event)\s+)?type\s+(.+)$", r, re.I)
    if m:
        return {"type": "custom_type", "op": "alias", "kind": (m.group(2) or "").lower(), "name": _clean_name(m.group(3)), "alias": m.group(1).strip(" \"'")}
    return None


# ------------------------------------------------------------------ Power Chase
CHASE = r"(?:power\s+)?chase"
_DONE = r"(done|complete|completed|finished|got|obtained|checked|check|ticked|tick)"
_UNDONE = r"(undo|undone|not done|uncheck|untick|reopen|open)"


def _split_content(s: str):
    m = re.match(r"^(.+)\s+(?:from|in|via|through|out of)\s+(?:the\s+)?(.+)$", s, re.I)
    if m and len(m.group(2).split()) <= 4:
        return m.group(1).strip(" ,"), m.group(2).strip(" ,")
    return s.strip(" ,"), ""


def parse_chase_cmd(raw: str):
    r = re.sub(r"\s+", " ", (raw or "").strip()).strip(" .!?")
    m = re.match(FILL + rf"(?:add|put)\s+(?:a\s+|an\s+)?(?:new\s+)?{CHASE}(?:\s+item)?\s*[:,]?\s*(.+)$", r, re.I) \
        or re.match(FILL + rf"add\s+(.+?)\s+to\s+(?:my\s+|the\s+)?{CHASE}(?:\s+list)?(?:\s+(?:from|in|via|through)\s+(?:the\s+)?(.+))?$", r, re.I)
    if m:
        item, content = _split_content(m.group(1))
        if m.lastindex and m.lastindex >= 2 and m.group(2):
            content = m.group(2).strip(" ,")
        cm = re.match(rf"^(.+?)\s+to\s+(?:my\s+|the\s+)?{CHASE}(?:\s+list)?$", item, re.I)   # "add X from Delve to my chase"
        if cm:
            item = cm.group(1)
        return {"type": "chase", "op": "add", "item": _clean_name(item), "content": _clean_name(content) if content else ""}
    m = re.match(FILL + rf"(?:delete|remove)\s+(?:the\s+)?{CHASE}(?:\s+item)?\s*[:,]?\s*(.+)$", r, re.I) \
        or re.match(FILL + rf"(?:delete|remove)\s+(.+?)\s+from\s+(?:my\s+|the\s+)?{CHASE}(?:\s+list)?$", r, re.I)
    if m:
        return {"type": "chase", "op": "delete", "item": m.group(1).strip(" ,.")}
    m = re.match(FILL + rf"{CHASE}(?:\s+item)?\s+{_UNDONE}\s*[:,]?\s*(.+)$", r, re.I)
    if m:
        return {"type": "chase", "op": "undone", "item": m.group(2).strip(" ,.")}
    m = re.match(FILL + rf"{CHASE}(?:\s+item)?\s+{_DONE}\s*[:,]?\s*(.+)$", r, re.I) \
        or re.match(FILL + rf"(?:got|finished|completed|did)\s+(?:my\s+|the\s+)?{CHASE}(?:\s+item)?\s+(.+)$", r, re.I) \
        or re.match(FILL + rf"(?:mark|tick|check)\s+(?:off\s+)?(?:the\s+)?{CHASE}(?:\s+item)?\s+(.+?)(?:\s+(?:as\s+)?(?:done|complete))?$", r, re.I) \
        or re.match(FILL + rf"(.+?)\s+{CHASE}(?:\s+item)?\s+(?:is\s+)?(?:done|complete|completed|finished)$", r, re.I)
    if m:
        return {"type": "chase", "op": "done", "item": m.group(m.lastindex).strip(" ,.")}
    return None


def parse_chase_query(s: str):
    if not re.search(rf"\b{CHASE}\b", s):
        return None
    if re.search(r"\b(left|remaining|list|what|which|status|show|read|next|open|todo|to do|how many|items?)\b", s) or re.fullmatch(rf"(?:my\s+|the\s+)?{CHASE}", s):
        m = re.search(r"\b(?:from|in|for)\s+(?:the\s+)?(\w[\w /]*)$", s)
        return {"type": "query", "what": "chase", "content": m.group(1) if m else ""}
    return None


# ------------------------------------------------------------------ Fate boss
_BOSS_NAMES = None


def boss_names():
    global _BOSS_NAMES
    if _BOSS_NAMES is None:
        try:
            d = json.loads((HERE / "cache" / "fates.json").read_text(encoding="utf-8"))
            names = set()
            for b in (d.get("bosses") or {}).values():
                n = str(b.get("boss") or "")
                names.add(n.lower())
                names.add(n.split(",")[0].strip().lower())
            _BOSS_NAMES = sorted(x for x in names if len(x) > 2)
        except Exception:  # noqa: BLE001
            _BOSS_NAMES = []
    return _BOSS_NAMES


def is_boss(name: str) -> bool:
    n = re.sub(r"^the\s+", "", name.strip().lower())
    if not n:
        return False
    for b in boss_names():
        bb = re.sub(r"^the\s+", "", b)
        if n == bb or (FUZZ and len(n) >= 5 and FUZZ.ratio(n, bb) >= 85):
            return True
    return False


_FB_VERB = r"(?:show|open|pull up|bring up|find|scroll to|go to|jump to|look at|read|check|give me|tell me)\s+(?:me\s+)?(?:up\s+)?(?:the\s+)?"


def parse_fate_boss(s: str):
    """'fate boss merveil' / 'fate boss: merveil' / 'pull up the fate boss from merveil' / 'what is the fate boss effect for merveil'."""
    m = re.match(r"^(?:(?:okay|ok|hey|so|please|now)\s+)*(?:" + _FB_VERB + r")?(?:what is |what are |what s )?(?:the\s+)?(?:fate|faith)\s*boss(?:es)?\b"
                 r"(?:\s+(?:effect|effects|entry|info|information|details|reward|rewards|card|page))*\s*(?:is\s+|for\s+|from\s+|of\s+|on\s+|called\s+|named\s+)?(.+)$", s)
    if m:
        boss = re.sub(r"\b(please|now|again)\b", "", m.group(1)).strip(" ,.")
        if boss and not re.fullmatch(r"(it|this|that|him|her|list|bosses|all)", boss):
            return {"type": "query", "what": "fate_info", "boss": boss, "open": True}
    m = re.match(r"^(?:(?:okay|ok|hey|so)\s+)*" + _FB_VERB + r"(.+?)(?:'s| s)?\s+(?:fate|faith)(?:\s+(?:boss|reward|rewards|entry|info))?$", s)
    if m and m.group(1).strip() not in ("my", "a", "the", "new"):
        return {"type": "query", "what": "fate_info", "boss": m.group(1).strip(), "open": True}
    m = re.match(r"^(?:(?:okay|ok|so)\s+)*what (?:does|do|will) (?:the\s+)?(.+?) (?:give|drop|reward)(?: me)?$", s)
    if m and is_boss(m.group(1)):
        return {"type": "query", "what": "fate_info", "boss": m.group(1).strip(), "open": True}
    return None


# ------------------------------------------------------------------ link follow-ups
def parse_link_followup(s: str, cats: dict):
    """'main attack links only' / 'just the movement' / 'utility ones' / 'only auras' -> focus category or None."""
    alt = "|".join(f"(?P<{k}>{v})" for k, v in cats.items())
    m = re.fullmatch(r"(?:(?:okay|ok|so|and|now|no|just|only|what about|how about|give me|show me|read)\s+)*(?:the\s+|my\s+)?"
                     rf"(?:{alt})(?:\s+(?:links?|gems?|skills?|setup|set up|ones?))?(?:\s+(?:only|please|then|instead))*", s)
    return m.lastgroup if m else None


# ------------------------------------------------------------------ news / social
SOCIAL = r"\b(x|twitter|tweets?|tweet|reddit|subreddit|forums?|discord|youtube|streamers?|patch notes?|announcements?|news)\b"
NEWSWORDS = r"\b(news|updates?|announcements?|new info|new information|anything new|any new|latest|patch notes?)\b"
TRAIL_FILLER = (r"\s*,?\s*(?:(?:to see |and see |to check )?(?:if|whether) (?:there is|there's|there are|theres|anything|any) .*"
                r"|for (?:any )?(?:new )?(?:information|info|news|updates?)$|(?:any )?new (?:information|info)$)")


def strip_trailing_filler(q: str) -> str:
    return re.sub(TRAIL_FILLER, "", q.strip(), flags=re.I).strip(" ,.?!")


def news_topic(s: str):
    """News / social questions -> topic (may be '' or 'x'); None when it isn't one."""
    if not re.search(NEWSWORDS, s):
        return None
    m = re.search(r"\b(?:on|about|for|regarding|from|with)\s+(?:the\s+)?(.+?)(?:\s+(?:if|whether)\b.*)?$", s)
    topic = (m.group(1) if m else "").strip()
    topic = re.sub(r"\b(new information|new info|information|news|updates?)\b", "", topic).strip()
    return topic


def is_social(text: str) -> bool:
    return bool(re.search(SOCIAL, text.lower()))


# ------------------------------------------------------------------ yes
YES_RE = r"(?:(?:okay|ok)\s+)?(?:yes|yeah|yep|yup|sure|please do|do it|go ahead|look it up|yes please|yeah please|sure thing|go for it|please)(?:\s+(?:please|do it|look it up|go ahead))?"
