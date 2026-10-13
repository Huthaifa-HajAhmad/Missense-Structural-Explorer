/**
 * egress-owner.ts — attributes every outbound call a request makes to its signed-in person (else the
 * queue's `legacy` owner), so the egress governor can share providers fairly between people (WP-I1).
 *
 * Mounted on the API router right after `authCheck`, which resolves `req.principal`.
 */
import type express from "express";
import { submitterId } from "./principal.ts";
import { runWithEgressOwner } from "../services/infra/egress-context.ts";
import { LEGACY_OWNER } from "../services/infra/queue-owners.ts";

export const attributeEgressOwner: express.RequestHandler = (req, _res, next) =>
  runWithEgressOwner(submitterId(req) ?? LEGACY_OWNER, next);
