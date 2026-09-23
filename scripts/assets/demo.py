"""Generates assets/demo.svg: an animated terminal session, CSS only (GitHub plays it in <img>)."""
from html import escape

OUT = str(__import__('pathlib').Path(__file__).resolve().parents[2] / 'assets')
MONO = "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace"
SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"

def pct(t, total):
    return f"{max(0.0, min(100.0, t / total * 100)):.2f}%"

# ------------------------------------------------------------------ terminal demo
T = 18.0
W, LH, X0, Y0 = 860, 24, 28, 78
CH = 8.45  # monospace advance at 14px
BG = '#0d1117'
lines = [  # (kind, start, text, color)  kind: type (typed) | out (fades in) | gap
    ('type', 0.4, '$ claude-jev', '#e6edf3'),
    ('out', 1.4, '  jev-pilot ready on openrouter · effort · subagents · skills', '#8d99b8'),
    ('gap', 0, '', ''),
    ('type', 2.3, '> rename userCount to activeUsers in src/stats.ts', '#e6edf3'),
    ('out', 4.1, '  jev   tier fast 0.99 · effort low · strategy direct · 566 ms', '#7cf0c4'),
    ('out', 4.7, '  →     effort low', '#d4ff4f'),
    ('gap', 0, '', ''),
    ('type', 5.8, "> the checkout tests fail since the merge and I can't see why", '#e6edf3'),
    ('out', 8.0, '  jev   tier deep 1.00 · effort high · 612 ms', '#7cf0c4'),
    ('out', 8.6, '  skill /systematic-debugging attached (fits 0.50)', '#c9d2ea'),
    ('out', 9.6, '  ✗     2 tool calls failed in a row', '#ff8f8f'),
    ('out', 10.2, '  →     effort raised high → xhigh', '#d4ff4f'),
    ('gap', 0, '', ''),
    ('type', 11.4, '> /jev-pilot:report', '#e6edf3'),
    ('out', 12.6, '  142 turns · Jev answered 97% · median 540 ms', '#c9d2ea'),
    ('out', 13.1, '  started low 61 · medium 38 · xhigh 29 · raised 3% · 8% · 17%', '#c9d2ea'),
]
END_FADE_A, END_FADE_B = 16.9, 17.6
css, body = [], []
y = Y0
for i, (kind, start, text, color) in enumerate(lines):
    if kind == 'gap':
        y += LH // 2
        continue
    visible_from = start
    css.append(f"    .l{i} {{ animation: l{i} {T}s linear infinite; opacity: 0; }}\n"
               f"    @keyframes l{i} {{ 0%, {pct(visible_from, T)} {{ opacity: 0; }} {pct(visible_from + (0.01 if kind == 'type' else 0.3), T)}, {pct(END_FADE_A, T)} {{ opacity: 1; }} {pct(END_FADE_B, T)}, 100% {{ opacity: 0; }} }}")
    body.append(f'<text class="line l{i}" x="{X0}" y="{y}" fill="{color}" xml:space="preserve">{escape(text)}</text>')
    if kind == 'type':
        width = len(text) * CH + 12
        dur = max(0.5, len(text) * 0.03)
        css.append(f"    .c{i} {{ animation: c{i} {T}s steps({len(text)}, end) infinite; }}\n"
                   f"    @keyframes c{i} {{ 0%, {pct(start, T)} {{ transform: translateX(0); }} {pct(start + dur, T)}, 100% {{ transform: translateX({width:.0f}px); }} }}")
        body.append(f'<rect class="cover c{i}" x="{X0 - 2}" y="{y - 17}" width="{width:.0f}" height="{LH}" fill="{BG}"/>')
    y += LH
cursor_y = y + LH // 2
css.append(f"    .cursor {{ animation: blink 1s steps(2, start) infinite; }}\n    @keyframes blink {{ to {{ visibility: hidden; }} }}")
H = cursor_y + 30
demo = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" role="img" aria-labelledby="dtitle ddesc" font-family="{MONO}" font-size="14">
  <title id="dtitle">jev-pilot in a Claude Code session</title>
  <desc id="ddesc">An illustrative session: a rename runs at low effort; a failing-tests prompt runs at high effort with the systematic-debugging skill attached, and is raised to xhigh after two failed tool calls; /jev-pilot:report summarises the decisions.</desc>
  <style>
{chr(10).join(css)}
    @media (prefers-reduced-motion: reduce) {{
      .line {{ animation: none !important; opacity: 1 !important; }}
      .cover {{ display: none; }}
      .cursor {{ animation: none !important; }}
    }}
  </style>
  <rect width="{W}" height="{H}" rx="14" fill="{BG}" stroke="#30363d"/>
  <rect width="{W}" height="40" rx="14" fill="#161b22"/>
  <rect y="26" width="{W}" height="14" fill="#161b22"/>
  <line x1="0" y1="40" x2="{W}" y2="40" stroke="#30363d"/>
  <circle cx="24" cy="20" r="6" fill="#ff5f57"/><circle cx="44" cy="20" r="6" fill="#febc2e"/><circle cx="64" cy="20" r="6" fill="#28c840"/>
  <text x="{W / 2}" y="25" text-anchor="middle" fill="#8b949e" font-size="13">claude-jev · jev-pilot</text>
  <defs><clipPath id="screen"><rect x="1" y="41" width="{W - 2}" height="{H - 42}" rx="13"/></clipPath></defs>
  <g clip-path="url(#screen)">
  {chr(10).join('  ' + b for b in body)}
  </g>
  <text x="{X0}" y="{cursor_y}" fill="#e6edf3">&gt; <tspan class="cursor" fill="#d4ff4f">▍</tspan></text>
</svg>
'''
open(f'{OUT}/demo.svg', 'w').write(demo)
print('demo.svg', len(demo), 'bytes')
