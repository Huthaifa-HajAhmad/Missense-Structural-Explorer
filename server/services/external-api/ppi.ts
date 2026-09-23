/**
 * server/services/ppi.ts
 *
 * Protein-Protein Interaction (PPI) & Interface Binding Affinity Service.
 * - Resolves STRING-db functional interaction partners
 * - Maps UniProt curated interface residues
 * - Computes interface binding affinity shifts (ΔΔG_bind) via JapanFold OpenBind-0
 */
import { fetchStringInteractionsWithStatus, StringInteraction } from "./string.ts";
import { queryOpenBind, JapanFoldBindingResult } from "./japanfold-client.ts";
import { fetchUniprotFeatures } from "./uniprot.ts";
import { evaluateDdmutPpi } from "../stability/ddmut-ppi.ts";

/** How one upstream lookup for a PPI section ended. */
export type PpiLookupStatus = "ok" | "failed" | "skipped";

export interface PpiBindingAffinityResult {
  status: "success" | "unavailable" | "failed";
  gene: string;
  variant: string;
  uniprotId?: string;
  stringPartners: StringInteraction[];
  bindingShift: {
    ddgBind: number | null;
    unit: string;
    classification: "INTERFACE_DISRUPTIVE" | "ALLOSTERIC_PERTURBATION" | "SURFACE_NEUTRAL" | "UNKNOWN";
    provenance: string;
    distanceToInterface?: number | null;
  } | null;
  interfaceResidues: Array<{
    pos: number;
    description: string;
    isVariantPosition: boolean;
  }>;
  /**
   * Outcome of each independent lookup, so a consumer can tell an empty answer
   * from no answer at all.
   *
   * Both sections used to return an empty array for every non-answer: the STRING
   * fetcher caught its own error and returned `[]`, and a UniProt request that
   * failed returned `null` from inside a `try` that only logged. The PPI tab
   * rendered those as "no association for this gene" and "no residue-level
   * interface annotation is recorded" — claims about the protein, made on the
   * strength of a failed HTTP call. `skipped` is the third case the tab could not
   * see either: no UniProt id was resolved, so nothing was ever asked.
   */
  lookups: {
    stringPartners: Exclude<PpiLookupStatus, "skipped">;
    interfaceResidues: PpiLookupStatus;
  };
  error?: string;
}

import { parseMutationParam } from "../../utils/mutation.ts";

export async function analyzePpiBinding(
  gene: string,
  variant: string,
  uniprotId?: string,
  wtPdb?: string | null,
  mutPdb?: string | null,
  chainA: string = "A",
  chainB: string = "B",
  signal?: AbortSignal
): Promise<PpiBindingAffinityResult> {
  // Parse variant position & single-letter mutation code upfront
  let pos = 0;
  const parsedMut = parseMutationParam(variant);
  if (parsedMut && parsedMut.posNum) {
    pos = parsedMut.posNum;
  }

  // 1. Concurrent Task: STRING partners lookup
  const stringTask = (async (): Promise<{ partners: StringInteraction[]; status: Exclude<PpiLookupStatus, "skipped"> }> => {
    try {
      const stringResult = await fetchStringInteractionsWithStatus(gene);
      return { partners: stringResult.partners, status: stringResult.status };
    } catch (err: any) {
      console.warn(`[PPI Service] STRING lookup threw for ${gene}:`, err?.message);
      return { partners: [], status: "failed" };
    }
  })();

  // 2. Concurrent Task: Curated interface annotations from UniProt
  const interfaceTask = (async (): Promise<{ residues: Array<{ pos: number; description: string; isVariantPosition: boolean }>; status: PpiLookupStatus }> => {
    const residues: Array<{ pos: number; description: string; isVariantPosition: boolean }> = [];
    let status: PpiLookupStatus = "skipped";

    if (uniprotId) {
      status = "failed";
      try {
        const featuresResult = await fetchUniprotFeatures(uniprotId);
        if (featuresResult) {
          status = "ok";
          for (const feat of featuresResult.features ?? []) {
            const typeLower = (feat.type || "").toLowerCase();
            const descLower = (feat.description || "").toLowerCase();

            // Exclude catalytic active sites, metal coordination, and generic structural regions
            const isExcluded =
              typeLower.includes("active site") ||
              typeLower.includes("metal binding") ||
              typeLower === "site" ||
              typeLower === "region";

            // Strictly match quaternary / PPI subunit interface annotations
            const isInterface =
              !isExcluded &&
              (descLower.includes("interface") ||
                descLower.includes("subunit") ||
                descLower.includes("inter-chain") ||
                descLower.includes("complex interaction") ||
                (typeLower === "binding site" && (descLower.includes("chain") || descLower.includes("hetero") || descLower.includes("homo"))));

            if (isInterface) {
              const matchesVariant = pos >= feat.start && pos <= feat.end;
              if (matchesVariant || residues.length < 5) {
                residues.push({
                  pos: feat.start,
                  description: feat.description || feat.type,
                  isVariantPosition: matchesVariant
                });
              }
            }
          }
        }
      } catch (err: any) {
        console.warn(`[PPI Service] Failed to fetch UniProt features for ${uniprotId}:`, err.message);
      }
    }

    return { residues, status };
  })();

  // 3. Concurrent Task: Interface Binding Affinity Shift (ΔΔG_bind)
  const bindingShiftTask = (async (): Promise<PpiBindingAffinityResult["bindingShift"]> => {
    if (wtPdb && mutPdb && chainA.toUpperCase() !== chainB.toUpperCase()) {
      // Tier 1: Query OpenBind-0 when both WT and genuinely modeled mutant complex coordinates exist
      try {
        const openBindResult = await queryOpenBind(wtPdb, mutPdb, chainA, chainB, signal);
        if (openBindResult && openBindResult.status === "success") {
          return {
            ddgBind: openBindResult.ddgBind,
            unit: openBindResult.unit,
            classification: openBindResult.classification,
            provenance: openBindResult.provenance
          };
        }
      } catch (err: any) {
        console.warn(`[PPI Service] OpenBind-0 evaluation error: ${err.message}`);
      }
    } else if (wtPdb && !mutPdb) {
      // Tier 2: Query DDMut-PPI when wild-type complex PDB is available without a modeled mutant structure
      try {
        const mutationCode = parsedMut?.wtLetter && parsedMut?.mutLetter && parsedMut?.posNum
          ? `${parsedMut.wtLetter}${parsedMut.posNum}${parsedMut.mutLetter}`
          : variant.replace(/^p\./, "");
        const ddmutPpiResult = await evaluateDdmutPpi(wtPdb, chainA, mutationCode, 20000, signal);
        if (ddmutPpiResult) {
          return {
            ddgBind: ddmutPpiResult.ddgBind,
            unit: "kcal/mol",
            classification: ddmutPpiResult.classification,
            provenance: ddmutPpiResult.provenance,
            distanceToInterface: ddmutPpiResult.distanceToInterface
          };
        }
      } catch (err: any) {
        console.warn(`[PPI Service] DDMut-PPI evaluation error: ${err.message}`);
      }
    }
    return null;
  })();

  const [stringRes, interfaceRes, bindingShift] = await Promise.all([
    stringTask,
    interfaceTask,
    bindingShiftTask
  ]);

  return {
    status: "success",
    gene,
    variant,
    uniprotId,
    stringPartners: stringRes.partners,
    bindingShift,
    interfaceResidues: interfaceRes.residues,
    lookups: {
      stringPartners: stringRes.status,
      interfaceResidues: interfaceRes.status
    }
  };
}
