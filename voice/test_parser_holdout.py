"""Held-out phrasings written after the parser was tuned on test_parser.py (not tuned against).
Run: python test_parser_holdout.py"""
import sys, time
from companion import parse
from test_parser import sig, CANE

NEAR = "log:Near-death (flasks empty / pool < 30%)"
DEATH = "log:Death (character died)"
HOLDOUT = [
    ("oh nice, cane of unravelling", [CANE]),
    ("Holy crap, a Cane of Unravelling.", [CANE]),
    ("Kane of Unraveling!", [CANE]),
    ("just picked up animate weapon of ranged arms", ["log:Animate Weapon of Ranged Arms"]),
    ("I got a Storm Burst of Repulsion gem", ["log:Storm Burst of Repulsion"]),
    ("Diadian Dawn, let's go", ["log:Dyadian Dawn"]),
    ("the porcupine card", ["log:The Porcupine (divination card)"]),
    ("Porky pine card dropped", ["log:The Porcupine (divination card)"]),
    ("Picked up a porcupine.", ["log:The Porcupine (divination card)"]),
    ("Seething fury shield dropped", ["log:Seething Fury"]),
    ("staff 760 p dps", ["log:Staff 760 pDPS"]),
    ("Orb of Chance dropped", ["log:Orb of Chance"]),
    ("Okay, act one's done.", ["ms:act=1"]),
    ("Act 2 is done.", ["ms:act=2"]),
    ("act three is finished", ["ms:act=3"]),
    ("Act four complete.", ["ms:act=4"]),
    ("Act five done, Kitava's dead", ["ms:act=5", "ms:kitava=next"]),
    ("Act six done, res capped again", ["ms:act=6", "def:ele=true"]),
    ("Act 9 is done", ["ms:act=9"]),
    ("Okay normal lab is done", ["ms:lab=normal"]),
    ("Cruel lab's done.", ["ms:lab=cruel"]),
    ("Merciless done", ["ms:lab=merciless"]),
    ("Kitava is down.", ["ms:kitava=next"]),
    ("Beat Kitava", ["ms:kitava=next"]),
    ("My chaos res is 25", ["def:chaos=25"]),
    ("chaos at minus 30", ["def:chaos=-30"]),
    ("Chaos resist 60 percent", ["def:chaos=60"]),
    ("Life is 3,800.", ["def:life_es=3800/None"]),
    ("I have 4500 life", ["def:life_es=4500/None"]),
    ("energy shield is 1200", ["def:life_es=None/1200"]),
    ("EHP is 72,000", ["note"]),
    ("Max hit 7k", ["note"]),
    ("Resistances are all capped.", ["def:ele=true"]),
    ("My resistances aren't capped", ["def:ele=false"]),
    ("lightning res isn't capped", ["def:ele=false"]),
    ("Level 30 now", ["def:level=30"]),
    ("Oh god that was close", [NEAR]),
    ("Almost died there", [NEAR]),
    ("I nearly died", [NEAR]),
    ("I'm dead.", [DEATH]),
    ("RIP.", [DEATH]),
    ("Died to Brutus", [DEATH]),
    ("Undo.", ["undo"]),
    ("Undo the last one", ["undo"]),
    ("What's next?", ["q:next"]),
    ("What should I do next?", ["q:next"]),
    ("How's my pace?", ["q:pace"]),
    ("Am I ahead?", ["q:pace"]),
    ("Got to tier 11", ["log:Reached T11"]),
    ("killed Brutus with no fates", ["kill:Brutus/0"]),
    ("bought a new wand at the vendor", ["note"]),
    ("Need to remember to swap pantheon", ["note"]),
]

if __name__ == "__main__":
    ok = 0
    for p, e in HOLDOUT:
        g = sorted(sig(a) for a in parse(p))
        if g == sorted(e): ok += 1
        else: print(f"FAIL {p!r}\n   expected {e}\n   got      {g}")
    print(f"\nheld-out accuracy: {ok}/{len(HOLDOUT)} = {100*ok/len(HOLDOUT):.1f}%")
