# Code map

Small tables about this repository, written by `scripts/code-map.ts` from the source tree. They answer
"which file serves this route and which guards run before it", "which test imports this module" and
"which file calls this outside service" without opening source files.

**Search these files with grep. Do not read a whole table.** The two test maps together are about 100 KB.

```bash
grep "/api/v1/admin" doc/code-map/routes.csv
grep "server/services/structure/esmfold.ts" doc/code-map/test-map-server.csv
grep "FOLDX_" doc/code-map/env-keys.csv
```

## Keeping it true

The tables are a pure function of the code: no dates, no commit ids, no line numbers. So:

- After you change routes, imports, tests, outside hosts, settings or database tables, stage any new file (`git add`) and run `npm run map`
  and commit `doc/code-map/` in the same pull request.
- `npm run lint` runs `npm run map:check` and fails when a table differs from the code. A table is
  therefore never older than the branch that holds it.
- A merge conflict in this folder is solved the same way: take either side, then run `npm run map`.
- If the generator meets a route shape it cannot follow, it stops with a message. It never skips the route.
- Tests compare the route tables with the real Express app, in production mode.

## Tables

| File | One row per | Columns |
| --- | --- | --- |
| `routes.csv` | route (method + path) the Express app answers | `method`; `path` (full, so API routes start with `/api/v1`); `middleware`; `handler` (`inline` = written in place); `file`; `conditional` |
| `middleware.csv` | `app.use` / `router.use` call | `order`; `scope` (`*` = the whole app, `/api/v1` = every API route, otherwise a path); `middleware`; `file`; `conditional` |
| `test-map-server.csv`, `test-map-src.csv` | source file in `server/`, `src/` | `source`; `kind`; `direct_tests` (test files that import it directly; empty = none) |
| `external-apis.csv` | host written as a string in a `server/` file | `host`, `file` |
| `env-keys.csv` | environment variable read (`process.env` on the server, `import.meta.env` in the client) | `key`, `file` |
| `db-tables.csv` | `CREATE TABLE` in a `server/` file | `table`, `file` |

**`middleware` in `routes.csv` is complete.** It lists every guard that was registered before the route and
covers its path, in the order Express runs them (the app's own, then the API router's, then the path-scoped
ones), and then the route's own. One grep on a route answers "what runs before this handler", authentication
included. A name ending in `?` is conditional.

**`kind`** says what a file is, so that an empty `direct_tests` is read correctly: `barrel` (only re-exports),
`types` (only types, nothing to run), `component`, `client`, `server`.

## What a row does not tell you

- `conditional` / `?` means the code is inside an `if`, a ternary, a `&&`, or a loop the map could not
  unroll. The map does not know which side runs. For example the Vite middleware exists only in development.
- A path with `{name}` is built by code at run time from a list the map could not read. Search the named file.
- A loop over a plain list of strings is unrolled, so each value has its own row, and a guard chosen by the
  value (`suffix === "hotspots" ? [limiter] : []`) is applied to the right row.
- `app.use("/internal/deployment", handler)` answers requests but Express registers it as middleware, so it
  is in `middleware.csv`, not `routes.csv`.
- `direct_tests` counts direct imports only. A module reached through an `index.ts` or a test helper can show
  no test here and still be tested. End-to-end tests (`tests/*.e2e.ts`) drive the running app and import no
  source module, so they are not mapped.
- `external-apis.csv` finds hosts written as plain strings. A host built from a variable is missing; look for
  the setting in `env-keys.csv`.
