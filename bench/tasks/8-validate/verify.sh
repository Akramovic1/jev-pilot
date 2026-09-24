#!/usr/bin/env bash
# Pass: a hidden test of the rules passes, and the tests the task asked for exist and pass.
mkdir -p verify-hidden && cat > verify-hidden/users.spec.ts <<'SPEC'
import { expect, test } from 'bun:test'
import { createUser, ValidationError } from '../src/users.ts'
test('good input: stored, name trimmed', () => expect(createUser('ada@x.io', '  Ada ')).toEqual({ email: 'ada@x.io', name: 'Ada' }))
test('bad emails', () => {
  expect(() => createUser('ada.x.io', 'Ada')).toThrow(ValidationError)
  expect(() => createUser('ada @x.io', 'Ada')).toThrow(ValidationError)
})
test('bad names', () => {
  expect(() => createUser('ada@x.io', '   ')).toThrow(ValidationError)
  expect(() => createUser('ada@x.io', 'a'.repeat(51))).toThrow(ValidationError)
  expect(createUser('ada@x.io', 'a'.repeat(50)).name.length).toBe(50)
})
SPEC
[[ -f tests/users.spec.ts ]] && bun test ./verify-hidden/users.spec.ts ./tests/users.spec.ts
