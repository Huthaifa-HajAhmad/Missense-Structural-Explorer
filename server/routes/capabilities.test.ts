import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Server } from "http";
import type { AddressInfo } from "net";
import * as fs from "fs";
import { registerCapabilitiesRoutes } from "./capabilities.ts";
import { hasLoaderVerifiedRaspIndex, RASP_SQLITE_PATH } from "../services/stability/energy-models.ts";

/**
 * `/capabilities` had no test at all, and the gap showed in production terms: the route reported RaSP
 * as `ready` on the strength of the index's OWN completeness record — and that record endorses a
 * truncated index whose `rasp_index_meta` row survived the truncation. The shipped index was a
 * 35,000-of-8,770,220-row prefix. So the diagnostics screen called "ready" an index the loader
 * rejects, corroborating the very bug the screen exists to reveal.
 *
 * The payload already carried `indexCountsVerified` and nothing read it. These cases pin the rule that
 * replaces the claim: readiness requires the loader's own count of THIS file, and an uncounted index is
 * reported as unconfirmed rather than as broken or as ready.
 */

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  const router = express.Router();
  registerCapabilitiesRoutes(router);
  app.use("/api", router);
  await new Promise<void>(resolve => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

async function raspEntry(): Promise<any> {
  const res = await fetch(`${baseUrl}/api/capabilities`);
  expect(res.status, "the route must answer").toBe(200);
  const body: any = await res.json();
  const entry = body.engines?.find((e: any) => e.id === "rasp");
  expect(entry, "the RaSP capability entry must be present").toBeTruthy();
  return entry;
}

describe("GET /capabilities — RaSP readiness", () => {
  it("does not call an uncounted index ready", async () => {
    // Nothing has performed a RaSP lookup in this process, so nothing has counted the index — whatever
    // happens to be on disk. This is the state the route used to misreport.
    expect(hasLoaderVerifiedRaspIndex()).toBe(false);

    const rasp = await raspEntry();

    expect(rasp.status).toBe("unavailable");
    expect(rasp.details.indexCountsVerified).toBe(false);
    expect(rasp.details.databaseIndexed).toBe(false);
  });

  it("explains that readiness is UNCONFIRMED rather than saying the index is broken", async () => {
    const rasp = await raspEntry();

    expect(rasp.details.unavailableReason, "a not-ready entry must say why").toBeTruthy();

    if (fs.existsSync(RASP_SQLITE_PATH)) {
      // The record may well claim `usable: true` — that is exactly the claim the route no longer
      // trusts — so the reason must be the "unconfirmed" one, not a bare null and not a message
      // implying the index is missing or corrupt.
      expect(String(rasp.details.unavailableReason)).toMatch(/unconfirmed|not been verified/);
    }
  });

  it("still reports the index's own counts, and marks them unverified", async () => {
    // The numbers are useful on a diagnostics screen. Presenting them as CHECKED is what was wrong.
    const rasp = await raspEntry();

    expect(rasp.details.indexCountsVerified).toBe(false);
    expect(rasp.details).toHaveProperty("indexedVariants");
    expect(rasp.details).toHaveProperty("indexedProteins");
    expect(rasp.details.indexedVariants).not.toBeUndefined();
  });

  it("holds the invariant the bug violated: ready implies verified", async () => {
    const rasp = await raspEntry();

    if (rasp.status === "ready") {
      expect(
        rasp.details.indexCountsVerified,
        "an index reported ready must have been counted by the loader"
      ).toBe(true);
    }

    // And `databaseIndexed` can never be true for an uncounted index, which is the concrete state the
    // truncated deployment produced.
    expect(rasp.details.databaseIndexed).toBe(rasp.status === "ready");
  });
});
