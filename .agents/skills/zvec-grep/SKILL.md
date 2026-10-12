---
name: zvec-grep
description: Local-first semantic and hybrid workspace search using zvec-grep (zg v0.2.2). Use when exploring unfamiliar features, locating business logic by concept, searching across multi-format documentation and code, or when exact token names are unknown.
---

# zvec-grep (`zg`): Local-First Workspace Search

`zvec-grep` unifies BM25 lexical search, local vector embeddings (via Model2Vec `potion-code-16m-v2`), and managed ripgrep behind a unified local ranking engine.

## When to Use

| Task | Recommended Tool | Why |
| :--- | :--- | :--- |
| **Conceptual / Semantic Query** | `npm run search -- "<query>"` | Finding business logic, concepts, algorithms, or docs |
| **Exact Token / Regex** | `grep_search` (ripgrep) | Exact function, variable name, or error string is known |
| **AST Symbol Relationships** | `Graphify` (`query_graph` or `graphify path`) | Mapping call paths and architectural hubs |
| **API Signatures & Skeletons** | `Graft` (`graft_file_api`) | Inspecting interface boundaries with ~90% token reduction |

---

## CLI Command Reference (v0.2.2)

Always invoke via `npm run search -- ...`. `zg` is not on the root `PATH`: it is installed by
`npm run tools:install` into `tools/agent-tooling/`, so the script name is the supported entry point
(see `tools/agent-tooling/README.md` for why it is not a root dependency).

### 1. Conceptual Search (Default Hybrid)
Fuses BM25 keyword matching with local vector embeddings:
```bash
npm run search -- "consensus stability score calibration"
```

### 2. Scoped Hybrid Query with File Glob & Type Filters
Combine semantic intent with exact keyword requirements and path constraints:
```bash
npm run search -- "foldx box64" --fts "box64" -g "server/**" -t ts
```

### 3. Symbol-Targeted Search
Restrict hits to definitions of functions, classes, or interfaces:
```bash
npm run search -- "calibrated consensus" --symbol-type function --prefer-symbol
```

### 4. Code Snippet Context Preview
Include short code snippets around matching lines to minimize secondary tool reads:
```bash
npm run search -- "conformal prediction interval" --preview short --limit 5
```

### 5. Multi-Route Fused Search
Combines an explicit vector query and an exact keyword query into one unified ranked list:
```bash
npm run search -- --vector "where variant consequence is resolved" --fts "vep" --fuse
```

### 6. Maintenance & Diagnostics
```bash
# Check index status, coverage, and embedding model
npm run search:status

# Refresh or rebuild the local .zvec-grep/ index
npm run search:index
```

---

## Agent Decision Heuristics

1. **Do Not Blind-Grep**: If you do not know the exact identifier name, do NOT guess strings or run multi-directory file listings. Run `npm run search -- "<natural language concept>"`.
2. **Read Surrounding Code**: Hits provide precise `file:///path/to/file.ts:line` citations. Use `view_file` targeted around the reported line range.
3. **Use Scopes for Speed**: When querying known subsystems, add `-g "server/**"` or `-g "src/**"` to eliminate cross-subsystem noise.
