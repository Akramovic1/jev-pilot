# jev-pilot

**Let a decision model steer Claude Code: the right reasoning effort, subagent model and skill for every prompt.**

jev-pilot is a Claude Code plugin. Before each turn, it asks [Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev), TypeSafe's fast decision model, a few typed questions about your prompt. It then sets up the turn from the answers:

| Decision | When | Default |
|---|---|---|
| **Reasoning effort** of the main conversation, `low` → `xhigh` | start of each turn | on |
| **Raise effort to `max`** when tool calls keep failing | mid-turn, at most once | on, after 2 failures in a row |
| **Subagent model**: Haiku, Sonnet or Opus | when a subagent starts | on |
| **How to carry the task out**: `direct`, `delegate`, `parallel` or `graph` | start of each turn, as advice | on |
| **The one skill** the prompt needs, if any | start of each turn | on |
| Main-conversation model | start of each turn | **off**: switching invalidates the prompt cache |

The aim: keep Opus for the conversation, spend reasoning where the task needs it, and run easy subagent work on cheaper models. Every decision is recorded, and `/jev-pilot:report` shows whether it's paying off in your own sessions.

> **Early access.** jev-pilot uses Claude Code's function hooks (`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`, Claude Code 2.1.278 or newer), which are still early access and may change between releases.

## Quick start

**1. Get it.**

```sh
git clone https://github.com/Akramovic1/jev-pilot.git
ln -s "$PWD/jev-pilot/bin/claude-jev" ~/.local/bin/claude-jev   # any directory on your PATH
```

**2. Give it a key.** Add this to `~/.claude/settings.json` (your user settings, not a project's). Create a key at [openrouter.ai/keys](https://openrouter.ai/keys). Jev on OpenRouter costs about $0.04 per million input tokens, with free output.

```json
{
  "pluginConfigs": {
    "jev-pilot": {
      "options": {
        "openrouterApiKey": "sk-or-v1-...",
        "timeoutMs": 1500
      }
    }
  }
}
```

With no key at all, it still runs on Claude Code's built-in classifier, with fewer decisions (no confidence, no strategy).

**3. Run it.**

```sh
claude-jev            # same arguments as claude: claude-jev -c, claude-jev -p "...", …
```

`claude-jev` is Claude Code with the plugin loaded and function hooks on. Plain `claude` stays as it was. The first prompt should log:

```
[jev-model-router] ready on openrouter (https://openrouter.ai/api/v1/systemone); routing subagent model, main effort
[jev-skill-suggestion] ready on openrouter (…); withholding the skill listing
```

and each prompt after that logs what Jev answered and what was applied:

```
[jev-model-router] jev: tier fast (0.99) · effort 0.2 → low (0.86) · risky 0.03 · strategy direct (0.99) · 566ms
[jev-model-router] main loop → effort low: fast (confidence 0.99)
[jev-skill-suggestion] suggesting /systematic-debugging: rerank of 3, fits 0.50
```

`no key set` in the first line means the options aren't being read. The entry must be named exactly `jev-pilot`.

**4. After a few days, run `/jev-pilot:report`.** It shows what was decided and what happened next, and suggests setting changes (see [Tuning](#tuning-from-your-own-sessions)).

## How it decides

**Effort.** Jev rates the request on a five-level rubric. Each level describes a kind of task, not an amount:

| Level | Kind of task |
|---|---|
| `low` | answered from what's known, or one mechanical step: a lookup, one command, a rename |
| `medium` | an ordinary, well-specified change to a few files, or a direct question about code in view |
| `high` | a change across several files, a described bug that must be traced, tests, a careful review |
| `xhigh` | design across components, a bug with an unknown cause, a refactor with many dependents |
| `max` | novel architecture, security or data integrity, a failure that resisted earlier attempts |

- **Close calls lean up.** If Jev's two most likely levels are within `effortCloseMargin` (0.15), the higher one wins. Under-thinking a hard task costs more than over-thinking an easy one.
- **Raising and lowering have different bars.** Raising effort needs confidence of 0.3 or more; lowering it needs 0.6.
- **Risky work gets real thought.** If carrying the task out would itself touch production, move money or destroy data, effort goes to at least `high`.
- **Turns start no higher than `maxEffort`** (`xhigh`). An effort you set above that by hand is left alone.

**Mid-turn raise.** Effort normally holds for the whole turn. When `escalateAfterErrors` tool calls in a row fail (2 by default), it goes up at least one level, once per turn. Jev re-reads the task with the trouble in view and may raise it further, up to `maxRaisedEffort` (`max`). Permission denials don't count as failures. This is the only way a turn reaches `max`.

**What Jev reads.**
- Your prompt.
- The last `contextMessages` (4) messages before it, capped at `contextChars` (2000): message text and tool names only, never tool input or output. So "yes, do it" is judged as the work it agrees to.
- Plain facts about the request: its length, how many files it names, whether it contains code or an error, whether it's a question, and what recent turns did with their tools.

**Subagent model.** Each subagent gets the cheapest tier that can do its brief well: `fastModel` (`haiku`), `balancedModel` (`sonnet`) or `deepModel` (`opus`). These are family names, so Claude Code uses its current release of each. No versions are hardcoded.

**Strategy.** The same request asks how the work should be carried out:
- `direct`: the main conversation does it. The usual case, and nothing is attached.
- `delegate`: one subagent on a cheaper model does the broad, mechanical part.
- `parallel`: independent pieces run as simultaneous subagents.
- `graph`: a small dependency graph of subagents, run in waves, integrated and tested between waves. It uses only Claude Code's own subagents. Name a heavier orchestration skill in `graphSkill` and the advice mentions it.

Advice is added to the prompt as an `<execution_strategy>` block only when:
- Jev is confident: `minStrategyConfidence` 0.6, and `minGraphConfidence` 0.8 for `graph`;
- it agrees with the tier: no `parallel` for mechanical work, and `graph` only for hard work.

Claude reads the advice and may ignore it.

**Skills.** At most one skill per prompt, picked in two steps: rank every skill by its description, then re-read the top three with their `SKILL.md`, where each can be rejected. The winner's `SKILL.md` is added to the prompt. Catalogs larger than the API's 255-choice limit are ranked in parallel batches. With `/jev-pilot:setup`, your own skills can be hidden from Claude's skill list entirely (it asks first; `/jev-pilot:setup restore` undoes it). Skills shipped by other plugins can't be hidden that way.

## Tuning from your own sessions

Every main-conversation turn is recorded in the plugin's store: what Jev answered, the effort the turn started at, whether it was raised, tool calls, failures, how it ended, and output tokens. **No prompt text is ever stored.** It keeps up to 500 turns.

`/jev-pilot:report` shows the record as a table by starting effort, with Jev's answer rate and latency. After 20 or more turns, it suggests specific changes:
- `timeoutMs`, if answers often arrive late;
- `minDowngradeConfidence` or `effortCloseMargin`, if cheap starts keep being raised, or costly starts finish trivially.

It asks before editing your settings. `/jev-pilot:report reset` clears the record, and `recordDecisions: false` turns recording off.

## Backends

Every decision uses the same model. Only the route to it differs:

| `provider` | Key option | Endpoint | Default model | Confidence |
|---|---|---|---|---|
| `typesafe` | `typesafeApiKey` | `POST api.typesafe.ai/v1/systemone` | `jev-latest` | calibrated |
| `openrouter` | `openrouterApiKey` | `POST openrouter.ai/api/v1/systemone` | `~typesafe/jev-latest` | calibrated |
| `gateway` | `gatewayApiKey` | `POST ai-gateway.vercel.sh/v4/ai/evaluation-model` | `typesafe-ai/jev` | only from an optional distribution |
| `builtin` | none | Claude Code's `$.model.classify` | n/a | none: tier only |

- **`auto`** (the default) uses the first backend in that order whose key is set.
- **Forced backends don't borrow keys.** A forced `provider` whose key is missing falls back to `builtin`; it never uses another backend's key.
- **To pin a Jev version,** set `openrouterModel` to e.g. `typesafe/jev-1.13`.

## Options

All options go under `pluginConfigs["jev-pilot"].options` in `~/.claude/settings.json`. The full list, with descriptions, is in [`.claude-plugin/plugin.json`](.claude-plugin/plugin.json). The ones you're most likely to touch:

| Option | Default | What it does |
|---|---|---|
| `openrouterApiKey` / `typesafeApiKey` / `gatewayApiKey` | — | the backend key |
| `timeoutMs` | 800 | how long to wait for Jev before leaving a turn as Claude Code built it (1500 recommended for OpenRouter) |
| `maxEffort` | `xhigh` | the highest effort a turn may start at |
| `maxRaisedEffort` | `max` | the highest effort the mid-turn raise may reach |
| `escalateAfterErrors` | 2 | failed tool calls in a row before a raise; 0 turns raising off |
| `effortCloseMargin` | 0.15 | how close two levels must be for the higher to win |
| `fastModel` / `balancedModel` / `deepModel` | `haiku` / `sonnet` / `opus` | subagent tiers: family names or full ids |
| `routeMainModel` | false | also switch the main conversation's model (invalidates the prompt cache) |
| `suggestStrategy` | true | ask for and attach strategy advice |
| `graphSkill` | — | a heavier orchestration skill the `graph` advice may name |
| `contextMessages` / `contextChars` | 4 / 2000 | how much of the conversation Jev reads; 0 sends none |
| `recordDecisions` | true | keep the decision ledger for `/jev-pilot:report` |

## Cost, latency and privacy

- **Latency:** each prompt waits for up to three Jev requests before the turn starts: one for effort, model and strategy (about 0.4–0.7 s), then the skill ranking and its re-check. That's typically about 1.5 s in total, and each request is capped at `timeoutMs`. If Jev doesn't answer in time, the turn runs exactly as Claude Code built it.
- **Cost:** Jev requests are small. The largest is the skill ranking, which sends every skill's description.
- **What leaves your machine** goes to the backend you chose:
  - the prompt;
  - the recent messages' text and tool names;
  - skill names and descriptions, and the opening of the shortlisted `SKILL.md` files.

  Tool input and output are never sent. `contextMessages: 0` sends no conversation.

## What it will and won't do

It is a fast classifier in front of Claude, not a second brain. It sees the prompt and a few recent messages, never your code. At best it matches effort and model to the task and supplies the right skill. It can still misjudge a hard task that reads as simple. The confidence bars, the lean toward more effort and the mid-turn raise limit the damage, and the report shows how often it happens. Measure it on your own work before trusting it: that's what `/jev-pilot:report` is for.

## Development

```sh
bun test                                                   # unit tests of the decision logic (tests/*.spec.ts)
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test .   # hook tests in Claude Code's own engine (engine/*.test.ts)
claude plugin validate .                                   # manifest and hook-registration rules
```

```
.claude-plugin/plugin.json        manifest and options
bin/claude-jev                    launcher
hooks/jev-pilot.ts                the one hooks module: registers both below
hooks/jev-model-router.ts         effort, subagent model, strategy, mid-turn raise, ledger
hooks/model-router.policy.ts        its pure decision logic
hooks/jev-skill-suggestion.ts     skill listing and the one-skill pick
hooks/skill-suggestion.policy.ts    its pure decision logic
hooks/context.ts                  what Jev reads of the conversation, and the request's signals
hooks/ledger.ts                   the decision record, the report and its suggestions
commands/                         /jev-pilot:setup, /jev-pilot:report
docs/                             the original modules' documentation
```

The engine tests load the plugin without options, so they cover the keyless path. The keyed path is covered by the unit tests, and was checked live against OpenRouter.

## Acknowledgements

jev-pilot is built on two open-source Claude Code mods by **Daniel (San) Ávila**, from [claude-code-templates](https://github.com/davila7/claude-code-templates) (MIT):

- **jev-model-router** — [aitmpl.com](https://aitmpl.com/component/mod/productivity/jev-model-router) · [source](https://github.com/davila7/claude-code-templates/tree/main/cli-tool/components/mods/productivity/jev-model-router)
- **jev-skill-suggestion** — [aitmpl.com](https://aitmpl.com/component/mod/productivity/jev-skill-suggestion) · [source](https://github.com/davila7/claude-code-templates/tree/main/cli-tool/components/mods/productivity/jev-skill-suggestion)

Their routing policy, the two-step skill suggestion and the setup command come from those mods. Their original documentation is kept in [`docs/`](docs/). jev-pilot merges them into one plugin and adds:
- the OpenRouter backend;
- the effort rubric up to `max`, with the close-call lean and the mid-turn raise;
- strategy advice;
- recent context and request signals;
- the decision ledger and report;
- batched skill ranking;
- the `claude-jev` launcher.

The decisions are made by [**Jev**](https://typesafe.ai/blog/introducing-system-one-models-and-jev), [TypeSafe](https://typesafe.ai)'s System One model. jev-pilot is a community project, not affiliated with TypeSafe or Anthropic.

## License

[MIT](LICENSE). Portions are copyright Daniel (San) Ávila, from claude-code-templates.
