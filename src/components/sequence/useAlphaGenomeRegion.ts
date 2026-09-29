import { useEffect, useMemo, useRef, useState } from "react";
import { useApiClient } from "../../apiClient";
import type { AlphaGenomeRegionSaturationResponse, AlphaGenomeSaturationPosition } from "../../shared/contracts";
import { buildSaturationRegion, type SaturationRegion } from "../../shared/alphagenomeRegion";
import { complementBase } from "../../shared/landscapeEvidence";

export interface AlphaGenomeRegionInput {
  chrom?: string | null;
  genomicPos?: number | null;
  spliceProximity?: any;
}

export interface AlphaGenomeRegionState {
  params: SaturationRegion | null;
  data: AlphaGenomeRegionSaturationResponse | null;
  /** In flight, or the frame between an interval resolving and its request starting. */
  pending: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * One AlphaGenome region query shared by the codon-aligned lane in the focus grid and the exon
 * panel, keyed to the genomic interval (not the fetch closure: a token refresh must not re-issue a
 * 5 kb request).
 */
export function useAlphaGenomeRegion({ chrom, genomicPos, spliceProximity }: AlphaGenomeRegionInput): AlphaGenomeRegionState {
  const { fetchWithAuth } = useApiClient();
  const fetchRef = useRef(fetchWithAuth);
  fetchRef.current = fetchWithAuth;
  const [data, setData] = useState<AlphaGenomeRegionSaturationResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const params = useMemo(
    () =>
      buildSaturationRegion({
        chrom: chrom || spliceProximity?.chrom,
        genomicPos,
        exonStart: spliceProximity?.exonStart,
        exonEnd: spliceProximity?.exonEnd,
        exonNumber: spliceProximity?.exonNumber,
        strand: spliceProximity?.strand,
        transcriptId: spliceProximity?.transcriptId
      }),
    [chrom, genomicPos, spliceProximity]
  );

  useEffect(() => {
    let active = true;
    setData(null);
    if (!params) {
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const response = await fetchRef.current("/api/v1/alphagenome/region-saturation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params)
        });
        if (!response.ok) throw new Error(`Server returned ${response.status}: ${response.statusText}`);
        const json: AlphaGenomeRegionSaturationResponse = await response.json();
        if (active) setData(json);
      } catch (err: any) {
        if (active) {
          console.warn("[AlphaGenome region] Query failed:", err);
          setError(err?.message || "Failed to load regional AlphaGenome data");
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [params, reloadKey]);

  return {
    params,
    data,
    pending: loading || (params !== null && data === null && error === null),
    error,
    reload: () => setReloadKey((k) => k + 1)
  };
}

export interface CodonNucleotide {
  /** Genomic (+ strand) position and data. */
  position: AlphaGenomeSaturationPosition;
  /** Reference base on the coding strand. */
  codingRef: string;
}

/**
 * Residue → its three nucleotides in codon order, on the coding strand. Only complete codons are
 * returned; a codon split by an exon edge the region does not cover is left out rather than drawn
 * with a missing base.
 */
export function codonsByResidue(
  positions: AlphaGenomeSaturationPosition[] | undefined,
  strand: "+" | "-" | null | undefined
): Map<number, CodonNucleotide[]> {
  const out = new Map<number, CodonNucleotide[]>();
  const byResidue = new Map<number, AlphaGenomeSaturationPosition[]>();
  for (const p of positions ?? []) {
    if (typeof p.codonIndex !== "number" || typeof p.codonPosition !== "number") continue;
    const list = byResidue.get(p.codonIndex) ?? [];
    list.push(p);
    byResidue.set(p.codonIndex, list);
  }
  for (const [residue, list] of byResidue) {
    const sorted = [...list].sort((a, b) => (a.codonPosition ?? 0) - (b.codonPosition ?? 0));
    if (sorted.length !== 3 || sorted.some((p, i) => p.codonPosition !== i + 1)) continue;
    out.set(
      residue,
      sorted.map((position) => ({ position, codingRef: strand === "-" ? complementBase(position.ref) : position.ref }))
    );
  }
  return out;
}
