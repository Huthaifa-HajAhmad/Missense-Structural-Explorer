import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { queryGenosLandscape, queryGenosWebservice, __resetGenosPipelineForTests, __setGenosMinDelayMsForTests } from "./genos_web.ts";

describe("Genos Web Service (P0-2)", () => {
  const originalEmail = process.env.GENOS_EMAIL;
  const originalKey = process.env.GENOS_ACCESS_KEY;

  beforeEach(() => {
    vi.unstubAllGlobals();
    __resetGenosPipelineForTests();
    __setGenosMinDelayMsForTests(1); // No artificial wait in tests
    process.env.GENOS_EMAIL = "test@example.edu";
    process.env.GENOS_ACCESS_KEY = "test-access-key";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    __resetGenosPipelineForTests();
    if (originalEmail !== undefined) process.env.GENOS_EMAIL = originalEmail;
    else delete process.env.GENOS_EMAIL;
    if (originalKey !== undefined) process.env.GENOS_ACCESS_KEY = originalKey;
    else delete process.env.GENOS_ACCESS_KEY;
  });

  it("sends the academic non-commercial confirmation field in the login payload", async () => {
    // Reset the module-level session cache so login() actually fires, plus the serialized
    // queue so an earlier failed test's promise chain can't block this test.
    vi.resetModules();
    const { queryGenosWebservice: freshQuery, __resetGenosPipelineForTests, __setGenosMinDelayMsForTests } = await import("./genos_web.ts");
    __resetGenosPipelineForTests();
    __setGenosMinDelayMsForTests(1);

    const requests: { url: string; body: string }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: any, init: any) => {
      const u = String(url);
      requests.push({ url: u, body: init?.body ?? "" });

      if (u.includes("/api/login")) {
        return new Response(null, {
          status: 200,
          headers: { "set-cookie": "genos_session=abc123; Path=/" }
        });
      }
      if (u.endsWith("/api/query")) {
        return new Response(JSON.stringify({
          query_id: "q1",
          tabs: {
            function_prediction: { rows: [{ "pos(1-based)": 1, ref: "A", alt: "G", aapos: 10, REVEL_score: "0.5" }] },
            conservative_scores: { rows: [{ "pos(1-based)": 1, ref: "A", alt: "G", "GERP++_RS": "2.0", phyloP100way_vertebrate: "1.1" }] },
            allele_frequency: { rows: [{ "pos(1-based)": 1, ref: "A", alt: "G", AllofUs_ALL_AC: 1, AllofUs_ALL_AN: 2, AllofUs_ALL_het: 1, AllofUs_ALL_hom: 0 }] }
          }
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      // Per-table pagination or any other Genos request: mock a benign empty payload.
      if (u.includes("/api/query/")) {
        return new Response(JSON.stringify({ rows: [], total_rows: 0 }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    }));

    await freshQuery("PAH", "p.Arg261Gln");

    const loginReq = requests.find(r => r.url.includes("/api/login"));
    expect(loginReq, "a login request must be issued").toBeTruthy();

    const body = JSON.parse(loginReq!.body);
    // P0-2: Genos rejects the login without the non-commercial confirmation fields.
    // Field names verified empirically against the live API (see genos_web.ts comment).
    expect(body.user_type).toBe("academic");
    expect(body.email).toBe("test@example.edu");
    expect(body.access_key).toBe("test-access-key");
    expect(body.confirm_terms).toBe(true);
    expect(body.confirmed_non_commercial).toBe(true);
    expect(body.academic_use_confirmed).toBe(true);
  });

  it("returns [] gracefully when no reference sequence is given", async () => {
    vi.resetModules();
    const { queryGenosLandscape: freshQueryLandscape, __resetGenosPipelineForTests, __setGenosMinDelayMsForTests } = await import("./genos_web.ts");
    __resetGenosPipelineForTests();
    __setGenosMinDelayMsForTests(1);
    // Without reference sequence the service must not attempt any Genos request.
    const rows = await freshQueryLandscape("PAH");
    expect(rows).toEqual([]);
  });

  it("returns [] gracefully when Genos login responds 400", async () => {
    vi.resetModules();
    const { queryGenosLandscape: freshQuery, __resetGenosPipelineForTests, __setGenosMinDelayMsForTests } = await import("./genos_web.ts");
    __resetGenosPipelineForTests();
    __setGenosMinDelayMsForTests(1);

    vi.stubGlobal("fetch", vi.fn(async (url: any) => {
      const u = String(url);
      if (u.includes("/api/login")) {
        // Simulate the regression: server demands a confirmation field the client omitted
        return new Response(
          JSON.stringify({ detail: "Academic, non-commercial use must be confirmed to sign in." }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }
      throw new Error(`Unexpected fetch to ${u}`);
    }));

    // Must not throw — callers fall back to myvariant.info.
    const rows = await freshQuery("GZF1", 1, 3, "MKT"); // small window to force queries after failed login
    expect(rows).toEqual([]);
  });

  it("enumerates windowed missense substitutions and joins function_prediction + conservative_scores", async () => {
    vi.resetModules();
    const { queryGenosLandscape: freshQuery, __resetGenosPipelineForTests, __setGenosMinDelayMsForTests } = await import("./genos_web.ts");
    __resetGenosPipelineForTests();
    __setGenosMinDelayMsForTests(1);

    const bodies: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: any, init: any) => {
      const u = String(url);
      if (init?.body) bodies.push(String(init.body));

      if (u.includes("/api/login")) {
        return new Response(null, { status: 200, headers: { "set-cookie": "genos_session=tok; Path=/" } });
      }
      if (u.endsWith("/api/query")) {
        return new Response(JSON.stringify({
          query_id: "qq",
          tabs: {
            function_prediction: {
              total_rows: 2,
              rows: [
                { chr: "12", "pos(1-based)": 100, ref: "A", alt: "G", aapos: "1", REVEL_score: "0.42", ESM1b_score: "0.01", popEVE_score: "0.33" },
                { chr: "12", "pos(1-based)": 101, ref: "C", alt: "T", aapos: "2", REVEL_score: "0.5" }
              ]
            },
            conservative_scores: {
              total_rows: 2,
              rows: [
                { chr: "12", "pos(1-based)": 100, ref: "A", alt: "G", "GERP++_RS": "3.5", phyloP100way_vertebrate: "1.2" },
                { chr: "12", "pos(1-based)": 101, ref: "C", alt: "T", "GERP++_RS": "4.0", phyloP100way_vertebrate: "0.5" }
              ]
            }
          }
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      throw new Error(`Unexpected fetch to ${u}`);
    }));

    // Window residues 1-2 in a small sequence "MKT" — 2 × 19 = 38 substitutions are enumerated
    const rows = await freshQuery("PAH", 1, 2, "MKT");
    // The mock's two fixture rows have aapos=1 and aapos=2; each batch returns both rows
    // because the stub doesn't filter by GENE:p.change, so positional dedupe collapses them.
    expect(rows.length).toBe(2);
    const r100 = rows.find(r => r.pos === 1)!;
    const r101 = rows.find(r => r.pos === 2)!;
    expect(r100.revel).toBeCloseTo(0.42);
    expect(r100.gerp).toBeCloseTo(3.5);
    expect(r100.phylop).toBeCloseTo(1.2);
    expect(r101.revel).toBeCloseTo(0.5);
    expect(r101.gerp).toBeCloseTo(4.0);

    // Verify the requests sent GENE:p.change notation and the correct per-residue batching
    // (Genos rejects payloads with >19 substitutions; implementation maps one residue per request).
    const queryBodies = bodies
      .filter(b => b.includes("variants"))
      .map(b => JSON.parse(b))
      .filter(j => Array.isArray(j.variants));
    expect(queryBodies.length).toBe(2); // two residues -> two one-residue batches
    const allVariants = queryBodies.flatMap(j => j.variants);
    expect(allVariants.some((v: string) => v.startsWith("PAH:p.Met1"))).toBe(true);
    expect(allVariants.some((v: string) => v.startsWith("PAH:p.Lys2"))).toBe(true);
    for (const j of queryBodies) {
      expect(j.variants.length).toBe(19);
      expect(j.genome_build).toBe("hg38");
    }
  });

  it("returns null gracefully when credentials are absent", async () => {
    vi.resetModules();
    const { queryGenosWebservice: freshQuery, __resetGenosPipelineForTests, __setGenosMinDelayMsForTests } = await import("./genos_web.ts");
    __resetGenosPipelineForTests();
    __setGenosMinDelayMsForTests(1);

    delete process.env.GENOS_EMAIL;
    delete process.env.GENOS_ACCESS_KEY;

    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await freshQuery("GZF1", "p.Asp586Ala");
    expect(result).toBeNull();
    // Never attempted a network call without credentials
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fetches landscape rows via batched GENE:p.change when Genos is healthy", async () => {
    vi.resetModules();
    const { queryGenosLandscape: freshQuery, __resetGenosPipelineForTests, __setGenosMinDelayMsForTests } = await import("./genos_web.ts");
    __resetGenosPipelineForTests();
    __setGenosMinDelayMsForTests(1);

    vi.stubGlobal("fetch", vi.fn(async (url: any, init: any) => {
      const u = String(url);
      if (u.includes("/api/login")) {
        return new Response(null, { status: 200, headers: { "set-cookie": "genos_session=abc; Path=/" } });
      }
      if (u.endsWith("/api/query")) {
        return new Response(JSON.stringify({
          query_id: "qid-1",
          tabs: {
            function_prediction: {
              total_rows: 1,
              rows: [{
                chr: "10", "pos(1-based)": 1000, ref: "A", alt: "G",
                aapos: "586", REVEL_score: "0.42",
                ESM1b_score: "0.01", popEVE_score: "0.33"
              }]
            },
            conservative_scores: {
              total_rows: 1,
              rows: [{
                chr: "10", "pos(1-based)": 1000, ref: "A", alt: "G",
                "GERP++_RS": "3.5", phyloP100way_vertebrate: "1.2"
              }]
            }
          }
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      throw new Error(`Unexpected fetch to ${u}`);
    }));

    // 19 missense substitutions at position 586; Genos returns one representative row.
    // Provide a sequence with known residue 586 to avoid simply registering "no hits".
    const seq = "M".repeat(585) + "D"; // 'D' matches GZF1:p.Asp586...
    const rows = await freshQuery("GZF1", 586, 586, seq);
    expect(rows.length).toBeGreaterThan(0);
    const row = rows[0];
    expect(row.pos).toBe(586);
    expect(row.revel).toBeCloseTo(0.42);
    expect(row.gerp).toBeCloseTo(3.5);
    expect(row.phylop).toBeCloseTo(1.2);
  });

  it("does not remember a window in which a batch failed (WP-I2)", async () => {
    vi.resetModules();
    const { queryGenosLandscape: freshQuery, __resetGenosPipelineForTests, __setGenosMinDelayMsForTests } = await import("./genos_web.ts");
    __resetGenosPipelineForTests();
    __setGenosMinDelayMsForTests(1);
    let queries = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: any) => {
      const u = String(url);
      if (u.includes("/api/login")) {
        return new Response(null, { status: 200, headers: { "set-cookie": "genos_session=abc; Path=/" } });
      }
      if (u.endsWith("/api/query")) {
        queries++;
        throw new TypeError("fetch failed");
      }
      throw new Error(`Unexpected fetch to ${u}`);
    }));
    const seq = "M".repeat(585) + "D";
    await freshQuery("GZF1", 586, 586, seq);
    const afterFirst = queries;
    expect(afterFirst).toBeGreaterThan(0);
    await freshQuery("GZF1", 586, 586, seq);
    expect(queries).toBeGreaterThan(afterFirst);
  });

  it("recovers aapos from chunkPos when Genos response rows omit aapos/aapos(1-based)", async () => {
    vi.resetModules();
    const { queryGenosLandscape: freshQuery, __resetGenosPipelineForTests, __setGenosMinDelayMsForTests } = await import("./genos_web.ts");
    __resetGenosPipelineForTests();
    __setGenosMinDelayMsForTests(1);

    vi.stubGlobal("fetch", vi.fn(async (url: any, init: any) => {
      const u = String(url);
      if (u.includes("/api/login")) {
        return new Response(null, { status: 200, headers: { "set-cookie": "genos_session=abc; Path=/" } });
      }
      if (u.endsWith("/api/query")) {
        return new Response(JSON.stringify({
          query_id: "qid-1",
          tabs: {
            function_prediction: {
              total_rows: 1,
              rows: [{
                chr: "10", "pos(1-based)": 1000, ref: "A", alt: "G",
                REVEL_score: "0.42"
              }]
            },
            conservative_scores: {
              total_rows: 1,
              rows: [{
                chr: "10", "pos(1-based)": 1000, ref: "A", alt: "G",
                "GERP++_RS": "3.5"
              }]
            }
          }
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      throw new Error(`Unexpected fetch to ${u}`);
    }));

    const seq = "M".repeat(585) + "D";
    const rows = await freshQuery("GZF1", 586, 586, seq);
    expect(rows.length).toBeGreaterThan(0);
    const row = rows[0];
    expect(row.pos).toBe(586);
    expect(row.revel).toBeCloseTo(0.42);
    expect(row.gerp).toBeCloseTo(3.5);
  });

  it("batches large ranges (>50 residues) into smaller chunks and merges them", async () => {
    vi.resetModules();
    const { queryGenosLandscape: freshQuery, __resetGenosPipelineForTests, __setGenosMinDelayMsForTests } = await import("./genos_web.ts");
    __resetGenosPipelineForTests();
    __setGenosMinDelayMsForTests(1);

    vi.stubGlobal("fetch", vi.fn(async (url: any, init: any) => {
      const u = String(url);
      if (u.includes("/api/login")) {
        return new Response(null, { status: 200, headers: { "set-cookie": "genos_session=abc; Path=/" } });
      }
      if (u.endsWith("/api/query")) {
        const body = JSON.parse(init.body);
        const match = body.variants[0].match(/:p\.[A-Za-z]+(\d+)/);
        const pos = parseInt(match[1]);
        return new Response(JSON.stringify({
          query_id: `qid-${pos}`,
          tabs: {
            function_prediction: {
              total_rows: 1,
              rows: [{
                chr: "10", "pos(1-based)": pos * 2, ref: "A", alt: "G",
                REVEL_score: "0.42"
              }]
            },
            conservative_scores: {
              total_rows: 1,
              rows: [{
                chr: "10", "pos(1-based)": pos * 2, ref: "A", alt: "G",
                "GERP++_RS": "3.5"
              }]
            }
          }
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      throw new Error(`Unexpected fetch to ${u}`);
    }));

    const seq = "M".repeat(100);
    const rows = await freshQuery("GZF1", 1, 60, seq);
    expect(rows.length).toBeGreaterThan(0);
    const positions = rows.map(r => r.pos);
    expect(positions).toContain(1);
    expect(positions).toContain(60);
  });
});
