/**
 * server/services/multimer.ts — Quaternary multimer complex analysis & Boltz-2 folding service.
 *
 * Dedicated strictly to whole-complex and multimeric assembly modeling:
 * - Parses curated UniProt SUBUNIT annotations for oligomeric stoichiometry (homotetramers, dimers, etc.)
 * - Triggers JapanFold Tier-1 Boltz-2 / OpenFold3 multi-chain folding
 * - Maps inter-chain interface contacts across subunit boundaries
 */

import { fetchUniprotSequence, fetchUniprotFeatures } from "./uniprot.ts";
import { queryBoltz2Multimer } from "./japanfold-client.ts";
import { applyMutation, parseMutationParam } from "../utils/mutation.ts";
import { sanitizeErrorMessage } from "../utils/security.ts";

export interface MultimerAnalysisResult {
  status: "success" | "monomeric" | "failed";
  gene: string;
  uniprotId: string;
  oligomericState: string;
  chainCount: number;
  chainIds: string[];
  complexPdb: string | null;
  ipTm: number | null;
  pTm: number | null;
  interfaceContacts: Array<{ resA: number; resB: number; distance: number }>;
  mutationInterfaceDisrupted: boolean;
  provenance: string;
  subunitComment?: string | null;
  error?: string;
}

export function parseOligomericState(subunitComment: string | null | undefined): {
  state: string;
  chainCount: number;
  isMultimer: boolean;
  isHeteromer: boolean;
} {
  if (!subunitComment) {
    return { state: "Monomer (Single Chain)", chainCount: 1, isMultimer: false, isHeteromer: false };
  }

  const comment = subunitComment.toLowerCase();
  if (comment.includes("heterotetramer")) {
    return { state: "Heterotetramer", chainCount: 4, isMultimer: true, isHeteromer: true };
  }
  if (comment.includes("heterodimer") || comment.includes("hetero")) {
    return { state: "Heterodimer", chainCount: 2, isMultimer: true, isHeteromer: true };
  }
  if (comment.includes("homotetramer") || comment.includes("tetramer")) {
    return { state: "Homotetramer (A4)", chainCount: 4, isMultimer: true, isHeteromer: false };
  }
  if (comment.includes("homohexamer") || comment.includes("hexamer")) {
    return { state: "Homohexamer (A6)", chainCount: 6, isMultimer: true, isHeteromer: false };
  }
  if (comment.includes("homotrimer") || comment.includes("trimer")) {
    return { state: "Homotrimer (A3)", chainCount: 3, isMultimer: true, isHeteromer: false };
  }
  if (comment.includes("homodimer") || comment.includes("dimer")) {
    return { state: "Homodimer (A2)", chainCount: 2, isMultimer: true, isHeteromer: false };
  }
  if (comment.includes("oligomer") || comment.includes("complex")) {
    return { state: "Oligomeric Complex (A2)", chainCount: 2, isMultimer: true, isHeteromer: false };
  }

  return { state: "Monomer (Single Chain)", chainCount: 1, isMultimer: false, isHeteromer: false };
}

export async function analyzeMultimerStructure(
  gene: string,
  variant: string,
  uniprotId: string,
  signal?: AbortSignal
): Promise<MultimerAnalysisResult> {
  try {
    const [features, sequence] = await Promise.all([
      fetchUniprotFeatures(uniprotId),
      fetchUniprotSequence(uniprotId)
    ]);

    const subunitComment = features?.subunitComment || null;
    const oligomer = parseOligomericState(subunitComment);

    if (!oligomer.isMultimer || oligomer.chainCount <= 1) {
      return {
        status: "monomeric",
        gene,
        uniprotId,
        oligomericState: oligomer.state,
        chainCount: 1,
        chainIds: ["A"],
        complexPdb: null,
        ipTm: null,
        pTm: null,
        interfaceContacts: [],
        mutationInterfaceDisrupted: false,
        provenance: "UniProt Curated (Monomeric)",
        subunitComment
      };
    }

    if (oligomer.isHeteromer) {
      return {
        status: "failed",
        gene,
        uniprotId,
        oligomericState: oligomer.state,
        chainCount: oligomer.chainCount,
        chainIds: ["A", "B"],
        complexPdb: null,
        ipTm: null,
        pTm: null,
        interfaceContacts: [],
        mutationInterfaceDisrupted: false,
        provenance: "UniProt Curated (Heteromer)",
        subunitComment,
        error: "Heteromeric complex modeling requires partner subunit sequence identification; automatic sequence cloning prohibited."
      };
    }

    // Build chains array (max 4 chains for performance / memory bounds)
    const activeChainsCount = Math.min(oligomer.chainCount, 4);
    const chainLetters = ["A", "B", "C", "D"].slice(0, activeChainsCount);

    let mutSequence = sequence;
    let pos = 0;
    const parsedMut = parseMutationParam(variant);
    if (parsedMut && parsedMut.wtLetter && parsedMut.mutLetter && parsedMut.posNum) {
      pos = parsedMut.posNum;
      if (sequence.length >= pos) {
        try {
          mutSequence = applyMutation(sequence, {
            chain: "A",
            position: pos,
            wt: parsedMut.wtLetter,
            mt: parsedMut.mutLetter
          });
        } catch {
          mutSequence = sequence;
        }
      }
    }

    // Chain A carries the mutation, partner chains carry wild-type
    const chainsPayload = chainLetters.map((c, idx) => ({
      chainId: c,
      sequence: idx === 0 ? mutSequence : sequence
    }));

    // Tier 1: Query JapanFold Boltz-2
    const boltzResult = await queryBoltz2Multimer(chainsPayload, signal);

    if (boltzResult && boltzResult.status === "success") {
      const isDisrupted = boltzResult.interfaceContacts.some(
        c => Math.abs(c.resA - pos) <= 4 || Math.abs(c.resB - pos) <= 4
      );

      return {
        status: "success",
        gene,
        uniprotId,
        oligomericState: oligomer.state,
        chainCount: activeChainsCount,
        chainIds: chainLetters,
        complexPdb: boltzResult.complexPdb,
        ipTm: boltzResult.ipTm,
        pTm: boltzResult.pTm,
        interfaceContacts: boltzResult.interfaceContacts,
        mutationInterfaceDisrupted: isDisrupted,
        provenance: boltzResult.provenance,
        subunitComment
      };
    }

    return {
      status: "failed",
      gene,
      uniprotId,
      oligomericState: oligomer.state,
      chainCount: activeChainsCount,
      chainIds: chainLetters,
      complexPdb: null,
      ipTm: null,
      pTm: null,
      interfaceContacts: [],
      mutationInterfaceDisrupted: false,
      provenance: "JapanFold Boltz-2 (Offline/Timeout)",
      subunitComment,
      error: "JapanFold multimer prediction service currently unavailable."
    };
  } catch (err: any) {
    return {
      status: "failed",
      gene,
      uniprotId,
      oligomericState: "Unknown",
      chainCount: 1,
      chainIds: ["A"],
      complexPdb: null,
      ipTm: null,
      pTm: null,
      interfaceContacts: [],
      mutationInterfaceDisrupted: false,
      provenance: "Error",
      error: sanitizeErrorMessage(err)
    };
  }
}
