# Evidence workspace preview

Run `npx vite --host 127.0.0.1 --port 5184 --strictPort`, then open
`http://127.0.0.1:5184/tools/evidence-preview/index.html`.

Uses the production AppViews, tabs, inspector, settings and CSS with explicitly labelled
illustrative fixtures. No credentials are needed. `/api/` calls are blocked; existing
background workspaces may log blocked requests. Never use these values as scientific evidence.

Cases: Mixed (all contributions), Partial (three contributions), Missing (provider fault),
Zero (measured zero, distinct from missing) and New variant (selection/view reset).
Check all three tabs, source-record and chart selection, AlphaGenome family filters,
keyboard arrows/Enter, inspector collapse/reveal, light/dark and widths down to 390px.

Shared fixture: `src/test/evidenceWorkspaceFixture.ts`. Model contracts:
`src/test/evidenceComparison.test.ts`; interactions and tab/rail integration:
`src/components/evidence/__tests__/EvidenceWorkspace.test.tsx` and
`EvidenceTabs.integration.test.tsx`.
