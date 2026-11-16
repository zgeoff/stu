import config from '@zgeoff/oxfmt-config';
import { defineConfig } from 'oxfmt';

export default defineConfig({
  ...config,
  ignorePatterns: [
    ...config.ignorePatterns,

    // verbatim copies that repo-sync delivers from zgeoff/tools; edit them there
    '.agents/skills/docs-writing/**',
    '.agents/skills/testing/**',
    '.claude/skills/docs-writing/**',
    '.claude/skills/testing/**',
  ],
});
