import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import path from "node:path";
import fs from "node:fs";
import {
  type AlphaGenomeAviData,
  type AlphaGenomeRegionSaturationRequest,
  type AlphaGenomeRegionSaturationResponse,
  type AlphaGenomeSaturationPosition,
  type AlphaGenomeSaturationVariant,
  generateAtlasUrls
} from "../../../src/shared/contracts.ts";
import { THRESHOLDS } from "../../../src/shared/thresholds.ts";

/**
 * Maps calibrated continuous AVI Phred scores to ClinGen SVI Bayesian pathogenicity tiers.
 * Strictly guards against negative numbers (sentinels or calculation errors).
 */
export function calculateAlphaGenomeAcmgStrength(
  phred: number | null | undefined
): "PP3_Strong" | "PP3_Moderate" | "PP3_Supporting" | "BP4_Supporting" | "BP4_Moderate" | "indeterminate" {
  if (phred === null || phred === undefined || isNaN(phred) || phred < 0) {
    return "indeterminate";
  }
  if (phred >= THRESHOLDS.alphagenome.pathogenicStrong) return "PP3_Strong";
  if (phred >= THRESHOLDS.alphagenome.pathogenicModerate) return "PP3_Moderate";
  if (phred >= THRESHOLDS.alphagenome.pathogenicSupporting) return "PP3_Supporting";
  if (phred <= THRESHOLDS.alphagenome.benignModerate) return "BP4_Moderate";
  if (phred <= THRESHOLDS.alphagenome.benign) return "BP4_Supporting";
  return "indeterminate";
}

function resolveProtoDir(): string {
  let currentDir = "";
  if (typeof __dirname !== "undefined" && __dirname) {
    currentDir = __dirname;
  } else {
    currentDir = path.resolve(process.cwd(), "server/services");
  }

  const candidateDirs = [
    path.resolve(currentDir, "alphagenome/protos"),
    path.resolve(currentDir, "../server/services/alphagenome/protos"),
    path.resolve(process.cwd(), "server/services/alphagenome/protos"),
    path.resolve(process.cwd(), "dist/alphagenome/protos")
  ];

  for (const candidate of candidateDirs) {
    if (fs.existsSync(path.join(candidate, "atlas_service.proto"))) {
      return candidate;
    }
  }

  return candidateDirs[0];
}

let _AtlasService: any = null;

function getAtlasService(): any {
  if (_AtlasService) return _AtlasService;

  const protoDir = resolveProtoDir();
  const atlasProtoPath = path.join(protoDir, "atlas_service.proto");

  if (!fs.existsSync(atlasProtoPath)) {
    throw new Error(`AlphaGenome proto definition not found at: ${atlasProtoPath}`);
  }

  const packageDefinition = protoLoader.loadSync(atlasProtoPath, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
    includeDirs: [
      protoDir,
      path.resolve(protoDir, "..")
    ]
  });

  const protoDescriptor = grpc.loadPackageDefinition(packageDefinition) as any;
  _AtlasService = protoDescriptor.google?.gdm?.gdmscience?.alphagenome?.atlas?.v1main?.AtlasService;

  if (!_AtlasService) {
    throw new Error("Failed to load AtlasService definition from proto files");
  }

  return _AtlasService;
}

export const ALPHAGENOME_GRPC_TARGET = "gdmscience.googleapis.com:443";

export const AVI_FEATURE_KEYS = [
  "MERGED_SPLICING",
  "MAX_ABS_RNA_SEQ",
  "MAX_ABS_ATAC",
  "MAX_ABS_DNASE",
  "MAX_ABS_CHIP_TF",
  "MAX_ABS_CHIP_HISTONE",
  "MAX_ABS_CAGE",
  "MAX_ABS_PROCAP",
  "MAX_ABS_POLYADENYLATION",
  "MAX_ABS_CONTACT_MAPS",
  "ALPHAMISSENSE",
  "CACTUS_241_WAY",
  "PROTEIN_TERMINATION",
  "START_LOST",
  "STOP_LOST",
  "PHASTCONS_470_WAY",
  "IS_INSERTION",
  "IS_DELETION"
] as const;

export const AVI_FEATURE_DISPLAY_MAP: Record<string, string> = {
  MERGED_SPLICING: "Splicing",
  MAX_ABS_RNA_SEQ: "RNA-seq",
  MAX_ABS_ATAC: "ATAC-seq",
  MAX_ABS_DNASE: "DNASE-seq",
  MAX_ABS_CHIP_TF: "ChIP-TF",
  MAX_ABS_CHIP_HISTONE: "ChIP-Histone",
  MAX_ABS_CAGE: "CAGE",
  MAX_ABS_PROCAP: "PRO-cap",
  MAX_ABS_POLYADENYLATION: "Polyadenylation",
  MAX_ABS_CONTACT_MAPS: "3D Genome Contacts",
  ALPHAMISSENSE: "AlphaMissense",
  CACTUS_241_WAY: "Cactus",
  PROTEIN_TERMINATION: "Protein Termination",
  START_LOST: "Start Lost",
  STOP_LOST: "Stop Lost",
  PHASTCONS_470_WAY: "PhastCons 470",
  IS_INSERTION: "Insertion",
  IS_DELETION: "Deletion"
};

export function cdfToPhred(cdfQuantile: number): { tail: number; phred: number } {
  const tail = Math.max(1e-7, 1.0 - cdfQuantile);
  const phred = -10.0 * Math.log10(tail);
  return { tail, phred };
}

export function readFloat32Array(buf: Buffer | Uint8Array | null | undefined): number[] {
  if (!buf || buf.length < 4) return [];
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const count = Math.floor(buf.byteLength / 4);
  const floats: number[] = new Array(count);
  for (let i = 0; i < count; i++) {
    floats[i] = view.getFloat32(i * 4, true); // true = Little-Endian
  }
  return floats;
}

let clientInstance: any = null;
let customClientFactory: ((target?: string) => any) | null = null;

export function setAtlasGrpcClientFactory(factory: ((target?: string) => any) | null): void {
  customClientFactory = factory;
  clientInstance = null;
}

export function getAtlasGrpcClient(target = ALPHAGENOME_GRPC_TARGET): any {
  if (customClientFactory) {
    return customClientFactory(target);
  }
  if (!clientInstance) {
    const Service = getAtlasService();
    clientInstance = new Service(target, grpc.credentials.createSsl());
  }
  return clientInstance;
}

export interface GrpcQueryOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * Queries AlphaGenome Atlas GetDenseVariantScores via native gRPC over TLS.
 */
export async function queryAlphaGenomeVariantGrpc(
  chrom: string,
  pos: number,
  ref: string,
  alt: string,
  apiKey: string,
  options?: GrpcQueryOptions
): Promise<AlphaGenomeAviData> {
  const normChrom = chrom.toLowerCase().startsWith("chr") ? chrom : `chr${chrom}`;
  const normRef = ref.toUpperCase();
  const normAlt = alt.toUpperCase();
  const urls = generateAtlasUrls(normChrom, pos, normRef, normAlt);

  if (options?.signal?.aborted) {
    return {
      status: "unavailable",
      aviPhred: null,
      aviRaw: null,
      aviQuantile: null,
      topPercentile: null,
      topModality: null,
      topFeatureImportance: null,
      featureAttributions: null,
      acmgStrength: "indeterminate",
      atlasUrl: urls.trackPredictionsUrl,
      message: "AlphaGenome query was cancelled."
    };
  }

  const client = getAtlasGrpcClient();
  const metadata = new grpc.Metadata();
  metadata.set("x-goog-api-key", apiKey);

  const request = {
    variant: {
      chromosome: normChrom,
      position: pos,
      reference_bases: normRef,
      alternate_bases: normAlt
    },
    organism: "ORGANISM_HOMO_SAPIENS",
    filter: 'scores.variant_scorer.name = "AVI_SCORE" OR scores.variant_scorer.name = "AVI_SCORE_FEATURE_IMPORTANCE"'
  };

  const timeoutMs = options?.timeoutMs ?? 5000;
  const deadline = new Date(Date.now() + timeoutMs);

  return new Promise<AlphaGenomeAviData>((resolve, reject) => {
    let aborted = false;

    const call = client.GetDenseVariantScores(
      request,
      metadata,
      { deadline },
      (err: any, response: any) => {
        if (aborted) return;

        if (err) {
          const errMsg = err.details || err.message || "Unknown gRPC error";
          if (err.code === grpc.status.UNAUTHENTICATED) {
            return resolve({
              status: "unavailable",
              aviPhred: null,
              aviRaw: null,
              aviQuantile: null,
              topPercentile: null,
              topModality: null,
              topFeatureImportance: null,
              featureAttributions: null,
              acmgStrength: "indeterminate",
              atlasUrl: urls.trackPredictionsUrl,
              message: "AlphaGenome API Key is invalid or expired."
            });
          }
          if (err.code === grpc.status.PERMISSION_DENIED) {
            return resolve({
              status: "unavailable",
              aviPhred: null,
              aviRaw: null,
              aviQuantile: null,
              topPercentile: null,
              topModality: null,
              topFeatureImportance: null,
              featureAttributions: null,
              acmgStrength: "indeterminate",
              atlasUrl: urls.trackPredictionsUrl,
              message: "AlphaGenome API Key lacks permission to query Atlas."
            });
          }
          if (err.code === grpc.status.DEADLINE_EXCEEDED) {
            return resolve({
              status: "unavailable",
              aviPhred: null,
              aviRaw: null,
              aviQuantile: null,
              topPercentile: null,
              topModality: null,
              topFeatureImportance: null,
              featureAttributions: null,
              acmgStrength: "indeterminate",
              atlasUrl: urls.trackPredictionsUrl,
              message: "AlphaGenome Atlas query timed out."
            });
          }
          if (err.code === grpc.status.NOT_FOUND) {
            return resolve({
              status: "unavailable",
              aviPhred: null,
              aviRaw: null,
              aviQuantile: null,
              topPercentile: null,
              topModality: null,
              topFeatureImportance: null,
              featureAttributions: null,
              acmgStrength: "indeterminate",
              atlasUrl: urls.trackPredictionsUrl,
              message: "Variant not indexed in AlphaGenome Atlas."
            });
          }
          return reject(new Error(`AlphaGenome gRPC error [code ${err.code}]: ${errMsg}`));
        }

        try {
          const rawScoresList: any[] = response?.scores || [];
          let aviRaw: number | null = null;
          let aviQuantile: number | null = null;
          let aviPhred: number | null = null;
          let topPercentile: number | null = null;
          let featureAttributions: Record<string, number> = {};
          let topModality: string | null = null;
          let topFeatureImportance: number | null = null;

          for (const score of rawScoresList) {
            const scorerName = score?.variant_scorer?.name;

            if (scorerName === "AVI_SCORE") {
              const rawBuf = score.scores;
              const calBuf = score.calibrated_scores;

              if (rawBuf && rawBuf.length >= 4) {
                const rawFloats = readFloat32Array(rawBuf);
                if (rawFloats.length > 0 && !isNaN(rawFloats[0])) {
                  aviRaw = Number(rawFloats[0].toFixed(4));
                }
              }

              if (calBuf && calBuf.length >= 4) {
                const calFloats = readFloat32Array(calBuf);
                if (calFloats.length > 0 && !isNaN(calFloats[0])) {
                  const cdfVal = calFloats[0];
                  aviQuantile = Number(cdfVal.toFixed(6));
                  const { tail, phred } = cdfToPhred(cdfVal);
                  aviPhred = Number(phred.toFixed(3));
                  topPercentile = Number((tail * 100.0).toFixed(4));
                }
              }
            } else if (scorerName === "AVI_SCORE_FEATURE_IMPORTANCE") {
              const fiBuf = score.scores;
              if (fiBuf && fiBuf.length >= 4) {
                const fiFloats = readFloat32Array(fiBuf);
                let maxAbsVal = -1;
                let dominantName: string | null = null;
                let dominantVal: number | null = null;

                for (let i = 0; i < fiFloats.length; i++) {
                  const val = fiFloats[i];
                  const rawKey = AVI_FEATURE_KEYS[i] || `MODALITY_${i + 1}`;
                  const displayName = AVI_FEATURE_DISPLAY_MAP[rawKey] || rawKey;
                  const formattedVal = Number(val.toFixed(4));
                  featureAttributions[displayName] = formattedVal;

                  const abs = Math.abs(val);
                  if (abs > maxAbsVal) {
                    maxAbsVal = abs;
                    dominantName = displayName;
                    dominantVal = formattedVal;
                  }
                }

                topModality = dominantName;
                topFeatureImportance = dominantVal;
              }
            }
          }

          const acmgStrength = calculateAlphaGenomeAcmgStrength(aviPhred);

          resolve({
            status: "live",
            aviPhred,
            aviRaw,
            aviQuantile,
            topPercentile,
            topModality,
            topFeatureImportance,
            featureAttributions: Object.keys(featureAttributions).length > 0 ? featureAttributions : null,
            acmgStrength,
            atlasUrl: urls.trackPredictionsUrl,
            message: null
          });
        } catch (parseErr: any) {
          reject(new Error(`Failed to parse AlphaGenome response: ${parseErr.message}`));
        }
      }
    );

    if (options?.signal) {
      options.signal.addEventListener("abort", () => {
        aborted = true;
        try {
          call.cancel();
        } catch {
          // ignore call cancellation error
        }
        resolve({
          status: "unavailable",
          aviPhred: null,
          aviRaw: null,
          aviQuantile: null,
          topPercentile: null,
          topModality: null,
          topFeatureImportance: null,
          featureAttributions: null,
          acmgStrength: "indeterminate",
          atlasUrl: urls.trackPredictionsUrl,
          message: "AlphaGenome query was cancelled."
        });
      }, { once: true });
    }
  });
}

/**
 * Queries AlphaGenome Atlas ListDenseVariantScores across a genomic interval.
 */
export async function queryAlphaGenomeRegionGrpc(
  params: AlphaGenomeRegionSaturationRequest,
  apiKey: string,
  options?: GrpcQueryOptions
): Promise<AlphaGenomeRegionSaturationResponse> {
  const normChrom = params.chrom.toLowerCase().startsWith("chr") ? params.chrom : `chr${params.chrom}`;
  const locusUrl = `https://deepmind.google.com/science/alphagenome/atlas/locus?interval=${encodeURIComponent(normChrom)}%3A${params.start}-${params.end}`;

  if (options?.signal?.aborted) {
    return {
      status: "unavailable",
      chrom: normChrom,
      start: params.start,
      end: params.end,
      strand: params.strand || null,
      transcriptId: params.transcriptId || null,
      exonNumber: params.exonNumber || null,
      exonStart: params.exonStart || null,
      exonEnd: params.exonEnd || null,
      positions: [],
      atlasLocusUrl: locusUrl,
      message: "AlphaGenome query was cancelled."
    };
  }

  const client = getAtlasGrpcClient();
  const metadata = new grpc.Metadata();
  metadata.set("x-goog-api-key", apiKey);

  const request = {
    interval: {
      chromosome: normChrom,
      start: params.start - 1, // 0-based start
      end: params.end          // 0-based exclusive end
    },
    organism: "ORGANISM_HOMO_SAPIENS",
    filter: 'scores.variant_scorer.name = "AVI_SCORE" OR scores.variant_scorer.name = "AVI_SCORE_FEATURE_IMPORTANCE"'
  };

  const timeoutMs = options?.timeoutMs ?? 10000;
  const deadline = new Date(Date.now() + timeoutMs);

  return new Promise<AlphaGenomeRegionSaturationResponse>((resolve, reject) => {
    let aborted = false;

    const call = client.ListDenseVariantScores(
      request,
      metadata,
      { deadline },
      (err: any, response: any) => {
        if (aborted) return;

        if (err) {
          const errMsg = err.details || err.message || "Unknown gRPC error";
          return resolve({
            status: "unavailable",
            chrom: normChrom,
            start: params.start,
            end: params.end,
            strand: params.strand || null,
            transcriptId: params.transcriptId || null,
            exonNumber: params.exonNumber || null,
            exonStart: params.exonStart || null,
            exonEnd: params.exonEnd || null,
            positions: [],
            atlasLocusUrl: locusUrl,
            message: `AlphaGenome interval query failed: ${errMsg}`
          });
        }

        try {
          const variantScoresList: any[] = response?.variant_scores || [];
          const positionMap = new Map<number, {
            ref: "A" | "C" | "G" | "T";
            variants: Record<string, AlphaGenomeSaturationVariant>;
          }>();

          for (const item of variantScoresList) {
            const v = item?.variant;
            if (!v || (typeof v.position !== "number" && typeof v.position !== "string")) continue;

            const pos = Number(v.position);
            if (isNaN(pos) || pos <= 0) continue;

            const refBase = (v.reference_bases || "").toUpperCase() as "A" | "C" | "G" | "T";
            const altBase = (v.alternate_bases || "").toUpperCase() as "A" | "C" | "G" | "T";

            if (!["A", "C", "G", "T"].includes(refBase) || !["A", "C", "G", "T"].includes(altBase)) {
              continue;
            }

            let phred: number | null = null;
            let raw: number | null = null;
            let topModality: string | null = null;

            for (const score of item.scores || []) {
              const scorerName = score?.variant_scorer?.name;
              if (scorerName === "AVI_SCORE") {
                if (score.scores?.length >= 4) {
                  const r = readFloat32Array(score.scores);
                  if (r.length > 0 && !isNaN(r[0])) raw = Number(r[0].toFixed(4));
                }
                if (score.calibrated_scores?.length >= 4) {
                  const c = readFloat32Array(score.calibrated_scores);
                  if (c.length > 0 && !isNaN(c[0])) {
                    const { phred: p } = cdfToPhred(c[0]);
                    phred = Number(p.toFixed(3));
                  }
                }
              } else if (scorerName === "AVI_SCORE_FEATURE_IMPORTANCE") {
                if (score.scores?.length >= 4) {
                  const fiFloats = readFloat32Array(score.scores);
                  let maxAbs = -1;
                  for (let i = 0; i < fiFloats.length; i++) {
                    const abs = Math.abs(fiFloats[i]);
                    if (abs > maxAbs) {
                      maxAbs = abs;
                      const rawKey = AVI_FEATURE_KEYS[i] || `MODALITY_${i + 1}`;
                      topModality = AVI_FEATURE_DISPLAY_MAP[rawKey] || rawKey;
                    }
                  }
                }
              }
            }

            if (!positionMap.has(pos)) {
              positionMap.set(pos, { ref: refBase, variants: {} });
            }

            const acmgStrength = calculateAlphaGenomeAcmgStrength(phred);
            positionMap.get(pos)!.variants[altBase] = {
              alt: altBase,
              phred,
              raw,
              acmgStrength,
              topModality
            };
          }

          const positions: AlphaGenomeSaturationPosition[] = [];
          for (const [pos, data] of Array.from(positionMap.entries()).sort((a, b) => a[0] - b[0])) {
            const variantValues = Object.values(data.variants);
            const phreds = variantValues.map((v) => v.phred).filter((p): p is number => p !== null && !isNaN(p));
            const meanPhred = phreds.length > 0 ? Number((phreds.reduce((a, b) => a + b, 0) / phreds.length).toFixed(3)) : null;
            const maxPhred = phreds.length > 0 ? Number(Math.max(...phreds).toFixed(3)) : null;

            // Pick the topModality corresponding to the variant with maxPhred
            let dominantModality: string | null = null;
            if (maxPhred !== null) {
              const dominantVariant = variantValues.find((v) => v.phred === maxPhred && v.topModality);
              dominantModality = dominantVariant?.topModality || variantValues.find((v) => v.topModality)?.topModality || null;
            }

            const isExonic = Boolean(
              params.exonStart && params.exonEnd
                ? pos >= params.exonStart && pos <= params.exonEnd
                : true
            );

            positions.push({
              pos,
              ref: data.ref,
              isExonic,
              variants: data.variants,
              meanPhred,
              maxPhred,
              topModality: dominantModality
            });
          }

          resolve({
            status: "live",
            chrom: normChrom,
            start: params.start,
            end: params.end,
            strand: params.strand || null,
            transcriptId: params.transcriptId || null,
            exonNumber: params.exonNumber || null,
            exonStart: params.exonStart || null,
            exonEnd: params.exonEnd || null,
            positions,
            atlasLocusUrl: locusUrl,
            message: null
          });
        } catch (parseErr: any) {
          reject(new Error(`Failed to parse AlphaGenome region response: ${parseErr.message}`));
        }
      }
    );

    if (options?.signal) {
      options.signal.addEventListener("abort", () => {
        aborted = true;
        try {
          call.cancel();
        } catch {
          // ignore
        }
        resolve({
          status: "unavailable",
          chrom: normChrom,
          start: params.start,
          end: params.end,
          strand: params.strand || null,
          transcriptId: params.transcriptId || null,
          exonNumber: params.exonNumber || null,
          exonStart: params.exonStart || null,
          exonEnd: params.exonEnd || null,
          positions: [],
          atlasLocusUrl: locusUrl,
          message: "AlphaGenome interval query was cancelled."
        });
      }, { once: true });
    }
  });
}

/**
 * Tests connectivity and authenticates an AlphaGenome Atlas API Key using ListVariantScoresMetadata.
 */
export async function verifyAlphaGenomeConnection(
  apiKey: string,
  timeoutMs = 5000
): Promise<{ ok: boolean; latencyMs: number; scorersCount?: number; error?: string }> {
  if (!apiKey || typeof apiKey !== "string" || apiKey.trim().length === 0) {
    return { ok: false, latencyMs: 0, error: "API key is required" };
  }

  const startTime = Date.now();
  const client = getAtlasGrpcClient();
  const metadata = new grpc.Metadata();
  metadata.set("x-goog-api-key", apiKey.trim());

  const deadline = new Date(Date.now() + timeoutMs);

  return new Promise((resolve) => {
    client.ListVariantScoresMetadata(
      { organism: "ORGANISM_HOMO_SAPIENS" },
      metadata,
      { deadline },
      (err: any, response: any) => {
        const latencyMs = Date.now() - startTime;
        if (err) {
          let errorMsg = err.details || err.message || "Unknown error connecting to AlphaGenome Atlas";
          if (err.code === grpc.status.UNAUTHENTICATED) {
            errorMsg = "API key is invalid or unauthorized.";
          } else if (err.code === grpc.status.PERMISSION_DENIED) {
            errorMsg = "API key lacks permission to query AlphaGenome Atlas.";
          } else if (err.code === grpc.status.DEADLINE_EXCEEDED) {
            errorMsg = "Connection to AlphaGenome Atlas timed out.";
          }
          return resolve({ ok: false, latencyMs, error: errorMsg });
        }

        const count = response?.variant_scorer_metadata?.length ?? 0;
        resolve({ ok: true, latencyMs, scorersCount: count });
      }
    );
  });
}
