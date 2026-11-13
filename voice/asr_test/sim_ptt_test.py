"""Simulated push-to-talk run of the real audio pipeline (box has no mic or keyboard):
fake sounddevice stream plays a TTS clip in real time, fake pynput listener presses/releases F9.
Exercises Recorder (pre-roll ring, tail), PushToTalk (auto-repeat ignore), worker thread, Whisper, parser, Hub.
Usage: python sim_ptt_test.py [model]"""
import sys, threading, time, types
from pathlib import Path
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# ---- fake sounddevice
class FakeStream:
    def __init__(self, device=None, samplerate=16000, channels=1, dtype="float32", blocksize=320, callback=None):
        self.cb, self.bs, self.sr = callback, blocksize, samplerate; self.src = np.zeros(0, np.float32); self.pos = 0
    def start(self):
        threading.Thread(target=self._run, daemon=True).start()
    def _run(self):
        while True:
            blk = self.src[self.pos:self.pos + self.bs]; self.pos += self.bs
            if len(blk) < self.bs: blk = np.concatenate([blk, 0.002 * np.random.randn(self.bs - len(blk)).astype(np.float32)])
            self.cb(blk.reshape(-1, 1), self.bs, None, None); time.sleep(self.bs / self.sr)
sd = types.ModuleType("sounddevice")
sd.InputStream = FakeStream
sd.query_devices = lambda dev=None, kind=None: {"name": "Fake Q2U", "default_samplerate": 16000, "max_input_channels": 1} if kind else []
sd.check_input_settings = lambda **k: None
sd.play = lambda *a, **k: None
sys.modules["sounddevice"] = sd
# ---- fake pynput (listener only, like the real one)
class Key: f9 = "F9"
class KeyCode:
    @staticmethod
    def from_char(c): return c
class Listener:
    inst = None
    def __init__(self, on_press=None, on_release=None): self.p, self.r = on_press, on_release; Listener.inst = self
    def start(self): pass
kb = types.SimpleNamespace(Key=Key, KeyCode=KeyCode, Listener=Listener)
pyn = types.ModuleType("pynput"); pyn.keyboard = kb; pyn.mouse = types.SimpleNamespace()
sys.modules["pynput"] = pyn; sys.modules["pynput.keyboard"] = kb

import companion
import run_asr_test as rt

cfg = dict(companion.DEFAULT_CONFIG, model=sys.argv[1] if len(sys.argv) > 1 else "base.en", device="cpu", tts=False)
cfg["cpu_model"] = cfg["model"]
fb = companion.Feedback(cfg); hub = companion.Hub(cfg, fb)
companion.run_audio(hub, cfg, fb)
stream = None
for th in threading.enumerate(): pass
rec_stream = [o for o in __import__("gc").get_objects() if isinstance(o, FakeStream)][0]
tests = [("Got a Cane of Unravelling", "cmd00_en-US-GuyNeural.mp3"), ("Chaos res thirty", "cmd03_en-US-GuyNeural.mp3"), ("Lab done", "cmd06_en-US-GuyNeural.mp3")]
for said, f in tests:
    clip = rt.load(rt.OUT / f)
    bg = rt.music(len(clip) + 16000, seed=1); bg = bg / np.sqrt(np.mean(bg ** 2)) * np.sqrt(np.mean(clip ** 2)) / (10 ** (15 / 20))
    rec_stream.src = (np.concatenate([clip, np.zeros(1600, np.float32)]) + np.resize(bg, len(clip) + 1600)).astype(np.float32) * 0.15  # quiet dynamic mic
    rec_stream.pos = 0
    n = len(hub.history)
    Listener.inst.p(Key.f9); time.sleep(0.05); Listener.inst.p(Key.f9)   # auto-repeat press must be ignored
    time.sleep(len(clip) / 16000 + 0.05)
    Listener.inst.r(Key.f9)
    t0 = time.time()
    while len(hub.history) == n and time.time() - t0 < 10: time.sleep(0.01)
    r = hub.history[-1]
    print(f"said {said!r}: heard {r['transcript']!r} -> {[a['type'] for a in r['actions']]} | ASR {r['asr_ms']} ms, release→feedback {r.get('release_to_feedback_ms')} ms (incl. {cfg['tail_ms']} ms tail; no tracker tab so result = {r['level']})")
