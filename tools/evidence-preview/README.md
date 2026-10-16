# Evidence workspace preview

Run `npx vite --host 127.0.0.1 --port 5184 --strictPort`, then open
`http://127.0.0.1:5184/tools/evidence-preview/index.html`.

Uses the production AppViews, tabs, inspector, settings and CSS with explicitly labelled
illustrative fixtures. No credentials are needed. `/api/` calls are blocked; existing
background workspaces may log blocked requests. Never use these values as scientific evidence.

Ten tabs use four fixture families. The Example selector changes with the family:

- Population / Predictors / AlphaGenome: Mixed, Partial, Absent, Zero, Missing and New variant. Absent models a confirmed gnomAD no-record response and no ClinVar assertion; it is not a measured zero.
- Gene–disease / Expression / Species: Mixed, Mismatch, Missing and New variant. Missing
  removes expression/animal sources; the disease assertions remain. Choose the recessive
  disease frame to exercise a frame without validity assertions.
- Residue shifts / Perturbation / Functional domains: Overlapping domains, Dense SOD1,
  NAE1, Missing and New variant. Missing retains intrinsic residue properties while model
  output and protein annotations report their own unavailable states.

Check source-record and figure selection, AlphaGenome filters, categorical assertion pins,
species coverage drilldown, the bounded/full probability distribution, protein-map windows,
keyboard arrows/Enter, inspector collapse/reveal, light/dark and widths down to 390px.

Population navigation/availability proof: run `tests/population-workspace.e2e.ts` with
`APP_URL` pointing at this preview server. The inspector shell owns expand/collapse;
workspace navigation no longer includes a duplicate Open inspector button.

Shared fixture: `src/test/evidenceWorkspaceFixture.ts`. Model contracts:
`src/test/evidenceComparison.test.ts`; interactions and tab/rail integration:
`src/components/evidence/__tests__/EvidenceWorkspace.test.tsx` and
`EvidenceTabs.integration.test.tsx`.

RNA splicing includes Reverse strand, Forward strand, Small signals, Zero, Missing, Unknown
strand, Missing positions and New variant cases. Its map and Source records share the selected
reading with the inspector. Check the annotated-transcript and prediction tracks, channel
keyboard navigation, exact offsets, map controls, and selection across views. Fixtures live in
`src/test/splicingWorkspaceFixture.ts`; model and interaction tests are
`src/test/splicingWorkspace.test.ts` and `src/components/evidence/__tests__/SplicingWorkspace.test.tsx`.
Re-scoring requests are blocked in this preview; successful and stale replies are covered by tests.

Context and molecular fixtures are `src/test/contextWorkspaceFixture.ts` and
`src/test/molecularWorkspaceFixture.ts`; their integration tests live beside the Evidence
tests above. See `doc/CONTEXT_MOLECULAR_VISUALIZATION_REVIEW.md` for the latest review.
The development server also works on `localhost` with the selected port.
