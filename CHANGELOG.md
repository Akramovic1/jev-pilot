# Changelog

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
