import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveStructure } from "./structure-resolver.ts";
import { AnalysisDatabase } from "../infra/analysis-db.ts";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE TIER CHOICE IS REMEMBERED
 * ─────────────────────────────────────────────────────────────────────────────
 * The ladder is ordered but its outcome is decided by the network: a Tier 1 lookup that times out
 * once falls through to AlphaFold, and the next run picks the experimental structure. That flip is
 * expensive rather than cosmetic — a 305-residue experimental chain is repaired by FoldX RepairPDB
 * (measured: 205.4 s) while an 875-residue AlphaFold model is past the repair size guard and is not
 * repaired at all (measured: 5.1 s total) — and it changes the FoldX cache key (a hash of the PDB
 * text), so each flip re-ran the whole force-field job. Two cache entries for one mutation in
 * `logs/foldx_cache` are exactly this.
 *
 * The memo must also never become a trap: a total failure is not a decision and has to be retried,
 * and a memoised tier whose coordinates have genuinely disappeared must re-resolve rather than
 * return null forever.
 */

vi.mock("./structure-fetcher.ts", () => ({
  fetchBestPdbStructure: vi.fn(),
  fetchAlphafoldPdb: vi.fn(),
  fetchPdbFromRcsb: vi.fn(),
  fetchPdbHomologs: vi.fn(),
  fetchVerifiedExperimentalChain: vi.fn(),
  getResolvedAlphafoldVersion: vi.fn(() => "v4")
}));

const fetchers = await import("./structure-fetcher.ts");

const tierOneMapping = { pdbId: "1PAH", chainId: "A", unpStart: 1, structStart: 1, resolution: 1.8 };

describe("resolveStructure tier determinism", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The memo is module-level and, worse, persisted to L2. An in-memory DB per test keeps a row
    // written earlier in this file (or by a slower concurrent run) from answering a later test.
    AnalysisDatabase.resetInstance(":memory:");
    vi.mocked(fetchers.fetchPdbFromRcsb).mockResolvedValue("EXPERIMENTAL_PDB");
    vi.mocked(fetchers.fetchAlphafoldPdb).mockResolvedValue("ALPHAFOLD_PDB");
    vi.mocked(fetchers.fetchPdbHomologs).mockResolvedValue([]);
    vi.mocked(fetchers.fetchVerifiedExperimentalChain).mockResolvedValue({
      pdbText: "EXPERIMENTAL_PDB",
      validatedAt: 1
    } as any);
    vi.mocked(fetchers.getResolvedAlphafoldVersion).mockReturnValue("v4");
  });

  it("keeps using the tier that first answered, even after the ladder would now choose another", async () => {
    vi.mocked(fetchers.fetchBestPdbStructure).mockRejectedValueOnce(new Error("PDBe timeout"));
    vi.mocked(fetchers.fetchAlphafoldPdb).mockResolvedValue("ALPHAFOLD_PDB");

    const first = await resolveStructure("TIERMEMO1", 489);
    expect(first?.provenance.source).toBe("alphafold");
    expect(first?.pdbText).toBe("ALPHAFOLD_PDB");
    // The probe hands its coordinates straight to the caller, so a miss costs one fetch per tier.
    expect(fetchers.fetchAlphafoldPdb).toHaveBeenCalledTimes(1);

    // Network recovers: Tier 1 would now win. The memo keeps the choice the FoldX cache knows about.
    vi.mocked(fetchers.fetchBestPdbStructure).mockResolvedValue(tierOneMapping as any);
    const second = await resolveStructure("TIERMEMO1", 489);

    expect(second?.provenance.source).toBe("alphafold");
    expect(second?.pdbText).toBe("ALPHAFOLD_PDB");
    expect(
      fetchers.fetchBestPdbStructure,
      "the memoised tier must be reused, not re-chosen"
    ).toHaveBeenCalledTimes(1);
  });

  it("memoises per position as well as per accession", async () => {
    vi.mocked(fetchers.fetchBestPdbStructure).mockResolvedValue(tierOneMapping as any);

    await resolveStructure("TIERMEMO2", 100);
    await resolveStructure("TIERMEMO2", 200);

    // A different position can legitimately resolve a different structure (coverage gating), so the
    // position is part of the key.
    expect(fetchers.fetchBestPdbStructure).toHaveBeenCalledTimes(2);
  });

  it("survives an in-process eviction, because the choice is persisted too", async () => {
    vi.mocked(fetchers.fetchBestPdbStructure).mockRejectedValueOnce(new Error("PDBe timeout"));

    const first = await resolveStructure("TIERMEMO5", 42);
    expect(first?.provenance.source).toBe("alphafold");
    expect(fetchers.fetchBestPdbStructure).toHaveBeenCalledTimes(1);

    /**
     * Drop every in-memory cache — an L1 eviction, or a process restart, seen from the resolver's
     * point of view — and resolve again.
     *
     * The memo's whole claim is that a tier decided during a transient outage keeps winning rather
     * than silently flipping the template (a 5 s vs 205 s FoldX leg, and a new FoldX cache key). The
     * L1 alone cannot deliver that across a restart; this asserts the persistent half is real.
     */
    const { clearAllCaches } = await import("../infra/cache.ts");
    clearAllCaches(false); // in-memory only: the L2 `external_cache` row is the thing under test

    vi.mocked(fetchers.fetchBestPdbStructure).mockResolvedValue(tierOneMapping as any);
    const second = await resolveStructure("TIERMEMO5", 42);

    expect(second?.provenance.source, "the memoised tier was forgotten by an L1 eviction").toBe("alphafold");
    expect(
      fetchers.fetchBestPdbStructure,
      "the tier was re-chosen from the network after the memo was only in memory"
    ).toHaveBeenCalledTimes(1);
  });

  it("does not memoise a total failure", async () => {
    vi.mocked(fetchers.fetchBestPdbStructure).mockRejectedValue(new Error("PDBe down"));
    vi.mocked(fetchers.fetchAlphafoldPdb).mockResolvedValue(null as any);
    vi.mocked(fetchers.fetchPdbHomologs).mockResolvedValue([]);

    expect(await resolveStructure("TIERMEMO3", 10)).toBeNull();
    expect(await resolveStructure("TIERMEMO3", 10)).toBeNull();

    // Retried, because "nothing answered" is not a decision worth remembering for six hours.
    expect(fetchers.fetchBestPdbStructure).toHaveBeenCalledTimes(2);

    // ...and a later success is still picked up.
    vi.mocked(fetchers.fetchBestPdbStructure).mockResolvedValue(tierOneMapping as any);
    const recovered = await resolveStructure("TIERMEMO3", 10);
    expect(recovered?.provenance.source).toBe("experimental");
  });

  it("re-resolves when the memoised tier's coordinates are gone", async () => {
    vi.mocked(fetchers.fetchBestPdbStructure).mockResolvedValue(tierOneMapping as any);

    const first = await resolveStructure("TIERMEMO4", 5);
    expect(first?.pdbText).toBe("EXPERIMENTAL_PDB");

    // The chain no longer verifies; AlphaFold is now the only tier that can answer.
    vi.mocked(fetchers.fetchVerifiedExperimentalChain).mockResolvedValue(null as any);
    vi.mocked(fetchers.fetchBestPdbStructure).mockResolvedValue(null as any);
    const second = await resolveStructure("TIERMEMO4", 5);

    expect(second?.provenance.source).toBe("alphafold");
    expect(second?.pdbText).toBe("ALPHAFOLD_PDB");
  });

  it("does not serve a Tier-1 chain as UniProt-numbered when it fails residue verification", async () => {
    vi.mocked(fetchers.fetchBestPdbStructure).mockResolvedValue(tierOneMapping as any);
    vi.mocked(fetchers.fetchVerifiedExperimentalChain).mockResolvedValue(null as any);

    const resolved = await resolveStructure("TIERMEMO6", 489);

    // A segment-level PDBe shift that does not verify must not be presented as experimental, even
    // though an experimental entry exists — the predicted tier is the honest answer.
    expect(resolved?.provenance.source).toBe("alphafold");
    expect(resolved?.provenance.pdbId).toBeUndefined();
  });

  it("does not fabricate an AlphaFold version when the resolved URL names none", async () => {
    vi.mocked(fetchers.fetchBestPdbStructure).mockResolvedValue(null as any);
    vi.mocked(fetchers.getResolvedAlphafoldVersion).mockReturnValue(undefined as any);

    const resolved = await resolveStructure("TIERMEMO7", 10);

    expect(resolved?.provenance.source).toBe("alphafold");
    expect(resolved?.provenance.afdbVersion).toBeUndefined();
  });

  it("reports the version of the bytes re-materialised, not the memoised label", async () => {
    vi.mocked(fetchers.fetchBestPdbStructure).mockResolvedValue(null as any);
    // The probe records v4 (the release fetched then); between the two calls AlphaFold names v6.
    vi.mocked(fetchers.getResolvedAlphafoldVersion).mockReturnValueOnce("v4").mockReturnValue("v6");

    const first = await resolveStructure("TIERMEMO8", 10);
    expect(first?.provenance.afdbVersion).toBe("v4");

    const second = await resolveStructure("TIERMEMO8", 10);
    expect(second?.provenance.afdbVersion).toBe("v6");
  });

  it("loads the homolog chain the search actually matched, not chain A", async () => {
    vi.mocked(fetchers.fetchBestPdbStructure).mockResolvedValue(null as any);
    vi.mocked(fetchers.fetchAlphafoldPdb).mockResolvedValue(null as any);
    vi.mocked(fetchers.fetchPdbHomologs).mockResolvedValue([
      {
        pdbId: "5v3m", score: 0.9, identity: 60, coverage: 90, title: "t", organism: "Homo sapiens",
        method: "X-RAY DIFFRACTION", resolution: 2.0, isHuman: true, coversPosition: true, chainId: "C",
      } as any,
    ]);
    vi.mocked(fetchers.fetchPdbFromRcsb).mockResolvedValue("HOMOLOG_PDB");

    const resolved = await resolveStructure("TIERMEMO9", 100);

    expect(resolved?.provenance.source).toBe("homolog");
    expect(resolved?.provenance.chainId).toBe("C");
    expect(fetchers.fetchPdbFromRcsb).toHaveBeenCalledWith("5v3m", "C");
  });

  it("refuses a homolog with no entity→chain mapping rather than loading chain A", async () => {
    vi.mocked(fetchers.fetchBestPdbStructure).mockResolvedValue(null as any);
    vi.mocked(fetchers.fetchAlphafoldPdb).mockResolvedValue(null as any);
    vi.mocked(fetchers.fetchPdbHomologs).mockResolvedValue([
      {
        pdbId: "5v3m", score: 0.9, identity: 60, coverage: 90, title: "t", organism: "Homo sapiens",
        method: "X-RAY DIFFRACTION", resolution: 2.0, isHuman: true, coversPosition: true,
      } as any,
    ]);

    const resolved = await resolveStructure("TIERMEMO10", 100);

    expect(resolved).toBeNull();
    expect(fetchers.fetchPdbFromRcsb).not.toHaveBeenCalled();
  });
});
