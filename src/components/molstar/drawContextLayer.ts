import { MolScriptBuilder as MS } from "molstar/lib/mol-script/language/builder";
import { Color } from "molstar/lib/mol-util/color";

/** A neutral grey: the context is background, so it must not read as a colour channel. */
export const CONTEXT_COLOUR = 0x8f98a3;
const CONTEXT_ALPHA = 0.28;

/**
 * Draws the full-length model faintly around a short template. The residues the template covers are left
 * out, so the template's own ribbon is the only one there and the two never overlap. Returns whether a
 * ribbon was built.
 */
export async function drawContextLayer(
  plugin: any,
  pdb: string,
  covered: { start: number; end: number },
  label: string,
): Promise<boolean> {
  const data = await plugin.builders.data.rawData({ data: pdb, label });
  const trajectory = await plugin.builders.structure.parseTrajectory(data, "pdb");
  if (!trajectory) return false;
  const model = await plugin.builders.structure.createModel(trajectory);
  const structure = model ? await plugin.builders.structure.createStructure(model) : null;
  if (!structure) return false;
  const outside = await plugin.builders.structure.tryCreateComponentFromExpression(
    structure,
    MS.struct.generator.atomGroups({
      "entity-test": MS.core.rel.eq([MS.ammp("entityType"), "polymer"]),
      "residue-test": MS.core.logic.not([
        MS.core.rel.inRange([MS.struct.atomProperty.macromolecular.auth_seq_id(), covered.start, covered.end]),
      ]),
    }),
    "context-outside-template",
    { label },
  );
  if (!outside) return false;
  await plugin.builders.structure.representation.addRepresentation(outside, {
    type: "cartoon",
    color: "uniform",
    colorParams: { value: Color(CONTEXT_COLOUR) },
    typeParams: { alpha: CONTEXT_ALPHA },
  });
  return true;
}
