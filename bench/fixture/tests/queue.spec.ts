import { expect, test } from 'bun:test'
import { Queue } from '../src/queue.ts'

test('drain waits for every job', async () => {
  const queue = new Queue(2)
  const done: number[] = []
  for (let i = 0; i < 6; i++) {
    void queue.add(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2 + Math.floor(Math.random() * 12)))
      done.push(i)
    })
  }
  await queue.drain()
  expect(done.length).toBe(6)
})
