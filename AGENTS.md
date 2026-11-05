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

The other rules for this repository are in `.agents/rules/`.
