// Globs are root-relative, as `git ls-files` prints them. A package is in a feature when the
// feature's journey runs code in it. Each package's own package.json stays in its feature: the
// watcher reads its own at run time, and a package's dependency list changes what Bun loads.
export const featurePaths = {
  'fault-messages': [
    'apps/watch/{src/**,package.json}',
    'modules/faults/{src/**,package.json}',
    'libs/model/{src/**,package.json}',
    'adapters/notifier-atc/{src/**,package.json}',
    'adapters/probe-net/{src/**,package.json}',
    'adapters/state-file/{src/**,package.json}',
  ],
} as const satisfies Record<string, readonly string[]>;

// A change to one of these changes every feature: the verify CLI itself.
export const sharedPaths = ['apps/verify/**'] as const;

// A path that one of these globs matches counts as no change, even where a feature's or a shared
// glob matches it too.
export const ignoredPaths = [
  // 1. No runtime effect: prose, tests and test helpers.
  'docs/**',
  '**/*.md',
  'LICENSE',
  '**/*.test.ts',
  '**/test-utils/**',

  // 2. Build, lint, CI, agent and editor wiring, which Bun never reads when it runs the source,
  //    and every file that repo-sync delivers.
  '**/tsconfig*.json',
  '**/turbo.json',
  'bunfig.toml',
  'rig.config.ts',
  'knip.json',
  '.oxlintrc.json',
  'oxfmt.config.ts',
  '.formatignore',
  '.editorconfig',
  '.gitattributes',
  '.gitignore',
  '.gitleaks.toml',
  'commitlint.config.js',
  'lefthook.yml',
  'audit-ignores.json',
  'socket.yml',
  'review.json',
  'renovate.json',
  '.agents/**',
  '.claude/**',
  '.codex/**',
  '.github/**',
  '.lefthook/**',
  'scripts/**',
  '{apps,modules,adapters,libs}/.gitkeep',

  // 3. The files Renovate changes: the root catalog, the lock file and the Bun pin. Its pull
  //    requests merge on green CI, and no agent records a verdict on them.
  'package.json',
  'bun.lock',
  '.bun-version',

  // 4. Code that no journey runs. A journey that runs one moves it to its feature.
  'adapters/alerts-axiom/**',
  'adapters/alerts-prometheus/**',
  'adapters/host-linux/**',
  'adapters/quota-anthropic/**',
  'adapters/sessions-atc/**',
  'apps/watch/systemd/**',
  'apps/watch/stu-watch.config.example.json',
] as const;
