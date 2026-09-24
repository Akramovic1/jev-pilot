# jev-bench

Does jev-pilot save tokens without making results worse? jev-bench runs the same small coding tasks with Claude Code headless, with and without jev-pilot, and checks every result automatically.

```sh
bun bench/run.ts                                  # every task, every setup, once
bun bench/run.ts --tasks 3-flaky --runs 2         # one task, twice
bun bench/run.ts --setups off,jev                 # without the junior
bun bench/run.ts --budget 0.5 --max-turns 25      # the per-run caps (the defaults)
```

## The tasks

A tiny shop backend in `fixture/` (about 20 files). Each task has a prompt and a check that fails on the untouched project and passes on a correct solution.

| Task | Kind | What it asks | Checked by |
|---|---|---|---|
| `1-rename` | easy | rename a function across three files | no old name left, the cart tests pass |
| `2-slugify` | medium | implement `slugify()` from its tests | the tests pass, the test file untouched |
| `3-flaky` | hard | a flaky test with an unknown cause (a timing bug in a queue) | the test passes 15 times in a row, untouched |
| `4-search` | search | list every function that reads `process.env` directly | exactly the four direct readers, no code changed |
| `5-duration` | medium | implement `parseDuration("1h 30m")` from its doc and tests | the tests pass, the test file untouched |
| `6-discount` | hard | fix discount codes to follow the shop's rules: rounding, best code, order, minimums (four bugs) | the tests pass, untouched, and the cart tests still do |
| `7-currency` | easy | add an optional currency argument to `invoice()` | a hidden test of the new argument, and the cart tests |
| `8-validate` | medium | validate `createUser` input and write tests for it | a hidden test of every rule, and the tests it wrote pass |
| `9-vague` | quality | "add caching to getProfile", which leaves real choices open (lifetime, invalidation on `setPlan`, size) | the answer asks about them or states what it assumed |
| `10-transfer` | quality | "transfer() let an account go below zero, fix it": the cause is a negative amount, and there are other holes | hidden tests: negative, fractional and non-number amounts refused, same-account transfer changes nothing |

## The setups

- **off**: no jev-pilot, effort `high` (Claude Code's usual default).
- **jev**: jev-pilot loaded, effort starting at `medium`.
- **junior**: jev with the `junior-lead` mode: easy coding can go to a junior on the `alpha` slot (whatever model you set there; the results below used DeepSeek V4.1 Flash), through jev-router, reviewed by the main model. It runs on the four coding tasks only (`--junior-tasks`). Claude Code can't price a custom model, so the junior's tokens are re-priced at OpenRouter's live price for the slot's model.

Every run gets a fresh copy of the fixture and a lean Claude Code config with your login only (no other plugins, skills or MCP servers), so the setups start from the same place and each run stays cheap. Each run is capped at `--budget` dollars and `--max-turns` turns; a run that hits a cap counts as failed.

## What it reports

For each run: pass or fail, cost, tokens, turns, time, which models did the work, and jev-pilot's decisions (from its own record). Then, per setup: tasks passed, total cost, **cost per passed task**, output tokens and time. Results are saved in `bench/results/`.

Eight tasks and one run each is a reading, not a verdict: a single lucky or unlucky run can swing a task. Add tasks under `tasks/` (a `prompt.txt` and a `verify.sh`) or use `--runs` for firmer numbers.

## Results so far

| Date | jev-pilot | Tasks passed (off / jev) | Cost (off / jev) | Notes |
|---|---|---|---|---|
| 2026-09-24 | 0.4.13 | 4/4 / 4/4 | $1.08 / $1.08 | rename and search went to high: mechanical work read as "a change across several files" |
| 2026-09-24 | 0.4.14 | 4/4 / 4/4 | $1.09 / **$1.01** | rename and search now low (−11%, −26%); slugify medium (−12%); the flaky bug xhigh (+17%, more thinking where it's needed) |
| 2026-09-24 | 0.6.0 | 8/8 / 8/8 | $2.20 / **$1.92** | eight tasks: jev cheaper on 7 (−3% to −18%), dearer on the flaky bug (+15%, xhigh). **junior** (junior-lead mode, 4 coding tasks): 4/4 for $1.02 against $0.90 for jev and $1.11 for off; DeepSeek's share under 1¢ a task, but the lead's review costs about what writing did at this size |
| 2026-09-24 | 0.9.0 | quality tasks: 4/4 / 4/4 | $1.23 / **$1.09** | `9-vague` and `10-transfer`, 2 runs each: Opus 5.5 settled the open choices out loud and covered the transfer edge cases with or without jev-pilot's quality advice, so these tasks don't separate the setups (9-vague first scored 0/4 on both from a check that only looked for "assume" or a question mark; re-checked on the saved answers with the corrected check) |
