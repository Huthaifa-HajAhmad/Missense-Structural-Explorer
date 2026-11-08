import { SecondaryStructureProvider } from "molstar/lib/mol-model-props/computed/secondary-structure";
import { Model, Structure, StructureElement, StructureProperties, StructureSelection, Unit } from "molstar/lib/mol-model/structure";
import { Segmentation } from "molstar/lib/mol-data/int";
import { SyncRuntimeContext } from "molstar/lib/mol-task/execution/synchronous";
import { MolScriptBuilder as MS } from "molstar/lib/mol-script/language/builder";
import { Script } from "molstar/lib/mol-script/script";
import type { PluginContext } from "molstar/lib/mol-plugin/context";
import type { Vec3 } from "molstar/lib/mol-math/linear-algebra";
import { classifySecondaryFlags, segmentsFromResidues, type ModelSecondary, type SecondaryClass } from "../../shared/structureSecondary";

/**
 * Reads the secondary structure Mol* assigned to a drawn structure: the same property its cartoon
 * and its "secondary-structure" colour theme use, so the rail's words match the canvas.
 *
 * Mol*'s automatic choice: `getModelSecondaryStructure` (computed/secondary-structure.ts) uses the
 * deposited HELIX/SHEET records only for experimental mmCIF archive input; for PDB text — what this
 * app loads — it runs DSSP even on a deposited entry. `source` reports the branch Mol* took, not what
 * the file contained. The first protein chain is read, the chain the app's residue numbers address;
 * insertion-code residues are skipped, as in `indexStructureResidues`.
 */
export async function readModelSecondary(plugin: PluginContext, structure: Structure): Promise<ModelSecondary | null> {
  await SecondaryStructureProvider.attach({ runtime: SyncRuntimeContext, assetManager: plugin.managers.asset, errorContext: plugin.errorContext }, structure);
  const value = SecondaryStructureProvider.get(structure).value;
  if (!value) return null;
  const location = StructureElement.Location.create(structure);
  const residues: Array<{ position: number; cls: SecondaryClass }> = [];
  let chain: string | null = null;
  let fromFile = false;
  for (const unit of structure.units) {
    if (!Unit.isAtomic(unit)) continue;
    const assigned = value.get(unit.invariantId);
    if (!assigned) continue;
    const segments = Segmentation.transientSegments(unit.model.atomicHierarchy.residueAtomSegments, unit.elements);
    while (segments.hasNext) {
      const { start } = segments.move();
      location.unit = unit;
      location.element = unit.elements[start];
      if (StructureProperties.entity.type(location) !== "polymer") continue;
      const residueChain = StructureProperties.chain.auth_asym_id(location);
      chain ??= residueChain;
      if (residueChain !== chain || StructureProperties.residue.pdbx_PDB_ins_code(location).trim()) continue;
      const index = assigned.getIndex(unit.residueIndex[location.element]);
      const flags = index < assigned.type.length ? assigned.type[index] : undefined;
      // An out-of-range index must not become `0 & beta === 0` → "coil" and enter the denominator.
      if (typeof flags !== "number") continue;
      residues.push({ position: StructureProperties.residue.auth_seq_id(location), cls: classifySecondaryFlags(flags) });
      fromFile ||= Model.isFromPdbArchive(unit.model) && Model.isExperimental(unit.model) && !Model.isCoarseGrained(unit.model)
        || Model.hasSecondaryStructure(unit.model);
    }
  }
  if (!chain || residues.length === 0) return null;
  return { source: fromFile ? "file" : "dssp", chain, residueCount: residues.length, segments: segmentsFromResidues(residues) };
}

/**
 * World position of a residue's Cα (its centre when it has no Cα), or null when absent. `chain`
 * narrows a multi-chain model: selecting on `auth_seq_id` alone across chains would return the
 * midpoint between two unrelated residues and leave the leader line in empty space.
 */
export function residueAnchor(structure: Structure, position: number, chain?: string | null): Vec3 | null {
  const tests: Parameters<typeof MS.struct.generator.atomGroups>[0] = {
    "residue-test": MS.core.rel.eq([MS.struct.atomProperty.macromolecular.auth_seq_id(), position]),
  };
  if (chain) tests["chain-test"] = MS.core.rel.eq([MS.struct.atomProperty.macromolecular.auth_asym_id(), chain]);
  const residue = MS.struct.generator.atomGroups(tests);
  const ca = MS.struct.modifier.wholeResidues({ 0: residue });
  const caOnly = MS.struct.generator.atomGroups({
    ...tests,
    "atom-test": MS.core.rel.eq([MS.struct.atomProperty.macromolecular.label_atom_id(), "CA"]),
  });
  for (const expression of [caOnly, ca]) {
    const loci = StructureSelection.toLociWithSourceUnits(Script.getStructureSelection(expression, structure));
    if (StructureElement.Loci.isEmpty(loci)) continue;
    return StructureElement.Loci.getBoundary(loci).sphere.center;
  }
  return null;
}
