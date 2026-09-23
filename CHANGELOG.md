# Changelog

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
