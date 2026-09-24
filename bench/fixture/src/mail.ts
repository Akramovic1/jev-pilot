import { config } from './config.ts'

export function sendMail(to: string): string {
  const host = process.env['SMTP_HOST'] ?? 'localhost'
  return `mail to ${to} via ${host} (${config.currency})`
}
