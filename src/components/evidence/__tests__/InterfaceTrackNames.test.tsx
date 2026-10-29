// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InterfaceTrack, planRangeNames, type NamedRange, type RangeNamePlan } from "../interfaces/InterfaceTrack";
import { buildInterfacesEvidence, type InterfacesEvidence } from "../../../shared/interfacesEvidence";
import { NAE1_UNIPROT } from "../../../shared/__tests__/fixtures/nae1FunctionalDomains";

/**
 * Names on the sequence track, on NAE1 p.Asp116Gly (doc/INTERFACES_PPI_REVIEW.md). Its mapped Site at 211 and
 * its Region at 331–344 are both "Interaction with UBA3"; before, they drew as hollow boxes with no label.
 * A name that does not fit its range is a callout, and each labelled lane ends in exact containment.
 */

/** NAE1's track with the variant at `position`; the mapped sites carry the containment the service reports. */
function nae1Track(position: number, extraFeatures: unknown[] = []): InterfacesEvidence {
  return buildInterfacesEvidence({
    result: {
      metadata: { gene: "NAE1", variant: "p.Asp116Gly", uniprotId: "Q13564", residueIndex: 116 },
      uniprotFeatures: { ...NAE1_UNIPROT, features: [...extraFeatures, ...NAE1_UNIPROT.features] },
    } as any,
    assembly: null,
    assemblyStatus: "ready",
    ppi: {
      status: "success", gene: "NAE1", variant: "p.Asp116Gly", uniprotId: "Q13564", position, sequenceLength: 534,
      stringPartners: [], string: { physical: [], functional: [], limit: 500, minScore: 0.15 }, curatedInteractions: [],
      interactionSites: [
        { type: "Site", start: 211, end: 211, description: "Interaction with UBA3", partners: ["UBA3"], containsVariant: position === 211 },
        { type: "Region", start: 331, end: 344, description: "Interaction with UBA3", partners: ["UBA3"], containsVariant: position >= 331 && position <= 344 },
      ],
      lookups: { stringPartners: "ok", stringPhysical: "ok", intact: "ok", uniprot: "ok" },
    } as any,
    ppiStatus: "ready",
    shift: null,
    shiftLoading: false,
  });
}

function laneRow(kind: string): HTMLElement {
  return document.querySelector<HTMLElement>(`.ifc-track__row[data-kind="${kind}"]`)!;
}

describe("InterfaceTrack — names without a layout", () => {
  it("draws no name before a width is measured, and the lane summary still names what it holds", () => {
    render(<InterfaceTrack ev={nae1Track(116)} />);
    const track = screen.getByTestId("interface-track");
    // Without a layout nothing can be measured, so no name is drawn: not inside a range, and not as a
    // callout either. Drawing every name as a callout on row 0 overprinted them all for the first frame and
    // jumped the lane's height.
    expect(track.querySelector(".ifc-track__range-name")).toBeNull();
    expect(track.querySelector(".ifc-track__callouts")).toBeNull();
    // Nothing is lost to assistive tech: the lane's accessible summary carries the names.
    expect(laneRow("domains").querySelector(".ifc-track__lane")).toHaveAttribute("aria-label", expect.stringContaining("THIF-type NAD/FAD binding fold"));
    expect(laneRow("sites").querySelector(".ifc-track__lane")).toHaveAttribute("aria-label", expect.stringContaining("Interaction with UBA3"));
    // The domains lane draws the Functional domains map's own domain (InterPro's THIF fold); the UBA3 Region is
    // the same feature as the mapped Region, so it is drawn once, in the sites lane.
    expect(within(laneRow("domains")).queryByText(/Interaction with UBA3/)).toBeNull();
  });

  it.each([
    // THIF fold 13–530 (InterPro) covers all three; exact containment, as the Functional domains map reads it.
    [116, "In domain", "Outside"],
    [211, "In domain", "At site"],
    [335, "In domain", "At site"],
    [5, "Outside", "Outside"],
  ])("states exact containment at each lane's end for variant %i: domains %s, sites %s", (position, domains, sites) => {
    render(<InterfaceTrack ev={nae1Track(position)} />);
    expect(laneRow("domains").querySelector(".ifc-track__readout")?.textContent).toBe(domains);
    expect(laneRow("sites").querySelector(".ifc-track__readout")?.textContent).toBe(sites);
  });
});

describe("planRangeNames", () => {
  const pct = (v: number) => ((v - 1) / 533) * 100;
  const measure = (text: string) => text.length * 5;
  const named = (start: number, end: number, name: string, calloutText = name): NamedRange => ({ start, end, name, calloutText });
  const rowOf = (plan: RangeNamePlan) => (plan.inline ? null : plan.row);

  it("keeps a name inside its range only when it fits with its padding", () => {
    const plans = planRangeNames([named(1, 300, "UBA-like"), named(331, 344, "Interaction with UBA3", "331–344 · Interaction with UBA3")], { pct, width: 600, measure });
    expect(plans[0]).toEqual({ inline: true });
    expect(plans[1]).toEqual({ inline: false, left: expect.any(Number), row: 0 });
  });

  it("puts callouts that would overprint on separate rows, greedily", () => {
    const plans = planRangeNames(
      [named(211, 211, "Site 211 · Interaction with UBA3"), named(331, 344, "Interaction with UBA3", "Region 331–344 · Interaction with UBA3")],
      { pct, width: 600, measure }
    );
    expect(plans.map(p => p.inline)).toEqual([false, false]);
    expect(plans.map(rowOf)).toEqual([0, 1]);
  });

  it("pulls a callout at the lane's right edge back so it stays inside the lane", () => {
    const plans = planRangeNames([named(500, 534, "C-terminal tail", "500–534 · C-terminal tail")], { pct, width: 600, measure });
    const plan = plans[0];
    expect(plan.inline).toBe(false);
    if (plan.inline) return;
    // The callout is 25 characters (125px) plus its 7px of padding and rule, so it may start no later than 78%.
    expect(plan.left).toBeCloseTo(78);
  });

  it("draws nothing when nothing can be measured, rather than stacking every name on row 0", () => {
    const plans = planRangeNames([named(1, 300, "UBA-like"), named(331, 344, "Interaction with UBA3", "331–344 · Interaction with UBA3")], { pct, width: 0, measure });
    expect(plans).toEqual([]);
  });
});

describe("InterfaceTrack — with a measured lane", () => {
  class LaneObserver {
    constructor(private readonly callback: (entries: Array<{ contentRect: { width: number } }>) => void) {}
    observe() {
      this.callback([{ contentRect: { width: 600 } }]);
    }
    disconnect() {}
  }

  beforeEach(() => {
    // jsdom has no layout and no canvas: a 600px lane, and a canvas that measures five pixels a character.
    vi.stubGlobal("ResizeObserver", LaneObserver);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ font: "", measureText: (text: string) => ({ width: text.length * 5 }) } as any);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("draws a name inside the range it fits, and calls out the one it does not", () => {
    render(<InterfaceTrack ev={nae1Track(116, [{ type: "Region", description: "Short", start: 535, end: 536, evidence: [] }])} />);
    // 13–530 is ~580px of a 600px lane: the THIF name fits inside it. The two-residue Region does not.
    expect(within(laneRow("domains")).getByText("THIF-type NAD/FAD binding fold")).toHaveClass("ifc-track__range-name");
    expect(screen.getByText("535–536 · Short")).toHaveClass("ifc-track__callout");
    expect(screen.getByTestId("interface-track").querySelectorAll(".ifc-track__range-name")).toHaveLength(1);
  });

  it("stacks the two sites' callouts on separate rows, so neither overprints the other", () => {
    render(<InterfaceTrack ev={nae1Track(116)} />);
    const sites = laneRow("sites");
    expect(within(sites).getByText("Site 211 · Interaction with UBA3").style.top).toBe("0px");
    expect(within(sites).getByText("Region 331–344 · Interaction with UBA3").style.top).toBe("15px");
    expect(sites.querySelector<HTMLElement>(".ifc-track__callouts")!.style.height).toBe("30px");
  });
});
