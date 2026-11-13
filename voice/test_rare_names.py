"""Rare-drop recognition: 3.30 dictionary + Whisper mishearings.

Run:  python test_rare_names.py
"""
from __future__ import annotations

import sys
import time

from companion import describe, parse
from name_index import get_index, phonetic_key
from test_parser import sig

# phrase -> expected log signature (same as test_parser.sig)
# A trailing "?" means low-confidence: text starts with "? " and describe() says "did you mean".
CASES = [
    # --- chase uniques ---
    ("Got a Mageblood", "log:Mageblood"),
    ("mage blood just dropped", "log:Mageblood"),
    ("I found a Headhunter", "log:Headhunter"),
    ("head hunter belt dropped", "log:Headhunter"),
    ("Ashes of the Stars", "log:Ashes of the Stars"),
    ("ashes of stars dropped", "log:Ashes of the Stars"),
    ("Bones of Ullr dropped", "log:Bones of Ullr"),
    ("Darkness Enthroned", "log:Darkness Enthroned"),
    ("Kaom's Heart", "log:Kaom's Heart"),
    ("kaoms heart dropped", "log:Kaom's Heart"),
    ("Shavronne's Wrappings", "log:Shavronne's Wrappings"),
    ("Windripper dropped", "log:Windripper"),
    ("wind ripper", "log:Windripper"),
    ("Belly of the Beast", "log:Belly of the Beast"),
    ("belly of a beast", "log:Belly of the Beast"),
    ("Ralakesh's Impatience", "log:Ralakesh's Impatience"),
    ("Femurs of the Saints", "log:Femurs of the Saints"),
    ("Mirror of Kalandra", "log:Mirror of Kalandra"),
    ("Hinekora's Lock", "log:Hinekora's Lock"),
    # --- 3.30 uniques ---
    ("Hide of the Vendigo dropped", "log:Hide of the Vendigo"),
    ("got a hide of vendigo", "log:Hide of the Vendigo"),
    ("The Covetous Dark", "log:The Covetous Dark"),
    ("Putrid Seed jewel", "log:Putrid Seed"),
    ("Dreadmaidens' Sacrament", "log:Dreadmaidens' Sacrament"),
    ("dreadmaidens sacrament dropped", "log:Dreadmaidens' Sacrament"),
    # --- divination cards + "The" / "card" suffix ---
    ("The Apothecary", "log:The Apothecary (divination card)"),
    ("apothecary card just dropped", "log:The Apothecary (divination card)"),
    ("House of Mirrors", "log:House of Mirrors (divination card)"),
    ("house of mirror card", "log:House of Mirrors (divination card)"),
    ("The Doctor card", "log:The Doctor (divination card)"),
    ("The Fiend", "log:The Fiend (divination card)"),
    ("fiend card dropped", "log:The Fiend (divination card)"),
    ("The Demon card", "log:The Demon (divination card)"),
    ("The Enlightened", "log:The Enlightened (divination card)"),
    ("The Awakened", "log:The Awakened (divination card)"),
    ("enlightened card", "log:The Enlightened (divination card)"),
    ("Seven Years Bad Luck", "log:Seven Years Bad Luck (divination card)"),
    ("7 years bad luck card", "log:Seven Years Bad Luck (divination card)"),
    ("Unrequited Love card", "log:Unrequited Love (divination card)"),
    ("Porcupine card just dropped", "log:The Porcupine (divination card)"),
    ("Porky pine card dropped", "log:The Porcupine (divination card)"),
    ("Picked up a porky pine", "log:The Porcupine (divination card)"),
    # --- gems ---
    ("Empower dropped", "log:Empower Support (gem)"),
    ("got an Empower gem", "log:Empower Support (gem)"),
    ("Enlighten Support", "log:Enlighten Support (gem)"),
    ("enlighten gem", "log:Enlighten Support (gem)"),
    ("Enhance gem dropped", "log:Enhance Support (gem)"),
    ("Arcane surge gem", "log:Arcane Surge Support (gem)"),
    ("Fireball of Radiation", "log:Fireball of Radiation (gem)"),
    ("Arcane Link gem", "log:Arcane Link (gem)"),
    # --- 3.30 league items ---
    ("Abyss Thread", "log:Abyss Thread (thread)"),
    ("got an expedition thread", "log:Expedition Thread (thread)"),
    ("Frayed Thread dropped", "log:Frayed Thread"),
    ("Essence of Trickery", "log:Essence of Trickery"),
    ("Doomsayer fate", "log:Doomsayer (fate)"),
    ("Crowkeeper fate", "log:Crowkeeper (fate)"),
    ("incandescent fate", "log:Incandescent (fate)"),
    ("wildfire fate", "log:Wildfire (fate)"),
    ("Royal Visage dropped", "log:Royal Visage"),
    # --- low-confidence mishearing: logged with "?" and read back as "did you mean" ---
    ("got a megablood", "log:? Mageblood"),
]

FALSE_POSITIVES = [
    "Thank you.",
    "this map layout is awful",
    "bought a new wand at the vendor",
    "Need to remember to swap pantheon",
    "remember to check vendors in act 3 for chaos gems",
    "bandits killed",
    "I'm a doctor",
    "that boss is a demon",
    "nice layout",
    "swap the pantheon",
]


def _is_drop(acts):
    return [a for a in acts if a.get("type") == "log" and a.get("kind") == "drop"]


def run(verbose=True):
    idx = get_index()
    ok, fails, t = 0, [], 0.0
    for phrase, exp in CASES:
        t0 = time.perf_counter()
        acts = parse(phrase)
        t += time.perf_counter() - t0
        got = sorted(sig(a) for a in acts)
        if got == sorted([exp]):
            ok += 1
            if exp.startswith("log:? "):
                if "did you mean" not in describe(acts).lower():
                    fails.append((phrase, exp + " + did-you-mean readback", [describe(acts)]))
                    ok -= 1
        else:
            fails.append((phrase, [exp], got))
    fp_ok, fp_fails = 0, []
    for phrase in FALSE_POSITIVES:
        t0 = time.perf_counter()
        acts = parse(phrase)
        t += time.perf_counter() - t0
        drops = _is_drop(acts)
        if not drops:
            fp_ok += 1
        else:
            fp_fails.append((phrase, [f"{d['text']} ({(d.get('match') or {}).get('kind')})" for d in drops]))
    n = len(CASES)
    if verbose:
        for p, e, g in fails:
            print(f"FAIL {p!r}\n   expected {e}\n   got      {g}")
        for p, g in fp_fails:
            print(f"FP   {p!r}\n   matched  {g}")
        mean = 1000 * t / (n + len(FALSE_POSITIVES))
        print(f"\nrare-drop accuracy: {ok}/{n} = {100*ok/n:.1f}%")
        print(f"false-positive guard: {fp_ok}/{len(FALSE_POSITIVES)}")
        print(f"mean parse time {mean:.2f} ms  (includes milestones etc.)")
        print(f"dictionary: {len(idx)} names  version={idx.version!r}")
        print(f"phonetic check: porcupine={phonetic_key('porcupine')!r} porky pine={phonetic_key('porky pine')!r}")
    return ok, n, fails, fp_ok, fp_fails, t


def test_rare_name_accuracy():
    ok, n, fails, fp_ok, fp_fails, _ = run(verbose=False)
    assert ok == n, fails
    assert fp_ok == len(FALSE_POSITIVES), fp_fails


def test_parser_latency():
    # Warm the index, then time a mixed batch. Must stay well under 50 ms/utterance.
    parse("Got a Mageblood")
    phrases = [p for p, _ in CASES] + FALSE_POSITIVES + [
        "Finished Act 10, resistances aren't capped",
        "got a cane of unravelling",
        "what's next",
        "chaos res thirty",
    ]
    # Repeat to get a stable mean
    times = []
    for _ in range(8):
        for p in phrases:
            t0 = time.perf_counter()
            parse(p)
            times.append((time.perf_counter() - t0) * 1000)
    times.sort()
    mean, p95, mx = sum(times) / len(times), times[int(len(times) * 0.95)], times[-1]
    print(f"parser latency: mean {mean:.2f} ms  p95 {p95:.2f} ms  max {mx:.2f} ms  n={len(times)}")
    assert mx < 50, f"max parse {mx:.2f} ms exceeds 50 ms"
    assert mean < 20


if __name__ == "__main__":
    ok, n, fails, fp_ok, fp_fails, t = run()
    test_parser_latency()
    sys.exit(0 if ok == n and fp_ok == len(FALSE_POSITIVES) else 1)
