import { describe, it, expect, beforeEach } from "vitest";
import { AnalysisDatabase } from "./analysis-db.ts";
import { EXPIRED_CACHE_RETENTION_MS } from "./analysis-db-core.ts";

describe("AnalysisDatabase (Persistent SQLite Store)", () => {
  let db: AnalysisDatabase;

  beforeEach(() => {
    db = AnalysisDatabase.resetInstance(":memory:");
  });

  it("saves and retrieves completed variant analysis payloads", () => {
    const payload = {
      ruleBasedInsights: { classification: "Pathogenic", criteria: ["PS3", "PM1"] },
      clinvar: { significance: "Pathogenic" },
      predictorData: { amPathogenicity: 0.95 }
    };

    const saved = db.saveVariantAnalysis({
      gene: "PAH",
      variant: "p.Arg408Trp",
      uniprotId: "P00439",
      pos: 408,
      wildType: "Arg",
      mutant: "Trp",
      acmgVerdict: "Pathogenic",
      payload,
      modelVersions: { esm3: "1.0", foldx: "5.0" }
    });

    expect(saved.id).toBeGreaterThan(0);
    expect(saved.gene).toBe("PAH");

    const retrieved = db.getVariantAnalysis("PAH", "p.Arg408Trp");
    expect(retrieved).toBeDefined();
    expect(retrieved?.acmgVerdict).toBe("Pathogenic");
    expect(retrieved?.payload.ruleBasedInsights.classification).toBe("Pathogenic");
    expect(retrieved?.modelVersions.esm3).toBe("1.0");
  });

  it("retires persisted constraint conclusions from earlier data releases, and from the retired PP2 rule", async () => {
    const save = (modelVersions?: Record<string, string>, gnomadConstraint: object = { missense_z: 3.09, pp2Code: null }) => db.saveVariantAnalysis({
      gene: "PAH", variant: "p.Arg408Trp", uniprotId: "P00439", pos: 408, wildType: "Arg", mutant: "Trp",
      acmgVerdict: "Uncertain", payload: { gnomadConstraint }, modelVersions,
    });
    save();
    expect(db.getVariantAnalysis("PAH", "p.Arg408Trp")).toBeNull();
    expect(await db.getVariantAnalysisAsync("PAH", "p.Arg408Trp")).toBeNull();
    save({ constraintRelease: "4.1.2" });
    expect(db.getVariantAnalysis("PAH", "p.Arg408Trp")).not.toBeNull();
    // The current release is not enough: a row written before PP2 was recalibrated carries no `pp2Code`
    // key at all, so its verdict replays a rule the engine no longer applies. It must be recomputed.
    save({ constraintRelease: "4.1.2" }, { missense_z: 3.09 });
    expect(db.getVariantAnalysis("PAH", "p.Arg408Trp")).toBeNull();
  });

  it("updates existing variant analysis upon rerun", () => {
    db.saveVariantAnalysis({
      gene: "PAH",
      variant: "p.Arg408Trp",
      uniprotId: "P00439",
      pos: 408,
      wildType: "Arg",
      mutant: "Trp",
      acmgVerdict: "Uncertain",
      payload: { v: 1 }
    });

    db.saveVariantAnalysis({
      gene: "PAH",
      variant: "p.Arg408Trp",
      uniprotId: "P00439",
      pos: 408,
      wildType: "Arg",
      mutant: "Trp",
      acmgVerdict: "Likely Pathogenic",
      payload: { v: 2 }
    });

    const retrieved = db.getVariantAnalysis("PAH", "p.Arg408Trp");
    expect(retrieved?.acmgVerdict).toBe("Likely Pathogenic");
    expect(retrieved?.payload.v).toBe(2);

    const recent = db.listRecentAnalyses(10);
    expect(recent.length).toBe(1);
  });

  it("isolates cached analyses with different ACMG weighting strategies", () => {
    db.saveVariantAnalysis({
      gene: "TP53",
      variant: "p.Arg175His",
      uniprotId: "P04637",
      pos: 175,
      wildType: "Arg",
      mutant: "His",
      acmgWeighting: "conservative",
      acmgVerdict: "Uncertain Significance",
      payload: { mode: "conservative" }
    });

    db.saveVariantAnalysis({
      gene: "TP53",
      variant: "p.Arg175His",
      uniprotId: "P04637",
      pos: 175,
      wildType: "Arg",
      mutant: "His",
      acmgWeighting: "strict-structural",
      acmgVerdict: "Likely Pathogenic",
      payload: { mode: "strict-structural" }
    });

    const conservative = db.getVariantAnalysis("TP53", "p.Arg175His", "conservative");
    const strict = db.getVariantAnalysis("TP53", "p.Arg175His", "strict-structural");

    expect(conservative?.acmgVerdict).toBe("Uncertain Significance");
    expect(conservative?.payload.mode).toBe("conservative");

    expect(strict?.acmgVerdict).toBe("Likely Pathogenic");
    expect(strict?.payload.mode).toBe("strict-structural");
  });

  it("stores and retrieves external data with provenance and TTL expiration", () => {
    db.saveExternalCache("clinvar_PAH_p.Arg408Trp", { clinicalSignificance: "Pathogenic" }, "ClinVar", 3600, '"etag-123"');

    const entry = db.getExternalCache("clinvar_PAH_p.Arg408Trp");
    expect(entry).toBeDefined();
    expect(entry?.data.clinicalSignificance).toBe("Pathogenic");
    expect(entry?.source).toBe("ClinVar");
    expect(entry?.etag).toBe('"etag-123"');
    expect(entry?.fetchedAt).toBeDefined();
  });

  it("purges entries expired past the retention window, and keeps recent ones for the stale-on-rate-limit read", () => {
    // Expired 100 s ago: kept (WP-I2), but invisible to an ordinary read.
    db.saveExternalCache("expired_key", { test: true }, "Test", -100);
    // Expired longer ago than the retention window: purged.
    db.saveExternalCache("ancient_key", { test: true }, "Test", -(EXPIRED_CACHE_RETENTION_MS / 1000 + 100));
    // Add active entry (+3600s TTL)
    db.saveExternalCache("active_key", { test: true }, "Test", 3600);

    const purgedCount = db.purgeExpiredExternalCache();
    expect(purgedCount).toBe(1);

    expect(db.getExternalCache("ancient_key", true)).toBeNull();
    expect(db.getExternalCache("expired_key")).toBeNull();
    expect(db.getExternalCache("expired_key", true)?.data).toEqual({ test: true });
    expect(db.getExternalCache("active_key")).toBeDefined();
  });

  it("enforces TTL expiration on stored variant analyses", () => {
    db.saveVariantAnalysis({
      gene: "BRCA1",
      variant: "p.Cys61Gly",
      uniprotId: "P38398",
      pos: 61,
      wildType: "Cys",
      mutant: "Gly",
      acmgVerdict: "Pathogenic",
      payload: { test: 123 }
    });

    // Valid within 10s TTL
    const active = db.getVariantAnalysis("BRCA1", "p.Cys61Gly", "standard", { maxAgeMs: 10000 });
    expect(active).toBeDefined();
    expect(active?.gene).toBe("BRCA1");

    // Expired with 0ms TTL
    const expired = db.getVariantAnalysis("BRCA1", "p.Cys61Gly", "standard", { maxAgeMs: -1 });
    expect(expired).toBeNull();
  });

  it("invalidates cached analyses on pipeline version mismatch", () => {
    db.saveVariantAnalysis({
      gene: "BRCA1",
      variant: "p.Cys61Gly",
      uniprotId: "P38398",
      pos: 61,
      wildType: "Cys",
      mutant: "Gly",
      acmgVerdict: "Pathogenic",
      payload: { test: 123 },
      modelVersions: { version: "1.0.0" }
    });

    const matching = db.getVariantAnalysis("BRCA1", "p.Cys61Gly", "standard", { requiredVersion: "1.0.0" });
    expect(matching).toBeDefined();

    const mismatched = db.getVariantAnalysis("BRCA1", "p.Cys61Gly", "standard", { requiredVersion: "2.0.0" });
    expect(mismatched).toBeNull();
  });

  it("supports forceRefresh to bypass cache", () => {
    db.saveVariantAnalysis({
      gene: "BRCA1",
      variant: "p.Cys61Gly",
      uniprotId: "P38398",
      pos: 61,
      wildType: "Cys",
      mutant: "Gly",
      acmgVerdict: "Pathogenic",
      payload: { test: 123 }
    });

    const bypassed = db.getVariantAnalysis("BRCA1", "p.Cys61Gly", "standard", { forceRefresh: true });
    expect(bypassed).toBeNull();
  });

  it("optimizes listRecentAnalyses with lightweight projections", () => {
    db.saveVariantAnalysis({
      gene: "TTN",
      variant: "p.Ala123Val",
      uniprotId: "Q8WZ42",
      pos: 123,
      wildType: "Ala",
      mutant: "Val",
      acmgVerdict: "VUS",
      payload: { largeSequence: "A".repeat(34000) }
    });

    // Default lightweight projection (omits payload parsing)
    const summaries = db.listRecentAnalysesSummary(10);
    expect(summaries.length).toBe(1);
    expect(summaries[0].gene).toBe("TTN");
    expect((summaries[0] as any).payload).toBeUndefined();

    // Full projection when requested
    const full = db.listRecentAnalyses(10, 0, true);
    expect(full.length).toBe(1);
    expect(full[0].payload.largeSequence).toBeDefined();
  });

  it("records schema_version on external_cache and purges outdated schema versions", () => {
    db.saveExternalCache("key_v3", { score: 100 }, "dbnsfp", 3600, undefined, "v3");
    db.saveExternalCache("key_v2", { score: 50 }, "dbnsfp", 3600, undefined, "v2");

    expect(db.getExternalCache("key_v3")).toBeDefined();
    expect(db.getExternalCache("key_v2")).toBeDefined();

    const purgedCount = db.purgeOutdatedSchemaExternalCache("v3");
    expect(purgedCount).toBe(1);

    expect(db.getExternalCache("key_v3")).toBeDefined();
    expect(db.getExternalCache("key_v2")).toBeNull();
  });

  it("supports non-blocking async operations that yield the event loop", async () => {
    const saved = await db.saveVariantAnalysisAsync({
      gene: "BRCA1",
      variant: "p.Cys61Gly",
      uniprotId: "P38398",
      pos: 61,
      wildType: "Cys",
      mutant: "Gly",
      acmgVerdict: "Pathogenic",
      payload: { asyncTest: true }
    });
    expect(saved.id).toBeGreaterThan(0);

    const retrieved = await db.getVariantAnalysisAsync("BRCA1", "p.Cys61Gly");
    expect(retrieved?.acmgVerdict).toBe("Pathogenic");
    expect(retrieved?.payload.asyncTest).toBe(true);

    await db.saveExternalCacheAsync("async_cache_key", { data: "async_value" }, "uniprot", 3600);
    const cached = await db.getExternalCacheAsync("async_cache_key");
    expect(cached?.data.data).toBe("async_value");

    const recentAsync = await db.listRecentAnalysesAsync(10);
    expect(recentAsync.length).toBeGreaterThan(0);
    expect(recentAsync[0].gene).toBe("BRCA1");

    const recentFullAsync = await db.listRecentAnalysesAsync(10, 0, true);
    expect(recentFullAsync.length).toBeGreaterThan(0);
    expect((recentFullAsync[0] as any).payload.asyncTest).toBe(true);
  });

  it("executes async operations against disk-backed DB via worker pool", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const os = await import("os");
    const tmpDir = path.join(os.tmpdir(), `test-analysis-db-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const tmpDbPath = path.join(tmpDir, "test.sqlite");

    try {
      const diskDb = AnalysisDatabase.resetInstance(tmpDbPath);

      const saved = await diskDb.saveVariantAnalysisAsync({
        gene: "LDLR",
        variant: "p.Cys646Tyr",
        uniprotId: "P01130",
        pos: 646,
        wildType: "Cys",
        mutant: "Tyr",
        acmgVerdict: "Pathogenic",
        payload: { source: "worker-pool-test" }
      });
      expect(saved.id).toBeGreaterThan(0);

      const retrieved = await diskDb.getVariantAnalysisAsync("LDLR", "p.Cys646Tyr");
      expect(retrieved).toBeDefined();
      expect(retrieved?.gene).toBe("LDLR");
      expect(retrieved?.payload.source).toBe("worker-pool-test");

      await diskDb.saveExternalCacheAsync("worker_test_key", { result: "ok" }, "test", 60);
      const cached = await diskDb.getExternalCacheAsync("worker_test_key");
      expect(cached?.data.result).toBe("ok");

      const list = await diskDb.listRecentAnalysesAsync(5);
      expect(list.length).toBe(1);
      expect(list[0].gene).toBe("LDLR");
    } finally {
      AnalysisDatabase.resetInstance(":memory:");
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (_) {}
    }
  });
});
