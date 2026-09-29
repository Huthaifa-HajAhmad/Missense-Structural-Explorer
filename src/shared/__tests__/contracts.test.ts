import { describe, it, expect } from "vitest";
import {
  translateVariantResponseSchema,
  coordinateLiftSchema,
  isBuildDegradedResult,
  predictorCoordinateFromContext,
  parseGenomicCoordinateString,
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

  /**
   * The build trail must survive the wire in both directions: a response carrying it, and the
   * analysis request echoing it back. Both are optional, so a client that predates lift-first keeps
   * working unchanged.
   */
  it("carries the coordinate-lift trail through the translate contract", () => {
    const lifted = translateVariantResponseSchema.parse({
      gene: "INTS11",
      variant: "p.Arg17Leu",
      uniprotId: "Q5TA45",
      assembly: "GRCh37",
      resolvedAssembly: "GRCh38",
      genomicCoordinates: "1-1256452-C-A",
      liftedGenomicCoordinates: "1-1321072-C-A",
      coordinateLift: {
        status: "lifted",
        fromAssembly: "GRCh37",
        toAssembly: "GRCh38",
        fromCoordinates: "1-1256452-C-A",
        toCoordinates: "1-1321072-C-A",
        reverseVerified: true,
      },
    });

    expect(lifted.assembly).toBe("GRCh37");
    expect(lifted.resolvedAssembly).toBe("GRCh38");
    expect(lifted.coordinateLift?.status).toBe("lifted");
    // `reverseVerified` is the field a reader keys on, so it must be expressible.
    expect(lifted.coordinateLift?.reverseVerified).toBe(true);

    // An un-liftable coordinate states the submitted build on both sides, plus WHY.
    const unlifted = coordinateLiftSchema.parse({
      status: "unavailable",
      fromAssembly: "GRCh37",
      toAssembly: "GRCh37",
      reason: "the coordinate could not be verified on the GRCh38 reference",
    });
    expect(unlifted.toAssembly).toBe("GRCh37");

    // Unknown statuses are refused rather than rendered as an unexplained blank.
    expect(() => coordinateLiftSchema.parse({ status: "maybe", fromAssembly: "GRCh37", toAssembly: "GRCh37" })).toThrow();
  });

  /**
   * The cache guard for a build-degraded verdict.
   *
   * Observed in production, from the Recents menu: a bundle written when a GRCh37 coordinate could not
   * be lifted was replayed for the same protein notation, showing an older coordinate chip, an older
   * target build and "PM2 withheld — this coordinate's build is not one gnomAD r4 serves" — while a
   * fresh run of the same variant lifts that coordinate and scores PM2. The key is build-free by
   * design, so the RESULT has to declare when it is not worth serving.
   *
   * The retryable/definitive split matters here too: an unanswered map is worth re-attempting, a
   * reference discontinuity is a fact, and re-running it would spend a ladder to hear the same answer.
   */
  it("identifies a build-degraded result, and leaves every settled one alone", () => {
    const refusedLift = (reasonCode?: string) => ({
      status: "unavailable" as const,
      fromAssembly: "GRCh37" as const,
      toAssembly: "GRCh37" as const,
      ...(reasonCode ? { reasonCode: reasonCode as any } : {}),
    });

    // A refused lift that another attempt could change — or one whose cause predates `reasonCode`.
    expect(isBuildDegradedResult({ coordinateLift: refusedLift("map-unavailable") })).toBe(true);
    expect(isBuildDegradedResult({ coordinateLift: refusedLift("budget-exceeded") })).toBe(true);
    expect(isBuildDegradedResult({ coordinateLift: refusedLift() })).toBe(true);
    // A reference discontinuity is permanent: serving its bundle is right.
    expect(isBuildDegradedResult({ coordinateLift: refusedLift("reference-discontinuity") })).toBe(false);
    expect(isBuildDegradedResult({ coordinateLift: refusedLift("no-mapping") })).toBe(false);

    // A settled build question is never degraded, whatever else the payload says.
    for (const status of ["lifted", "not-needed", "not-applicable"] as const) {
      expect(
        isBuildDegradedResult({
          coordinateLift: { status, fromAssembly: "GRCh37", toAssembly: "GRCh38" },
          predictorData: { gnomadVariantAssembly: "GRCh37" },
        })
      ).toBe(false);
    }

    // No trail at all (a payload from before the lift record): the frequency source's build is the
    // only signal left, and GRCh37 is the state the predictor cache itself refuses to persist.
    expect(isBuildDegradedResult({ predictorData: { gnomadVariantAssembly: "GRCh37" } })).toBe(true);
    expect(isBuildDegradedResult({ predictorData: { gnomadVariantAssembly: "GRCh38" } })).toBe(false);
    // Absent means "not recorded", not "wrong": a build-free variant must still be served.
    expect(isBuildDegradedResult({ predictorData: { gnomadVariantAssembly: null } })).toBe(false);
    expect(isBuildDegradedResult({ predictorData: null })).toBe(false);
    expect(isBuildDegradedResult({})).toBe(false);
    expect(isBuildDegradedResult(null)).toBe(false);
    expect(isBuildDegradedResult(undefined)).toBe(false);
  });

  /**
   * Pairing a coordinate with its build is the whole job of this helper: a GRCh37 position handed
   * to a GRCh38 index is the wrong-locus hazard. Two server call sites built it by hand and both
   * read only the submitted pair.
   */
  it("prefers the verified canonical coordinate and never pairs a coordinate with a guessed build", () => {
    // Both pairs present: the verified canonical one wins, with its own build.
    expect(
      predictorCoordinateFromContext({
        genomicCoordinates: "1-1256452-C-A",
        assembly: "GRCh37",
        liftedGenomicCoordinates: "1-1321072-C-A",
        resolvedAssembly: "GRCh38",
      })
    ).toEqual({ chrom: "1", pos: 1321072, ref: "C", alt: "A", assembly: "GRCh38" });

    // Only the submitted pair: used as-is, tagged with the build it was declared in.
    expect(
      predictorCoordinateFromContext({ genomicCoordinates: "1-1256452-C-A", assembly: "GRCh37" })
    ).toEqual({ chrom: "1", pos: 1256452, ref: "C", alt: "A", assembly: "GRCh37" });

    /**
     * A lifted coordinate with NO stated build is DROPPED — the helper falls through to the
     * submitted pair rather than tagging the canonical locus with an assumed build.
     *
     * This used to default to `CANONICAL_ASSEMBLY`, which was probably right but put the safety in a
     * doc sentence instead of in the helper (the contract says such a coordinate "is dropped, never
     * assumed canonical"). Falling through is not a loss: the predictor lifts the submitted
     * coordinate itself, exactly as it did before lift-first existed.
     */
    expect(
      predictorCoordinateFromContext({
        genomicCoordinates: "1-1256452-C-A",
        assembly: "GRCh37",
        liftedGenomicCoordinates: "1-1321072-C-A",
      })
    ).toEqual({ chrom: "1", pos: 1256452, ref: "C", alt: "A", assembly: "GRCh37" });

    // Nothing usable: no coordinate at all, rather than a coordinate with an assumed build.
    expect(predictorCoordinateFromContext({ liftedGenomicCoordinates: "junk", assembly: "GRCh37" })).toBeNull();
    expect(predictorCoordinateFromContext({})).toBeNull();
    // Malformed trailing junk is refused upstream too (the parser is strict about 4 components).
    expect(parseGenomicCoordinateString("1-1256452-C-A-extra")).toBeNull();
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

  /**
   * The inference provenance the report's "AI synthesis · <model>" chip and the Insights rail both read.
   *
   * Declared `.optional()` and otherwise unasserted, which is the shape this file's own `metadata` note
   * warns about: a shape nothing round-trips is a shape that can be deleted again without a failure.
   * The narrative route happens to validate its response with `insights: z.any()` in
   * `src/api/clinicalApi.ts`, so nothing strips these in production today — the test exists so the
   * declaration stays true and so a future move to schema validation cannot silently drop them.
   */
  it("round-trips the narrative's model and source through analyzeVariantResponseSchema", () => {
    // `metadata` is required by this schema, so the payload has to be a realistic one.
    const metadata = {
      gene: "CNNM2",
      variant: "p.Ser489Cys",
      uniprotId: "Q9H4Z3",
      residueIndex: 489,
      wildType: "S",
      mutant: "C"
    };

    const payload = {
      analysis: "Test narrative",
      metadata,
      insights: {
        biochemicalShift: "shift",
        structuralImpact: "impact",
        acmgCriteria: [],
        model: "gemini-3.7-flash",
        source: "ai_inference" as const
      }
    };

    const parsed = analyzeVariantResponseSchema.parse(payload);
    expect(parsed.insights?.model).toBe("gemini-3.7-flash");
    expect(parsed.insights?.source).toBe("ai_inference");

    // A degraded run names no model, and the enum is closed — an invented source must be rejected
    // rather than travelling as a provenance claim.
    const degraded = analyzeVariantResponseSchema.parse({
      analysis: "Rule-based report",
      metadata,
      insights: { biochemicalShift: "s", structuralImpact: "i", acmgCriteria: [], source: "rule_based" }
    });
    expect(degraded.insights?.model).toBeUndefined();
    expect(degraded.insights?.source).toBe("rule_based");

    expect(() =>
      analyzeVariantResponseSchema.parse({
        analysis: "x",
        metadata,
        insights: { biochemicalShift: "s", structuralImpact: "i", acmgCriteria: [], source: "invented" }
      })
    ).toThrow();
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

  /**
   * The parse this schema performs is the last step before the payload reaches the store, and a
   * zod object deletes what it does not declare. `metadata` declared six keys while the server
   * also sends the sequence, the mutated sequence and the structure id/provenance — all four of
   * which the client reads (the structure viewer and the report name the PDB entry, the
   * inspector shows the mutated sequence's length, and the narrative re-synthesis sends the
   * sequence, which the report's own ACMG criteria are computed from). They were being deleted
   * here, while the TypeScript types said they were present.
   */
  it("keeps the metadata fields the client reads instead of stripping them", () => {
    const payload = {
      metadata: {
        gene: "PAH",
        variant: "p.Arg408Trp",
        uniprotId: "P00439",
        residueIndex: 408,
        wildType: "Arg",
        mutant: "Trp",
        sequence: "M".repeat(452),
        mutatedSequence: "M".repeat(407) + "W" + "M".repeat(44),
        pdbId: "2PAH",
        pdbSource: "RCSB PDB",
        somethingAddedLater: "kept"
      }
    };

    const parsed = biophysicalAnalysisResponseSchema.parse(payload);

    expect(parsed.metadata?.sequence).toBe("M".repeat(452));
    expect(parsed.metadata?.mutatedSequence).toBe("M".repeat(407) + "W" + "M".repeat(44));
    expect(parsed.metadata?.pdbId).toBe("2PAH");
    expect(parsed.metadata?.pdbSource).toBe("RCSB PDB");
    // ...and a field the server adds later is not silently dropped either.
    expect((parsed.metadata as any)?.somethingAddedLater).toBe("kept");
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
