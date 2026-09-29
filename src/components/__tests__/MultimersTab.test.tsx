// @vitest-environment jsdom
import React from "react";
import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MultimersTab } from "../evidence/MultimersTab";
import { MultimerRail } from "../inspector/MultimerRail";

const { fetchWithAuthMock } = vi.hoisted(() => ({ fetchWithAuthMock: vi.fn() }));
vi.mock("../../apiClient", () => ({
  useApiClient: () => ({ fetchWithAuth: fetchWithAuthMock }),
  extractErrorMessage: vi.fn(async () => "error"),
}));
vi.mock("../../stores/useVariantAnalysisStore", () => ({
  useVariantAnalysisStore: Object.assign(() => undefined, {
    getState: () => ({ analysisState: null, setAnalysisState: vi.fn() }),
  }),
}));
vi.mock("../../services/pipeline/variantCache", () => ({ setCachedVariant: vi.fn() }));

afterEach(() => fetchWithAuthMock.mockReset());

const SUBUNIT = "Heterodimer of UBA3 and NAE1. The complex binds NEDD8 and UBE2M. Binds APP and TP53BP2";
const multimerData = {
  status: "not-modelled",
  notModelledReason: "heteromer-partner",
  gene: "NAE1",
  uniprotId: "Q13564",
  oligomericState: "Heterodimer",
  chainCount: 1,
  chainIds: ["A"],
  complexPdb: null,
  ipTm: null,
  pTm: null,
  interfaceContacts: [],
  provenance: "UniProt SUBUNIT",
  subunitComment: SUBUNIT,
  variantPosition: 116,
  variantAtInterface: null,
  assembly: { kind: "heteromer", label: "Heterodimer", copies: 2, homoAssumed: false, sentence: "Heterodimer of UBA3 and NAE1.", alsoStated: [], partners: [] },
  experimental: { status: "none", partners: [] },
};
const result: any = {
  metadata: { gene: "NAE1", variant: "p.Asp116Gly", uniprotId: "Q13564", residueIndex: 116 },
  uniprotFeatures: { subunitComment: SUBUNIT, sequenceLength: 534, features: [] },
  multimerData,
};

function renderTab(r: any) {
  return render(<MultimersTab {...({ analysisState: { result: r, isLoading: false }, onTabChange: () => {} } as any)} />);
}

describe("MultimersTab", () => {
  it("states NAE1's heterodimer and never calls it a monomer", () => {
    renderTab(result);
    const finding = screen.getByTestId("multimer-finding");
    expect(finding.textContent).not.toMatch(/monomer/i);
    expect(within(finding).getByTestId("multimer-finding-sentence").textContent).toContain("NAE1 works as a heterodimer, not as a single chain.");
    expect(within(finding).getByTestId("interface-verdict").textContent).toBe("Not measured");
    expect(finding.textContent).toContain("No ACMG code is drawn from this tab");
    expect(fetchWithAuthMock).not.toHaveBeenCalled();
  });

  it("gives each absence its reason instead of a red failure", () => {
    renderTab(result);
    const table = screen.getByTestId("multimer-readings");
    expect(table.textContent).toContain("could not be resolved to exactly one UniProt entry");
    expect(table.textContent).toContain("Not available here");
    expect(table.textContent).toContain("PDBe records no protein–protein interface");
    expect(document.body.textContent).not.toMatch(/disrupt|OpenFold3|4\.5 Å|Tenstorrent/);
  });

  it("asks for a fresh result when the stored one predates the fix", () => {
    fetchWithAuthMock.mockReturnValue(new Promise(() => {}));
    const { assembly: _a, ...old } = multimerData;
    renderTab({ ...result, multimerData: { ...old, status: "monomeric" } });
    expect(fetchWithAuthMock).toHaveBeenCalledTimes(1);
  });

  it("renders the rail from the same model, with the engine record last", () => {
    render(<MultimerRail analysisResult={result} />);
    const trace = screen.getByTestId("multimer-rule-trace");
    expect(trace.textContent).toContain("SUBUNIT states: heterodimer");
    expect(trace.textContent).toContain("No ACMG criterion reads this tab.");
    expect(screen.getByTestId("iptm-bands").textContent).toContain("> 0.8");
  });
});
