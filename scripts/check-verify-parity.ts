import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * The local/CI gate-set parity check.
 *
 * WHY THIS EXISTS
 * ---------------
 * `npm run verify` is meant to be the same set of gates CI runs, so that a green local run means what
 * a green CI run means and nobody has to pay for the same work twice to find out. That only holds if
 * the two stay composed from the same scripts — and "stay" is the whole problem. The failure mode is
 * silent and one-directional: someone adds a gate to `.github/workflows/ci.yml`, CI starts catching a
 * class of defect, and `verify` keeps saying OK because nobody thinks to update it. The developer then
 * has a green local run and a red push, which is precisely the cost this arrangement is supposed to
 * remove.
 *
 * That happened here. The five reviewers of the clinical-audit change could not run the geometry
 * harnesses (they need Vite and a browser), no local command covered them, and CI was the first thing
 * to notice that the neutral-ramp change had pushed the disulfide swatch to 2.85:1. A green local run
 * of `tsc` + boundaries + focus + 2176 tests said nothing about the step that failed, because no local
 * command ran it. See `doc/INSPECTOR_UI_UX_AUDIT.md` §0.5.
 *
 * So the relationship is checked instead of promised: every npm script a workflow invokes as a gate
 * must be reachable from `verify`, or be on the short list below with a reason.
 *
 * WHAT COUNTS AS A GATE
 * ---------------------
 * An `npm run <script>` inside a workflow `run:` step. Setup invocations are not gates and are ignored
 * by construction: `npm ci` is not `npm run`, and `actions/*` steps are not shell at all.
 *
 * The exclusion list is deliberately tiny and each entry has to justify itself. A convenience alias
 * does not qualify — aliases are exactly what this check exists to prevent, so an entry means "this
 * gate cannot run from a developer's machine for a reason that is about the environment, not effort".
 */

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export interface VerifyParityViolation {
  file: string;
  line: number;
  script: string;
  rule: "MISSING_SCRIPT" | "NOT_IN_VERIFY";
  message: string;
}

/**
 * Scripts a workflow may run as a gate without being reachable from `verify`.
 *
 * `audit` — `npm audit` resolves against a live advisory database over the network, so its verdict
 * depends on when it runs rather than on the tree. A developer cannot fix a newly-published advisory
 * by editing code, and a local gate that fails for a reason unrelated to the change is a gate people
 * learn to skip. It stays in CI, where the answer is recorded on the commit.
 */
export const NETWORK_DEPENDENT_GATES = new Set(["audit"]);

/** The union script every other gate must be reachable from. */
export const VERIFY_ENTRY = "verify";

/**
 * `npm run <name>` and bare `npm test` in a shell line.
 *
 * `npm test` is npm's own shorthand for `npm run test`, and a workflow is free to use either.
 */
const NPM_RUN = /\bnpm\s+run\s+([a-zA-Z0-9:_.-]+)/g;
const NPM_TEST_SHORTHAND = /\bnpm\s+test\b(?!\s*:)/g;

/** A line that is a YAML comment rather than shell. */
function isComment(line: string): boolean {
  return line.trim().startsWith("#");
}

/**
 * Every npm script a workflow invokes, with its line number.
 *
 * Comments are skipped: the workflow files explain their own gate history in prose that names scripts
 * (this repository's `ci.yml` documents a removed Python setup step and a measured cost profile), and a
 * guard that fired on its own documentation would be deleted rather than obeyed.
 */
export function extractWorkflowScripts(content: string): Array<{ script: string; line: number }> {
  const found: Array<{ script: string; line: number }> = [];

  content.split(/\r?\n/).forEach((line, index) => {
    if (isComment(line)) return;

    NPM_RUN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = NPM_RUN.exec(line)) !== null) {
      found.push({ script: match[1], line: index + 1 });
    }

    if (NPM_TEST_SHORTHAND.test(line)) {
      found.push({ script: "test", line: index + 1 });
    }
  });

  return found;
}

/**
 * Transitively expand a script: the set of scripts `npm run <entry>` reaches.
 *
 * Follows `npm run X` inside each script body, so `verify -> verify:geometry -> test:geometry` counts,
 * and so a gate cannot be smuggled in behind an alias that `verify` calls.
 */
export function expandScripts(
  scripts: Record<string, string>,
  entry: string,
): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (seen.has(current)) continue;
    seen.add(current);

    const body = scripts[current];
    if (!body) continue;

    NPM_RUN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = NPM_RUN.exec(body)) !== null) {
      if (!seen.has(match[1])) queue.push(match[1]);
    }
  }

  return seen;
}

export interface CheckVerifyParityOptions {
  rootDir?: string;
  /** Injected workflow contents (path -> text). Used by tests to build synthetic trees. */
  customWorkflows?: Map<string, string>;
  /** Injected package.json scripts. Used by tests. */
  customScripts?: Record<string, string>;
  exclusions?: Set<string>;
}

function readScripts(rootDir: string, custom?: Record<string, string>): Record<string, string> {
  if (custom) return custom;
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf-8"));
  return pkg.scripts ?? {};
}

function readWorkflows(rootDir: string, custom?: Map<string, string>): Map<string, string> {
  if (custom) return custom;

  const dir = path.join(rootDir, ".github", "workflows");
  const workflows = new Map<string, string>();
  if (!fs.existsSync(dir)) return workflows;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.ya?ml$/.test(entry.name)) continue;
    const full = path.join(dir, entry.name);
    workflows.set(full, fs.readFileSync(full, "utf-8"));
  }
  return workflows;
}

export function checkVerifyParity(options: CheckVerifyParityOptions = {}): VerifyParityViolation[] {
  const rootDir = options.rootDir ?? REPO_ROOT;
  const exclusions = options.exclusions ?? NETWORK_DEPENDENT_GATES;

  /**
   * Fail CLOSED when asked to scan something that is not this repository.
   *
   * The same rule as `check-boundaries.ts`, for the same reason: a guard that reports success because
   * it read nothing is worse than no guard, and this one's whole subject is a relationship that is
   * invisible when the inputs are missing. Skipped when the caller injects the inputs.
   */
  if (!options.customWorkflows && !options.customScripts) {
    if (!fs.existsSync(path.join(rootDir, ".github", "workflows"))) {
      throw new Error(
        `verify-parity check: "${rootDir}" has no .github/workflows, so scanning it would report ` +
          `success while comparing nothing`,
      );
    }
  }

  const scripts = readScripts(rootDir, options.customScripts);
  const workflows = readWorkflows(rootDir, options.customWorkflows);

  const verifyReach = scripts[VERIFY_ENTRY] ? expandScripts(scripts, VERIFY_ENTRY) : new Set<string>();
  const violations: VerifyParityViolation[] = [];

  for (const [file, content] of workflows) {
    const relative = path.relative(rootDir, file).replace(/\\/g, "/") || file;

    for (const { script, line } of extractWorkflowScripts(content)) {
      if (exclusions.has(script)) continue;

      if (!(script in scripts)) {
        violations.push({
          file: relative,
          line,
          script,
          rule: "MISSING_SCRIPT",
          message:
            `The workflow runs \`npm run ${script}\`, which package.json does not define. A renamed ` +
            `script fails the job with "Missing script" rather than running a gate.`,
        });
        continue;
      }

      if (!verifyReach.has(script)) {
        violations.push({
          file: relative,
          line,
          script,
          rule: "NOT_IN_VERIFY",
          message:
            `The workflow gates on \`${script}\`, but \`npm run ${VERIFY_ENTRY}\` does not reach it. ` +
            `A local run would be green while CI fails — add it to \`${VERIFY_ENTRY}\` (or to ` +
            `NETWORK_DEPENDENT_GATES in scripts/check-verify-parity.ts if it cannot run locally).`,
        });
      }
    }
  }

  return violations;
}

// CLI runner
const currentFilePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(currentFilePath)) {
  const violations = checkVerifyParity();
  if (violations.length === 0) {
    console.log("\x1b[32m✔ Verify parity check passed: every gate CI runs is reachable from `npm run verify`.\x1b[0m");
    process.exit(0);
  } else {
    console.error(`\x1b[31m✖ Verify parity check failed: ${violations.length} violation(s) found:\x1b[0m\n`);
    for (const v of violations) {
      console.error(`  \x1b[33m${v.file}:${v.line}\x1b[0m [${v.rule}] npm run ${v.script}`);
      console.error(`    ${v.message}\n`);
    }
    process.exit(1);
  }
}
