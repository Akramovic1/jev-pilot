#!/usr/bin/env bash
# Pass: the test file is untouched and passes.
git diff --quiet HEAD -- tests/slug.test.ts && bun test tests/slug.test.ts
