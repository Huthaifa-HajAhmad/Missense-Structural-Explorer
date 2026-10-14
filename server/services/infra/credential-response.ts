/**
 * credential-response.ts — tells the reader whose token a response's remote model calls used (WP-I4).
 *
 * The API router runs each request with a credential record (`credentials.ts`). Every Biohub, Hugging Face
 * or Tamarind call that is sent notes "your token" or "the team token" there, and a refusal (the team
 * token is not lent, or this person's hourly share of it is used) is noted too. This middleware adds
 * `X-MSE-Credentials` just before the headers go out; the client says it after the result.
 */
import type express from "express";
import { CREDENTIALS_HEADER, encodeCredentialUse } from "../../../src/shared/credentials.ts";
import { currentCredentialUses, newCredentialRecord, runWithCredentialRecord } from "./credentials.ts";

export const reportCredentialUse: express.RequestHandler = (_req, res, next) => {
  const record = newCredentialRecord();
  const writeHead = res.writeHead;
  res.writeHead = function (this: express.Response, ...args: unknown[]) {
    if (record.uses.size > 0 && !res.headersSent) {
      res.setHeader(CREDENTIALS_HEADER, encodeCredentialUse([...record.uses.values()]));
    }
    return (writeHead as (...a: unknown[]) => unknown).apply(this, args);
  } as typeof res.writeHead;
  runWithCredentialRecord(record, next);
};

/** The current request's uses so far, for a streamed response's final frame. */
export { currentCredentialUses };
