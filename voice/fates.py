"""Fate / Viscera boss data for the tracker's per-boss panel.

Sources (read-only HTTP, cached to voice/cache/fates.json):
  * poewiki "Viscera"   -> which boss (and area / act) drops which viscera, per tier (Lesser / normal / Greater)
  * poedb.tw "Wickerman" -> the viscera mod text by name (Low / Med / High = Lesser / normal / Greater)
  * poewiki "Fate"      -> what each Fate card adds to the fight (the "added danger")
Anything missing stays None and the page shows "currently unknown". Nothing here touches the game.
Run: python companion.py --fetch-fates   (or python fates.py)
"""
from __future__ import annotations

import json
import re
import threading
import time
from pathlib import Path

try:
    from research import HTTP, html_to_lines, clean_wikitext
except ImportError:  # run from another cwd
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from research import HTTP, html_to_lines, clean_wikitext

HERE = Path(__file__).resolve().parent
CACHE = HERE / "cache" / "fates.json"
WIKI_API = "https://www.poewiki.net/w/api.php"
POEDB_WICKERMAN = "https://poedb.tw/us/Wickerman"
MAX_AGE_S = 6 * 3600
_LOCK = threading.Lock()


def _wikitext(page, http=HTTP, timeout=8):
    d = http.get_json(WIKI_API, {"action": "parse", "page": page, "prop": "wikitext", "redirects": 1, "format": "json", "formatversion": 2}, timeout)
    return ((d.get("parse") or {}).get("wikitext")) or ""


def _cell(c: str) -> tuple[str, int]:
    """Wikitable cell -> (text, rowspan)."""
    rs = 1
    m = re.match(r'\s*rowspan="?(\d+)"?\s*\|(.*)$', c, flags=re.S)
    if m:
        rs, c = int(m.group(1)), m.group(2)
    return c.strip(), rs


def parse_wikitable(wt: str, caption_re: str):
    """Rows of the first wikitable whose caption matches; rowspans expanded."""
    m = re.search(r"\{\|[^\n]*\n\|\+\s*" + caption_re + r".*?\n(.*?)\n\|\}", wt, flags=re.S | re.I)
    if not m:
        return [], []
    body = m.group(1)
    rows = [r for r in re.split(r"\n\|-[^\n]*", "\n" + body) if r.strip()]
    header, out, pending = [], [], {}
    for r in rows:
        r = r.strip("\n")
        if r.lstrip().startswith("!"):
            header = [clean_wikitext(x).strip() for x in re.split(r"!!|\n!", r.lstrip()[1:])]
            continue
        if not r.lstrip().startswith("|"):
            continue
        raw = re.split(r"\|\||\n\|", r.lstrip()[1:])
        cells = [_cell(x) for x in raw]
        row, ci, k = [], 0, 0
        ncol = max(len(header), 1)
        while ci < ncol and (k < len(cells) or ci in pending):
            if ci in pending:
                txt, left = pending[ci]
                row.append(txt)
                pending[ci] = (txt, left - 1) if left > 1 else None
                if pending[ci] is None:
                    del pending[ci]
            else:
                txt, rs = cells[k]; k += 1
                row.append(txt)
                if rs > 1:
                    pending[ci] = (txt, rs - 1)
            ci += 1
        out.append(row)
    return header, out


def _link_text(s: str) -> str:
    s = re.sub(r"\[\[File:[^\]]*\]\]", "", s)
    return clean_wikitext(s).strip()


def parse_viscera(wt: str):
    header, rows = parse_wikitable(wt, r"List of regular viscera")
    out = []
    for r in rows:
        if len(r) < 7:
            continue
        _, slot, name, _req, desc, boss, loc = [x for x in r[:7]]
        name, boss, loc_t = _link_text(name), _link_text(boss), _link_text(loc)
        desc_t = clean_wikitext(re.sub(r"\(Temporary anti-plagiarism note[^)]*\)", "", desc))
        act = re.search(r"\(Act (\d+)\)", loc) or re.search(r"Act (\d+)", loc_t)
        tier = "Greater" if name.startswith("Greater ") else "Lesser" if name.startswith("Lesser ") else "Normal"
        base = re.sub(r"^(Greater|Lesser) ", "", name)
        out.append({"slot": _link_text(slot), "name": name, "base": base, "tier": tier,
                    "desc": None if not desc_t or desc_t.upper().startswith("TBA") else desc_t,
                    "boss": None if boss in ("", "TBA") else boss,
                    "area": re.sub(r"\s*\(Act \d+\)", "", loc_t) if loc_t not in ("", "TBA") else None,
                    "act": int(act.group(1)) if act else None})
    return out


def parse_fate_list(wt: str):
    header, rows = parse_wikitable(wt, r"List of Fates")
    out = {}
    for r in rows:
        if not r or not r[0].strip():
            continue
        name = _link_text(r[0])
        g = lambda i: (clean_wikitext(r[i].replace("<br>", "; ")) if len(r) > i and r[i].strip() else None)  # noqa: E731
        out[name] = {"short": g(1), "long": g(2), "empower": g(3), "duplicate": g(4)}
    return out


def parse_poedb_wickerman(h: str):
    """{base name: {"slot": ..., "Low": ..., "Med": ..., "High": ..., "fixed": ...}} from the poedb Wickerman page."""
    lines = html_to_lines(h)
    out, cur = {}, None
    try:
        start = lines.index("NameSlotVariants") + 1
    except ValueError:
        return out
    for ln in lines[start:]:
        if ln.startswith(("Edit", "Wikis Content")):
            break
        m = re.match(r"^(.+?)(Head|Torso|Upper Limb|Lower Limb|Pinnacle|Special)(.*)$", ln)
        if m and not re.match(r"^(High|Low|Med|Queen|\d):", ln) and m.group(1).strip() not in ("", "Upper", "Lower"):
            cur = m.group(1).strip()
            out[cur] = {"slot": m.group(2)}
            rest = m.group(3).strip()
            ln = rest
            if not ln:
                continue
        if cur is None:
            continue
        v = re.match(r"^(High|Low|Med|Queen|\d):\s*(.*)$", ln)
        if v:
            key = {"1": "Low", "2": "Med", "3": "High"}.get(v.group(1), v.group(1))
            out[cur][key] = v.group(2).strip()
            out[cur]["_last"] = key
        else:
            k = out[cur].get("_last") or "fixed"
            out[cur][k] = ((out[cur].get(k) or "") + " " + ln).strip()
            if k == "fixed":
                out[cur]["_last"] = "fixed"
    for v in out.values():
        v.pop("_last", None)
    return out


TIER_KEY = {"Lesser": "Low", "Normal": "Med", "Greater": "High"}


def build(viscera, fates, poedb, fetched=None):
    bosses = {}
    for v in viscera:
        if not v["boss"]:
            continue
        b = bosses.setdefault(v["boss"], {"boss": v["boss"], "area": v["area"], "act": v["act"], "viscera": []})
        mods = poedb.get(v["base"]) or {}
        reward = v["desc"] or mods.get(TIER_KEY[v["tier"]]) or mods.get("fixed")
        if reward and re.fullmatch(r"(Head|Torso|Upper Limb|Lower Limb)", reward.strip()):
            reward = None
        b["viscera"].append({"name": v["name"], "slot": v["slot"] or mods.get("slot"), "tier": v["tier"], "reward": reward,
                             "source": "poewiki" if v["desc"] else ("poedb" if reward else None),
                             "queen": mods.get("Queen")})
    return {"version": 1, "fetched": fetched or time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "sources": {"viscera": "https://www.poewiki.net/wiki/Viscera", "mods": POEDB_WICKERMAN, "fates": "https://www.poewiki.net/wiki/Fate"},
            "bosses": bosses, "fates": fates,
            "danger_note": "Added danger depends on the Fate cards you pick at the cauldron (up to 3); see the Fate list. Boss-specific changes: currently unknown."}


def fetch(http=HTTP):
    errs = []
    try:
        visc = parse_viscera(_wikitext("Viscera", http))
    except Exception as e:  # noqa: BLE001
        visc, errs = [], errs + [f"poewiki Viscera: {e}"]
    try:
        fl = parse_fate_list(_wikitext("Fate", http))
    except Exception as e:  # noqa: BLE001
        fl, errs = {}, errs + [f"poewiki Fate: {e}"]
    try:
        pdb = parse_poedb_wickerman(http.get_text(POEDB_WICKERMAN, 10))
    except Exception as e:  # noqa: BLE001
        pdb, errs = {}, errs + [f"poedb Wickerman: {e}"]
    d = build(visc, fl, pdb)
    d["errors"] = errs
    return d


def load():
    try:
        return json.loads(CACHE.read_text(encoding="utf-8"))
    except Exception:
        return None


def refresh(force=False, http=HTTP):
    with _LOCK:
        cur = load()
        if cur and not force and time.time() - CACHE.stat().st_mtime < MAX_AGE_S:
            return cur
        d = fetch(http)
        if d["bosses"] or not cur:      # never replace good data with an empty (offline) result
            CACHE.parent.mkdir(parents=True, exist_ok=True)
            CACHE.write_text(json.dumps(d, ensure_ascii=False, indent=0), encoding="utf-8")
            return d
        cur["errors"] = d["errors"]
        return cur


def summary(d):
    b = d.get("bosses") or {}
    camp = [x for x in b.values() if x.get("act")]
    known = sum(1 for x in b.values() for v in x["viscera"] if v["reward"])
    total = sum(len(x["viscera"]) for x in b.values())
    lines = [f"{len(b)} Fate bosses ({len(camp)} campaign, {len(b) - len(camp)} map), {total} viscera, {known} with a known reward; "
             f"{len(d.get('fates') or {})} Fate cards ({sum(1 for f in (d.get('fates') or {}).values() if f.get('long'))} with full text). Fetched {d.get('fetched')}."]
    for e in d.get("errors") or []:
        lines.append("warning: " + e)
    return "\n".join(lines)


if __name__ == "__main__":
    print(summary(refresh(force=True)))
