#!/usr/bin/env bash
# Pass: the test file is untouched and passes.
git diff --quiet HEAD -- tests/duration.spec.ts && bun test tests/duration.spec.ts
