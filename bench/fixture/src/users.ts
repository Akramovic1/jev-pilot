export class ValidationError extends Error {}

export interface User {
  email: string
  name: string
}

export function createUser(email: string, name: string): User {
  return { email, name }
}
