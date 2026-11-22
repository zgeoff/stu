# Working in stu

stu holds what the owner's conversation needs to run, starting with the watcher that reports when
something breaks and when it recovers. Your job here is one change, from one task. Build what the
task specifies, and keep the docs true: rewrite each sentence that your change makes false. Hand
back an open pull request with green CI: watch its checks after each push, and fix each failure.
Don't merge it: the repo owner merges every pull request.

The mistakes that cost most here:

- code in a package that the [layout](#layout) doesn't allow;
- a behaviour change with no change to the doc that describes the behaviour;
- anything private pushed to this public repo.

## Key rules

- [Before you start](#before-you-start): load the skills your work needs.
- [Layout](#layout): code under `modules/` and `libs/` does no I/O.
- [Packages](#packages): one exact version per dependency, in the root catalog.
- [Checks](#checks): run the local checks before you push. Never run the type-aware lint locally.
- [Commits and pull requests](#commits-and-pull-requests): Conventional Commits, one PR per change,
  no attribution lines.
- [Public repo](#public-repo): nothing from your machine or anyone's private setup.

## Before you start

- When the task names a pull request or an issue it depends on, check with `gh` that the pull
  request has merged, or that the issue is closed as completed. When it isn't, stop: open no pull
  request, and name that work in your reply.
- Load the skill for the work before you start it. The skills are in `.agents/skills/`, and
  `.claude/skills` links to that folder:

  | Skill                           | Load before                             |
  | ------------------------------- | --------------------------------------- |
  | `docs-writing`                  | writing or editing any committed prose  |
  | `code-style`                    | writing, reviewing or renaming code     |
  | `testing` and `project-testing` | writing or reviewing a test             |
  | `ci-design`                     | changing a workflow, a job or a trigger |
  | `skill-writing` and `deslop`    | creating or changing a skill            |

- The repo-sync workflow copies the shared skills from
  [zgeoff/skills](https://github.com/zgeoff/skills), and the shared workflows, hooks and scripts
  from [zgeoff/tools](https://github.com/zgeoff/tools), and overwrites local changes. Never edit a
  synced file here: `review.json` lists the synced files beyond those the shared noslop config
  lists. When a synced file is wrong, say so in your PR description.

## Layout

The workspace has four kinds of package. Each package's folder name is its package name, under
`@stu/`, such as `modules/health` for `@stu/health`, and every package sets `"private": true`.

- `apps/`: the programs that run. An app builds the adapters and passes them in.
- `modules/`: the domain logic. A module reads no files, starts no processes, makes no network
  calls, and reads neither the clock nor the environment. It gets time, settings and the adapters it calls as arguments, so its tests pass in fakes and touch no outside system.
- `adapters/`: one package for each outside system.
- `libs/`: types, schemas and pure helpers that two or more packages use. A lib does no I/O, the
  same as a module.

Three checks enforce the layout:

- `turbo boundaries` fails on an import that the package's tag doesn't allow. Each package's
  `turbo.json` sets its tag, `app`, `module`, `adapter` or `lib`, and the root `turbo.json` lists
  what each tag may import: a module imports modules and libs, and never an adapter.
- The `zgeoff/import-zones` lint rule fails when a file in `modules/` or `libs/` imports a Node
  module for files, processes or the network, and when a package outside `adapters/` calls `fetch`.
- oxlint's `no-restricted-globals` rule fails on any use of `Date`, `process` or `Bun` in `modules/`
  and `libs/`.

When a check fails, move the code to the kind of package that the layout allows. Never add an
exception to a rule.

## Packages

- Pin every external version once, exactly, in the root `workspaces.catalog`. A package writes
  `"catalog:"` for an external dependency and `"workspace:*"` for another `@stu/*` package.
- Install with the Bun version in `packageManager`. Another version rewrites unrelated lines of
  `bun.lock`.
- When you add a first-party package, such as one from `@zgeoff/`, add its full name to
  `minimumReleaseAgeExcludes` in `bunfig.toml`. Renovate bumps these packages as soon as they
  publish, and without the entry `bun install` refuses the bump. A scope pattern such as `@zgeoff/*`
  lets nothing through.
- Never ignore an audit finding to get past CI's dependency audit. An ignore that
  `audit-ignores.json` records, with its reason and expiry, is the one exception.

## Checks

- `bun run typecheck`, `bun run lint` and `bun run test` are the local checks. Run them before you
  push, and fix every failure. `bun run test` runs `rig unit`, which runs the tests in random order.
- When you change a doc, a README or a skill, run `bun run check:docs`, the docs checks, and fix every failure.
- `bun run lint:full` adds the type-aware pass and the type check. Never run it locally, because
  it needs more memory than an agent's host has.
- lefthook runs the light checks before a commit and a push: lint on the files your branch changes,
  the format check, the type check, the tests beside the changed files, and `turbo boundaries`. To
  run the pre-push jobs before you push:

  ```bash
  bun x lefthook run pre-push
  ```

- Leave the larger checks to CI, because the host may have little memory. On every pull request,
  the `pr / checks` job runs the package scripts that the `BUN_CHECK_SCRIPTS` repo variable lists.
  When the variable is unset, the job runs `audit`, `deadcode`, `format:check`, `lint`, `typecheck`
  and `test`.

## Commits and pull requests

- Every change reaches `main` through a pull request from its own branch. Open it with the repo's
  pull request template.
- Commit messages and PR titles follow [Conventional Commits](https://www.conventionalcommits.org/).
  The subject starts in lowercase, uses the imperative ("add X", never "added X"), and keeps the
  whole first line to 72 characters or fewer.
- Add no attribution lines: no co-author trailers and no generator notes.

## Public repo

Everything pushed here is public, including commit messages and PR descriptions.

- Leave out home directory paths, host names, addresses, private network names and cloud account
  details.
- Leave out people's names, session IDs, tokens, spend figures, account details and issue tracker
  IDs.
- In tests and fixtures, use invented values, such as `/tmp/stu-test` for a path.
- Before each commit, search the staged diff:

  ```bash
  git diff --cached | grep -nE 'sk-ant|GOCSPX|AGE-SECRET-KEY|ops_|/home/|\.ts\.net'
  ```

  Remove each match. Search your PR description for the same strings before you open the PR. When a
  match is already in a commit on your branch, rewrite that commit before you push.

**Reply:** the pull request link and its CI state, or, when unmerged work blocked you, that pull request or issue.
