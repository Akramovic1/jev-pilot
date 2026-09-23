"""Generates assets/demo.svg: an illustrative Claude Code session with jev-pilot, CSS only
(GitHub plays it in <img>). The transcript is Claude's; Jev speaks only through the pet."""
from html import escape
from petsvg import MONO, ROOT, Timeline, keys, pet_band

T = 24.0
W, LH, X0, Y0 = 860, 23, 28, 74
CH = 8.43  # monospace advance at 14px
BG = '#0d1117'
tl = Timeline(T, 'd')
pct = tl.pct
END_A, END_B = 23.0, 23.7

# (kind, start, text, color)  kind: type (typed) | out (fades in) | gap
lines = [
    ('type', 0.4, '❯ rename userCount to activeUsers in src/stats.ts', '#e6edf3'),
    ('out', 3.0, '● Update(src/stats.ts)', '#c9d2ea'),
    ('out', 3.4, '  ⎿  Updated src/stats.ts with 4 changes', '#8b949e'),
    ('out', 4.6, '● Renamed in all four places.', '#e6edf3'),
    ('gap', 0, '', ''),
    ('type', 6.0, "❯ the checkout tests fail since the merge and I can't see why", '#e6edf3'),
    ('out', 8.8, '● Read(src/checkout.ts)', '#c9d2ea'),
    ('out', 10.2, '● Search(pattern: "applyDiscount")', '#c9d2ea'),
    ('out', 11.4, '● Bash(npm test)', '#c9d2ea'),
    ('out', 12.0, '  ⎿  2 failing', '#ff8f8f'),
    ('out', 12.6, '● Bash(npm test -- checkout)', '#c9d2ea'),
    ('out', 13.2, '  ⎿  2 failing', '#ff8f8f'),
    ('out', 15.2, '● Update(src/checkout.ts)', '#c9d2ea'),
    ('out', 16.6, '● Bash(npm test)', '#c9d2ea'),
    ('out', 17.2, '  ⎿  42 passing', '#7cf0c4'),
    ('out', 17.8, '● Fixed: the discount was applied twice after the merge.', '#e6edf3'),
]
DX = 'xhigh · /systematic-debugging · 88% sure'
pet = [  # (start, end, frames, period, bubble, mood, working)
    (0.0, 2.2, ['rest:0', 'rest:0', 'rest:0', 'rest:blink'], 2.0, 'ready · openrouter', 'ready', False),
    (2.2, 3.0, keys('think', 8), 1.6, 'thinking · low · no skill · 99% sure', 'calm', True),
    (3.0, 4.6, keys('write', 12), 2.4, 'writing · low · no skill · 99% sure', 'calm', True),
    (4.6, 7.8, ['rest:0', 'rest:0', 'rest:dip', 'rest:0', 'rest:blink', 'rest:0'], 3.0, 'low · no skill · 99% sure', 'calm', False),
    (7.8, 8.8, keys('think', 8), 1.6, 'thinking · ' + DX, 'boost', True),
    (8.8, 10.2, keys('read', 8), 1.6, 'reading · ' + DX, 'boost', True),
    (10.2, 11.4, keys('search', 4), 0.8, 'searching · ' + DX, 'boost', True),
    (11.4, 13.6, keys('run', 8), 1.6, 'running · ' + DX, 'boost', True),
    (13.6, 15.2, keys('fly', 6), 1.2, 'working · 2 fails → max ✈', 'boost', True),
    (15.2, 16.6, keys('write', 12), 2.4, 'writing · 2 fails → max ✈', 'boost', True),
    (16.6, 17.8, keys('run', 8), 1.6, 'running · 2 fails → max ✈', 'boost', True),
    (17.8, 19.0, ['rest:0', 'rest:0', 'rest:blink', 'rest:0'], 1.2, '2 fails → max ✈', 'boost', False),
    (19.0, T, keys('rope', 4), 0.72, '2 fails → max ✈', 'boost', False),
]

body = []
y = Y0
for i, (kind, start, text, color) in enumerate(lines):
    if kind == 'gap':
        y += LH // 2
        continue
    name = f'l{i}'
    tl.css.append(f".{name} {{ animation: {name} {T}s linear infinite; opacity: 0; }} "
                  f"@keyframes {name} {{ 0%, {pct(start)} {{ opacity: 0; }} {pct(start + (0.01 if kind == 'type' else 0.3))}, {pct(END_A)} {{ opacity: 1; }} {pct(END_B)}, 100% {{ opacity: 0; }} }}")
    body.append(f'<text class="line {name}" x="{X0}" y="{y}" fill="{color}" xml:space="preserve">{escape(text)}</text>')
    if kind == 'type':
        width = len(text) * CH + 12
        dur = max(0.5, len(text) * 0.03)
        tl.css.append(f".c{i} {{ animation: c{i} {T}s steps({len(text)}, end) infinite; }} "
                      f"@keyframes c{i} {{ 0%, {pct(start)} {{ transform: translateX(0); }} {pct(start + dur)}, 100% {{ transform: translateX({width:.0f}px); }} }}")
        body.append(f'<rect class="cover c{i}" x="{X0 - 2}" y="{y - 17}" width="{width:.0f}" height="{LH}" fill="{BG}"/>')
    y += LH

BAND = y + 10
band = pet_band(tl, pet, right=W - 36, top=BAND, px=5, font=14)
PROMPT = BAND + 12 * 5 + 18
H = PROMPT + 84
svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" role="img" aria-labelledby="dtitle ddesc" font-family="{MONO}" font-size="14">
  <title id="dtitle">jev-pilot in a Claude Code session</title>
  <desc id="ddesc">An illustrative session. A rename runs at low effort: the pilot thinks, writes, and its bubble says low, no skill, 99% sure. A failing-tests prompt starts at xhigh effort with the systematic-debugging skill: the pilot reads, searches and runs the tests; after two failures the effort is raised to max and it flies; it writes the fix, the tests pass, and it jumps rope. Jev never writes in the conversation.</desc>
  <style>
    {chr(10).join('    ' + c for c in tl.css)}
    .cursor {{ animation: blink 1s steps(2, start) infinite; }}
    @keyframes blink {{ to {{ visibility: hidden; }} }}
    @media (prefers-reduced-motion: reduce) {{
      * {{ animation: none !important; }}
      .line {{ opacity: 1 !important; }}
      .cover {{ display: none; }}
    }}
  </style>
  <defs>{''.join(tl.defs)}</defs>
  <rect width="{W}" height="{H}" rx="14" fill="{BG}" stroke="#30363d"/>
  <rect width="{W}" height="40" rx="14" fill="#161b22"/>
  <rect y="26" width="{W}" height="14" fill="#161b22"/>
  <line x1="0" y1="40" x2="{W}" y2="40" stroke="#30363d"/>
  <circle cx="24" cy="20" r="6" fill="#ff5f57"/><circle cx="44" cy="20" r="6" fill="#febc2e"/><circle cx="64" cy="20" r="6" fill="#28c840"/>
  <text x="{W / 2}" y="25" text-anchor="middle" fill="#8b949e" font-size="13">claude-jev · jev-pilot</text>
  {chr(10).join('  ' + b for b in body)}
  {band}
  <line x1="20" y1="{PROMPT}" x2="{W - 20}" y2="{PROMPT}" stroke="#56607d"/>
  <text x="{X0}" y="{PROMPT + 28}" fill="#e6edf3">❯ <tspan class="cursor" fill="#d4ff4f">▍</tspan></text>
  <line x1="20" y1="{PROMPT + 44}" x2="{W - 20}" y2="{PROMPT + 44}" stroke="#56607d"/>
  <text x="{X0}" y="{PROMPT + 68}" fill="#8b949e" font-size="12">⏵⏵ illustrative session · Jev speaks only through the pet</text>
</svg>
'''
(ROOT / 'assets/demo.svg').write_text(svg)
print('demo.svg', len(svg), 'bytes, height', H)
