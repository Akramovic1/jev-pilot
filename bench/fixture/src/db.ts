export function connect(): string {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('no database')
  return url
}

export function poolSize(): number {
  return 4 // tuned by hand; see process.env.POOL (not read here)
}
