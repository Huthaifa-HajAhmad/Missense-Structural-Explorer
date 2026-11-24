import path from "path";
import { parseSync, visitorKeys } from "oxc-parser";
import type { Node } from "oxc-parser";

/**
 * Boundary rule 6: only `src/shared/verifiedResidue.ts` may construct a `VerifiedResidue`.
 *
 * The class has a private constructor, so TypeScript already refuses `new VerifiedResidue(...)` elsewhere,
 * but `as any`, `Reflect.construct`, an alias or a subclass get past it. A residue made that way would
 * claim a numbering proof that was never checked (doc/VERIFIED_RESIDUE_DESIGN.md §5).
 *
 * The rule reads each file as a syntax tree (comments and strings cannot trigger it) and follows the
 * class under whatever name a file imports it. Outside its own module, the name may only appear:
 *   - in the import itself;
 *   - as a type (`r: VerifiedResidue`);
 *   - as the object of `.of(...)` or `.is(...)`, the two supported entry points.
 * Any other use (an alias, an argument, `extends`, `.prototype`, a re-export) is a violation. Test files
 * are exempt.
 */
const OWN_MODULE = "src/shared/verifiedResidue.ts";
const CLASS_NAME = "VerifiedResidue";
const SUPPORTED_MEMBERS = new Set(["of", "is"]);

export interface VerifiedResidueViolation {
  file: string;
  line: number;
  importPath: string;
  rule: "ONLY_ITS_MODULE_CONSTRUCTS_VERIFIED_RESIDUE";
  message: string;
}

type Loose = Record<string, any>;

function childrenOf(node: Node): Node[] {
  const record = node as unknown as Loose;
  const out: Node[] = [];
  for (const key of visitorKeys[node.type] ?? []) {
    for (const item of [record[key]].flat()) {
      if (item && typeof item === "object" && "type" in item) out.push(item as Node);
    }
  }
  return out;
}

/** The local names this file gives the class (`import { VerifiedResidue as X }` gives "X"). */
function localNames(program: Node): Set<string> {
  const names = new Set<string>();
  for (const statement of (program as Loose).body as Loose[]) {
    if (statement.type !== "ImportDeclaration") continue;
    for (const spec of statement.specifiers as Loose[]) {
      if (spec.type === "ImportSpecifier" && spec.imported?.name === CLASS_NAME) names.add(spec.local.name);
    }
  }
  return names;
}

function isSupportedUse(node: Loose, parent: Loose | null): boolean {
  if (!parent) return false;
  if (parent.type === "ImportSpecifier") return true;
  if (parent.type === "TSTypeReference") return parent.typeName === node;
  return (
    parent.type === "MemberExpression" &&
    parent.object === node &&
    !parent.computed &&
    SUPPORTED_MEMBERS.has(parent.property?.name)
  );
}

function misuses(program: Node, names: Set<string>): Loose[] {
  const found: Loose[] = [];
  const visit = (node: Node, parent: Loose | null): void => {
    const loose = node as unknown as Loose;
    const isReference = loose.type === "Identifier" && names.has(loose.name);
    const isNamespaceMember = loose.type === "MemberExpression" && loose.property?.name === CLASS_NAME;
    if ((isReference && !isSupportedUse(loose, parent)) || isNamespaceMember) found.push(loose);
    for (const child of childrenOf(node)) visit(child, loose);
  };
  visit(program, null);
  return found;
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
    if (!code.includes(CLASS_NAME)) continue;
    const parsed = parseSync(file, code);
    // A file the parser cannot read cannot be checked: fail loudly rather than pass it.
    if (parsed.errors.length > 0) throw new Error(`verified-residue rule: cannot parse ${relative}: ${parsed.errors[0].message}`);
    const names = localNames(parsed.program);
    names.add(CLASS_NAME);
    const lines = new Set(misuses(parsed.program, names).map((node) => code.slice(0, node.start).split("\n").length));
    for (const line of lines) {
      violations.push({
        file: relative,
        line,
        importPath: CLASS_NAME,
        rule: "ONLY_ITS_MODULE_CONSTRUCTS_VERIFIED_RESIDUE",
        message: `Only ${OWN_MODULE} may construct a VerifiedResidue. Outside it, use VerifiedResidue.of(residue), VerifiedResidue.is(value), or the class as a type.`,
      });
    }
  }
  return violations;
}
