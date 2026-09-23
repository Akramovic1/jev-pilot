"""Generates assets/banner.svg: the jev-pilot mascot flies at the effort 'altitude'. CSS-only animation."""
import random
from html import escape

OUT = str(__import__('pathlib').Path(__file__).resolve().parents[2] / 'assets')
MONO = "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace"
SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"
T = 12.0
def pct(t): return f"{max(0, min(100, t / T * 100)):.2f}%"

# ---- the mascot: Claude Code's character (official 24x24 path), as a pilot
S = 6.0                                   # 24 units -> 144 px
CLAWD = ('M20.998 10.949H24v3.102h-3v3.028h-1.487V20H18v-2.921h-1.487V20H15v-2.921H9V20H7.488v-2.921H6V20H4.487'
         'v-2.921H3V14.05H0V10.95h3V5h17.998v5.949zM6 10.949h1.488V8.102H6v2.847zm10.51 0H18V8.102h-1.49v2.847z')
CORAL = '#D97757'

def r(x, y, w, h, fill, extra=''):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{fill}"{extra}/>'

body = (
    f'<g transform="scale({S})">'
    f'<path d="{CLAWD}" fill="{CORAL}" fill-rule="evenodd" clip-rule="evenodd"/>'
    # goggles pushed up on the forehead
    + r(3, 5.55, 18, 1.1, '#2b3a67')
    + r(4.9, 5.25, 3.6, 1.7, '#0b1020') + r(5.3, 5.55, 2.8, 1.1, '#d4ff4f') + r(5.6, 5.7, .7, .45, '#ffffff')
    + r(15.5, 5.25, 3.6, 1.7, '#0b1020') + r(15.9, 5.55, 2.8, 1.1, '#d4ff4f') + r(16.2, 5.7, .7, .45, '#ffffff')
    # scarf
    + r(3, 14.1, 18, 1.1, '#7cf0c4')
    + '</g>'
)
# eyelids: the eyes are cut-outs, so a blink paints them over for a moment
lenses = f'<g transform="scale({S})">' + r(6, 8.102, 1.488, 2.847, CORAL) + r(16.51, 8.102, 1.49, 2.847, CORAL) + '</g>'
# the scarf's loose end, two frames
scarf_a = f'<g transform="scale({S})">' + r(21, 14.1, 1.4, 1.1, '#7cf0c4') + r(22.2, 14.6, 1.4, 1.1, '#7cf0c4') + r(23.4, 15.1, 1.2, 1, '#7cf0c4') + '</g>'
scarf_b = f'<g transform="scale({S})">' + r(21, 14.1, 1.4, 1.1, '#7cf0c4') + r(22.2, 13.5, 1.4, 1.1, '#7cf0c4') + r(23.4, 12.9, 1.2, 1, '#7cf0c4') + '</g>'
# jet flames under the four legs, two frames
def flame(frame):
    out = []
    for i, x in enumerate((4.487, 7.488, 15, 18)):
        hot, warm = ('#ffd166', '#ff7a59') if (i + frame) % 2 == 0 else ('#ff7a59', '#ffd166')
        out.append(r(x, 20.1, 1.5, 1.1, hot))
        out.append(r(x + .25, 21.2, 1.0, .9 if frame == 0 else .6, warm))
    return f'<g transform="scale({S})">' + ''.join(out) + '</g>'
flame_a, flame_b = flame(0), flame(1)
contrail = ''.join(f'<rect class="trail t{i}" x="{-14 - i * 16}" y="{int(12.3 * S) + (i % 2) * 4}" width="{10 - i}" height="{10 - i}" fill="{CORAL}"/>' for i in range(6))
SPRITE_W, SPRITE_H = 24 * S, 20 * S

# ---- the effort altitude scale -------------------------------------------------
LEVELS = ['low', 'medium', 'high', 'xhigh', 'max']
SCALE_X0, SCALE_X1 = 770, 1180
LEVEL_Y = {i: 236 - i * 40 for i in range(5)}      # low 236 … max 76
PILOT_X = 930
story = [(0.0, 0), (2.4, 0), (3.3, 3), (6.0, 3), (6.7, 4), (9.4, 4), (10.4, 0), (12.0, 0)]
captions = [
    (0.1, 2.7, 'rename a variable', 'low'),
    (3.0, 6.3, 'design a job queue', 'xhigh'),
    (6.4, 9.7, '2 tool calls failed', 'max'),
]
def pilot_y(level): return LEVEL_Y[level] - SPRITE_H * 0.62
fly = '\n'.join(f"      {pct(t)} {{ transform: translate({PILOT_X}px, {pilot_y(l):.1f}px); }}" for t, l in story)

# which level label is lit, per phase
lit_css = []
for level in range(5):
    spans = [(a, b) for (a, b, _, name) in captions if LEVELS.index(name) == level]
    if not spans:
        continue
    frames = ['0% { fill: #56607d; }']
    for a, b in spans:
        frames.append(f'{pct(a + 0.4)} {{ fill: #56607d; }} {pct(a + 0.8)}, {pct(b)} {{ fill: #d4ff4f; }} {pct(b + 0.4)} {{ fill: #56607d; }}')
    frames.append('100% { fill: #56607d; }')
    lit_css.append(f"    .lvl{level} {{ animation: lvl{level} {T}s linear infinite; }}\n    @keyframes lvl{level} {{ {' '.join(frames)} }}")
scale = []
for i, name in enumerate(LEVELS):
    y = LEVEL_Y[i]
    scale.append(f'<line x1="{SCALE_X0}" y1="{y}" x2="{SCALE_X1 - 58}" y2="{y}" stroke="#fff" stroke-opacity=".08" stroke-dasharray="4 8"/>')
    scale.append(f'<text class="lvl{i}" x="{SCALE_X1}" y="{y + 5}" text-anchor="end" font-family="{MONO}" font-size="14" fill="#56607d">{name}</text>')

cap_css, cap_svg = [], []
for i, (a, b, what, level) in enumerate(captions):
    cap_css.append(f"    .cap{i} {{ animation: cap{i} {T}s linear infinite; opacity: 0; }}\n"
                   f"    @keyframes cap{i} {{ 0%, {pct(a)} {{ opacity: 0; transform: translateY(8px); }} {pct(a + .35)}, {pct(b - .35)} {{ opacity: 1; transform: translateY(0); }} {pct(b)}, 100% {{ opacity: 0; transform: translateY(-6px); }} }}")
    cap_svg.append(f'<text class="cap{i}" x="76" y="282" font-family="{MONO}" font-size="17" fill="#8d99b8">'
                   f'<tspan fill="#7cf0c4">jev ▸</tspan> {escape(what)} <tspan fill="#56607d">→</tspan> <tspan fill="#d4ff4f">effort {level}</tspan></text>')

# ---- drifting stars ------------------------------------------------------------
random.seed(7)
def stars(n, size, opacity):
    return ''.join(f'<rect x="{random.randint(0, 1280)}" y="{random.randint(8, 312)}" width="{size}" height="{size}" fill="#c9d2ea" fill-opacity="{opacity}"/>' for _ in range(n))
far, near = stars(38, 2, .35), stars(16, 3, .6)

svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="320" viewBox="0 0 1280 320" role="img" aria-labelledby="title desc">
  <title id="title">jev-pilot</title>
  <desc id="desc">Claude Code's character, dressed as a pilot, flies at the height of the reasoning effort Jev picks: low for renaming a variable, xhigh for designing a job queue, max after two failed tool calls.</desc>
  <style>
    .far {{ animation: drift 60s linear infinite; }}
    .near {{ animation: drift 28s linear infinite; }}
    @keyframes drift {{ from {{ transform: translateX(0); }} to {{ transform: translateX(-1280px); }} }}
    .pilot {{ animation: fly {T}s cubic-bezier(.45,0,.2,1) infinite; }}
    @keyframes fly {{
{fly}
    }}
    .bob {{ animation: bob 2.4s ease-in-out infinite; }}
    @keyframes bob {{ 0%, 100% {{ transform: translateY(0); }} 50% {{ transform: translateY(-6px); }} }}
    .lens {{ animation: blink 4.2s steps(1) infinite; opacity: 0; }}
    @keyframes blink {{ 0%, 92%, 100% {{ opacity: 0; }} 94%, 97% {{ opacity: 1; }} }}
    .fa {{ animation: flick .24s steps(1) infinite; }}
    .fb {{ animation: flick .24s steps(1) infinite reverse; }}
    @keyframes flick {{ 0% {{ opacity: 1; }} 50% {{ opacity: 0; }} }}
    .sa {{ animation: flick .8s steps(1) infinite; }}
    .sb {{ animation: flick .8s steps(1) infinite reverse; }}
    .trail {{ animation: trail 1.1s ease-out infinite; }}
    {' '.join(f'.t{i} {{ animation-delay: -{i * .18:.2f}s; }}' for i in range(6))}
    @keyframes trail {{ 0% {{ opacity: .9; transform: translateX(0); }} 100% {{ opacity: 0; transform: translateX(-26px); }} }}
    .boost {{ animation: boost {T}s linear infinite; opacity: 0; }}
    @keyframes boost {{ 0%, {pct(6.4)} {{ opacity: 0; }} {pct(6.7)}, {pct(9.2)} {{ opacity: .9; }} {pct(9.6)}, 100% {{ opacity: 0; }} }}
    .shine {{ animation: shine 6s ease-in-out infinite; }}
    @keyframes shine {{ 0%, 55% {{ transform: translateX(-260px); }} 85%, 100% {{ transform: translateX(560px); }} }}
{chr(10).join(lit_css)}
{chr(10).join(cap_css)}
    @media (prefers-reduced-motion: reduce) {{
      * {{ animation: none !important; }}
      .pilot {{ transform: translate({PILOT_X}px, {pilot_y(3):.1f}px); }}
      .cap1 {{ opacity: 1; }} .lvl3 {{ fill: #d4ff4f; }} .fb, .sb, .boost {{ opacity: 0; }}
    }}
  </style>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#070b18"/><stop offset=".6" stop-color="#101a36"/><stop offset="1" stop-color="#1a1540"/></linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#7cf0c4"/><stop offset="1" stop-color="#d4ff4f"/></linearGradient>
    <linearGradient id="sheen" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".85"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <radialGradient id="glow" cx=".73" cy=".45" r=".42"><stop offset="0" stop-color="#7cf0c4" stop-opacity=".16"/><stop offset="1" stop-color="#7cf0c4" stop-opacity="0"/></radialGradient>
    <clipPath id="frame"><rect width="1280" height="320" rx="24"/></clipPath>
    <clipPath id="titleclip"><text x="72" y="136" font-family="{SANS}" font-size="84" font-weight="800" letter-spacing="-2.5">jev-pilot</text></clipPath>
  </defs>
  <g clip-path="url(#frame)">
    <rect width="1280" height="320" fill="url(#bg)"/>
    <rect width="1280" height="320" fill="url(#glow)"/>
    <g class="far">{far}<g transform="translate(1280 0)">{far}</g></g>
    <g class="near">{near}<g transform="translate(1280 0)">{near}</g></g>

    <g font-family="{SANS}">
      <text x="72" y="136" font-size="84" font-weight="800" fill="#fff" letter-spacing="-2.5">jev<tspan fill="url(#accent)">-pilot</tspan></text>
      <text x="75" y="184" font-size="27" fill="#e6ebf7">Let Jev steer Claude Code.</text>
      <text x="75" y="220" font-size="19" fill="#8d99b8">The right reasoning effort, subagent model and skill for every prompt.</text>
    </g>
    <g clip-path="url(#titleclip)"><rect class="shine" x="72" y="50" width="120" height="100" fill="url(#sheen)" opacity=".55"/></g>
    {''.join(cap_svg)}

    <text x="{SCALE_X0}" y="296" font-family="{MONO}" font-size="12" letter-spacing="3" fill="#56607d">EFFORT ALTITUDE</text>
    {''.join(scale)}

    <g class="pilot">
      <g class="bob">
        {contrail}
        <g class="boost">{''.join(f'<rect x="{-30 - i * 22}" y="{20 + i * 17}" width="{16 + i * 4}" height="3" fill="#d4ff4f"/>' for i in range(4))}</g>
        {body}
        <g class="lens">{lenses}</g>
        <g class="sa">{scarf_a}</g><g class="sb">{scarf_b}</g>
        <g class="fa">{flame_a}</g><g class="fb">{flame_b}</g>
      </g>
    </g>
  </g>
</svg>
'''
open(f'{OUT}/banner.svg', 'w').write(svg)
print(len(svg), 'bytes')
