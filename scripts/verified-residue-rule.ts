import path from "path";

/**
 * Boundary rule 6: only `src/shared/verifiedResidue.ts` may construct a `VerifiedResidue`.
 *
 * The class has a private constructor, so TypeScript already refuses `new VerifiedResidue(...)` elsewhere,
 * but `new (VerifiedResidue as any)(...)` or `Object.create(VerifiedResidue.prototype)` gets past it. A
 * residue made that way would claim a numbering proof that was never checked
 * (doc/VERIFIED_RESIDUE_DESIGN.md §5). Test files are exempt: they may name the patterns in strings.
 */
const OWN_MODULE = "src/shared/verifiedResidue.ts";
const FORCED_CONSTRUCTION = /new\s*\(?\s*VerifiedResidue\b|VerifiedResidue\s*\.\s*prototype\b/g;

export interface VerifiedResidueViolation {
  file: string;
  line: number;
  importPath: string;
  rule: "ONLY_ITS_MODULE_CONSTRUCTS_VERIFIED_RESIDUE";
  message: string;
}

export function verifiedResidueViolations(
  files: string[],
  rootDir: string,
  readCode: (file: string) => string,
  isTestFile: (file: string) => boolean
): VerifiedResidueViolation[] {
  const violations: VerifiedResidueViolation[] = [];
  for (const file of files) {
    const relative = path.relative(rootDir, file).replace(/\\/g, "/");
    if (relative === OWN_MODULE || isTestFile(file)) continue;
    const code = readCode(file);
    for (const match of code.matchAll(FORCED_CONSTRUCTION)) {
      violations.push({
        file: relative,
        line: code.slice(0, match.index).split("\n").length,
        importPath: match[0],
        rule: "ONLY_ITS_MODULE_CONSTRUCTS_VERIFIED_RESIDUE",
        message: `Only ${OWN_MODULE} may construct a VerifiedResidue ("${match[0]}"). Use VerifiedResidue.of(residue).`,
      });
    }
  }
  return violations;
}

