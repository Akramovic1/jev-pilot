import { expect, test } from 'bun:test'
import { costRank, describeStats, recordSubagent, recordSubagentUsage, recordTurn, resetStats, shortStats } from '../hooks/session-stats.ts'

test('turns count below or above the effort the session was set to', () => {
  resetStats()
  recordTurn('high', 'low')
  recordTurn('high', 'medium')
  recordTurn('high', 'high')
  expect(recordTurn('high', 'xhigh')).toBe(4)
  expect(describeStats()).toBe('this session: 4 turns · 2 started below your high effort, 1 above')
  expect(shortStats()).toBe('session · 2/4 turns below high')
})

test('custom models rank cheapest, then Haiku, Sonnet, Opus, whatever the version', () => {
  expect(costRank('jev-alpha')).toBe(-1)
  expect(costRank('claude-haiku-4-5-20251001')).toBe(0)
  expect(costRank('sonnet')).toBe(1)
  expect(costRank('claude-opus-5-5[1m]')).toBe(2)
  expect(costRank('gpt-9')).toBeNull()
})

test('only subagents cheaper than the conversation count, with the tokens they used', () => {
  resetStats()
  recordSubagent('a', 'claude-haiku-4-5-20251001', 'claude-opus-5-5')
  recordSubagent('b', 'jev-alpha', 'claude-opus-5-5')
  recordSubagent('c', 'claude-opus-5-5', 'claude-opus-5-5')
  recordSubagent('d', 'unknown-model', 'claude-opus-5-5')
  recordSubagentUsage('a', { input_tokens: 30_000, output_tokens: 2_000, cache_read_input_tokens: 10_000 })
  recordSubagentUsage('c', { input_tokens: 99_999 })
  // Counted once, whatever arrives twice.
  recordSubagentUsage('a', { input_tokens: 30_000 })
  expect(describeStats()).toBe('this session: 0 turns · 2 of 4 subagents on a cheaper model (1 haiku, 1 jev-alpha) · 42k tokens on them instead of the main model')
  expect(shortStats()).toContain('2 cheaper subagents')
})

test('a new session starts from nothing', () => {
  recordTurn('medium', 'low')
  resetStats()
  expect(describeStats()).toBe('this session: nothing decided yet')
})
