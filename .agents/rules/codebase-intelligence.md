---
trigger: always_on
description: Mandatory codebase intelligence protocol — prioritize Graphify AST graphs and Repowise docs/signals before raw text grep or manual file reads.
---

# Codebase Intelligence Protocol (Graphify + Repowise)

When answering questions about architecture, tracing execution paths, discovering caller hierarchies, or planning refactors, **always check existing knowledge graphs first** before running token-heavy file scans or brute-force greps.

## 1. Decision Routing

* **Symbol Relationships & Function Call Paths**: Use **Graphify** (`graphify path "<A>" "<B>"` or `query_graph` MCP).
* **Architecture Questions & Subsystem Mapping**: Use **Graphify** (`graphify query "<question>"`, `graphify god-nodes`).
* **High-Level Docs, Decisions & Git Signals**: Use **Repowise** (`repowise docs`, `repowise scan`).
* **Dead Code & Unused Exports**: Use **Repowise** (`repowise dead-code`).
* **Exact String Literals / Error Regexes**: Use standard `grep_search`.

## 2. Command Reference (Windows & Cross-Platform Safe)

When CLI commands are executed in Windows environments, invoke via `python -m uv tool run --from graphifyy graphify`:

```bash
# Query the AST knowledge graph
python -m uv tool run --from graphifyy graphify query "<question>"

# Find the shortest call/import path between two modules
python -m uv tool run --from graphifyy graphify path "<SymbolA>" "<SymbolB>"

# List architectural hubs (god nodes)
python -m uv tool run --from graphifyy graphify god-nodes

# Refresh AST graph after editing files (fast, zero API cost)
python -m uv tool run --from graphifyy graphify extract . --code-only
```

## 3. Maintenance Mandate
After modifying or adding files in a development session, run `python -m uv tool run --from graphifyy graphify extract . --code-only` to keep `graphify-out/graph.json` fresh.
