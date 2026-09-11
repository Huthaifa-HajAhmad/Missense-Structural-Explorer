import { describe, it, expect } from "vitest";
import {
  translateVariantResponseSchema,
  nearestResiduesRequestSchema,
  nearestResiduesResponseSchema,
  pocketFinderResponseSchema,
  biophysicalAnalysisResponseSchema,
  esmFoldResponseSchema,
  structuralAlignResponseSchema,
  clinVarDataSchema,
  energeticsDataSchema,
  generateMutantResponseSchema,
  analyzeVariantResponseSchema
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

  it("should validate pocketFinderResponseSchema with unavailable and none_detected statuses", () => {
    const unavailablePayload = {
      pocketResidues: [],
      pocketScore: 0,
      pocketVolume: 0,
      likelyCofactor: "None",
      status: "unavailable",
      pocketDistance: null
    };
    const parsedUnavailable = pocketFinderResponseSchema.parse(unavailablePayload);
    expect(parsedUnavailable.status).toBe("unavailable");

    const noneDetectedPayload = {
      pocketResidues: [],
      pocketScore: 0,
      pocketVolume: 0,
      likelyCofactor: "None",
      status: "none_detected",
      pocketDistance: null
    };
    const parsedNoneDetected = pocketFinderResponseSchema.parse(noneDetectedPayload);
    expect(parsedNoneDetected.status).toBe("none_detected");

    // Unexpected status should safely default to "unavailable" via catch
    const unexpectedPayload = {
      ...unavailablePayload,
      status: "unexpected_status_from_future_engine"
    };
    const parsedUnexpected = pocketFinderResponseSchema.parse(unexpectedPayload);
    expect(parsedUnexpected.status).toBe("unavailable");
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

  it("should validate clinVarDataSchema successfully", () => {
    const validPayload = {
      classification: "Pathogenic",
      lastEvaluated: "2024-01-01",
      reviewStatus: "criteria provided, single submitter",
      alleleFrequencies: [{ source: "gnomAD", value: 0.0001 }],
      trait: "Phenylketonuria",
      uid: "123456"
    };

    const parsed = clinVarDataSchema.parse(validPayload);
    expect(parsed.classification).toBe("Pathogenic");
    expect(parsed.uid).toBe("123456");
  });

  it("should validate energeticsDataSchema successfully", () => {
    const validPayload = {
      foldx: 2.34,
      foldxMean: 2.30,
      foldxSd: 0.12,
      dynamut2: -0.45,
      ddmut: 1.2,
      consensusVerdict: "High Misfolding Risk"
    };

    const parsed = energeticsDataSchema.parse(validPayload);
    expect(parsed.foldx).toBe(2.34);
    expect(parsed.dynamut2).toBe(-0.45);
    expect(parsed.consensusVerdict).toBe("High Misfolding Risk");

    // Test with nullable foldxError and binary flags
    const withErrorPayload = energeticsDataSchema.parse({
      foldx: null,
      foldxRepairFailed: true,
      foldxBinaryMissing: false,
      foldxError: null,
      stabilityoracle: null,
      consensusVerdict: "Insufficient Biophysical Data"
    });
    expect(withErrorPayload.foldxError).toBeNull();
    expect(withErrorPayload.foldxRepairFailed).toBe(true);
    expect(withErrorPayload.stabilityoracle).toBeNull();

    const withErrorStringPayload = energeticsDataSchema.parse({
      foldx: null,
      foldxRepairFailed: false,
      foldxBinaryMissing: true,
      foldxError: "FoldX binary not found at tools/foldx/foldx.exe"
    });
    expect(withErrorStringPayload.foldxBinaryMissing).toBe(true);
    expect(withErrorStringPayload.foldxError).toContain("FoldX binary not found");
  });

  it("should validate generateMutantResponseSchema successfully", () => {
    const validPayload = {
      pdb: "ATOM...",
      ddG: 1.5,
      status: "success",
      foldxJobId: "job-123",
      dynamut2JobId: "55555",
      dynamut2Status: "pending",
      ddmutJobId: "66666",
      ddmutStatus: "pending"
    };

    const parsed = generateMutantResponseSchema.parse(validPayload);
    expect(parsed.status).toBe("success");
    expect(parsed.dynamut2JobId).toBe("55555");
    expect(parsed.ddmutJobId).toBe("66666");
  });

  it("should validate analyzeVariantResponseSchema with serviceTimings successfully", () => {
    const validPayload = {
      analysis: "Test narrative",
      metadata: {
        gene: "TP53",
        variant: "p.Arg175His",
        uniprotId: "P04637",
        residueIndex: 175,
        wildType: "R",
        mutant: "H",
        serviceTimings: {
          clinvar: 210,
          predictorData: 480,
          pdbMapping: 190
        },
        serviceStatus: {
          clinvar: "ok",
          predictorData: "ok",
          pdbMapping: "ok"
        }
      },
      serviceTimings: {
        clinvar: 210,
        predictorData: 480,
        pdbMapping: 190
      },
      serviceStatus: {
        clinvar: "ok",
        predictorData: "ok",
        pdbMapping: "ok"
      }
    };

    const parsed = analyzeVariantResponseSchema.parse(validPayload);
    expect(parsed.serviceTimings?.clinvar).toBe(210);
    expect(parsed.metadata.serviceTimings?.predictorData).toBe(480);
    expect(parsed.serviceStatus?.pdbMapping).toBe("ok");
  });
});
