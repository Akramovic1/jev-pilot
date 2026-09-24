#!/usr/bin/env bash
# Pass: the test file is untouched and the test passes 15 times in a row.
git diff --quiet HEAD -- tests/queue.test.ts || exit 1
for i in $(seq 1 15); do bun test tests/queue.test.ts > /dev/null 2>&1 || exit 1; done
