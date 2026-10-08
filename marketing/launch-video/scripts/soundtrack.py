"""Synthesizes the launch film soundtrack: a 120 BPM music bed plus sound effects.

Every sound is generated here (no samples), so the track is ours to use. Effects are placed
from scripts/cues.json, which `node scripts/frames.mjs` writes from the film's own timeline,
so clicks, typing and whooshes land on the frames where they happen.

    python3 scripts/soundtrack.py            # writes public/audio/soundtrack.wav
"""
import json
import pathlib
import wave

import numpy as np
from scipy.signal import butter, sosfilt

ROOT = pathlib.Path(__file__).resolve().parent.parent
SR = 48000
DUR = 124.0
N = int(SR * DUR)
BEAT = 0.5  # 120 BPM
BAR = 4 * BEAT
rng = np.random.default_rng(32885)


def t_axis(sec):
    return np.arange(int(sec * SR)) / SR


def midi(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def filt(x, kind, f, order=2):
    sos = butter(order, f, btype=kind, fs=SR, output='sos')
    return sosfilt(sos, x)


def add(buf, x, at, pan=0.0, gain=1.0):
    """Mixes mono x into stereo buf at time `at` with constant-power pan (-1 left .. 1 right)."""
    i = int(at * SR)
    if i >= N:
        return
    x = x[: N - i] * gain
    a = (pan + 1) * np.pi / 4
    buf[0, i:i + len(x)] += x * np.cos(a)
    buf[1, i:i + len(x)] += x * np.sin(a)


def env(n, a, d, sustain=1.0):
    """Linear attack, exponential-ish decay envelope of n samples."""
    e = np.ones(n) * sustain
    na = max(1, int(a * SR))
    e[:na] = np.linspace(0, 1, na)
    if d:
        tail = np.arange(n - na) / SR
        e[na:] = np.exp(-tail / d)
    return e


def saw(freq, sec, harmonics=10, phase=0.0):
    t = t_axis(sec)
    out = np.zeros_like(t)
    for h in range(1, harmonics + 1):
        if freq * h > SR / 2.2:
            break
        out += np.sin(2 * np.pi * freq * h * t + phase * h) / h
    return out


# ---------------------------------------------------------------- music
CHORDS = [  # one chord per bar: Fmaj7, Cadd9, G, Am7
    (41, [53, 57, 60, 64]),
    (36, [60, 64, 67, 62 + 12]),
    (43, [55, 59, 62, 67]),
    (45, [57, 60, 64, 67]),
]


def chord_at(t):
    return CHORDS[int(t // BAR) % 4]


def section_level(t):
    """How much of the groove plays at time t (0 = none, 1 = full)."""
    if t < 12:
        return 0.0
    if 58.0 <= t < 60.0:
        return 0.0
    if 84.0 <= t < 88.0:
        return 0.0
    if 112.0 <= t < 118.0:
        return 0.55
    if t >= 118.0:
        return 0.0
    return 1.0


music = np.zeros((2, N))
kick_env = np.zeros(N)  # drives the sidechain duck

# Pad: three detuned saw voices per chord tone, low-passed; filter opens through the intro.
for bar in range(int(DUR // BAR) + 1):
    t0 = bar * BAR
    if t0 >= DUR:
        break
    root, notes = chord_at(t0)
    length = BAR + 0.8  # overlap the next bar for a smooth crossfade
    if t0 >= 118:
        root, notes = 45, [57, 60, 64, 71]  # Am(add9) to finish, ringing out
        length = DUR - t0
    voice = np.zeros(int(length * SR))
    for m in notes:
        for det, ph in ((-0.07, 0.0), (0.0, 1.3), (0.07, 2.1)):
            voice += saw(midi(m + det), length, 8, ph)
    cutoff = 600 + 1600 * min(1.0, t0 / 12) if t0 < 12 else (2200 if t0 < 112 else 1500)
    voice = filt(voice, 'low', cutoff)
    if t0 >= 118:
        e = env(len(voice), 0.05, 2.6)
    else:
        e = np.minimum(1, np.minimum(np.arange(len(voice)) / (0.35 * SR), (len(voice) - np.arange(len(voice))) / (0.8 * SR)))
    level = 0.05 if t0 < 6 else 0.06
    if t0 < 2:
        e *= np.linspace(0, 1, len(e)) ** 0.5
    add(music, voice * e, t0, pan=-0.25, gain=level)
    add(music, voice * e, t0 + 0.012, pan=0.25, gain=level)

# Sub drone in the intro
drone = np.sin(2 * np.pi * midi(33) * t_axis(12)) * np.minimum(1, t_axis(12) / 3) * np.minimum(1, (12 - t_axis(12)) / 0.5)
add(music, drone, 0, gain=0.12)


def kick():
    t = t_axis(0.42)
    f = 45 + 110 * np.exp(-t / 0.03)
    ph = 2 * np.pi * np.cumsum(f) / SR
    x = np.sin(ph) * np.exp(-t / 0.16)
    x[:int(0.003 * SR)] += rng.normal(0, 0.4, int(0.003 * SR))
    return x


def clap():
    n = int(0.25 * SR)
    noise = filt(rng.normal(0, 1, n), 'band', [900, 3200])
    e = np.zeros(n)
    for k, off in enumerate((0, 0.01, 0.02)):
        i = int(off * SR)
        e[i:] += np.exp(-np.arange(n - i) / SR / (0.012 if k < 2 else 0.11))
    return noise * e


def hat(open_=False):
    n = int((0.22 if open_ else 0.05) * SR)
    x = filt(rng.normal(0, 1, n), 'high', 7000)
    return x * np.exp(-np.arange(n) / SR / (0.07 if open_ else 0.012))


K, C = kick(), clap()
steps = int(DUR / (BEAT / 4))
for s in range(steps):
    t = s * BEAT / 4
    lv = section_level(t)
    beat_pos = s % 16  # 16 sixteenths per bar
    # hats start in the build-up, before the drop
    if 6 <= t < 12 and s % 2 == 0:
        add(music, hat(), t, pan=0.3, gain=0.05 + 0.08 * (t - 6) / 6)
    if lv == 0:
        continue
    half_time = 112 <= t < 118
    if (beat_pos % 4 == 0 and not half_time) or (half_time and beat_pos in (0, 8)):
        add(music, K, t, gain=0.85 * lv)
        i = int(t * SR)
        seg = np.exp(-np.arange(len(K)) / SR / 0.12)[: N - i]
        kick_env[i:i + len(seg)] = np.maximum(kick_env[i:i + len(seg)], seg)
    if beat_pos in (4, 12) and not half_time:
        add(music, C, t, pan=0.05, gain=0.32 * lv)
    if s % 2 == 0:
        add(music, hat(), t, pan=0.35, gain=(0.07 if beat_pos % 4 else 0.045) * lv)
    if beat_pos % 4 == 2 and t >= 24:
        add(music, hat(True), t, pan=-0.3, gain=0.05 * lv)

# Bass: root on eighths, plucked, sidechained by the kick
for s in range(int(DUR / (BEAT / 2))):
    t = s * BEAT / 2
    lv = section_level(t)
    if lv == 0 and not (6 <= t < 12):
        continue
    if 6 <= t < 12:
        lv = 0.35 * (t - 6) / 6
    root, _ = chord_at(t)
    m = root + (12 if s % 4 == 3 else 0)
    tt = t_axis(BEAT / 2)
    x = (np.sin(2 * np.pi * midi(m) * tt) + 0.35 * saw(midi(m), BEAT / 2, 6)) * env(len(tt), 0.004, 0.16)
    add(music, filt(x, 'low', 700), t, gain=0.22 * lv)

# Arpeggio: chord tones in sixteenths with a ping-pong echo, from the first feature on
arp = np.zeros((2, N))
pattern = [0, 1, 2, 3, 2, 1, 3, 2]
for s in range(int(DUR / (BEAT / 2))):
    t = s * BEAT / 2
    lv = section_level(t)
    if t < 18 or lv == 0:
        continue
    _, notes = chord_at(t)
    m = notes[pattern[s % 8]] + 12
    tt = t_axis(0.3)
    tri = 2 / np.pi * np.arcsin(np.sin(2 * np.pi * midi(m) * tt))
    x = tri * env(len(tt), 0.002, 0.09)
    bright = 0.6 if t < 36 else 1.0
    add(arp, x, t, pan=-0.4 if s % 2 else 0.4, gain=0.05 * bright * lv)
echo = np.zeros_like(arp)
d = int(0.375 * SR)
echo[0, d:] = arp[1, :-d] * 0.45
echo[1, 2 * d:] = arp[0, :-2 * d] * 0.3
arp = filt(arp + echo, 'low', 5000)
music += arp

# Sidechain: duck everything but the drums a little on each kick
duck = 1 - 0.35 * kick_env
music *= duck

# Crash on the drop and on the return after the proof dive
def crash(sec=2.2):
    n = int(sec * SR)
    x = filt(rng.normal(0, 1, n), 'high', 4500)
    return x * np.exp(-np.arange(n) / SR / 0.7)


add(music, crash(), 12.0, pan=0.2, gain=0.16)
add(music, crash(), 60.0, pan=-0.2, gain=0.12)

# ---------------------------------------------------------------- sound effects
sfx = np.zeros((2, N))


def noise_burst(sec, lo, hi):
    return filt(rng.normal(0, 1, int(sec * SR)), 'band', [lo, hi])


def whoosh(dur, reverse=False):
    dur = max(0.4, min(dur, 1.4))
    n = int(dur * SR)
    x = noise_burst(dur, 250, 5000)
    p = np.linspace(0, 1, n)
    e = np.sin(np.pi * np.clip(p / 0.6, 0, 1) ** 1.5 / 2) * np.exp(-np.clip(p - 0.6, 0, 1) * 6) if not reverse else p ** 3
    return x * e


def click():
    n = int(0.03 * SR)
    t = np.arange(n) / SR
    return (np.sin(2 * np.pi * 2400 * t) * np.exp(-t / 0.004) + filt(rng.normal(0, 1, n), 'high', 3000) * np.exp(-t / 0.002) * 0.6)


def key_tick():
    n = int(0.025 * SR)
    t = np.arange(n) / SR
    f = rng.uniform(2600, 4200)
    return filt(rng.normal(0, 1, n), 'band', [f * 0.7, f * 1.3]) * np.exp(-t / 0.004)


def tick():
    t = t_axis(0.06)
    return np.sin(2 * np.pi * 1760 * t) * np.exp(-t / 0.012)


def pop():
    t = t_axis(0.16)
    f = 520 + 520 * np.exp(-t / 0.02)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.05)


def ding():
    t = t_axis(1.0)
    return (np.sin(2 * np.pi * 1318.5 * t) + 0.6 * np.sin(2 * np.pi * 1975.5 * t) * np.exp(-t / 0.2)) * np.exp(-t / 0.35) * env(len(t), 0.003, 0)


def shimmer(dur):
    n = int(dur * SR)
    p = np.linspace(0, 1, n)
    x = noise_burst(dur, 3000, 9000) * np.sin(np.pi * p) ** 2
    sweep = np.sin(2 * np.pi * np.cumsum(400 + 900 * p) / SR) * np.sin(np.pi * p) ** 2
    return x * 0.6 + sweep * 0.25


def boom(f0=55, dec=0.6, noise=0.5, sec=1.6):
    t = t_axis(sec)
    f = f0 + 70 * np.exp(-t / 0.05)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / dec)
    x += filt(rng.normal(0, 1, len(t)), 'low', 2500) * np.exp(-t / 0.08) * noise
    return x


def riser(dur):
    n = int(dur * SR)
    p = np.linspace(0, 1, n)
    x = filt(rng.normal(0, 1, n), 'high', 1500) * p ** 2.5
    sweep = np.sin(2 * np.pi * np.cumsum(200 + 1400 * p ** 2) / SR) * p ** 2
    return x * 0.5 + sweep * 0.3


cues = json.loads((ROOT / 'scripts/cues.json').read_text())
for c in cues:
    t, k, soft = c['t'], c['kind'], c.get('soft', False)
    if k == 'whoosh':
        w = whoosh(c.get('dur', 0.8))
        add(sfx, w, t, pan=-0.3, gain=0.22)
        add(sfx, w, t + 0.01, pan=0.3, gain=0.22)
    elif k == 'swipe':
        add(sfx, whoosh(0.5), t, pan=0.0, gain=0.2)
    elif k == 'suck':
        add(sfx, whoosh(0.55, reverse=True), t, gain=0.28)
    elif k == 'click':
        add(sfx, click(), t, pan=0.1, gain=0.35)
    elif k == 'type':
        tt = t
        while tt < t + c['dur']:
            add(sfx, key_tick(), tt, pan=rng.uniform(-0.2, 0.2), gain=rng.uniform(0.1, 0.18))
            tt += rng.uniform(0.035, 0.075)
    elif k == 'tick':
        add(sfx, tick(), t, pan=0.15, gain=0.06 if soft else 0.1)
    elif k == 'pop':
        add(sfx, pop(), t, pan=-0.1, gain=0.22)
    elif k == 'ding':
        add(sfx, ding(), t, pan=0.2, gain=0.1)
    elif k == 'render':
        add(sfx, shimmer(c.get('dur', 1.5)), t, gain=0.12)
    elif k == 'hit':
        add(sfx, boom(55, 0.45, 0.4, 1.2), t, gain=0.45 if soft else 0.6)
    elif k == 'impact':
        add(sfx, boom(45, 1.1, 0.6, 2.4), t, gain=0.55 if soft else 0.75)
        if not soft:
            add(sfx, crash(2.4), t, gain=0.1)
    elif k == 'riser':
        add(sfx, riser(c.get('dur', 1.0)), t, gain=0.22)

# ---------------------------------------------------------------- master
mix = music * 0.9 + sfx
mix = filt(mix, 'high', 28)
# Gentle bus compression stand-in: soft clip, then normalise to -1 dBFS
mix = np.tanh(mix * 1.25) / 1.25
fade = np.ones(N)
fade[-int(1.5 * SR):] = np.linspace(1, 0, int(1.5 * SR)) ** 2
mix *= fade
mix *= 10 ** (-1 / 20) / np.max(np.abs(mix))

out = ROOT / 'public/audio/soundtrack.wav'
pcm = (mix.T * 32767).astype(np.int16)
with wave.open(str(out), 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
rms = 20 * np.log10(np.sqrt(np.mean(mix ** 2)) + 1e-9)
print(f'wrote {out.relative_to(ROOT)}  {DUR:.0f}s  peak -1.0 dBFS  rms {rms:.1f} dBFS')
