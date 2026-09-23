# Changelog

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
