import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { PROVIDER_STATE_LABELS, type ProviderState } from "../providerStatus.ts";
import { ENGINE_STATE_LABELS, LEGACY_ENGINE_LABELS, findLegacyLabels } from "../engineStatus.ts";

const STATES: ProviderState[] = ["connected", "configured", "degraded", "unreachable", "not-configured", "checking", "stale"];
const LABELS: string[] = Object.values(PROVIDER_STATE_LABELS);

describe("PROVIDER_STATE_LABELS", () => {
  it("has exactly the seven provider states", () => {
    expect(Object.keys(PROVIDER_STATE_LABELS).sort()).toEqual([...STATES].sort());
  });

  it("gives every state its own label", () => {
    expect(new Set(LABELS).size).toBe(STATES.length);
  });

  it("shares no label with the legacy engine vocabulary", () => {
    for (const label of LABELS) expect(LEGACY_ENGINE_LABELS).not.toContain(label);
  });

  it("shares no label with the computation vocabulary", () => {
    for (const label of LABELS) expect(Object.values(ENGINE_STATE_LABELS)).not.toContain(label);
  });

  it("does not reuse the retired words", () => {
    expect(LABELS).not.toContain("Offline");
    expect(LABELS).not.toContain("Standby");
  });
});

describe("Services rail vocabulary", () => {
  const dir = path.join(process.cwd(), "src", "components", "telemetry");
  const sources = fs.readdirSync(dir).filter(name => /\.tsx?$/.test(name) && !name.includes(".test."));

  it("covers the rail's source files", () => {
    expect(sources).toContain("LiveTelemetryPanel.tsx");
    expect(sources).toContain("computeCards.ts");
  });

  it.each(sources)("%s contains no legacy engine label as a string literal", name => {
    expect(findLegacyLabels(fs.readFileSync(path.join(dir, name), "utf-8"))).toEqual([]);
  });
});
