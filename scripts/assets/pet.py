"""Generates assets/pet.svg: Claude the pilot above a Claude Code prompt, acting out what
Claude does (thinking, reading, searching, running, writing), then playing while idle."""
from html import escape
from petsvg import MONO, Timeline, keys, pet_band, ROOT

W, H = 860, 250
T = 21.0
tl = Timeline(T, 'p')
# (start, end, frames, period, bubble, mood, working, transcript line, its color)
story = [
    (0.0, 2.0, ['rest:0', 'rest:0', 'rest:0', 'rest:blink'], 2.0, 'ready · openrouter', 'ready', False, '', ''),
    (2.0, 4.4, keys('think', 8), 1.6, 'thinking · xhigh · /systematic-debugging · 88% sure', 'boost', True, '❯ the checkout tests fail since the merge', '#e6edf3'),
    (4.4, 6.6, keys('read', 8), 1.6, 'reading · xhigh · /systematic-debugging · 88% sure', 'boost', True, '● Read(src/checkout.ts)', '#c9d2ea'),
    (6.6, 8.6, keys('search', 4), 0.8, 'searching · xhigh · /systematic-debugging · 88% sure', 'boost', True, '● Search(pattern: "applyDiscount")', '#c9d2ea'),
    (8.6, 10.6, keys('run', 8), 1.6, 'running · xhigh · /systematic-debugging · 88% sure', 'boost', True, '● Bash(npm test)  ⎿ 2 failing', '#ff8f8f'),
    (10.6, 12.6, keys('fly', 6), 1.2, 'working · 2 fails → max ✈', 'boost', True, '● effort raised to max mid-turn', '#d4ff4f'),
    (12.6, 15.0, keys('write', 12), 2.4, 'writing · 2 fails → max ✈', 'boost', True, '● Update(src/checkout.ts)', '#c9d2ea'),
    (15.0, 18.6, keys('rope', 4), 0.72, '2 fails → max ✈', 'boost', False, '● Bash(npm test)  ⎿ 42 passing', '#7cf0c4'),
    (18.6, 21.0, keys('wave', 2) * 3 + keys('look', 4), 2.4, '2 fails → max ✈', 'boost', False, '● Fixed: the discount ran twice after the merge.', '#e6edf3'),
]
BAND_TOP = 44
band = pet_band(tl, [s[:7] for s in story], right=W - 40, top=BAND_TOP)
captions = ''.join(
    f'<text class="{tl.span(a, b)}" x="30" y="30" fill="{color}" xml:space="preserve">{escape(line)}</text>'
    for a, b, *_rest, line, color in story if line)
PROMPT = BAND_TOP + 12 * 6 + 22
svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" role="img" aria-labelledby="ptitle pdesc">
  <title id="ptitle">Claude the pilot, jev-pilot's pet</title>
  <desc id="pdesc">Above the Claude Code prompt, the pilot shows what Claude is doing and its bubble says what Jev decided: thinking, reading a file, searching, running tests, flying when the effort is raised to max after two failures, writing the fix, then jumping rope and waving while idle.</desc>
  <style>
    {chr(10).join('    ' + c for c in tl.css)}
    .cursor {{ animation: blink 1s steps(2, start) infinite; }}
    @keyframes blink {{ to {{ visibility: hidden; }} }}
    @media (prefers-reduced-motion: reduce) {{ * {{ animation: none !important; }} }}
  </style>
  <defs>{''.join(tl.defs)}</defs>
  <rect width="{W}" height="{H}" rx="14" fill="#0d1117" stroke="#30363d"/>
  <g font-family="{MONO}" font-size="15">{captions}</g>
  {band}
  <line x1="24" y1="{PROMPT}" x2="{W - 24}" y2="{PROMPT}" stroke="#56607d"/>
  <text x="30" y="{PROMPT + 30}" font-family="{MONO}" font-size="16" fill="#e6edf3">❯ <tspan class="cursor" fill="#d4ff4f">▍</tspan></text>
  <line x1="24" y1="{PROMPT + 48}" x2="{W - 24}" y2="{PROMPT + 48}" stroke="#56607d"/>
  <text x="30" y="{PROMPT + 76}" font-family="{MONO}" font-size="13" fill="#8b949e">⏵⏵ jev-pilot · the pet says what Jev decided, never the chat</text>
</svg>
'''
(ROOT / 'assets/pet.svg').write_text(svg)
print('pet.svg', len(svg), 'bytes')
