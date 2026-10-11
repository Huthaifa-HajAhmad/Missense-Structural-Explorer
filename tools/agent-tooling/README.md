# Agent tooling (local-only)

Two developer/agent tools live here instead of in the root `package.json`:

| Tool | Package | What it provides |
| --- | --- | --- |
| `zg` | `@zvec/zvec-grep` | Local-first semantic/hybrid workspace search (`npm run search`) |
| `graft` | `@nanonets/graft` | AST codebase graph — symbols, callers, skeletons, repo map (`npm run graft`, and the `graft` MCP server in `.mcp.json`) |

## Install

Once per clone:

```bash
npm run tools:install      # npm ci --prefix tools/agent-tooling
```

If they are missing, `npm run graft` / `npm run search` fail with the instruction above rather than a
stack trace (see `cli.cjs`).

## Why they are not in the root `package.json`

Because CI was paying to install them on every run, and CI never uses them.

Measured over the Oct 2026 cycle: `node_modules` was **2,073 MB**, of which these two tools and their
transitive trees were **1,595 MB — 77%**. `@zvec/zvec-grep` alone pulled `node-llama-cpp` (712 MB, its
optional dependency) and `@huggingface/transformers` → `onnxruntime-node` + `onnxruntime-web` (298 MB).
None of it is imported by anything `lint`, the test suite, the geometry harnesses or `build` executes,
and the production image never installs it either — `deploy/Dockerfile.oci` runs `npm ci --omit=dev`,
and these were always `devDependencies`.

So the ~200 CI runs per cycle each installed ~1.6 GB of packages the run does not touch. Removing them
from the root dependency graph shortens the `Install Node dependencies` step, which is the single
largest fixed cost in the pipeline (its own comment in `ci.yml` measures it at 51–82 s).

## Why not `npm ci --omit=optional`

That looks like the cheap fix and it is not one. 314 packages in the root lockfile are marked optional,
and the set includes the **Linux platform binaries** for `tsx` (`tsx/@esbuild/linux-x64`), `esbuild`,
`rollup`, `tailwindcss`/`oxide` and `typescript`. Omitting optional dependencies on a Linux runner
removes the binaries that `npm run lint` and `npm run build` execute under, and on a Windows checkout it
removes `@esbuild/win32-x64`. The split has to be by package, not by dependency class.

## How the callers keep working

`cli.cjs` resolves each tool's real entry point from *this* directory's `node_modules` (the package is
not resolvable from the repository root any more), then runs it. `package.json` scripts and the `graft`
MCP server in `.mcp.json` all go through it, so nothing outside this directory needs to know where the
package landed.

`@alibaba-group/open-code-review` was removed outright in the same change rather than moved: its only
consumer was `scripts/review.ts` and the `review`/`review:preview`/`review:scan` scripts, which went
with it.

## graft and the tree-sitter hook

`@nanonets/graft` requires every tree-sitter grammar it supports at load time. `tree-sitter-kotlin` and
`tree-sitter-swift` ship no prebuilt binary for Windows, so `node-gyp-build` throws
`No native build was found for platform=win32` and the CLI dies before it parses a single argument.

`cli.cjs` installs a require-hook that stubs those two grammars, and loads graft **in this process**,
because a require-hook cannot cross a process boundary into a spawned child.

This is not new behaviour — it preserves the workaround that previously lived in an untracked
`tools/graft/cli.cjs`, a gitignored directory that no fresh clone has. It is tracked here so that a clone
plus `npm run tools:install` reproduces the working setup.

What it costs, stated plainly: on a platform without a prebuild, **kotlin and swift files are not
parsed**, so graft under-reports symbols in them. On a platform where the real binding resolves, the stub
is never reached and nothing changes.

## After this change

`tools/graft/` (the untracked directory holding the old wrapper) is superseded — `npm run graft` and the
MCP server now point at `tools/agent-tooling/cli.cjs`. It can be deleted.
