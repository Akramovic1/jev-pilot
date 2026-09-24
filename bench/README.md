# jev-bench

Does jev-pilot save tokens without making results worse? jev-bench runs the same small coding tasks with Claude Code headless, with and without jev-pilot, and checks every result automatically.

```sh
bun bench/run.ts                                  # every task, both setups, once
bun bench/run.ts --tasks 3-flaky --runs 2         # one task, twice
bun bench/run.ts --budget 0.5 --max-turns 25      # the per-run caps (the defaults)
```

## The tasks

A tiny shop backend in `fixture/` (about 15 files). Each task has a prompt and a check that fails on the untouched project and passes on a correct solution.

| Task | Kind | What it asks | Checked by |
|---|---|---|---|
| `1-rename` | easy | rename a function across three files | no old name left, the cart tests pass |
| `2-slugify` | medium | implement `slugify()` from its tests | the tests pass, the test file untouched |
| `3-flaky` | hard | a flaky test with an unknown cause (a timing bug in a queue) | the test passes 15 times in a row, untouched |
| `4-search` | search | list every function that reads `process.env` directly | exactly the four direct readers, no code changed |

## The setups

- **off**: no jev-pilot, effort `high` (Claude Code's usual default).
- **jev**: jev-pilot loaded, effort starting at `medium`.

Every run gets a fresh copy of the fixture and a lean Claude Code config with your login only (no other plugins, skills or MCP servers), so the setups start from the same place and each run stays cheap. Each run is capped at `--budget` dollars and `--max-turns` turns; a run that hits a cap counts as failed.

## What it reports

For each run: pass or fail, cost, tokens, turns, time, which models did the work, and jev-pilot's decisions (from its own record). Then, per setup: tasks passed, total cost, **cost per passed task**, output tokens and time. Results are saved in `bench/results/`.

Four tasks and one run each is a first reading, not a verdict: a single lucky or unlucky run can swing a task. Add tasks under `tasks/` (a `prompt.txt` and a `verify.sh`) or use `--runs` for firmer numbers.

## Results so far

| Date | jev-pilot | Tasks passed (off / jev) | Cost (off / jev) | Notes |
|---|---|---|---|---|
| 2026-09-24 | 0.4.13 | 4/4 / 4/4 | $1.08 / $1.08 | rename and search went to high: mechanical work read as "a change across several files" |
| 2026-09-24 | 0.4.14 | 4/4 / 4/4 | $1.09 / **$1.01** | rename and search now low (−11%, −26%); slugify medium (−12%); the flaky bug xhigh (+17%, more thinking where it's needed) |
