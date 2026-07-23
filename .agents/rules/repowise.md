# Repowise Usage Guidelines for AI Agents

To ensure token efficiency, clean execution context, and data-driven refactoring, all agents operating in this workspace must adhere to the following Repowise guidelines.

---

## 1. Distilling Noisy Commands
Command line runs (tests, builds, lints, listings) generate significant console noise that consumes context window space.
* **Always Wrap Noisy Commands:** Wrap long-running or verbose commands in `repowise distill`.
  * **Linting:** `repowise distill npm run lint`
  * **Testing:** `repowise distill npm run test`
  * **Building:** `repowise distill npm run build`
* **Expanding Omitted Output:** When a distilled command outputs a `[repowise#<ref>: N lines omitted]` marker, do NOT re-run the command. Instead, recover the logs using:
  ```bash
  repowise expand <ref>
  ```
  *(Tip: Add `-q <regex>` to filter for specific errors if needed).*

---

## 2. Refactoring & Code Health Check
Before starting any significant refactoring or optimization task, inspect the codebase quality metrics.
* **Consult Code Health:** Run `repowise health` to get complexity (CCN), nesting levels, and file scores.
* **Focus Areas:** Prioritize files with a score of `1.0/10` to `3.5/10` (e.g. `server/utils.ts`, `src/useVariantAnalysis.ts`, `src/components/MolstarViewer.tsx`).
* **Check History & Risk:** Evaluate historical churn and risk parameters for the specific files you intend to modify using:
  ```bash
  repowise risk <file_path>
  ```

---

## 3. Dead Code Cleanup
Before initiating code cleanup sweeps, run the dead code detector:
```bash
repowise dead-code
```
* Treat `unused_export` findings at `>= 70%` confidence as candidates for removal.
* Verify dependencies before removing `unreachable_file` candidates.

---

## 4. Architectural Decisions
Respect and keep track of historical architectural decision records:
* **List Decisions:** Check for any established design guidelines or deprecations:
  ```bash
  repowise decision list
  ```
* **Verify Changes:** If your modifications contradict an existing active decision, raise this as a warning in the plan.

---

## 5. Precise Navigation & Symbol Searches
Avoid wildcard file reads or large grep sweeps. Use symbol indexing to navigate the codebase:
```bash
repowise search --mode symbol <symbol_name>
```
