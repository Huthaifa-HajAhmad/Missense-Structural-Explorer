import { describe, it, expect } from "vitest";
import { numeric, flags } from "./import-gnomad-constraint.ts";
describe("official constraint TSV missing and invalid values", () => {
  it("distinguishes missing statistics from measured zero", () => {
    expect(numeric("NA")).toBeNull();
    expect(numeric("0")).toBe(0);
    expect(numeric("0.599")).toBe(0.599);
    expect(() => numeric("Infinity")).toThrow();
    expect(() => numeric("broken")).toThrow();
  });
  it("reads Hail flag arrays and rejects malformed flag records", () => {
    expect(flags("NA")).toEqual([]);
    expect(flags('["outlier_mis"]')).toEqual(["outlier_mis"]);
    expect(() => flags('[1]')).toThrow();
    expect(() => flags('{}')).toThrow();
  });
});
