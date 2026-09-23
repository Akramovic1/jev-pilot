"""The pet in SVG: Clawd's pixel frames (from hooks/pet-art.ts via frames.ts) and its
speech bubble, played on a CSS timeline. Shared by pet.py, demo.py and the launch video."""
import json
import subprocess
from html import escape
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MONO = "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace"
SPINNER = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
MOOD = {'ready': '#8b949e', 'calm': '#7cf0c4', 'focused': '#c9d2ea', 'boost': '#d4ff4f', 'alert': '#ff8f8f'}

_data = None
def data():
    global _data
    if _data is None:
        out = subprocess.run(['bun', str(ROOT / 'scripts/assets/frames.ts')], capture_output=True, text=True, check=True)
        _data = json.loads(out.stdout)
    return _data

def frame_svg(key, px):
    """One frame as one path per color, runs of a color merged: small and crisp."""
    d, paths = data(), {}
    for y, row in enumerate(d['frames'][key]):
        x = 0
        while x < len(row):
            c = row[x]
            if c == '.':
                x += 1
                continue
            run = x
            while run < len(row) and row[run] == c:
                run += 1
            paths.setdefault(c, []).append(f'M{x * px} {y * px}h{(run - x) * px}v{px}h-{(run - x) * px}z')
            x = run
    return ''.join(f'<path fill="{d["palette"][c]}" d="{"".join(p)}"/>' for c, p in paths.items())

class Timeline:
    """Segments on one looping timeline of T seconds, each shown from its start to its end,
    with frame loops inside. Collects the CSS and the <defs> the SVG needs."""
    def __init__(self, T, prefix):
        self.T, self.p, self.css, self.defs, self.used, self.n, self.cycles = T, prefix, [], [], set(), 0, set()

    def pct(self, t):
        return f'{max(0.0, min(100.0, t / self.T * 100)):.3f}%'

    def span(self, a, b):
        """A class visible from a to b seconds, hidden otherwise."""
        self.n += 1
        name = f'{self.p}s{self.n}'
        keys = ['0% { opacity: 0; }'] if a > 0 else []
        keys.append(f'{self.pct(a)} {{ opacity: 1; }}')
        if b < self.T:
            keys.append(f'{self.pct(b)} {{ opacity: 0; }}')
        keys.append(f'100% {{ opacity: {1 if b >= self.T else 0}; }}')
        self.css.append(f'.{name} {{ animation: {name} {self.T}s steps(1, end) infinite; opacity: 0; }} @keyframes {name} {{ {" ".join(keys)} }}')
        return name

    def cycle(self, items, period):
        """Items shown in turn, each for period/len(items), looping from time 0."""
        n = len(items)
        if n == 1:
            return items[0]
        kf = f'{self.p}cy{n}'
        if kf not in self.cycles:
            self.cycles.add(kf)
            self.css.append(f'@keyframes {kf} {{ 0% {{ opacity: 1; }} {100 / n:.3f}% {{ opacity: 0; }} 100% {{ opacity: 0; }} }}')
        return ''.join(
            f'<g style="animation: {kf} {period}s steps(1, end) infinite; animation-delay: -{period - k * period / n:.3f}s; opacity: 0">{item}</g>'
            for k, item in enumerate(items))

    def frames(self, keys, px, period):
        uses = []
        for key in keys:
            fid = f'{self.p}f{key.replace(":", "_")}'
            if fid not in self.used:
                self.used.add(fid)
                self.defs.append(f'<g id="{fid}">{frame_svg(key, px)}</g>')
            uses.append(f'<use href="#{fid}"/>')
        return self.cycle(uses, period)

def pet_band(tl, segments, right, top, px=6, font=15):
    """The band above the prompt: the bubble, then Clawd, right-aligned at `right`.
    segments: (start, end, act frames [keys], frame period, bubble text, mood, working)."""
    d = data()
    sw, sh = d['width'] * px, d['height'] * px
    sx = right - sw
    ch = font * 0.602
    out = []
    for a, b, keys, period, text, mood, working in segments:
        cls = tl.span(a, b)
        color = MOOD[mood]
        shown = ('⠋ ' if working else '') + text
        bw = len(shown) * ch + 2 * ch + 4
        bh = font * 2.6
        bx = sx - 10 - bw
        by = top + sh / 2 - bh / 2
        ty = by + bh / 2 + font * 0.35
        label = escape(text)
        if working:
            spin = tl.cycle([f'<text x="{bx + ch + 2:.1f}" y="{ty:.1f}" fill="{color}">{g}</text>' for g in SPINNER[:8]], 0.8)
            words = f'{spin}<text x="{bx + 3 * ch + 2:.1f}" y="{ty:.1f}" fill="{color}" xml:space="preserve">{label}</text>'
        else:
            words = f'<text x="{bx + ch + 2:.1f}" y="{ty:.1f}" fill="{color}" xml:space="preserve">{label}</text>'
        out.append(
            f'<g class="{cls}"><rect x="{bx:.1f}" y="{by:.1f}" width="{bw:.1f}" height="{bh:.1f}" rx="7" fill="none" stroke="{color}" stroke-width="1.3"/>'
            f'<g font-family="{MONO}" font-size="{font}">{words}</g>'
            f'<g transform="translate({sx} {top})">{tl.frames(keys, px, period)}</g></g>')
    return ''.join(out)

def keys(act, n, start=0):
    return [f'{act}:{i}' for i in range(start, start + n)]
