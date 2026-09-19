import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

export interface BoundaryViolation {
  file: string;
  line: number;
  importPath: string;
  rule: "SERVER_CANNOT_IMPORT_NON_SHARED_CLIENT" | "CLIENT_CANNOT_IMPORT_SERVER" | "SHARED_CANNOT_IMPORT_OUTSIDE" | "SERVER_CANNOT_IMPORT_SCRIPTS";
  message: string;
}

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

export function checkBoundaries(rootDir: string = process.cwd(), customFiles?: Map<string, string>): BoundaryViolation[] {
  const violations: BoundaryViolation[] = [];
  const serverDir = path.resolve(rootDir, "server");
  const srcDir = path.resolve(rootDir, "src");
  const sharedDir = path.resolve(rootDir, "src", "shared");
  const rootServerFile = path.resolve(rootDir, "server.ts");
  const scriptsDir = path.resolve(rootDir, "scripts");
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
       * are exempt too � `server/tests/architectural-boundaries.test.ts` imports this checker, which is
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
