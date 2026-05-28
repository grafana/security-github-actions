# HTML report is a third renderer, not a markdown-to-HTML conversion

The CLI now supports three output formats: terminal text, GitHub-flavored markdown, and self-contained HTML. Each is implemented as an independent renderer (`renderText`, `renderMarkdown`, `renderHtml`) that consumes the same `ReportInput` directly. We deliberately did **not** add an intermediate "markdown → HTML" pass that would have reused the existing markdown emitter.

## Considered

- **Convert markdown to HTML (one source of truth).** Rejected. The converter would need a small state machine to handle `<details>` nesting, group consecutive `- ` lines into `<ul>`, strip HTML comments, and pass through inline HTML — likely more code than a direct renderer, and parsing-heavy code that's harder to test. More importantly, it would force markdown to act as an intermediate representation for HTML, when in fact `ReportInput` is the actual source of truth that all three renderers consume.
- **Inline `marked.js` or a similar markdown library.** Rejected. Pulls in a runtime dependency (against the zero-runtime-dep posture from [ADR-0007](./0007-node-native-typescript.md)). The `marked` library is ~30KB minified — small but non-trivial — and the surface area we'd actually exercise is a small fraction of CommonMark.
- **Load a markdown library from a CDN at view time.** Rejected. A supply-chain workflow that downloads JavaScript from a CDN to render its own report has bad optics regardless of SRI hashes. Also offline-hostile.

## Consequences

- **Three places to keep in sync as `ReportInput` evolves.** Bounded cost — TypeScript's exhaustiveness checks flag any new mandatory field across all consumers, and each renderer is ~80 lines of straight-line code that mostly just templates structured data.
- **HTML can express things markdown can't, cleanly.** Anchor IDs per finding (`#finding-7`), nav badges that jump to sections, `prefers-color-scheme` light/dark theming, `<article>` semantics. These would be awkward to express through a markdown intermediary.
- **Markdown and HTML can diverge in presentation without contortions.** The markdown is optimised for GitHub's PR comment renderer (uses `<details>` natively, no fancy CSS). The HTML is optimised for a standalone browser view (rich styling, navigation badges, responsive layout). Forcing both through one emitter would either dumb down the HTML or pollute the markdown with HTML-only tags.
- **No new runtime dependency.** The HTML renderer is pure string templating + an inlined CSS constant. No build step, no bundling, no `node_modules` impact at runtime.
