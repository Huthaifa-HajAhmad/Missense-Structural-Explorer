import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { EventEmitter } from "node:events";

const mocks = vi.hoisted(() => ({
  state: { backend: "sqlite", paused: true, activeJobs: 0 },
  persist: vi.fn(),
  tasks: [] as unknown[],
}));
vi.mock("./services/biophysical-queue.ts", () => ({ BiophysicalJobQueue: { getInstance: () => ({
  getDeploymentState: () => mocks.state,
  pauseProcessing: () => { mocks.state.paused = true; },
  resumeProcessing: () => { mocks.state.paused = false; },
}) } }));
vi.mock("./deployment-role.ts", () => ({ persistDeploymentRole: mocks.persist }));
vi.mock("./routes/state.ts", () => ({ activeBackgroundTasks: mocks.tasks }));
import { installDeploymentControl } from "./deployment-control.ts";

describe("deployment control", () => {
  let server: Server;
  let origin: string;
  beforeEach(async () => {
    mocks.state.paused = true;
    mocks.persist.mockReset();
    const app = express();
    installDeploymentControl(app);
    app.get("/stream", (_req, res) => { res.write("chunk"); });
    app.get("/done", (_req, res) => { res.send("done"); });
    server = await new Promise<Server>(resolve => { const listening = app.listen(0, "127.0.0.1", () => resolve(listening)); });
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  it("counts a live stream until disconnect, and counts finish/close only once", async () => {
    await fetch(`${origin}/done`);
    const controller = new AbortController();
    await fetch(`${origin}/stream`, { signal: controller.signal });
    const status = async () => (await fetch(`${origin}/internal/deployment/`)).json();
    expect((await status()).activeRequests).toBe(1);
    controller.abort();
    await vi.waitFor(async () => expect((await status()).activeRequests).toBe(0));
  });

  it("persists worker ownership before enabling processing", async () => {
    const response = await fetch(`${origin}/internal/deployment/resume`, { method: "POST" });
    expect((await response.json()).paused).toBe(false);
    expect(mocks.persist).toHaveBeenCalledWith(false);
  });

  it("does not change ownership when persistence fails", async () => {
    mocks.persist.mockImplementationOnce(() => { throw new Error("disk full"); });
    const response = await fetch(`${origin}/internal/deployment/resume`, { method: "POST" });
    expect(response.status).toBe(503);
    expect(mocks.state.paused).toBe(true);
  });

  it("rejects browser-origin controls even from a loopback peer", async () => {
    const headersList: Record<string, string>[] = [
      { Origin: "https://example.com" },
      { "Sec-Fetch-Site": "cross-site" },
    ];
    for (const headers of headersList) {
      const response = await fetch(`${origin}/internal/deployment/resume`, { method: "POST", headers });
      expect(response.status).toBe(404);
    }
    expect(mocks.state.paused).toBe(true);
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it("rejects proxy peers even when they forge loopback forwarding headers", async () => {
    const handlers: any[] = [];
    installDeploymentControl({ use: (...args: any[]) => handlers.push(args.at(-1)) } as any);
    const response = Object.assign(new EventEmitter(), { sendStatus: vi.fn(), setHeader: vi.fn() });
    await handlers[1]({ socket: { remoteAddress: "172.18.0.3" }, headers: { "x-forwarded-for": "127.0.0.1" } }, response);
    expect(response.sendStatus).toHaveBeenCalledWith(404);
    expect(mocks.persist).not.toHaveBeenCalled();
  });
});
