import { z } from "zod";
import {
  translateVariantResponseSchema,
  nearestResiduesResponseSchema,
  pocketFinderResponseSchema,
  esmFoldResponseSchema,
  structuralAlignResponseSchema,
  structuralDiffResponseSchema,
  TranslateVariantResponse,
  NearestResiduesResponse,
  PocketFinderResponse,
  EsmFoldResponse,
  StructuralAlignResponse,
  StructuralDiffResponse
} from "../shared/contracts";
import type { PdbHomolog } from "../types";
import { extractErrorMessage, FetchWithAuth } from "./authSession";

export function createStructureApi(fetchWithAuth: FetchWithAuth) {
  return {
    async resolveGene(gene: string, signal?: AbortSignal): Promise<{ gene: string; uniprotId: string; pdbUrl?: string | null }> {
      const res = await fetchWithAuth("/api/v1/resolve-gene", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gene }),
        timeout: 10000,
        signal
      });
      if (!res.ok) {
        const errorMsg = await extractErrorMessage(res, "Failed to resolve gene");
        throw new Error(errorMsg);
      }
      return await res.json();
    },

    async translateVariant(variant: string, signal?: AbortSignal): Promise<TranslateVariantResponse> {
      const res = await fetchWithAuth("/api/v1/translate-variant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variant }),
        timeout: 10000,
        signal
      });
      if (!res.ok) {
        const errorMsg = await extractErrorMessage(res, "Failed to translate variant");
        throw new Error(errorMsg);
      }
      const data = await res.json();
      return translateVariantResponseSchema.parse(data);
    },

    async getSequence(uniprotId: string, signal?: AbortSignal): Promise<string> {
      const res = await fetchWithAuth(`/api/v1/sequence/${encodeURIComponent(uniprotId)}`, {
        timeout: 10000,
        signal
      });
      if (!res.ok) {
        const errorMsg = await extractErrorMessage(res, "Failed to fetch sequence");
        throw new Error(errorMsg);
      }
      const data = await res.json();
      return z.object({ sequence: z.string() }).parse(data).sequence;
    },

    async getPdb(uniprotId: string, pos?: number, signal?: AbortSignal): Promise<string> {
      const posQuery = pos ? `?pos=${pos}` : "";
      const res = await fetchWithAuth(`/api/v1/pdb/${encodeURIComponent(uniprotId)}${posQuery}`, {
        timeout: 15000,
        signal
      });
      if (!res.ok) {
        const errorMsg = await extractErrorMessage(res, "Failed to fetch PDB structure");
        throw new Error(errorMsg);
      }
      return await res.text();
    },

    async getAlphaFoldPdb(uniprotId: string, signal?: AbortSignal): Promise<string> {
      const res = await fetchWithAuth(`/api/v1/alphafold-pdb/${encodeURIComponent(uniprotId)}`, {
        timeout: 35000,
        signal
      });
      if (!res.ok) {
        const errorMsg = await extractErrorMessage(res, "Failed to fetch AlphaFold model");
        throw new Error(errorMsg);
      }
      return await res.text();
    },

    async getHomologs(uniprotId: string, pos?: number, signal?: AbortSignal): Promise<PdbHomolog[]> {
      const query = pos != null ? `?pos=${encodeURIComponent(pos)}` : "";
      const res = await fetchWithAuth(`/api/v1/homologs/${encodeURIComponent(uniprotId)}${query}`, {
        timeout: 20000,
        signal
      });
      if (!res.ok) {
        const errorMsg = await extractErrorMessage(res, "Failed to fetch homologs");
        throw new Error(errorMsg);
      }
      const data = await res.json();
      return z.object({ homologs: z.array(z.any()) }).parse(data).homologs as PdbHomolog[];
    },

    async getNearestResidues(params: { pdbText?: string, pdbRef?: string, uniprotId?: string, targetIndex: number, distanceThreshold: number, targetChain?: string }, signal?: AbortSignal): Promise<NearestResiduesResponse> {
      const res = await fetchWithAuth("/api/v1/nearest-residues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
        timeout: 10000,
        signal
      });
      if (!res.ok) {
        const errorMsg = await extractErrorMessage(res, "Failed to fetch nearest residues");
        throw new Error(errorMsg);
      }
      const data = await res.json();
      return nearestResiduesResponseSchema.parse(data);
    },

    async detectPocket(params: { pdbText?: string, pdbRef?: string, uniprotId?: string, targetIndex: number, targetChain?: string }, signal?: AbortSignal): Promise<PocketFinderResponse> {
      const res = await fetchWithAuth("/api/v1/pocket-detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
        timeout: 30000,
        signal
      });
      if (!res.ok) {
        const errorMsg = await extractErrorMessage(res, "Failed to detect binding pocket");
        throw new Error(errorMsg);
      }
      const initialData = await res.json();
      if (initialData.status === "queued" && initialData.pocketJobId) {
        let attempt = 0;
        const maxAttempts = 60;
        while (attempt < maxAttempts) {
          if (signal?.aborted) {
            throw new Error("Pocket detection query aborted by client.");
          }
          const jobRes = await fetchWithAuth(`/api/v1/pocket-job/${initialData.pocketJobId}`, {
            method: "GET",
            signal
          });
          if (!jobRes.ok) {
            const errorMsg = await extractErrorMessage(jobRes, "Failed to poll pocket job status");
            throw new Error(errorMsg);
          }
          const jobData = await jobRes.json();
          if (jobData.status === "completed") {
            return pocketFinderResponseSchema.parse(jobData.result);
          } else if (jobData.status === "failed") {
            throw new Error(jobData.error || "Pocket detection job failed.");
          }
          attempt++;
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
        throw new Error("Pocket detection job timed out on server.");
      }
      return pocketFinderResponseSchema.parse(initialData);
    },

    async findPocket(params: { pdbText?: string, pdbRef?: string, uniprotId?: string, targetIndex?: number, mutIndex?: number, targetChain?: string }, signal?: AbortSignal): Promise<PocketFinderResponse> {
      return this.detectPocket({
        ...params,
        targetIndex: params.targetIndex ?? params.mutIndex ?? 1
      }, signal);
    },

    async foldSequence(params: { sequence?: string, uniprotId?: string, variant?: string }, signal?: AbortSignal): Promise<EsmFoldResponse> {
      const res = await fetchWithAuth("/api/v1/esmfold", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
        timeout: 45000,
        signal
      });
      if (!res.ok) {
        const errorMsg = await extractErrorMessage(res, "Failed to run ESMFold");
        throw new Error(errorMsg);
      }
      const data = await res.json();
      return esmFoldResponseSchema.parse(data);
    },

    async structuralAlign(params: { pdb1: string, pdb2: string, targetIndex?: number, alignmentScope?: "local" | "global" }, signal?: AbortSignal): Promise<StructuralAlignResponse> {
      const res = await fetchWithAuth("/api/v1/structural-align", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
        timeout: 30000,
        signal
      });
      if (!res.ok) {
        const errorMsg = await extractErrorMessage(res, "Failed to align structures");
        throw new Error(errorMsg);
      }
      const data = await res.json();
      return structuralAlignResponseSchema.parse(data);
    },

    async getStructuralDiff(params: { wtPdb: string, mutPdb: string, pos: number, chain: string }, signal?: AbortSignal): Promise<StructuralDiffResponse> {
      const res = await fetchWithAuth("/api/v1/structural-diff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
        timeout: 30000,
        signal
      });
      if (!res.ok) {
        const errorMsg = await extractErrorMessage(res, "Failed to compute structural difference");
        throw new Error(errorMsg);
      }
      const data = await res.json();
      return structuralDiffResponseSchema.parse(data);
    }
  };
}
