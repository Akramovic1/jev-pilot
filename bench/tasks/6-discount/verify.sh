#!/usr/bin/env bash
# Pass: the test file is untouched and passes, and so does the rest of the suite that passed before.
git diff --quiet HEAD -- tests/discount.spec.ts && bun test tests/discount.spec.ts tests/cart.spec.ts
