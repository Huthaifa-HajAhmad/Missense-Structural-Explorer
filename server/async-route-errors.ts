/**
 * Express 4 ignores the promise an async route or middleware returns. When it rejects before the route has
 * answered, nothing sends a reply, so the request hangs until the browser gives up and the failure only shows
 * as "a background task failed" in the log. Express 5 forwards these errors by itself.
 *
 * This replaces the one Express 4 function that calls a route, with the same steps plus one: a rejected
 * promise goes to `next(error)`, like a thrown error does. The app's JSON error handler then replies. Calling
 * it twice is harmless because the replacement does not wrap the previous one.
 * Delete this file when the app moves to Express 5.
 */
import type { NextFunction, Request, Response } from "express";
import Layer from "express/lib/router/layer.js";

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return typeof (value as { then?: unknown } | null)?.then === "function";
}

export function forwardAsyncRouteErrors(): void {
  Layer.prototype.handle_request = function (req: Request, res: Response, next: NextFunction) {
    const handle = this.handle;
    // Four parameters means an error handler. Express calls those from `handle_error`, never from here.
    if (handle.length > 3) return next();
    try {
      const returned = handle(req, res, next);
      if (isPromiseLike(returned)) {
        // `||`, not `??`: Express reads any falsy error (`""`, `0`) as "no error" and carries on, which hangs.
        returned.then(undefined, (error: unknown) => next(error || new Error("A route failed without giving a reason.")));
      }
    } catch (error) {
      next(error);
    }
  };
}
