// The single source of truth for which checks exist and how they're grouped.
// Every CLI (cli.ts, audit-cli.ts, check.ts) imports from here so adding a
// new check requires only one edit.
//
// The order of each array is the order checks appear in the "Passing checks"
// section of the rendered report.

import type { Check } from './types.ts';

import { check as lockfileCommitted } from './checks/lockfile-committed.ts';
import { check as lockfileConflict } from './checks/lockfile-conflict.ts';
import { check as packagemanagerPinned } from './checks/packagemanager-pinned.ts';
import { check as npmrcCorrect } from './checks/npmrc-correct.ts';
import { check as pnpmWorkspaceCorrect } from './checks/pnpm-workspace-correct.ts';
import { check as yarnrcCorrect } from './checks/yarnrc-correct.ts';
import { check as installNotCi } from './checks/install-not-ci.ts';
import { check as npxConfusion } from './checks/npx-confusion.ts';
import { check as oidcPublishing } from './checks/oidc-publishing.ts';
import { check as cachePoisoningPublish } from './checks/cache-poisoning-publish.ts';
import { check as registryAudit } from './checks/registry-audit.ts';

// Static checks: run in the `static` job at CI time (and locally by default).
// Everything that doesn't need the network goes here — both blocking and
// non-network advisory.
export const STATIC_CHECKS: Check[] = [
  // Blocking — see ADR-0003 for severity rationale.
  packagemanagerPinned,
  lockfileCommitted,
  lockfileConflict,
  npmrcCorrect,
  pnpmWorkspaceCorrect,
  yarnrcCorrect,

  // Advisory (non-network).
  installNotCi,
  npxConfusion,
  oidcPublishing,
  cachePoisoningPublish,
];

// Audit checks: run in the separate `audit` CI job (different network needs,
// different failure semantics). Kept out of STATIC_CHECKS so the static job
// stays offline-clean.
export const AUDIT_CHECKS: Check[] = [registryAudit];

// Convenience for the local entry point and one-shot survey use cases.
export const ALL_CHECKS: Check[] = [...STATIC_CHECKS, ...AUDIT_CHECKS];
