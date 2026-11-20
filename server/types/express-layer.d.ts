// Express 4 ships no types for its internal route-calling class. Only what `async-route-errors.ts` uses is declared.
declare module "express/lib/router/layer.js" {
  import type { NextFunction, Request, Response } from "express";
  const Layer: {
    prototype: {
      handle: (req: Request, res: Response, next: NextFunction) => unknown;
      handle_request: (this: { handle: (req: Request, res: Response, next: NextFunction) => unknown }, req: Request, res: Response, next: NextFunction) => unknown;
    };
  };
  export default Layer;
}
