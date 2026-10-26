// @vitest-environment jsdom
import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../../context/SettingsContext", () => ({
  useSettings: () => ({ settings: { defaultStructureModel: "alphafold" } }),
}));

import MasterSidebar, {
  MASTER_VIEW_ITEMS,
  isViewActive,
  clampSidebarWidth,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MIN,
  SIDEBAR_WIDTH_MAX,
} from "../MasterSidebar";

type Props = React.ComponentProps<typeof MasterSidebar>;

const setup = (overrides: Partial<Props> = {}): Props => ({
  activeView: "search",
  onViewChange: vi.fn(),
  sidebarWidth: 232,
  setSidebarWidth: vi.fn(),
  isCollapsed: false,
  onToggleCollapse: vi.fn(),
  activeEvidenceTab: "clinical",
  onEvidenceTabChange: vi.fn(),
  ...overrides,
});

afterEach(() => cleanup());

describe("MasterSidebar — registry", () => {
  it("lists every routable view exactly once, About and Console included", () => {
    const ids = MASTER_VIEW_ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(["search", "evidence", "structure", "console", "about"]));
  });

  it("merges both structure models into the 3D structure row", () => {
    expect(isViewActive("structure", "structure_esmfold")).toBe(true);
    expect(isViewActive("structure", "structure_alphafold")).toBe(true);
    expect(isViewActive("evidence", "structure_esmfold")).toBe(false);
  });

  it("clamps corrupt and out-of-range widths", () => {
    expect(clampSidebarWidth(NaN)).toBe(SIDEBAR_WIDTH_DEFAULT);
    expect(clampSidebarWidth(10)).toBe(SIDEBAR_WIDTH_MIN);
    expect(clampSidebarWidth(9999)).toBe(SIDEBAR_WIDTH_MAX);
  });
});

describe("MasterSidebar — expanded rail", () => {
  it("marks the active view as the current page", () => {
    render(<MasterSidebar {...setup({ activeView: "energetics" })} />);
    const row = screen.getByRole("button", { name: /energetics/i });
    expect(row).toHaveAttribute("aria-current", "page");
  });

  it("routes the structure row to the default model", () => {
    const onViewChange = vi.fn();
    render(<MasterSidebar {...setup({ onViewChange })} />);
    fireEvent.click(screen.getByRole("button", { name: /^3D structure/i }));
    expect(onViewChange).toHaveBeenCalledWith("structure_alphafold");
  });

  it("opens the Evidence group on its first page, not the last one visited", () => {
    const onViewChange = vi.fn();
    const onEvidenceTabChange = vi.fn();
    render(<MasterSidebar {...setup({ activeView: "search", activeEvidenceTab: "splicing", onViewChange, onEvidenceTabChange })} />);
    fireEvent.click(screen.getByRole("button", { name: /^Evidence/ }));
    expect(onEvidenceTabChange).toHaveBeenCalledWith("clinical");
    expect(onViewChange).toHaveBeenCalledWith("evidence");
  });

  it("leaves the reader's current Evidence page alone when the group is already open", () => {
    const onViewChange = vi.fn();
    const onEvidenceTabChange = vi.fn();
    render(<MasterSidebar {...setup({ activeView: "evidence", activeEvidenceTab: "splicing", onViewChange, onEvidenceTabChange })} />);
    fireEvent.click(screen.getByRole("button", { name: /^Evidence/ }));
    expect(onEvidenceTabChange).not.toHaveBeenCalled();
    expect(onViewChange).not.toHaveBeenCalled();
  });

  it("collapses through the toggle", () => {
    const onToggleCollapse = vi.fn();
    render(<MasterSidebar {...setup({ onToggleCollapse })} />);
    fireEvent.click(screen.getByRole("button", { name: /collapse sidebar/i }));
    expect(onToggleCollapse).toHaveBeenCalledTimes(1);
  });

  it("pins Console and About below the scrolling nav", () => {
    render(<MasterSidebar {...setup({ unreadConsoleCount: 3 })} />);
    const nav = screen.getByRole("navigation", { name: /primary navigation/i });
    expect(nav).not.toContainElement(screen.getByRole("button", { name: /about/i }));
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("withholds stage markers until something has run", () => {
    const { rerender } = render(<MasterSidebar {...setup()} />);
    expect(screen.queryByRole("img", { name: /not started/i })).not.toBeInTheDocument();
    rerender(<MasterSidebar {...setup({ isLoadingSearch: true })} />);
    expect(screen.getAllByRole("img").length).toBeGreaterThan(0);
  });

  it("exposes the resize separator's value", () => {
    render(<MasterSidebar {...setup({ sidebarWidth: 260 })} />);
    const sep = screen.getByRole("separator", { name: /resize sidebar/i });
    expect(sep).toHaveAttribute("aria-valuenow", "260");
    fireEvent.keyDown(sep, { key: "End" });
  });
});

describe("MasterSidebar — collapsed rail", () => {
  it("names icon-only rows and folds unread counts into the name", () => {
    render(<MasterSidebar {...setup({ isCollapsed: true, unreadConsoleCount: 4 })} />);
    expect(screen.getByRole("button", { name: /^Console, 4 unread/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /expand sidebar/i })).toBeInTheDocument();
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
  });
});

describe("MasterSidebar — drawer mode", () => {
  it("a closed drawer is out of the interaction tree; an open one is live", () => {
    const { rerender } = render(
      <MasterSidebar {...setup({ isDrawerMode: true, isDrawerOpen: false })} />
    );
    const rail = document.querySelector("aside.ms-root") as HTMLElement;
    expect(rail).toHaveAttribute("data-drawer", "closed");
    // inert is the actual gate for focus and the a11y tree; data-drawer is what the
    // e2e suite reads, so both are pinned here at the unit level.
    expect(rail).toHaveAttribute("inert");
    expect(rail).toHaveAttribute("aria-modal", "true");

    rerender(<MasterSidebar {...setup({ isDrawerMode: true, isDrawerOpen: true })} />);
    expect(rail).toHaveAttribute("data-drawer", "open");
    expect(rail).not.toHaveAttribute("inert");
    expect(rail).not.toHaveAttribute("aria-modal", "false");
  });

  it("closes the drawer from its own header instead of flipping the desktop preference", () => {
    const onCloseDrawer = vi.fn();
    const onToggleCollapse = vi.fn();
    render(
      <MasterSidebar
        {...setup({ isDrawerMode: true, isDrawerOpen: true, isCollapsed: true, onCloseDrawer, onToggleCollapse })}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /close navigation/i }));
    expect(onCloseDrawer).toHaveBeenCalled();
    expect(onToggleCollapse).not.toHaveBeenCalled();
  });

  it("dismisses after a pick and on Escape, but ignores Escape while closed", () => {
    const onCloseDrawer = vi.fn();
    const { rerender } = render(
      <MasterSidebar {...setup({ isDrawerMode: true, isDrawerOpen: false, onCloseDrawer })} />
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCloseDrawer).not.toHaveBeenCalled();

    rerender(<MasterSidebar {...setup({ isDrawerMode: true, isDrawerOpen: true, onCloseDrawer })} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCloseDrawer).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /landscape/i }));
    expect(onCloseDrawer).toHaveBeenCalledTimes(2);
  });
});
