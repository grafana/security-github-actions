// Stable, append-only identifier for a check. Suppressions and metrics key on it;
// never rename a check_id after it has shipped. To retire one, mark it deprecated
// in code and stop emitting it, but never reuse the string.
export type CheckId = string;

export type Severity = 'critical' | 'advisory';

// The shape is a union so a future ecosystem (Go, etc.) can slot in without
// reshaping every consumer. PR1 only ships the `js` variant; `Root = NodeRoot`
// in this PR. A follow-up PR will add `GoRoot` and make `Root` a real union.
export type Ecosystem = 'js';

export type PackageManager = 'npm' | 'pnpm' | 'yarn';

// A `package.json` discovered by the walker that is not a workspace member of
// any ancestor manifest. Node.js side of the ecosystem.
export type NodeRoot = {
  ecosystem: 'js';
  // Path relative to the repository root.
  path: string;
  // Resolved from `packageManager:` in package.json. `null` when the field is
  // missing — that is itself a critical finding.
  packageManager: PackageManager | null;
  // Repo-relative paths of lockfiles discovered at this root.
  lockfiles: string[];
  // Workspace member paths (directory paths relative to repo root). Empty
  // when this root declares no workspaces.
  workspaceMembers: string[];
};

// Anything the walker may produce. Single-variant in PR1; future PRs will
// extend it (e.g. `Root = NodeRoot | GoRoot`).
export type Root = NodeRoot;

export type Finding = {
  check_id: CheckId;
  severity: Severity;
  // Which root the finding applies to. "." for single-package/single-module repos.
  root: string;
  title: string;
  detail: string;
  // Concrete remediation, ideally a snippet the developer can paste.
  fix: string;
  // Deep link into supply-chain/docs/checks/<check_id>.md.
  doc_link: string;
};

// Cross-cutting state shared between checks for one workflow run. Built once
// by the CLI before any check runs. Tests construct it directly.
export type RepoContext = {
  // Absolute path to the repository being inspected.
  repoRoot: string;
  // Repo-relative paths of files tracked by git. Used by checks that need to
  // distinguish "on disk" from "actually committed". In non-git contexts
  // (fixture tests), pass `null` to opt out of tracked-ness verification and
  // fall back to on-disk presence.
  trackedFiles: Set<string> | null;
};

// A Check reads the repo state at a specific root and produces zero-or-more
// findings. Each check declares which ecosystem it applies to; the engine
// pairs `check.ecosystem` with `root.ecosystem`. PR1 only ships the `js`
// variant — the same shape supports later ecosystems via union extension.
export type NodeCheck = {
  id: CheckId;
  severity: Severity;
  ecosystem: 'js';
  run: (root: NodeRoot, ctx: RepoContext) => Promise<Finding[]>;
};

export type Check = NodeCheck;
