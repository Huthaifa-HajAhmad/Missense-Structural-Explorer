import { readdirSync, readFileSync } from "fs";
import path from "path";
import { parseSync, visitorKeys, type Node } from "oxc-parser";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../../scripts/check-boundaries.js";

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectTsFiles(fullPath));
    } else if (entry.name.endsWith(".ts")) {
      out.push(fullPath);
    }
  }
  return out;
}

function lineNumberAt(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}

function findBareExpectCalls(filePath: string): Array<{ line: number; text: string }> {
  const sourceText = readFileSync(filePath, "utf8");
  const parsed = parseSync(filePath, sourceText);
  if (parsed.errors.length > 0) {
    throw new Error(`Failed to parse ${filePath}: ${parsed.errors[0].message}`);
  }

  const lines = sourceText.split(/\r?\n/);
  const violations: Array<{ line: number; text: string }> = [];

  const visit = (node: Node | null | undefined, parent: Node | null) => {
    if (!node || typeof node !== "object") return;

    if (
      node.type === "CallExpression" &&
      node.callee?.type === "Identifier" &&
      node.callee.name === "expect"
    ) {
      // Every expect(...) call must chain a matcher (`.toBe(...)`, `.not.toBeVisible()`, etc.).
      const chained = parent?.type === "MemberExpression" && parent.object === node;
      if (!chained) {
        const line = lineNumberAt(sourceText, node.start);
        violations.push({ line, text: (lines[line - 1] ?? "").trim() });
      }
    }

    const keys = visitorKeys[node.type as keyof typeof visitorKeys] ?? [];
    for (const key of keys) {
      const value = (node as unknown as Record<string, unknown>)[key];
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item === "object" && "type" in item) {
            visit(item as Node, node);
          }
        }
      } else if (value && typeof value === "object" && "type" in value) {
        visit(value as Node, node);
      }
    }
  };

  visit(parsed.program, null);
  return violations;
}

describe("e2e assertion guards", () => {
  it("chains a matcher onto every expect(...) call in tests/", () => {
    const testsDir = path.join(REPO_ROOT, "tests");
    const files = collectTsFiles(testsDir);
    expect(files.length).toBeGreaterThan(0);

    const bare: string[] = [];
    for (const file of files) {
      const rel = path.relative(REPO_ROOT, file).replace(/\\/g, "/");
      for (const hit of findBareExpectCalls(file)) {
        bare.push(`${rel}:${hit.line}: ${hit.text}`);
      }
    }

    expect(bare).toEqual([]);
  });
});
