import path from "path";
import fs from "fs";
import crypto from "crypto";
import { spawn, execSync, type ChildProcess } from "child_process";
import { AuditLogger } from "./utils.ts";
import { CONFIG } from "./config.ts";

/**
 * Ensures a valid SIDECAR_SECRET token exists in process.env.
 * Generates an in-memory random UUID if none is configured.
 */
export function ensureSidecarSecret(): string {
  if (!process.env.SIDECAR_SECRET) {
    console.warn(
      `[WARNING] SIDECAR_SECRET is not configured in the environment. Generating a random UUID in-memory. If the model sidecar is deployed separately, this will trigger authentication failures.`
    );
    process.env.SIDECAR_SECRET = crypto.randomUUID();
  }
  return process.env.SIDECAR_SECRET;
}

/**
 * Manages the lifecycle, auto-restart exponential backoff, and health-check watchdog
 * for the Python ML model server sidecar (tools/model_server.py).
 */
export class SidecarSupervisor {
  private modelServerProcess: ChildProcess | null = null;
  private restartAttempts = 0;
  private stableTimer: NodeJS.Timeout | null = null;
  private restartTimer: NodeJS.Timeout | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private isSpawning = false;
  private isShuttingDown = false;
  private healthCheckConsecutiveFailures = 0;

  constructor() {
    ensureSidecarSecret();
  }

  /**
   * Spawns the local ML model server sidecar and starts the background health monitor.
   */
  public start(): void {
    this.isShuttingDown = false;
    this.spawnModelServer();
    this.startHealthCheckLoop();
  }

  /**
   * Gracefully terminates the sidecar process tree and clears all timers.
   */
  public async stop(): Promise<void> {
    this.isShuttingDown = true;

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.stableTimer) {
      clearTimeout(this.stableTimer);
      this.stableTimer = null;
    }

    if (this.modelServerProcess && this.modelServerProcess.pid) {
      console.log("[Sidecar Supervisor] Terminating model server sidecar process tree...");
      const pid = this.modelServerProcess.pid;
      if (process.platform === "win32") {
        try {
          execSync(`taskkill /F /T /PID ${pid}`, { stdio: "ignore" });
        } catch (_) {}
      } else {
        try {
          execSync(`pkill -P ${pid} || true`, { stdio: "ignore" });
          this.modelServerProcess.kill("SIGTERM");
        } catch (_) {}
      }
      this.modelServerProcess = null;
    }
  }

  public getProcess(): ChildProcess | null {
    return this.modelServerProcess;
  }

  private spawnModelServer(): void {
    if (this.isShuttingDown) return;
    if (this.isSpawning || this.restartTimer) {
      console.log("[Sidecar Supervisor] Sidecar spawn already in progress or scheduled, ignoring request.");
      return;
    }

    this.isSpawning = true;
    console.log("[Sidecar Supervisor] Launching local ML model server sidecar...");

    const modelServerScript = path.join(process.cwd(), "tools", "model_server.py");
    const cleanSystemKeys = [
      "path", "systemroot", "systemdrive", "appdata", "localappdata",
      "temp", "tmp", "userprofile", "home", "pwd", "comspec",
      "os", "windir", "pythonpath"
    ];

    const sidecarEnv: Record<string, string> = {
      SIDECAR_SECRET: process.env.SIDECAR_SECRET || ""
    };

    for (const key of Object.keys(process.env)) {
      const lower = key.toLowerCase();
      if (
        cleanSystemKeys.includes(lower) ||
        key.startsWith("SIDECAR_") ||
        key.startsWith("HF_") ||
        key.startsWith("UV_") ||
        key.startsWith("TORCH_") ||
        key.startsWith("OMP_") ||
        key === "MAX_LOADED_MODELS"
      ) {
        sidecarEnv[key] = process.env[key] || "";
      }
    }

    // Auto-discover local virtualenv python
    const venvPythonPath = process.platform === "win32"
      ? path.join(process.cwd(), "tools", ".venv", "Scripts", "python.exe")
      : path.join(process.cwd(), "tools", ".venv", "bin", "python");

    let useStandaloneUv = false;
    try {
      const checkCmd = process.platform === "win32" ? "where uv" : "command -v uv";
      execSync(checkCmd, { stdio: "ignore" });
      useStandaloneUv = true;
    } catch (_) {
      // Standalone uv not on PATH
    }

    if (useStandaloneUv) {
      console.log("[Sidecar Supervisor] Launching sidecar via standalone uv (project: tools)...");
      this.modelServerProcess = spawn("uv", ["run", "--project", "tools", modelServerScript], {
        stdio: "inherit",
        env: sidecarEnv
      });
    } else if (fs.existsSync(venvPythonPath)) {
      console.log(`[Sidecar Supervisor] Found local virtualenv python at ${venvPythonPath}. Launching sidecar directly...`);
      this.modelServerProcess = spawn(venvPythonPath, [modelServerScript], {
        stdio: "inherit",
        env: sidecarEnv
      });
    } else {
      console.log("[Sidecar Supervisor] Standalone uv not found in PATH. Launching sidecar via python -m uv...");
      this.modelServerProcess = spawn("python", ["-m", "uv", "run", "--project", "tools", modelServerScript], {
        stdio: "inherit",
        env: sidecarEnv
      });
    }

    // Reset restart counter after 30 seconds of stable running
    if (this.stableTimer) clearTimeout(this.stableTimer);
    this.stableTimer = setTimeout(() => {
      if (this.modelServerProcess) {
        console.log("[Sidecar Supervisor] Sidecar process stable. Resetting restart attempts counter.");
        this.restartAttempts = 0;
      }
    }, 30000);

    this.modelServerProcess.on("error", (err) => {
      console.error("[Sidecar Supervisor] Failed to start sidecar:", err.message);
      AuditLogger.log("SIDECAR_ERROR", { message: err.message });
      this.isSpawning = false;
    });

    this.modelServerProcess.on("exit", (code, signal) => {
      if (this.isShuttingDown) return;

      console.warn(`[Sidecar Supervisor] Sidecar exited with code ${code} and signal ${signal}.`);
      this.modelServerProcess = null;
      this.isSpawning = false;

      if (this.stableTimer) {
        clearTimeout(this.stableTimer);
        this.stableTimer = null;
      }

      // Exponential backoff recovery (up to 10 attempts, max 60s)
      if (this.restartAttempts < 10) {
        this.restartAttempts++;
        const backoffDelay = Math.min(2000 * Math.pow(2, this.restartAttempts - 1), 60000);
        console.log(`[Sidecar Supervisor] Restarting sidecar process (attempt ${this.restartAttempts}/10) in ${backoffDelay / 1000} seconds...`);
        AuditLogger.log("SIDECAR_RESTART", { attempt: this.restartAttempts, code, signal });

        if (this.restartTimer) clearTimeout(this.restartTimer);
        this.restartTimer = setTimeout(() => {
          this.restartTimer = null;
          this.spawnModelServer();
        }, backoffDelay);
      } else {
        console.error("[Sidecar Supervisor] Max restart attempts reached. Sidecar will remain offline until health check recovery.");
        AuditLogger.log("SIDECAR_FATAL_OFFLINE", { restartAttempts: this.restartAttempts, code, signal });
      }
    });
  }

  private startHealthCheckLoop(): void {
    if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);

    this.healthCheckInterval = setInterval(async () => {
      if (this.isShuttingDown) return;

      let sidecarHealthy = false;
      try {
        const sidecarRes = await fetch(`${CONFIG.services.sidecarBaseUrl}/health`, { signal: AbortSignal.timeout(CONFIG.timeouts.sidecarHealthCheckMs) });
        if (sidecarRes.ok) {
          const data = await sidecarRes.json() as any;
          sidecarHealthy = data.status === "healthy";
        }
      } catch (_) {
        sidecarHealthy = false;
      }

      if (sidecarHealthy) {
        this.healthCheckConsecutiveFailures = 0;
        this.restartAttempts = 0;
      } else {
        this.healthCheckConsecutiveFailures++;
        console.warn(`[Sidecar Supervisor] Background health check failed (strike ${this.healthCheckConsecutiveFailures}/2).`);

        if (this.healthCheckConsecutiveFailures >= 2) {
          this.healthCheckConsecutiveFailures = 0;
          console.warn("[Sidecar Supervisor] 2 consecutive health checks failed. Initiating sidecar recovery...");

          if (this.modelServerProcess) {
            console.warn("[Sidecar Supervisor] Terminating unresponsive sidecar process tree...");
            try {
              if (process.platform === "win32" && this.modelServerProcess.pid) {
                execSync(`taskkill /F /T /PID ${this.modelServerProcess.pid}`, { stdio: "ignore" });
              } else if (this.modelServerProcess.pid) {
                execSync(`pkill -9 -P ${this.modelServerProcess.pid} || true`, { stdio: "ignore" });
                this.modelServerProcess.kill("SIGKILL");
              }
            } catch (_) {}
          } else if (!this.restartTimer) {
            console.warn("[Sidecar Supervisor] Sidecar not running and no restart scheduled. Spawning new process...");
            this.restartAttempts = 0;
            this.spawnModelServer();
          }
        }
      }
    }, 60000);
  }
}

/**
 * Convenience helper to start the sidecar supervisor singleton.
 */
export function startSidecarSupervisor(): SidecarSupervisor {
  const supervisor = new SidecarSupervisor();
  supervisor.start();
  return supervisor;
}
