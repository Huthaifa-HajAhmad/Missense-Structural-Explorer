---
trigger: always_on
description: Look routes, guards, tests, outside hosts, settings and database tables up in doc/code-map/*.csv before reading source files.
---

# Code map

`doc/code-map/` holds tables that a program writes from the source tree (see `doc/code-map/README.md`).
Use them first for these questions:

| Question | Table |
| --- | --- |
| Which file serves `METHOD /path`, and which guards run before it (authentication included)? | `routes.csv` (the `middleware` column is complete), `middleware.csv` |
| Which test files import this module? Which modules have no importing test? | `test-map-server.csv`, `test-map-src.csv` |
| Which server file calls this outside host? | `external-apis.csv` |
| Which file reads this environment variable? | `env-keys.csv` |
| Which file creates this database table? | `db-tables.csv` |

## Rules

1. **Grep a table, never read it whole.** The two test maps together are about 100 KB.
2. **A table is exact for the branch you are on.** `npm run lint` fails when it is out of date, so a
   branch's tables match its own code. If you are unsure, `npm run map:check` answers in seconds.
3. **After you change routes or guards, add or remove a test, call a new outside host, read a new setting,
   or create a table, run `npm run map` and keep `doc/code-map/` in the same change.** Do not edit the CSV files by hand.
4. **The map points to the file; it does not replace reading it.** Open the file named in a row before you edit it.
5. **Read `conditional` and `?` as "maybe".** Read an empty `direct_tests` for a `barrel` or `types` file as
   "nothing to test", and for any other file as "no test imports it directly", not "untested".
6. For call paths, callers and file skeletons use Graft and Graphify (see `codebase-intelligence.md`). The map does not hold them.
