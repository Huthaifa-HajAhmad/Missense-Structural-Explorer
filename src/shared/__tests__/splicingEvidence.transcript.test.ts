import { describe, expect, it } from "vitest";
import { deriveSplicingEvidence } from "../splicingEvidence.ts";

describe("deriveSplicingEvidence — RefSeq transcript preference", () => {
  it("prefers maneRefSeqId over Ensembl transcriptId when present", () => {
    const result: any = {
      transcriptId: "ENST00000369878.9",
      maneRefSeqId: "NM_017649.5",
      conservationData: {
        spliceProximity: {
          distance: 155,
          isNearSpliceSite: false,
          transcriptId: "ENST00000369878.9",
          junctionType: "donor",
          regionType: "exonic",
          exonNumber: 1,
          totalExons: 8,
          strand: "+"
        }
      }
    };

    const evidence = deriveSplicingEvidence(result);
    expect(evidence).not.toBeNull();
    // transcriptId should prioritize RefSeq
    expect(evidence!.transcriptId).toBe("NM_017649.5");
    expect(evidence!.refseqTranscriptId).toBe("NM_017649.5");
    expect(evidence!.ensemblTranscriptId).toBe("ENST00000369878.9");
  });

  it("reads maneRefSeqId from predictorData if top-level maneRefSeqId is absent", () => {
    const result: any = {
      transcriptId: "ENST00000369878.9",
      predictorData: {
        maneRefSeqId: "NM_017649.5"
      },
      conservationData: {
        spliceProximity: {
          distance: 155,
          isNearSpliceSite: false,
          transcriptId: "ENST00000369878.9"
        }
      }
    };

    const evidence = deriveSplicingEvidence(result);
    expect(evidence).not.toBeNull();
    expect(evidence!.transcriptId).toBe("NM_017649.5");
    expect(evidence!.refseqTranscriptId).toBe("NM_017649.5");
    expect(evidence!.ensemblTranscriptId).toBe("ENST00000369878.9");
  });

  it("falls back to Ensembl transcriptId when no RefSeq accession exists", () => {
    const result: any = {
      transcriptId: "ENST00000369878.9",
      conservationData: {
        spliceProximity: {
          distance: 40,
          isNearSpliceSite: false,
          transcriptId: "ENST00000369878.9"
        }
      }
    };

    const evidence = deriveSplicingEvidence(result);
    expect(evidence).not.toBeNull();
    expect(evidence!.transcriptId).toBe("ENST00000369878.9");
    expect(evidence!.refseqTranscriptId).toBeNull();
    expect(evidence!.ensemblTranscriptId).toBe("ENST00000369878.9");
  });

  it("reads maneRefSeqId from numberingRemap.from when top-level and predictorData are absent", () => {
    const result: any = {
      transcriptId: "ENST00000369878.9",
      numberingRemap: {
        reason: "same",
        from: {
          maneRefSeqId: "NM_017649.5"
        },
        to: {}
      },
      conservationData: {
        spliceProximity: {
          distance: 155,
          isNearSpliceSite: false,
          transcriptId: "ENST00000369878.9"
        }
      }
    };

    const evidence = deriveSplicingEvidence(result);
    expect(evidence).not.toBeNull();
    expect(evidence!.transcriptId).toBe("NM_017649.5");
    expect(evidence!.refseqTranscriptId).toBe("NM_017649.5");
    expect(evidence!.ensemblTranscriptId).toBe("ENST00000369878.9");
  });

  it("trims whitespace and falls back to Ensembl when maneRefSeqId is whitespace-only", () => {
    const result: any = {
      transcriptId: "ENST00000369878.9",
      maneRefSeqId: "   ",
      conservationData: {
        spliceProximity: {
          distance: 40,
          transcriptId: "  ENST00000369878.9  "
        }
      }
    };

    const evidence = deriveSplicingEvidence(result);
    expect(evidence).not.toBeNull();
    expect(evidence!.refseqTranscriptId).toBeNull();
    expect(evidence!.ensemblTranscriptId).toBe("ENST00000369878.9");
    expect(evidence!.transcriptId).toBe("ENST00000369878.9");
  });

  it("returns null transcriptId when neither RefSeq nor Ensembl accession is available", () => {
    const result: any = {
      conservationData: {
        spliceProximity: {
          distance: 40
        }
      }
    };

    const evidence = deriveSplicingEvidence(result);
    expect(evidence).not.toBeNull();
    expect(evidence!.refseqTranscriptId).toBeNull();
    expect(evidence!.ensemblTranscriptId).toBeNull();
    expect(evidence!.transcriptId).toBeNull();
  });
});
