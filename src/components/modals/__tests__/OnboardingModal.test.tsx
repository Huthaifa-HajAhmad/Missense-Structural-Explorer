// @vitest-environment jsdom
import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import OnboardingModal, {
  ONBOARDING_BENCHMARK_PRESETS,
  ONBOARDING_STORAGE_KEY,
  TOUR_STEPS,
  layoutCard,
  spotlightFor,
} from "../OnboardingModal";
import { NAV_ZONES } from "../../MasterSidebar";
import { SettingsProvider } from "../../../context/SettingsContext";
import { VariantAnalysisProvider } from "../../../context/VariantAnalysisContext";

function renderTour(props: Partial<React.ComponentProps<typeof OnboardingModal>> = {}) {
  const merged = {
    isOpen: true,
    onClose: vi.fn(),
    onSelectPreset: vi.fn(),
    onOpenSettings: vi.fn(),
    ...props,
  };
  const utils = render(
    <SettingsProvider>
      <VariantAnalysisProvider>
        <OnboardingModal {...merged} />
      </VariantAnalysisProvider>
    </SettingsProvider>
  );
  return { ...utils, props: merged };
}

const next = () => fireEvent.click(screen.getByRole("button", { name: /^(show me around|next)/i }));
const goTo = (stepId: string) => {
  const target = TOUR_STEPS.findIndex((s) => s.id === stepId);
  for (let i = 0; i < target; i++) next();
};

describe("Onboarding tour — content", () => {
  it("has a welcome plus five stops, each with a unique id", () => {
    expect(TOUR_STEPS[0].id).toBe("welcome");
    expect(TOUR_STEPS[0].target).toBeNull();
    expect(TOUR_STEPS).toHaveLength(6);
    expect(new Set(TOUR_STEPS.map((s) => s.id)).size).toBe(TOUR_STEPS.length);
  });

  it("keeps the copy free of the old numbering, title case and marketing words", () => {
    const copy = TOUR_STEPS.map((s) => `${s.title} ${s.body}`).join(" ");
    expect(copy).not.toMatch(/\bzones?\s*\d|\b4 zones|seamless|sovereign|keyless|100%/i);
    for (const s of TOUR_STEPS) {
      // Sentence case: no word after the first is capitalised unless it is a proper noun / acronym.
      const rest = s.title.split(" ").slice(1).filter((w) => /^[A-Z][a-z]/.test(w));
      expect(rest.every((w) => ["Missense", "Fold"].includes(w))).toBe(true);
    }
  });

  it("does not render when closed", () => {
    renderTour({ isOpen: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens on a centred welcome with no progress counter", () => {
    renderTour();
    const dialog = screen.getByRole("dialog", { name: /welcome to missense & fold/i });
    expect(dialog).toHaveAttribute("data-mode", "centre");
    expect(screen.getByTestId("tour-spotlight")).not.toHaveAttribute("data-active");
    expect(screen.queryByText(/step \d of/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /show me around/i })).toHaveFocus();
  });

  it("previews the sidebar zones on the welcome, straight from the registry", () => {
    renderTour();
    for (const zone of NAV_ZONES.filter((z) => z.zoneLabel)) {
      expect(screen.getByText(zone.zoneLabel as string)).toBeInTheDocument();
    }
  });

  it("adds the keyboard shortcuts on the navigation stop", () => {
    renderTour();
    goTo("navigate");
    expect(screen.getByText("Step 3 of 5")).toBeInTheDocument();
    expect(screen.getByText(/jump anywhere/i)).toBeInTheDocument();
    expect(screen.getByText(/collapse the sidebar/i)).toBeInTheDocument();
  });
});

describe("Onboarding tour — navigation", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("walks every stop and finishes on Done", () => {
    const { props } = renderTour();
    for (let stop = 1; stop <= 5; stop++) {
      next();
      expect(screen.getByText(`Step ${stop} of 5`)).toBeInTheDocument();
      expect(screen.getByRole("progressbar", { name: /tour progress/i })).toHaveAttribute("aria-valuenow", String(stop));
    }
    fireEvent.click(screen.getByRole("button", { name: /^done$/i }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(ONBOARDING_STORAGE_KEY)).toBe("true");
  });

  it("goes back with the Back button", () => {
    renderTour();
    next();
    next();
    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));
    expect(screen.getByText("Step 1 of 5")).toBeInTheDocument();
  });

  it("supports ←, → and Esc", () => {
    const { props } = renderTour();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByText("Step 1 of 5")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.queryByText(/step \d of/i)).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalled();
    expect(localStorage.getItem(ONBOARDING_STORAGE_KEY)).toBe("true");
  });

  it("skips from the welcome and from the close button, remembering either way", () => {
    const { props, unmount } = renderTour();
    fireEvent.click(screen.getByRole("button", { name: /skip tour/i }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    unmount();
    localStorage.clear();

    const second = renderTour();
    next();
    fireEvent.click(screen.getByRole("button", { name: /close tour/i }));
    expect(second.props.onClose).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(ONBOARDING_STORAGE_KEY)).toBe("true");
  });

  it("does not end the tour on a stray click behind the card", () => {
    const { props, container } = renderTour();
    const scrim = document.body.querySelector(".tour-scrim") ?? container;
    fireEvent.click(scrim);
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("keeps Tab inside the card", () => {
    renderTour();
    const primary = screen.getByRole("button", { name: /show me around/i });
    const close = screen.getByRole("button", { name: /close tour/i });
    primary.focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(primary).toHaveFocus();
  });

  it("returns focus to the opener when it closes", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const { rerender } = render(
      <SettingsProvider>
        <VariantAnalysisProvider>
          <OnboardingModal isOpen onClose={() => {}} />
        </VariantAnalysisProvider>
      </SettingsProvider>
    );
    expect(opener).not.toHaveFocus();
    rerender(
      <SettingsProvider>
        <VariantAnalysisProvider>
          <OnboardingModal isOpen={false} onClose={() => {}} />
        </VariantAnalysisProvider>
      </SettingsProvider>
    );
    expect(opener).toHaveFocus();
    opener.remove();
  });
});

describe("Onboarding tour — actions", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("opens the Connections section of Settings and records the tour as seen", () => {
    const { props } = renderTour();
    goTo("connections");
    expect(screen.getByText(/no gemini key|gemini key linked/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /add a key|manage keys/i }));
    expect(props.onOpenSettings).toHaveBeenCalledWith("connections");
    expect(props.onClose).toHaveBeenCalled();
    expect(localStorage.getItem(ONBOARDING_STORAGE_KEY)).toBe("true");
  });

  it("hands a benchmark to the app and closes", () => {
    const { props } = renderTour();
    goTo("benchmarks");
    expect(screen.getAllByRole("button", { name: /^run /i })).toHaveLength(ONBOARDING_BENCHMARK_PRESETS.length);
    fireEvent.click(screen.getByRole("button", { name: /PAH p\.Arg408Trp/ }));
    expect(props.onSelectPreset).toHaveBeenCalledWith(
      expect.objectContaining({ gene: "PAH", variant: "p.Arg408Trp", uniprotId: "P00439" })
    );
    expect(props.onClose).toHaveBeenCalled();
    expect(localStorage.getItem(ONBOARDING_STORAGE_KEY)).toBe("true");
  });

  it("runs benchmarks without a key and says what the key would add", () => {
    renderTour();
    goTo("connections");
    expect(screen.getByRole("dialog", { name: /keys are optional/i })).toBeInTheDocument();
    expect(screen.getByText(/rule-based interpretation/i)).toBeInTheDocument();
    next();
    expect(screen.queryByText(/fills in the form/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^run PAH/i })).toBeInTheDocument();
  });

  it("spotlights the target when it is on screen, and centres when it is not", () => {
    const el = document.createElement("div");
    el.setAttribute("data-tour", "variant-input");
    el.getBoundingClientRect = () => ({ top: 100, left: 300, width: 500, height: 300, right: 800, bottom: 400, x: 300, y: 100, toJSON() {} });
    document.body.appendChild(el);
    renderTour();
    act(() => next());
    expect(screen.getByTestId("tour-spotlight")).toHaveAttribute("data-active");
    act(() => next()); // the rail is not in this DOM
    expect(screen.getByTestId("tour-spotlight")).not.toHaveAttribute("data-active");
    el.remove();
  });
});

describe("Onboarding tour — geometry", () => {
  const card = { width: 380, height: 260 };

  it("pads the spotlight and clips it to the viewport", () => {
    expect(spotlightFor({ top: 100, left: 100, width: 200, height: 50 }, 1440, 900)).toEqual({
      top: 94, left: 94, width: 212, height: 62,
    });
    const tall = spotlightFor({ top: 80, left: 300, width: 400, height: 2000 }, 1440, 900);
    expect(tall!.top + tall!.height).toBeLessThanOrEqual(900);
  });

  it("treats zero-size and off-screen targets as absent", () => {
    expect(spotlightFor(null, 1440, 900)).toBeNull();
    expect(spotlightFor({ top: 0, left: 0, width: 0, height: 0 }, 1440, 900)).toBeNull();
    expect(spotlightFor({ top: 0, left: -300, width: 260, height: 800 }, 1440, 900)).toBeNull();
  });

  it("uses the preferred side when it fits and never overlaps the spotlight", () => {
    const spot = { top: 60, left: 20, width: 240, height: 700 }; // the sidebar
    const l = layoutCard(spot, card, 1440, 900, "right");
    expect(l).toMatchObject({ mode: "anchored", side: "right" });
    if (l.mode === "anchored") expect(l.left).toBeGreaterThanOrEqual(spot.left + spot.width);
  });

  it("falls back to another side, then to a bottom sheet", () => {
    const rightEdge = { top: 100, left: 1100, width: 320, height: 600 };
    expect(layoutCard(rightEdge, card, 1440, 900, "right")).toMatchObject({ side: "left" });

    const fills = { top: 10, left: 10, width: 1420, height: 880 };
    expect(layoutCard(fills, card, 1440, 900, "right")).toEqual({ mode: "sheet" });
  });

  it("docks as a sheet on phones and centres when there is no target", () => {
    expect(layoutCard({ top: 100, left: 10, width: 300, height: 200 }, card, 390, 844, "right")).toEqual({ mode: "sheet" });
    expect(layoutCard(null, card, 1440, 900, "right")).toEqual({ mode: "centre", top: 320, left: 530 });
  });
});
