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
  private hasStandaloneUv: boolean | null = null;
  private startupGraceUntil = 0;

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
      const proc = this.modelServerProcess;
      const pid = proc.pid;
      if (pid) {
        if (process.platform === "win32") {
          try {
            execSync(`taskkill /F /T /PID ${pid}`, { stdio: "ignore" });
          } catch (_) {}
        } else {
          try {
            process.kill(-pid, "SIGTERM");
          } catch (_) {
            try {
              execSync(`pkill -P ${pid} || true`, { stdio: "ignore" });
              proc.kill("SIGTERM");
            } catch (_) {}
          }
        }
      }

      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          try {
            if (pid) {
              if (process.platform !== "win32") {
                process.kill(-pid, "SIGKILL");
              } else {
                proc.kill("SIGKILL");
              }
            }
          } catch (_) {}
          resolve();
        }, 3000);

        proc.once("exit", () => {
          clearTimeout(timeout);
          resolve();
        });
      });

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
    this.startupGraceUntil = Date.now() + 180000;
    console.log("[Sidecar Supervisor] Launching local ML model server sidecar (180s startup grace window)...");

    const modelServerScript = path.join(process.cwd(), "tools", "model_server.py");

    // Auto-discover local virtualenv python and bin dir
    const venvPythonPath = process.platform === "win32"
      ? path.join(process.cwd(), "tools", ".venv", "Scripts", "python.exe")
      : path.join(process.cwd(), "tools", ".venv", "bin", "python");

    const venvBinDir = process.platform === "win32"
      ? path.join(process.cwd(), "tools", ".venv", "Scripts")
      : path.join(process.cwd(), "tools", ".venv", "bin");

    const currentPath = process.env.PATH || "";
    const sidecarPath = fs.existsSync(venvBinDir) ? `${venvBinDir}${path.delimiter}${currentPath}` : currentPath;

    // Inherit full environment to preserve Windows runtime DLLs, system paths, and profile settings
    const sidecarEnv: Record<string, string> = {
      ...process.env as Record<string, string>,
      PATH: sidecarPath,
      SIDECAR_SECRET: process.env.SIDECAR_SECRET || "",
      PYTHONUNBUFFERED: "1",
      OMP_NUM_THREADS: process.env.OMP_NUM_THREADS || "2",
      TORCH_NUM_THREADS: process.env.TORCH_NUM_THREADS || "2"
    };

    const sidecarUrl = CONFIG.services.sidecarBaseUrl;
    const isLocalSidecar = sidecarUrl.includes("localhost") || sidecarUrl.includes("127.0.0.1") || sidecarUrl.includes("0.0.0.0");
    if (!isLocalSidecar) {
      console.log(`[Sidecar Supervisor] SIDECAR_URL points to external host (${sidecarUrl}). Skipping local sidecar process spawn.`);
      this.isSpawning = false;
      return;
    }

    if (this.hasStandaloneUv === null) {
      try {
        const checkCmd = process.platform === "win32" ? "where.exe uv" : "command -v uv";
        const found = execSync(checkCmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
        this.hasStandaloneUv = found.length > 0;
      } catch (_) {
        this.hasStandaloneUv = false;
      }
    }

    const spawnOptions = {
      cwd: process.cwd(),
      stdio: "inherit" as const,
      env: sidecarEnv,
      detached: process.platform !== "win32"
    };

    // Priority 1: Direct virtualenv Python execution (fastest, pre-synced, zero network overhead)
    if (fs.existsSync(venvPythonPath)) {
      console.log(`[Sidecar Supervisor] Found local virtualenv python at ${venvPythonPath}. Launching sidecar directly...`);
      this.modelServerProcess = spawn(venvPythonPath, [modelServerScript], spawnOptions);
    } else if (this.hasStandaloneUv) {
      console.log("[Sidecar Supervisor] Launching sidecar via standalone uv (project: tools)...");
      this.modelServerProcess = spawn("uv", ["run", "--project", "tools", "--no-sync", "python", modelServerScript], spawnOptions);
    } else {
      console.log("[Sidecar Supervisor] Standalone uv not found in PATH. Launching sidecar via python -m uv...");
      this.modelServerProcess = spawn("python", ["-m", "uv", "run", "--project", "tools", "--no-sync", "python", modelServerScript], spawnOptions);
    }

    this.isSpawning = false;

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
      this.modelServerProcess = null;
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
      if (Date.now() < this.startupGraceUntil) return;

      let sidecarHealthy = false;
      let isWarmingUp = false;
      try {
        const sidecarRes = await fetch(`${CONFIG.services.sidecarBaseUrl}/health`, { signal: AbortSignal.timeout(10000) });
        if (sidecarRes.ok) {
          const data = await sidecarRes.json() as any;
          sidecarHealthy = data.status === "healthy";
          isWarmingUp = data.state === "warming_up";
        }
      } catch (_) {
        sidecarHealthy = false;
      }

      if (sidecarHealthy || isWarmingUp) {
        this.healthCheckConsecutiveFailures = 0;
        this.restartAttempts = 0;
      } else {
        this.healthCheckConsecutiveFailures++;
        console.warn(`[Sidecar Supervisor] Background health check probe failed (strike ${this.healthCheckConsecutiveFailures}/3).`);

        if (this.healthCheckConsecutiveFailures >= 3) {
          this.healthCheckConsecutiveFailures = 0;
          console.warn("[Sidecar Supervisor] 3 consecutive health checks failed. Initiating sidecar recovery...");

          if (this.modelServerProcess) {
            console.warn("[Sidecar Supervisor] Terminating unresponsive sidecar process tree...");
            this.restartAttempts = 0;
            try {
              if (process.platform === "win32" && this.modelServerProcess.pid) {
                execSync(`taskkill /F /T /PID ${this.modelServerProcess.pid}`, { stdio: "ignore" });
              } else if (this.modelServerProcess.pid) {
                execSync(`pkill -9 -P ${this.modelServerProcess.pid} || true`, { stdio: "ignore" });
                this.modelServerProcess.kill("SIGKILL");
              }
            } catch (_) {}
          } else if (!this.restartTimer) {
            console.warn("[Sidecar Supervisor] Sidecar not running. Resetting retry quota and spawning new process...");
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
