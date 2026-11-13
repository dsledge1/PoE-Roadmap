"""Explicit "research X" lookups: poewiki.net MediaWiki API first, optional LLM summary second.

Only runs when the player says "research ...", "look up ..." or "wiki ...". Nothing here touches the game.
Network: https://www.poewiki.net/w/api.php and, if configured, one LLM endpoint. The API key is read
from an environment variable at call time and is never written to disk, logged or sent to the page.
"""
from __future__ import annotations

import html
import json
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser

UA = "PoE-HCSSF-tracker/3.0 (personal voice companion; low volume)"

DEFAULT_RESEARCH = {
    "backend": "openai_compatible",        # "openai_compatible" | "ollama" | "none" (wiki only)
    "wiki_api": "https://www.poewiki.net/w/api.php",
    "poedb": "https://poedb.tw/us/",       # second source (drop sources, Limit / Dropped by); "" disables
    "poedb_timeout_s": 3,
    "wiki_timeout_s": 4,
    "llm_timeout_s": 8,                    # after this the plain wiki answer is used
    "max_spoken_chars": 260,
    "openai_compatible": {
        "base_url": "https://api.openai.com/v1",
        "model": "gpt-6-luna",             # any chat model; e.g. "gpt-5.4-mini". xAI/OpenRouter work too (change base_url)
        "api_key_env": "OPENAI_API_KEY",   # name of the env var; the key itself is never stored
        "max_tokens": 350,
        "token_param": "max_completion_tokens",   # "max_tokens" for older OpenAI-compatible servers
        "temperature": None,               # leave None for OpenAI reasoning models
    },
    "ollama": {"base_url": "http://127.0.0.1:11434", "model": "qwen2.5:7b-instruct"},
}


# --------------------------------------------------------------------------------------------
# HTTP layer (swappable in tests)
# --------------------------------------------------------------------------------------------
class Http:
    def get_json(self, url: str, params: dict, timeout: float):
        q = url + "?" + urllib.parse.urlencode(params)
        req = urllib.request.Request(q, headers={"User-Agent": UA, "Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8", "replace"))

    def get_text(self, url: str, timeout: float):
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read().decode("utf-8", "replace")

    def post_json(self, url: str, body: dict, headers: dict, timeout: float):
        data = json.dumps(body).encode()
        req = urllib.request.Request(url, data=data, method="POST",
                                     headers={"User-Agent": UA, "Content-Type": "application/json", **headers})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8", "replace"))
        except urllib.error.HTTPError as e:
            detail = ""
            try:
                detail = e.read().decode("utf-8", "replace")[:300]
            except Exception:
                pass
            raise RuntimeError(f"HTTP {e.code}: {redact(detail)}") from None


HTTP = Http()


def redact(text: str) -> str:
    """Never echo anything that looks like a key (pattern match plus the actual values of *_API_KEY env vars)."""
    out = str(text)
    for k, v in os.environ.items():
        if k.endswith("API_KEY") and v and len(v) >= 8:
            out = out.replace(v, "[redacted]")
    return re.sub(r"(sk|xai|or)-[A-Za-z0-9_\-]{8,}", "[redacted]", out)


# --------------------------------------------------------------------------------------------
# Wiki text helpers
# --------------------------------------------------------------------------------------------
class _Text(HTMLParser):
    BREAK = {"br", "p", "div", "li", "tr", "h1", "h2", "h3", "h4", "table", "ul"}

    def __init__(self):
        super().__init__()
        self.out, self.skip = [], 0

    def handle_starttag(self, tag, attrs):
        cls = dict(attrs).get("class") or ""
        if tag in ("script", "style") or "mw-editsection" in cls or "toc" == dict(attrs).get("id"):
            self.skip += 1 if tag in ("script", "style") else 0
        if tag in self.BREAK or "group" in cls.split():
            self.out.append("\n")

    def handle_endtag(self, tag):
        if tag in ("script", "style") and self.skip:
            self.skip -= 1
        if tag in self.BREAK or tag == "span":
            self.out.append("\n" if tag in self.BREAK else "")

    def handle_data(self, data):
        if not self.skip:
            self.out.append(data)


def html_to_lines(h: str):
    p = _Text()
    p.feed(h or "")
    txt = html.unescape("".join(p.out))
    lines = [re.sub(r"[ \t\u00a0]+", " ", ln).strip() for ln in txt.split("\n")]
    return [ln for ln in lines if ln]


def clean_wikitext(s: str) -> str:
    s = re.sub(r"<!--.*?-->", "", s, flags=re.S)
    s = re.sub(r"\{\{c\|[^|}]*\|([^}]*)\}\}", r"\1", s)
    s = re.sub(r"\{\{(?:il|sl|ill)\|([^|}]*)(?:\|[^}]*)?\}\}", r"\1", s)
    s = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", r"\1", s)
    s = re.sub(r"\{\{[^{}]*\}\}", "", s)
    s = re.sub(r"'''?|<[^>]+>", "", s)
    return re.sub(r"\s+", " ", s).strip()


def clean_extract(text: str) -> str:
    """poewiki intros inline the item box ('Short BowShort BowBowPhysical Damage: ...Requires Level 5, 26 Dex with ...')."""
    t = "\n".join(ln for ln in (text or "").split("\n") if not re.search(r"Reading Guide|redirects here|^For the .*, see", ln))
    t = re.sub(r"(?<=[a-z\)])[A-Z].*?Requires Level[^A-Za-z]*(?:(?:Str|Dex|Int)[, ]*(?:\d+ ?)?)*", " ", t)
    t = re.sub(r"\s(?:Str|Dex|Int)(?=[\s.,]|$)", "", t)
    t = re.sub(r"(?<=[a-z])(?=[A-Z+])", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def first_sentences(text: str, n: int = 2, limit: int = 240) -> str:
    parts = re.split(r"(?<=[.!?])\s+", text.strip())
    out = ""
    for p in parts[:n]:
        if len(out) + len(p) > limit and out:
            break
        out = (out + " " + p).strip()
    return out[:limit]


def version_notes(wikitext: str, ver: str = "3.30"):
    """Lines from the page's Version history rows for `ver` (e.g. 3.30.0, 3.30.0b)."""
    notes = []
    for m in re.finditer(r"\{\{\s*Version history table row\s*\|\s*" + re.escape(ver) + r"[^|]*\|(.*?)\}\}\s*(?=\{\{|\Z|\n==)", wikitext, flags=re.S | re.I):
        for ln in m.group(1).split("\n"):
            ln = clean_wikitext(ln.lstrip("*: "))
            if ln:
                notes.append(ln)
    return notes


def infobox_fields(wikitext: str) -> dict:
    """Top-level fields of the first {{Item ...}} infobox (uniques, gems, div cards)."""
    m = re.search(r"\{\{\s*Item\s*\n(.*?)\n\}\}", wikitext, flags=re.S)
    out = {}
    if not m:
        return out
    for ln in m.group(1).split("\n"):
        mm = re.match(r"\|\s*([a-z0-9_]+)\s*=\s*(.*)$", ln.strip())
        if mm and mm.group(2).strip():
            out[mm.group(1)] = clean_wikitext(mm.group(2))
    return out


def item_box_lines(lines):
    """Mod lines from the rendered item box: after 'Requires Level ...' up to the flavour text / metadata."""
    out, started = [], False
    for ln in lines[:60]:
        if re.match(r"(Vendor Offer|Metadata|Acquisition|Item class|Contents|Weapon DPS)", ln) or ln.startswith('"'):
            if started:
                break
            continue
        if re.match(r"Requires Level", ln):
            started = True
            rest = re.sub(r"^Requires Level[^,]*(?:,\s*[\d()\-]+ (?:Str|Dex|Int))*\s*", "", ln).strip(" ,")
            if rest:
                out.append(rest)
            continue
        if started and re.search(r"[\d%+]", ln):
            out.append(ln)
    return out[:8]


SECTION_HEADS = ["Item acquisition", "Acquisition", "Monster restrictions", "Area restrictions", "Drop restrictions",
                 "Recipes", "Mechanics", "Usage", "Notes", "Version history", "Divination cards", "Vendor recipes", "Drop"]
STOP_HEADS = set(SECTION_HEADS) | {"Item mods", "Gallery", "See also", "References", "Trivia", "Variants", "Contents", "Navigation menu", "Quality", "Level progression"}


def page_sections(lines, keep=SECTION_HEADS, max_lines=18):
    """{heading: [lines]} for the headings we care about, from the full rendered page text."""
    out, cur = {}, None
    toc_end = 0
    started = False
    for i, ln in enumerate(lines[:60]):        # skip the table of contents ("1 Mechanics", "2.1 Recipes"): one contiguous run
        if re.match(r"^\d{1,2}(\.\d{1,2})? [A-Z]", ln):  # not "3.10.0 Introduced" (a version-history row)
            started, toc_end = True, i + 1
        elif started:
            break
    for ln in lines[toc_end:]:
        if ln in STOP_HEADS:
            cur = ln if ln in keep and ln not in out else None
            if cur:
                out[cur] = []
            continue
        if cur and len(out[cur]) < max_lines:
            out[cur].append(ln[:300])
    return {k: v for k, v in out.items() if v}


FILLER = [r"(?:on|from|in|at) (?:the )?(?:poe ?wiki|wiki|poedb)", r"wiki (?:for|on|about)", r"drop locations?", r"drop sources?",
          r"where does (?:it|that) drop", r"where (?:does|do) (?:it|they) drop", r"look(?:ing)? up", r"lookup", r"please",
          r"can you", r"could you", r"tell me", r"for me", r"real quick", r"quickly"]


LEAD_INS = (r"^(?:(?:the )?(?:map|maps|database|poedb|poe db|wiki|poewiki|wiki page|page|info|information|details|entry|article|item|data)"
            r" (?:for|on|about|of|called|named)\s+|(?:a )?(?:map|page|item|boss|card) (?:called|named)\s+|(?:map|area|zone|act) (?:is|has|are)\s+)")
TRAILING = r"\s*,?\s*(?:(?:to see |and see |to check )?(?:if|whether) (?:there is|there's|theres|there are|anything|any) .*|for (?:any )?(?:new )?(?:information|info|news|updates?)$)"


def strip_filler(q: str) -> str:
    q = re.sub(TRAILING, "", q.strip().strip("?.! "), flags=re.I)
    q = re.sub(LEAD_INS, "", q.strip(), flags=re.I)        # "map for the White Death", "database for X", "poedb for X"
    s = " " + q.strip().strip("?.! ") + " "
    for f in FILLER:
        s = re.sub(r"(?i)\s" + f + r"(?=\s)", " ", s)
    s = re.sub(r"(?i)\b(skill|quality|support) (gym|jim)\b", r"\1 gem", s)
    return re.sub(r"\s+", " ", s).strip(" ,")


DROPQ = re.compile(r"\b(drop|drops|dropped|where|find|get|farm|acquire|acquisition|source|obtain|location)\b", re.I)
RECIPEQ = re.compile(r"\b(recipe|recipes|vendor)\b", re.I)
STOPW = set("the a an of for to with and or in on my is are what how do does get make recipe recipes vendor".split())


def recipe_lines(lines, question, n=10):
    """Best-matching lines (with a little context) from the Vendor recipe system page."""
    words = [w for w in re.findall(r"[a-z]+", question.lower()) if w not in STOPW and len(w) > 2]
    syn = {"gem": ["gem", "gems", "gemcutter"], "gems": ["gem", "gems", "gemcutter"], "physical": ["physical"], "weapon": ["weapon", "weapons"],
           "quality": ["quality"], "chromatic": ["chromatic", "colour", "color"], "jeweller": ["jeweller", "socket"], "fusing": ["fusing", "link"]}
    best = []
    for i, ln in enumerate(lines):
        low = ln.lower()
        sc = sum(1 for w in words if any(x in low for x in syn.get(w, [w])))
        if sc:
            best.append((sc, -len(ln), i))
    best.sort(reverse=True)
    picked = []
    for sc, _, i in best[:4]:
        for j in range(max(0, i - 2), min(len(lines), i + 4)):
            if j not in picked:
                picked.append(j)
    picked.sort()
    return [lines[j][:220] for j in picked][:n * 2]


# Common recipes, phrased for speech. Each is used only when its ingredient names are on the fetched wiki page.
RECIPE_HINTS = [
    (r"phys|physical", ["Rustic Sash", "Blacksmith's Whetstone", "Increased Physical Damage"],
     "Physical weapon: any weapon plus a Rustic Sash plus a Blacksmith's Whetstone gives a magic weapon with 40 to 84% increased Physical Damage. "
     "Magic sash: Heavy, 40 to 49%. Rare: Serrated, 50 to 64%. Unique: Wicked, 65 to 84%."),
    (r"spell", ["Chain Belt", "Increased Spell Damage"],
     "Spell weapon: a Rune Dagger, Sceptre, Wand or Staff plus a Chain Belt plus a Blacksmith's Whetstone gives a magic weapon with increased Spell Damage; belt rarity sets the tier."),
    (r"gem|gems|gemcutter|prism", ["Gemcutter's Prism", "40% quality"],
     "Quality gem: sell gems with a combined 40% quality, or one normal gem at 20% quality, for one Gemcutter's Prism."),
    (r"flask|bauble", ["Glassblower's Bauble", "40% quality"],
     "Quality flasks: flasks with a combined 40% quality, or one normal at 20%, give a Glassblower's Bauble."),
    (r"armou?r|scrap", ["Armourer's Scrap", "40% quality"],
     "Quality armour: armour pieces with a combined 40% quality, or one normal at 20%, give an Armourer's Scrap."),
    (r"whetstone|quality weapon", ["Blacksmith's Whetstone", "40% quality"],
     "Quality weapons: weapons with a combined 40% quality, or one normal at 20%, give a Blacksmith's Whetstone."),
]


def recipe_hint(question, lines):
    page = "\n".join(lines)
    for pat, need, text in RECIPE_HINTS:
        if re.search(pat, question, re.I) and all(n.lower() in page.lower() for n in need):
            return text
    return ""


def poedb_facts(lines):
    """Drop facts from a poedb.tw item page."""
    keep = []
    for ln in lines:
        if re.match(r"^(Dropped by|Limit|Reward|DropLevel|Drop Level|Release Version|This item can be acquired|.*always drops|Drop Restriction|Area Level|Boss)", ln) or \
                re.search(r"「.*」", ln):
            t = ln.replace("「", "").replace("」", " ")
            t = re.sub(r"^Limit(.*)Dropped by$", r"Dropped by \1", t).strip()
            t = re.sub(r"^(Dropped by|Reward|DropLevel|Release Version)(?=\S)", r"\1: ", t)
            if t not in keep:
                keep.append(t[:200])
    return keep[:8]


def coverage(title: str, q: str) -> float:
    """Share of the query's content words found in the title ('Death' covers 1 of 2 words of 'the white death')."""
    stop = {"the", "a", "an", "of", "and", "s"}
    qw = [w for w in re.findall(r"[a-z0-9]+", q.lower()) if w not in stop]
    tw = set(w for w in re.findall(r"[a-z0-9]+", title.lower()) if w not in stop)
    if not qw:
        return 1.0
    import difflib
    hit = sum(1 for w in qw if w in tw or any((t.startswith(w[:5]) and len(w) >= 5) or
                                              (len(w) >= 5 and difflib.SequenceMatcher(None, w, t).ratio() >= 0.7) for t in tw))
    return hit / len(qw)


def title_score(title: str, q: str) -> float:
    try:
        from rapidfuzz import fuzz as _f
        r = _f.ratio
    except ImportError:
        import difflib
        r = lambda a, b: 100.0 * difflib.SequenceMatcher(None, a, b).ratio()  # noqa: E731
    t, ql = title.lower(), q.lower()
    sc = max(r(t, ql), r(t.removeprefix("the "), ql.removeprefix("the ")))
    if ql in t or t.removeprefix("the ") in ql:
        sc += 15
    if re.search(r"\(variant|^list of|^version \d|^timeline|^path of exile:|\(monster", t):
        sc -= 40
    return sc


# --------------------------------------------------------------------------------------------
class Researcher:
    def __init__(self, cfg: dict, http=None, name_matcher=None):
        r = dict(DEFAULT_RESEARCH)
        r.update(cfg.get("research") or {})
        for k in ("openai_compatible", "ollama"):
            sub = dict(DEFAULT_RESEARCH[k]); sub.update((cfg.get("research") or {}).get(k) or {}); r[k] = sub
        self.rc = r
        self.http = http or HTTP
        self.match = name_matcher

    # --- status
    def backend(self) -> str:
        b = (self.rc.get("backend") or "none").lower()
        if b == "openai_compatible" and not os.environ.get(self.rc["openai_compatible"].get("api_key_env") or "OPENAI_API_KEY"):
            return "none"
        return b

    def startup_note(self) -> str:
        b = (self.rc.get("backend") or "none").lower()
        if b == "openai_compatible":
            env = self.rc["openai_compatible"].get("api_key_env") or "OPENAI_API_KEY"
            if not os.environ.get(env):
                return f"Research: {env} is not set, so lookups use the plain poewiki summary (no LLM)."
            return f"Research: poewiki + {self.rc['openai_compatible']['model']} via {self.rc['openai_compatible']['base_url']} (key from {env})."
        if b == "ollama":
            return f"Research: poewiki + local Ollama {self.rc['ollama']['model']}."
        return "Research: poewiki summary only (backend none)."

    # --- wiki
    def _api(self, params, timeout=None):
        p = {"format": "json", "formatversion": 2, **params}
        return self.http.get_json(self.rc["wiki_api"], p, timeout or float(self.rc["wiki_timeout_s"]))

    def clean_query(self, q: str) -> str:
        s = strip_filler(q)
        s = re.sub(r"^(?:where (?:does|do|can i (?:get|find))(?: a| an)?|what(?:'s| is| are| does)?|how (?:does|do|is)|tell me about|info on|information on|about)\s+", "", s, flags=re.I)
        s = re.sub(r"\s+(?:drop|drops|dropped|come from)$", "", s, flags=re.I)
        s = re.sub(r"\s+(?:on|from|in) (?:the )?(?:poe ?wiki|wiki)$", "", s, flags=re.I)
        s = re.sub(r"\s+(?:do|work|works|drop|drops)$", "", s, flags=re.I)
        s = re.sub(r"\s+(?:divination card|div card|card|unique|gem|skill gem|support gem)s?$", "", s, flags=re.I)
        return s.strip() or q.strip()

    def find_title(self, q: str) -> str | None:
        if RECIPEQ.search(q):
            return "Vendor recipe system"
        cq = self.clean_query(q)
        self.closest = []
        if self.match:
            try:
                m = self.match(cq)
                if m and m.get("confidence") == "high" and m.get("kind") not in ("trigger",):
                    cq_name = re.sub(r" captured$| found$", "", m["name"])
                    # v4: only when the name is most of what he said ("the white death" must not become the card "Death")
                    if len(cq_name) >= 4 and coverage(cq_name, cq) >= 0.75:
                        cq = cq_name
            except Exception:
                pass
        d = self._api({"action": "query", "list": "search", "srsearch": cq, "srlimit": 8, "srnamespace": 0, "srprop": ""})
        hits = [h["title"] for h in (d.get("query") or {}).get("search") or []]
        if not hits:
            return None
        low = cq.lower()
        for t in hits:
            if t.lower() == low or t.lower() == "the " + low or t.lower() == low.removeprefix("the "):
                return t
        # several candidates: best title similarity, never a variant / list / patch-notes page when a real one exists
        best = max(hits, key=lambda t: (title_score(t, cq), -hits.index(t)))
        # v4: a title that covers only a small part of the question is a different thing: say so instead of answering about it
        if coverage(best, cq) < 0.6 and not (len(cq.split()) >= 4 and coverage(best, cq) >= 0.4):
            self.closest = hits[:3]
            self.cleaned = cq
            return None
        return best

    def wiki_lookup(self, q: str) -> dict:
        title = self.find_title(q)
        if not title:
            return {"found": False, "query": getattr(self, "cleaned", "") or self.clean_query(q), "closest": list(getattr(self, "closest", []) or [])}
        ex = self._api({"action": "query", "prop": "extracts", "explaintext": 1, "exintro": 1, "redirects": 1, "titles": title})
        pages = (ex.get("query") or {}).get("pages") or [{}]
        extract = clean_extract(pages[0].get("extract") or "")
        title = pages[0].get("title") or title
        rendered = self._api({"action": "parse", "page": title, "prop": "text", "redirects": 1,
                              "disablelimitreport": 1, "disableeditsection": 1})
        all_lines = html_to_lines(((rendered.get("parse") or {}).get("text")) or "")
        lines = all_lines
        wt = self._api({"action": "parse", "page": title, "prop": "wikitext", "redirects": 1})
        wikitext = ((wt.get("parse") or {}).get("wikitext")) or ""
        box = infobox_fields(wikitext)
        acq = re.search(r"\{\{Item acquisition\|page=([^}|]+)", wikitext)
        if acq and not box.get("drop_monsters"):       # 'Cane of Kulemak' keeps drop_monsters on '(variant 1)'
            try:
                vw = ((self._api({"action": "parse", "page": acq.group(1).strip(), "prop": "wikitext", "redirects": 1}).get("parse") or {}).get("wikitext")) or ""
                vb = infobox_fields(vw)
                for k in ("drop_monsters", "drop_areas", "drop_text", "drop_enabled"):
                    if vb.get(k):
                        box[k] = vb[k]
            except Exception:  # noqa: BLE001
                pass
        notes330 = version_notes(wikitext, "3.30")
        sections = page_sections(all_lines)
        recipe = recipe_lines(all_lines, q) if title == "Vendor recipe system" else []
        hint = recipe_hint(strip_filler(q), all_lines) if title == "Vendor recipe system" else ""
        if hint:
            recipe = [hint] + recipe
        poedb = self.poedb_lookup(title) if title != "Vendor recipe system" else []
        return {
            "sections": sections, "recipe_lines": recipe, "poedb": poedb,
            "found": True, "query": q, "title": title,
            "url": "https://www.poewiki.net/wiki/" + urllib.parse.quote(title.replace(" ", "_")),
            "extract": extract, "lines": lines[:80], "mods": item_box_lines(lines), "infobox": box,
            "has_330": bool(re.search(r"\b3\.30\b", wikitext)), "notes_330": notes330,
            "release": box.get("release_version", ""),
        }

    def poedb_lookup(self, title: str):
        base = self.rc.get("poedb") or ""
        if not base or not hasattr(self.http, "get_text"):
            return []
        for slug in dict.fromkeys([title.replace(" ", "_"), re.sub(r"['’]", "", title).replace(" ", "_")]):
            try:
                h = self.http.get_text(base + urllib.parse.quote(slug), float(self.rc.get("poedb_timeout_s", 3)))
                facts = poedb_facts(html_to_lines(h))
                if facts:
                    return facts
            except Exception:
                continue
        return []

    # --- answers
    def wiki_answer(self, info: dict, question: str = ""):
        if not info.get("found"):
            s = f"I couldn't find a page for '{info.get('query')}' on poewiki."
            if info.get("closest"):
                s += " Closest titles: " + ", ".join(info["closest"]) + "."
            return s, s
        lead = first_sentences(info["extract"] or " ".join(info["lines"][:3]), 2, 200)
        mods = [m for m in info.get("mods") or [] if len(m) < 90]
        key = [m for m in mods if re.search(r"Level of|Spectre|Minion|maximum Life|Resist|Block|Energy Shield", m)]
        mods = (key + [m for m in mods if m not in key])
        rarity = (info.get("infobox") or {}).get("rarity_id", "")
        if rarity == "unique":
            lead = first_sentences(lead, 1, 160)
        spoken = lead
        sec = info.get("sections") or {}
        if info.get("recipe_lines"):
            r0 = info["recipe_lines"][0]
            spoken = r0 if r0.startswith(tuple(h[2][:12] for h in RECIPE_HINTS)) else \
                "From the vendor recipe page: " + "; ".join(x for x in info["recipe_lines"][:4] if len(x) < 140)
        elif DROPQ.search(question or info.get("query", "")):
            acq = [x for k in ("Item acquisition", "Acquisition", "Monster restrictions", "Area restrictions", "Drop restrictions") for x in sec.get(k, [])]
            acq = [x for x in acq if not x.endswith(":") or True][:4]
            dropped = [x for x in info.get("poedb") or [] if x.startswith(("Dropped by", "This item can be acquired"))]
            bits = []
            for x in acq:
                if re.match(r"^(Version|Changes)$", x):
                    continue
                if bits and bits[-1].endswith(":"):
                    bits[-1] = bits[-1] + " " + x
                else:
                    bits.append(x)
            bits = [b.rstrip(":") for b in bits]
            spoken = f"{info['title']}: " + " ".join(b if b.endswith(".") else b + "." for b in bits[:3]) if bits else lead
            spoken = spoken.replace(f"{info['title']}: {info['title']} ", f"{info['title']} ")
            if dropped and not any(d.split(":")[-1].strip()[:12] in spoken for d in dropped):
                spoken += " poedb: " + dropped[0].rstrip(".") + "."
        if info["notes_330"]:
            spoken += " Changed in 3.30: " + info["notes_330"][0].rstrip(".") + "."
        elif not info["has_330"] and not info.get("recipe_lines"):
            spoken += " The wiki page has no 3.30 info yet."
        if rarity == "unique" and mods:
            spoken += " " + "; ".join(mods[:3]) + "."
        spoken = re.sub(r"\s+", " ", spoken).strip()
        mx = int(self.rc.get("max_spoken_chars", 260))
        if len(spoken) > mx:
            spoken = spoken[:mx].rsplit(" ", 1)[0] + "…"
        full = [info["extract"] or lead]
        for k, v in (info.get("sections") or {}).items():
            if k != "Version history":
                full.append(f"{k}: " + " | ".join(v[:10]))
        if info.get("recipe_lines"):
            full.append("Vendor recipes: " + " | ".join(info["recipe_lines"]))
        if info.get("poedb"):
            full.append("poedb: " + " | ".join(info["poedb"]))
        if mods:
            full.append("Item box: " + " | ".join(mods))
        if info["notes_330"]:
            full.append("3.30 changes on the wiki: " + " | ".join(info["notes_330"]))
        elif not info["has_330"]:
            full.append("No 3.30 information on this wiki page yet (it may predate Covens of Umbra).")
        return spoken, "\n".join(full)

    def _prompt(self, question, info, state):
        src = []
        if info.get("found"):
            src.append(f"POEWIKI PAGE: {info['title']} ({info['url']})")
            src.append("INTRO: " + (info["extract"] or "")[:1500])
            if info.get("infobox"):
                src.append("INFOBOX: " + json.dumps(info["infobox"], ensure_ascii=False)[:1200])
            if info["mods"]:
                src.append("ITEM BOX: " + " | ".join(info["mods"]))
            for k, v in (info.get("sections") or {}).items():
                src.append(f"SECTION {k.upper()}: " + " | ".join(v)[:1500])
            if info.get("recipe_lines"):
                src.append("VENDOR RECIPE LINES (best matches from the 'Vendor recipe system' page):\n" + "\n".join(info["recipe_lines"]))
            if info.get("poedb"):
                src.append("POEDB.TW (second source): " + " | ".join(info["poedb"]))
            body = "\n".join(info["lines"])[:3500 if info.get("recipe_lines") else 5000]
            src.append("PAGE TEXT (start):\n" + body)
            src.append("3.30 VERSION NOTES: " + (" | ".join(info["notes_330"]) if info["notes_330"] else ("none on this page" if not info["has_330"] else "page mentions 3.30 but no version-history row")))
        else:
            src.append("POEWIKI: no page found for this question.")
        system = ("You answer Path of Exile 1 questions for a Hardcore Solo-Self-Found player on league 3.30 (Covens of Umbra). "
                  "Use ONLY the SOURCES and TRACKER STATE below (the fetched text), never from your own knowledge. "
                  "Every fact you say must be stated in those sources; for anything they don't state (for example whether an item can be chanced, "
                  "drop rates, or which league content it is in) say 'the page doesn't say' or leave it out. "
                  "If the page is about a different thing than the question (e.g. the question names 'The White Death' and the page is 'Death'), "
                  "say you couldn't find a page for it and do not describe the other page. "
                  "If they do not contain the answer, say you don't know from the wiki. "
                  "If the wiki has no 3.30 info, say the page may be out of date. Never invent numbers. "
                  "For where-does-it-drop questions answer from the acquisition / monster / area restriction sections and poedb (name the boss or area). "
                  "For vendor recipes give the exact ingredients and the result. "
                  'Reply with JSON only: {"spoken": "1-3 short sentences for text-to-speech, no markdown", "detail": "fuller answer, max 120 words"}')
        user = f"QUESTION: {question}\n\nSOURCES:\n" + "\n".join(src) + "\n\nTRACKER STATE:\n" + json.dumps(state or {}, ensure_ascii=False)[:1500]
        return system, user

    def _parse_llm(self, text: str):
        text = (text or "").strip()
        m = re.search(r"\{.*\}", text, flags=re.S)
        if m:
            try:
                j = json.loads(m.group(0))
                sp, de = str(j.get("spoken") or "").strip(), str(j.get("detail") or "").strip()
                if sp:
                    return sp, de or sp
            except Exception:
                pass
        if not text:
            raise RuntimeError("empty LLM reply")
        return first_sentences(text, 3, 300), text

    def llm_answer(self, question, info, state, timeout=None):
        b = self.backend()
        timeout = float(timeout or self.rc.get("llm_timeout_s", 8))
        system, user = self._prompt(question, info, state)
        msgs = [{"role": "system", "content": system}, {"role": "user", "content": user}]
        if b == "openai_compatible":
            oc = self.rc["openai_compatible"]
            key = os.environ.get(oc.get("api_key_env") or "OPENAI_API_KEY", "")
            if not key:
                raise RuntimeError("no API key in environment")
            body = {"model": oc["model"], "messages": msgs}
            body[oc.get("token_param") or "max_completion_tokens"] = int(oc.get("max_tokens", 350))
            if oc.get("temperature") is not None:
                body["temperature"] = oc["temperature"]
            d = self.http.post_json(oc["base_url"].rstrip("/") + "/chat/completions", body, {"Authorization": "Bearer " + key}, timeout)
            return self._parse_llm(((d.get("choices") or [{}])[0].get("message") or {}).get("content", ""))
        if b == "ollama":
            ol = self.rc["ollama"]
            d = self.http.post_json(ol["base_url"].rstrip("/") + "/api/chat",
                                    {"model": ol["model"], "messages": msgs, "stream": False, "format": "json", "options": {"temperature": 0.2}}, {}, timeout)
            return self._parse_llm((d.get("message") or {}).get("content", ""))
        raise RuntimeError("no LLM backend")

    def answer(self, question: str, state: dict | None = None, cancel: threading.Event | None = None) -> dict:
        t0 = time.perf_counter()
        res = {"query": question, "source": "wiki", "title": "", "url": "", "spoken": "", "full": "", "note": ""}
        try:
            info = self.wiki_lookup(question)
        except Exception as e:
            info = {"found": False, "query": question}
            res["note"] = "poewiki unreachable: " + redact(e)[:120]
        if cancel is not None and cancel.is_set():
            res["cancelled"] = True; return res
        res["title"], res["url"] = info.get("title", ""), info.get("url", "")
        spoken, full = self.wiki_answer(info, question) if info.get("found") or not res["note"] else ("I couldn't reach poewiki.", res["note"])
        res["spoken"], res["full"] = spoken, full
        if self.backend() != "none":
            budget = float(self.rc.get("llm_timeout_s", 8))
            out, err = {}, []

            def call():
                try:
                    out["r"] = self.llm_answer(question, info, state, timeout=budget)
                except Exception as e:  # noqa: BLE001
                    err.append(redact(e)[:160])
            th = threading.Thread(target=call, daemon=True)
            th.start(); th.join(budget + 0.3)
            if cancel is not None and cancel.is_set():
                res["cancelled"] = True; return res
            if "r" in out:
                res["spoken"], res["full"] = out["r"]
                res["source"] = "llm"
                if info.get("found"):
                    res["full"] += f"\n(Grounded in poewiki: {info['title']})"
            else:
                res["note"] = ("LLM timed out after %ds, used the wiki summary" % budget) if not err else ("LLM failed (" + err[0] + "), used the wiki summary")
        res["ms"] = round((time.perf_counter() - t0) * 1000)
        return res

    def check_llm(self) -> str:
        b = (self.rc.get("backend") or "none").lower()
        if b == "none":
            return "LLM backend is 'none' (wiki only). Nothing to check."
        if self.backend() == "none":
            return f"LLM fail: {self.rc['openai_compatible'].get('api_key_env')} is not set in this shell."
        t = time.perf_counter()
        try:
            sys_ = 'Reply with JSON only: {"spoken": "ok", "detail": "ok"}'
            if b == "openai_compatible":
                oc = self.rc["openai_compatible"]
                key = os.environ.get(oc.get("api_key_env") or "OPENAI_API_KEY", "")
                body = {"model": oc["model"], "messages": [{"role": "system", "content": sys_}, {"role": "user", "content": "ping"}]}
                body[oc.get("token_param") or "max_completion_tokens"] = 60
                d = self.http.post_json(oc["base_url"].rstrip("/") + "/chat/completions", body, {"Authorization": "Bearer " + key}, float(self.rc.get("llm_timeout_s", 8)))
                txt = ((d.get("choices") or [{}])[0].get("message") or {}).get("content", "")
                who = f"{oc['model']} at {oc['base_url']}"
            else:
                ol = self.rc["ollama"]
                d = self.http.post_json(ol["base_url"].rstrip("/") + "/api/chat", {"model": ol["model"], "messages": [{"role": "user", "content": "Reply with the word ok"}], "stream": False}, {}, float(self.rc.get("llm_timeout_s", 8)))
                txt = (d.get("message") or {}).get("content", "")
                who = f"Ollama {ol['model']}"
            return f"LLM ok: {who} replied in {1000 * (time.perf_counter() - t):.0f} ms ({len(txt)} chars)."
        except Exception as e:  # noqa: BLE001
            return "LLM fail: " + redact(e)[:200]
