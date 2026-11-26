// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InterfacesTab } from "../InterfacesTab";
import { InterfacesRail } from "../../inspector/InterfacesRail";
import { ABCG1_INTERFACES as F } from "../../../shared/__tests__/fixtures/abcg1Interfaces";

/**
 * What the screen may claim on ABCG1 p.Gly358Arg, the variant of the 2026-11-26 audit
 * (doc/INTERFACES_PPI_AUDIT_2026-11-26.md): Gly358 has no coordinates in any of the five solved
 * structures, SUBUNIT names the ABCG subfamily (not a gene), and the dimer is 1,356 residues.
 */
const { fetchWithAuthMock } = vi.hoisted(() => ({ fetchWithAuthMock: vi.fn() }));
vi.mock("../../../apiClient", () => ({
  useApiClient: () => ({ fetchWithAuth: fetchWithAuthMock }),
  extractErrorMessage: vi.fn(async () => "Upstream said no."),
}));
vi.mock("../../../stores/useVariantAnalysisStore", () => ({
  useVariantAnalysisStore: { getState: () => ({ setAnalysisState: vi.fn(), analysisState: null }) },
}));
vi.mock("../../../services/pipeline/variantCache", () => ({ setCachedVariant: vi.fn() }));

const RESULT: any = { ...F.result, multimerData: F.assembly, ppiBindingData: F.ppi };
const props = { analysisState: { result: RESULT, isLoading: false }, energyUnit: "kcal/mol", formatDdGValue: (v: number) => `${v}`, onTabChange: vi.fn() } as any;

afterEach(() => fetchWithAuthMock.mockReset());

describe("InterfacesTab — ABCG1 p.Gly358Arg", () => {
  it("leads with 'Not modelled' in words, never '0 of 5' or 'not at an interface'", () => {
    render(<InterfacesTab {...props} />);
    const finding = screen.getByTestId("interfaces-finding");
    expect(within(finding).getByText("Not modelled", { selector: ".ifc-figure" })).toBeInTheDocument();
    expect(finding).toHaveTextContent("5 solved structures with the other ABCG1 chain; none has coordinates for Gly358");
    expect(finding).toHaveTextContent("Gly358 lies in the cytoplasmic part");
    expect(document.body).not.toHaveTextContent(/0 of 5|Not at an interface|not at the interface in any/);
  });

  it("draws the unmodelled stretch, hatched, on the hero's map around the residue and on the atlas", () => {
    render(<InterfacesTab {...props} />);
    const summary = screen.getByTestId("interface-track-summary");
    expect(summary.querySelectorAll(".ifc-track__gap").length).toBeGreaterThan(0);
    // The summary is read-only: the atlas's lanes are the one place a reading is opened.
    expect(within(summary).queryByRole("button")).toBeNull();
    expect(screen.getByTestId("interface-track")).toHaveTextContent("–/5");
    expect(screen.getByLabelText("Legend")).toHaveTextContent("No coordinates in any of the pair's structures");
  });

  it("names the ABCG subfamily as a family in the records, and gives it no STRING link", () => {
    render(<InterfacesTab {...props} />);
    expect(screen.getByTestId("assembly-readings")).toHaveTextContent("Names a family (the ABCG subfamily), not a gene");
    const grid = screen.getByTestId("partner-grid");
    const family = within(grid).getByText("ABCG subfamily").closest("tr")!;
    expect(within(family).queryByRole("link")).toBeNull();
    expect(document.querySelector(".ifc-partners__shape")).toHaveTextContent(/^6 partner proteins with binding evidence/);
  });

  it("does not offer LocalFold for a 1,356-residue complex", () => {
    render(<InterfacesTab {...props} />);
    expect(screen.getByTestId("local-fold")).toHaveTextContent("Not offered for this complex: 1,356 residues");
    expect(screen.getByTestId("binding-card")).toHaveTextContent("Gly358 is not modelled in any solved complex of ABCG1");
  });

  it("traces the residue as not modelled, with the gap", () => {
    render(<InterfacesRail analysisResult={RESULT} />);
    const trace = screen.getByTestId("interfaces-trace");
    expect(trace).toHaveTextContent("Not modelled in any of 5 solved structures");
    expect(trace).toHaveTextContent("Residues 348–396 have no coordinates in any of them.");
    expect(trace).toHaveTextContent("Heterodimer with the ABCG subfamily");
  });
});
