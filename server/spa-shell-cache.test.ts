import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import fs from "fs";
import os from "os";
import path from "path";
import type { AddressInfo } from "net";
import type { Server } from "http";
import { createSpaShellHandler, setStaticShellHeaders, SPA_SHELL_CACHE_CONTROL } from "./spa-shell-cache";

// Mirrors the production mounts in express-config.ts: immutable assets, static dist, SPA fallback.
describe("SPA shell cache policy", () => {
  let server: Server;
  let base: string;
  let dist: string;

  beforeAll(async () => {
    dist = fs.mkdtempSync(path.join(os.tmpdir(), "spa-shell-"));
    fs.mkdirSync(path.join(dist, "assets"));
    fs.writeFileSync(path.join(dist, "index.html"), "<script src=/assets/index-abc.js></script>");
    fs.writeFileSync(path.join(dist, "assets", "index-abc.js"), "1");
    const app = express();
    app.use((_req, res, next) => {
      res.locals.nonce = "test-nonce";
      next();
    });
    app.use("/assets", express.static(path.join(dist, "assets"), { immutable: true, maxAge: "1y" }));
    const shell = createSpaShellHandler(dist);
    app.get(["/", "/index.html"], shell);
    app.use(express.static(dist, { index: false, setHeaders: setStaticShellHeaders }));
    app.get("*", shell);
    server = app.listen(0);
    await new Promise(r => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    server.close();
    fs.rmSync(dist, { recursive: true, force: true });
  });

  it.each(["/", "/index.html", "/evidence/guidelines"])("revalidates the shell at %s", async url => {
    const res = await fetch(base + url);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(SPA_SHELL_CACHE_CONTROL);
  });

  // `express.static` answers `/` and `/index.html` from disk unless it is told not to, which shipped the
  // shell with no nonce on its scripts while helmet's script-src named one.
  it.each(["/", "/index.html", "/evidence/guidelines"])("stamps the CSP nonce onto every script at %s", async url => {
    const html = await (await fetch(base + url)).text();
    expect(html).toContain('<script nonce="test-nonce"');
  });

  it("keeps hashed assets immutable", async () => {
    const res = await fetch(base + "/assets/index-abc.js");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });
});
