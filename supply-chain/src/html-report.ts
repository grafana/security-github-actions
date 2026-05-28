// HTML rendering of a ReportInput. Self-contained: single `.html` file with
// inlined CSS, no external assets, no JavaScript. Designed for a dense,
// browser-window-sized layout — findings render as a responsive 2-column
// grid with compact cards so most reports fit without scrolling.
//
// Same `ReportInput` in, presentation-specific format out. The three
// renderers (text, markdown, html) are deliberately independent — see
// ADR-0010.

import type { Finding, CheckId } from './types.ts';
import type { ReportInput } from './report.ts';

export function renderHtml(input: ReportInput): string {
  const blocking = input.findings.filter((f) => f.severity === 'blocking');
  const advisory = input.findings.filter((f) => f.severity === 'advisory');
  const passingIds = new Set<CheckId>(input.ran);
  for (const f of input.findings) passingIds.delete(f.check_id);
  for (const f of input.suppressed) passingIds.delete(f.check_id);

  const overallOk = blocking.length === 0;
  const title = overallOk
    ? `Supply-chain checks passed (${advisory.length} advisory)`
    : `${blocking.length} blocking, ${advisory.length} advisory`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Supply-chain report — ${esc(title)}</title>
  <style>${CSS}</style>
</head>
<body>
  <header class="page-header ${overallOk ? 'ok' : 'fail'}">
    <h1>${overallOk ? '✓' : '✗'} ${esc(title)}</h1>
    <nav class="counts">
      ${badge('blocking', blocking.length)}
      ${badge('advisory', advisory.length)}
      ${badge('suppressed', input.suppressed.length)}
      ${badge('passing', passingIds.size)}
    </nav>
  </header>

  <main>
    ${section('blocking', 'Blocking violations', blocking, true)}
    ${section('advisory', 'Advisory findings', advisory, true)}
    ${section('suppressed', 'Suppressed', input.suppressed, false)}
    ${passingSection(input.ran, passingIds)}
  </main>

  ${input.runUrl ? `<footer class="run-link"><a href="${esc(input.runUrl)}">View workflow run →</a></footer>` : ''}
</body>
</html>
`;
}

function badge(kind: 'blocking' | 'advisory' | 'suppressed' | 'passing', n: number): string {
  if (n === 0) return '';
  const label = kind[0]!.toUpperCase() + kind.slice(1);
  return `<a href="#${kind}" class="badge badge-${kind}">${n} ${esc(label)}</a>`;
}

function section(
  id: string,
  title: string,
  findings: Finding[],
  open: boolean,
): string {
  if (findings.length === 0) return '';
  const byRoot = groupBy(findings, (f) => f.root);
  const groups: string[] = [];
  let n = 0;
  for (const [root, group] of byRoot) {
    const items = group
      .map((f) => {
        n += 1;
        return renderFinding(f, n);
      })
      .join('\n');
    groups.push(`
      <div class="root-group">
        <h3 class="root-name">${esc(root === '.' ? '(repo root)' : root)}</h3>
        <div class="finding-grid">${items}</div>
      </div>`);
  }
  return `
    <section id="${id}" class="findings findings-${id}">
      <details ${open ? 'open' : ''}>
        <summary><h2>${esc(title)} <span class="count">(${findings.length})</span></h2></summary>
        ${groups.join('\n')}
      </details>
    </section>`;
}

function renderFinding(f: Finding, n: number): string {
  return `
    <article class="finding finding-${esc(f.severity)}" id="finding-${n}">
      <div class="finding-id">${esc(f.check_id)}</div>
      <h4 class="finding-title">${esc(f.title)}</h4>
      <p class="finding-detail">${esc(f.detail)}</p>
      <p class="finding-fix"><span class="fix-arrow">→</span> ${esc(f.fix)}</p>
      <a class="finding-docs" href="${esc(f.doc_link)}" target="_blank" rel="noopener noreferrer">Docs ↗</a>
    </article>`;
}

function passingSection(ran: CheckId[], passingIds: Set<CheckId>): string {
  if (passingIds.size === 0) return '';
  const ordered = ran.filter((id) => passingIds.has(id));
  const items = ordered.map((id) => `<li><code>${esc(id)}</code></li>`).join('');
  return `
    <section id="passing" class="passing">
      <details>
        <summary><h2>Passing checks <span class="count">(${ordered.length})</span></h2></summary>
        <ul class="passing-list">${items}</ul>
      </details>
    </section>`;
}

function groupBy<T, K>(items: T[], keyFn: (item: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const item of items) {
    const k = keyFn(item);
    const existing = out.get(k);
    if (existing) existing.push(item);
    else out.set(k, [item]);
  }
  return out;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Single inline CSS string. Density goals:
// - findings render as a 2-column grid on screens ≥ 720px, 1 column below
// - per-finding card is 5 lines tall: id chip, title, detail, fix, docs
// - sections collapse with native <details>; counts are visible in the
//   summary so collapsed sections still tell the user what's inside
// - generous use of color so severity is scannable at a glance
const CSS = `
  :root {
    color-scheme: light dark;
    --bg: #ffffff;
    --bg-elev: #f6f8fa;
    --fg: #1f2328;
    --fg-muted: #59636e;
    --border: #d0d7de;
    --code-bg: #eff1f3;
    --link: #0969da;
    --blocking: #cf222e;
    --blocking-bg: #ffebe9;
    --advisory: #9a6700;
    --advisory-bg: #fff8c5;
    --suppressed: #59636e;
    --suppressed-bg: #f6f8fa;
    --passing: #1a7f37;
    --passing-bg: #dafbe1;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0d1117;
      --bg-elev: #161b22;
      --fg: #e6edf3;
      --fg-muted: #8d96a0;
      --border: #30363d;
      --code-bg: #1f242c;
      --link: #4493f8;
      --blocking: #f85149;
      --blocking-bg: rgba(248,81,73,0.12);
      --advisory: #d29922;
      --advisory-bg: rgba(210,153,34,0.12);
      --suppressed: #8d96a0;
      --suppressed-bg: rgba(141,150,160,0.08);
      --passing: #3fb950;
      --passing-bg: rgba(63,185,80,0.12);
    }
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif;
    background: var(--bg);
    color: var(--fg);
    line-height: 1.45;
    max-width: 1400px;
    margin: 0 auto;
    padding: 16px 20px 32px;
    font-size: 14px;
  }
  code, .check-id, .finding-id { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 0.88em; }
  code { background: var(--code-bg); padding: 0.05em 0.3em; border-radius: 3px; }
  a { color: var(--link); text-decoration: none; }
  a:hover { text-decoration: underline; }

  .page-header { display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap; border-bottom: 1px solid var(--border); padding-bottom: 12px; margin-bottom: 16px; }
  .page-header h1 { margin: 0; font-size: 1.35em; font-weight: 600; }
  .page-header.ok h1 { color: var(--passing); }
  .page-header.fail h1 { color: var(--blocking); }

  .counts { display: flex; flex-wrap: wrap; gap: 6px; }
  .badge {
    display: inline-block;
    padding: 1px 9px;
    border-radius: 9999px;
    font-size: 0.82em;
    font-weight: 500;
    border: 1px solid transparent;
  }
  .badge-blocking  { background: var(--blocking-bg);  color: var(--blocking);  border-color: var(--blocking); }
  .badge-advisory  { background: var(--advisory-bg);  color: var(--advisory);  border-color: var(--advisory); }
  .badge-suppressed{ background: var(--suppressed-bg);color: var(--suppressed);border-color: var(--suppressed); }
  .badge-passing   { background: var(--passing-bg);   color: var(--passing);   border-color: var(--passing); }

  section.findings, section.passing { margin: 16px 0; }
  details > summary { cursor: pointer; list-style: none; user-select: none; }
  details > summary::-webkit-details-marker { display: none; }
  details > summary h2 {
    display: inline-block;
    margin: 0;
    font-size: 1.05em;
    font-weight: 600;
    border-bottom: 2px solid var(--border);
    padding-bottom: 3px;
  }
  details[open] > summary h2 { border-bottom-color: var(--fg); }
  details > summary h2::before { content: "▸ "; color: var(--fg-muted); }
  details[open] > summary h2::before { content: "▾ "; }
  .count { color: var(--fg-muted); font-weight: 400; }

  .root-group { margin: 10px 0 16px 0; }
  .root-name {
    font-size: 0.85em;
    color: var(--fg-muted);
    margin: 12px 0 6px 0;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  /* Finding cards in a responsive grid: 2 columns wide, 1 column narrow. */
  .finding-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 6px;
  }
  @media (min-width: 720px) {
    .finding-grid { grid-template-columns: 1fr 1fr; }
  }
  @media (min-width: 1200px) {
    .finding-grid { grid-template-columns: 1fr 1fr 1fr; }
  }

  .finding {
    position: relative;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-left-width: 3px;
    border-radius: 5px;
    padding: 8px 12px 8px 14px;
    display: grid;
    grid-template-columns: 1fr auto;
    grid-template-areas:
      "id    docs"
      "title title"
      "detail detail"
      "fix   fix";
    column-gap: 8px;
    row-gap: 2px;
  }
  .finding-blocking  { border-left-color: var(--blocking); }
  .finding-advisory  { border-left-color: var(--advisory); }
  .finding-suppressed{ border-left-color: var(--suppressed); opacity: 0.8; }

  .finding-id    { grid-area: id; color: var(--fg-muted); font-size: 0.8em; }
  .finding-docs  { grid-area: docs; font-size: 0.8em; align-self: start; }
  .finding-title { grid-area: title; margin: 0; font-size: 0.95em; font-weight: 600; line-height: 1.35; }
  .finding-detail{ grid-area: detail; margin: 0; color: var(--fg-muted); font-size: 0.88em; }
  .finding-fix   { grid-area: fix; margin: 2px 0 0 0; font-size: 0.88em; }
  .fix-arrow     { color: var(--passing); font-weight: 600; margin-right: 2px; }

  .passing-list {
    list-style: none;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 2px 12px;
    margin: 10px 0;
    font-size: 0.9em;
  }
  .passing-list li { padding: 1px 0; }
  .passing-list li::before { content: "✓ "; color: var(--passing); font-weight: 600; }

  .run-link {
    margin-top: 24px;
    padding-top: 12px;
    border-top: 1px solid var(--border);
    text-align: center;
    color: var(--fg-muted);
    font-size: 0.85em;
  }
`;
