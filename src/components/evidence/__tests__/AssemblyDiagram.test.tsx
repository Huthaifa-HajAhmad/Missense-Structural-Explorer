// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AssemblyDiagram } from "../interfaces/AssemblyDiagram";
import { buildInterfacesEvidence, type InterfacesEvidence } from "../../../shared/interfacesEvidence";
import { SOD1_INTERFACES as F } from "../../../shared/__tests__/fixtures/sod1Interfaces";

/**
 * The composition draws a connector only where PDBe-KB measured a native interface for the pair
 * (doc/INTERFACES_PPI_REVIEW.md). SOD1 p.Ala5Val: the homodimer is measured (0 of 142 native); the fibril
 * stack (4 of 15) is never an edge.
 */
function sod1(): InterfacesEvidence {
  return buildInterfacesEvidence({ result: F.result, assembly: F.assembly, assemblyStatus: "ready", ppi: F.ppi, ppiStatus: "ready", shift: null, shiftLoading: false });
}

const edgeList = () => screen.queryByRole("list", { name: "Measured interfaces between chains" });

describe("AssemblyDiagram — connectors come from measured pairs only", () => {
  it("draws the homodimer from the measured other copy, muted, with the residue's count", () => {
    render(<AssemblyDiagram ev={sod1()} />);
    const edges = within(edgeList()!).getAllByRole("listitem");
    expect(edges).toHaveLength(1);
    expect(edges[0]).not.toHaveAttribute("data-lit");
    expect(edges[0]).toHaveTextContent("Ala5 not at it, in 142 solved structures");
    expect(screen.queryByText(/No solved structure of this pair/)).toBeNull();
  });

  it("never draws the fibril stack as an edge", () => {
    render(<AssemblyDiagram ev={sod1()} />);
    expect(edgeList()!).not.toHaveTextContent(/of 15/);
    expect(edgeList()!).not.toHaveTextContent(/fibril/i);
  });

  it("lights the edge only when the variant residue is at that interface", () => {
    const ev = sod1();
    const atInterface = { ...ev, observed: { ...ev.observed, partners: ev.observed.partners.map(p => (p.homomeric ? { ...p, k: 3 } : p)) } };
    render(<AssemblyDiagram ev={atInterface} />);
    const edge = within(edgeList()!).getByRole("listitem");
    expect(edge).toHaveAttribute("data-lit");
    expect(edge).toHaveTextContent("Ala5 at it: 3 of 142 solved structures");
  });

  it("matches a heteromer partner by accession, and says which chain has no measured pair", () => {
    const ev = sod1();
    const withPartners = {
      ...ev,
      chains: [
        ...ev.chains,
        { id: "C", label: "CCS", accession: "O14618", carriesVariant: false, role: "partner" as const },
        { id: "D", label: "Partner", accession: "Q00000", carriesVariant: false, role: "partner" as const },
      ],
    };
    render(<AssemblyDiagram ev={withPartners} />);
    const edges = within(edgeList()!).getAllByRole("listitem");
    expect(edges).toHaveLength(2);
    expect(edges[1]).toHaveTextContent("Ala5 not at it, in 3 solved structures");
    const composition = screen.getByRole("group");
    expect(composition.textContent).toContain("1 of the 3 partner chain has no solved structure with this one: composition from UniProt SUBUNIT text.");
  });
});
