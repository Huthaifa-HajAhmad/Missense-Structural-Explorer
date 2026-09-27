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
 * THE OTHER DIRECTION: GATES THAT MUST NOT RUN IN AN IMAGE BUILD
 * --------------------------------------------------------------
 * The same reasoning applies one layer out, and it cost a deployment. `deploy/Dockerfile.oci` ran
 * `npm run lint` as a pre-flight gate, and `lint` grew a step (`this file`) that reads `.github/workflows/`.
 * A Docker build context is the tree with `.dockerignore` applied, and that file excludes `.github/`, so
 * the gate failed CLOSED inside the image build — CD run 36330245416 died with "has no .github/workflows"
 * on a commit whose CI had already passed the identical check. The build was reporting the shape of its
 * own context, not a defect in the revision.
 *
 * So a Dockerfile may only run gates whose requirements its build stage actually satisfies, and the
 * `verify:image` entry is the one that does. That rule is enforced here too, because the failure it
 * prevents is exactly the kind that only shows up at deploy time.
 *
 * WHAT COUNTS AS A GATE
 * ---------------------
 * An `npm run <script>` inside a workflow `run:` step, or inside a Dockerfile's `RUN`. Setup invocations
 * are not gates and are ignored by construction: `npm ci` is not `npm run`, and `actions/*` steps are not
 * shell at all.
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
  rule: "MISSING_SCRIPT" | "NOT_IN_VERIFY" | "NOT_IMAGE_SAFE";
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
 * The one gate an image build may run: the type-check, which depends on nothing but the copied tree.
 *
 * It is a subset of `lint` and therefore of `verify`, so it needs no entry there — that list governs
 * what runs as a CI gate, and this one exists so a Dockerfile has something context-safe to call by name.
 */
export const IMAGE_SAFE_ENTRY = "verify:image";

/**
 * Gates that must never run inside a Docker image build, each with the reason it cannot.
 *
 * Two distinct reasons, one rule: a build stage has no browser, and a build context has no repository
 * metadata. Both produce a failure that describes the build environment rather than the change, which
 * is how a deploy-time "verification" comes to cost four minutes and say nothing about the revision.
 */
export const IMAGE_UNSAFE_GATES = new Map<string, string>([
  ["lint", "it runs `scripts/check-verify-parity.ts`, which reads `.github/workflows/` and fails closed without it"],
  ["test", "it runs `server/tests/verify-parity.test.ts`, which exercises the real repository through `REPO_ROOT`"],
  ["test:coverage", "it runs the same suite as `test`"],
  ["test:geometry", "it renders in headless Chromium, which no build stage installs"],
  ["test:geometry:function-track", "it renders in headless Chromium, which no build stage installs"],
]);

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
 * Every npm script a workflow shell step or a Dockerfile `RUN` invokes, with its line number.
 *
 * Comments are skipped: the workflow files and the Dockerfiles explain their own gate history in prose
 * that names scripts (this repository's `ci.yml` documents a removed Python setup step and a measured
 * cost profile; `Dockerfile` names the two gates it used to run and why it cannot), and a guard that
 * fired on its own documentation would be deleted rather than obeyed.
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

/**
 * Directories never worth walking for a Dockerfile: build output, dependencies, and the local
 * agent/analysis leftovers this repository keeps out of git (see `.dockerignore` for the sizes).
 */
const DOCKERFILE_WALK_SKIP = new Set([
  ".git",
  ".antigravity",
  ".kilo",
  ".zvec-grep",
  "coverage",
  "data",
  "dist",
  "graphify-out",
  "logs",
  "node_modules",
  "scratch",
]);

/**
 * Every Dockerfile in the tree, including `Dockerfile.<variant>` and `*.dockerfile`.
 *
 * Walked rather than listed, because the whole point is to catch the file someone adds next — a rule
 * that only checked the two paths that exist today would be a rule about those two paths.
 */
export function readDockerfiles(rootDir: string, custom?: Map<string, string>): Map<string, string> {
  if (custom) return custom;

  const found = new Map<string, string>();

  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!DOCKERFILE_WALK_SKIP.has(entry.name)) walk(full);
      } else if (/^Dockerfile(\..+)?$/i.test(entry.name) || /\.dockerfile$/i.test(entry.name)) {
        found.set(full, fs.readFileSync(full, "utf-8"));
      }
    }
  };

  walk(rootDir);
  return found;
}

/**
 * Why `script` cannot run in an image build, or `null` if it can.
 *
 * Follows the script chain, so redefining `verify:image` as `npm run lint` is caught by the same rule
 * that catches calling `lint` directly — otherwise "call the safe alias" would be a way to hide a gate
 * from this check, which is the shape of evasion the parity rule exists to close for workflows.
 */
export function imageUnsafeCulprit(scripts: Record<string, string>, script: string): string | null {
  const direct = IMAGE_UNSAFE_GATES.get(script);
  if (direct) return direct;

  for (const reached of expandScripts(scripts, script)) {
    if (reached === script) continue;
    const reason = IMAGE_UNSAFE_GATES.get(reached);
    if (reason) return `\`npm run ${script}\` reaches \`${reached}\`, which cannot: ${reason}`;
  }

  return null;
}

export interface CheckDockerfileGatesOptions {
  rootDir?: string;
  /** Injected Dockerfile contents (path -> text). Used by tests to build synthetic trees. */
  customDockerfiles?: Map<string, string>;
  /** Injected package.json scripts. Used by tests. */
  customScripts?: Record<string, string>;
}

/**
 * Every gate a Dockerfile runs that its build stage cannot satisfy.
 *
 * Not fail-closed on an empty Dockerfile set, unlike the workflow scan: this is a constraint on files
 * that happen to exist, and a repository with no image is not a repository whose check is unread. The
 * positive case is guarded instead, by a test asserting the real tree yields Dockerfiles to scan.
 */
export function checkDockerfileGateSafety(options: CheckDockerfileGatesOptions = {}): VerifyParityViolation[] {
  const rootDir = options.rootDir ?? REPO_ROOT;
  const scripts = readScripts(rootDir, options.customScripts);
  const dockerfiles = readDockerfiles(rootDir, options.customDockerfiles);
  const violations: VerifyParityViolation[] = [];

  for (const [file, content] of dockerfiles) {
    const relative = path.relative(rootDir, file).replace(/\\/g, "/") || file;

    for (const { script, line } of extractWorkflowScripts(content)) {
      if (!(script in scripts)) {
        violations.push({
          file: relative,
          line,
          script,
          rule: "MISSING_SCRIPT",
          message:
            `The Dockerfile runs \`npm run ${script}\`, which package.json does not define. The image ` +
            `build fails with "Missing script" rather than running a gate.`,
        });
        continue;
      }

      const reason = imageUnsafeCulprit(scripts, script);
      if (reason) {
        const suggestion =
          script === IMAGE_SAFE_ENTRY
            ? `\`${IMAGE_SAFE_ENTRY}\` has to stay the artifact-level type-check (\`tsc --noEmit\`) rather ` +
              `than an alias for the gate set`
            : IMAGE_SAFE_ENTRY in scripts
              ? `Use \`npm run ${IMAGE_SAFE_ENTRY}\` here`
              : `Add \`${IMAGE_SAFE_ENTRY}\` to package.json — the artifact-level type-check — and use it here`;
        violations.push({
          file: relative,
          line,
          script,
          rule: "NOT_IMAGE_SAFE",
          message:
            `The image build gates on \`npm run ${script}\`, which cannot run in a build context: ` +
            `${reason}. \`.dockerignore\` excludes \`.github/\` from the context it copies, so this ` +
            `fails the deploy describing the context instead of the change — it is what failed CD run ` +
            `36330245416. ${suggestion}; the gate set itself already ran in CI against this exact ` +
            `revision, which is what \`cd.yml\` gates on.`,
        });
      }
    }
  }

  return violations;
}

// CLI runner
const currentFilePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(currentFilePath)) {
  const violations = [...checkVerifyParity(), ...checkDockerfileGateSafety()];
  if (violations.length === 0) {
    console.log(
      "\x1b[32m✔ Verify parity check passed: every gate CI runs is reachable from `npm run verify`, and " +
        "no Dockerfile runs a gate its build stage cannot satisfy.\x1b[0m",
    );
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
