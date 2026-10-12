---
trigger: always_on
description: Graft codebase context engine — use for token-efficient file skeletons, transitive caller blast-radius tracing, and symbol wiring graphs.
---

# Graft Codebase Context Engine Protocol

Graft provides a deterministic, AST-level code context layer (`graft/`) powered by tree-sitter. It operates locally with zero token cost ($0) and automatically reflects working-tree changes in ~3ms.

> **Prerequisite:** `npm run tools:install`, once per clone. Graft is deliberately kept out of the root
> `package.json` so CI does not install it — see `tools/agent-tooling/README.md`. Without it, `npm run
> graft` and the `graft` MCP server both exit with that instruction.

## 1. When to Use Graft

* **Inspecting API Surfaces without Reading Full Files**: Use `graft_file_api` (MCP) or `npm run graft -- skeleton <file>`. This extracts all exported functions, methods, interfaces, and classes without bodies, saving ~90% context tokens.
* **Tracing Refactoring Blast Radius**: Use `graft_trace_calls` (MCP) or `npm run graft -- callers <symbol> -d <N>`. Identifies all upstream callers and references across the codebase before modifying signatures.
* **Centrality & Hotspot Orientation**: Use `graft_repo_map` (MCP) or `npm run graft -- map` to view directory clusters and key architectural hubs ranked by in-degree references.
* **Semantic Node Search**: Use `graft_find_code` (MCP) or `npm run graft -- ask "<concept>"`.

## 2. Command Reference

```bash
# Skeletons (signatures only, ~1/10th tokens of raw file)
npm run graft -- skeleton src/App.tsx

# Callers & Blast Radius (inbound references up to depth 2)
npm run graft -- callers App -d 2

# Callees (what does this symbol call?)
npm run graft -- callers <symbol> --direction out

# Repository architecture map
npm run graft -- map

# Rebuild / refresh graph
npm run graft -- build .
```

## 3. Tool Synergies

| Task | Primary Tool | Secondary / Verification |
| :--- | :--- | :--- |
| Check file API signatures | `graft_file_api` | Raw `view_file` only if body logic is needed |
| Check blast radius before refactor | `graft_trace_calls` | `graphify path` for shortest path between modules |
| High-level architecture & docs | `repowise docs` | `graft_repo_map` for symbol centrality |
| Dead code analysis | `repowise dead-code` | `npm run graft -- callers <symbol>` |
