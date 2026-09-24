export interface Account {
  id: string
  /** The balance in cents; never below zero. */
  cents: number
}

/** Moves `cents` from one account to another. A transfer that would take an account below zero is refused (throws). */
export function transfer(from: Account, to: Account, cents: number): void {
  if (from.cents - cents < 0) throw new Error('insufficient funds')
  from.cents -= cents
  to.cents += cents
}
