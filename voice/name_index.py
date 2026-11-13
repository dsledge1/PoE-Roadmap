"""Full-catalog fuzzy matcher for the voice companion.

Loads voice/poe_names.json, precomputes exact / compact / phonetic / token indexes,
and matches a spoken clause to a canonical item name in well under 50 ms.

Trigger aliases from companion.CATALOG are applied first by companion.match_item;
this module covers the long tail (every unique, card, gem, currency, thread, etc.).
"""
from __future__ import annotations

import json
import re
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent

try:
    from rapidfuzz import fuzz
except ImportError:
    import difflib

    class fuzz:  # type: ignore
        @staticmethod
        def ratio(a, b):
            return 100.0 * difflib.SequenceMatcher(None, a, b).ratio()

# Words we never use as a candidate token, and names we refuse to fuzzy-match.
STOP = {
    "a", "an", "the", "of", "and", "or", "to", "in", "on", "at", "for", "with",
    "from", "into", "my", "your", "our", "this", "that", "just", "got", "get",
    "a", "some", "another", "nice", "oh", "wow", "holy", "is", "are", "was",
    "be", "it", "i", "we", "me", "you",
}
# Conversational / common English (and very generic game words). A name whose
# core form is in this set is "generic": exact match only, and only when the
# clause is clearly about a drop or names the item type.
GENERIC_WORDS = STOP | {
    "thank", "thanks", "please", "hello", "okay", "ok", "yes", "no", "done",
    "act", "lab", "map", "maps", "layout", "awful", "new", "wand", "vendor",
    "vendors", "bought", "buy", "need", "remember", "check", "swap", "pantheon",
    "bandit", "bandits", "killed", "kill", "boss", "gem", "gems", "card", "cards",
    "unique", "uniques", "item", "items", "drop", "dropped", "found", "picked",
    "chaos", "life", "death", "fire", "cold", "lightning", "chance", "pierce",
    "blind", "chain", "anger", "rage", "doom", "hope", "pride", "grace", "gold",
    "mirror", "beauty", "ambition", "voices", "inertia", "gluttony", "brawn",
    "pacifism", "doctor", "demon", "lover", "twins", "union", "scholar", "hermit",
    "gambler", "hoarder", "fiend", "wrath", "inventor", "poet", "fool", "damned",
    "awakened", "collector", "emissary", "fallen", "forgotten", "bargain",
    "offering", "trial", "tower", "light", "darkness", "sun", "moon", "star",
    "void", "end", "one", "cat", "wolf", "bear", "lion", "witch", "queen",
    "king", "lord", "lady", "soul", "heart", "mind", "head", "hunter", "blood",
    "mage", "staff", "boot", "boots", "ring", "belt", "helmet", "shield",
    "weapon", "bow", "claw", "axe", "sword", "dagger", "quiver", "flask",
    "jewel", "jewels", "thread", "threads", "fate", "fates", "viscera", "ore",
    "wildfire", "incandescent", "ambition", "cooperation", "curiosity",
    "beast", "beasts", "monster", "spider", "snake", "ghost", "spirit",
    "support", "vaal", "greater", "lesser", "prime",
}

TYPE_HINTS = re.compile(
    r"\b(divination |div )?cards?\b|\b(gems?|uniques?|belts?|flasks?|jewels?|"
    r"threads?|fates?|viscera|wickerman)\b",
    re.I,
)
DROP_HINT = re.compile(
    r"\b(dropped|drop|got|found|picked up|looted|look at that|just got|i have|"
    r"we got|i got|nice|came out|identified)\b",
    re.I,
)
LEADING_NOISE = re.compile(
    r"^\b(oh|wow|holy|crap|nice|okay|ok|hey|yo|look|looks like|i think|maybe|"
    r"got|found|picked up|looted|dropped|a|an|the|just|my|our|this|some|another)\b\s*",
    re.I,
)

KIND_RANK = {
    "trigger": 0, "unique": 1, "divcard": 2, "gem": 3, "thread": 4,
    "currency": 5, "fragment": 6, "fate": 7, "viscera": 8, "base": 9,
}

# --------------------------------------------------------------------------------------------
# Normalisation + phonetic key
# --------------------------------------------------------------------------------------------
def item_norm(s: str) -> str:
    s = (s or "").lower().replace("’", "'")
    s = re.sub(r"[“”\"!?;:,.]", " ", s)
    s = re.sub(r"[-'/]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def strip_the(s: str) -> str:
    return re.sub(r"^the\s+", "", s)


def compact(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", strip_the(s))


def core_tokens(s: str) -> list[str]:
    return [t for t in item_norm(s).split() if t not in STOP]


def phonetic_key(s: str) -> str:
    """Consonant skeleton with a few English sound merges.

    'porcupine' and 'porky pine' both become 'prkpn', which is how we catch
    Whisper's compound-word splits without stuffing aliases for every unique.
    """
    s = compact(s)
    if not s:
        return ""
    for a, b in (
        ("tch", "ch"), ("sch", "sk"), ("ph", "f"), ("kn", "n"), ("wr", "r"),
        ("wh", "w"), ("qu", "k"), ("ck", "k"), ("dg", "j"), ("gh", "g"),
        ("th", "t"), ("sh", "s"), ("ch", "k"),
    ):
        s = s.replace(a, b)
    s = s.translate(str.maketrans("cqzx", "kksx"))
    # keep the first letter, drop later vowels (y counts as a vowel)
    head, tail = s[0], s[1:]
    tail = re.sub(r"[aeiouy]", "", tail)
    key = re.sub(r"(.)\1+", r"\1", head + tail)
    return key


def is_generic_name(name: str) -> bool:
    toks = core_tokens(name)
    if not toks:
        return True
    if len(toks) == 1 and (toks[0] in GENERIC_WORDS or len(toks[0]) <= 4):
        return True
    if len(toks) == 1 and len(toks[0]) <= 6 and toks[0] in GENERIC_WORDS:
        return True
    return False


# --------------------------------------------------------------------------------------------
# Index
# --------------------------------------------------------------------------------------------
class NameIndex:
    def __init__(self, records: list[dict], version: str = "", meta: dict | None = None):
        self.version = version
        self.meta = meta or {}
        self.records = []
        self.exact = {}            # always-on exact aliases
        self.exact_ctx = {}        # generic aliases (e.g. "doctor") only with a drop/type hint
        self.compact = {}
        self.compact_ctx = {}
        self.phonetic = {}
        self.token = {}
        self.by_bucket = {}        # (first letter, compact length) -> [id] for cheap fuzzy fallback
        for rec in records:
            self._add(rec)

    def _is_ctx_alias(self, alias: str) -> bool:
        st = strip_the(alias)
        toks = core_tokens(st)
        if not toks:
            return True
        if len(toks) == 1 and (toks[0] in GENERIC_WORDS or len(toks[0]) <= 5):
            return True
        return False

    def _index_alias(self, i: int, n: str, contextual: bool) -> None:
        target = self.exact_ctx if contextual else self.exact
        target.setdefault(n, []).append(i)
        c = compact(n)
        if len(c) >= 3:
            # Short or generic compact keys ("beast", "doctor") are context-only,
            # so "belly of a beast" does not become The Beast card.
            if contextual or c in GENERIC_WORDS or len(c) <= 5:
                self.compact_ctx.setdefault(c, []).append(i)
            else:
                self.compact.setdefault(c, []).append(i)
        pk = phonetic_key(n)
        if len(pk) >= 4 and not contextual:
            self.phonetic.setdefault(pk, []).append(i)

    def _add(self, rec: dict) -> None:
        name = rec["name"]
        aliases = list(rec.get("aliases") or [])
        norms = []
        ctx_norms = []
        for a in [name, *aliases]:
            n = item_norm(a)
            if not n:
                continue
            # The bare form of "The Doctor" is too generic to always-match.
            if n not in norms and n not in ctx_norms:
                if self._is_ctx_alias(n) and n != item_norm(name):
                    ctx_norms.append(n)
                else:
                    norms.append(n)
            st = strip_the(n)
            if st and st != n and st not in norms and st not in ctx_norms:
                if self._is_ctx_alias(st):
                    ctx_norms.append(st)
                else:
                    norms.append(st)
        generic = bool(rec.get("generic")) or is_generic_name(name)
        entry = {
            "name": name,
            "kind": rec["kind"],
            "norms": norms,
            "ctx_norms": ctx_norms,
            "compact": compact(item_norm(name)),
            "phonetic": phonetic_key(name),
            "tokens": set(core_tokens(name)),
            "generic": generic,
        }
        i = len(self.records)
        self.records.append(entry)
        for n in norms:
            self._index_alias(i, n, contextual=False)
        for n in ctx_norms:
            self._index_alias(i, n, contextual=True)
        c = entry["compact"]
        if c:
            self.by_bucket.setdefault((c[0], len(c)), []).append(i)
        for t in entry["tokens"]:
            if len(t) >= 3 and t not in GENERIC_WORDS:
                self.token.setdefault(t, []).append(i)

    def __len__(self):
        return len(self.records)

    def _score(self, window: str, alias: str) -> float:
        if window == alias:
            return 100.0
        cw, ca = compact(window), compact(alias)
        if cw and cw == ca:
            return 100.0
        sc = fuzz.ratio(window, alias)
        if cw and ca:
            sc = max(sc, fuzz.ratio(cw, ca) - 1)
        return sc

    def _best_score(self, window: str, rec: dict) -> tuple[float, bool]:
        sc, exact = 0.0, False
        for alias in rec["norms"]:
            if abs(len(window) - len(alias)) > max(8, len(alias) // 2) and abs(len(compact(window)) - len(compact(alias))) > 5:
                continue
            s = self._score(window, alias)
            if s > sc:
                sc = s
                exact = s >= 99.5
        return sc, exact

    def _threshold(self, name: str, generic: bool) -> tuple[float, float]:
        n = len(compact(name)) or len(name)
        if generic or n < 6:
            return 100.0, 100.0
        if n < 10:
            return 90.0, 87.0
        return 86.0, 80.0

    def _hint_kind(self, clause: str) -> str | None:
        if re.search(r"\b(divination |div )?cards?\b", clause):
            return "divcard"
        if re.search(r"\bfates?\b", clause):
            return "fate"
        if re.search(r"\bthreads?\b", clause):
            return "thread"
        if re.search(r"\b(viscera|wickerman)\b", clause):
            return "viscera"
        if re.search(r"\bgems?\b", clause):
            return "gem"
        if re.search(r"\buniques?\b", clause):
            return "unique"
        return None

    def _prepare(self, clause: str) -> tuple[str, str, str | None, bool]:
        raw = item_norm(clause)
        hint = self._hint_kind(raw)
        drop = bool(DROP_HINT.search(raw))
        stripped = TYPE_HINTS.sub(" ", raw)
        stripped = re.sub(r"\s+", " ", stripped).strip()
        return raw, stripped, hint, drop

    def _windows(self, text: str) -> list[str]:
        toks = text.split()
        out, seen = [], set()
        rest = text
        while True:
            nxt = LEADING_NOISE.sub("", rest, count=1)
            if nxt == rest:
                break
            rest = nxt
        if rest and rest not in seen:
            out.append(rest); seen.add(rest)
        for n in range(min(5, len(toks)), 0, -1):
            for i in range(0, len(toks) - n + 1):
                w = " ".join(toks[i:i + n])
                if w in seen:
                    continue
                # skip windows that are only noise
                if n == 1 and (w in STOP or (w in GENERIC_WORDS and w not in self.exact and w not in self.compact)):
                    continue
                out.append(w); seen.add(w)
        return out

    def _allowed(self, rec: dict, hint: str | None, drop: bool, window: str, exact: bool) -> bool:
        kind = rec["kind"]
        if rec["generic"] and not exact:
            return False
        if rec["generic"] and not (drop or hint):
            # Bare full name ("The Awakened", "The Doctor") is a drop report.
            # A generic word inside another sentence ("I'm a doctor") is not.
            wn = item_norm(window)
            full = item_norm(rec["name"])
            if wn != full and strip_the(wn) != strip_the(full) and len(core_tokens(wn)) <= 1:
                return False
        if kind == "viscera" and hint != "viscera" and not (exact and drop):
            return False
        if kind == "fate" and hint != "fate" and not exact:
            return False
        if kind == "base" and hint is None and not exact:
            return False
        return True

    def _consider(self, best, rec, sc, exact, hint):
        high, low = self._threshold(rec["name"], rec["generic"])
        if exact:
            conf, sc = "high", max(sc, 100.0)
        elif phonetic_key(rec["name"]) and len(rec["phonetic"]) >= 4 and sc >= 75:
            # phonetic promotion happens at the call site by raising sc
            conf = "high" if sc >= 82 else ("low" if sc >= 75 else None)
            if conf is None:
                return best
        elif sc >= high:
            conf = "high"
        elif sc >= low:
            conf = "low"
        else:
            return best
        hint_bonus = 0
        if hint and rec["kind"] == hint:
            hint_bonus = 5
        elif hint and rec["kind"] != hint:
            hint_bonus = -2
        key = (sc + hint_bonus, -KIND_RANK.get(rec["kind"], 9), len(rec["compact"]), 1 if conf == "high" else 0)
        if best is None or key > best[0]:
            return (key, rec, sc, conf, exact)
        return best

    def match(self, clause: str):
        """Best dictionary item in the clause, or None.

        Returns {name, kind, score, confidence} with confidence 'high' or 'low'.
        """
        if not clause or not self.records:
            return None
        raw, stripped, hint, drop = self._prepare(clause)
        ctx = bool(hint or drop)
        windows, seen = [], set()
        for src in (raw, stripped):
            if not src:
                continue
            for w in self._windows(src):
                if w not in seen:
                    windows.append(w); seen.add(w)

        best = None

        # Pass 1: exact and compact-exact (cheap, covers almost every clean utterance)
        for w in windows:
            wn = item_norm(w)
            if not wn:
                continue
            ids = []
            for key in (wn, strip_the(wn)):
                ids.extend(self.exact.get(key, ()))
                if ctx:
                    ids.extend(self.exact_ctx.get(key, ()))
            c = compact(wn)
            if len(c) >= 3:
                ids.extend(self.compact.get(c, ()))
                if ctx:
                    ids.extend(self.compact_ctx.get(c, ()))
            if not ids:
                continue
            seen_i = set()
            for i in ids:
                if i in seen_i:
                    continue
                seen_i.add(i)
                rec = self.records[i]
                exact = wn in rec["norms"] or strip_the(wn) in rec["norms"] or compact(wn) == rec["compact"]
                if ctx and not exact:
                    exact = wn in rec["ctx_norms"] or strip_the(wn) in rec["ctx_norms"]
                if not self._allowed(rec, hint, drop, wn, exact=True):
                    continue
                sc = 100.0 if exact else self._best_score(wn, rec)[0]
                if sc >= 99:
                    exact = True
                best = self._consider(best, rec, sc, exact, hint)

        # If we already have a solid exact hit on a real name, skip fuzzy work.
        if best and best[4] and len(best[1]["compact"]) >= 6:
            rec, sc, conf = best[1], best[2], best[3]
            return {"name": rec["name"], "kind": rec["kind"], "score": round(min(sc, 100.0), 1), "confidence": conf}

        # Pass 2: phonetic key (handles "porky pine" → Porcupine)
        for w in windows:
            wn = item_norm(w)
            pk = phonetic_key(wn)
            if len(pk) < 4:
                continue
            for i in self.phonetic.get(pk, ()):
                rec = self.records[i]
                sc, exact = self._best_score(wn, rec)
                if rec["phonetic"] == pk:
                    sc = max(sc, 88.0)
                if not self._allowed(rec, hint, drop, wn, exact or sc >= 99):
                    continue
                best = self._consider(best, rec, sc, exact, hint)

        if best and best[3] == "high" and best[2] >= 90:
            rec, sc, conf = best[1], best[2], best[3]
            return {"name": rec["name"], "kind": rec["kind"], "score": round(min(sc, 100.0), 1), "confidence": conf}

        # Pass 3: fuzzy over a small candidate set (shared distinctive tokens, or
        # a first-letter + length bucket for 1–2 token windows).
        candidates = set()
        for w in windows:
            wn = item_norm(w)
            for t in core_tokens(wn):
                if len(t) >= 3 and t not in GENERIC_WORDS:
                    candidates.update(self.token.get(t, ()))
            c = compact(wn)
            # cheap bucket only for short name-like windows (e.g. "maj blood")
            if 6 <= len(c) <= 16 and len(wn.split()) <= 3:
                for L in range(max(5, len(c) - 2), len(c) + 3):
                    candidates.update(self.by_bucket.get((c[0], L), ()))

        if len(candidates) > 80:
            # Prefer items that share a token; fall back to the length bucket only if needed
            tokenish = set()
            for w in windows:
                for t in core_tokens(w):
                    if len(t) >= 3 and t not in GENERIC_WORDS:
                        tokenish.update(self.token.get(t, ()))
            candidates = tokenish or set(list(candidates)[:80])

        for w in windows:
            wn = item_norm(w)
            if len(compact(wn)) < 6:
                continue
            for i in candidates:
                rec = self.records[i]
                sc, exact = self._best_score(wn, rec)
                if sc < 80:
                    continue
                if not self._allowed(rec, hint, drop, wn, exact or sc >= 99):
                    continue
                best = self._consider(best, rec, sc, exact, hint)

        if not best:
            return None
        rec, sc, conf = best[1], best[2], best[3]
        return {
            "name": rec["name"],
            "kind": rec["kind"],
            "score": round(min(sc, 100.0), 1),
            "confidence": conf,
        }


def load_name_index(path: Path | None = None) -> NameIndex:
    path = path or (HERE / "poe_names.json")
    if not path.exists():
        return NameIndex([], version="missing")
    doc = json.loads(path.read_text(encoding="utf-8"))
    items = doc.get("items") or []
    return NameIndex(items, version=doc.get("version", ""), meta=doc)


_INDEX: NameIndex | None = None
_INDEX_MS = 0.0


def get_index() -> NameIndex:
    global _INDEX, _INDEX_MS
    if _INDEX is None:
        t0 = time.perf_counter()
        _INDEX = load_name_index()
        _INDEX_MS = (time.perf_counter() - t0) * 1000
    return _INDEX
