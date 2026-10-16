import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import fs from "fs";
import os from "os";
import path from "path";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { apiRouter } from "../routes.ts";
import { adapterRegistry } from "../services/adapters/service-adapters.ts";
import type { HealthStatus } from "../services/adapters/types.ts";
import { CONFIG } from "../config.ts";
import { attachAlphaGenomeKeySource } from "./health.ts";
import { resolveFoldxReadiness } from "../services/stability/foldx/readiness.ts";

/**
 * FoldX readiness is decided once, by the same rules the runner applies, and the AlphaGenome row
 * says where its key came from. Each case here pins a way the old checks could say "ready" for an
 * engine that could not run, or hide a key the server does not hold.
 */

/** The size floor below which a file is a stub, not a FoldX program. */
const FOLDX_FLOOR = 1024 * 1024;
const TS = "2026-01-01T00:00:00.000Z";

const health = (over: Partial<HealthStatus> = {}): HealthStatus => ({
  healthy: true,
  latencyMs: 12,
  message: "ok",
  timestamp: TS,
  ...over,
});

const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform")!;
const originalArch = Object.getOwnPropertyDescriptor(process, "arch")!;

/** Pins the host, so these cases do not depend on the machine running them. */
function host(platform: "linux" | "win32", arch: "x64" | "arm64") {
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
  Object.defineProperty(process, "arch", { value: arch, configurable: true });
}

describe("resolveFoldxReadiness", () => {
  let root: string;
  let binary: string;
  const savedEnv = {
    FOLDX_BINARY: process.env.FOLDX_BINARY,
    BOX64_PATH: process.env.BOX64_PATH,
  };

  /**
   * Whether `rotabase.txt` exists anywhere. The repository's own `tools/foldx/` ships one and the
   * runner searches it, so without this stub the "parameter file missing" case would find the real
   * one and pass for the wrong reason.
   */
  function rotabase(present: boolean) {
    const realExists = fs.existsSync;
    vi.spyOn(fs, "existsSync").mockImplementation((p) => {
      const s = String(p);
      return s.endsWith("rotabase.txt") ? present : realExists(p);
    });
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "foldx-readiness-"));
    binary = path.join(root, "foldx_fake");
    fs.writeFileSync(binary, Buffer.alloc(FOLDX_FLOOR + 1));
    process.env.FOLDX_BINARY = binary;
    process.env.BOX64_PATH = path.join(root, "box64-not-installed");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(process, "platform", originalPlatform);
    Object.defineProperty(process, "arch", originalArch);
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("is ready when the program and its parameter file are present, on a host that runs it directly", () => {
    host("linux", "x64");
    rotabase(true);

    expect(resolveFoldxReadiness()).toMatchObject({
      ready: true,
      binaryFound: true,
      rotabasePresent: true,
      box64Required: false,
    });
  });

  it("is not ready without rotabase.txt, even though the program is installed", () => {
    // The old diagnostics scan read this as ready, and every job then failed in the runner.
    host("linux", "x64");
    rotabase(false);

    expect(resolveFoldxReadiness()).toMatchObject({
      ready: false,
      binaryFound: true,
      rotabasePresent: false,
    });
  });

  it("needs Box64 for an x86 program on an arm64 Linux host, and is ready once Box64 is there", () => {
    host("linux", "arm64");
    rotabase(true);

    expect(resolveFoldxReadiness()).toMatchObject({ ready: false, box64Required: true, box64Present: false });

    fs.writeFileSync(process.env.BOX64_PATH!, "");
    expect(resolveFoldxReadiness()).toMatchObject({ ready: true, box64Required: true, box64Present: true });
  });

  it("does not ask for Box64 on an arm64 host when the program is not installed", () => {
    // Nothing to emulate, so the missing emulator is not a reason the engine is unavailable.
    host("linux", "arm64");
    rotabase(true);
    process.env.FOLDX_BINARY = path.join(root, "missing");

    expect(resolveFoldxReadiness()).toMatchObject({ ready: false, binaryFound: false, box64Required: false });
  });

  it("does not treat a stub below the size floor as an installed program", () => {
    fs.writeFileSync(binary, "not a program");
    host("linux", "x64");
    rotabase(true);

    expect(resolveFoldxReadiness()).toMatchObject({ ready: false, binaryFound: false });
  });
});

describe("attachAlphaGenomeKeySource", () => {
  it("records the key source on the AlphaGenome entry without touching the others", () => {
    const probed = { alphagenome: health({ healthy: false, message: "Standby (API Key Required)" }), clinvar: health() };

    const result = attachAlphaGenomeKeySource(probed, "none");

    expect(result.alphagenome).toMatchObject({ healthy: false, message: "Standby (API Key Required)", keySource: "none" });
    expect(result.clinvar).toEqual(probed.clinvar);
  });

  it("leaves the probed record unchanged, because the adapter's cache is shared", () => {
    const probed = { alphagenome: health() };

    attachAlphaGenomeKeySource(probed, "server");

    expect(probed.alphagenome).not.toHaveProperty("keySource");
  });

  it("adds nothing when the payload has no AlphaGenome entry", () => {
    const result = attachAlphaGenomeKeySource({ clinvar: health() }, "none");

    expect(result.alphagenome).toBeUndefined();
  });
});

describe("GET /api/v1/diagnostics — FoldX and AlphaGenome", () => {
  let server: Server;
  let baseUrl: string;
  let healthSpy: any;
  let root: string;
  const savedEnv = {
    FOLDX_BINARY: process.env.FOLDX_BINARY,
    ALPHAGENOME_API_KEY: process.env.ALPHAGENOME_API_KEY,
  };

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "foldx-diag-"));
    const binary = path.join(root, "foldx_fake");
    fs.writeFileSync(binary, Buffer.alloc(FOLDX_FLOOR + 1));
    process.env.FOLDX_BINARY = binary;
    delete process.env.ALPHAGENOME_API_KEY;

    const realExists = fs.existsSync;
    vi.spyOn(fs, "existsSync").mockImplementation((p) => (String(p).endsWith("rotabase.txt") ? true : realExists(p)));
    host("linux", "x64");

    healthSpy = vi.spyOn(adapterRegistry, "checkAllHealth").mockResolvedValue({
      ensembl: health(),
      alphagenome: health({ healthy: false, message: "Standby (API Key Required)" }),
    });

    const app = express();
    app.use("/api/v1", apiRouter);
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => {
        baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    healthSpy?.mockRestore();
    vi.restoreAllMocks();
    Object.defineProperty(process, "platform", originalPlatform);
    Object.defineProperty(process, "arch", originalArch);
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(root, { recursive: true, force: true });
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("reports FoldX ready from the shared readiness, and says what it found", async () => {
    const body = await (await fetch(`${baseUrl}/api/v1/diagnostics`)).json();

    expect(body.foldxReady).toBe(resolveFoldxReadiness().ready);
    expect(body.foldxReady).toBe(true);
    expect(body.foldxDetail).toEqual({
      binaryFound: true,
      rotabasePresent: true,
      box64Required: false,
      box64Present: expect.any(Boolean),
    });
  });

  it("keeps the AlphaGenome status and message as they were, and adds keySource", async () => {
    const body = await (await fetch(`${baseUrl}/api/v1/diagnostics`)).json();

    expect(body.serviceHealth.alphagenome).toMatchObject({
      healthy: false,
      message: "Standby (API Key Required)",
      keySource: "none",
    });
  });

  it("reports keySource server when the server holds its own AlphaGenome key", async () => {
    process.env.ALPHAGENOME_API_KEY = "server-held-key";

    const body = await (await fetch(`${baseUrl}/api/v1/diagnostics`)).json();

    expect(body.serviceHealth.alphagenome.keySource).toBe("server");
  });

  it.skipIf(Boolean(CONFIG.services.alphagenomeApiKey))(
    "reports keySource none when the server has no AlphaGenome key in either place it reads from",
    async () => {
      const body = await (await fetch(`${baseUrl}/api/v1/diagnostics`)).json();

      expect(body.serviceHealth.alphagenome.keySource).toBe("none");
    }
  );
});
