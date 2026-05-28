// Parser for `npm/pnpm/yarn audit --json` output. Normalises the three
// historical JSON shapes into a single `Advisory[]`:
//   1. npm v2 (recent npm + pnpm v9+): `{ vulnerabilities: { <pkg>: { ..., via: [...] } } }`
//   2. npm v1 (older pnpm versions):   `{ advisories: { <id>: { module_name, severity, ... } } }`
//   3. yarn 4 NDJSON:                  one `{ value: "<pkg>", children: { ... } }` object per line
//
// We never throw — malformed input returns an empty array, and the caller
// then reports zero advisories. Throwing would mean a transient registry hiccup
// (which is what produces malformed output) takes the whole audit job down.

export type AuditSeverity = 'critical' | 'high' | 'moderate' | 'low' | 'info';

export type Advisory = {
  package: string;
  severity: AuditSeverity;
  title: string;
  url?: string;
  vulnerableRange?: string;
  patchedRange?: string;
  // Whether the audit command thinks a non-interactive fix is available.
  // npm v2 carries an object with the target name+version; v1 doesn't carry
  // a fix flag (presence of `patched_versions` is the signal); NDJSON likewise.
  fixAvailable?: { name: string; version: string; isSemVerMajor?: boolean } | boolean;
};

export function parseAuditOutput(text: string): Advisory[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];

  // Try whole-document JSON first (npm/pnpm).
  let obj: unknown = null;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    // fall through to NDJSON
  }

  if (obj !== null && typeof obj === 'object') {
    const v2 = parseV2(obj);
    if (v2 !== null) return v2;
    const v1 = parseV1(obj);
    if (v1 !== null) return v1;
  }

  return parseNdjson(trimmed);
}

// npm audit-report v2 / pnpm v9+: vulnerabilities keyed by package name.
function parseV2(obj: unknown): Advisory[] | null {
  const root = obj as { vulnerabilities?: unknown };
  const vulns = root.vulnerabilities;
  if (!vulns || typeof vulns !== 'object') return null;

  const out: Advisory[] = [];
  for (const [name, raw] of Object.entries(vulns as Record<string, unknown>)) {
    const entry = raw as {
      severity?: string;
      range?: string;
      via?: unknown;
      fixAvailable?: unknown;
    };
    const viaList = Array.isArray(entry.via) ? entry.via : [];
    let emittedFromVia = 0;
    for (const v of viaList) {
      // Strings in `via` point at another package's entry — we'll emit
      // that advisory when we process that package's vulnerabilities row.
      if (typeof v === 'string') continue;
      if (v === null || typeof v !== 'object') continue;
      const adv = v as {
        title?: string;
        url?: string;
        severity?: string;
        range?: string;
      };
      out.push({
        package: name,
        severity: normaliseSeverity(adv.severity ?? entry.severity),
        title: typeof adv.title === 'string' && adv.title.length > 0 ? adv.title : `${name} vulnerability`,
        url: typeof adv.url === 'string' ? adv.url : undefined,
        vulnerableRange: typeof adv.range === 'string' ? adv.range : entry.range,
        fixAvailable: normaliseFixAvailable(entry.fixAvailable),
      });
      emittedFromVia += 1;
    }
    // Packages whose `via` is purely string-refs (purely transitive carriers)
    // produce no advisories of their own — the leaf packages produce them.
    if (emittedFromVia === 0 && entry.severity && viaList.length === 0) {
      out.push({
        package: name,
        severity: normaliseSeverity(entry.severity),
        title: `${name} vulnerability`,
        vulnerableRange: entry.range,
        fixAvailable: normaliseFixAvailable(entry.fixAvailable),
      });
    }
  }
  return out;
}

// npm audit v1 / older pnpm: advisories keyed by numeric id.
function parseV1(obj: unknown): Advisory[] | null {
  const root = obj as { advisories?: unknown };
  const advs = root.advisories;
  if (!advs || typeof advs !== 'object') return null;
  const out: Advisory[] = [];
  for (const raw of Object.values(advs as Record<string, unknown>)) {
    if (raw === null || typeof raw !== 'object') continue;
    const a = raw as {
      module_name?: string;
      severity?: string;
      title?: string;
      url?: string;
      vulnerable_versions?: string;
      patched_versions?: string;
    };
    if (!a.module_name) continue;
    out.push({
      package: a.module_name,
      severity: normaliseSeverity(a.severity),
      title: a.title ?? `${a.module_name} vulnerability`,
      url: a.url,
      vulnerableRange: a.vulnerable_versions,
      patchedRange: a.patched_versions,
    });
  }
  return out;
}

// Yarn 4 NDJSON: one object per line, shape:
//   { "value": "<pkg>", "children": { "ID": "...", "Issue": "...",
//     "URL": "...", "Severity": "high", "Vulnerable Versions": "<5.0", ... } }
function parseNdjson(text: string): Advisory[] {
  const out: Advisory[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (!obj || typeof obj !== 'object') continue;
    const o = obj as { value?: unknown; children?: unknown };
    if (typeof o.value !== 'string' || !o.children || typeof o.children !== 'object') continue;
    const c = o.children as Record<string, unknown>;
    const severity = typeof c.Severity === 'string' ? c.Severity : c.severity;
    const title = typeof c.Issue === 'string' ? c.Issue : (c.issue as string | undefined);
    const url = typeof c.URL === 'string' ? c.URL : (c.url as string | undefined);
    const range =
      typeof c['Vulnerable Versions'] === 'string'
        ? (c['Vulnerable Versions'] as string)
        : (c.vulnerable_versions as string | undefined);
    out.push({
      package: o.value,
      severity: normaliseSeverity(severity),
      title: title ?? `${o.value} vulnerability`,
      url,
      vulnerableRange: range,
    });
  }
  return out;
}

function normaliseSeverity(s: unknown): AuditSeverity {
  if (typeof s !== 'string') return 'info';
  const lower = s.toLowerCase();
  if (lower === 'critical' || lower === 'high' || lower === 'moderate' || lower === 'low' || lower === 'info') {
    return lower;
  }
  return 'info';
}

function normaliseFixAvailable(value: unknown): Advisory['fixAvailable'] {
  if (typeof value === 'boolean') return value;
  if (value && typeof value === 'object') {
    const obj = value as { name?: unknown; version?: unknown; isSemVerMajor?: unknown };
    if (typeof obj.name === 'string' && typeof obj.version === 'string') {
      return {
        name: obj.name,
        version: obj.version,
        isSemVerMajor: typeof obj.isSemVerMajor === 'boolean' ? obj.isSemVerMajor : undefined,
      };
    }
  }
  return undefined;
}
