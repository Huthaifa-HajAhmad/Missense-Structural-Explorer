# Agent instructions

## Look facts up before you search or read source files

`doc/code-map/` holds tables that a program writes from the code. Grep them first. Never read a whole table.

| Question | Table |
| --- | --- |
| Which file serves a route, and which guards run before it? | `routes.csv`, `middleware.csv` |
| Which test files import a module? | `test-map-server.csv`, `test-map-src.csv` |
| Which server file calls an outside host? | `external-apis.csv` |
| Which file reads an environment variable? | `env-keys.csv` |
| Which file creates a database table? | `db-tables.csv` |

The tables are exact for the branch you are on, because `npm run lint` fails when they are out of date.
After you change routes, tests, outside hosts, settings or database tables, run `npm run map` and commit
`doc/code-map/` with your change. Details, columns and limits: `doc/code-map/README.md`.

## State machines

Before you change a status, a lock, a lease, a retry or a timer, read its section in `doc/STATE_MACHINES.md`,
and update that section in the same change. `server/tests/state-machines-doc.test.ts` fails when the document
names a file or function that no longer exists.

## Bug-finding lint rules

`npm run lint` also runs `npm run lint:rules` (Oxlint with type information, about 5 seconds). The rules and
their reasons are in `.oxlintrc.json`. They find real bugs, not style:

- A promise that nobody awaits fails silently. Write `void call()` only when the call can never reject
  (for example `AuditLogger.log`). Otherwise `await` it or add a `.catch`.
- `array.sort()` without a compare function sorts numbers as text.
- Template strings must not hold objects. A `switch` over a union needs a `default` or every case.
- Use `===`. `== null` is allowed because it means "null or undefined".

The rules that need type information run on `tsrs`, a dev dependency that Oxlint finds by name in `node_modules`.
Nothing imports it, but do not remove it: `lint:rules` then fails with "Failed to find type-aware linter".

A route may be `async` without its own `try`/`catch`: `server/async-route-errors.ts` passes a rejection to the
JSON error handler, as Express 5 does. A route that must reply in its own way (a stream, a custom status) still
catches the error itself.

If a hit is a false alarm, add `// oxlint-disable-next-line <rule> -- <reason>` on the line above it.
Do not turn a rule off in the config without a stated reason.

The other rules for this repository are in `.agents/rules/`.
