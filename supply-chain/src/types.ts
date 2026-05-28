// Stable, append-only identifier for a check. Suppressions and metrics key on it;
// never rename a check_id after it has shipped. To retire one, mark it deprecated
// in code and stop emitting it, but never reuse the string.
export type CheckId = string;

export type Severity = 'critical' | 'advisory';

export type Ecosystem = 'js' | 'go';

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
  // Repo-relative paths of lockfiles discovered at this root. More than one
  // => lockfile conflict (hard fail).
  lockfiles: string[];
  // Workspace member paths (directory paths relative to repo root). Empty
  // when this root declares no workspaces.
  workspaceMembers: string[];
};

// A Go module — `go.mod` not nested under a workspace `use` directive.
export type GoRoot = {
  ecosystem: 'go';
  // Path relative to the repository root.
  path: string;
  // `go 1.X.Y` directive in go.mod. The module's minimum Go version.
  goVersion: string | null;
  // `toolchain go1.X.Y` directive in go.mod (since Go 1.21).
  goToolchain: string | null;
  // Whether `go.sum` is present next to `go.mod`. A module with no external
  // dependencies legitimately has no go.sum, so checks that depend on this
  // must also consider `hasRequires`.
  gosumPresent: boolean;
  // Whether `go.mod` declares any external `require` entries. Modules with
  // no requires don't need a go.sum.
  hasRequires: boolean;
  // Workspace member directories from `go.work`. Empty when this module is
  // standalone or this root is itself a workspace member.
  workspaceMembers: string[];
};

// Anything the walker may produce. Each check is parametric over one of these
// variants — see Check below.
export type Root = NodeRoot | GoRoot;

export type Finding = {
  check_id: CheckId;
  severity: Severity;
  // Which root the finding applies to. "." for single-package/single-module repos.
  root: string;
  title: string;
  detail: string;
  // Concrete remediation, ideally a snippet the developer can paste.
  fix: string;
  // Deep link into supply-chain/docs/checks/<check_id>.md (or directly to a
  // GHSA / OSV page for audit findings).
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
// pairs `check.ecosystem` with `root.ecosystem` so a JS check is never
// invoked against a Go root and vice-versa. This keeps the check
// implementations free of "is this my ecosystem?" boilerplate.
export type NodeCheck = {
  id: CheckId;
  severity: Severity;
  ecosystem: 'js';
  run: (root: NodeRoot, ctx: RepoContext) => Promise<Finding[]>;
};

export type GoCheck = {
  id: CheckId;
  severity: Severity;
  ecosystem: 'go';
  run: (root: GoRoot, ctx: RepoContext) => Promise<Finding[]>;
};

export type Check = NodeCheck | GoCheck;
