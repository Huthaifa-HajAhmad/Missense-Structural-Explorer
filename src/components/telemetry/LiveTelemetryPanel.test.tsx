// @vitest-environment jsdom
import React from "react";
import { render, within, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * How a rail row opens and where its action lives. A row opens from its header, its one chevron is
 * the keyboard control for the same toggle, and any action sits in the drawer under its own name.
 * The rows that can run an action are the ones that can be configured from Settings; a server-side
 * program is not one of them.
 */

const h = vi.hoisted(() => ({ state: { current: null as any }, refresh: vi.fn() }));

vi.mock("../../hooks/useDiagnostics", () => ({
  useDiagnostics: () => ({
    diagnostics: h.state.current,
    capabilities: null,
    version: null,
    loading: false,
    error: null,
    refresh: h.refresh
  })
}));

import LiveTelemetryPanel from "./LiveTelemetryPanel";
import { SettingsProvider } from "../../context/SettingsContext";

const TS = "2026-01-01T00:00:00.000Z";

const svc = (over: Record<string, unknown> = {}) => ({
  healthy: true,
  latencyMs: 10,
  message: "ok",
  timestamp: TS,
  ...over
});

/** Every service ready, so a test changes only the thing it is about. */
const allReady = (over: Record<string, unknown> = {}, serviceOver: Record<string, unknown> = {}) => ({
  status: "ok",
  timestamp: TS,
  foldxReady: true,
  geminiReady: false,
  modelServerReady: true,
  p2rankReady: true,
  serviceHealth: {
    ensembl: svc(),
    alphagenome: svc(),
    clinvar: svc(),
    myvariant: svc(),
    uniprot: svc(),
    europepmc: svc(),
    ...serviceOver
  },
  ...over
});

const rowOf = (id: string): HTMLElement => {
  const row = document.querySelector(`[data-service-id="${id}"]`);
  if (!row) throw new Error(`${id} row not rendered`);
  return row as HTMLElement;
};

const drawerOf = (id: string): HTMLElement | null =>
  document.querySelector(`[data-service-detail="${id}"]`) as HTMLElement | null;

const chevronOf = (id: string) => within(rowOf(id)).getByRole("button", { name: new RegExp(`details for`) });

function renderPanel(onConfigureClick?: (tab: "connections" | "api") => void) {
  return render(
    <SettingsProvider>
      <LiveTelemetryPanel onConfigureClick={onConfigureClick} />
    </SettingsProvider>
  );
}

describe("LiveTelemetryPanel — opening a row", () => {
  beforeEach(() => {
    h.state.current = null;
    h.refresh.mockClear();
    sessionStorage.removeItem("missenseTransientCredentials");
  });

  it("opens an expandable row when its header is clicked, and closes it on a second click", () => {
    h.state.current = allReady();
    const configure = vi.fn();
    renderPanel(configure);

    fireEvent.click(rowOf("alphagenome"));
    expect(drawerOf("alphagenome")).not.toBeNull();
    expect(chevronOf("alphagenome")).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(rowOf("alphagenome"));
    expect(drawerOf("alphagenome")).toBeNull();
    expect(chevronOf("alphagenome")).toHaveAttribute("aria-expanded", "false");
    // Opening a row is not configuring it: the header click ran no action.
    expect(configure).not.toHaveBeenCalled();
  });

  it("opens once when the chevron is clicked, because the chevron does not also fire the row", () => {
    h.state.current = allReady();
    renderPanel();

    // If the chevron's click bubbled to the header, the two toggles would cancel and the row would
    // stay closed. It must end open.
    fireEvent.click(chevronOf("alphagenome"));
    expect(drawerOf("alphagenome")).not.toBeNull();
  });
});

describe("LiveTelemetryPanel — where an action lives", () => {
  beforeEach(() => {
    h.state.current = null;
    h.refresh.mockClear();
    sessionStorage.removeItem("missenseTransientCredentials");
  });

  it("puts an expandable row's action in its drawer as a named button, not on the header", () => {
    h.state.current = allReady();
    const configure = vi.fn();
    renderPanel(configure);

    // Only the chevron sits on the header. The action is not reachable without opening the drawer.
    expect(within(rowOf("alphagenome")).getAllByRole("button")).toHaveLength(1);

    fireEvent.click(rowOf("alphagenome"));
    const action = within(drawerOf("alphagenome")!).getByRole("button", { name: "Configure connection" });
    expect(action.tagName).toBe("BUTTON");
    fireEvent.click(action);
    expect(configure).toHaveBeenCalledWith("connections");
  });

  it("does not run the action when only the row is clicked", () => {
    h.state.current = allReady({}, { ensembl: svc({ healthy: false, latencyMs: 3000, fallback: undefined }) });
    renderPanel();

    fireEvent.click(rowOf("ensembl"));
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it("gives a row with no action no role, and only its disclosure chevron as a button", () => {
    h.state.current = allReady();
    renderPanel();

    // ClinVar opens for its explanation but has nothing to do, so it must not look like a control.
    expect(within(rowOf("clinvar")).getAllByRole("button")).toHaveLength(1);
    expect(rowOf("clinvar").getAttribute("role")).toBeNull();
  });
});

describe("LiveTelemetryPanel — FoldX and P2Rank are not configurable", () => {
  beforeEach(() => {
    h.state.current = null;
    sessionStorage.removeItem("missenseTransientCredentials");
  });

  it.each(["foldx", "p2rank"])("%s carries no configure action in its row or drawer", id => {
    h.state.current = allReady({ foldxReady: false, p2rankReady: false, p2rankStatus: "unavailable" });
    const configure = vi.fn();
    renderPanel(configure);

    fireEvent.click(rowOf(id));
    expect(drawerOf(id)).not.toBeNull();
    // The chevron is the only button: there is no action to press, so none is offered.
    expect(within(rowOf(id)).getAllByRole("button")).toHaveLength(1);
    expect(within(drawerOf(id)!).queryByRole("button")).toBeNull();
    expect(configure).not.toHaveBeenCalled();
  });

  it("names an installed FoldX that cannot run yet as incomplete, and says what is missing", () => {
    h.state.current = allReady({
      foldxReady: false,
      foldxDetail: { binaryFound: true, rotabasePresent: false, box64Required: false, box64Present: false }
    });
    renderPanel();

    const row = within(rowOf("foldx"));
    expect(row.getByText("Incomplete")).toBeInTheDocument();
    expect(row.queryByText("Local Standby")).toBeNull();
    fireEvent.click(rowOf("foldx"));
    expect(within(drawerOf("foldx")!).getByText("Installed, but cannot run yet")).toBeInTheDocument();
    expect(within(drawerOf("foldx")!).getByText(/rotabase\.txt/)).toBeInTheDocument();
  });

  it("says FoldX is not installed when no program was found at all", () => {
    h.state.current = allReady({
      foldxReady: false,
      foldxDetail: { binaryFound: false, rotabasePresent: false, box64Required: false, box64Present: false }
    });
    renderPanel();

    expect(within(rowOf("foldx")).getByText("Local Standby")).toBeInTheDocument();
    fireEvent.click(rowOf("foldx"));
    expect(within(drawerOf("foldx")!).getByText("Not installed in this setup")).toBeInTheDocument();
  });

  it("names a missing Box64 emulator when an x86 FoldX runs on an ARM server", () => {
    h.state.current = allReady({
      foldxReady: false,
      foldxDetail: { binaryFound: true, rotabasePresent: true, box64Required: true, box64Present: false }
    });
    renderPanel();

    fireEvent.click(rowOf("foldx"));
    expect(within(drawerOf("foldx")!).getByText(/needs Box64/)).toBeInTheDocument();
  });
});

describe("LiveTelemetryPanel — AlphaGenome and the key source", () => {
  const agDown = { healthy: false, message: "Standby (API Key Required)", keySource: "none" };

  beforeEach(() => {
    h.state.current = null;
    sessionStorage.removeItem("missenseTransientCredentials");
  });

  it("counts a key entered in this browser as ready when the server has no key", () => {
    sessionStorage.setItem("missenseTransientCredentials", JSON.stringify({ alphagenomeApiKey: "AG-browser-key" }));
    h.state.current = allReady({}, { alphagenome: svc(agDown) });
    renderPanel();

    const row = within(rowOf("alphagenome"));
    expect(row.getByText("Key Ready")).toBeInTheDocument();
    expect(row.queryByText("Standby")).toBeNull();

    fireEvent.click(rowOf("alphagenome"));
    expect(within(drawerOf("alphagenome")!).getByText("Working normally")).toBeInTheDocument();
    expect(within(drawerOf("alphagenome")!).getByText("API key configured (this browser)")).toBeInTheDocument();
  });

  it("stays on Standby with no key anywhere, and says why", () => {
    h.state.current = allReady({}, { alphagenome: svc(agDown) });
    renderPanel();

    expect(within(rowOf("alphagenome")).getByText("Standby")).toBeInTheDocument();
    fireEvent.click(rowOf("alphagenome"));
    expect(within(drawerOf("alphagenome")!).getByText("No API key connected")).toBeInTheDocument();
    expect(within(drawerOf("alphagenome")!).queryByText("API key configured (this browser)")).toBeNull();
  });

  it("reports the server's own key as Bridge Active, without a browser-key line", () => {
    sessionStorage.setItem("missenseTransientCredentials", JSON.stringify({ alphagenomeApiKey: "AG-browser-key" }));
    h.state.current = allReady({}, { alphagenome: svc({ healthy: true, keySource: "server" }) });
    renderPanel();

    expect(within(rowOf("alphagenome")).getByText("Bridge Active")).toBeInTheDocument();
    fireEvent.click(rowOf("alphagenome"));
    expect(within(drawerOf("alphagenome")!).queryByText("API key configured (this browser)")).toBeNull();
  });
});

describe("LiveTelemetryPanel — service descriptions", () => {
  beforeEach(() => {
    h.state.current = null;
  });

  it("describes UniProt and Europe PMC by what the app asks them for", () => {
    h.state.current = allReady();
    renderPanel();

    expect(within(rowOf("uniprot")).getByText("Sequences & functional domains")).toBeInTheDocument();
    expect(within(rowOf("europepmc")).getByText("Literature search & citations")).toBeInTheDocument();
  });
});
