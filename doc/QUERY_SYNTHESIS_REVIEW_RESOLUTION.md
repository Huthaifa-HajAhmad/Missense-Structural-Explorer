# Query and synthesis review resolution

2026-10-12. Follow-up to the reported review of `b0a7130`, `84e70ab`, `ac648ad` and `6591cc3`. Fixes were prepared in an isolated worktree to preserve concurrent workspace edits. Those four commits are included in the follow-up PR.

| Finding | Resolution and coverage |
| --- | --- |
| UniProt disclosure loses focus | Keep the label action mounted; opening focuses the accession input and closing returns focus to that action. A filled override remains visible when collapsed. Component and browser checks cover the sequence. |
| UniProt control's accessible name differs from visible text | Remove the collapsed row's overriding aria-label; its visible wording supplies the name. Component and browser assertions cover a filled accession. |
| Supported zero-match literature group lacks coverage | Exercise an enabled zero-count coverage group, its explicit ?None in this group? state, and returning to all sources. The coverage figure deliberately allows an observed zero to be explored; unsupported notation remains omitted. |
| Unsupported-notation assertion is vacuous | Assert the coverage section has exactly two available groups and no protein/cDNA variant group. Restoring the removed group fails the count assertion. |
| Scroll containment check is outside CI | Add `test:geometry:review` to `verify:geometry`, which CI already runs. The harness starts its own fixture server and uses a separately locked Playwright driver installed in CI. It performs a real wheel gesture reaching the bottom of Insights, plus responsive, selection and focus checks. |
| Duplicate consensus assembly | Move the current-engine assembly into shared `stabilityConsensusFor`; retain `deriveConsensus` as a compatibility export. Insights snapshots and exports now use that same assembly. Existing engine/fallback/repair-failure parity tests pass. |
| Duplicate allele-scoped workspace state | Extract `useAlleleWorkspaceState` for both providers. Existing Evidence and Review workspace tests cover selection, remount persistence and reset on allele changes. |
| Missing paper leaves a pending reveal | Consume the reveal even when the selected target is absent. Literature hands off the reveal only after its filters are cleared. A regression confirms later source reappearance cannot steal focus. |
| Reveal silently discards a draft search | Preserve the draft text and suspend its narrowing filter for the explicit reveal. Further editing reactivates narrowing; new queries and allele changes reset the suspension. A regression covers draft preservation, reveal focus and subsequent editing. |
| API-settings CTA shown for transport failures | Use a return-to-query recovery action for failed analyses and retain the actual error. Network and credential error tests cover recovery navigation. |
| Possible stale Insights evidence, unverified | No defect reproduced. Add a component regression changing remote engine values while keeping the same result; the stability reading updates. The existing memo dependencies include the result and current energetics. |

Validation: 172 distinct affected tests pass across Query, Literature, Insights, consensus parity and Evidence workspace suites. Lint (boundaries, focus indicators, verification parity and TypeScript) and the production client build pass. Browser fixtures exercise the actual AppViews integration and contain illustrative data, not clinical evidence. No new reviewer agents or additional model reviews were run in this fix pass.

Run the browser check locally after `npm ci --prefix tools/review-preview` with `npm run test:geometry:review`. `REVIEW_PREVIEW_URL` can point to an existing fixture server; `BROWSER_PATH`/`CHROME_PATH` can override browser discovery.
