"""Generates assets/social-preview.svg: the 1280x640 card GitHub and Twitter show for the repo.

Render it to PNG for Settings -> Social preview (GitHub takes PNG/JPG, not SVG), e.g. with a
headless browser screenshot at 1280x640.
"""
import random
from pathlib import Path

OUT = Path(__file__).resolve().parents[2] / 'assets' / 'social-preview.svg'
MONO = "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace"
SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"

# Clawd, Claude Code's character (official 24x24 path), as a pilot: the same gear as the banner.
S = 11.0
CLAWD = ('M20.998 10.949H24v3.102h-3v3.028h-1.487V20H18v-2.921h-1.487V20H15v-2.921H9V20H7.488v-2.921H6V20H4.487'
         'v-2.921H3V14.05H0V10.95h3V5h17.998v5.949zM6 10.949h1.488V8.102H6v2.847zm10.51 0H18V8.102h-1.49v2.847z')
CORAL = '#D97757'

def r(x, y, w, h, fill):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{fill}"/>'

clawd = (
    f'<g transform="scale({S})">'
    f'<path d="{CLAWD}" fill="{CORAL}" fill-rule="evenodd" clip-rule="evenodd"/>'
    + r(3, 5.55, 18, 1.1, '#2b3a67')
    + r(4.9, 5.25, 3.6, 1.7, '#0b1020') + r(5.3, 5.55, 2.8, 1.1, '#d4ff4f') + r(5.6, 5.7, .7, .45, '#ffffff')
    + r(15.5, 5.25, 3.6, 1.7, '#0b1020') + r(15.9, 5.55, 2.8, 1.1, '#d4ff4f') + r(16.2, 5.7, .7, .45, '#ffffff')
    + r(3, 14.1, 18, 1.1, '#7cf0c4')
    + r(21, 14.1, 1.4, 1.1, '#7cf0c4') + r(22.2, 13.5, 1.4, 1.1, '#7cf0c4') + r(23.4, 12.9, 1.2, 1, '#7cf0c4')
    + ''.join(r(x, 20.1, 1.5, 1.1, '#ffd166') + r(x + .25, 21.2, 1.0, .9, '#ff7a59') + r(x + .45, 22.1, .6, .6, '#ffd166')
              for x in (4.487, 7.488, 15, 18))
    + '</g>'
)
trail = ''.join(r(-40 - i * 34, 12.3 * S + (i % 2) * 8, 20 - 2 * i, 20 - 2 * i, CORAL).replace('/>', f' opacity="{1 - i * .15:.2f}"/>') for i in range(6))
speed = ''.join(r(-70 - i * 40, 30 + i * 34, 44 + i * 10, 5, '#d4ff4f').replace('/>', f' opacity="{.9 - i * .15:.2f}"/>') for i in range(5))

random.seed(11)
stars = ''.join(
    f'<rect x="{random.randint(0, 1280)}" y="{random.randint(0, 640)}" width="{s}" height="{s}" fill="#c9d2ea" fill-opacity="{o}"/>'
    for s, o in [(2, .3)] * 70 + [(3, .55)] * 22)

levels = ['low', 'medium', 'high', 'xhigh', 'max']
LEVEL_Y = {i: 470 - i * 80 for i in range(5)}
scale = ''.join(
    f'<line x1="1030" y1="{LEVEL_Y[i]}" x2="1150" y2="{LEVEL_Y[i]}" stroke="#fff" stroke-opacity=".08" stroke-dasharray="6 10"/>'
    f'<text x="1220" y="{LEVEL_Y[i] + 7}" text-anchor="end" font-family="{MONO}" font-size="22" fill="{"#d4ff4f" if name == "max" else "#56607d"}">{name}</text>'
    for i, name in enumerate(levels))
chips = ['effort low → max', 'subagent models', 'the right skill', 'decision report']
chip_svg, x = [], 72
for label in chips:
    w = len(label) * 12.2 + 36
    chip_svg.append(f'<rect x="{x}" y="440" width="{w:.0f}" height="46" rx="23" fill="#fff" fill-opacity=".06" stroke="#7cf0c4" stroke-opacity=".35"/>'
                    f'<text x="{x + w / 2:.0f}" y="470" text-anchor="middle" font-family="{MONO}" font-size="20" fill="#c9d2ea">{label}</text>')
    x += w + 14

pilot_x, pilot_y = 850, LEVEL_Y[4] - 12.3 * S
svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="640" viewBox="0 0 1280 640">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#070b18"/><stop offset=".6" stop-color="#101a36"/><stop offset="1" stop-color="#1a1540"/></linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#7cf0c4"/><stop offset="1" stop-color="#d4ff4f"/></linearGradient>
    <radialGradient id="glow" cx=".76" cy=".32" r=".45"><stop offset="0" stop-color="#7cf0c4" stop-opacity=".2"/><stop offset="1" stop-color="#7cf0c4" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="1280" height="640" fill="url(#bg)"/>
  <rect width="1280" height="640" fill="url(#glow)"/>
  {stars}
  {scale}
  <g transform="translate({pilot_x} {pilot_y:.1f})">{speed}{trail}{clawd}</g>
  <g font-family="{SANS}">
    <text x="68" y="232" font-size="132" font-weight="800" fill="#fff" letter-spacing="-4">jev<tspan fill="url(#accent)">-pilot</tspan></text>
    <text x="74" y="300" font-size="40" fill="#e6ebf7">Let Jev steer Claude Code.</text>
    <text x="74" y="352" font-size="26" fill="#8d99b8">The right reasoning effort, subagent model</text>
    <text x="74" y="388" font-size="26" fill="#8d99b8">and skill for every prompt.</text>
  </g>
  {''.join(chip_svg)}
  <text x="74" y="580" font-family="{MONO}" font-size="24" fill="#7cf0c4">github.com/Akramovic1/jev-pilot</text>
  <text x="1210" y="580" text-anchor="end" font-family="{MONO}" font-size="18" fill="#56607d">a Claude Code plugin · powered by Jev</text>
</svg>
'''
OUT.write_text(svg)
print(OUT.name, len(svg), 'bytes')
