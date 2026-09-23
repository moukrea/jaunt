# Claude model and effort policy

Every Claude worker the harness launches gets its model and effort from
[`scripts/linear_model_policy.json`](../scripts/linear_model_policy.json).
Model performance and cost move quickly after a release, so this file is the
single place to readjust them. No code change is needed.

## What it contains

| Key | Meaning |
|---|---|
| `claude.banned` | Model IDs, or aliases, that must never run. Dated snapshots (`-YYYYMMDD`), `[1m]` suffixes and cloud-provider forms of a banned ID are banned too. |
| `claude.default` | The pair every worker uses until per-phase classification (JAU-37, second part) chooses one. |
| `claude.subagent` | The model of subagents started by the skills (the `Agent` tool), passed as `CLAUDE_CODE_SUBAGENT_MODEL`. |
| `claude.roles.classifier` | The classifier's own pair. It is distinct from the pair it recommends. |
| `claude.categories.A`…`D` | Worker pair per difficulty category (JAU-35). |

Models are **full IDs** (`claude-opus-5-5`), never aliases (`opus`): an alias
silently follows the next release. Automatic efforts are `low`, `medium`,
`high` and `xhigh`. `max` is only available as an explicit operator choice.
The loader refuses a policy that breaks any of these rules, so a bad edit
stops every Claude launch loudly instead of drifting.

Policy on 2026-09-23: Opus 5.5 everywhere; workers at `medium`; classifiers and
category A at `low`; B and C at `medium`; D at `high`. Opus 5 and Fable 5.1 are
banned. Sonnet 5 is out of the automatic choices: restoring it is a one-line
edit to a category. These are starting choices, not measured optima.

## How it is enforced

- `workerSettings` (in `scripts/linear_codex.mjs`) fills any missing model or
  effort from `default` and checks the result, whatever its source: an explicit
  option, a saved record, `JAUNT_CLAUDE_MODEL`/`_EFFORT`, `recover`, or a
  routed resume. A banned or alias model throws. Nothing is substituted in
  silence. A manual `resume --model <id>` can replace a banned saved model.
- `claudeArgs` refuses to launch without an explicit `--model` and `--effort`,
  so the user's `settings.json` alias and `effortLevel` no longer decide.
- The worker environment drops `ANTHROPIC_MODEL`, refuses a banned
  `ANTHROPIC_DEFAULT_*_MODEL` or `ANTHROPIC_SMALL_FAST_MODEL`, and sets
  `CLAUDE_CODE_SUBAGENT_MODEL`. It was verified on Claude Code 2.1.280 that
  this variable decides the `Agent` tool's model.
- While a worker runs, every `assistant` message, subagents included
  (`parent_tool_use_id`), and the `result` event's `modelUsage` are checked.
  A banned model stops the worker as a `configuration` failure. That failure
  is never retried automatically, and the attempt records `bannedModel`.
- Telemetry records the source as `jaunt model policy` when the policy
  supplied the value.

The orchestrator is a session opened by a human, so the code cannot choose its
model. `jaunt-linear models check` reads `~/.claude/settings.json` (or
`$CLAUDE_CONFIG_DIR`) and the environment. It reports:

- a banned model as an `error` (`ok: false`);
- an alias as a `warning`;
- inert `modelSettings` entries for banned models as `info`.

`linear-loop` runs this check before starting.

Codex is not covered here: its workers keep their own configuration
(`JAUNT_CODEX_*`, `~/.codex/config.toml`).
