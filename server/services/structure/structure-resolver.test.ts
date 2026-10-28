import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveStructure } from "./structure-resolver.ts";
import { AnalysisDatabase } from "../infra/analysis-db.ts";
import { noteRateLimited } from "../infra/cache-scope.ts";

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

// The resolver reads the canonical sequence to decide whether a verified experimental chain is the
// wild type. Tests supply it directly; a real fetch here would put the network inside a unit test.
vi.mock("../external-api/uniprot.ts", () => ({ fetchUniprotSequence: vi.fn() }));

const fetchers = await import("./structure-fetcher.ts");
const uniprot = await import("../external-api/uniprot.ts");

/** A one-chain ATOM file whose residues are the given one-letter sequence, numbered 1..n. */
function pdbForSequence(sequence: string, chain = "A"): string {
  return sequence
    .split("")
    .map((aa, i) => {
      const three = aa === "G" ? "GLY" : aa === "D" ? "ASP" : "ALA";
      const resSeq = String(i + 1).padStart(4);
      return `ATOM      1  CA  ${three} ${chain}${resSeq}      1.000   2.000   3.000  1.00 20.00           C`;
    })
    .join("\n");
}

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
    vi.mocked(uniprot.fetchUniprotSequence).mockResolvedValue(null as any);
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

  it("does not remember a fallback tier chosen while PDBe was limiting requests (WP-I2)", async () => {
    // PDBe's 429 is swallowed by the fetcher (null), so the ladder falls to AlphaFold. That choice says
    // nothing about the protein and must not be kept for six hours.
    vi.mocked(fetchers.fetchBestPdbStructure).mockImplementationOnce(async () => {
      noteRateLimited("www.ebi.ac.uk");
      return null;
    });
    const first = await resolveStructure("TIERLIMIT1", 489);
    expect(first?.provenance.source).toBe("alphafold");

    vi.mocked(fetchers.fetchBestPdbStructure).mockResolvedValue(tierOneMapping as any);
    const second = await resolveStructure("TIERLIMIT1", 489);
    expect(second?.pdbText).toBe("EXPERIMENTAL_PDB");
    expect(fetchers.fetchBestPdbStructure).toHaveBeenCalledTimes(2);
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

/**
 * UROD p.Gly318Arg: the best experimental entry (1R3S) is the D86G mutant. FoldX and the remote
 * ΔΔG engines MUTATE their template, so a chain that already carries a substitution is not a wild
 * type and must not be used for them. The AlphaFold model is used instead, and the provenance says
 * which entry was refused and why.
 */
describe("resolveStructure wild-type requirement", () => {
  const wildType = "A".repeat(85) + "D" + "A".repeat(14); // D86
  const crystal = pdbForSequence("A".repeat(85) + "G" + "A".repeat(14)); // D86G

  beforeEach(() => {
    vi.clearAllMocks();
    AnalysisDatabase.resetInstance(":memory:");
    vi.mocked(uniprot.fetchUniprotSequence).mockResolvedValue(wildType);
    vi.mocked(fetchers.fetchBestPdbStructure).mockResolvedValue({ ...tierOneMapping, pdbId: "1R3S" } as any);
    vi.mocked(fetchers.fetchVerifiedExperimentalChain).mockResolvedValue({ pdbText: crystal, validatedAt: 1 } as any);
    vi.mocked(fetchers.fetchAlphafoldPdb).mockResolvedValue("ALPHAFOLD_PDB");
    vi.mocked(fetchers.fetchPdbFromRcsb).mockResolvedValue("EXPERIMENTAL_PDB");
    vi.mocked(fetchers.fetchPdbHomologs).mockResolvedValue([]);
    vi.mocked(fetchers.getResolvedAlphafoldVersion).mockReturnValue("v6");
  });

  it("keeps a mutant crystal for a view and discloses where it departs from UniProt", async () => {
    const resolved = await resolveStructure("WILDTYPE1", 318);

    expect(resolved?.provenance.source).toBe("experimental");
    expect(resolved?.provenance.pdbId).toBe("1R3S");
    expect(resolved?.provenance.sequenceDifferences).toEqual(["D86G"]);
    expect(resolved?.provenance.excludedExperimental).toBeUndefined();
  });

  it("refuses the mutant crystal for a mutating engine and falls to the AlphaFold model", async () => {
    const resolved = await resolveStructure("WILDTYPE1", 318, { requireWildType: true });

    expect(resolved?.provenance.source).toBe("alphafold");
    expect(resolved?.pdbText).toBe("ALPHAFOLD_PDB");
    expect(resolved?.provenance.excludedExperimental).toEqual({
      pdbId: "1R3S",
      chainId: "A",
      differences: ["D86G"],
    });
  });

  it("keeps a verified wild-type chain for a mutating engine (the gate's accept path)", async () => {
    vi.mocked(fetchers.fetchVerifiedExperimentalChain).mockResolvedValue({
      pdbText: pdbForSequence(wildType),
      validatedAt: 1,
    } as any);

    const resolved = await resolveStructure("WILDTYPE3", 318, { requireWildType: true });

    expect(resolved?.provenance.source).toBe("experimental");
    expect(resolved?.provenance.pdbId).toBe("1R3S");
    expect(resolved?.provenance.excludedExperimental).toBeUndefined();
    expect(resolved?.provenance.sequenceDifferences).toBeUndefined();
    expect(fetchers.fetchAlphafoldPdb).not.toHaveBeenCalled();
  });

  it("fails closed when the sequence cannot be fetched: a mutating engine gets AlphaFold with an 'unverified' record", async () => {
    vi.mocked(uniprot.fetchUniprotSequence).mockResolvedValue(null as any);

    const resolved = await resolveStructure("WILDTYPE4", 318, { requireWildType: true });

    expect(resolved?.provenance.source).toBe("alphafold");
    expect(resolved?.provenance.excludedExperimental).toEqual({
      pdbId: "1R3S",
      chainId: "A",
      differences: [],
      unverified: true,
    });
  });

  it("does not re-admit the refused entry through the Tier-3 homolog search when AlphaFold is down", async () => {
    vi.mocked(fetchers.fetchAlphafoldPdb).mockResolvedValue(null as any);
    vi.mocked(fetchers.fetchPdbHomologs).mockResolvedValue([
      // The refused crystal, returned by the same per-protein search at the top of the ranking.
      { pdbId: "1r3s", chainId: "A", identity: 100, resolution: 1.65, method: "X-RAY DIFFRACTION", organism: "Homo sapiens", coversPosition: true } as any,
      { pdbId: "5xyz", chainId: "B", identity: 60, resolution: 2.5, method: "X-RAY DIFFRACTION", organism: "Homo sapiens", coversPosition: true } as any,
    ]);
    vi.mocked(fetchers.fetchPdbFromRcsb).mockImplementation(async (pdbId: string) =>
      pdbId.toUpperCase() === "5XYZ" ? "HOMOLOG_PDB" : "SHOULD_NOT_BE_FETCHED"
    );

    const resolved = await resolveStructure("WILDTYPE5", 318, { requireWildType: true });

    expect(resolved?.provenance.source).toBe("homolog");
    expect(resolved?.provenance.pdbId).toBe("5xyz");
    expect(resolved?.pdbText).toBe("HOMOLOG_PDB");
    // The refusal is still disclosed on the template that was used.
    expect(resolved?.provenance.excludedExperimental?.differences).toEqual(["D86G"]);
    expect(fetchers.fetchPdbFromRcsb).not.toHaveBeenCalledWith("1r3s", "A");
  });

  it("memoises the two answers apart, so a view's crystal cannot be served to FoldX", async () => {
    const view = await resolveStructure("WILDTYPE2", 318);
    const mutating = await resolveStructure("WILDTYPE2", 318, { requireWildType: true });

    expect(view?.provenance.source).toBe("experimental");
    expect(mutating?.provenance.source).toBe("alphafold");
    expect(mutating?.provenance.excludedExperimental?.differences).toEqual(["D86G"]);
  });
});
