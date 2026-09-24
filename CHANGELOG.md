# Changelog

## 0.7.0 — 2026-09-24

**You choose the custom models.**

- **No default model.** `alpha`, `beta` and `gamma` start empty; nothing is sent to a model you didn't pick. (If you already used `alpha`, it keeps the model it had.)
- **Paste it from OpenRouter.** `/jev alpha <model>` takes the model's id, its page link or its name, as you copy it from [openrouter.ai/models](https://openrouter.ai/models?supported_parameters=tools). It's looked up in OpenRouter's live list and set with what it is (name, context, price), then checked with a 1-token request. A model OpenRouter doesn't have is refused with the three closest ones to try, newest first; so is one that can't call tools, since a subagent works through them.
- **Kept for every session.** The choice is recorded in `~/.claude/jev-pilot/models.json`, which every session reads, in any project and whichever way jev-pilot is installed (the plugin's own store is kept per install, so it wasn't enough). A session already open takes up a change made elsewhere at its next prompt.
- **Easy to switch back.** `/jev alpha` shows the slot, its model and the last five models you set, each as the command that sets it again.
- The modes that hand work to custom models (`budget`, `junior-lead`) say how to set one when none is set.

## 0.6.0 — 2026-09-24

**One request per prompt, a router that can't break your work, and tuning learned from your own turns.**

- **One Jev request per prompt instead of three.** The effort, model, strategy and skill questions go together in one request, about 0.5 s, down from about 1.5 s for three in a row. One request with both sets of questions takes as long as the slower one alone, and gave the same effort, model and strategy on every prompt tried.
- **Better skill picks without the second request.** Jev now reads each skill's description and the opening of its `SKILL.md` beside a "none of these fits" option, and is asked to match the kind of work rather than a product the prompt names. On 16 test prompts it picked the same skill as the old three-request pipeline 14 times, and the other two were better: no skill for a rename (was `codex-delegate`), and a failing test goes to `systematic-debugging` instead of a skill named after the library it mentions. The old second request is still there as the `rerank` option, now off by default.
- **"continue" asks nothing.** A plain "continue" or "keep going" goes on as the last turn decided, with no request. Approvals ("yes", "go ahead") are still asked, since they often start the work the last turn only proposed.
- **`timeoutMs` is 1500 by default** (the installer already set it): one request now, instead of three each capped at 800.
- **A custom model that fails falls back to Claude.** If OpenRouter is down, busy or slow (60 s to start answering), or the model is gone, jev-router sends the same request to Anthropic as Sonnet, using the id it learned from your own traffic and kept on disk. `/jev status` shows each fallback and why. With nothing to fall back to, a permanent error such as a bad model id is passed on as-is, so Claude Code doesn't retry it nine times.
- **The router stays up.** It runs detached from the terminal that started it, since closing that terminal used to stop the router for every other `claude-jev` session. A supervisor restarts it after a crash, and `claude-jev` replaces a router left from an older version. New: `claude-jev router status` and `claude-jev router stop`. Uninstalling stops it.
- **An unchecked custom model can be used.** A headless run's first prompt comes before the model's health check; since the router now falls back, the junior and budget slots are offered unless their check failed.
- **It learns from your turns: `/jev tune`.** Every 20 turns jev-pilot reads the decision ledger, and when it points one way it proposes a change in one line (the bubble says `tune? minHighConfidence 0.5→0.6 · /jev tune`). `/jev tune apply` takes it on top of your settings, and `/jev tune reset` goes back. Each change waits for 20 new turns of evidence. New: turns started at `high` that keep finishing in two tool calls raise `minHighConfidence`.
- **What the session came to.** `/jev` ends with a tally: turns started below or above your effort, subagents on a cheaper model than the conversation's, and the tokens they used. The bubble shows it every tenth turn. These are counts, not dollars.
- **jev-bench: 8 tasks and a junior-lead setup.** Four new tasks (a parser from its tests, four rule bugs in discount codes, a new argument, input validation with hidden tests). With 0.6.0: jev-pilot passed 8/8 for $1.92 against $2.20 without it (−13%), cheaper on 7 of 8 tasks and dearer only on the flaky-test bug, where Jev chose xhigh. The junior-lead mode passed its 4 coding tasks for $1.02, against $0.90 for jev-pilot alone. At this size the junior doesn't pay: DeepSeek's share was under a cent a task, but Opus reading and testing the result costs about what writing it did. It's there for larger, well-specified changes.

## 0.5.0 — 2026-09-24

**The crew.** Custom models and other coding agents in the same Claude Code session, used the way you choose.

- **Custom models.** Three slots, `alpha`, `beta` and `gamma`, each holding any OpenRouter model (`alpha` starts as DeepSeek V4.1 Flash). Change one live with `/jev alpha <model>`. `claude-jev` starts **jev-router**, a local proxy that sends `jev-<slot>` requests to OpenRouter and everything else to Anthropic unchanged, so your Claude plan keeps working. It works with subagents and workflows. `JEV_ROUTER=off` starts without it.
- **Modes** (`/jev mode`): `standard` (Claude only, the default), `budget` (custom models take subagent work that needs no judgment), `junior-lead` (a junior on a custom model writes easy code, and Opus reviews its diff and runs the tests), `second-opinion` (an external agent reviews significant changes), and `quality` (Opus for every subagent, plus the external review).
- **Codex and OpenCode as reviewers.** `jev-pilot:codex-review` and `jev-pilot:opencode-review` run your own `codex` and `opencode` CLIs, read-only, and bring back P1/P2/P3 findings and a verdict. Claude uses them after significant changes in `second-opinion` and `quality` modes, or whenever you ask.
- **Health checks.** `/jev status` shows every worker: the router, each custom model (a 1-token request), Codex (logged in) and OpenCode (a provider logged in). Only workers that pass are used, and each has a fallback: Sonnet for a junior whose model is down, and the other reviewer.
- **The model is told about the crew.** The note Claude gets once per session names the mode, the junior and the working reviewers, and it's sent again after a `/jev` change.
- A mid-session plugin reload no longer loses the crew. It's set up again on first use.

## 0.4.14 — 2026-09-24

- **Mechanical work across many files is low.** "A rename" sat under low but "a change across several files" under high, so a rename across three files, or a search, went to high. Low now names mechanical work across many files (a rename or find-and-replace, a search that lists what it finds), and high is a change across several files *that needs working out*. On jev-bench, rename and search went from high to low.
- **Raising to high or above takes a surer answer.** New `minHighConfidence` (0.5): raises to high, xhigh or max need Jev at least 50% sure; raises to medium keep `minUpgradeConfidence` (0.3). Replayed on the 76 labelled real requests from a medium session: turns sent to high or above 25 → 13, medium tasks right 14 → 20 of 26.
- **jev-bench** (`bench/`): four small coding tasks run by Claude Code headless with and without jev-pilot, each checked automatically. With 0.4.14: 4/4 in both setups, $1.01 with jev-pilot vs $1.09 without.

## 0.4.13 — 2026-09-24

- **Effort is a choice, not a score.** Jev now picks one of five named levels (low, medium, high, xhigh, max), each described by when to choose it, instead of rating difficulty on a 0-4 scale. On the 76 labelled real requests, answers off by two or more levels went from 8-9 to 5 across two runs, medium tasks answered right from 7 to 10 of 26, and the misses are balanced instead of mostly too high. Every question to Jev is now a choice.
- **Each model says when to choose it.** Haiku when there's no logic to work out (search, read and report, copy or clone, boilerplate, comments, renames, formatting, running a command); Sonnet when the logic is ordinary or already written down (carrying out a plan, a well-specified change, tests, a described bug); Opus when the work needs real judgment. On 20 real subagent briefs, Haiku went only to a pure code search, Sonnet took the builders and fixers, and Opus kept the judgment work.

## 0.4.12 — 2026-09-24

Better effort predictions, measured on 76 real, hand-labelled requests and subagent briefs from two weeks of use. Answers off by two or more levels (wasted tokens, or a task starved of thinking) went from 19 to 9; exact answers from 43% to 50%.

- **Jev rates the work, not the topic.** Advice questions about architecture or security, and reviews of small diffs, were rated xhigh for how serious they sounded (8 of 26 medium tasks). The effort question now says to rate the work the request asks for.
- **Short approvals never lower the effort.** "fix all and continue", "ok go ahead", "1" say nothing about the size of what they approve. A short reply that isn't a question can raise the effort but never lower it.
- **Jev sees what a reply answers.** The newest message from Claude keeps its beginning and its end (where it asks "Shall I start?") with about half the context budget, instead of only its first 500 characters.
- Examples on each level of the rating scale were tried and made things worse; they're not used.

## 0.4.11 — 2026-09-24

- **Better graph and parallel advice.** Following the graph-engineering checklist (nodes, edges, shared state, a separate reviewer, bounds), `graph` advice is now a small blueprint Claude follows with plain subagents: real nodes only (a step you could do inline isn't one), waves that start together in the background, one shared plan file each node writes only its part of, a separate read-only reviewer after each join (findings go back to the builder once), at most 4 subagents at a time and 2 review rounds per wave, and "if it can't be explained in one breath, work directly". `parallel` advice is fan-out-then-join, in the background, integrated and tested once.
- **Jev tells the strategies apart better.** Measured on 12 clear-cut requests: 11/12 right before, 12/12 now (tests for four independent modules now read as parallel instead of direct 50%), and real multi-phase builds read as graph at 98–100% instead of 84–95%. Ordinary requests stay direct.

## 0.4.10 — 2026-09-24

- **Subagents are named by their task.** The bubble and the log use the subagent's short task description instead of its generic type, and show its model and effort together: `Fix S2a Codex findings → sonnet · high` instead of `general-purpose → high`.

## 0.4.9 — 2026-09-24

- **xhigh only when Jev is sure.** Close calls still lean up, but only as far as `high`. `xhigh` now needs Jev at least 60% sure the task is very hard (`xhigh` and `max` together), so a near split between hard and very hard stays at `high`.
- **Subagents are rated on carrying out their brief.** A planner's detailed brief (files, steps, tests, stakes) read as hard in itself, so builders and fixers mostly got `xhigh`. Jev is now asked how much reasoning the subagent needs to carry the brief out. On 14 real builder and fixer briefs: 10 × `xhigh` before, 12 × `high`, 1 × `xhigh` (a design brief) and 1 × `medium` now.

## 0.4.8 — 2026-09-24

- **Goggles down while subagents work.** With subagents still running in the background after a turn, the pilot cruises, goggles down, at a calm redraw rate, until they're all done. The engine's own list of agents is checked every 1.5 s, so a stopped or failed agent never leaves it flying.
- **Goggles down at max.** When the effort is raised to max mid-turn, the goggles stay down for the rest of the turn, whatever the pilot is holding.
- **Cleaner flight.** The strap is head-width, and the speed streaks at the sides are gone (they read as loose pieces of the goggles).

## 0.4.7 — 2026-09-24

- **Subagent effort.** Each subagent now gets a reasoning effort as well as a model, from the same decision, with the same rubric and confidence bars as the main conversation. The Agent tool takes no effort, so jev-pilot sets it on every request the subagent makes. Models without an effort setting are left alone. Option `routeSubagentEffort` (on by default), under the `/jev subagents` switch.
- **Claude knows jev-pilot is there.** On the first prompt of each session, and again after a compaction, Claude gets a short note listing what jev-pilot decides (only the parts switched on), so it leaves those decisions alone: it won't pin a subagent's model or effort, or create agent types just to fix one, unless you ask.
- **Turns nobody typed keep the bubble.** A subagent's or a background task's notification starts a turn that was never put to Jev; the bubble no longer calls that "no answer in time".

## 0.4.6 — 2026-09-23

- **A busy Jev stays quiet.** When Jev doesn't answer in time or its backend is overloaded (HTTP 429, 502, 503, 529), nothing is written in the conversation any more; that's in the verbose log. The pet's bubble says which it was: `no answer in time · left as is` or `jev busy · left as is`. Real errors (a bad key, a malformed request) still show, and the bubble says `jev error · left as is`.

## 0.4.5 — 2026-09-23

- **A smaller pilot.** The pet is redrawn at 3/4 scale with every part kept (goggles, head, eyes, both rows of arms, the scarf's loose end, long legs, flames): 5 lines tall instead of 6, and 24 columns wide instead of 30. The book, magnifier, paper, terminal and thought cloud are redrawn to match.

## 0.4.4 — 2026-09-23

- **Claude Code's overload fallback now stands.** With `routeMainModel` on, every later request of a turn was sent with the routed model. When that model was overloaded, Claude Code's `--fallback-model` retry was sent straight back to it, and the turn failed on 529s. A later request that names a model other than the one the engine named for the turn's first request is now taken as the engine's own move: the routed model is dropped for the rest of the turn, and the routed effort still applies. Reported on claude-code-templates#975 by @meesp123, ported from their fix for jev-model-router (#977). `routeMainModel` is off by default.

## 0.4.3 — 2026-09-23

**Claude the pilot.** jev-pilot no longer writes in the conversation. It talks through a pet above the prompt, at the right: Claude the pilot, drawn as Claude Code's character in the banner's pilot gear.

- **It shows what Claude is doing.** Thinking (a thought cloud), reading (an open book), searching (a magnifying glass), writing (paper and a pencil), running commands (a terminal), subagents and other tools (flying, goggles down). Idle, it hovers and blinks, and every few seconds jumps rope, waves or looks around.
- **Its bubble says what Jev decided**, with how sure Jev was, e.g. `⠋ reading · xhigh · /systematic-debugging · 88% sure`. A kept effort shows as `high kept · wanted low · 42% sure`, a mid-turn raise as `2 fails → max ✈`, a subagent's model as `Explore → haiku`.
- **`/jev` switches** for every part: `effort`, `raise`, `subagents`, `skills`, `strategy`, `model` and `pet`, each `on|off`, plus `all on|off` and `reset`. They apply live and are remembered across sessions.
- **New options:** `display` (`pet`, `transcript` for one line per turn, `both`, `off`), `verboseLog` (every step, with each answer's confidence) and `suggestSkills`. `logDecisions` is now the master switch for jev-pilot's messages in the conversation.
- **Confidence reads as `N% sure`** in the bubble and the turn line, instead of a bare `0.93`.
- The README has a new animated pet image and demo, drawn from the plugin's own pixel art (`scripts/assets/pet.py`, `demo.py`).

## 0.4.2 — 2026-09-23

Fixes from the automated reviews of claude-code-templates#975 (Greptile, Copilot, cubic):

- **Skill ranking across batches.** Batches are merged by rank position, not raw probability (each batch's scores are its own distribution), and the rerank shortlist grows with the number of batches, so every batch's leaders are re-read.
- **The rerank's pick must fit.** A skill is suggested only when its own fit clears `fitsThreshold`, not merely when some candidate's does.
- **Each turn keeps its own prompt.** A prompt queued mid-turn no longer replaces the one the mid-turn re-read sends to Jev.
- **Only task prompts are classified.** Notifications, peer messages, scheduled triggers, Slack pings and typed `/commands` no longer take the pending slot and leave the next real prompt's turn unrouted.
- **Dropped prompts and new sessions.** A prompt refused further down withdraws its decision; `/clear` and resume start with nothing waiting, and the skill module forgets the last session's roster and cached SKILL.md files.
- **Risk.** The "risky work gets at least `high`" floor now holds even under a `maxEffort` set lower, and risk no longer swaps a model for another of its own tier.
- **Setup and report.** `/jev-pilot:setup` refuses to plan on a `settings.json` it cannot parse; `/jev-pilot:report` edits the settings key jev-pilot is actually installed under; timeouts are counted only where a backend was asked.
- **Smaller fixes.** Subagent skill listings no longer narrow the main roster; `shortlist` is clamped to the 255-choice limit; a JSON `null` answer is no answer instead of a throw; the rerank reads a SKILL.md's own description; jev-pilot's own commands are never suggested; the unloaded-plugin text no longer names a developer path.

## 0.4.1 — 2026-09-23

- **OpenRouter app attribution.** Requests now name jev-pilot (`HTTP-Referer` and the app title), so its usage counts toward OpenRouter's app rankings for Jev.
- **Engine calls stay at the call site.** Helpers no longer receive `$`; each hook passes the few engine calls they need. Behavior is unchanged, and the code now meets claude-code-templates' mod conventions.

## 0.4.0 — 2026-09-23

First public release as **jev-pilot**.

- Merged claude-code-templates' `jev-model-router` 0.4.2 and `jev-skill-suggestion` 0.1.0 into one plugin with a single hooks entry.
- **OpenRouter backend** (`POST https://openrouter.ai/api/v1/systemone`, model `~typesafe/jev-latest`), preferred after TypeSafe's own API.
- **Effort** on a five-level rubric (`low` → `max`) that describes kinds of task, not amounts. Turns start at most at `maxEffort` (`xhigh`); close calls between two levels lean up (`effortCloseMargin`).
- **Mid-turn raise**: after `escalateAfterErrors` failed tool calls in a row, effort goes up at least one level, once per turn, up to `maxRaisedEffort` (`max`).
- **Strategy advice**: `direct`, `delegate`, `parallel` or `graph` (plain Claude Code subagents in waves), attached only when confident and consistent with the tier.
- **Recent context and request signals** sent to Jev, so follow-ups like "yes do it" are judged as the work they continue.
- **Decision ledger** and `/jev-pilot:report`, with tuning suggestions after 20 turns. No prompt text is stored.
- Skill ranking **batched** under the API's 255-choice limit, for large skill catalogs.
- No model versions hardcoded: a main-loop switch uses the newest id of each family the engine was seen using.
- **One-line install**: `install.sh` installs jev-pilot as a regular Claude Code plugin (marketplace + `claude plugin install`, with the key in Claude Code's credential store), or links a clone for development. It's safe to re-run, and supports `--uninstall`.
- **`claude-jev`** launcher, which works with either install, plus `claude-jev self-update`. On clone installs, it checks for updates once a day in the background.
- The repo is its own plugin marketplace (`.claude-plugin/marketplace.json`).
- README with an animated banner (Claude Code's character as a pilot, flying at the effort Jev picks), an animated terminal demo, and a social preview card. The generators are in `scripts/assets/`.
