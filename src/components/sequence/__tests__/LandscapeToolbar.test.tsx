// @vitest-environment jsdom
/**
 * The Landscape toolbar. Lanes are independent switches (not a single choice), so they report
 * aria-pressed, show a check icon, and a lane with nothing to draw stays focusable but inert.
 */
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LandscapeToolbar } from "../LandscapeToolbar";

afterEach(cleanup);

function renderToolbar(onView = vi.fn()) {
  render(
    <LandscapeToolbar
      scope="overview"
      view={{ colorBy: "alphaMissense", lanes: { clinvar: true, gnomad: false, regions: false } }}
      onView={onView}
      mode="mean"
      width={31}
      targetPos={116}
      available={{ regions: false }}
      awayFromTarget={false}
      onBack={vi.fn()}
    />
  );
  return onView;
}

describe("LandscapeToolbar lanes", () => {
  it("toggles lanes independently, with a check icon on each switch", () => {
    const onView = renderToolbar();
    const clinvar = screen.getByRole("button", { name: "ClinVar" });
    expect(clinvar.getAttribute("aria-pressed")).toBe("true");
    expect(clinvar.querySelector(".ls-lane-toggle__check")?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByRole("button", { name: "gnomAD" }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(clinvar);
    expect(onView).toHaveBeenCalledWith({ lanes: { clinvar: false, gnomad: false, regions: false } });
    expect(screen.getByRole("radio", { name: "Mean" }).getAttribute("aria-checked")).toBe("true");
  });

  it("keeps a lane with nothing to draw focusable, explained, and inert", () => {
    const onView = renderToolbar();
    const regions = screen.getByRole("button", { name: "Regional O/E" });
    expect(regions.getAttribute("aria-disabled")).toBe("true");
    expect(regions.hasAttribute("disabled")).toBe(false);
    expect(regions.getAttribute("title")).toBe("Nothing to draw for this gene");
    expect(regions.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(regions);
    expect(onView).not.toHaveBeenCalled();
  });
});
