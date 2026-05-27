// Stable, append-only identifier for a check. Suppressions and metrics key on it;
// never rename a check_id after it has shipped. To retire one, mark it deprecated
// in code and stop emitting it, but never reuse the string.
export type CheckId = string;

export type Severity = 'blocking' | 'advisory';

export type PackageManager = 'npm' | 'pnpm' | 'yarn';

// A `package.json` discovered by the walker that is not a workspace member of
// any ancestor manifest. Checks operate at root granularity (see ADR-0002).
export type Root = {
  // Path relative to the repository root. The repo's own root manifest is "." here.
  path: string;
  // Resolved from `packageManager:` in package.json. `null` when the field is
  // missing — that is itself a blocking finding (see ADR-0002).
  packageManager: PackageManager | null;
  // Absolute paths (still relative to repo root in string form) of lockfiles
  // discovered at this root. More than one => lockfile conflict (hard fail).
  lockfiles: string[];
  // Workspace member paths (relative to repo root). Empty when this root has
  // no workspaces declared.
  workspaceMembers: string[];
};

export type Finding = {
  check_id: CheckId;
  severity: Severity;
  // Which root the finding applies to. "." for single-package repos.
  root: string;
  title: string;
  detail: string;
  // Concrete remediation, ideally a snippet the developer can paste.
  fix: string;
  // Deep link into supply-chain/docs/checks/<check_id>.md
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
// findings. Checks are pure: same input => same output. No network, no
// time-dependent behaviour. Advisory checks (audit, etc.) are *not* Checks
// in this sense — they live elsewhere in the pipeline.
export type Check = {
  id: CheckId;
  severity: Severity;
  // Returns the findings for this root. Empty array means "passed".
  run: (root: Root, ctx: RepoContext) => Promise<Finding[]>;
};
