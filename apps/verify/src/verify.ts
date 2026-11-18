import { runVerify } from '@wringer/gunshi';
import { createVerifyRegistry } from './create-verify-registry.ts';

// The root `verify` script runs this file, so an agent calls `bun verify <command>`. `skill` names
// the folder of the verify skill, which `bun verify lint` checks.
await runVerify(createVerifyRegistry(), { skill: '.agents/skills/verify' });
