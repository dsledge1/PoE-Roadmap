"""v3 data tests: PoB importer (the reference PoB as the main fixture, plus a synthetic one), Fate/viscera data,
tree data. The reference PoB XML is not in the repo: point POE_REFERENCE_POB at it to run those checks; otherwise
they run against the embedded example build (../src/gen/default_build.json, made from it).
Run: python test_v3_data.py"""
import base64, json, os, sys, tempfile, zlib
from pathlib import Path
os.environ.setdefault("POE_COMPANION_LOG_DIR", tempfile.mkdtemp(prefix="poelog_"))
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import pob_import as P  # noqa: E402
import fates as F  # noqa: E402

REF = Path(os.environ.get("POE_REFERENCE_POB", "") or "/nonexistent/reference_pob.xml")
DEFAULT = HERE.parent / "src" / "gen" / "default_build.json"
R = []


def check(name, cond, info=""):
    R.append(bool(cond)); print(("ok   " if cond else "FAIL ") + name + (f"  [{info}]" if info and not cond else ""))


SYN = """<PathOfBuilding><Build level="20" className="Witch" ascendClassName="Necromancer"/>
<Skills activeSkillSet="1">
 <SkillSet id="1" title="^6Act 1">
  <Skill label="==== Main Skills ====" enabled="true"></Skill>
  <Skill label="Before minions (Replace when you get srs)" enabled="true"><Gem nameSpec="Rolling Magma" enabled="true"/><Gem nameSpec="Arcane Surge" enabled="true"/></Skill>
  <Skill label="^xE05030MAIN DMG SRS" enabled="true"><Gem nameSpec="Summon Raging Spirit" enabled="true"/><Gem nameSpec="Minion Damage" enabled="true"/></Skill>
  <Skill label="" enabled="true"></Skill>
  <Skill label="==== Utility ====" enabled="true"></Skill>
  <Skill label="Mobility" enabled="true"><Gem nameSpec="Flame Dash" enabled="true"/></Skill>
  <Skill label="Flesh offering" enabled="true"><Gem nameSpec="Flesh Offering" enabled="true"/></Skill>
 </SkillSet>
 <SkillSet id="2" title="^5Lvl70 Early mapping {1}">
  <Skill enabled="true"><Gem nameSpec="Raise Spectre" enabled="true"/><Gem nameSpec="Minion Damage" enabled="true"/><Gem nameSpec="Spell Echo" enabled="true"/></Skill>
  <Skill enabled="true"><Gem nameSpec="Clarity" enabled="true"/></Skill>
 </SkillSet>
</Skills>
<Tree activeSpec="1">
 <Spec title="Act 1" treeVersion="3_29" classId="3" nodes="54447,57264,37569"/>
 <Spec title="^2Early {1}" treeVersion="3_29" classId="3" nodes="54447,57264,37569,36542"/>
</Tree></PathOfBuilding>"""


def main():
    # --- basics
    check("strip colour codes ^6 / ^xRRGGBB", P.strip_codes("^6Act ^xE05030MAIN ^5x") == "Act MAIN x")
    check("{n} tag read", P.tag_of("^6Late Umbral Army {3}") == 3 and P.clean_title("^6Late Umbral Army {3}") == "Late Umbral Army")
    code = base64.urlsafe_b64encode(zlib.compress(SYN.encode())).decode()
    check("decode: PoB export code", P.decode(code).startswith("<PathOfBuilding"))
    seen = []
    def fake(url): seen.append(url); return code
    P.decode("https://pobb.in/AbC123", fetch=fake); P.decode("https://poe.ninja/pob/xyz9", fetch=fake)
    check("decode: pobb.in -> /raw, poe.ninja -> /pob/raw", seen == ["https://pobb.in/AbC123/raw", "https://poe.ninja/pob/raw/xyz9"], seen)
    check("stage titles: 'Act 4-10' range", P.stages_for_title("Act 4-10")[:2] == ["A4", "A5"] and "A10" in P.stages_for_title("Act 4-10"), P.stages_for_title("Act 4-10"))
    # --- synthetic build
    c = P.import_build(SYN)
    s1 = c["sets"][0]
    names = [g["name"] for g in s1["groups"]]
    check("separators + section headers skipped as groups", names == ["Before minions", "MAIN DMG SRS", "Mobility", "Flesh offering"], names)
    check("section header -> category hint", [g["cat"] for g in s1["groups"]] == ["main", "main", "movement", "utility"], [g["cat"] for g in s1["groups"]])
    check("label note kept", s1["groups"][0]["note"] == "Replace when you get srs")
    check("gem colours from PoB data", [x["c"] for x in s1["groups"][0]["gems"]] == ["b", "b"] and s1["groups"][2]["gems"][0]["c"] == "b")
    check("unlabelled set: biggest damage group is main", c["sets"][1]["groups"][0]["cat"] in ("main", "minions"), c["sets"][1]["groups"])
    check("map set paired with spec by {n} tag", c["stages"]["EM"]["variants"][0] == {"set": 1, "spec": 1}, c["stages"]["EM"])
    check("acts without their own set inherit Act 1", c["stages"]["A2"]["variants"][0]["set"] == 0)
    # --- reference PoB (not in the repo) or the embedded default made from it
    if REF.exists():
        d = P.import_build(REF.read_text(encoding="utf-8"))
        src = "reference PoB"
    elif DEFAULT.exists():
        d = json.loads(DEFAULT.read_text(encoding="utf-8")); src = "embedded default"
    else:
        cfg = HERE / "build_config.json"
        d = json.loads(cfg.read_text(encoding="utf-8")) if cfg.exists() else None; src = "voice/build_config.json"
    print("   fixture:", src if d else "none (skipping the reference-PoB-only checks)")
    if d is None or d.get("name") and "Necromancer" not in json.dumps(d)[:2000]:
        d = None
    if d:
        st = d["stages"]
        title = lambda stg, i=0: d["sets"][st[stg]["variants"][i]["set"]]["clean"]
        spec = lambda stg, i=0: d["specs"][st[stg]["variants"][i]["spec"]]["clean"]
        check("Ref: Witch Necromancer, 17 sets, 23 specs", d["className"] == "Witch" and d["ascendancy"] == "Necromancer" and len(d["sets"]) == 17 and len(d["specs"]) == 23)
        check("Ref: A1-A3 own sets + trees", [title(f"A{i}") for i in (1, 2, 3)] == ["Act 1", "Act 2", "Act 3"] and [spec(f"A{i}") for i in (1, 2, 3)] == ["Act 1", "Act 2", "Act 3"])
        check("Ref: A4-A10 use 'Act 4-10' with trees Act 4..Act 10", all(title(f"A{i}") == "Act 4-10" and spec(f"A{i}") == f"Act {i}" for i in range(4, 11)))
        check("Ref: early maps = 6 variants, first 'Lvl70 Early mapping' / 'Respec Frostbearers'", len(st["EM"]["variants"]) == 6 and title("EM") == "Lvl70 Early mapping" and spec("EM") == "Respec Frostbearers", (title("EM"), spec("EM")))
        check("Ref: mid maps Mid Dark Monarch, late maps 6 variants", title("MM") == "Mid Dark Monarch" and len(st["LM"]["variants"]) == 6)
        check("Ref: nothing unassigned", not any((d.get("unassigned") or {}).values()), d.get("unassigned"))
        a1 = d["sets"][st["A1"]["variants"][0]["set"]]["groups"]
        mains = [g["name"] for g in a1 if g["cat"] == "main"]
        check("Ref Act 1: main in PoB order (Rolling Magma, then SRS, then Absolution)", mains[:3] == ["Before minions", "MAIN DMG SRS", "Lvl 12 Absolution"], mains)
        rm = a1[[g["name"] for g in a1].index("Before minions")]
        check("Ref Act 1: Rolling Magma + Arcane Surge + Added Lightning, note 'Replace when you get srs'", [x["n"] for x in rm["gems"]][:3] == ["Rolling Magma", "Arcane Surge", "Added Lightning Damage"] and rm["note"].lower() == "replace when you get srs")
        cats = {g["name"]: g["cat"] for g in a1}
        check("Ref Act 1: Mobility/Shield charge movement, Vit & Clarity auras, Flesh offering utility", cats.get("Mobility") == "movement" and cats.get("Vit & Clarity") == "auras" and cats.get("Flesh offering at lvl 12") == "utility" and any(v == "movement" and "Shield" in k for k, v in cats.items()), cats)
        alltxt = json.dumps(d)
        check("Ref: no colour codes left anywhere", "^x" not in alltxt and not any(f"^{i}" in alltxt for i in range(10)))

    # --- tree data
    tr = P.slim_tree("3_29")
    n = tr["nodes"]
    check("tree 3_29: nodes + edges + class starts", len(n) > 2000 and len(tr["edges"]) > 2000 and tr["starts"].get("3") == "54447", (len(n), tr["starts"]))
    check("tree: Act 1 notables named", n["7688"][3] == "Enduring Bond" and n["11420"][3] == "Arcanist's Dominion")
    # --- Fates / viscera
    wt = """{| class="wikitable"
|+ List of regular viscera
! Icon !! Slot !! Name !! Requirements !! Description !! Boss !! Location
|-
| rowspan="2" | [[File:x.png]] || rowspan="2" | Head || [[Lesser Siren's Tentacle]] || Level 1 || (10-15)% increased Effect of Cold Ailments || rowspan="2" | [[Merveil, the Siren]] || rowspan="2" | [[The Cavern of Anger]] (Act 1)
|-
| [[Siren's Tentacle]] || Level 1 || TBA
|}"""
    v = F.parse_viscera(wt)
    check("viscera table parsed with rowspans", len(v) == 2 and v[1]["boss"] == "Merveil, the Siren" and v[1]["slot"] == "Head" and v[1]["act"] == 1 and v[0]["tier"] == "Lesser" and v[1]["tier"] == "Normal", v)
    check("viscera 'TBA' reward -> None (shown as currently unknown)", v[1]["desc"] is None and v[0]["desc"].startswith("(10-15)%"), v)
    cache = F.load()
    if cache and cache.get("bosses"):
        b = cache["bosses"]
        check("Fate cache: campaign bosses with acts", sum(1 for x in b.values() if x.get("act")) >= 60, len(b))
        mv = b.get("Merveil, the Siren") or {}
        check("Fate cache: Merveil -> Siren's Tentacle reward", any("Cold Ailments" in (x.get("reward") or "") for x in mv.get("viscera", [])), mv)
        check("Fate cache: Fate cards listed", len(cache.get("fates") or {}) >= 15)
    else:
        print("   (no Fate cache yet: run companion.py --fetch-fates)")
    print(f"\n{sum(R)}/{len(R)} v3 data checks passed")
    return all(R)


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
