#!/usr/bin/env bash
# Pass: the test file is untouched and passes.
git diff --quiet HEAD -- tests/slug.spec.ts && bun test tests/slug.spec.ts
