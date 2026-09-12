import { describe, it, expect } from "vitest";
import path from "path";
import { checkBoundaries, isInsideDir } from "../../scripts/check-boundaries.ts";

describe("Architectural Boundary Rules & Layer Isolation", () => {
  it("enforces strict layer isolation across the real repository with 0 violations", () => {
    const violations = checkBoundaries();
    
    if (violations.length > 0) {
      const summary = violations
        .map(v => `  ${v.file}:${v.line} [${v.rule}] -> ${v.message}`)
        .join("\n");
      expect.fail(
        `Found ${violations.length} architectural boundary violation(s):\n${summary}`
      );
    }

    expect(violations).toHaveLength(0);
  });

  describe("Adversarial Boundary Scanner Robustness (Negative Testing)", () => {
    const rootDir = process.cwd();

    it("detects multiline imports from server into non-shared client code", () => {
      const mockFiles = new Map<string, string>();
      mockFiles.set(
        path.join(rootDir, "server", "services", "rogue-service.ts"),
        [
          "import {",
          "  SomeComponent,",
          "  AnotherThing",
          '} from "../../src/components/AppViews.tsx";'
        ].join("\n")
      );

      const violations = checkBoundaries(rootDir, mockFiles);
      expect(violations).toHaveLength(1);
      expect(violations[0].rule).toBe("SERVER_CANNOT_IMPORT_NON_SHARED_CLIENT");
      expect(violations[0].importPath).toBe("../../src/components/AppViews.tsx");
      expect(violations[0].line).toBe(1);
    });

    it("detects path-aliased (@/src) imports from server into non-shared client", () => {
      const mockFiles = new Map<string, string>();
      mockFiles.set(
        path.join(rootDir, "server", "routes", "rogue-route.ts"),
        ["import", ' { useSettings } from "@/src/hooks/useSettings.ts";'].join("")
      );

      const violations = checkBoundaries(rootDir, mockFiles);
      expect(violations).toHaveLength(1);
      expect(violations[0].rule).toBe("SERVER_CANNOT_IMPORT_NON_SHARED_CLIENT");
      expect(violations[0].importPath).toBe("@/src/hooks/useSettings.ts");
    });

    it("detects boundary violations inside root server.ts", () => {
      const mockFiles = new Map<string, string>();
      mockFiles.set(
        path.join(rootDir, "server.ts"),
        ["import", ' { App } from "./src/App.tsx";'].join("")
      );

      const violations = checkBoundaries(rootDir, mockFiles);
      expect(violations).toHaveLength(1);
      expect(violations[0].rule).toBe("SERVER_CANNOT_IMPORT_NON_SHARED_CLIENT");
    });

    it("detects path-aliased (@/server) imports from client into server code", () => {
      const mockFiles = new Map<string, string>();
      mockFiles.set(
        path.join(rootDir, "src", "components", "RogueCard.tsx"),
        ["import", ' { CONFIG } from "@/server/config.ts";'].join("")
      );

      const violations = checkBoundaries(rootDir, mockFiles);
      expect(violations).toHaveLength(1);
      expect(violations[0].rule).toBe("CLIENT_CANNOT_IMPORT_SERVER");
      expect(violations[0].importPath).toBe("@/server/config.ts");
    });

    it("detects dynamic import() calls violating boundaries across multiple lines", () => {
      const mockFiles = new Map<string, string>();
      mockFiles.set(
        path.join(rootDir, "src", "hooks", "rogueHook.ts"),
        [
          "export async function loadServer() {",
          "  const s = await import(",
          '    "../../server/utils.ts"',
          "  );",
          "  return s;",
          "}"
        ].join("\n")
      );

      const violations = checkBoundaries(rootDir, mockFiles);
      expect(violations).toHaveLength(1);
      expect(violations[0].rule).toBe("CLIENT_CANNOT_IMPORT_SERVER");
      expect(violations[0].importPath).toBe("../../server/utils.ts");
      expect(violations[0].line).toBe(2);
    });

    it("detects shared modules reaching out to non-shared client code or server", () => {
      const mockFiles = new Map<string, string>();
      mockFiles.set(
        path.join(rootDir, "src", "shared", "leaky-helper.ts"),
        [
          ["import", ' { VARIANT_PRESETS } from "../data.ts";'].join(""),
          ["import", ' { runFoldX } from "@/server/services/foldx.ts";'].join("")
        ].join("\n")
      );

      const violations = checkBoundaries(rootDir, mockFiles);
      expect(violations).toHaveLength(2);
      expect(violations.map(v => v.rule)).toEqual([
        "SHARED_CANNOT_IMPORT_OUTSIDE",
        "SHARED_CANNOT_IMPORT_OUTSIDE"
      ]);
    });

    it("allows legal inward imports from server and client to src/shared", () => {
      const mockFiles = new Map<string, string>();
      mockFiles.set(
        path.join(rootDir, "server", "services", "legal.ts"),
        [
          ["import", ' { AMINO_ACID_3_TO_1 } from "../../src/shared/aminoAcids.ts";'].join(""),
          ["import", ' type { AnalysisResult } from "@/src/shared/contracts.ts";'].join("")
        ].join("\n")
      );
      mockFiles.set(
        path.join(rootDir, "src", "components", "LegalCard.tsx"),
        [
          ["import", ' { THRESHOLDS } from "@/src/shared/thresholds.ts";'].join(""),
          ["import", ' { getVariantStyles } from "../shared/variantStyles.ts";'].join("")
        ].join("\n")
      );
      mockFiles.set(
        path.join(rootDir, "src", "shared", "pure.ts"),
        [
          ["import", ' { AMINO_ACID_1_TO_3 } from "./aminoAcids.ts";'].join(""),
          ["import", ' type { PdbHomolog } from "./contracts.ts";'].join("")
        ].join("\n")
      );

      const violations = checkBoundaries(rootDir, mockFiles);
      expect(violations).toHaveLength(0);
    });

    it("prevents sibling directory prefix bypasses (e.g. src/shared-fake/)", () => {
      const parent = path.join(rootDir, "src", "shared");
      const sibling = path.join(rootDir, "src", "shared-fake", "index.ts");
      expect(isInsideDir(sibling, parent)).toBe(false);

      const subfile = path.join(rootDir, "src", "shared", "sub", "index.ts");
      expect(isInsideDir(subfile, parent)).toBe(true);
    });
  });
});
