/** Runs async jobs, at most `concurrency` at a time. */
export class Queue {
  private running = 0
  private waiting: (() => void)[] = []

  constructor(private readonly concurrency = 2) {}

  async add<T>(job: () => Promise<T>): Promise<T> {
    while (this.running >= this.concurrency) await new Promise<void>((resolve) => this.waiting.push(resolve))
    this.running++
    try {
      return await job()
    } finally {
      this.running--
      this.waiting.shift()?.()
    }
  }

  /** Resolves once every job added so far has finished. */
  async drain(): Promise<void> {
    if (this.running === 0 && this.waiting.length === 0) return
    await new Promise<void>((resolve) => setTimeout(resolve, 10))
  }
}
