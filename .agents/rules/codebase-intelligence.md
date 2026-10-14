---
trigger: always_on
description: Mandatory codebase intelligence protocol — prioritize Graphify AST graphs and Repowise docs/signals before raw text grep or manual file reads.
---

# Codebase Intelligence Protocol (Graphify + Repowise)

When answering questions about architecture, tracing execution paths, discovering caller hierarchies, or planning refactors, **always check existing knowledge graphs first** before running token-heavy file scans or brute-force greps.

These tools feed the *investigation*, not the *authority to change code*. What a review may read and what
a bug hunt may edit is fixed by `.agents/rules/review-posture.md`; a wide graph or grep is not a licence to
widen the surface.

## 1. Decision Routing

* **Conceptual & Semantic Code Search**: Use **zvec-grep** (`npm run search -- "<query>"`). Fuses BM25 full-text + local vector embeddings (`potion-code-16m-v2`). **Agents MUST NOT blind-grep or crawl directories when wording or file locations are unknown.**
* **API Surfaces & Skeletons (Token-Efficient)**: Use **Graft** (`graft_file_api` MCP or `npm run graft -- skeleton <file>`). Saves ~90% tokens when checking signatures/types.
* **Transitive Callers & Blast Radius**: Use **Graft** (`graft_trace_calls` MCP or `npm run graft -- callers <symbol> -d <N>`).
* **Symbol Relationships & Function Call Paths**: Use **Graphify** (`graphify path "<A>" "<B>"` or `query_graph` MCP).
* **Architecture Questions & Subsystem Mapping**: Use **Graphify** (`graphify query "<question>"`, `graphify god-nodes`) or **Graft** (`graft_repo_map` MCP, `npm run graft -- map`).
* **High-Level Docs, Decisions & Git Signals**: Use **Repowise** (`repowise docs`, `repowise scan`).
* **Dead Code & Unused Exports**: Use **Repowise** (`repowise dead-code`).
* **Exact String Literals / Error Regexes**: Use standard `grep_search`.

## 2. Command Reference (Windows & Cross-Platform Safe)

### Conceptual & Semantic Search (zvec-grep)
```bash
# Natural language / conceptual query across workspace
npm run search -- "consensus stability score calibration"

# Hybrid query with BM25 keyword boost and glob filter
npm run search -- "foldx box64" --fts "box64" -g "server/**"

# Re-index workspace using local 16M code model
npm run search:index
```

### Knowledge Graph & AST Paths (Graphify)
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
* After modifying or adding files in a development session, run `python -m uv tool run --from graphifyy graphify extract . --code-only` to keep `graphify-out/graph.json` fresh.
* After adding substantial new modules, routes, or documentation, run `npm run search:index` to update the local `.zvec-grep/` vector and BM25 index.
