import { expect, test } from 'bun:test'
import { DESIGN_BAR, DESIGN_MD, designBlock, designQuestion, packSkills, readDesign } from '../hooks/skill-suggestion.policy.ts'
import { RESERVED_NAMES } from '../hooks/crew.ts'

test('the design question is a noul on OpenRouter and TypeSafe, a boolean on the Gateway', () => {
  expect((designQuestion('openrouter') as { type: string }).type).toBe('noul')
  expect((designQuestion('gateway') as { type: string }).type).toBe('boolean')
  expect(DESIGN_BAR).toBe(0.8)
})

test('the answer reads as P(UI design work), or null when not asked', () => {
  expect(readDesign(JSON.stringify({ answers: { ui_design: { type: 'noul', noul: 0.97 } } }))).toBe(0.97)
  expect(readDesign(JSON.stringify({ answers: { which: { choice: 'x' } } }))).toBeNull()
  expect(readDesign(null)).toBeNull()
  expect(readDesign('not json')).toBeNull()
})

test('only the design skills that are installed are named, plugin names included', () => {
  const installed = ['impeccable', 'vercel:web-design-guidelines', 'frontend-design', 'systematic-debugging']
  expect(packSkills(['design-taste-frontend', 'impeccable', 'web-design-guidelines'], installed)).toEqual(['impeccable', 'vercel:web-design-guidelines'])
  expect(packSkills(['nothing-here'], installed)).toEqual([])
})

test('the block: the craft skills, the guidelines to check against, a direction, the connected libraries', () => {
  const block = designBlock(['design-taste-frontend', 'impeccable', 'web-design-guidelines'], { mobbin: true, inspo: false })
  expect(block).toContain('<jev_design>')
  expect(block).toContain('Load /design-taste-frontend and /impeccable')
  expect(block).toContain('check it against /web-design-guidelines')
  expect(block).toContain("follow the project's design system")
  expect(block).toContain(DESIGN_MD.raw)
  expect(block).toContain('Mobbin MCP')
  expect(block).not.toContain('Inspo')
  // No library connected, no skills installed: still a direction, nothing named that isn't there.
  const bare = designBlock([], { mobbin: false, inspo: false })
  expect(bare).not.toContain('Load')
  expect(bare).not.toContain('Mobbin')
  expect(bare).toContain('awesome-design-md')
})

test('"design" is a /jev switch, so never a custom model name', () => {
  expect(RESERVED_NAMES.has('design')).toBe(true)
})
