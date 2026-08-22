import { describe, it, expect } from "vitest";
import {
  translateVariantResponseSchema,
  nearestResiduesRequestSchema,
  nearestResiduesResponseSchema,
  pocketFinderResponseSchema,
  biophysicalAnalysisResponseSchema,
  esmFoldResponseSchema,
  structuralAlignResponseSchema
} from "../contracts";

describe("Shared Zod API Contracts", () => {
  it("should validate translateVariantResponseSchema successfully", () => {
    const validPayload = {
      gene: "BRCA1",
      variant: "p.Asp1692His",
      uniprotId: "P38398",
      transcriptId: "ENST00000357654",
      isManeSelect: true,
      isManePlusClinical: false,
      isCanonical: true,
      maneRefSeqId: "NM_007294.4",
      genomicCoordinates: "17-43106474-G-C"
    };

    const parsed = translateVariantResponseSchema.parse(validPayload);
    expect(parsed.gene).toBe("BRCA1");
    expect(parsed.variant).toBe("p.Asp1692His");

    const invalidPayload = {
      gene: "BRCA1"
      // Missing required fields
    };
    expect(() => translateVariantResponseSchema.parse(invalidPayload)).toThrow();
  });

  it("should validate nearestResiduesRequestSchema with pdbRef or pdbText", () => {
    const validWithRef = nearestResiduesRequestSchema.parse({
      pdbRef: "P00439",
      targetIndex: 408
    });
    expect(validWithRef.pdbRef).toBe("P00439");

    const validWithText = nearestResiduesRequestSchema.parse({
      pdbText: "ATOM...",
      targetIndex: 408
    });
    expect(validWithText.pdbText).toBe("ATOM...");

    expect(() => nearestResiduesRequestSchema.parse({ targetIndex: 408 })).toThrow();
  });

  it("should validate nearestResiduesResponseSchema successfully", () => {
    const validPayload = {
      residues: [
        {
          index: 10,
          name: "GLU",
          distance: 3.5,
          properties: "Polar",
          role: "Salt bridge",
          classBadge: "Charged"
        }
      ],
      source: "computed"
    };

    const parsed = nearestResiduesResponseSchema.parse(validPayload);
    expect(parsed.residues).toHaveLength(1);
    expect(parsed.residues[0].name).toBe("GLU");
  });

  it("should validate pocketFinderResponseSchema successfully", () => {
    const validPayload = {
      pocketResidues: [
        {
          index: 12,
          chain: "A",
          name: "ALA",
          distance: 1.2,
          score: 8.5,
          role: "Hydrophobic core",
          type: "Aliphatic"
        }
      ],
      pocketScore: 8.5,
      pocketVolume: 120.4,
      likelyCofactor: "HEM",
      status: "success" as const
    };

    const parsed = pocketFinderResponseSchema.parse(validPayload);
    expect(parsed.pocketScore).toBe(8.5);
    expect(parsed.status).toBe("success");
  });

  it("should validate biophysicalAnalysisResponseSchema successfully", () => {
    const validPayload = {
      analysis: "Test analysis narrative",
      insights: {
        biochemicalShift: "Charge swap: Positive (Arg) to Neutral (Trp)",
        structuralImpact: "Disrupts salt bridge",
        plausibility: "Plausibly pathogenic",
        acmgCriteria: [
          { code: "PM1", reason: "Hotspot" }
        ]
      }
    };

    const parsed = biophysicalAnalysisResponseSchema.parse(validPayload);
    expect(parsed.analysis).toBe("Test analysis narrative");
    expect(parsed.insights?.biochemicalShift).toBe("Charge swap: Positive (Arg) to Neutral (Trp)");
  });

  it("should normalize flat biophysical response into insights object", () => {
    const flatPayload = {
      biochemicalShift: "Polar to Nonpolar",
      structuralImpact: "Loss of hydrogen bonding"
    };

    const parsed = biophysicalAnalysisResponseSchema.parse(flatPayload);
    expect(parsed.insights).toBeDefined();
    expect(parsed.insights?.biochemicalShift).toBe("Polar to Nonpolar");
    expect(parsed.insights?.structuralImpact).toBe("Loss of hydrogen bonding");
  });

  it("should validate esmFoldResponseSchema successfully", () => {
    const validSinglePayload = {
      pdb: "ATOM 1...",
      chain: "A",
      status: "success" as const
    };

    const parsedSingle = esmFoldResponseSchema.parse(validSinglePayload);
    expect(parsedSingle.pdb).toBe("ATOM 1...");
    expect(parsedSingle.status).toBe("success");

    const validDualPayload = {
      wtPdb: "ATOM 1...",
      mutPdb: "ATOM 2...",
      chain: "A",
      status: "success" as const
    };

    const parsedDual = esmFoldResponseSchema.parse(validDualPayload);
    expect(parsedDual.wtPdb).toBe("ATOM 1...");
    expect(parsedDual.mutPdb).toBe("ATOM 2...");
    expect(parsedDual.chain).toBe("A");
    expect(parsedDual.status).toBe("success");
  });

  it("should validate structuralAlignResponseSchema successfully", () => {
    const validPayload = {
      alignedPdb: "ATOM 1...",
      metrics: { rmsd: 0.45 }
    };

    const parsed = structuralAlignResponseSchema.parse(validPayload);
    expect(parsed.alignedPdb).toBe("ATOM 1...");
  });
});
