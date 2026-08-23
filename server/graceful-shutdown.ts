import type { Server } from "http";

export interface ShutdownHook {
  name: string;
  fn: () => Promise<void> | void;
}

/**
 * Registers an ordered graceful shutdown handler for SIGTERM and SIGINT.
 * Executes registered hooks, closes the HTTP server, and enforces a 10s watchdog timeout.
 */
export function registerGracefulShutdown(
  serverInstance: Server,
  hooks: ShutdownHook[] = []
): void {
  let isShuttingDown = false;

  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log(`[Shutdown] Received ${signal}. Starting graceful shutdown...`);

    // 10-second unreferenced watchdog timer to prevent hung shutdowns
    const watchdog = setTimeout(() => {
      console.error("[Shutdown] Force exiting after 10-second timeout.");
      process.exit(1);
    }, 10000);
    if (typeof watchdog.unref === "function") {
      watchdog.unref();
    }

    // Execute registered subsystem shutdown hooks
    for (const hook of hooks) {
      try {
        console.log(`[Shutdown] Executing cleanup hook: ${hook.name}...`);
        await hook.fn();
        console.log(`[Shutdown] Cleaned up: ${hook.name}.`);
      } catch (err: any) {
        console.error(`[Shutdown Error] Cleanup failed for ${hook.name}:`, err.message);
      }
    }

    // Close HTTP server
    serverInstance.close((err) => {
      if (err) {
        console.error("[Shutdown Error] Error closing HTTP server:", err.message);
        process.exit(1);
      }
      console.log("[Shutdown] HTTP server closed successfully.");
      process.exit(0);
    });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
