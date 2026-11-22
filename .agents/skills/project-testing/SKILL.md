---
name: project-testing
description:
  'The test commands, helpers and stand-ins of the stu repo, and the testing rules it replaces. Load
  it beside testing before you write or review a test in stu.'
metadata:
  kind: rule-set
---

# stu testing

## Facts

| Fact          | Where                                                                                                                                                                                               |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Test commands | the `test` and `test:related` scripts in the root [`package.json`](../../../package.json); [`rig.config.ts`](../../../rig.config.ts) adds no lane, so each test command runs `rig`'s built-in lanes |
| Test utils    | `src/test-utils/` of the package that owns what the helper starts, builds or fakes                                                                                                                  |

## Departures

None.

## Stand-ins

- Before you write a stand-in, search `src/test-utils/` of your own package, and of each package the
  [layout](../../../AGENTS.md#layout) lets yours import, for `start-stub-`, `build-stub-` and
  `make-stub-`. Use the one you find.
- Start [`start-stub-atc.ts`](../../../adapters/notifier-atc/src/test-utils/start-stub-atc.ts) of
  `@stu/notifier-atc` for a test that sends to the atc daemon. It answers `@atcx/client`'s hello for
  the contract major that its rules name. Pass the stub's `socketPath` to `createAtcClient`, or seed
  `daemon.json` with it through the `daemonRecord` seeder of the same package when the code under
  test finds the daemon itself.
- Start [`start-stub-http.ts`](../../../adapters/probe-net/src/test-utils/start-stub-http.ts) or
  [`start-stub-tcp.ts`](../../../adapters/probe-net/src/test-utils/start-stub-tcp.ts) of
  `@stu/probe-net` for a test of an HTTP or TCP probe.
- Build
  [`build-stub-atc-reader.ts`](../../../adapters/sessions-atc/src/test-utils/build-stub-atc-reader.ts)
  of `@stu/sessions-atc` for a test that reads atc's sessions. Give it an answer for each call the
  test makes: it rejects any other call.
- Use [`build-stub-notifier.ts`](../../../modules/faults/src/test-utils/build-stub-notifier.ts) and
  [`make-stub-kind.ts`](../../../modules/faults/src/test-utils/make-stub-kind.ts) of `@stu/faults`
  for a test of `runWatch`. They live in the module, so a module's test needs no adapter.

## Imports between packages

- Import another package's test util through its `./test-utils/*` export, such as
  `@stu/probe-net/test-utils/start-stub-tcp`. When that package has no such export, add one to its
  `package.json`, in the form the [`package.json`](../../../adapters/probe-net/package.json) of
  `@stu/probe-net` uses.
- When only tests import the other package, list it under `devDependencies` as `"workspace:*"`.
- Import only from a package that the [layout](../../../AGENTS.md#layout) lets yours import.
  `turbo boundaries` checks test files too, so a module's test never uses an adapter's test util.
