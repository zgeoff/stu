<div align="center">
  <h1>stu</h1>

  <p>
    <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
  </p>

  <p>
    <a href="./docs/README.md">Documentation</a> •
    <a href="./docs/guides/run-the-watcher.md">Run the watcher</a>
  </p>
</div>

What stu, the owner's conversation, needs to run.

The repo holds one program: the watcher. It checks the owner's PC and services once a minute, and
sends stu a message when a fault opens and another when the fault recovers.

## Quick start

Install the dependencies with the Bun version that `packageManager` in
[package.json](./package.json) names:

```bash
bun install
```

## Checks

Run these before you push:

```bash
bun run typecheck
bun run lint
bun run test
bun run check:docs
```

CI runs the package scripts that the `BUN_CHECK_SCRIPTS` repo variable lists. It also scans each
pull request for secrets, and checks its title and description.

## Layout

- `apps/`: the watcher, the one program that runs.
- `modules/`: the domain logic, which does no I/O.
- `adapters/`: one package for each outside system.
- `libs/`: types, schemas and pure helpers that two or more packages share.
- `docs/`: the architecture docs and the guides.
- `scripts/`: the scripts that the package scripts run.

## Documentation

[docs/](./docs/README.md) covers how the watcher works and how to run it.
