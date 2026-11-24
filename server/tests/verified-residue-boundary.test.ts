import { describe, it, expect } from "vitest";
import path from "path";
import { checkBoundaries } from "../../scripts/check-boundaries.ts";

/**
 * TypeScript's private constructor stops `new VerifiedResidue(...)` only until someone writes `as any`.
 * A verified residue made that way would skip the numbering check it stands for, so the boundary check
 * also refuses it: only `src/shared/verifiedResidue.ts` may construct one.
 */
describe("VerifiedResidue construction boundary", () => {
  const rootDir = process.cwd();
  const check = (relativePath: string, code: string) =>
    checkBoundaries(rootDir, new Map([[path.join(rootDir, ...relativePath.split("/")), code]]));

  it("refuses a forced construction outside its own module", () => {
    const violations = check(
      "server/services/rogue-engine.ts",
      ["const r = new (VerifiedResidue as any)(residue);", "const s = Object.create(VerifiedResidue.prototype);"].join("\n")
    );
    expect(violations.map((v) => [v.rule, v.line])).toEqual([
      ["ONLY_ITS_MODULE_CONSTRUCTS_VERIFIED_RESIDUE", 1],
      ["ONLY_ITS_MODULE_CONSTRUCTS_VERIFIED_RESIDUE", 2],
    ]);
  });

  it("refuses it in client code too", () => {
    const violations = check("src/components/RogueView.tsx", "const r = new VerifiedResidue(residue);");
    expect(violations.map((v) => v.rule)).toEqual(["ONLY_ITS_MODULE_CONSTRUCTS_VERIFIED_RESIDUE"]);
  });

  it("allows the supported way in, and the module itself", () => {
    expect(check("server/services/engine.ts", "const r = VerifiedResidue.of(residue);")).toEqual([]);
    expect(check("src/shared/verifiedResidue.ts", "return new VerifiedResidue(residue);")).toEqual([]);
  });

  it("ignores a mention in a comment", () => {
    expect(check("server/services/engine.ts", "// never write new VerifiedResidue(residue) here")).toEqual([]);
  });
});
