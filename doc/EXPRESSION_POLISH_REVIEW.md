# Expression corrections - 2026-11-04

- Secondary source tabs use a shared compact presentation, with existing keyboard navigation.
- Review settings use a clear heading and responsive groups; repeated pext scope prose is removed.
- Sparse maps label narrow coding regions; dense maps fit labels without overlap and always label the active region. The table lists every region. These are not transcript exons.
- Tissue equality compares original values, rather than rounded display values. Source tables retain precision.
- Live gnomAD CNNM2 response: region 102918481 to 102920101 contains position 102919549;
  all 49 returned tissue values are exactly 1. This is a proportion, not equal RNA abundance.
- Local dGTEx snapshot returns 125 CNNM2 observations. Installed the checksum-verified snapshot on the OCI VM; the then-active missense-resolve-blue container returned ready with 125 observations. A later check on missense-resolve-green at revision 10b6ffc also returned 125; see the rollout log.
  Docker excludes SQLite files and the runtime data mount must contain the snapshot; see deploy/ROLLOUT.md.

Source: https://gnomad.broadinstitute.org/api (CNNM2, GRCh38 pext query, retrieved 2026-11-04).
No classification rules or thresholds changed.

## Review corrections

Verified the review findings against the actual changes. Uniform tissue summaries now
preserve source precision, including zero and 0.9991. Missing values never become zero.
Sparse maps retain narrow-region numbers; dense maps reserve the active region and
skip labels that would overlap. Table values remain complete.

Secondary source navigation and the Gene-disease presentation control share a visible
clay selection border, stable font weight, and a forced-colors selection border.
Primary evidence views retain underlines. This follows the original request for nested
source controls and does not move primary navigation.

Record fields and action buttons have a minimum height of 38px and grow with larger
text. The Gene-disease presentation group matches that height. A short visible reminder
identifies review systems as choices rather than patient findings. Exact tissue values
use the same lossless string conversion in tables and summaries; numeric columns keep
tabular figures. The production installation evidence is recorded in deploy/ROLLOUT.md.

The pill styling applies to shared source groups (Expression and Species) and the
Gene-disease presentation switch; it does not change primary evidence-view tabs.

## Validation

- Focused Vitest run: 62 tests passed across the Expression, context-workspace and workspace-tab suites.
- Browser checks: all seven passed, covering 390/800/1440px layouts, light/dark themes,
  measured toolbar heights, larger text, keyboard navigation, stable tab widths, and
  rendered label spacing on 9-region and 320-region maps.
- Lint (including TypeScript) and the production client build passed on the isolated branch.
- A full Vitest attempt was stopped during host memory pressure after failures in the
  unchanged authentication and contextual-help suites. This is not a full-suite pass.
- The OCI verification is read-only in this review pass; the snapshot was installed
  earlier in this thread. No application deployment is included in this PR.

The browser fixture used the real components with illustrative data. Its local server
reused installed dependencies and disabled the optional ML sidecar to avoid loading
models the fixture never calls. These local settings are not part of the change.
