/**
 * capabilities.ts — GET /api/v1/capabilities
 *
 * Machine-readable endpoint providing comprehensive status and diagnostics
 * across all 8 biophysical stability and language model engines:
 *   1. FoldX Linux 64-bit ELF
 *   2. FoldX Windows Executable
 *   3. Box64 Dynamic Binary Translator (ARM64)
 *   4. RaSP Human Proteome SQLite Database
 *   5. ThermoMPNN (ProteinMPNN Neural Backbone)
 *   6. StabilityOracle (PyTorch 3D SiameseGraphormer)
 *   7. SaProt 650M AF2 (Structure-Aware Protein LM)
 *   8. JapanFold Sovereign AI Cloud Fallback
 */

import { type Router } from "express";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { CONFIG } from "../config.ts";

export interface EngineCapability {
  id: string;
  name: string;
  category: "biophysical" | "language_model" | "runtime";
  status: "ready" | "warming_up" | "standby" | "unavailable";
  details: Record<string, any>;
}

// Memoized Box64 detection to prevent event-loop blocking on every HTTP request
let cachedBox64: { hasBox64: boolean; box64Version: string | null } | null = null;
function getBox64Status(): { hasBox64: boolean; box64Version: string | null } {
  if (cachedBox64) return cachedBox64;
  let hasBox64 = false;
  let box64Version: string | null = null;
  if (process.platform === "linux") {
    try {
      const out = execSync("box64 -v 2>&1 || which box64", { encoding: "utf8", timeout: 1000 }).trim();
      hasBox64 = true;
      box64Version = out.split("\n")[0].slice(0, 80);
    } catch (_) {
      hasBox64 = false;
    }
  }
  cachedBox64 = { hasBox64, box64Version };
  return cachedBox64;
}

export function registerCapabilitiesRoutes(apiRouter: Router): void {
  apiRouter.get("/capabilities", async (req, res) => {
    // 1. FoldX Linux 64-bit ELF
    let foldxLinuxPath: string | null = null;
    let foldxLinuxSize = 0;
    const linuxCandidates = [
      path.join(process.cwd(), "tools", "foldx_linux", "foldx_20261231"),
      path.join(process.cwd(), "tools", "foldx_linux", "foldx"),
      "/app/tools/foldx_linux/foldx_20261231",
      "/app/tools/foldx_linux/foldx"
    ];
    for (const p of linuxCandidates) {
      if (fs.existsSync(p)) {
        try {
          const st = fs.statSync(p);
          if (st.size > 1024 * 1024) {
            foldxLinuxPath = p;
            foldxLinuxSize = st.size;
            break;
          }
        } catch (_) {}
      }
    }

    // 2. FoldX Windows Executable
    let foldxWinPath: string | null = null;
    let foldxWinSize = 0;
    const winCandidates = [
      path.join(process.cwd(), "tools", "foldx", "foldx_1_20270131.exe"),
      path.join(process.cwd(), "tools", "foldx", "foldx.exe"),
      path.join(process.cwd(), "tools", "foldx", "FoldX.exe")
    ];
    for (const p of winCandidates) {
      if (fs.existsSync(p)) {
        try {
          const st = fs.statSync(p);
          if (st.size > 1024 * 1024) {
            foldxWinPath = p;
            foldxWinSize = st.size;
            break;
          }
        } catch (_) {}
      }
    }

    // 3. Box64 Binary Translator (ARM64 OCI compatibility)
    const { hasBox64, box64Version } = getBox64Status();

    // 4. RaSP SQLite Database
    const raspDbPath = path.join(process.cwd(), "data", "df_rasp_gnomad_clinvar.sqlite");
    let raspReady = false;
    let raspSizeBytes = 0;
    if (fs.existsSync(raspDbPath)) {
      try {
        const st = fs.statSync(raspDbPath);
        if (st.size > 1024 * 1024) {
          raspReady = true;
          raspSizeBytes = st.size;
        }
      } catch (_) {}
    }

    // 5-7. Python Model Server Sidecar Health Check
    let sidecarReachable = false;
    let sidecarState = "offline";
    let sidecarModelStatus: Record<string, string> = {};
    let sidecarLatencyMs = 0;
    try {
      const t0 = Date.now();
      const sRes = await fetch(`${CONFIG.services.sidecarBaseUrl}/health`, {
        signal: AbortSignal.timeout(1200)
      });
      sidecarLatencyMs = Date.now() - t0;
      if (sRes.ok) {
        sidecarReachable = true;
        const data = await sRes.json() as any;
        sidecarState = data.state || (data.status === "ok" || data.status === "healthy" ? "ready" : "warming_up");
        sidecarModelStatus = data.models || data.model_status || {};
      }
    } catch (_) {
      sidecarReachable = false;
    }

    // 8. JapanFold Sovereign Cloud Connectivity Check (Structure Prediction)
    let japanFoldReachable = false;
    try {
      const jfUrl = process.env.JAPANFOLD_API_URL || "https://api.japanfold.aiand.com/v1/predictions";
      const jfHeaders = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Missense-Structural-Explorer/1.0" };
      const jfRes = await fetch(jfUrl, {
        method: "OPTIONS",
        headers: jfHeaders,
        signal: AbortSignal.timeout(2000)
      }).catch(async () => {
        return await fetch(jfUrl, {
          method: "GET",
          headers: jfHeaders,
          signal: AbortSignal.timeout(2000)
        });
      });
      japanFoldReachable = jfRes.status < 500 && jfRes.status !== 403;
    } catch (_) {
      japanFoldReachable = false;
    }

    const tamarindConfigured = Boolean(process.env.TAMARIND_API_KEY && process.env.TAMARIND_API_KEY.length > 5);
    const hfConfigured = Boolean(process.env.HF_TOKEN && process.env.HF_TOKEN.length > 5);

    const engines: EngineCapability[] = [
      {
        id: "foldx_linux_elf",
        name: "FoldX (Linux 64-bit ELF)",
        category: "biophysical",
        status: foldxLinuxPath ? "ready" : "unavailable",
        details: {
          installed: Boolean(foldxLinuxPath),
          path: foldxLinuxPath,
          sizeMb: foldxLinuxSize > 0 ? (foldxLinuxSize / (1024 * 1024)).toFixed(1) : null,
          platformSupported: process.platform === "linux" || hasBox64,
          requiresEmulation: process.arch === "arm64"
        }
      },
      {
        id: "foldx_windows",
        name: "FoldX (Windows x64)",
        category: "biophysical",
        status: foldxWinPath ? "ready" : "unavailable",
        details: {
          installed: Boolean(foldxWinPath),
          path: foldxWinPath,
          sizeMb: foldxWinSize > 0 ? (foldxWinSize / (1024 * 1024)).toFixed(1) : null,
          platformSupported: process.platform === "win32"
        }
      },
      {
        id: "box64",
        name: "Box64 Dynamic Translator",
        category: "runtime",
        status: hasBox64 ? "ready" : process.arch === "arm64" ? "unavailable" : "standby",
        details: {
          installed: hasBox64,
          version: box64Version,
          neededForArm64: process.arch === "arm64"
        }
      },
      {
        id: "rasp",
        name: "RaSP (Rapid Stability Prediction)",
        category: "biophysical",
        status: raspReady ? "ready" : "unavailable",
        details: {
          databaseIndexed: raspReady,
          sqlitePath: raspDbPath,
          sizeMb: raspSizeBytes > 0 ? (raspSizeBytes / (1024 * 1024)).toFixed(1) : null,
          storage: "SQLite (indexed O(log n))"
        }
      },
      {
        id: "thermompnn",
        name: "ThermoMPNN (ProteinMPNN Neural Backbone)",
        category: "biophysical",
        status: sidecarReachable ? (sidecarState === "ready" ? "ready" : "warming_up") : (tamarindConfigured ? "ready" : "standby"),
        details: {
          localSidecarReachable: sidecarReachable,
          sidecarModelStatus: sidecarModelStatus.thermompnn || "unloaded",
          tamarindRemoteConfigured: tamarindConfigured,
          preferredProvider: process.env.THERMOMPNN_PROVIDER || "local"
        }
      },
      {
        id: "stabilityoracle",
        name: "StabilityOracle (PyTorch 3D SiameseGraphormer)",
        category: "biophysical",
        status: sidecarReachable ? (sidecarState === "ready" ? "ready" : "warming_up") : "standby",
        details: {
          localSidecarReachable: sidecarReachable,
          sidecarModelStatus: sidecarModelStatus.stabilityoracle || "unloaded",
          architecture: "Geometric Graph-Transformer"
        }
      },
      {
        id: "saprot",
        name: "SaProt 650M AF2 (Structure-Aware Protein LM)",
        category: "language_model",
        status: sidecarReachable ? (sidecarModelStatus.saprot === "ready" ? "ready" : "standby") : "standby",
        details: {
          localSidecarReachable: sidecarReachable,
          sidecarModelStatus: sidecarModelStatus.saprot || "unloaded",
          hfTokenConfigured: hfConfigured
        }
      },
      {
        id: "japanfold",
        name: "JapanFold Sovereign Folding Cloud",
        category: "biophysical",
        status: japanFoldReachable ? "ready" : "standby",
        details: {
          endpoint: "https://api.japanfold.aiand.com/v1/predictions",
          keyless: true,
          supportedModels: ["esmfold2-fast", "esmfold2", "boltz2", "openfold3"],
          reachable: japanFoldReachable
        }
      }
    ];

    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      system: {
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        sidecarReachable,
        sidecarLatencyMs
      },
      engines
    });
  });
}