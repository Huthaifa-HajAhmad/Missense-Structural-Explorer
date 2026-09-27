import { describe, it, expect } from "vitest";
import path from "path";
import fs from "fs";
import {
  checkVerifyParity,
  expandScripts,
  extractWorkflowScripts,
  NETWORK_DEPENDENT_GATES,
  REPO_ROOT,
  VERIFY_ENTRY,
} from "../../scripts/check-verify-parity.ts";

/**
 * The local/CI gate-set parity guard.
 *
 * `npm run verify` is only worth having if it is the SAME set of gates CI runs. The drift this guards
 * against is silent and one-directional: someone adds a gate to a workflow, CI starts catching a class
 * of defect, and `verify` keeps reporting OK — so a developer gets a green local run and a red push,
 * which is the exact cost the arrangement exists to remove.
 *
 * It already cost something. The clinical-audit change had five reviewers, none of whom could run the
 * geometry harnesses; no local command covered them either; and CI was the first thing to notice that
 * darkening `--cs-surface-2` had pushed the disulfide swatch to 2.85:1 against the 3:1 bar. A green
 * local run of 2176 tests said nothing about the step that failed.
 *
 * So the tests below are mostly NEGATIVE: each one makes the two sets disagree in a specific way and
 * asserts the guard notices. A guard that only passes on the real repository would prove nothing,
 * because the real repository is the case that is already correct.
 */

function workflow(text: string) {
  return new Map([[path.join(REPO_ROOT, ".github", "workflows", "ci.yml"), text]]);
}

describe("extractWorkflowScripts", () => {
  it("reads `npm run <script>` from shell steps, with line numbers", () => {
    const found = extractWorkflowScripts(["jobs:", "  a:", "    steps:", "      - run: npm run lint"].join("\n"));
    expect(found).toEqual([{ script: "lint", line: 4 }]);
  });

  it("treats npm's `npm test` shorthand as the `test` script", () => {
    expect(extractWorkflowScripts("      - run: npm test").map(f => f.script)).toEqual(["test"]);
  });

  it("does not mistake a namespaced script for the shorthand", () => {
    // `npm test:coverage` is not a thing; the shorthand pattern must not swallow it and report "test".
    const found = extractWorkflowScripts("      - run: npm run test:coverage").map(f => f.script);
    expect(found).toEqual(["test:coverage"]);
  });

  it("skips comments, which is where these workflows explain their own gate history", () => {
    /*
     * `ci.yml` documents a removed Python setup step and a measured cost profile in prose that names
     * scripts. A guard that fired on its own documentation would be deleted rather than obeyed.
     */
    const found = extractWorkflowScripts([
      "# We used to run: npm run test:smoke",
      "      #   npm run test:canary too",
      "      - run: npm run lint",
    ].join("\n"));
    expect(found).toEqual([{ script: "lint", line: 3 }]);
  });

  it("finds every occurrence on a line, not just the first", () => {
    expect(extractWorkflowScripts("      - run: npm run lint && npm run test").map(f => f.script)).toEqual([
      "lint",
      "test",
    ]);
  });
});

describe("expandScripts", () => {
  it("follows npm run references transitively", () => {
    const reach = expandScripts(
      {
        verify: "npm run lint && npm run verify:test",
        "verify:test": "npm run test:coverage",
        lint: "tsc --noEmit",
        "test:coverage": "vitest run --coverage",
      },
      "verify",
    );
    expect([...reach].sort()).toEqual(["lint", "test:coverage", "verify", "verify:test"]);
  });

  it("terminates on a cycle instead of hanging", () => {
    const reach = expandScripts({ a: "npm run b", b: "npm run a" }, "a");
    expect([...reach].sort()).toEqual(["a", "b"]);
  });

  it("returns just the entry for a script that calls nothing", () => {
    expect([...expandScripts({ lint: "tsc --noEmit" }, "lint")]).toEqual(["lint"]);
  });
});

describe("checkVerifyParity — the real repository", () => {
  it("passes: every gate CI runs is reachable from verify", () => {
    // The positive case. It would pass vacuously if the workflow scan found nothing, which the
    // extractor's own tests above rule out.
    expect(checkVerifyParity()).toEqual([]);
  });

  it("actually finds gates in the real workflows", () => {
    // Guards the positive case against a silent scan of nothing.
    const workflowsDir = path.join(REPO_ROOT, ".github", "workflows");
    const found = fs
      .readdirSync(workflowsDir)
      .filter(f => /\.ya?ml$/.test(f))
      .flatMap(f => extractWorkflowScripts(fs.readFileSync(path.join(workflowsDir, f), "utf-8")));
    expect(found.length).toBeGreaterThan(3);
    expect(found.map(f => f.script)).toContain("test:coverage");
  });

  it("is part of `npm run lint`, so it runs locally and in CI", () => {
    // A parity guard that is not itself in the local gate set is the thing it exists to prevent.
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf-8"));
    expect(pkg.scripts.lint).toContain("check-verify-parity");
  });
});

describe("checkVerifyParity — negative controls", () => {
  it("catches a gate CI runs that verify does not reach", () => {
    const violations = checkVerifyParity({
      rootDir: REPO_ROOT,
      customScripts: { verify: "npm run lint", lint: "tsc --noEmit", "test:coverage": "vitest run" },
      customWorkflows: workflow("      - run: npm run lint\n      - run: npm run test:coverage"),
    });

    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe("NOT_IN_VERIFY");
    expect(violations[0].script).toBe("test:coverage");
    expect(violations[0].message).toContain("would be green while CI fails");
  });

  it("counts a gate reached through an alias as covered", () => {
    // `verify -> verify:geometry -> test:geometry`. Following the chain is what makes an alias safe
    // rather than a way to hide a gate from the check.
    const violations = checkVerifyParity({
      rootDir: REPO_ROOT,
      customScripts: {
        verify: "npm run verify:geometry",
        "verify:geometry": "npm run test:geometry && npm run test:geometry:function-track",
        "test:geometry": "node tools/header-geometry/check.mjs",
        "test:geometry:function-track": "node tools/function-track-geometry/check.mjs",
      },
      customWorkflows: workflow("      - run: npm run verify:geometry"),
    });

    expect(violations).toEqual([]);
  });

  it("catches a workflow gating on a script that no longer exists", () => {
    // A rename leaves the workflow calling `npm run build:cli`; npm fails the job with "Missing script",
    // so the gate silently becomes an error rather than the check it was meant to be.
    const violations = checkVerifyParity({
      rootDir: REPO_ROOT,
      customScripts: { verify: "npm run lint", lint: "tsc --noEmit" },
      customWorkflows: workflow("      - run: npm run lint\n      - run: npm run build:cli"),
    });

    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe("MISSING_SCRIPT");
    expect(violations[0].script).toBe("build:cli");
  });

  it("lets a network-dependent gate through, and only because it is allow-listed", () => {
    /*
     * `npm audit` resolves against a live advisory database, so its verdict depends on when it runs
     * rather than on the tree. The pair of assertions below is the point: with the allow-list it is
     * accepted, without it, it is a violation. That proves the list is doing work rather than that the
     * check happens to skip it.
     */
    const inputs = {
      rootDir: REPO_ROOT,
      customScripts: { verify: "npm run lint", lint: "tsc --noEmit", audit: "npm audit" },
      customWorkflows: workflow("      - run: npm run audit"),
    };

    expect(checkVerifyParity(inputs)).toEqual([]);
    expect(NETWORK_DEPENDENT_GATES.has("audit")).toBe(true);

    const strict = checkVerifyParity({ ...inputs, exclusions: new Set<string>() });
    expect(strict).toHaveLength(1);
    expect(strict[0].script).toBe("audit");
  });

  it("reports the line number of the offending step, not the file", () => {
    const violations = checkVerifyParity({
      rootDir: REPO_ROOT,
      customScripts: { verify: "npm run lint", lint: "tsc --noEmit" },
      customWorkflows: workflow(["# a comment", "jobs:", "  x:", "    steps:", "      - run: npm run rogue"].join("\n")),
    });

    expect(violations[0].line).toBe(5);
  });

  it("names the entry script in the message so the fix is obvious", () => {
    // `rogue` must EXIST for this to be the parity violation rather than the missing-script one, so the
    // message under test is the one that says what to do.
    const violations = checkVerifyParity({
      rootDir: REPO_ROOT,
      customScripts: { verify: "npm run lint", lint: "tsc", rogue: "node rogue.mjs" },
      customWorkflows: workflow("      - run: npm run rogue"),
    });
    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe("NOT_IN_VERIFY");
    expect(violations[0].message).toContain(VERIFY_ENTRY);
  });
});

describe("checkVerifyParity — fail-closed", () => {
  it("refuses to scan a directory that is not this repository", () => {
    /*
     * The same rule `check-boundaries.ts` learned: a guard that reports success because it read nothing
     * is worse than no guard, and this one's whole subject — a relationship between two files — is
     * invisible when either input is missing.
     */
    expect(() => checkVerifyParity({ rootDir: path.join(REPO_ROOT, "scratch") })).toThrow(
      /no \.github\/workflows/,
    );
  });

  it("does not silently pass when verify is missing altogether", () => {
    const violations = checkVerifyParity({
      rootDir: REPO_ROOT,
      // No `verify` script defined at all: every workflow gate is unreachable.
      customScripts: { lint: "tsc --noEmit", "test:coverage": "vitest run" },
      customWorkflows: workflow("      - run: npm run lint\n      - run: npm run test:coverage"),
    });

    expect(violations).toHaveLength(2);
    expect(violations.every(v => v.rule === "NOT_IN_VERIFY")).toBe(true);
  });
});
