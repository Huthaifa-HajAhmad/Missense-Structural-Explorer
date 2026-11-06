/**
 * deliver.ts — send a finished job's outcome to the workspace, again if the first try was lost.
 *
 * A result is minutes of work. If its upload fails on the network, or the server answers with a
 * temporary error (429 or 5xx), losing it means the server runs the whole job again. So the agent
 * tries again a few times, while the job is still its own (heartbeats keep the lease alive meanwhile).
 * The server treats a repeated delivery of an accepted result as accepted, so a retry after a reply
 * that was lost on the way back is safe. Any other answer (409, 410, 401, 400) is final.
 */
import { AgentHttpError } from "./client.ts";

export const DELIVERY_WAITS_MS = [5_000, 20_000];

export interface DeliveryOptions {
  /** False once the server has said the job is no longer this computer's. */
  stillOurs: () => boolean;
  waitsMs?: number[];
  sleep?: (ms: number) => Promise<void>;
}

const temporary = (err: unknown) => !(err instanceof AgentHttpError) || err.status === 429 || err.status >= 500;

export async function deliverWithRetry<T>(send: () => Promise<T>, opts: DeliveryOptions): Promise<T> {
  const waits = opts.waitsMs ?? DELIVERY_WAITS_MS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; ; attempt++) {
    try {
      return await send();
    } catch (err) {
      if (!temporary(err) || attempt >= waits.length || !opts.stillOurs()) throw err;
      await sleep(waits[attempt]);
    }
  }
}
