import type { GoCheck, Finding, GoRoot } from '../types.ts';

export const CHECK_ID = 'go-toolchain-pinned';

const DOC_LINK = 'https://github.com/grafana/security-github-actions/blob/main/supply-chain/docs/checks/go/go-toolchain-pinned.md';

// Minimum Go version required. Bumped deliberately; this value is the floor
// for which we'll accept either the `go` or `toolchain` directive in go.mod.
const MIN = { major: 1, minor: 22, patch: 0 };

// The `toolchain` directive (since Go 1.21) pins exactly which toolchain
// the module is built with. We strongly prefer its presence — without it,
// the build uses whatever Go is on the runner, which makes the
// supply-chain story dependent on CI image management.
export const check: GoCheck = {
  ecosystem: 'go',
  id: CHECK_ID,
  severity: 'blocking',
  async run(root: GoRoot): Promise<Finding[]> {
    const findings: Finding[] = [];

    if (root.goToolchain === null) {
      findings.push({
        check_id: CHECK_ID,
        severity: 'blocking',
        root: root.path,
        title: 'Missing `toolchain` directive in go.mod',
        detail: `go.mod ${describePath(root)} does not pin a toolchain. Without it, the build uses whatever Go is on the runner.`,
        fix: `Add \`toolchain go${formatV(MIN)}\` (or newer) to go.mod.`,
        doc_link: DOC_LINK,
      });
    } else {
      const parsed = parseVersion(root.goToolchain);
      if (parsed === null) {
        findings.push({
          check_id: CHECK_ID,
          severity: 'blocking',
          root: root.path,
          title: `Could not parse \`toolchain\` value in go.mod`,
          detail: `Found \`toolchain go${root.goToolchain}\` ${describePath(root)}, which we cannot interpret.`,
          fix: `Use a concrete version, e.g. \`toolchain go${formatV(MIN)}\`.`,
          doc_link: DOC_LINK,
        });
      } else if (compareV(parsed, MIN) < 0) {
        findings.push({
          check_id: CHECK_ID,
          severity: 'blocking',
          root: root.path,
          title: `Go toolchain pinned below minimum (${root.goToolchain} < ${formatV(MIN)})`,
          detail: `go.mod ${describePath(root)} pins \`toolchain go${root.goToolchain}\`; minimum supported is ${formatV(MIN)}.`,
          fix: `Update to \`toolchain go${formatV(MIN)}\` (or newer).`,
          doc_link: DOC_LINK,
        });
      }
    }

    // Also flag if `go` directive itself is below minimum (matters even when
    // toolchain is present — the `go` directive is the minimum Go version the
    // module *needs*, and pinning that to something old can pull in API
    // surfaces with known issues).
    if (root.goVersion !== null) {
      const parsed = parseVersion(root.goVersion);
      if (parsed !== null && compareV(parsed, MIN) < 0) {
        findings.push({
          check_id: CHECK_ID,
          severity: 'blocking',
          root: root.path,
          title: `\`go\` directive below minimum (${root.goVersion} < ${formatV(MIN)})`,
          detail: `go.mod ${describePath(root)} declares \`go ${root.goVersion}\`; minimum supported is ${formatV(MIN)}.`,
          fix: `Update the \`go\` directive to at least \`go ${formatV(MIN)}\`.`,
          doc_link: DOC_LINK,
        });
      }
    }

    return findings;
  },
};

type V = { major: number; minor: number; patch: number };

function parseVersion(value: string): V | null {
  const m = /^(\d+)\.(\d+)(?:\.(\d+))?$/.exec(value);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3] ?? '0') };
}

function compareV(a: V, b: V): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

function formatV(v: V): string {
  return `${v.major}.${v.minor}.${v.patch}`;
}

function describePath(root: GoRoot): string {
  return root.path === '.' ? 'at the repository root' : `at ${root.path}`;
}

export const __test = { parseVersion, compareV };
