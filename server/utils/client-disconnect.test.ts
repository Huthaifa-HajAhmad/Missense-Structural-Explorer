import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { onClientDisconnect } from "./client-disconnect.ts";

/** Minimal stand-in for an Express `Response` with just the surface the helper uses. */
function makeResponse(writableEnded: boolean) {
  const emitter = new EventEmitter() as EventEmitter & { writableEnded: boolean };
  emitter.writableEnded = writableEnded;
  return emitter;
}

describe("onClientDisconnect", () => {
  /**
   * Regression guard for the narrative outage.
   *
   * Node emits 'close' on `req` as soon as the request body has been read — which
   * express.json() has already done before the handler runs — so listening on `req` cancels
   * in-flight work the client is still waiting for. The helper must therefore listen on `res`.
   */
  it("never listens on the request object", () => {
    const req = new EventEmitter();
    const res = makeResponse(false);
    const onDisconnect = vi.fn();

    onClientDisconnect(res, onDisconnect);

    // The helper must attach nothing to req: a body-completed 'close' on req would have
    // cancelled the request immediately.
    expect(req.listenerCount("close")).toBe(0);
    expect(req.eventNames()).toEqual([]);

    // Emitting the body-completed 'close' on req must therefore be harmless.
    req.emit("close");
    expect(onDisconnect).not.toHaveBeenCalled();
  });

  it("fires when the response closes before it finished", () => {
    const res = makeResponse(false);
    const onDisconnect = vi.fn();
    onClientDisconnect(res, onDisconnect);

    res.emit("close");

    expect(onDisconnect).toHaveBeenCalledTimes(1);
  });

  it("does not fire when the response already completed normally", () => {
    const res = makeResponse(true);
    const onDisconnect = vi.fn();
    onClientDisconnect(res, onDisconnect);

    res.emit("close");

    expect(onDisconnect).not.toHaveBeenCalled();
  });

  it("returns an unsubscribe that detaches the listener", () => {
    const res = makeResponse(false);
    const onDisconnect = vi.fn();
    const unsubscribe = onClientDisconnect(res, onDisconnect);

    unsubscribe();
    res.emit("close");

    expect(onDisconnect).not.toHaveBeenCalled();
    expect(res.listenerCount("close")).toBe(0);
  });

  it("is a no-op when the response cannot take listeners", () => {
    expect(() => onClientDisconnect(null, vi.fn())).not.toThrow();
    expect(() => onClientDisconnect(undefined, vi.fn())).not.toThrow();
    expect(() => onClientDisconnect({} as any, vi.fn())).not.toThrow();
  });
});
