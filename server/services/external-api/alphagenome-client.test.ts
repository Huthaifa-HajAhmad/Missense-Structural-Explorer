import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  cdfToPhred,
  readFloat32Array,
  AVI_FEATURE_KEYS,
  AVI_FEATURE_DISPLAY_MAP,
  setAtlasGrpcClientFactory,
  queryAlphaGenomeVariantGrpc,
  queryAlphaGenomeRegionGrpc,
  verifyAlphaGenomeConnection
} from "./alphagenome-client.ts";
import * as grpc from "@grpc/grpc-js";

describe("AlphaGenome Native gRPC Client Tests", () => {
  beforeEach(() => {
    setAtlasGrpcClientFactory(null);
    vi.restoreAllMocks();
  });

  describe("Mathematical Utilities & Buffer Decoding", () => {
    it("should correctly convert CDF quantile to tail probability and Phred score", () => {
      const q99 = cdfToPhred(0.99);
      expect(q99.tail).toBeCloseTo(0.01, 5);
      expect(q99.phred).toBeCloseTo(20.0, 1);

      const q999 = cdfToPhred(0.999);
      expect(q999.tail).toBeCloseTo(0.001, 5);
      expect(q999.phred).toBeCloseTo(30.0, 1);

      const q0 = cdfToPhred(0.0);
      expect(q0.tail).toBe(1.0);
      expect(q0.phred).toBeCloseTo(0.0, 1);
    });

    it("should decode Little-Endian float32 buffers accurately", () => {
      const buffer = Buffer.alloc(12);
      buffer.writeFloatLE(1.2345, 0);
      buffer.writeFloatLE(-45.67, 4);
      buffer.writeFloatLE(999.0, 8);

      const floats = readFloat32Array(buffer);
      expect(floats).toHaveLength(3);
      expect(floats[0]).toBeCloseTo(1.2345, 4);
      expect(floats[1]).toBeCloseTo(-45.67, 2);
      expect(floats[2]).toBeCloseTo(999.0, 1);
    });

    it("should return empty array for empty or short buffers", () => {
      expect(readFloat32Array(null)).toEqual([]);
      expect(readFloat32Array(Buffer.alloc(2))).toEqual([]);
    });

    it("should contain all 18 biological feature attribution keys and display names", () => {
      expect(AVI_FEATURE_KEYS).toHaveLength(18);
      expect(AVI_FEATURE_DISPLAY_MAP["MERGED_SPLICING"]).toBe("Splicing");
      expect(AVI_FEATURE_DISPLAY_MAP["ALPHAMISSENSE"]).toBe("AlphaMissense");
      expect(AVI_FEATURE_DISPLAY_MAP["MAX_ABS_RNA_SEQ"]).toBe("RNA-seq");
    });
  });

  describe("queryAlphaGenomeVariantGrpc", () => {
    it("should unpack AVI_SCORE and 18-modality feature importances from gRPC response", async () => {
      const mockScoreBuf = Buffer.alloc(4);
      mockScoreBuf.writeFloatLE(0.8542, 0);

      const mockCalibratedBuf = Buffer.alloc(4);
      mockCalibratedBuf.writeFloatLE(0.995, 0); // 1 - 0.995 = 0.005 -> ~23.01 Phred

      const mockFiBuf = Buffer.alloc(18 * 4);
      // Let feature 0 (Splicing) be 0.12, and feature 10 (AlphaMissense) be 0.95
      mockFiBuf.writeFloatLE(0.12, 0 * 4);
      mockFiBuf.writeFloatLE(0.95, 10 * 4); // index 10 = ALPHAMISSENSE

      const mockResponse = {
        scores: [
          {
            variant_scorer: { name: "AVI_SCORE" },
            scores: mockScoreBuf,
            calibrated_scores: mockCalibratedBuf
          },
          {
            variant_scorer: { name: "AVI_SCORE_FEATURE_IMPORTANCE" },
            scores: mockFiBuf
          }
        ]
      };

      const mockClient = {
        GetDenseVariantScores: vi.fn((req, md, opts, callback) => {
          callback(null, mockResponse);
        })
      };

      setAtlasGrpcClientFactory(() => mockClient);

      const result = await queryAlphaGenomeVariantGrpc("chr20", 23369727, "C", "T", "test-api-key");

      expect(mockClient.GetDenseVariantScores).toHaveBeenCalledOnce();
      expect(result).not.toBeNull();
      expect(result?.status).toBe("live");
      expect(result?.aviRaw).toBe(0.8542);
      expect(result?.aviQuantile).toBe(0.995);
      expect(result?.aviPhred).toBeCloseTo(23.01, 1);
      expect(result?.acmgStrength).toBe("PP3_Supporting");
      expect(result?.topModality).toBe("AlphaMissense");
      expect(result?.topFeatureImportance).toBe(0.95);
      expect(result?.featureAttributions).toBeDefined();
      expect(result?.featureAttributions?.["Splicing"]).toBe(0.12);
      expect(result?.featureAttributions?.["AlphaMissense"]).toBe(0.95);
    });

    it("should handle gRPC UNAUTHENTICATED error with clean standby state", async () => {
      const mockClient = {
        GetDenseVariantScores: vi.fn((req, md, opts, callback) => {
          const err: any = new Error("Invalid API key");
          err.code = grpc.status.UNAUTHENTICATED;
          callback(err, null);
        })
      };

      setAtlasGrpcClientFactory(() => mockClient);

      const result = await queryAlphaGenomeVariantGrpc("chr20", 23369727, "C", "T", "bad-key");
      expect(result).not.toBeNull();
      expect(result?.status).toBe("unavailable");
      expect(result?.message).toContain("API Key is invalid or expired");
    });

    it("should handle gRPC NOT_FOUND error mapping cleanly to unindexed message", async () => {
      const mockClient = {
        GetDenseVariantScores: vi.fn((req, md, opts, callback) => {
          const err: any = new Error("Variant not in Atlas");
          err.code = grpc.status.NOT_FOUND;
          callback(err, null);
        })
      };

      setAtlasGrpcClientFactory(() => mockClient);

      const result = await queryAlphaGenomeVariantGrpc("chr20", 23369727, "C", "T", "valid-key");
      expect(result).not.toBeNull();
      expect(result?.status).toBe("unavailable");
      expect(result?.message).toBe("Variant not indexed in AlphaGenome Atlas.");
      expect(result?.aviPhred).toBeNull();
    });

    it("should handle gRPC PERMISSION_DENIED and DEADLINE_EXCEEDED error mappings", async () => {
      const mockClientDenied = {
        GetDenseVariantScores: vi.fn((req, md, opts, callback) => {
          const err: any = new Error("No permission");
          err.code = grpc.status.PERMISSION_DENIED;
          callback(err, null);
        })
      };

      setAtlasGrpcClientFactory(() => mockClientDenied);
      const resDenied = await queryAlphaGenomeVariantGrpc("chr20", 23369727, "C", "T", "key");
      expect(resDenied?.message).toContain("lacks permission");

      const mockClientTimeout = {
        GetDenseVariantScores: vi.fn((req, md, opts, callback) => {
          const err: any = new Error("Deadline");
          err.code = grpc.status.DEADLINE_EXCEEDED;
          callback(err, null);
        })
      };

      setAtlasGrpcClientFactory(() => mockClientTimeout);
      const resTimeout = await queryAlphaGenomeVariantGrpc("chr20", 23369727, "C", "T", "key");
      expect(resTimeout?.message).toContain("timed out");
    });
  });

  describe("verifyAlphaGenomeConnection", () => {
    it("should report success and latency when ListVariantScoresMetadata succeeds", async () => {
      const mockResponse = {
        variant_scorer_metadata: [
          { variant_scorer: { name: "AVI_SCORE" } },
          { variant_scorer: { name: "AVI_SCORE_FEATURE_IMPORTANCE" } },
          { variant_scorer: { name: "SPLICE_SITES" } }
        ]
      };

      const mockClient = {
        ListVariantScoresMetadata: vi.fn((req, md, opts, callback) => {
          callback(null, mockResponse);
        })
      };

      setAtlasGrpcClientFactory(() => mockClient);

      const res = await verifyAlphaGenomeConnection("valid-test-key");
      expect(res.ok).toBe(true);
      expect(res.scorersCount).toBe(3);
      expect(res.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it("should report unauthorized when gRPC returns UNAUTHENTICATED", async () => {
      const mockClient = {
        ListVariantScoresMetadata: vi.fn((req, md, opts, callback) => {
          const err: any = new Error("Bad key");
          err.code = grpc.status.UNAUTHENTICATED;
          callback(err, null);
        })
      };

      setAtlasGrpcClientFactory(() => mockClient);

      const res = await verifyAlphaGenomeConnection("invalid-key");
      expect(res.ok).toBe(false);
      expect(res.error).toContain("API key is invalid or unauthorized");
    });
  });

  describe("queryAlphaGenomeRegionGrpc", () => {
    it("should parse string positions, calculate isExonic bounds, and pick dominant modality", async () => {
      // Create raw float32 buffer for calibrated score (0.999 => phred 30.0)
      const calBuf = Buffer.alloc(4);
      calBuf.writeFloatLE(0.999, 0);

      // Create raw float32 buffer for feature importances
      const fiBuf = Buffer.alloc(18 * 4);
      fiBuf.writeFloatLE(0.1, 0); // MERGED_SPLICING
      fiBuf.writeFloatLE(0.98, 10 * 4); // ALPHAMISSENSE (index 10 in AVI_FEATURE_KEYS)

      const mockResponse = {
        variant_scores: [
          {
            variant: {
              position: "100", // String from protobuf int64
              reference_bases: "A",
              alternate_bases: "T"
            },
            scores: [
              {
                variant_scorer: { name: "AVI_SCORE" },
                calibrated_scores: calBuf
              },
              {
                variant_scorer: { name: "AVI_SCORE_FEATURE_IMPORTANCE" },
                scores: fiBuf
              }
            ]
          },
          {
            variant: {
              position: "150", // Outside exonStart (100) - exonEnd (120)
              reference_bases: "C",
              alternate_bases: "G"
            },
            scores: [
              {
                variant_scorer: { name: "AVI_SCORE" },
                calibrated_scores: calBuf
              }
            ]
          }
        ]
      };

      const mockClient = {
        ListDenseVariantScores: vi.fn((req, md, opts, callback) => {
          callback(null, mockResponse);
        })
      };

      setAtlasGrpcClientFactory(() => mockClient);

      const res = await queryAlphaGenomeRegionGrpc(
        {
          chrom: "chr1",
          start: 90,
          end: 160,
          exonStart: 100,
          exonEnd: 120
        },
        "test-key"
      );

      expect(mockClient.ListDenseVariantScores).toHaveBeenCalledOnce();
      expect(res.status).toBe("live");
      expect(res.positions.length).toBe(2);

      const pos100 = res.positions.find((p) => p.pos === 100);
      expect(pos100).toBeDefined();
      expect(pos100?.isExonic).toBe(true);
      expect(pos100?.ref).toBe("A");
      expect(pos100?.variants["T"]).toBeDefined();
      expect(pos100?.variants["T"].phred).toBeCloseTo(30.0, 1);
      expect(pos100?.topModality).toBe("AlphaMissense");

      const pos150 = res.positions.find((p) => p.pos === 150);
      expect(pos150).toBeDefined();
      expect(pos150?.isExonic).toBe(false);
    });

    it("should immediately return unavailable when signal is pre-aborted", async () => {
      const abortController = new AbortController();
      abortController.abort();

      const res = await queryAlphaGenomeRegionGrpc(
        {
          chrom: "chr1",
          start: 100,
          end: 200
        },
        "test-key",
        { signal: abortController.signal }
      );

      expect(res.status).toBe("unavailable");
      expect(res.message).toContain("cancelled");
    });
  });
});
