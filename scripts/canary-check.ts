/**
 * scripts/canary-check.ts — Live Production/Staging Canary Verification
 *
 * Exercises all 8 biophysical and language model engines against the live deployment
 * in <3 seconds without requiring local compute or heavy dependencies.
 *
 * Usage:
 *   npx tsx scripts/canary-check.ts
 *   TARGET_HOST=https://missense-resolve.duckdns.org npx tsx scripts/canary-check.ts
 */

const TARGET_HOST = (process.env.TARGET_HOST || "https://missense-resolve.duckdns.org").replace(/\/+$/, "");

interface EngineStatus {
  id: string;
  name: string;
  category: string;
  status: "ready" | "warming_up" | "standby" | "unavailable";
  details: Record<string, any>;
}

interface CapabilitiesResponse {
  status: string;
  timestamp: string;
  system: {
    platform: string;
    arch: string;
    nodeVersion: string;
    sidecarReachable: boolean;
    sidecarLatencyMs: number | null;
  };
  engines: EngineStatus[];
}

async function runCanary(): Promise<void> {
  console.log(`\n======================================================`);
  console.log(`🔍 Missense Structural Explorer — Live Canary Check`);
  console.log(`🌐 Target: ${TARGET_HOST}`);
  console.log(`======================================================\n`);

  const start = Date.now();

  try {
    // 1. Healthcheck Ping
    const healthStart = Date.now();
    const healthRes = await fetch(`${TARGET_HOST}/api/v1/health`, {
      headers: { "User-Agent": "Missense-Canary/1.0" },
      signal: AbortSignal.timeout(5000)
    });
    const healthLatency = Date.now() - healthStart;

    if (!healthRes.ok) {
      throw new Error(`HTTP Healthcheck failed with status ${healthRes.status}`);
    }
    console.log(`✅ Healthcheck: HTTP 200 OK (${healthLatency}ms)`);

    // 2. Capabilities Endpoint Check
    const capStart = Date.now();
    const capRes = await fetch(`${TARGET_HOST}/api/v1/capabilities`, {
      headers: { "User-Agent": "Missense-Canary/1.0" },
      signal: AbortSignal.timeout(8000)
    });
    const capLatency = Date.now() - capStart;

    if (!capRes.ok) {
      throw new Error(`Capabilities endpoint failed with status ${capRes.status}`);
    }

    const data = (await capRes.json()) as CapabilitiesResponse;
    console.log(`✅ Capabilities API: HTTP 200 OK (${capLatency}ms)`);
    console.log(`🖥️  Host System: ${data.system.platform} (${data.system.arch}) | Node: ${data.system.nodeVersion}`);
    console.log(`⚡ Sidecar: ${data.system.sidecarReachable ? `Connected (${data.system.sidecarLatencyMs}ms)` : "Offline"}`);
    console.log(`\n--- Engine Status Verification ---`);

    const REQUIRED_ENGINES = [
      "foldx_linux_elf",
      "box64",
      "rasp",
      "thermompnn",
      "stabilityoracle",
      "japanfold"
    ];

    let hasFailures = false;

    for (const engine of data.engines) {
      const isRequired = REQUIRED_ENGINES.includes(engine.id);
      const isReady = engine.status === "ready";
      const icon = isReady ? "🟢" : engine.status === "standby" ? "🟡" : "🔴";

      console.log(`  ${icon} [${engine.id.padEnd(18)}] ${engine.name.padEnd(42)} -> ${engine.status.toUpperCase()}`);

      if (isRequired && !isReady) {
        // On non-ARM64 hosts, box64 is standby, which is acceptable
        if (engine.id === "box64" && data.system.arch !== "arm64") {
          continue;
        }
        console.error(`     ❌ Required engine '${engine.id}' is not READY (current: ${engine.status})`);
        hasFailures = true;
      }
    }

    const totalDuration = Date.now() - start;
    console.log(`\n======================================================`);

    if (hasFailures) {
      console.error(`❌ Canary Verification FAILED in ${totalDuration}ms.`);
      process.exit(1);
    } else {
      console.log(`🎉 Canary Verification PASSED in ${totalDuration}ms.`);
      console.log(`======================================================\n`);
    }
  } catch (err: any) {
    console.error(`\n❌ Canary Error: ${err.message}`);
    process.exit(1);
  }
}

runCanary();
