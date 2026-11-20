import { describe, it, expect } from "vitest";
import { PROVIDER_STATE_LABELS, type ProviderState } from "../providerStatus.ts";
import { ENGINE_STATE_LABELS } from "../engineStatus.ts";

const STATES: ProviderState[] = ["connected", "configured", "degraded", "unreachable", "not-configured", "checking", "stale"];
const LABELS: string[] = Object.values(PROVIDER_STATE_LABELS);

describe("PROVIDER_STATE_LABELS", () => {
  it("has exactly the seven provider states", () => {
    expect(Object.keys(PROVIDER_STATE_LABELS).sort()).toEqual([...STATES].sort());
  });

  it("gives every state its own label", () => {
    expect(new Set(LABELS).size).toBe(STATES.length);
  });

  it("shares no label with the computation vocabulary", () => {
    for (const label of LABELS) expect(Object.values(ENGINE_STATE_LABELS)).not.toContain(label);
  });
});
