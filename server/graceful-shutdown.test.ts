import { EventEmitter } from "events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { keepRunningOnUnhandledRejection, registerGracefulShutdown } from "./graceful-shutdown.ts";

describe("an unhandled promise rejection", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is logged with its cause, and the process is not stopped", () => {
    const proc = new EventEmitter();
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    keepRunningOnUnhandledRejection(proc as unknown as NodeJS.Process);

    proc.emit("unhandledRejection", new Error("cache write failed"), Promise.resolve());

    expect(log).toHaveBeenCalledWith(expect.stringContaining("cache write failed"));
    expect(exit).not.toHaveBeenCalled();
  });
});

describe("graceful shutdown", () => {
  afterEach(() => vi.restoreAllMocks());

  it("stops taking connections before the hooks run, then closes what is left and exits cleanly", async () => {
    const order: string[] = [];
    let onClosed: (err?: Error) => void = () => {};
    const server = {
      close: (cb: (err?: Error) => void) => { order.push("stop accepting"); onClosed = cb; return server; },
      closeAllConnections: () => { order.push("close open connections"); onClosed(); },
    };
    const proc = new EventEmitter();
    const exited = new Promise<number>((resolve) => vi.spyOn(process, "exit").mockImplementation(((code: number) => resolve(code)) as never));
    vi.spyOn(console, "log").mockImplementation(() => {});
    registerGracefulShutdown(server as any, [{ name: "queue", fn: () => { order.push("hook"); } }], proc as unknown as NodeJS.Process);

    proc.emit("SIGTERM");

    expect(await exited).toBe(0);
    expect(order).toEqual(["stop accepting", "hook", "close open connections"]);
  });
});
