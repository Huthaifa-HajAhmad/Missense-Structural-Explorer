/**
 * Observation: interfaces in solved structures (PDBe-KB), split into native, fibril, crystal-packing
 * and set-aside chains.
 *
 * THE DENOMINATOR. `n` is the number of a pair's entries that model the variant residue, not the
 * number that hold the pair. ABCG1 Gly358 read "0 of 5" while none of the five has coordinates for
 * it (doc/INTERFACES_PPI_AUDIT_2026-11-26.md, C1). When PDBe's coverage was not read, `n` falls back
 * to every entry and the trace says so.
 */
import type { MultimerData } from "../contracts.ts";
import { ENGINE_STATE_LABELS } from "../engineStatus.ts";
import { availability, observedLabel, plural } from "./format.ts";
import type { BuildInterfacesInput, InterfacesEvidence, ObservedView } from "./types.ts";

/** Density budget: a handful of set-aside chains are worth showing; more fold behind one line. */
const SET_ASIDE_SHOWN = 4;

function toView(p: NonNullable<MultimerData["experimental"]>["partners"][number], gene: string): ObservedView {
  return {
    ...p,
    label: observedLabel(p, gene),
    key: `solved:${p.accession}:${p.context ?? "native"}`,
    n: p.modelledEntries ? p.modelledEntries.length : p.pdbEntries.length,
    total: p.pdbEntries.length,
    k: p.variantEntries.length,
    maxSupport: p.support.length ? Math.max(...p.support) : 0,
  };
}

/** One row per non-biological chain, whichever entries it came from (PDBe's "Other" spans fibrils and crystals). */
function mergeArtefacts(all: ObservedView[]): ObservedView[] {
  const artefacts: ObservedView[] = [];
  for (const p of all.filter(o => o.artefact)) {
    const seen = artefacts.find(a => a.accession === p.accession);
    if (!seen) {
      artefacts.push({ ...p, key: `solved:${p.accession}:set-aside` });
      continue;
    }
    const entries = [...new Set([...seen.pdbEntries, ...p.pdbEntries])].sort();
    Object.assign(seen, {
      pdbEntries: entries,
      n: entries.length,
      total: entries.length,
      variantAtInterface: seen.variantAtInterface || p.variantAtInterface,
      variantEntries: [...new Set([...seen.variantEntries, ...p.variantEntries])],
    });
  }
  return artefacts;
}

export function readObserved(asmData: MultimerData | null, input: BuildInterfacesInput, gene: string, loading: boolean): InterfacesEvidence["observed"] {
  const exp = asmData?.experimental;
  const all = (exp?.status === "ok" ? exp.partners : []).map(p => toView(p, gene));
  const partners = all.filter(p => !p.artefact && p.context !== "fibril" && p.context !== "crystal");
  const fibrils = all.filter(p => !p.artefact && p.context === "fibril");
  const crystals = all.filter(p => !p.artefact && p.context === "crystal");
  const artefacts = mergeArtefacts(all);
  const availabilityView = availability(
    // A failed assembly service (no payload at all) is a provider failure, not "not read yet".
    exp?.status ?? (input.assemblyStatus === "error" && !asmData ? "failed" : undefined),
    partners.length > 0,
    loading,
    {
      failed: exp && exp.status === "error" && exp.reason ? exp.reason : "PDBe did not answer, so solved structures were not checked.",
      empty: `PDBe records no protein–protein interface for ${gene} in any solved structure.`,
      unknown: "Solved structures have not been read for this variant yet.",
    }
  );
  if (availabilityView.state === "ok" && partners.length === 0 && (artefacts.length || fibrils.length || crystals.length)) {
    const nonNative = [fibrils.length ? "amyloid fibril stacking" : null, crystals.length ? "contacts outside a deposited monomer assembly" : null].filter(Boolean);
    Object.assign(availabilityView, {
      state: "empty",
      label: ENGINE_STATE_LABELS["no-result"],
      reason: nonNative.length
        ? `Solved structures of ${gene} show no native interface with another protein; only ${nonNative.join(" and ")}${artefacts.length ? ", and non-biological partners" : ""}.`
        : `The only interfaces in solved structures of ${gene} are with construct tags, antibodies or unmapped chains, which are not counted.`,
    });
  }
  return {
    availability: availabilityView,
    partners,
    fibrils,
    crystals,
    artefacts,
    artefactsShown: artefacts.slice(0, SET_ASIDE_SHOWN),
    artefactsFold: artefacts.length > SET_ASIDE_SHOWN
      ? { rows: artefacts.slice(SET_ASIDE_SHOWN), summary: `${plural(artefacts.length - SET_ASIDE_SHOWN, "more chain")} set aside: construct tags, tool binders or unmapped chains, not biological and not counted` }
      : null,
    fibrilsChecked: exp?.status !== "ok" || exp.entryKinds !== "failed",
    coverageChecked: exp?.status !== "ok" || exp.coverageChecked !== false,
  };
}
