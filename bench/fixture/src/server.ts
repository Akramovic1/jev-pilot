import { config } from './config.ts'

export function startServer(): string {
  // Reads the port straight from the environment, not from config.
  const port = Number(process.env.PORT ?? config.port)
  return `listening on ${port}`
}

export function banner(): string {
  return `shopkit on ${config.port}`
}
