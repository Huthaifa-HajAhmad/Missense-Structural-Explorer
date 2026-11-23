import { describe, it, expect, vi, beforeEach } from "vitest";

const resolveDeclared = vi.hoisted(() => vi.fn());
// Routed through a plain function: a rejection returned by the spy itself is reported by the test
// runner as unhandled even when the code under test catches it.
const unreachable = vi.hoisted(() => ({ on: false }));
vi.mock("./protein-numbering.ts", () => ({
  resolveAccessionedProteinNotation: (...args: unknown[]) =>
    unreachable.on ? Promise.reject(new Error("upstream_unavailable")) : resolveDeclared(...args),
}));

import { verifyDeclaredNumbering } from "./verify-declared-numbering.ts";
import type { NumberingVerdict } from "./isoform-numbering.ts";

/** What the VariantValidator fallback produces: a RefSeq protein, but no UniProt accession. */
const fallbackVerdict = (overrides: Partial<NumberingVerdict> = {}): NumberingVerdict => ({
  status: "unverified",
  consequence: { hgvsp: "NP_000537.3:p.(Arg273His)", numbering_protein_id: "NP_000537.3" } as any,
  numberingProteinId: "NP_000537.3",
  reason: "the provider did not report a UniProt accession to verify the numbering against",
  ...overrides,
});

describe("verifyDeclaredNumbering", () => {
  beforeEach(() => resolveDeclared.mockReset());

  it("verifies a fallback answer through the RefSeq protein it names", async () => {
    resolveDeclared.mockResolvedValue({
      status: "canonical", canonicalAccession: "P04637", canonicalVariant: "p.Arg273His", basisId: "P04637-1", basisKind: "canonical",
    });
    const verdict = await verifyDeclaredNumbering(fallbackVerdict());
    expect(resolveDeclared).toHaveBeenCalledWith({ accession: "NP_000537.3", proteinNotation: "p.(Arg273His)" });
    expect(verdict).toMatchObject({ status: "canonical", canonicalAccession: "P04637", numberingIsoform: "P04637-1" });
    expect(verdict.consequence.hgvsp).toBe("NP_000537.3:p.(Arg273His)");
  });

  it("renumbers onto the canonical sequence when the RefSeq protein is another isoform", async () => {
    resolveDeclared.mockResolvedValue({
      status: "remapped", canonicalAccession: "Q9Y305", canonicalVariant: "p.Lys290Asn", basisId: "Q9Y305-4", basisKind: "isoform",
    });
    const verdict = await verifyDeclaredNumbering(fallbackVerdict({
      consequence: { hgvsp: "NP_001032248.1:p.(Lys281Asn)" } as any,
      numberingProteinId: "NP_001032248.1",
    }));
    expect(verdict).toMatchObject({ status: "remapped", canonicalAccession: "Q9Y305", fromIsoform: "Q9Y305-4" });
    // The analysed notation is the canonical one; the original stays readable for the disclosure.
    expect(verdict.consequence.hgvsp).toBe("Q9Y305:p.Lys290Asn");
  });

  it.each(["unverified", "ambiguous", "unresolved"])("keeps the answer unverified when the protein check says %s", async (status) => {
    resolveDeclared.mockResolvedValue({ status, reason: "x" });
    const original = fallbackVerdict();
    expect(await verifyDeclaredNumbering(original)).toBe(original);
  });

  it("keeps the answer unverified when UniProt cannot be reached", async () => {
    unreachable.on = true;
    const original = fallbackVerdict();
    expect(await verifyDeclaredNumbering(original)).toBe(original);
    unreachable.on = false;
  });

  it("leaves verified answers, and answers that name no protein, alone", async () => {
    const canonical = fallbackVerdict({ status: "canonical", canonicalAccession: "P04637" });
    const nameless = fallbackVerdict({ numberingProteinId: undefined });
    expect(await verifyDeclaredNumbering(canonical)).toBe(canonical);
    expect(await verifyDeclaredNumbering(nameless)).toBe(nameless);
    expect(resolveDeclared).not.toHaveBeenCalled();
  });
});
