import type { Express } from "express";
import { BiophysicalJobQueue } from "./services/biophysical-queue.ts";
import { activeBackgroundTasks } from "./routes/state.ts";
import { CONFIG } from "./config.ts";
import { persistDeploymentRole } from "./deployment-role.ts";

/** Only docker exec on the application's loopback can control a handover. Never trust XFF. */
export function installDeploymentControl(app: Express): void {
  let activeRequests = 0;
  app.use((req, res, next) => {
    if (req.path === "/internal/deployment" || req.path.startsWith("/internal/deployment/") || ["/api/v1/health", "/api/v1/version"].includes(req.path)) {
      next();
      return;
    }
    activeRequests++;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      activeRequests--;
    };
    res.once("finish", finish);
    res.once("close", finish);
    next();
  });

  app.use("/internal/deployment", async (req, res) => {
    if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress ?? "")
        || req.headers.origin || req.headers["sec-fetch-site"]) {
      res.sendStatus(404);
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    try {
      const queue = BiophysicalJobQueue.getInstance();
      if (req.method === "POST" && ["/pause", "/resume"].includes(req.path)) {
        if (queue.getDeploymentState().backend !== "sqlite") {
          res.status(409).json({ error: "Deployment handover requires SQLite" });
          return;
        }
        const paused = req.path === "/pause";
        persistDeploymentRole(paused);
        if (paused) queue.pauseProcessing();
        else queue.resumeProcessing();
      } else if (req.method !== "GET" || req.path !== "/") {
        res.sendStatus(404);
        return;
      }
      let ready: boolean | undefined;
      if (req.query.probe === "true") {
        ready = false;
        try {
          const response = await fetch(`${CONFIG.services.sidecarBaseUrl}/health`, { signal: AbortSignal.timeout(2000) });
          const health = await response.json() as { status?: string; state?: string; model_loaded?: boolean };
          ready = response.ok && health.status === "healthy" && health.state === "ready" && health.model_loaded === true;
        } catch { /* The rollout keeps serving the old generation until readiness succeeds. */ }
      }
      res.json({
        protocol: 1,
        commit: process.env.BUILD_COMMIT ?? "unknown",
        ready,
        activeRequests,
        backgroundTasks: activeBackgroundTasks.length,
        ...queue.getDeploymentState(),
      });
    } catch {
      res.status(503).json({ error: "Deployment control unavailable" });
    }
  });
}
