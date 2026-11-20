/**
 * Express 4 ignores the promise an async route returns, so a route that throws before it answers
 * leaves the request hanging. These tests run real HTTP requests against that case.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "http";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { forwardAsyncRouteErrors } from "./async-route-errors.ts";
import { jsonErrorHandler } from "./express-config.ts";

forwardAsyncRouteErrors();
forwardAsyncRouteErrors(); // Installing twice must not forward an error twice.

const seen: unknown[] = [];
let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  const router = express.Router();
  router.get("/router-throws", async () => {
    throw new Error("router handler failed");
  });
  app.get("/throws", async () => {
    await Promise.resolve();
    throw new Error("route failed");
  });
  app.get("/rejects-with-status", async () => {
    throw Object.assign(new Error("not found here"), { status: 404, code: "NOT_FOUND" });
  });
  app.get("/rejects-with-empty-string", async () => {
    throw "";
  });
  app.get("/rejects-with-nothing", async () => {
    throw undefined;
  });
  app.get("/ok", async (_req, res) => {
    await Promise.resolve();
    res.json({ fine: true });
  });
  app.get("/sync-throws", () => {
    throw new Error("sync failure");
  });
  app.get("/answers-then-throws", async (_req, res) => {
    res.json({ answered: true });
    await Promise.resolve();
    throw new Error("late failure");
  });
  app.get("/streams-then-throws", async (_req, res) => {
    res.write("first chunk");
    await Promise.resolve();
    throw new Error("stream failed");
  });
  app.use("/mw", async () => {
    throw new Error("middleware failed");
  });
  app.use(router);
  app.use((err: unknown, _req: express.Request, _res: express.Response, next: express.NextFunction) => {
    seen.push(err);
    next(err);
  });
  app.use(jsonErrorHandler);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const get = (path: string) => fetch(`${base}${path}`, { signal: AbortSignal.timeout(2000) });

describe("forwardAsyncRouteErrors", () => {
  it("answers 500 with the JSON error body when an async route throws before answering", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await get("/throws");
    expect(res.status).toBe(500);
    expect((await res.json()).error.message).toBe("route failed");
  });

  it("keeps the status an error carries", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await get("/rejects-with-status")).status).toBe(404);
  });

  it("answers 500 when a route rejects with nothing useful, because Express reads a falsy error as 'carry on'", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await get("/rejects-with-empty-string")).status).toBe(500);
    expect((await get("/rejects-with-nothing")).status).toBe(500);
  });

  it("covers routes on a router and middleware mounted with use()", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await get("/router-throws")).status).toBe(500);
    expect((await get("/mw/anything")).status).toBe(500);
  });

  it("hands each failure to the error handler exactly once", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    seen.length = 0;
    await get("/throws");
    expect(seen).toHaveLength(1);
  });

  it("leaves routes that answer, and routes that throw synchronously, as they were", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await (await get("/ok")).json()).toEqual({ fine: true });
    expect((await get("/sync-throws")).status).toBe(500);
  });

  it("keeps the answer a route already sent when it fails afterwards", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await get("/answers-then-throws");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ answered: true });
  });

  it("ends a response that failed part-way instead of leaving it open", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const body = await new Promise<string>((resolve, reject) => {
      const req = http.get(`${base}/streams-then-throws`, (res) => {
        let text = "";
        res.on("data", (chunk) => (text += chunk));
        res.on("end", () => resolve(text));
        res.on("error", reject);
      });
      req.setTimeout(2000, () => reject(new Error("the response was left open")));
      req.on("error", reject);
    });
    expect(body).toBe("first chunk");
  });
});
