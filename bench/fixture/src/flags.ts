export function isEnabled(name: string): boolean {
  return process.env[`FLAG_${name.toUpperCase()}`] === '1'
}

export function allFlags(): string[] {
  return ['checkout', 'coupons']
}
