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
 * Bands the AVI Phred rank with the app's own cut-points (`THRESHOLDS.alphagenome`), named like ACMG
 * strengths for wire compatibility only.
 *
 * This is NOT a ClinGen SVI calibration: none exists for the AVI, and AlphaMissense is one of its own
 * features. The rule engine never reads it (`evaluateAlphaGenomeAvi` is informational and votes for
 * nothing), and no surface may present it as PP3/BP4 evidence. Treat the string as a display band of
 * the rank; the field keeps its name because it is part of the persisted payload contract.
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

/**
 * Loads the proto and opens the shared Atlas channel (DNS, TLS, HTTP/2) before the first user request, so
 * that request does not pay the cold-start cost. Resolves true once the channel is READY, false if it is
 * not ready within `timeoutMs`. Never rejects: a failed warm-up only means the first request connects itself.
 */
export function warmAtlasGrpcChannel(timeoutMs = 15000): Promise<boolean> {
  if (customClientFactory) return Promise.resolve(false);
  let channel: any;
  try {
    channel = getAtlasGrpcClient().getChannel();
  } catch {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    const deadline = new Date(Date.now() + timeoutMs);
    const step = (): void => {
      const state = channel.getConnectivityState(true);
      if (state === grpc.connectivityState.READY) return resolve(true);
      channel.watchConnectivityState(state, deadline, (err?: Error) => (err ? resolve(false) : step()));
    };
    step();
  });
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

export const ALPHAGENOME_INTERVAL_CHUNK_SIZE = 32;

export const ALPHAGENOME_LIST_DENSE_FIELD_MASKS = [
  "interval",
  "next_page_token",
  "variant_scores.variant",
  "variant_scores.scores.variant_scorer",
  "variant_scores.scores.metadata.gene_scorers",
  "variant_scores.scores.shape",
  "variant_scores.scores.scores",
  "variant_scores.scores.calibrated_scores"
].join(",");

export function resolveStrandEnum(strand?: string | null): "STRAND_POSITIVE" | "STRAND_NEGATIVE" | "STRAND_UNSTRANDED" {
  if (strand === "+") return "STRAND_POSITIVE";
  if (strand === "-") return "STRAND_NEGATIVE";
  return "STRAND_UNSTRANDED";
}

/**
 * Queries AlphaGenome Atlas ListDenseVariantScores across a genomic interval.
 * Automatically partitions the genomic window into <= 32-bp sub-intervals matching DeepMind server constraints,
 * maps strand enums, attaches field masks, handles pagination, and executes over multiplexed HTTP/2 streams.
 */
export async function queryAlphaGenomeRegionGrpc(
  params: AlphaGenomeRegionSaturationRequest,
  apiKey: string,
  options?: GrpcQueryOptions
): Promise<AlphaGenomeRegionSaturationResponse> {
  const rawChrom = (params.chrom || "").trim().toLowerCase();
  const normChrom = rawChrom.startsWith("chr") ? rawChrom : `chr${rawChrom}`;
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
  metadata.set("x-goog-fieldmask", ALPHAGENOME_LIST_DENSE_FIELD_MASKS);

  const strandEnum = resolveStrandEnum(params.strand);
  const start0 = Math.max(0, params.start - 1);
  const end0 = params.end;
  const totalWidth = end0 - start0;

  if (totalWidth <= 0) {
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
      message: "Invalid genomic interval coordinates: start must be <= end"
    };
  }

  // Partition into <= 32-bp sub-intervals (DeepMind Atlas RPC chunk limit)
  const subIntervals: Array<{ start: number; end: number }> = [];
  for (let offset = 0; offset < totalWidth; offset += ALPHAGENOME_INTERVAL_CHUNK_SIZE) {
    subIntervals.push({
      start: start0 + offset,
      end: Math.min(start0 + offset + ALPHAGENOME_INTERVAL_CHUNK_SIZE, end0)
    });
  }

  const timeoutMs = options?.timeoutMs ?? 10000;
  const deadline = new Date(Date.now() + timeoutMs);

  const fetchSubInterval = async (sub: { start: number; end: number }): Promise<any[]> => {
    const subScores: any[] = [];
    let pageToken: string | undefined = undefined;

    while (true) {
      if (options?.signal?.aborted) {
        throw new Error("AlphaGenome query was cancelled.");
      }

      const request: any = {
        interval: {
          chromosome: normChrom,
          start: sub.start,
          end: sub.end,
          strand: strandEnum
        },
        organism: "ORGANISM_HOMO_SAPIENS",
        filter: 'scores.variant_scorer.name = "AVI_SCORE" OR scores.variant_scorer.name = "AVI_SCORE_FEATURE_IMPORTANCE"'
      };
      if (pageToken) {
        request.page_token = pageToken;
      }

      const res: any = await new Promise((resResolve, resReject) => {
        let callFinished = false;
        let onAbort: (() => void) | null = null;

        const cleanupListener = () => {
          if (onAbort && options?.signal) {
            options.signal.removeEventListener("abort", onAbort);
            onAbort = null;
          }
        };

        const call = client.ListDenseVariantScores(
          request,
          metadata,
          { deadline },
          (err: any, response: any) => {
            callFinished = true;
            cleanupListener();
            if (err) return resReject(err);
            resResolve(response);
          }
        );

        if (options?.signal) {
          onAbort = () => {
            if (!callFinished) {
              try { call.cancel(); } catch {}
              resReject(new Error("AlphaGenome query was cancelled."));
            }
          };
          options.signal.addEventListener("abort", onAbort, { once: true });
        }
      });

      const list = res?.variant_scores || [];
      subScores.push(...list);

      if (!res?.next_page_token) {
        break;
      }
      pageToken = res.next_page_token;
    }

    return subScores;
  };

  try {
    const allVariantScores: any[] = [];
    const MAX_WORKERS = 10;
    const queue = [...subIntervals];
    const workers: Promise<void>[] = [];

    for (let i = 0; i < Math.min(MAX_WORKERS, queue.length); i++) {
      workers.push(
        (async () => {
          while (queue.length > 0) {
            const nextSub = queue.shift();
            if (!nextSub) break;
            const scores = await fetchSubInterval(nextSub);
            allVariantScores.push(...scores);
          }
        })()
      );
    }

    await Promise.all(workers);

    const positionMap = new Map<number, {
      ref: "A" | "C" | "G" | "T";
      variants: Record<string, AlphaGenomeSaturationVariant>;
    }>();

    for (const item of allVariantScores) {
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
      const phreds = variantValues
        .map((v) => v.phred)
        .filter((p): p is number => p !== null && !isNaN(p) && p >= 0);
      const meanPhred = phreds.length > 0 ? Number((phreds.reduce((a, b) => a + b, 0) / phreds.length).toFixed(3)) : null;
      const maxPhred = phreds.length > 0 ? Number(Math.max(...phreds).toFixed(3)) : null;

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

    return {
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
    };
  } catch (err: any) {
    const errMsg = err.details || err.message || "Unknown gRPC error";
    if (errMsg.includes("cancelled") || options?.signal?.aborted) {
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
    if (err.code === grpc.status.UNAUTHENTICATED) {
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
        message: "AlphaGenome API Key is invalid or expired."
      };
    }
    if (err.code === grpc.status.PERMISSION_DENIED) {
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
        message: "AlphaGenome API Key lacks permission to query Atlas."
      };
    }
    if (err.code === grpc.status.DEADLINE_EXCEEDED) {
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
        message: "AlphaGenome Atlas query timed out."
      };
    }
    if (err.code === grpc.status.NOT_FOUND) {
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
        message: "Region not indexed in AlphaGenome Atlas."
      };
    }
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
      message: `AlphaGenome interval query failed: ${errMsg}`
    };
  }
}

/**
 * Tests connectivity and authenticates an AlphaGenome Atlas API Key using ListVariantScoresMetadata.
 */
export async function verifyAlphaGenomeConnection(
  apiKey: string,
  timeoutMs = 10000
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
            errorMsg = "Connection to AlphaGenome Atlas timed out (deadline exceeded). Verify outbound gRPC access to gdmscience.googleapis.com:443 and that your Google API key has AlphaGenome Atlas service access.";
          }
          return resolve({ ok: false, latencyMs, error: errorMsg });
        }

        const count = response?.variant_scorer_metadata?.length ?? 0;
        resolve({ ok: true, latencyMs, scorersCount: count });
      }
    );
  });
}
