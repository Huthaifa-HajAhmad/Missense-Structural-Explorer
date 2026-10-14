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
 *   7. SaProt (Structure-Aware Protein LM) — unsized: the 650M or 35M checkpoint may serve
 *   8. JapanFold Sovereign AI Cloud Fallback
 */

import { type Router } from "express";
import fs from "fs";
import path from "path";
import { inspectRaspIndexFile, hasLoaderVerifiedRaspIndex, RASP_SQLITE_PATH } from "../services/stability/energy-models.ts";
import { execSync } from "child_process";
import { CONFIG } from "../config.ts";
import { checkP2RankCapability } from "../services/pocket.ts";
import { providerHealth } from "../services/infra/provider-pause.ts";
import { governorHealth, limitBasisFor } from "../services/infra/egress-governor.ts";
import { defaultCacheRegistry } from "../services/infra/cache-registry.ts";
import { isKnownProviderHost } from "../../src/shared/providerLimits.ts";

export interface EngineCapability {
  id: string;
  name: string;
  category: "biophysical" | "language_model" | "runtime";
  status: "ready" | "warming_up" | "standby" | "unverified" | "unavailable";
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

/**
 * The 429 pauses (WP-I3) and the fair-share governor (WP-I1): which provider is the constraint, its
 * rate and where that rate came from, and how many calls waited or would have. No tokens.
 */
function egressHealth() {
  const pause = providerHealth();
  // This route is public. A host that is not one of the deployment's own providers was chosen by a
  // person (their own AlphaGenome or GPN server), so it is not named here.
  const named = pause.providers.filter(p => isKnownProviderHost(p.hostname));
  const hidden = pause.providers.length - named.length;
  return {
    mode: pause.mode,
    providers: named.map(p => ({ ...p, limitBasis: limitBasisFor(p.hostname) })),
    ...(hidden ? { otherPausedOrRateLimitedHosts: hidden } : {}),
    governor: governorHealth({ publicView: true }),
    // Expired cache entries served (`on`) or that would have been (`shadow`) while a provider limited
    // requests, by cache source (WP-I2). Source labels and counts only.
    staleServes: defaultCacheRegistry.staleServeCounts(),
  };
}

/**
 * JapanFold reachability, checked at most once a minute and once at a time.
 *
 * `/capabilities` is public. Probing on every request let any visitor make the server call JapanFold
 * (a provider the whole team shares) as often as the API rate limit allows, outside the egress
 * governor and the 429 pause.
 */
const JAPANFOLD_PROBE_TTL_MS = 60_000;
let japanFoldProbe: { at: number; value: Promise<boolean> } | null = null;
function japanFoldReachability(): Promise<boolean> {
  if (japanFoldProbe && Date.now() - japanFoldProbe.at < JAPANFOLD_PROBE_TTL_MS) return japanFoldProbe.value;
  const value = (async () => {
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
      return jfRes.status < 500 && jfRes.status !== 403;
    } catch (_) {
      return false;
    }
  })();
  japanFoldProbe = { at: Date.now(), value };
  return value;
}

/** Test hook: the probe result is cached module-wide. */
export function resetJapanFoldProbeForTests(): void {
  japanFoldProbe = null;
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
    //
    // Reported from the index's own completeness record, not from its file size. The size-only
    // check endorsed the truncated index (3.1 MB > 1 MB) as "ready" while it served a coverage
    // miss for 99.5% of the proteins it was supposed to cover — the diagnostics screen was
    // corroborating the very bug it existed to reveal.
    // Resolved through the same indirection the loader uses, so diagnostics cannot describe a
    // different file than the one serving lookups.
    const raspDbPath = RASP_SQLITE_PATH;
    const raspVerdict = inspectRaspIndexFile(raspDbPath);
    /**
     * Readiness requires a COUNTED index; the record's own claim is not a count.
     *
     * Two ways this route overstated RaSP. A truncated index keeps its `rasp_index_meta` row, so the
     * record says `usable: true` and the screen said "ready" for an index the loader would reject —
     * the diagnostics screen corroborating the very bug it exists to reveal. And the converse, which
     * is why the fix is not simply "gate on `verified`": the record-based path NEVER verifies, so
     * gating on it alone would mark a healthy index unavailable.
     *
     * So readiness is the record's usability AND the loader's own count of this exact file. When the
     * loader has not looked yet, the counts are reported as unverified instead of being presented as
     * checked — which is what `indexCountsVerified` has been in the payload for all along.
     */
    const raspCountsVerified = hasLoaderVerifiedRaspIndex();
    const raspReady = raspVerdict.usable && raspCountsVerified;
    let raspSizeBytes = 0;
    try {
      if (fs.existsSync(raspDbPath)) raspSizeBytes = fs.statSync(raspDbPath).size;
    } catch (_) {}

    // P2Rank Pocket Detection Diagnostic Check
    const p2rankCap = await checkP2RankCapability();

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
    const japanFoldReachable = await japanFoldReachability();

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
        /**
         * THREE outcomes, not two.
         *
         * `unverified` is where a healthy index sits until something has counted it: the record says it is
         * usable, but nothing has verified that. Reporting it as `unavailable` reads as "down" and invites
         * someone to rebuild a perfectly good 725 MB index; reporting it as `ready` is the false
         * endorsement this route was fixed to stop giving. `indexCountsVerified` carries the same
         * distinction in machine-readable form.
         */
        status: raspReady ? "ready" : raspVerdict.usable ? "unverified" : "unavailable",
        details: {
          databaseIndexed: raspReady,
          sqlitePath: raspDbPath,
          sizeMb: raspSizeBytes > 0 ? (raspSizeBytes / (1024 * 1024)).toFixed(1) : null,
          storage: "SQLite (indexed O(log n))",
          // Real coverage, so the diagnostics screen can tell a curated dataset from a broken
          // index instead of repeating "ready".
          indexedVariants: raspVerdict.rows,
          indexedProteins: raspVerdict.proteins,
          indexBuiltAt: raspVerdict.meta?.builtAt ?? null,
          indexSchemaVersion: raspVerdict.meta?.schemaVersion ?? null,
          // False means the counts came from the index's own record and nothing has counted them.
          indexCountsVerified: raspCountsVerified,
          ...(raspReady
            ? {}
            : {
                unavailableReason: raspVerdict.usable
                  ? // The record claims the index is fine, but nothing has counted it. Saying
                    // "unavailable" without this would read as "broken".
                    "the index's recorded counts have not been verified by the loader, so its readiness is unconfirmed"
                  : raspVerdict.reason ?? null
              })
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
        name: "SaProt (Structure-Aware Protein LM)",
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
      },
      {
        id: "p2rank",
        name: "P2Rank ML Pocket Detection",
        category: "biophysical",
        status: p2rankCap.status,
        details: {
          ready: p2rankCap.ready,
          binaryPath: p2rankCap.path,
          javaVersionCompatible: p2rankCap.javaVersionCompatible,
          javaHome: p2rankCap.javaHome
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
      engines,
      // Which remote provider is the constraint right now (WP-I3): hosts paused after a 429, or that
      // rate-limited us in the last 15 minutes. Hostnames and counts only; never a token.
      egress: egressHealth()
    });
  });
}