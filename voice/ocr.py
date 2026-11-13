"""Read the PoE character sheet (Defences tab) or the PoB stats sidebar from a screenshot, locally.

Engines (no cloud, no API key):
  1. Windows built-in OCR (Windows.Media.Ocr) via the pywinrt packages (winrt-Windows.Media.Ocr ...) or winsdk.
  2. rapidocr-onnxruntime, if installed (optional fallback).
Screen capture uses Pillow's ImageGrab (a normal desktop screenshot, like Snipping Tool). Nothing touches
the game process: no input, no memory reads.
"""
from __future__ import annotations

import base64
import io
import re

try:
    from rapidfuzz import fuzz
except ImportError:  # pragma: no cover
    import difflib

    class fuzz:  # type: ignore
        @staticmethod
        def ratio(a, b):
            return 100.0 * difflib.SequenceMatcher(None, a, b).ratio()

# --------------------------------------------------------------------------------------------
# Text -> defence fields
# --------------------------------------------------------------------------------------------
LABELS = [  # (field, canonical labels as they appear in game / PoB)
    ("life", ["life", "maximum life", "max life", "total life"]),
    ("es", ["energy shield", "maximum energy shield", "max energy shield", "total energy shield"]),
    ("fire", ["fire resistance", "fire res", "fire resist"]),
    ("cold", ["cold resistance", "cold res", "cold resist"]),
    ("lightning", ["lightning resistance", "lightning res", "lightning resist"]),
    ("chaos", ["chaos resistance", "chaos res", "chaos resist"]),
    ("mana", ["mana", "maximum mana", "max mana", "total mana"]),
    ("ablock", ["chance to block attack damage", "chance to block attacks", "attack block chance", "attack block", "block chance", "chance to block"]),
    ("block", ["chance to block spell damage", "spell block chance", "spell block", "chance to block spells", "spell block chance:"]),
    ("armour", ["armour", "armor", "total armour"]),
    ("evasion", ["evasion rating", "evasion", "total evasion"]),
    ("level", ["level", "character level"]),
]
# labels that look like ours but aren't (mana regeneration, evade chance, physical damage reduction, ...)
SKIP = re.compile(r"regen|recovery|recoup|leech|reserv|unreserved|ward|evade|suppress|degen|recharge|on kill|per second|taken from|% of|chance to dodge|stun|ailment|leftover|net|reduction|cost|modifier|speed|estimated|avoid", re.I)
NUM = r"[-−–]?\s?\d[\d,.\s]*\d|[-−–]?\d"


def _fix_ocr(s: str) -> str:
    s = s.replace("−", "-").replace("–", "-").replace("：", ":").replace("％", "%")
    # O/o/Q -> 0 and l/I/| -> 1 when they sit between digits or before %
    s = re.sub(r"(?<=\d)[Oo](?=[\d%,.)\s]|$)", "0", s)
    s = re.sub(r"(?<=[\s(+:])[Oo](?=\d)", "0", s)
    s = re.sub(r"(?<=\d)[lI|](?=[\d%,.)\s]|$)", "1", s)
    s = re.sub(r"(?<=[\s(+:])[lI|](?=\d)", "1", s)
    s = re.sub(r"(?<=\d)\s?°/o|(?<=\d)\s?o/o|(?<=\d)\s?9b\b", "%", s)
    return s


def _to_int(tok: str):
    t = tok.replace(" ", "").replace("−", "-")
    neg = t.startswith("-")
    t = t.lstrip("-")
    # thousands separators: "4,213" "4.213" "1,234,567"; a single decimal like "8.5" stays a float
    if re.fullmatch(r"\d{1,3}([,.]\d{3})+", t):
        t = re.sub(r"[,.]", "", t)
    elif re.fullmatch(r"\d+[.,]\d{1,2}", t):
        t = t.replace(",", ".")
    try:
        v = float(t)
    except ValueError:
        return None
    v = -v if neg else v
    return int(round(v))


def _split_label(row: str):
    """'Fire Resistance: 75% (82%)' -> ('fire resistance', '75% (82%)')"""
    m = re.match(r"^\s*([A-Za-z][A-Za-z '\-]*?)\s*[:.]?\s*(?=[-+(]?\s?\d|$)", row)
    if not m:
        return None, row
    return m.group(1).strip().lower(), row[m.end():]


def _field_for(label: str):
    if not label or SKIP.search(label):
        return None
    best, bf = 0, None
    for f, names in LABELS:
        for n in names:
            sc = 100 if label == n else fuzz.ratio(label, n)
            if len(label) < 6 and label != n:
                sc = 0
            if sc > best:
                best, bf = sc, f
    return bf if best >= 84 else None


def parse_defences_text(text: str) -> dict:
    """Parse OCR text (one row per line) from the PoE Defences tab or the PoB sidebar.
    Returns {"fields": {...}, "uncapped": {...}, "source": "poe"|"pob"|"?", "rows": [...]}"""
    fields, uncapped, rows = {}, {}, []
    src = "pob" if re.search(r"effective hit pool|max hit|\(\+\d+%\)|Total DPS|Combined DPS|Total EHP", text, re.I) else "poe"
    for raw in (text or "").splitlines():
        row = _fix_ocr(raw.strip())
        if not row:
            continue
        lvl = re.search(r"\bLeve[lI1|]\s*:?\s*(\d{1,3})\b", row, re.I)
        if lvl and "level" not in fields and not SKIP.search(row) and 1 <= int(lvl.group(1)) <= 100 and not re.search(r"requires", row, re.I):
            fields["level"] = int(lvl.group(1)); rows.append(row)
            if re.match(r"^\s*leve[l1|]\b", row, re.I):
                continue
        label, rest = _split_label(row)
        f = _field_for(label)
        if not f or f == "level":
            continue
        nums = re.findall(r"\(?\s*(?:max(?:imum)?\s*)?[+-]?\s?\d[\d,.]*\s?%?\s*\)?", rest)
        if not nums:
            continue
        first = re.search(NUM, nums[0])
        v = _to_int(first.group(0)) if first else None
        if v is None:
            continue
        if f in ("fire", "cold", "lightning", "chaos"):
            if not -200 <= v <= 95:
                continue
            fields[f] = v
            if len(nums) > 1:
                second = nums[1]
                sv = _to_int(re.search(NUM, second).group(0))
                if sv is not None and not re.search(r"max", second, re.I):
                    if re.search(r"\(\s*\+", second):   # PoB "75% (+12%)" = 12 over the cap
                        uncapped[f] = v + abs(sv)
                    elif sv >= v:                    # in-game "75% (82%)" = uncapped total
                        uncapped[f] = sv
        elif f in ("block", "ablock"):
            if 0 <= v <= 90: fields[f] = v
        elif f == "mana":
            if 1 <= v <= 30000 and "mana" not in fields: fields[f] = v
        elif f in ("armour", "evasion"):
            if 0 <= v <= 500000: fields[f] = v
        elif f == "life":
            if 1 <= v <= 20000: fields[f] = v
        elif f == "es":
            if 0 <= v <= 30000: fields[f] = v
        rows.append(row)
    return {"fields": fields, "uncapped": uncapped, "source": src if fields else "?", "rows": rows}


def rows_from_boxes(boxes, y_tol: float = 0.55):
    """OCR word boxes (text, x, y, w, h) -> text rows, left to right. PoE right-aligns values, so a label and its
    number can be far apart on the same row; Windows OCR may return them as separate 'lines'."""
    items = sorted([b for b in boxes if str(b[0]).strip()], key=lambda b: (b[2] + b[4] / 2.0))
    rows = []
    for b in items:
        cy, h = b[2] + b[4] / 2.0, max(1.0, float(b[4]))
        if rows and abs(rows[-1]["cy"] - cy) <= y_tol * max(h, rows[-1]["h"]):
            r = rows[-1]; r["items"].append(b); r["cy"] = (r["cy"] * (len(r["items"]) - 1) + cy) / len(r["items"]); r["h"] = max(r["h"], h)
        else:
            rows.append({"cy": cy, "h": h, "items": [b]})
    out = []
    for r in rows:
        ws = sorted(r["items"], key=lambda b: b[1])
        out.append(" ".join(str(w[0]).strip() for w in ws))
    return out


# --------------------------------------------------------------------------------------------
# Engines
# --------------------------------------------------------------------------------------------
class OcrUnavailable(RuntimeError):
    pass


def _prep(img, max_dim=2600, upscale=2.5):
    """PoE's Defences tab font is ~11 px at 1080p; both engines read it far better upscaled 2-3x."""
    from PIL import Image
    img = img.convert("RGB")
    w, h = img.size
    scale = upscale if max(w, h) < 1500 else 1.0
    if max(w, h) * scale > max_dim:
        scale = max_dim / float(max(w, h))
    if abs(scale - 1.0) > 0.01:
        img = img.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)
    return img, scale


def _winrt():
    """Import the WinRT projections (pywinrt 'winrt-*' 2.x/3.x, or the older 'winsdk')."""
    try:
        from winrt.windows.media.ocr import OcrEngine
        from winrt.windows.graphics import imaging
        from winrt.windows.storage import streams
        return OcrEngine, imaging, streams
    except ImportError:
        try:
            from winsdk.windows.media.ocr import OcrEngine
            from winsdk.windows.graphics import imaging
            from winsdk.windows.storage import streams
            return OcrEngine, imaging, streams
        except ImportError as e:
            raise OcrUnavailable("Windows OCR packages not installed (pip install -r requirements.txt)") from e


async def _winrt_bitmap(img, imaging, streams):
    """PIL image -> SoftwareBitmap. pywinrt 3.x dropped the 5-argument create_copy_from_buffer the old code used
    ('Invalid parameter count'), so try, in order: PNG bytes -> InMemoryRandomAccessStream -> BitmapDecoder
    (works on every version), then the 4-argument buffer copy, then create_copy_with_alpha_from_buffer."""
    errs = []
    try:
        buf = io.BytesIO(); img.save(buf, format="PNG"); png = buf.getvalue()
        stream = streams.InMemoryRandomAccessStream()
        writer = streams.DataWriter(stream.get_output_stream_at(0))
        writer.write_bytes(png)
        await writer.store_async()
        await writer.flush_async()
        writer.detach_stream()
        stream.seek(0)
        dec = await imaging.BitmapDecoder.create_async(stream)
        bmp = await dec.get_software_bitmap_async()
        if bmp.bitmap_pixel_format not in (imaging.BitmapPixelFormat.BGRA8, imaging.BitmapPixelFormat.GRAY8):
            bmp = imaging.SoftwareBitmap.convert(bmp, imaging.BitmapPixelFormat.BGRA8)
        return bmp, "png-decoder"
    except Exception as e:  # noqa: BLE001
        errs.append("decoder: %s" % e)
    rgba = img.convert("RGBA")
    data = rgba.tobytes("raw", "BGRA")
    dw = streams.DataWriter()
    dw.write_bytes(data)
    ibuf = dw.detach_buffer()
    try:
        return imaging.SoftwareBitmap.create_copy_from_buffer(ibuf, imaging.BitmapPixelFormat.BGRA8, rgba.width, rgba.height), "buffer4"
    except Exception as e:  # noqa: BLE001
        errs.append("buffer4: %s" % e)
    try:
        return imaging.SoftwareBitmap.create_copy_with_alpha_from_buffer(ibuf, imaging.BitmapPixelFormat.BGRA8, rgba.width, rgba.height,
                                                                         imaging.BitmapAlphaMode.PREMULTIPLIED), "buffer-alpha"
    except Exception as e:  # noqa: BLE001
        errs.append("buffer-alpha: %s" % e)
    raise RuntimeError("could not build a SoftwareBitmap: " + "; ".join(errs))


def windows_ocr_boxes(img):
    import asyncio
    OcrEngine, imaging, streams = _winrt()
    try:
        max_dim = int(OcrEngine.max_image_dimension)
    except Exception:
        max_dim = 2600
    img, scale = _prep(img, min(max_dim, 4000), upscale=2.5)

    async def run():
        eng = OcrEngine.try_create_from_user_profile_languages()
        if eng is None:
            raise OcrUnavailable("No Windows OCR language pack (Settings > Time & language > Language: add English with OCR)")
        bmp, how = await _winrt_bitmap(img, imaging, streams)
        res = await eng.recognize_async(bmp)
        boxes = []
        for line in res.lines:
            for w in line.words:
                r = w.bounding_rect
                boxes.append((w.text, r.x / scale, r.y / scale, r.width / scale, r.height / scale))
        windows_ocr_boxes.last_method = how
        return boxes
    return asyncio.run(run())


windows_ocr_boxes.last_method = ""


_RAPID = None


def rapid_ocr_boxes(img):
    global _RAPID
    try:
        import numpy as np
        from rapidocr_onnxruntime import RapidOCR
    except ImportError as e:
        raise OcrUnavailable("rapidocr-onnxruntime not installed") from e
    if _RAPID is None:
        _RAPID = RapidOCR()
        if hasattr(_RAPID, "use_angle_cls"):   # older rapidocr: no per-call switch
            _RAPID.use_angle_cls = False
    img, scale = _prep(img, 4000, upscale=2.0)
    try:   # game text is never rotated; the angle classifier sometimes flips "9% (9%)" into "(%6) %6"
        result, _ = _RAPID(np.array(img), use_cls=False)
    except TypeError:
        result, _ = _RAPID(np.array(img))
    boxes = []
    for pts, text, _score in result or []:
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        boxes.append((text, min(xs) / scale, min(ys) / scale, (max(xs) - min(xs)) / scale, (max(ys) - min(ys)) / scale))
    return boxes


def ocr_boxes(img, engine: str = "auto"):
    """Try the engines in order. Any Windows OCR error (not just 'not installed') falls back to rapidocr."""
    errs = []
    order = {"auto": ["windows", "rapidocr"], "windows": ["windows"], "rapidocr": ["rapidocr"]}.get(engine, ["windows", "rapidocr"])
    for e in order:
        try:
            boxes = (windows_ocr_boxes if e == "windows" else rapid_ocr_boxes)(img)
            ocr_boxes.last_errors = errs
            return boxes, e
        except Exception as x:  # noqa: BLE001
            errs.append(f"{e}: {type(x).__name__}: {x}")
    raise OcrUnavailable("; ".join(errs) or "no OCR engine")


ocr_boxes.last_errors = []


def panel_region(img, region="left"):
    """Crop to where the numbers are. 'left' = the character panel / PoB sidebar (left 40% of the screen)."""
    w, h = img.size
    if region in ("left", "panel"):
        return img.crop((0, 0, int(w * 0.40), h))
    if isinstance(region, (list, tuple)) and len(region) == 4:
        x, y, rw, rh = region
        return img.crop((int(x * w), int(y * h), int((x + rw) * w), int((y + rh) * h)))
    return img


def capture_screen(region="left"):
    """Plain desktop screenshot (Pillow ImageGrab). region: 'left' (left 40%: PoE's character panel / PoB sidebar), 'full',
    or [x, y, w, h] as fractions of the screen."""
    from PIL import ImageGrab
    return panel_region(ImageGrab.grab(), region)


def image_from_data_url(data: str):
    from PIL import Image
    b64 = data.split(",", 1)[1] if data.startswith("data:") else data
    return Image.open(io.BytesIO(base64.b64decode(b64)))


def missing_values(text: str, fields: dict):
    """Fields whose label was read but whose number wasn't (Windows OCR drops the small coloured res numbers)."""
    miss = []
    for row in text.splitlines():
        label, rest = _split_label(row)
        f = _field_for(label) if label else None
        if f and f not in fields and f not in miss and not re.search(r"\d", rest or ""):
            miss.append(f)
    return miss


MIN_FIELDS = 6     # a real Defences-tab read has 9+ (life, mana, armour, evasion, 4 res, block)
MIN_OK = 4         # below this the read is called incomplete before a confirm is offered
OFFENCE_RE = re.compile(r"(?i)chance to hit|attacks? per second|accuracy|critical|damage per second|attack speed modifier|cast speed")
RESIST_RE = re.compile(r"(?i)resistance")


def prewarm():
    """Load the rapidocr models (about 3-4 s cold) and run one tiny read, so the first F10 is fast."""
    import time as _t
    t = _t.perf_counter()
    from PIL import Image
    rapid_ocr_boxes(Image.new("RGB", (200, 40), "black"))
    return round((_t.perf_counter() - t) * 1000)


def tab_hint(text: str, fields: dict) -> str:
    """'offence' when the screenshot is the Offence tab (a real first F10 in testing was), 'partial' when fewer than
    MIN_OK Defences fields were read, else ''."""
    if len(OFFENCE_RE.findall(text)) >= 2 and not RESIST_RE.search(text):
        return "offence"          # Offence tab open: no resistance rows at all
    if len(fields) < MIN_OK:
        return "partial"
    return ""


def read_defences(img, engine="auto", region=None) -> dict:
    """region: crop first (e.g. 'left' for a full-screen screenshot); None = use the image as given.
    auto: Windows OCR first; if it errors, or reads a stat label without its number, rapidocr reads the image
    (its fields win, Windows fills any field rapidocr lacks)."""
    if region:
        img = panel_region(img, region)
    boxes, used = ocr_boxes(img, engine)
    text = "\n".join(rows_from_boxes(boxes))
    out = parse_defences_text(text)
    out.update(engine=used, text=text[:4000], fallback=list(ocr_boxes.last_errors))
    if used == "windows":
        out["method"] = getattr(windows_ocr_boxes, "last_method", "")
        miss = missing_values(text, out["fields"])
        few = len(out["fields"]) < MIN_FIELDS
        if (miss or few) and engine == "auto":
            out_fields_before = dict(out["fields"])
            try:
                rb = rapid_ocr_boxes(img)
                rtext = "\n".join(rows_from_boxes(rb))
                r = parse_defences_text(rtext)
                fields = dict(out["fields"]); fields.update(r["fields"])
                unc = dict(out["uncapped"]); unc.update(r["uncapped"])
                out.update(fields=fields, uncapped=unc, engine="windows+rapidocr", text=rtext[:4000], source=r["source"] if r["fields"] else out["source"])
                out["fallback"].append(("windows: incomplete, no number for " + ", ".join(miss)) if miss else
                                       f"windows: only {len(out_fields_before)} fields")
            except Exception as x:  # noqa: BLE001
                out["fallback"].append(f"windows: incomplete ({', '.join(miss) or 'few fields'}); rapidocr: {type(x).__name__}: {x}")
        elif miss:
            out["missing"] = miss
    hint = tab_hint(out.get("text", ""), out["fields"])
    if hint:
        out["partial"], out["hint"] = True, hint
    return out


def synthetic_defences_image():
    """A SYNTHETIC image shaped like the PoE Defences tab (for --ocr-selftest). Not a game screenshot."""
    from PIL import Image, ImageDraw, ImageFont
    rows = [("Life", "93"), ("Mana", "128"), ("Armour", "31"), ("Evasion Rating", "40"), ("Fire Resistance", "0% (0%)"),
            ("Cold Resistance", "9% (9%)"), ("Lightning Resistance", "9% (9%)"), ("Chaos Resistance", "0% (0%)"),
            ("Chance to Block Attack Damage", "20% (20%)"), ("Block Recovery modifier", "+11%")]
    img = Image.new("RGB", (680, 22 * len(rows) + 20), (20, 16, 12))
    d = ImageDraw.Draw(img)
    font = None
    for name in ("arial.ttf", "segoeui.ttf", "DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"):
        try:
            font = ImageFont.truetype(name, 13); break
        except Exception:
            continue
    font = font or ImageFont.load_default()
    for i, (k, v) in enumerate(rows):
        d.text((10, 10 + 22 * i), k, fill=(170, 140, 95), font=font)
        d.text((470, 10 + 22 * i), v, fill=(225, 215, 190), font=font)
    expect = {"life": 93, "mana": 128, "armour": 31, "evasion": 40, "fire": 0, "cold": 9, "lightning": 9, "chaos": 0, "ablock": 20}
    return img, expect
