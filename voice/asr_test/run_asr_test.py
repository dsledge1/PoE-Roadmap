"""ASR robustness test (box only): neural TTS clips (edge-tts) mixed with synthetic music + competing 'lyrics' speech,
transcribed with faster-whisper on CPU using the companion's exact settings, then parsed.
Usage: python run_asr_test.py [model] [device]   e.g. base.en cpu"""
import asyncio, json, subprocess, sys, time
from pathlib import Path
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import companion
from test_parser import sig

OUT = Path(__file__).resolve().parent / "clips"; OUT.mkdir(exist_ok=True)
SR = 16000
CMDS = [
    ("Got a Cane of Unravelling", ["log:Cane of Unravelling"]),
    ("Porcupine card just dropped", ["log:The Porcupine (divination card)"]),
    ("Finished act ten, resistances aren't capped", ["ms:act=10", "def:ele=false"]),
    ("Chaos res thirty", ["def:chaos=30"]),
    ("Life four thousand two hundred", ["def:life_es=4200/None"]),
    ("Near death", ["log:Near-death (flasks empty / pool < 30%)"]),
    ("Lab done", ["ms:lab=next"]),
    ("Undo", ["undo"]),
    ("What's next?", ["q:next"]),
    ("How am I doing?", ["q:pace"]),
    ("Animate Weapon of Ranged Arms dropped", ["log:Animate Weapon of Ranged Arms"]),
    ("Dyadian Dawn just dropped", ["log:Dyadian Dawn"]),
    ("Act three done", ["ms:act=3"]),
    ("Kitava is dead", ["ms:kitava=next"]),
    ("Found a staff with eight hundred and twelve physical DPS", ["log:Staff 812 pDPS"]),
    ("Storm Burst of Repulsion", ["log:Storm Burst of Repulsion"]),
    ("Reached tier six", ["log:Reached T6"]),
    ("Killed Brutus with one fate", ["kill:Brutus/1"]),
]
VOICES = ["en-US-GuyNeural", "en-US-ChristopherNeural", "en-GB-RyanNeural"]
LYRICS = "Tonight we ride along the highway, under neon lights, and the radio plays our song again, baby don't you cry"

def tts(text, voice, path):
    for attempt in range(4):
        if path.exists() and path.stat().st_size > 1000: break
        r = subprocess.run([sys.executable.replace("python", "edge-tts"), "--voice", voice, "--text", text, "--write-media", str(path)], capture_output=True)
        if r.returncode: time.sleep(2 + attempt * 3)
    return load(path)

def load(path):
    raw = subprocess.run(["ffmpeg", "-v", "quiet", "-i", str(path), "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()

def music(n, seed=0):
    rng = np.random.default_rng(seed); t = np.arange(n) / SR
    chords = [(220, 277, 330), (196, 247, 294), (175, 220, 262), (196, 247, 294)]
    y = np.zeros(n, np.float32)
    for i, ch in enumerate(chords * 10):
        a, b = int(i * SR), int((i + 1) * SR)
        if a >= n: break
        seg = t[a:min(b, n)]
        for f in ch:
            y[a:min(b, n)] += 0.15 * np.sign(np.sin(2 * np.pi * f * seg)) * 0.5 + 0.1 * np.sin(2 * np.pi * f / 2 * seg)
    beat = int(SR * 0.5)
    for k in range(0, n, beat):  # kick + hat
        L = min(2000, n - k); y[k:k + L] += 0.8 * np.sin(2 * np.pi * 60 * np.arange(L) / SR) * np.exp(-np.arange(L) / 400)
        h = k + beat // 2; L = min(600, max(0, n - h)); y[h:h + L] += 0.2 * rng.standard_normal(L) * np.exp(-np.arange(L) / 120)
    return y

def mix(speech, bg, snr_db):
    pad = np.zeros(int(0.3 * SR), np.float32)
    s = np.concatenate([pad, speech, pad])
    bg = np.resize(bg, len(s))
    ps, pb = np.mean(s[s != 0] ** 2), np.mean(bg ** 2) + 1e-12
    bg = bg * np.sqrt(ps / (pb * 10 ** (snr_db / 10)))
    out = s + bg
    return (out / max(1.0, np.max(np.abs(out)))).astype(np.float32)

def main():
    model = sys.argv[1] if len(sys.argv) > 1 else "base.en"
    device = sys.argv[2] if len(sys.argv) > 2 else "cpu"
    cfg = dict(companion.DEFAULT_CONFIG, model=model, cpu_model=model, device=device)
    asr = companion.Transcriber(cfg)
    lyr = tts(LYRICS, "en-US-JennyNeural", OUT / "lyrics.mp3")
    conds = {"clean": None, "music_15dB": 15, "music+vocals_15dB": 15, "music+vocals_10dB": 10, "music+vocals_5dB (stress)": 5}
    results = {c: [0, 0, []] for c in conds}
    lat = []
    for i, (text, exp) in enumerate(CMDS):
        voice = VOICES[i % len(VOICES)]
        sp = tts(text, voice, OUT / f"cmd{i:02d}_{voice}.mp3")
        for c, snr in conds.items():
            if snr is None: a = mix(sp, np.zeros(10, np.float32), 200)
            else:
                bg = music(len(sp) + SR, seed=i)
                if "vocals" in c: bg = bg / np.sqrt(np.mean(bg ** 2)) + 1.2 * np.resize(lyr, len(bg)) / np.sqrt(np.mean(lyr ** 2))
                a = mix(sp, bg, snr)
            a = companion.prepare_audio([a], SR)
            t0 = time.perf_counter(); heard = asr.transcribe(a); dt = (time.perf_counter() - t0) * 1000
            lat.append(dt)
            got = sorted(sig(x) for x in companion.parse(heard))
            ok = got == sorted(exp)
            results[c][0] += ok; results[c][1] += 1
            if not ok: results[c][2].append((text, heard, got))
    print(f"\nmodel {asr.desc}; {len(CMDS)} commands x {len(conds)} conditions; voices {VOICES}")
    for c, (ok, n, fails) in results.items():
        print(f"  {c:26s} command accuracy {ok}/{n} = {100*ok/n:.0f}%")
        for t, h, g in fails: print(f"      said {t!r} heard {h!r} -> {g}")
    lat.sort()
    print(f"  ASR latency per clip on this CPU: median {lat[len(lat)//2]:.0f} ms, p90 {lat[int(len(lat)*0.9)]:.0f} ms, max {lat[-1]:.0f} ms")

if __name__ == "__main__":
    main()
