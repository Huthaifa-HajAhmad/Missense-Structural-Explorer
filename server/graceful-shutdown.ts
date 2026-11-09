import type { Server } from "http";

/**
 * A promise that fails with nobody listening is logged, and the server keeps running.
 *
 * Node's default is to stop the process, which ends every request and running job because of one
 * background task (a cache write, a progress update). Jobs would recover after a restart, but every
 * reader would see an error first. A thrown error (`uncaughtException`) still stops the process, because
 * its state may be broken.
 */
export function keepRunningOnUnhandledRejection(proc: Pick<NodeJS.Process, "on"> = process): void {
  proc.on("unhandledRejection", (reason: unknown) => {
    const detail = reason instanceof Error ? reason.stack ?? reason.message : String(reason);
    console.error(`[Process] A background task failed and nothing handled it; the server keeps running. ${detail}`);
  });
}

export interface ShutdownHook {
  name: string;
  fn: () => Promise<void> | void;
}

/**
 * Registers an ordered graceful shutdown handler for SIGTERM and SIGINT.
 *
 * Order: stop accepting connections, run the hooks (the job queue, worker pools and temp files close
 * here), then close the connections still open (event streams, idle keep-alives) and exit. Accepting
 * new requests while the hooks run used to send them to a queue whose database was already closed.
 * A 10 s watchdog still forces the exit.
 */
export function registerGracefulShutdown(
  serverInstance: Pick<Server, "close"> & Partial<Pick<Server, "closeAllConnections">>,
  hooks: ShutdownHook[] = [],
  proc: Pick<NodeJS.Process, "on"> = process
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

    // Stop taking new connections first; requests already in progress may finish.
    const closed = new Promise<Error | undefined>((resolve) => serverInstance.close((err) => resolve(err)));

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

    // Nothing is left to serve: end the connections still open, so the exit does not wait for the watchdog.
    serverInstance.closeAllConnections?.();
    const err = await closed;
    if (err) {
      console.error("[Shutdown Error] Error closing HTTP server:", err.message);
      process.exit(1);
    }
    console.log("[Shutdown] HTTP server closed successfully.");
    process.exit(0);
  };

  proc.on("SIGTERM", () => shutdown("SIGTERM"));
  proc.on("SIGINT", () => shutdown("SIGINT"));
}
