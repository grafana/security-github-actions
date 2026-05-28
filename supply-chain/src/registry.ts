// The single source of truth for which checks exist and how they're grouped.
// Every CLI invocation imports from here so adding a new check requires only
// one edit.
//
// The order of each array is the order checks appear in the "Passing checks"
// section of the rendered report.

import type { Check } from './types.ts';

// JS / Node.js ecosystem
import { check as lockfileCommitted } from './checks/js/lockfile-committed.ts';
import { check as lockfileConflict } from './checks/js/lockfile-conflict.ts';
import { check as packagemanagerPinned } from './checks/js/packagemanager-pinned.ts';
import { check as npmrcCorrect } from './checks/js/npmrc-correct.ts';
import { check as pnpmWorkspaceCorrect } from './checks/js/pnpm-workspace-correct.ts';
import { check as yarnrcCorrect } from './checks/js/yarnrc-correct.ts';
import { check as installNotCi } from './checks/js/install-not-ci.ts';
import { check as npxConfusion } from './checks/js/npx-confusion.ts';
import { check as oidcPublishing } from './checks/js/oidc-publishing.ts';
import { check as cachePoisoningPublish } from './checks/js/cache-poisoning-publish.ts';
import { check as registryAudit } from './checks/js/registry-audit.ts';

// Go ecosystem
import { check as gosumCommitted } from './checks/go/gosum-committed.ts';
import { check as goToolchainPinned } from './checks/go/toolchain-pinned.ts';
import { check as govulncheckClean } from './checks/go/govulncheck-clean.ts';

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
