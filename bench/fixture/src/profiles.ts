import { connect } from './db.ts'

export interface Profile {
  id: string
  name: string
  plan: 'free' | 'pro'
}

/** Loads a profile from the database: slow, about 200 ms a call. */
export async function fetchProfile(id: string): Promise<Profile> {
  connect()
  await new Promise((resolve) => setTimeout(resolve, 200))
  return { id, name: `user ${id}`, plan: 'free' }
}

/** A user's profile, as the rest of the app asks for it. */
export async function getProfile(id: string): Promise<Profile> {
  return fetchProfile(id)
}

/** Changes a user's plan. */
export async function setPlan(id: string, plan: Profile['plan']): Promise<void> {
  connect()
  await new Promise((resolve) => setTimeout(resolve, 50))
}
