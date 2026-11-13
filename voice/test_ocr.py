"""OCR text -> defence fields. Run: python test_ocr.py

ALL SAMPLES BELOW ARE SYNTHETIC: hand-written to look like OCR output of the PoE 3.x character sheet
(Defences tab) and the Path of Building stats sidebar, including typical OCR noise (O for 0, l for 1,
merged/split rows, thousands separators). They are NOT captured from anyone's screen. The Windows OCR
engine itself can't run on the Linux box, so only the text->fields stage is tested here."""
import os
import sys
from ocr import parse_defences_text, rows_from_boxes

# SYNTHETIC: PoE character sheet, Defences tab (labels left, values right-aligned)
POE_SHEET = """Mortis_HCSSF
Level 34 Necromancer
Defences
Life 1,412
Mana 412
Energy Shield 186
Ward 0
Armour 512
Evasion Rating 233
Estimated Physical Damage Reduction 6%
Chance to Block Attack Damage 0%
Chance to Block Spell Damage 9%
Life Regeneration 12.4 per second
Fire Resistance 52% (52%)
Cold Resistance 75% (81%)
Lightning Resistance 61% (61%)
Chaos Resistance -30% (-30%)"""

# SYNTHETIC: same panel, noisy OCR (O/0, l/1, missing spaces, colon)
POE_NOISY = """LeveI 68 Necromancer
Life: 4,2l3
Energy Shield 74O
Chance to Block Spell Damage: 6O%
Fire Resistance 75% (9O%)
Cold Resistance 75% (83%)
Lightning Resistance 75%(76%)
Chaos Resistance 3l% (3l%)
Mana Regeneration 31.0 per second"""

# SYNTHETIC: PoB sidebar
POB = """Total DPS: 393,144.6
Life: 4,243 (100%)
Life Regen: 120.3
Energy Shield: 740
Mana: 1,018
Effective Hit Pool: 52,312
Physical Maximum Hit: 7,846
Fire Resistance: 75% (+12%)
Cold Resistance: 75% (+7%)
Lightning Resistance: 75% (+3%)
Chaos Resistance: 68%
Spell Block Chance: 60%
Attack Block Chance: 60%"""

# SYNTHETIC: word boxes as Windows OCR would return them (label and value as separate lines, out of order)
BOXES = [
    ("75%", 410, 300, 30, 14), ("Fire", 20, 301, 28, 14), ("Resistance", 52, 300, 70, 15), ("(88%)", 445, 301, 40, 14),
    ("Life", 20, 120, 26, 14), ("3,880", 420, 121, 40, 14),
    ("Cold", 20, 321, 30, 14), ("Resistance", 54, 320, 70, 15), ("75%", 410, 321, 30, 14), ("(79%)", 445, 320, 40, 14),
    ("Energy", 20, 140, 44, 14), ("Shield", 68, 141, 40, 14), ("612", 430, 140, 25, 14),
    ("Lightning", 20, 341, 60, 14), ("Resistance", 84, 341, 70, 15), ("70%", 410, 340, 30, 14), ("(70%)", 445, 341, 40, 14),
]

CASES = [
    ("poe sheet", POE_SHEET, {"level": 34, "life": 1412, "mana": 412, "es": 186, "armour": 512, "evasion": 233, "pdr": 6, "ablock": 0, "block": 9, "fire": 52, "cold": 75, "lightning": 61, "chaos": -30}, {"cold": 81}),
    ("poe noisy", POE_NOISY, {"level": 68, "life": 4213, "es": 740, "block": 60, "fire": 75, "cold": 75, "lightning": 75, "chaos": 31}, {"fire": 90, "cold": 83, "lightning": 76}),
    # v3: EHP / phys max hit are no longer read (removed from the Defense panel); attack block is
    ("pob sidebar", POB, {"life": 4243, "es": 740, "mana": 1018, "fire": 75, "cold": 75, "lightning": 75, "chaos": 68, "block": 60, "ablock": 60}, {"fire": 87, "cold": 82, "lightning": 78}),
    ("boxes", "\n".join(rows_from_boxes(BOXES)), {"life": 3880, "es": 612, "fire": 75, "cold": 75, "lightning": 70}, {"fire": 88, "cold": 79}),
    ("empty", "Inventory\nStash\nPassive Skill Tree", {}, {}),
]


def run():
    ok = 0
    for name, text, want, want_unc in CASES:
        got = parse_defences_text(text)
        unc = {k: v for k, v in got["uncapped"].items() if k in want_unc or v != got["fields"].get(k)}
        if got["fields"] == want and unc == want_unc:
            ok += 1
        else:
            print(f"FAIL {name}\n  want {want} {want_unc}\n  got  {got['fields']} {got['uncapped']}")
    print(f"ocr text parser: {ok}/{len(CASES)}")
    return ok == len(CASES)


def test_ocr_parser():
    assert run()


# ---- image stage (needs Pillow + rapidocr-onnxruntime; Windows OCR is tested on a Windows PC with --ocr-selftest windows)
REAL = os.environ.get("POE_OCR_REAL_SAMPLE", "")   # optional: a real Defences-tab screenshot of yours (never committed)
REAL_WANT = {"level": 4, "life": 93, "mana": 128, "armour": 31, "evasion": 40, "fire": 0, "cold": 9, "lightning": 9, "chaos": 0, "ablock": 20}


def _first(*paths):
    import os
    return next((p for p in paths if os.path.exists(p)), None)


LV4 = _first(os.environ.get("POE_OCR_LV4", ""))
LV97 = _first(os.environ.get("POE_OCR_LV97", ""))
LV97_WANT = {"level": 97, "life": 1317, "mana": 833, "es": 1308, "fire": -60, "cold": 18, "lightning": 75, "chaos": -60, "ablock": 25}


def run_images():
    import os, time
    try:
        import ocr
        from PIL import Image  # noqa: F401
        import rapidocr_onnxruntime  # noqa: F401
    except ImportError as e:
        print("image OCR tests skipped:", e); return True
    ok = n = 0
    img, want = ocr.synthetic_defences_image()
    n += 1; t = time.perf_counter(); r = ocr.read_defences(img, "rapidocr")
    good = all(r["fields"].get(k) == v for k, v in want.items())
    print(f"{'ok  ' if good else 'FAIL'} synthetic image ({1000 * (time.perf_counter() - t):.0f} ms) {r['fields']}"); ok += good
    # Windows OCR raising (winrt 3.2.1 "Invalid parameter count") must fall back to rapidocr, with the reason recorded
    real_win = ocr.windows_ocr_boxes
    def broken(_img): raise TypeError("Invalid parameter count")
    ocr.windows_ocr_boxes = broken
    try:
        n += 1; r = ocr.read_defences(img, "auto")
        good = r["engine"] == "rapidocr" and any("Invalid parameter count" in e for e in r["fallback"]) and r["fields"].get("life") == want["life"]
        print(f"{'ok  ' if good else 'FAIL'} windows error -> rapidocr fallback: {r['engine']} {r['fallback']}"); ok += good
    finally:
        ocr.windows_ocr_boxes = real_win
    # Windows OCR reads the labels but drops the small coloured res numbers (seen on a real Windows 11 PC): auto adds rapidocr
    def partial(_img):
        return [(w, x, y, 30, 11) for w, x, y in (("Life", 11, 12), ("93", 470, 12), ("Fire", 11, 100), ("Resistance", 37, 100),
                                                 ("Cold", 10, 122), ("Resistance", 41, 122))]
    ocr.windows_ocr_boxes = partial
    try:
        n += 1; r = ocr.read_defences(img, "auto")
        good = r["engine"] == "windows+rapidocr" and r["fields"].get("cold") == want["cold"] and r["fields"].get("fire") == want["fire"] and any("incomplete" in e for e in r["fallback"])
        print(f"{'ok  ' if good else 'FAIL'} windows incomplete -> rapidocr fills it: {r['engine']} {r['fallback']}"); ok += good
        n += 1; r = ocr.read_defences(img, "windows")
        good = r["engine"] == "windows" and set(r.get("missing", [])) == {"fire", "cold"}
        print(f"{'ok  ' if good else 'FAIL'} forced windows reports the missing numbers: {r.get('missing')}"); ok += good
    finally:
        ocr.windows_ocr_boxes = real_win
    if REAL and os.path.exists(REAL):
        from PIL import Image
        im = Image.open(REAL)
        n += 1; t = time.perf_counter(); r = ocr.read_defences(im, "rapidocr", region="left" if im.width >= 1600 else None)
        f = r["fields"]; diff = {k: (f.get(k), v) for k, v in REAL_WANT.items() if f.get(k) != v}
        good = not diff
        print(f"{'ok  ' if good else 'FAIL'} real Defences screenshot ({1000 * (time.perf_counter() - t):.0f} ms) {f} {'' if good else diff}"); ok += good
    # v5.1: character level from the round badge on the portrait (no "Level" word on screen)
    for lv, dfn in ((97, True), (4, False), (4, True), (1, False), (13, False), (68, True), (100, False)):
        img, want = ocr.synthetic_header_image(lv, with_defences=dfn)
        n += 1; t = time.perf_counter(); r = ocr.read_defences(img, "rapidocr")
        diff = {k: (r["fields"].get(k), v) for k, v in want.items() if r["fields"].get(k) != v}
        good = not diff
        print(f"{'ok  ' if good else 'FAIL'} level badge {lv}{' + defences' if dfn else ' (header only)'} ({1000 * (time.perf_counter() - t):.0f} ms, {r.get('level_from')}) {'' if good else diff}"); ok += good
    # no header on screen -> never a guessed level (synthetic Defences image)
    img, _ = ocr.synthetic_defences_image()
    n += 1; r = ocr.read_defences(img, "rapidocr"); good = "level" not in r["fields"]
    print(f"{'ok  ' if good else 'FAIL'} no panel header -> no level guessed {r['fields'].get('level')}"); ok += good
    # Windows OCR (can't run on the box) that reads the header but not the lone digit: auto adds the rapidocr crop pass
    real_win = ocr.windows_ocr_boxes
    img4, _ = ocr.synthetic_header_image(4, with_defences=False)
    def header_only(_img):
        return [("Exiledemo", 126, 46, 120, 20), ("Lioneye's Watch", 150, 78, 110, 15), ("Life", 128, 122, 28, 15), ("1317", 330, 122, 32, 15),
                ("Mana", 128, 144, 36, 15), ("833", 330, 144, 26, 15)]
    ocr.windows_ocr_boxes = header_only
    try:
        n += 1; r = ocr.read_defences(img4, "auto")
        good = r["fields"].get("level") == 4 and r.get("level_from") in ("badge-crop", "badge-crop-rapidocr")
        print(f"{'ok  ' if good else 'FAIL'} windows misses the lone digit -> rapidocr crop pass reads 4: {r['fields']} {r.get('level_from')}"); ok += good
    finally:
        ocr.windows_ocr_boxes = real_win
    # the badge picker on word boxes alone (engine-free)
    bx = [("CHARACTER", 261, 55, 128, 18), ("Exiledemo", 130, 114, 193, 22), ("Karui Shores", 155, 145, 86, 18), ("Life", 127, 185, 29, 18),
          ("1317", 334, 188, 27, 15), ("Mana", 127, 208, 42, 17), ("833", 334, 208, 27, 17), ("113", 464, 222, 26, 20), ("97", 52, 244, 31, 24)]
    no_hdr = [("Life", 11, 12, 30, 11), ("93", 470, 12, 18, 11), ("Mana", 11, 34, 36, 11), ("4", 3, 60, 8, 11)]   # Life at the left edge, nothing above
    cls = [("Exiledemo", 140, 36, 120, 22), ("Necromancer", 140, 72, 102, 16), ("97", 18, 110, 20, 16)]
    n += 1; good = ocr.level_from_boxes(bx) == 97 and ocr.level_from_boxes([b for b in bx if b[0] != "97"]) is None and ocr.level_from_boxes(no_hdr) is None \
        and ocr.level_from_boxes(cls) == 97 and ocr.level_from_boxes([("97", 52, 244, 31, 24)]) is None and ocr.level_from_boxes(bx[3:]) is None
    print(f"{'ok  ' if good else 'FAIL'} badge picker: number under the portrait, left of Life/Mana; none without the header; strength/int numbers ignored"); ok += good
    n += 1; good = ocr._badge_text("１００") == 100 and ocr._badge_text("101") is None and ocr._badge_text("0") is None and ocr._badge_text("(9)") == 9
    print(f"{'ok  ' if good else 'FAIL'} badge number sanity: 1-100 only, full-width digits normalised"); ok += good
    # optional real Character-panel screenshots (POE_OCR_LV4 / POE_OCR_LV97, never committed): level 4 header, level 97 full panel
    for path, want in ((LV4, {"level": 4}), (LV97, LV97_WANT)):
        if not path:
            print("skip  (screenshot not on this machine)", want.get("level")); continue
        im = Image.open(path)
        n += 1; t = time.perf_counter(); r = ocr.read_defences(im, "rapidocr", region="left" if im.width >= 1600 and im.width > im.height else None)
        f = r["fields"]; diff = {k: (f.get(k), v) for k, v in want.items() if f.get(k) != v}
        good = not diff
        print(f"{'ok  ' if good else 'FAIL'} real Character panel, level {want['level']} ({1000 * (time.perf_counter() - t):.0f} ms, {r.get('level_from')}) {f} {'' if good else diff}"); ok += good
    print(f"ocr image stage: {ok}/{n}")
    return ok == n


if __name__ == "__main__":
    a = run(); b = run_images()
    sys.exit(0 if a and b else 1)
