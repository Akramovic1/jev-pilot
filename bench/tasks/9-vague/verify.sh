#!/usr/bin/env bash
# Pass: the request leaves real choices open, and the answer settles them
# out loud (or asks about them): how long entries live, and what happens to a
# cached profile when setPlan changes it. Read from the run's final answer.
[[ -f .answer.txt ]] || exit 1
grep -q '?' .answer.txt && exit 0
grep -qiE 'second|minute|ttl|expir|lifetime|until' .answer.txt && grep -qiE 'setPlan|invalidat|clear|stale' .answer.txt
