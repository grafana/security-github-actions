// The single source of truth for which checks exist and how they're grouped.
// Every CLI invocation imports from here so adding a new check requires only
// one edit.
//
// The order of each array is the order checks appear in the "Passing checks"
// section of the rendered report.

import type { Check } from './types.ts';

// JS / Node.js ecosystem
import { check as lockfileCommitted } from './js/lockfile-committed.ts';
import { check as lockfileConflict } from './js/lockfile-conflict.ts';
import { check as packagemanagerPinned } from './js/packagemanager-pinned.ts';
import { check as npmrcCorrect } from './js/npmrc-correct.ts';
import { check as pnpmWorkspaceCorrect } from './js/pnpm-workspace-correct.ts';
import { check as yarnrcCorrect } from './js/yarnrc-correct.ts';
import { check as installNotCi } from './js/install-not-ci.ts';
import { check as npxConfusion } from './js/npx-confusion.ts';
import { check as oidcPublishing } from './js/oidc-publishing.ts';
import { check as cachePoisoningPublish } from './js/cache-poisoning-publish.ts';
import { check as registryAudit } from './js/registry-audit.ts';

// Go ecosystem
import { check as gosumCommitted } from './go/gosum-committed.ts';
import { check as goToolchainPinned } from './go/toolchain-pinned.ts';
import { check as govulncheckClean } from './go/govulncheck-clean.ts';

// Static checks: run in the `static` job at CI time (and locally by default).
// Everything that doesn't need the network goes here — both blocking and
// non-network advisory, both ecosystems.
export const STATIC_CHECKS: Check[] = [
  // JS blocking
  packagemanagerPinned,
  lockfileCommitted,
  lockfileConflict,
  npmrcCorrect,
  pnpmWorkspaceCorrect,
  yarnrcCorrect,

  // Go blocking
  gosumCommitted,
  goToolchainPinned,

  // JS advisory (non-network)
  installNotCi,
  npxConfusion,
  oidcPublishing,
  cachePoisoningPublish,
];

// Audit checks: run in the separate `audit` CI job (different network needs,
// different failure semantics). Kept out of STATIC_CHECKS so the static job
// stays offline-clean. Includes both ecosystems' vulnerability scanners.
export const AUDIT_CHECKS: Check[] = [registryAudit, govulncheckClean];

// Convenience for the local entry point and one-shot survey use cases.
export const ALL_CHECKS: Check[] = [...STATIC_CHECKS, ...AUDIT_CHECKS];
