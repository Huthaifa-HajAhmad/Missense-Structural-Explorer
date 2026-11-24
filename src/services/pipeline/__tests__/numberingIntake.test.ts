import { describe, it, expect, vi } from "vitest";
import { requestNumberingProof } from "../numberingIntake";

/**
 * The intake check answers what the analysis would answer. A refusal (422) is the server's verdict on the
 * residue, so the run must see it; any other failure only means no proof, and the run goes on without one.
 */
describe("requestNumberingProof", () => {
  const params = { gene: "PAH", variant: "p.Arg408Trp" };
  const signal = new AbortController().signal;
  const failingWith = (error: unknown) => ({ getNumberingProof: vi.fn().mockRejectedValue(error) });

  it("passes a refusal on to the run", async () => {
    const refusal = Object.assign(new Error("Numbering not verified"), { status: 422, code: "UNVERIFIED_RESIDUE_NUMBERING" });

    await expect(requestNumberingProof(failingWith(refusal), params, signal)).rejects.toBe(refusal);
  });

  it.each([
    ["a server error", Object.assign(new Error("Bad gateway"), { status: 502 })],
    ["a time-out", new Error("Request timed out after 5000ms")],
  ])("answers no proof after %s, so the run goes on", async (_label, error) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(requestNumberingProof(failingWith(error), params, signal)).resolves.toBeNull();
  });
});
