---
name: verify-missense-resolve
description: Launch, check, drive, and prove the Missense & Fold web app (Express + Vite dev server, React UI) with e2e. Use before claiming a UI change works, when asked to verify or screenshot a view, or to run the end-to-end tests.
---

# Verify Missense & Fold

Read the e2e skill first (`npx e2e guide` prints it). This skill only says what is true of
this app. The config is `e2e.config.ts` (target `web`, tests `tests/**/*.e2e.ts`). The e2e
tests are separate from vitest: `npm test` never collects `*.e2e.ts`; run them with
`npm run test:e2e` or `npx e2e run`.

## Launch

The target's `app.command` runs `node node_modules/tsx/dist/cli.mjs server.ts`, the same
process as `npm run dev`, with `PORT=3917`. It is spelled with `process.execPath` because
a Windows spawn cannot resolve `npm` (`spawn npm ENOENT`). The runner starts it, waits for
`http://127.0.0.1:3917`, and stops it after the run; cold start is about 10 s.
`reuseExisting: true` attaches to a server already on that port. `APP_URL` overrides the
URL and port. The default is 3917, not 3000, so a run never touches a dev server you have
open on 3000.

`AUTH_MODE=legacy` in `.env`: no sign-in, no seeded accounts, no database to prepare.
Starting the server also starts the ML sidecar on :8000 and Vite HMR on :24678. A second
instance logs `Port 24678 is already in use`; that is a warning, not a failure.

## Doctor

```bash
npx e2e list                          # loads the config, starts nothing; every test-target pair
npx e2e run tests/smoke.e2e.ts        # starts the app, opens it, pins the nav and Analyse button; exit 0
```

`list` failing is the config or a dependency. `run` failing with `APP_UNREACHABLE` and
`spawn ... ENOENT` is the command; with `ERR_CONNECTION_RESET` the server process died
(see Gotchas). A `500` on `/@vite/client` against a long-running dev server means its
`node_modules` changed under it: restart that server. Run Doctor first whenever anything
looks off.

## Drive

Live, over the registered `e2e mcp` server: `open_session`, then `observe`, the verbs, and
`locate` before writing any locator (topic `mcp`). The server is registered in `.mcp.json`;
start a new agent session after it was added. Scripted: a test under `tests/`, `screen`
for every control (all have accessible names), no `agent.*` (no model is configured).

Every test starts a fresh browser context, which shows the first-run onboarding tour, and
its scrim intercepts every click. Call `skipTour(browser)` from `tests/support.ts` before
`app.open('/')`; only `tests/tour.e2e.ts` leaves the tour on.

The shipped map is [features/](features/README.md), one file per feature.

## Evidence

Every run writes `.e2e/report.json`. A failed test gets `.e2e/results/<test>/trace.md`
with the screen tree at failure; `--trace on` writes it for passing tests too; `--video`
records each attempt; `app.screenshot('<name>')` saves a named frame. The next run clears
`.e2e/results/`, Doctor included, so a proof that must outlive it runs with `--output
.e2e/proof/<name>`. A proof drives the real UI path (sidebar, the labelled control, the
button) and captures the state after it. Side effects live in the browser, not on disk:
the tour flag is `localStorage['cs-onboarding-completed-v1']`; the server's own log is
`.e2e/logs/app.log`.

## Bug bash

Not wired: `e2e.config.ts` has no `agents` model, so `e2e explore` has nothing to run on.
To enable it, add a model (topic `setup`, "Subscriptions and API keys"), write
`e2e.bugbash.config.ts` spreading `e2e.config.ts` with `tests/bugbash/**` added to the
glob, keep `.e2e/bugbash/` in `.gitignore`, and paste the charters from
[features/](features/README.md) in the `slug|target|agent|charter` fan-out format. A
finding is a bug only once `tests/bugbash/<slug>.e2e.ts` fails with `ASSERTION_FAILED` on
the assertion that encodes it. What is not a bug here: service tiles that read "offline"
or "fallback" (they reflect live upstream health), and a missing Gemini key (AI synthesis
is optional).

## Cleanup

The runner stops the server it started. An `npm run dev` you started is yours to stop, by
its pid on the port (`netstat -ano | findstr :3917`), never by process name. Keep
`.e2e/results/`, `.e2e/proof/`, `.e2e/report.json`, `.e2e/logs/`; they are the evidence
and are gitignored.

## Gotchas

- **429s are the app's own limiter.** `apiLimiter` in `server/middleware.ts` allows 120
  API calls a minute per IP, and every page polls diagnostics. `workers: 1` and
  `retries: 1` in the config keep a run under it; raising `workers` brings back 429s that
  read as a flaky UI.
- **A dead server shows as `ERR_CONNECTION_RESET`.** The runner does not restart a server
  that exits mid-run. One cause is fixed: `analyzeMultimerStructure` left its PDBe task
  with no handler when an abort failed the UniProt reads first, which exits Node on an
  unhandled rejection (pinned in `server/services/structure/multimer.test.ts`). If it
  recurs, `.e2e/logs/app.log` ends with the stack of whatever rejected.
- **Live tests need the network.** `tests/analysis.e2e.ts` (tag `live`) analyses PAH
  p.Arg408Trp against Ensembl, ClinVar, UniProt, and others. Skip it offline with
  `--tag smoke,navigation,search,shell`.
- Textbox names change after a fill (`Protein or cDNA notation` becomes `... Protein
  HGVS`), so locate them with a `^` regex.
