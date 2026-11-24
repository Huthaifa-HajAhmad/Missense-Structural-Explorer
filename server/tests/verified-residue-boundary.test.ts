import { describe, it, expect } from "vitest";
import path from "path";
import { checkBoundaries } from "../../scripts/check-boundaries.ts";

/**
 * TypeScript's private constructor stops `new VerifiedResidue(...)` only until someone writes `as any`.
 * A verified residue made that way would skip the numbering check it stands for, so the boundary check
 * also refuses it: only `src/shared/verifiedResidue.ts` may construct one. The rule reads the code as a
 * syntax tree, so it also catches a renamed import, an alias, `Reflect.construct` and a subclass.
 */
describe("VerifiedResidue construction boundary", () => {
  const rootDir = process.cwd();
  const RULE = "ONLY_ITS_MODULE_CONSTRUCTS_VERIFIED_RESIDUE";
  const IMPORT = 'import { VerifiedResidue } from "../../src/shared/verifiedResidue.ts";';
  const check = (relativePath: string, ...codeLines: string[]) =>
    checkBoundaries(rootDir, new Map([[path.join(rootDir, ...relativePath.split("/")), codeLines.join("\n")]]));
  const rogue = (...codeLines: string[]) =>
    check("server/services/rogue-engine.ts", ...codeLines).map((v) => [v.rule, v.line]);

  it("refuses a forced construction outside its own module", () => {
    expect(
      rogue(IMPORT, "const r = new (VerifiedResidue as any)(residue);", "const s = Object.create(VerifiedResidue.prototype);")
    ).toEqual([[RULE, 2], [RULE, 3]]);
  });

  it("refuses the ways around a plain `new`: Reflect.construct, an alias and a subclass", () => {
    expect(rogue(IMPORT, "Reflect.construct(VerifiedResidue, [r]);")).toEqual([[RULE, 2]]);
    expect(rogue(IMPORT, "const C = VerifiedResidue as any;", "new C(r);")).toEqual([[RULE, 2]]);
    expect(rogue(IMPORT, "class Fake extends VerifiedResidue {}")).toEqual([[RULE, 2]]);
  });

  it("follows the class through a renamed import, and refuses a re-export", () => {
    expect(
      rogue('import { VerifiedResidue as Proven } from "../../src/shared/verifiedResidue.ts";', "const C = Proven;")
    ).toEqual([[RULE, 2]]);
    const reexport = check("server/services/barrel.ts", 'export { VerifiedResidue } from "../../src/shared/verifiedResidue.ts";');
    expect(reexport.map((v) => v.rule)).toEqual([RULE]);
  });

  it("refuses it in client code too", () => {
    const violations = check("src/components/RogueView.tsx", IMPORT, "const r = new VerifiedResidue(residue);");
    expect(violations.map((v) => v.rule)).toEqual([RULE]);
  });

  it("allows `of`, `is` and the class as a type", () => {
    const code = [
      IMPORT,
      "export function run(r: VerifiedResidue | null): boolean {",
      "  return VerifiedResidue.is(r) && VerifiedResidue.of(r.residue) !== null;",
      "}",
    ];
    expect(check("server/services/engine.ts", ...code)).toEqual([]);
  });

  it("allows the module itself to construct it", () => {
    expect(check("src/shared/verifiedResidue.ts", "export class VerifiedResidue {", "  static make() { return new VerifiedResidue(); }", "}")).toEqual([]);
  });

  it("ignores a mention in a comment or a string", () => {
    expect(check("server/services/engine.ts", 'const note = "new VerifiedResidue(r)";')).toEqual([]);
    expect(check("server/services/engine.ts", "// never write new VerifiedResidue(residue) here")).toEqual([]);
  });
});
