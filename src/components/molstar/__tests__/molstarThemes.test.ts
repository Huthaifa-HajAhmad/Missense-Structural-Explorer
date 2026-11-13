import { describe, expect, it, vi } from "vitest";

vi.mock("molstar/lib/mol-model/structure", () => ({
  StructureElement: {},
  StructureProperties: {},
  Unit: {},
  Bond: {},
}));
vi.mock("molstar/lib/mol-util/color", () => ({
  Color: (value: number) => value,
}));
vi.mock("molstar/lib/mol-theme/color", () => ({
  ColorTheme: {},
}));
vi.mock("molstar/lib/mol-theme/color/categories", () => ({
  ColorThemeCategory: { Misc: "Misc" },
}));
vi.mock("molstar/lib/mol-util/param-definition", () => ({
  ParamDefinition: {
    Numeric: vi.fn((v: unknown) => v),
    Select: vi.fn((v: unknown) => v),
    Value: vi.fn((v: unknown) => v),
    getDefaultValues: vi.fn(() => ({})),
    Empty: {},
  },
}));

import { isValidPdbUrl } from "../molstarThemes";

describe("isValidPdbUrl", () => {
  it("allows safe relative URLs and allowlisted HTTPS/HTTP hosts case-insensitively", () => {
    expect(isValidPdbUrl("/api/v1/pdb/1ABC")).toBe(true);
    expect(isValidPdbUrl("structures/1ABC.pdb")).toBe(true);
    expect(isValidPdbUrl("https://files.rcsb.org/download/1ABC.cif")).toBe(true);
    expect(isValidPdbUrl("HTTPS://FILES.RCSB.ORG/download/1ABC.cif")).toBe(true);
    expect(isValidPdbUrl("http://www.ebi.ac.uk/pdbe/entry-files/download/1abc.cif")).toBe(true);
  });

  it("rejects uppercase non-allowlisted origins, protocol-relative URLs, and non-HTTP schemes", () => {
    expect(isValidPdbUrl("")).toBe(false);
    expect(isValidPdbUrl("//evil.example/1ABC.pdb")).toBe(false);
    expect(isValidPdbUrl("\\evil\\1ABC.pdb")).toBe(false);
    expect(isValidPdbUrl("HTTPS://evil.example/1ABC.pdb")).toBe(false);
    expect(isValidPdbUrl("javascript:alert(1)")).toBe(false);
    expect(isValidPdbUrl("data:text/plain,ATOM")).toBe(false);
  });
});
