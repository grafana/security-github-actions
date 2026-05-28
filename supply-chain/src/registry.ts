// The single source of truth for which checks exist. Every CLI invocation
// imports from here so adding a new check requires only one edit.
//
// The order of this array is the order checks appear in the "Passing
// checks" section of the rendered report.
//
// PR1 ships four JS checks focused on disabling post-install-script
// execution at the package-manager level. Future PRs will add more JS
// checks (lockfile-committed, npx-confusion, etc.) and Go checks.

import type { Check } from './types.ts';

import { check as packagemanagerPinned } from './js/packagemanager-pinned.ts';
import { check as npmrcCorrect } from './js/npmrc-correct.ts';
import { check as pnpmWorkspaceCorrect } from './js/pnpm-workspace-correct.ts';
import { check as yarnrcCorrect } from './js/yarnrc-correct.ts';

// All checks shipped in PR1 are critical + offline (no audit / network
// dependency), so they live in a single registry. Future PRs introduce
// the static-vs-audit split.
export const ALL_CHECKS: Check[] = [
  packagemanagerPinned,
  npmrcCorrect,
  pnpmWorkspaceCorrect,
  yarnrcCorrect,
];
