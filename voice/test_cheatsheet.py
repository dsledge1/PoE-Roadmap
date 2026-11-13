"""Every phrase in docs/GETTING_STARTED.md's voice cheat sheet parses to the documented action.
Run: python test_cheatsheet.py"""
import os, sys, tempfile
from pathlib import Path
os.environ.setdefault("POE_COMPANION_LOG_DIR", tempfile.mkdtemp(prefix="poelog_"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import companion  # noqa: E402

# phrase -> (action type, extra fields that must match on the first action)
CASES = [
    ("act 3 done", "milestone", {"act": 3}), ("Malachai down", "milestone", {"boss": True}), ("act 5 Kitava done", "milestone", {"kitava": 5}),
    ("lab done", "milestone", {"lab": "next"}), ("started mapping", "milestone", {}),
    ("I'm in act 2, not act 3", "set_act", {"act": 2, "was": 3}), ("set act to 4", "set_act", {"act": 4}),
    ("pause timer", "pause", {}), ("taking a break", "pause", {}), ("resume", "resume", {}), ("I'm back", "resume", {}),
    ("what's next", "query", {"what": "next"}), ("how am I doing", "query", {"what": "pace"}),
    ("fire 75 cold 75 lightning 60 chaos minus 20", "def", {"field": "fire", "value": 75}), ("res are 76 75 75", "def", {"field": "fire", "value": 76}),
    ("life 4000 and energy shield 1200", "def", {"field": "life_es", "life": 4000, "es": 1200}), ("pool 5200", "def", {"field": "pool", "value": 5200}),
    ("level 44", "def", {"field": "level", "value": 44}), ("attack block 20", "def", {"field": "ablock", "value": 20}), ("spell block 15", "def", {"field": "block", "value": 15}),
    ("what are my res", "query", {"what": "res"}), ("scan my defences", "ocr", {"what": "scan"}), ("confirm", "ocr", {"what": "confirm"}), ("discard", "ocr", {"what": "discard"}),
    ("what are my links", "query", {"what": "links"}), ("act 1 main attack", "query", {"what": "links", "focus": "main", "act": 1}),
    ("what's my movement", "query", {"what": "links", "focus": "movement"}), ("utility links in act 5", "query", {"what": "links", "focus": "utility", "act": 5}),
    ("early maps main attack", "query", {"what": "links", "stage": "EM"}), ("what are my spectres", "query", {"what": "links", "focus": "spectres"}),
    ("main attack links only", "query", {"what": "links", "focus": "main"}),
    ("dropped a 4 link", "log", {"text": "4-link"}), ("found a 5 link", "log", {"text": "5-link"}), ("near death", "log", {}), ("I died", "log", {}), ("reached tier 6", "log", {"text": "Reached T6"}),
    ("add drop type mirror shard", "custom_type", {"op": "add", "kind": "drop"}), ("add event type boss down", "custom_type", {"op": "add", "kind": "event"}),
    ("rename drop type mirror shard to shard", "custom_type", {"op": "rename"}), ("delete drop type shard", "custom_type", {"op": "delete"}),
    ("Fate boss Merveil", "query", {"what": "fate_info", "boss": "merveil"}), ("fate reward for Merveil", "query", {"what": "fate_info"}),
    ("going to try Merveil with 1 fate", "fate_attempt", {"fates": 1}), ("killed Brutus with one fate", "kill", {"boss": "Brutus", "fates": 1}),
    ("add chase item Shavronne's Wrappings from Delve", "chase", {"op": "add", "content": "Delve"}), ("chase done Darkness Enthroned", "chase", {"op": "done"}),
    ("what's left on my chase", "query", {"what": "chase"}),
    ("research Desecrate", "research", {}), ("look up Bones of Ullr", "research", {"query": "Bones of Ullr"}), ("wiki Forged Frostbearer", "research", {}),
    ("where does the Cane of Kulemak drop", "query", {"what": "drop_where"}), ("vendor recipe for a physical weapon", "research", {"topic": "recipe"}),
    ("any news on Fates?", "query", {"what": "news"}), ("yes", "yes", {}),
    ("undo", "undo", {}), ("never mind", "undo", {}), ("repeat that", "local", {"what": "repeat"}), ("mute", "local", {"what": "mute"}), ("unmute", "local", {"what": "unmute"}),
]


def main():
    ok = 0
    for text, typ, extra in CASES:
        acts = companion.parse(text)
        a = acts[0] if acts else {}
        good = a.get("type") == typ and all(a.get(k) == v for k, v in extra.items())
        ok += good
        if not good:
            print(f"FAIL {text!r}: {acts}")
    print(f"cheat sheet: {ok}/{len(CASES)}")
    return ok == len(CASES)


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
