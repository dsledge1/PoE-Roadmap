"""Parser accuracy test. Run: python test_parser.py  (or pytest test_parser.py)
Each case: phrase -> expected action signatures (order-insensitive, exact set)."""
import sys, time
from companion import parse

def sig(a):
    t = a["type"]
    if t == "log":
        if a.get("kind") == "note": return "note"
        return "log:" + a["text"]
    if t == "milestone":
        k = [x for x in ("act", "lab", "kitava", "id", "next") if x in a][0]
        return f"ms:{k}={a[k]}"
    if t == "def":
        if a["field"] == "life_es": return f"def:life_es={a['life']}/{a['es']}"
        return f"def:{a['field']}={a['value']}".replace("True", "true").replace("False", "false")
    if t == "kill": return f"kill:{a['boss']}/{a['fates']}"
    if t == "query":
        if a["what"] == "links":
            extra = "".join(f"/{k}={a[k]}" for k in ("level", "act", "maps") if a.get(k) is not None)
            return f"q:links/{a.get('links')}/{a.get('focus')}{extra}"
        if a["what"] == "trigger": return "q:trigger/" + a["item"]
        return "q:" + a["what"]
    if t == "fate_attempt": return f"fate:{a.get('boss') or '?'}/{a['fates']}"
    if t == "research": return "research:" + a["query"]
    if t == "ocr": return "ocr:" + a["what"]
    if t == "undo" and a.get("soft"): return "undo:soft"
    if t == "local": return "local:" + a["what"]
    return t

CANE = "log:Cane of Unravelling"
CASES = [
    # --- drops (exact + misheard)
    ("Got a Cane of Unravelling", [CANE]),
    ("got a cane of unraveling", [CANE]),
    ("Kane of unravelling dropped!", [CANE]),
    ("Cain of Unraveling just dropped", [CANE]),
    ("cane of unravel ling", [CANE]),
    ("I found the cane", [CANE]),
    ("Porcupine card just dropped", ["log:The Porcupine (divination card)"]),
    ("The Porcupine.", ["log:The Porcupine (divination card)"]),
    ("porcupine dropped", ["log:The Porcupine (divination card)"]),
    ("Got three Humility cards", ["log:3x Humility (divination card)"]),
    ("Animate Weapon of Ranged Arms dropped", ["log:Animate Weapon of Ranged Arms"]),
    ("animated weapon of range arms", ["log:Animate Weapon of Ranged Arms"]),
    ("Got Animate Weapon of Ranged Arms gem", ["log:Animate Weapon of Ranged Arms"]),
    ("Storm Burst of Repulsion", ["log:Storm Burst of Repulsion"]),
    ("stormburst of repulsion dropped", ["log:Storm Burst of Repulsion"]),
    ("Dyadian Dawn!", ["log:Dyadian Dawn"]),
    ("diadian dawn just dropped", ["log:Dyadian Dawn"]),
    ("Dyadian Don", ["log:Dyadian Dawn"]),
    ("Sword of Ages dropped", ["log:The Sword of Ages"]),
    ("sort of ages dropped", ["log:The Sword of Ages"]),
    ("Seething Fury", ["log:Seething Fury"]),
    ("seeding fury dropped", ["log:Seething Fury"]),
    ("Allelopathy dropped", ["log:Allelopathy"]),
    ("got an alleopathy", ["log:Allelopathy"]),
    ("staff with 812 pdps", ["log:Staff 812 pDPS"]),
    ("Found a staff, 780 pDPS", ["log:Staff 780 pDPS"]),
    ("staff seven hundred eighty pdps", ["log:Staff 780 pDPS"]),
    ("a staff with eight hundred and twelve physical dps", ["log:Staff 812 pDPS"]),
    ("Orb of chance", ["log:Orb of Chance"]),
    ("Got fugitive boots", ["log:Fugitive Boots"]),
    ("two-toned boots dropped", ["log:Two-Toned Boots"]),
    ("Apothecary's gloves", ["log:Apothecary's Gloves"]),
    ("Divine orb dropped", ["log:Divine Orb"]),
    ("got a divine", ["log:Divine Orb"]),
    ("Tabula Rasa", ["log:Tabula Rasa"]),
    ("goldrim dropped", ["log:Goldrim"]),
    ("Wanderlust", ["log:Wanderlust"]),
    ("Artillery quiver with life and res", ["log:Artillery Quiver"]),
    ("Got Rain of Chaos card", ["log:Rain of Chaos (divination card)"]),
    ("Her Mask card", ["log:Her Mask (divination card)"]),
    ("Got a Headhunter", ["log:Headhunter"]),
    ("Glorious Vanity dropped", ["log:Glorious Vanity"]),
    ("Light of Meaning", ["log:Light of Meaning"]),
    # Spectre Necro (v3)
    ("Got Frostbearers", ["log:Forged Frostbearer captured"]),
    ("frost bearer captured", ["log:Forged Frostbearer captured"]),
    ("Found a verisium outcrop", ["log:Verisium Outcrop found"]),
    ("Bones of Ullr dropped", ["log:Bones of Ullr"]),
    ("bones of uller", ["log:Bones of Ullr"]),
    ("Jinxed Juju!", ["log:The Jinxed Juju"]),
    ("Darkness Enthroned dropped", ["log:Darkness Enthroned"]),
    ("Got the Dark Monarch", ["log:The Dark Monarch"]),
    ("Femurs of the Saints", ["log:Femurs of the Saints"]),
    ("Got a plus two minion helmet", ["log:+2 minion helmet"]),
    ("level 21 raise spectre", ["log:Raise Spectre 21"]),
    # --- milestones
    ("Act 1 done", ["ms:act=1"]),
    ("act one done", ["ms:act=1"]),
    ("act won done", ["ms:act=1"]),
    ("Finished act 2", ["ms:act=2"]),
    ("act to done", ["ms:act=2"]),
    ("act 3 complete", ["ms:act=3"]),
    ("act tree finished", ["ms:act=3"]),
    ("act four done", ["ms:act=4"]),
    ("act for done", ["ms:act=4"]),
    ("Done with act 6", ["ms:act=6"]),
    ("act seven cleared", ["ms:act=7"]),
    ("Act 8 done.", ["ms:act=8"]),
    ("act ate done", ["ms:act=8"]),
    ("finished act nine", ["ms:act=9"]),
    ("Finished act ten", ["ms:act=10"]),
    ("act 10 done", ["ms:act=10"]),
    ("Starting act 4", ["ms:act=3"]),
    ("on to act seven", ["ms:act=6"]),
    ("Finished Act 10, resistances aren't capped", ["ms:act=10", "def:ele=false"]),
    ("Act 5 done and res is capped", ["ms:act=5", "def:ele=true"]),
    ("lab done", ["ms:lab=next"]),
    ("Lab's done", ["ms:lab=next"]),
    ("Normal lab done", ["ms:lab=normal"]),
    ("cruel lab finished", ["ms:lab=cruel"]),
    ("Crew lab done", ["ms:lab=cruel"]),
    ("Merciless lab done", ["ms:lab=merciless"]),
    ("Ascended", ["ms:lab=next"]),
    ("did the lab", ["ms:lab=next"]),
    ("Kitava done", ["ms:kitava=next"]),
    ("Kitava's dead", ["ms:kitava=next"]),
    ("killed kitava", ["ms:kitava=next"]),
    ("Ketava down", ["ms:kitava=next"]),
    ("Kitaba is dead", ["ms:kitava=next"]),
    ("act 5 Kitava down", ["ms:kitava=5"]),
    ("Got the staff and the skill point", ["ms:id=M11"]),
    ("staff and skill point done", ["ms:id=M11"]),
    ("started mapping", ["ms:id=M15"]),
    ("Next milestone", ["ms:next=True"]),
    ("checkpoint done", ["ms:next=True"]),
    # --- defence
    ("chaos res thirty", ["def:chaos=30"]),
    ("Chaos res 30.", ["def:chaos=30"]),
    ("chaos resistance is at 35%", ["def:chaos=35"]),
    ("kaos res 45", ["def:chaos=45"]),
    ("chaos res minus twelve", ["def:chaos=-12"]),
    ("chaos negative 20", ["def:chaos=-20"]),
    ("chaos is capped", ["def:chaos=75"]),
    ("life four thousand two hundred", ["def:life_es=4200/None"]),
    ("Life 4,200", ["def:life_es=4200/None"]),
    ("life is 4.2k", ["def:life_es=4200/None"]),
    ("life forty two hundred", ["def:life_es=4200/None"]),
    ("life 3700 es 2500", ["def:life_es=3700/2500"]),
    ("energy shield two thousand five hundred", ["def:life_es=None/2500"]),
    ("pool 6000", ["def:pool=6000"]),
    ("life and ES 6200", ["def:pool=6200"]),
    ("EHP 60k", ["note"]),   # v3: EHP / max hit removed (not useful; PoB-style EHP is a TODO)
    ("effective hp one hundred and thirteen thousand", ["note"]),
    ("max hit 6500", ["note"]),
    ("phys max hit is ten thousand five hundred", ["note"]),
    ("spell block 55", ["def:block=55"]),
    ("level 24", ["def:level=24"]),
    ("I'm level sixty eight", ["def:level=68"]),
    ("Resistances are capped", ["def:ele=true"]),
    ("res capped", ["def:ele=true"]),
    ("all res capped", ["def:ele=true"]),
    ("res not capped", ["def:ele=false"]),
    ("fire res isn't capped", ["def:ele=false"]),
    ("resists are uncapped", ["def:ele=false"]),
    ("Cold res is low", ["def:ele=false"]),
    ("res overcapped", ["def:over=true", "def:ele=true"]),
    ("chaos res 30 and life 4500", ["def:chaos=30", "def:life_es=4500/None"]),
    ("res capped, chaos 40, life 5000, es 1200", ["def:ele=true", "def:chaos=40", "def:life_es=5000/1200"]),
    # --- events
    ("near death", ["log:Near-death (flasks empty / pool < 30%)"]),
    ("Near death!", ["log:Near-death (flasks empty / pool < 30%)"]),
    ("nearly died", ["log:Near-death (flasks empty / pool < 30%)"]),
    ("that was close", ["log:Near-death (flasks empty / pool < 30%)"]),
    ("almost died to Brutus", ["log:Near-death (flasks empty / pool < 30%)"]),
    ("near deaf", ["log:Near-death (flasks empty / pool < 30%)"]),
    ("died", ["log:Death (character died)"]),
    ("I died.", ["log:Death (character died)"]),
    ("I just died to Malachai", ["log:Death (character died)"]),
    ("rip", ["log:Death (character died)"]),
    ("got one shot", ["log:Death (character died)"]),
    ("Character died", ["log:Death (character died)"]),
    ("Reached T6", ["log:Reached T6"]),
    ("reached tier six", ["log:Reached T6"]),
    ("first T11 map", ["log:Reached T11"]),
    ("running T15 now", ["log:Reached T15"]),
    ("Atlas opened", ["log:Atlas opened"]),
    ("Killed Brutus with one fate", ["kill:Brutus/1"]),
    ("killed the map boss with two fates", ["kill:Map Boss/2"]),
    ("killed Excavation boss with 2 fates", ["kill:Excavation/2"]),
    ("Start the league", ["start"]),
    ("league started", ["start"]),
    ("start the timer", ["start"]),
    # --- control
    ("undo", ["undo"]),
    ("Undo that.", ["undo"]),
    ("scratch that", ["undo"]),
    ("never mind", ["undo:soft"]),  # v2: soft undo (cancels a running lookup first)
    ("what's next", ["q:next"]),
    ("What's next?", ["q:next"]),
    ("what now", ["q:next"]),
    ("how am I doing", ["q:pace"]),
    ("How am I doing?", ["q:pace"]),
    ("am I behind", ["q:pace"]),
    ("status", ["q:pace"]),
    ("what tier am I cleared for", ["q:gate"]),
    ("how many fates can I use", ["q:fates"]),
    ("repeat that", ["local:repeat"]),
    ("mute", ["local:mute"]),
    # --- unknown -> note (never lost)
    ("remember to check vendors in act 3 for chaos gems", ["note"]),
    ("this map layout is awful", ["note"]),
    ("Arcane surge gem", ["log:Arcane Surge Support (gem)"]),
    ("bandits killed", ["log:Bandits: all killed"]),
    ("Thank you.", ["note"]),

    # ===== v2 (Nov 12 2026). the author's live voice log, every line =====
    ("Okay, I just had a near death. Almost died to an act too rare.", ["log:Near-death (flasks empty / pool < 30%)"]),
    ("Resistances are 25% cold, 0% everything else", ["def:fire=0", "def:cold=25", "def:lightning=0", "def:chaos=0"]),
    ("Max Life's 300", ["def:life_es=300/None"]),
    ("Just got a 3 socket chest piece. What are my links?", ["log:Drop: 3-socket chest (3 socket chest piece)", "q:links/3/main"]),
    ("Act 1 done. Going to try Mervail with 1 fate.", ["ms:act=1", "fate:Mervail/1"]),
    ("Pause timer", ["pause"]),
    ("I'm level 12, 37 cold res, 45 fire, 28 lightning, 25 chaos", ["def:level=12", "def:fire=45", "def:cold=37", "def:lightning=28", "def:chaos=25"]),
    ("Life in Energy Shield is now 512", ["def:pool=512"]),
    ("Killed Oak", ["log:Bandit killed: Oak"]),
    ("Helped Alira", ["log:Bandit helped: Alira"]),
    ("Killed all bandits", ["log:Bandits: all killed"]),
    ("Can you hear me?", ["q:hello"]),
    ("What is my 3 link setup now, I am in Act 1 at level 10", ["q:links/3/main/level=10/act=1"]),
    # --- multi-field defences
    ("fire 40 cold 52 lightning 33 chaos minus 60", ["def:fire=40", "def:cold=52", "def:lightning=33", "def:chaos=-60"]),
    ("Fire 75, cold 75, lightning 60, chaos minus 20. Life and energy shield 5200.", ["def:fire=75", "def:cold=75", "def:lightning=60", "def:chaos=-20", "def:pool=5200"]),
    ("all res 75 chaos minus 30", ["def:fire=75", "def:cold=75", "def:lightning=75", "def:chaos=-30"]),
    ("res are 76 75 75", ["def:fire=76", "def:cold=75", "def:lightning=75"]),
    ("resistances are 60 55 40 and chaos minus 30", ["def:fire=60", "def:cold=55", "def:lightning=40", "def:chaos=-30"]),
    ("res 75", ["def:fire=75", "def:cold=75", "def:lightning=75"]),
    ("my res are at 40 now, level 22", ["def:level=22", "def:fire=40", "def:cold=40", "def:lightning=40"]),
    ("life 1450 es 0", ["def:life_es=1450/0"]),
    ("life and es 2100", ["def:pool=2100"]),
    ("my pool is 3800", ["def:pool=3800"]),
    ("max life 2950 energy shield 310 pool 3260", ["def:pool=3260", "def:life_es=2950/310"]),
    ("level 33 fire 75 cold 75 lightning 61", ["def:level=33", "def:fire=75", "def:cold=75", "def:lightning=61"]),
    ("fire and cold 75 lightning 50", ["def:fire=75", "def:cold=75", "def:lightning=50"]),
    ("lightning is 48 everything else capped", ["def:fire=75", "def:cold=75", "def:lightning=48"]),
    ("chaos res is negative 60", ["def:chaos=-60"]),
    ("75 fire 75 cold 75 lightning", ["def:fire=75", "def:cold=75", "def:lightning=75"]),
    ("level 40 life 2400", ["def:level=40", "def:life_es=2400/None"]),
    ("Kitava 10 done, res are 15 20 10", ["ms:kitava=10", "def:fire=15", "def:cold=20", "def:lightning=10"]),
    ("act 5 kitava done", ["ms:kitava=5"]),
    # --- pause / resume
    ("pause the timer", ["pause"]), ("pause", ["pause"]), ("hold the timer", ["pause"]), ("taking a break", ["pause"]),
    ("resume timer", ["resume"]), ("unpause", ["resume"]), ("I'm back", ["resume"]), ("start the timer again", ["resume"]), ("resume the clock", ["resume"]),
    # --- build plan questions (answered locally)
    ("what are my links", ["q:links/None/all"]),
    ("what should my 4 link be", ["q:links/4/main"]),
    ("what is my 5 link in act 6", ["q:links/5/main/act=6"]),
    ("what gems at level 20", ["q:links/None/all/level=20"]),
    ("what should I link in maps", ["q:links/None/all/maps=True"]),
    ("what's my main skill setup", ["q:links/None/main"]),
    ("what auras should I run", ["q:links/None/auras"]),
    ("what goes on weapon swap", ["q:links/None/swap"]),
    ("what spectres should I use", ["q:links/None/spectres"]),
    ("what movement skill", ["q:links/None/movement"]),
    # --- local Q&A
    ("what should I do with a cane of unravelling", ["q:trigger/Cane of Unravelling"]),
    ("what about bones of ullr", ["q:trigger/Bones of Ullr"]),
    ("Act 5 done, what are my res?", ["ms:act=5", "q:res"]),
    ("what is my res", ["q:res"]),
    ("how long have i played", ["q:pace"]),
    ("what's the next stop", ["q:next"]),
    ("what are the fate rules", ["q:fates"]),
    ("are you there", ["q:hello"]),
    ("how much damage does a bear do?", ["q:unknown"]),
    ("what's the best map to farm", ["q:unknown"]),
    ("is kitava hard?", ["q:unknown"]),
    # --- research (explicit keyword only)
    ("research desecrate", ["research:desecrate"]),
    ("look up the porcupine", ["research:the porcupine"]),
    ("wiki forged frostbearer", ["wiki_link"]),   # v5.3: "wiki X" gets the link (playtest, 2026-11-13)
    ("look up how does spell echo work on minions", ["research:how does spell echo work on minions"]),
    ("can you research raise spectre", ["research:raise spectre"]),
    ("repeat that", ["local:repeat"]),
    # --- screenshot import
    ("scan my defences", ["ocr:scan"]), ("read my defences", ["ocr:scan"]),
    ("confirm", ["ocr:confirm"]), ("apply it", ["ocr:confirm"]),
    ("discard", ["ocr:discard"]), ("throw that away", ["ocr:discard"]),
    # --- Fates
    ("going to try the bloated miller with two fates", ["fate:The Bloated Miller/2"]),
    ("fighting brutus with 1 fate", ["fate:Brutus/1"]),
    ("killed brutus with one fate", ["kill:Brutus/1"]),
]

def run(verbose=True):
    ok, fails, t = 0, [], 0.0
    for phrase, exp in CASES:
        t0 = time.perf_counter(); acts = parse(phrase); t += time.perf_counter() - t0
        got = sorted(sig(a) for a in acts)
        if got == sorted(exp): ok += 1
        else: fails.append((phrase, exp, got))
    if verbose:
        for p, e, g in fails: print(f"FAIL {p!r}\n   expected {e}\n   got      {g}")
        print(f"\nparser accuracy: {ok}/{len(CASES)} = {100*ok/len(CASES):.1f}%   mean parse time {1000*t/len(CASES):.2f} ms")
    return ok, len(CASES), fails

def test_parser_accuracy():
    ok, n, fails = run(verbose=False)
    assert ok / n >= 0.95, fails

if __name__ == "__main__":
    ok, n, _ = run()
    sys.exit(0 if ok == n else 1)
