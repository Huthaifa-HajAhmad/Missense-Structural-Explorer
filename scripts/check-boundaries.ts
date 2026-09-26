import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * The repository root, derived from THIS FILE rather than from the process cwd.
 *
 * The default used to be `process.cwd()` and nothing verified that cwd was the repository, so running
 * the checker from anywhere else scanned a directory containing no `server/` and no `src/`, found no
 * files, and printed "passed: 0 violations found" with exit 0. A guard that passes because it looked at
 * nothing is precisely the failure this file exists to catch elsewhere; it should not commit it itself.
 * A review found this by running it from two other directories.
 */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export interface BoundaryViolation {
  file: string;
  line: number;
  importPath: string;
  rule: "SERVER_CANNOT_IMPORT_NON_SHARED_CLIENT" | "CLIENT_CANNOT_IMPORT_SERVER" | "SHARED_CANNOT_IMPORT_OUTSIDE" | "SERVER_CANNOT_IMPORT_SCRIPTS" | "STORES_CANNOT_IMPORT_COMPONENTS";
  message: string;
}

/**
 * Component modules the store is allowed to import, because they are pure.
 *
 * WHY THIS LIST EXISTS
 * --------------------
 * Rule 5 forbids `src/stores/**` from reaching into `src/components/**`. That direction was previously
 * unchecked — the four rules above model server/client/shared and say nothing about store→component —
 * so `searchSlice` importing `components/report/reportStatus` was invisible to this checker. It is
 * benign today (the reviewer who found this proved `reportStatus.ts` is React-free and closes no
 * cycle), but "benign today and unguarded" is how component code ends up in the store's module graph
 * the next time someone adds an import to that file.
 *
 * The exception is not a waiver. Each entry is validated at check time: the module must import no
 * `react` and no other `src/components` file. If it stops being pure, the exception is reported as a
 * violation rather than silently honoured — so the list cannot outlive the property that justified it.
 *
 * The alternative fix — relocating the module into `src/shared/` — is the better end state and is
 * recorded as O3/O11 in `doc/INSPECTOR_UI_UX_AUDIT.md`; moving it would touch five import sites and a
 * shared test, which is why the guard is here first.
 */
const PURE_COMPONENT_MODULES_ALLOWED_TO_STORES = new Set([
  "src/components/report/reportStatus.ts",
]);

const IGNORED_DIRS = new Set(["node_modules", "dist", "scratch", "temp_jobs", ".git", ".gemini"]);

function getFilesRecursively(dir: string, extensions: string[]): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...getFilesRecursively(fullPath, extensions));
    } else if (extensions.some(ext => entry.name.endsWith(ext))) {
      results.push(fullPath);
    }
  }

  return results;
}

export function isInsideDir(targetPath: string, parentDir: string): boolean {
  const normTarget = path.resolve(targetPath).toLowerCase();
  const normParent = path.resolve(parentDir).toLowerCase();
  return normTarget === normParent || normTarget.startsWith(normParent + path.sep);
}

export function stripCommentsPreservingLineNumbers(code: string): string {
  // Replace block comments with equal number of newlines to preserve line counting
  const withoutBlock = code.replace(/\/\*[\s\S]*?\*\//g, match => {
    const newlines = match.split("\n").length - 1;
    return "\n".repeat(newlines);
  });
  // Replace single-line comments with spaces
  return withoutBlock.replace(/\/\/.*$/gm, "");
}

const IMPORT_EXPORT_REGEX = /(?:import|export)\s+(?:type\s+)?(?:[\w*\s{},$\r\n]+\s+from\s+)?["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;

export function extractModuleSpecifiers(filePath: string, fileContent?: string): Array<{ specifier: string; line: number }> {
  const rawContent = fileContent !== undefined ? fileContent : fs.readFileSync(filePath, "utf-8");
  const cleanContent = stripCommentsPreservingLineNumbers(rawContent);

  const specifiers: Array<{ specifier: string; line: number }> = [];
  let match: RegExpExecArray | null;
  IMPORT_EXPORT_REGEX.lastIndex = 0;

  while ((match = IMPORT_EXPORT_REGEX.exec(cleanContent)) !== null) {
    const specifier = match[1] || match[2];
    if (!specifier) continue;

    const line = cleanContent.slice(0, match.index).split("\n").length;
    specifiers.push({ specifier, line });
  }

  return specifiers;
}

export function resolveImportTarget(importSpecifier: string, fromFile: string, rootDir: string): string | null {
  if (importSpecifier.startsWith(".")) {
    return path.resolve(path.dirname(fromFile), importSpecifier);
  }
  if (importSpecifier.startsWith("@/")) {
    return path.resolve(rootDir, importSpecifier.slice(2));
  }
  if (importSpecifier === "@") {
    return path.resolve(rootDir);
  }
  return null;
}

export function checkBoundaries(rootDir: string = REPO_ROOT, customFiles?: Map<string, string>): BoundaryViolation[] {
  /**
   * Fail CLOSED when asked to scan something that is not the repository.
   *
   * Skipped when `customFiles` is supplied, because callers use that to check a synthetic tree built in
   * a temp directory — the tests in `server/tests/architectural-boundaries.test.ts` do exactly that.
   */
  if (
    !customFiles &&
    (!fs.existsSync(path.join(rootDir, "server")) || !fs.existsSync(path.join(rootDir, "src")))
  ) {
    throw new Error(
      `boundary check: "${rootDir}" is not the repository root (no server/ and src/), so scanning it would report success while checking nothing`
    );
  }

  const violations: BoundaryViolation[] = [];
  const serverDir = path.resolve(rootDir, "server");
  const srcDir = path.resolve(rootDir, "src");
  const sharedDir = path.resolve(rootDir, "src", "shared");
  const rootServerFile = path.resolve(rootDir, "server.ts");
  const scriptsDir = path.resolve(rootDir, "scripts");
  /** Rule 5's two directories. Declared here, NOT inline in the loop — see the note on rule 5. */
  const storesDir = path.resolve(rootDir, "src", "stores");
  const componentsDir = path.resolve(rootDir, "src", "components");
  /** A TEST file: not in the server bundle, so its imports are not a runtime dependency. */
  const isTestFile = (p: string) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(p) || /[\\/](__tests__|tests?)[\\/]/.test(p);

  let serverFiles: string[];
  let srcFiles: string[];

  if (customFiles) {
    serverFiles = Array.from(customFiles.keys()).filter(f => isInsideDir(f, serverDir) || path.resolve(f).toLowerCase() === rootServerFile.toLowerCase());
    srcFiles = Array.from(customFiles.keys()).filter(f => isInsideDir(f, srcDir));
  } else {
    serverFiles = getFilesRecursively(serverDir, [".ts", ".js", ".cjs", ".mjs"]);
    if (fs.existsSync(rootServerFile)) {
      serverFiles.push(rootServerFile);
    }
    srcFiles = getFilesRecursively(srcDir, [".ts", ".tsx", ".js", ".jsx"]);
  }

  // 1. Check Server Files: May only import server/* or src/shared/* (or node packages)
  for (const filePath of serverFiles) {
    const content = customFiles?.get(filePath);
    const imports = extractModuleSpecifiers(filePath, content);

    for (const { specifier, line } of imports) {
      const resolved = resolveImportTarget(specifier, filePath, rootDir);
      if (!resolved) continue;

      if (isInsideDir(resolved, srcDir) && !isInsideDir(resolved, sharedDir)) {
        violations.push({
          file: path.relative(rootDir, filePath).replace(/\\/g, "/"),
          line,
          importPath: specifier,
          rule: "SERVER_CANNOT_IMPORT_NON_SHARED_CLIENT",
          message: `Server file imports from client outside of src/shared: "${specifier}". Move shared primitives to src/shared/.`
        });
      }

      /**
       * Rule 1b: the server may not depend on `scripts/`, which is tooling.
       *
       * This is the rule that was MISSING. The check above only fires for targets inside `src/`, so
       * `energy-models.ts` importing `scripts/build-rasp-sqlite.ts` was a live server→tooling edge that
       * the checker reported clean — an invisible violation of the documented rule, which is worse than
       * a noisy one. That import has since moved into the server; this keeps the next one visible.
       *
       * `scripts/` itself stays unscanned on purpose: a script importing `server/` or `src/` is
       * legitimate tooling use, and the CLI wrapper for this very builder does exactly that. TEST files
       * are exempt too — `server/tests/architectural-boundaries.test.ts` imports this checker, which is
       * a test exercising tooling, not a runtime dependency of the server.
       */
      if (isInsideDir(resolved, scriptsDir) && !isTestFile(filePath)) {
        violations.push({
          file: path.relative(rootDir, filePath).replace(/\\/g, "/"),
          line,
          importPath: specifier,
          rule: "SERVER_CANNOT_IMPORT_SCRIPTS",
          message: `Server file imports from scripts/, which is tooling: "${specifier}". Move the implementation into server/ and leave a thin CLI wrapper in scripts/.`
        });
      }
    }
  }

  // 2. Check Client Files & Shared Files
  for (const filePath of srcFiles) {
    const isShared = isInsideDir(filePath, sharedDir);
    const content = customFiles?.get(filePath);
    const imports = extractModuleSpecifiers(filePath, content);

    for (const { specifier, line } of imports) {
      const resolved = resolveImportTarget(specifier, filePath, rootDir);
      if (!resolved) continue;

      const isServerTarget = isInsideDir(resolved, serverDir) || path.resolve(resolved).toLowerCase() === rootServerFile.toLowerCase();
      const isNonSharedClientTarget = isInsideDir(resolved, srcDir) && !isInsideDir(resolved, sharedDir);

      // Rule 2: Client cannot import server
      if (!isShared && isServerTarget) {
        violations.push({
          file: path.relative(rootDir, filePath).replace(/\\/g, "/"),
          line,
          importPath: specifier,
          rule: "CLIENT_CANNOT_IMPORT_SERVER",
          message: `Client file imports from server: "${specifier}". Client must communicate via API client or shared contracts.`
        });
      }

      // Rule 3: Shared cannot import outside src/shared
      if (isShared && (isServerTarget || isNonSharedClientTarget)) {
        violations.push({
          file: path.relative(rootDir, filePath).replace(/\\/g, "/"),
          line,
          importPath: specifier,
          rule: "SHARED_CANNOT_IMPORT_OUTSIDE",
          message: `Shared module imports outside src/shared: "${specifier}". Shared modules must be pure and self-contained.`
        });
      }

      /**
       * Rule 5: the store may not reach into the component tree, except through a module this file
       * has verified is React-free. See `PURE_COMPONENT_MODULES_ALLOWED_TO_STORES`.
       *
       * Only the FIRST direction is new: a component importing the store is normal and stays legal.
       */
      if (isInsideDir(filePath, storesDir) && isInsideDir(resolved, componentsDir)) {
        /*
         * `resolveImportTarget` resolves a specifier to a path WITHOUT its extension, because imports in
         * this repo may be written either way (`"../../components/report/reportStatus"` and
         * `".../reportStatus.ts"` both occur). The allowlist names real files, so try the extensions
         * this repo uses before deciding the module is not exempt.
         */
        const candidates = [resolved, `${resolved}.ts`, `${resolved}.tsx`];
        const exemptIndex = candidates.findIndex(candidate =>
          PURE_COMPONENT_MODULES_ALLOWED_TO_STORES.has(path.relative(rootDir, candidate).replace(/\\/g, "/")),
        );
        const exempt = exemptIndex !== -1;
        const relativeTarget = path.relative(rootDir, candidates[exemptIndex === -1 ? 0 : exemptIndex]).replace(/\\/g, "/");
        const relativeFrom = path.relative(rootDir, filePath).replace(/\\/g, "/");

        if (!exempt) {
          violations.push({
            file: relativeFrom,
            line,
            importPath: specifier,
            rule: "STORES_CANNOT_IMPORT_COMPONENTS",
            message: `Store module imports from src/components: "${specifier}". Move the shared logic into src/shared/ (or add the module to PURE_COMPONENT_MODULES_ALLOWED_TO_STORES only if it is genuinely React-free).`
          });
        } else {
          /*
           * The exception is validated, not trusted. A module that has acquired a `react` or
           * `src/components` import of its own no longer satisfies the condition it was exempted
           * under, so the exemption is reported as a violation instead of being honoured.
           */
          const targetPath = candidates[exemptIndex];
          const targetContent = customFiles?.get(targetPath) ?? (fs.existsSync(targetPath) ? fs.readFileSync(targetPath, "utf-8") : "");
          const impure = extractModuleSpecifiers(targetPath, targetContent).find(({ specifier: dep }) => {
            if (dep === "react" || dep.startsWith("react/") || dep.startsWith("react-dom")) return true;
            const depResolved = resolveImportTarget(dep, targetPath, rootDir);
            return depResolved ? isInsideDir(depResolved, componentsDir) : false;
          });

          if (impure) {
            violations.push({
              file: relativeFrom,
              line,
              importPath: specifier,
              rule: "STORES_CANNOT_IMPORT_COMPONENTS",
              message: `"${relativeTarget}" is exempted from rule 5 as a pure module, but it now imports "${impure.specifier}". The exemption is void: either make it pure again or move the shared logic into src/shared/.`
            });
          }
        }
      }
    }
  }

  return violations;
}

// CLI runner
const currentFilePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(currentFilePath)) {
  const violations = checkBoundaries();
  if (violations.length === 0) {
    console.log("\x1b[32m✔ Architectural boundary check passed: 0 violations found.\x1b[0m");
    process.exit(0);
  } else {
    console.error(`\x1b[31m✖ Architectural boundary check failed: ${violations.length} violation(s) found:\x1b[0m\n`);
    for (const v of violations) {
      console.error(`  \x1b[33m${v.file}:${v.line}\x1b[0m [${v.rule}]`);
      console.error(`    ${v.message}\n`);
    }
    process.exit(1);
  }
}
