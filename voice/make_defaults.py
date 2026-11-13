"""Writes the data build.js embeds in poe_tracker.html:
  src/gen/default_build.json  - the embedded example build, from a PoB you pass in (XML file, export code file or pobb.in link)
  src/gen/tree_<ver>.json     - slim passive tree (positions, kinds, names, edges) for every tree version in use
  src/gen/fates.json          - Fate / Viscera snapshot (voice/cache/fates.json)
Run after changing the PoB or the PoB data:  python make_defaults.py path/to/build.xml   (or set POE_DEFAULT_POB)
Without a PoB it keeps the current default_build.json and only refreshes the tree and Fate data."""
import os
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import pob_import  # noqa: E402

OUT = HERE.parent / "src" / "gen"
EXAMPLE_NAME = "Example build: Frostbearer Spectre Necromancer"


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    arg = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("POE_DEFAULT_POB", "")
    if arg:
        src = Path(arg).read_text(encoding="utf-8") if Path(arg).exists() else arg
        cfg = pob_import.import_build(src)
        cfg["name"] = os.environ.get("POE_DEFAULT_NAME", EXAMPLE_NAME)
        cfg["source"] = {"kind": "default", "file": "default demo build"}   # never embed the source file name or path
        (OUT / "default_build.json").write_text(json.dumps(cfg, separators=(",", ":")), encoding="utf-8")
    else:
        cfg = json.loads((OUT / "default_build.json").read_text(encoding="utf-8"))
        print("no PoB given: kept src/gen/default_build.json")
    vers = sorted({p["treeVersion"] for p in cfg["specs"] if p["treeVersion"]} | {"3_29"})
    for v in vers:
        if (pob_import.DATA / f"tree_{v}.json").exists():
            (OUT / f"tree_{v}.json").write_text(json.dumps(pob_import.slim_tree(v), separators=(",", ":")), encoding="utf-8")
    f = HERE / "cache" / "fates.json"
    if f.exists():
        (OUT / "fates.json").write_text(json.dumps(json.loads(f.read_text(encoding="utf-8")), separators=(",", ":")), encoding="utf-8")
    print(pob_import.summary(cfg))
    for p in sorted(OUT.iterdir()):
        print(f"{p.name}: {p.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
