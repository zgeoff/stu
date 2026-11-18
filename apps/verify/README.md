The verify CLI that `bun verify` runs: it starts a throwaway atc daemon, drives the watcher against
it, and records a verdict for each feature.

The [`verify` skill](../../.agents/skills/verify/SKILL.md) says how to run a feature's journey and
put the report in a pull request.
