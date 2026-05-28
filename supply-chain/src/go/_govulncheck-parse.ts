// Parser for `govulncheck -json` output. Govulncheck emits a sequence of
// JSON objects (NDJSON), each wrapping one "message" of a few kinds:
//
//   { "config": { ... } }
//   { "progress": { ... } }
//   { "osv": { "id": "GO-...", "summary": "...", "details": "...",
//             "affected": [...], "database_specific": { "url": "..." } } }
//   { "finding": { "osv": "GO-...", "fixed_version": "v1.2.3",
//                  "trace": [ { "module": "...", "package": "...",
//                               "function": "...", "version": "..." }, ... ] } }
//
// govulncheck distinguishes "the dependency contains a vulnerable function"
// from "your code actually reaches that function." Only the latter produces
// `finding` messages with a non-empty `trace[0].function` — that's the
// signal we surface.
//
// As with the audit parser, we never throw: bad input returns an empty
// array. The check is advisory; a parser failure should not take the audit
// job down.

export type GovulnSeverity = 'high'; // govulncheck doesn't gradate; presence = high

export type GovulnAdvisory = {
  osv: string; // e.g. "GO-2025-1234"
  summary: string; // short title from the OSV record
  url?: string; // landing page in the Go vuln DB
  module: string; // the offending module (your dep)
  pkg?: string; // package within that module
  symbol?: string; // function/method the trace ends at — proof of reachability
  vulnerableVersion?: string; // version present in your tree
  fixedVersion?: string; // first patched version
};

type OsvRecord = {
  id?: string;
  summary?: string;
  database_specific?: { url?: string };
};

type FindingTraceFrame = {
  module?: string;
  package?: string;
  function?: string;
  version?: string;
};

type FindingRecord = {
  osv?: string;
  fixed_version?: string;
  trace?: FindingTraceFrame[];
};

export function parseGovulncheckOutput(text: string): GovulnAdvisory[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];

  const osvIndex = new Map<string, OsvRecord>();
  const findings: FindingRecord[] = [];

  for (const rawLine of trimmed.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (!obj || typeof obj !== 'object') continue;
    const o = obj as { osv?: unknown; finding?: unknown };
    if (o.osv && typeof o.osv === 'object') {
      const r = o.osv as OsvRecord;
      if (typeof r.id === 'string') osvIndex.set(r.id, r);
    } else if (o.finding && typeof o.finding === 'object') {
      findings.push(o.finding as FindingRecord);
    }
  }

  const out: GovulnAdvisory[] = [];
  for (const f of findings) {
    if (typeof f.osv !== 'string') continue;
    const trace = Array.isArray(f.trace) ? f.trace : [];
    // Reachability: govulncheck emits "finding" messages with an empty trace
    // for vulnerabilities present in the module graph but not reached by
    // user code. We only surface call-reachable ones, where the top frame
    // names a function.
    const top = trace[0];
    if (!top || typeof top.function !== 'string' || top.function.length === 0) continue;

    const osv = osvIndex.get(f.osv);
    out.push({
      osv: f.osv,
      summary: osv?.summary ?? f.osv,
      url: osv?.database_specific?.url ?? `https://pkg.go.dev/vuln/${f.osv}`,
      module: typeof top.module === 'string' ? top.module : '(unknown module)',
      pkg: typeof top.package === 'string' ? top.package : undefined,
      symbol: top.function,
      vulnerableVersion: typeof top.version === 'string' ? top.version : undefined,
      fixedVersion: typeof f.fixed_version === 'string' ? f.fixed_version : undefined,
    });
  }
  return out;
}
