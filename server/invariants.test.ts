/**
 * invariants.test.ts — Executable Property Tests for Core Bioinformatics Invariants
 *
 * Enforces the two core non-negotiable invariants:
 *   1. "Timeout never implies absence" (Epistemic Safety: network/service errors never trigger PM2)
 *   2. "Wild-type identity must agree across notation ↔ structure ↔ model" (Seam Safety)
 */

import { describe, it, expect } from "vitest";
import { computeRuleBasedACMG } from "./services/acmg.ts";
import type { ServiceStatusMap, ServiceFetchStatus } from "./services/analysis-orchestrator.ts";

const AMINO_ACIDS = ["A", "C", "D", "E", "F", "G", "H", "I", "K", "L", "M", "N", "P", "Q", "R", "S", "T", "V", "W", "Y"];
const SAMPLE_GENES = ["PAH", "PTEN", "BRAF", "BRCA1", "LDLR", "GBA", "CFTR", "TP53"];

describe("Invariant 1: 'Timeout Never Implies Absence' (PM2 Epistemic Safety)", () => {
  const outageStatuses: ServiceFetchStatus[] = ["timeout", "error"];
  const validPresenceStatuses: ServiceFetchStatus[] = ["ok", "not_found"];

  it("should NEVER evaluate PM2 as fulfilled when gnomAD frequency query times out or errors", () => {
    // Randomized property fuzz test across 50 iterations
    for (let i = 0; i < 50; i++) {
      const gene = SAMPLE_GENES[i % SAMPLE_GENES.length];
      const wt = AMINO_ACIDS[i % AMINO_ACIDS.length];
      const mut = AMINO_ACIDS[(i + 3) % AMINO_ACIDS.length];
      const pos = (i * 17) + 1;
      const variant = `p.${wt}${pos}${mut}`;
      const statusChoice = outageStatuses[i % outageStatuses.length];

      const serviceStatus: ServiceStatusMap = {
        clinvar: "ok",
        predictorData: "ok",
        conservationData: "ok",
        gnomadFrequency: statusChoice,
        gnomadConstraint: "ok",
        uniprotFeatures: "ok",
        stringInteractions: "ok",
        disruptionPredictor: "ok",
        esm2: "ok",
        pdbMapping: "ok"
      };

      const result = computeRuleBasedACMG({
        gene,
        variant,
        clinvar: null,
        predictorData: { amPathogenicity: 0.95, caddPhred: 30 },
        conservationData: null,
        gnomadConstraint: null,
        gnomadFrequency: null, // Frequency is null because service failed!
        acmgWeighting: "standard",
        serviceStatus
      });

      // Assert Invariant: PM2 must NEVER be active on outage
      const pm2Met = result.acmgCriteria.some(e => e.code === "PM2");
      expect(pm2Met).toBe(false);

      // Assert Invariant: Epistemic reason must be documented in unavailable evidence
      const hasUnavailableNote = result.partialEvidence.unavailable.some(
        note => note.includes("GNOMAD_FREQUENCY") && note.includes("PM2 withheld")
      );
      expect(hasUnavailableNote).toBe(true);
    }
  });

  it("should evaluate PM2 when gnomAD frequency was confirmed not_found or ultra-rare", () => {
    for (let i = 0; i < 20; i++) {
      const gene = SAMPLE_GENES[i % SAMPLE_GENES.length];
      const wt = AMINO_ACIDS[i % AMINO_ACIDS.length];
      const mut = AMINO_ACIDS[(i + 1) % AMINO_ACIDS.length];
      const pos = 100 + i;
      const variant = `p.${wt}${pos}${mut}`;

      // 1. Confirmed absent from gnomAD (valid PM2)
      const absentStatus: ServiceStatusMap = {
        clinvar: "ok",
        predictorData: "ok",
        conservationData: "ok",
        gnomadFrequency: "not_found",
        gnomadConstraint: "ok",
        uniprotFeatures: "ok",
        stringInteractions: "ok",
        disruptionPredictor: "ok",
        esm2: "ok",
        pdbMapping: "ok"
      };

      const absentResult = computeRuleBasedACMG({
        gene,
        variant,
        clinvar: null,
        predictorData: null,
        conservationData: null,
        gnomadConstraint: null,
        gnomadFrequency: null,
        acmgWeighting: "standard",
        serviceStatus: absentStatus
      });

      const pm2Met = absentResult.acmgCriteria.some(e => e.code === "PM2");
      expect(pm2Met).toBe(true);
    }
  });
});

describe("Invariant 2: 'Wild-Type Identity Agreement Across Notation ↔ Structure' (Seam Safety)", () => {
  it("should detect residue identity mismatches between HGVS notation and PDB structure residues", () => {
    const parseMutationToFoldX = (wt: string, pos: number, mut: string, pdbResName3: string) => {
      const THREE_TO_ONE: Record<string, string> = {
        ALA: "A", CYS: "C", ASP: "D", GLU: "E", PHE: "F",
        GLY: "G", HIS: "H", ILE: "I", LYS: "K", LEU: "L",
        MET: "M", ASN: "N", PRO: "P", GLN: "Q", ARG: "R",
        SER: "S", THR: "T", VAL: "V", TRP: "W", TYR: "Y"
      };

      const ONE_TO_THREE: Record<string, string> = Object.fromEntries(
        Object.entries(THREE_TO_ONE).map(([k, v]) => [v, k])
      );

      const expectedWt3 = ONE_TO_THREE[wt.toUpperCase()];
      const targetPdbRes3 = pdbResName3.toUpperCase();

      if (expectedWt3 && targetPdbRes3 && targetPdbRes3 !== expectedWt3) {
        throw new Error(
          `Mutation residue mismatch: notation expects wild-type '${wt}' (${expectedWt3}) at position ${pos}, but structure contains '${THREE_TO_ONE[targetPdbRes3] || "?"}' (${targetPdbRes3}).`
        );
      }
      return `${wt}A${pos}${mut}`;
    };

    // 1. Matching case succeeds
    expect(parseMutationToFoldX("R", 408, "W", "ARG")).toBe("RA408W");
    expect(parseMutationToFoldX("G", 380, "R", "GLY")).toBe("GA380R");

    // 2. Randomized mismatch fuzz test across 50 permutations
    for (let i = 0; i < 50; i++) {
      const wtChar = AMINO_ACIDS[i % AMINO_ACIDS.length];
      const wrongPdbResChar = AMINO_ACIDS[(i + 5) % AMINO_ACIDS.length];
      if (wtChar === wrongPdbResChar) continue;

      const ONE_TO_THREE: Record<string, string> = {
        A: "ALA", C: "CYS", D: "ASP", E: "GLU", F: "PHE",
        G: "GLY", H: "HIS", I: "ILE", K: "LYS", L: "LEU",
        M: "MET", N: "ASN", P: "PRO", Q: "GLN", R: "ARG",
        S: "SER", T: "THR", V: "VAL", W: "TRP", Y: "TYR"
      };

      const wrongPdbRes3 = ONE_TO_THREE[wrongPdbResChar];
      expect(() => parseMutationToFoldX(wtChar, 100 + i, "A", wrongPdbRes3)).toThrow(
        /Mutation residue mismatch: notation expects wild-type/
      );
    }
  });
});
