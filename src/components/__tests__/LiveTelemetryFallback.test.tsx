// @vitest-environment jsdom
import React from "react";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Ensembl heads a two-tier coordinate-translation ladder. These tests pin the states the rail
 * must tell apart, because collapsing them into a single "Offline" pill is what made a covered
 * outage look identical to an uncovered one — and, separately, made a slow provider look dead.
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

import LiveTelemetryPanel from "../telemetry/LiveTelemetryPanel";
import { SettingsProvider } from "../../context/SettingsContext";

const svc = (over: Record<string, unknown> = {}) => ({
  healthy: true,
  latencyMs: 10,
  message: "ok",
  timestamp: "2026-01-01T00:00:00.000Z",
  ...over
});

const fallback = (over: Record<string, unknown> = {}) => ({
  id: "variant-validator",
  name: "VariantValidator",
  healthy: true,
  verdict: "ready",
  latencyMs: 1240,
  message: "Resolved MACO1 probe",
  timestamp: "2026-01-01T00:00:01.000Z",
  ageMs: 0,
  stale: false,
  ...over
});

function setDiagnostics(ensembl: Record<string, unknown>) {
  h.state.current = {
    status: "ok",
    timestamp: "2026-01-01T00:00:00.000Z",
    foldxReady: false,
    geminiReady: false,
    modelServerReady: false,
    serviceHealth: {
      ensembl,
      clinvar: svc(),
      myvariant: svc(),
      uniprot: svc(),
      europepmc: svc()
    }
  };
}

const renderPanel = () =>
  render(
    <SettingsProvider>
      <LiveTelemetryPanel />
    </SettingsProvider>
  );

/** Scoped to the Ensembl row: several services legitimately share a status label. */
function ensemblRow(): HTMLElement {
  const row = document.querySelector('[data-service-id="ensembl"]');
  if (!row) throw new Error("Ensembl row not rendered");
  return row as HTMLElement;
}

const ensemblRowWithin = () => within(ensemblRow());

describe("LiveTelemetryPanel — Ensembl fallback reporting", () => {
  beforeEach(() => {
    h.state.current = null;
    h.refresh.mockClear();
  });

  it("reports the primary as live when Ensembl is healthy", () => {
    setDiagnostics(svc({ latencyMs: 16 }));
    renderPanel();

    const row = ensemblRowWithin();
    expect(row.getByText("REST Live")).toBeInTheDocument();
    expect(row.getByText("VEP, coordinates & cDNA translation")).toBeInTheDocument();
    fireEvent.click(row.getByRole("button", { name: "Show details for Ensembl VEP" }));
    expect(screen.getByText("Response 16ms")).toBeInTheDocument();
    // Healthy rows are not actionable, so no re-check affordance is offered. Read off the element
    // itself, because the row is what would carry the button role.
    expect(ensemblRow().getAttribute("role")).toBeNull();
  });

  it("reports a covered outage as Fallback Ready rather than Offline", () => {
    setDiagnostics(svc({ healthy: false, latencyMs: 3802, fallback: fallback() }));
    renderPanel();

    const row = ensemblRowWithin();
    expect(row.getByText("Fallback Ready")).toBeInTheDocument();
    expect(row.queryByText("Offline")).not.toBeInTheDocument();
    expect(row.getByText("VariantValidator taking over")).toBeInTheDocument();
    // The latency on show is the tier actually answering, not the dead primary's timeout.
    fireEvent.click(row.getByRole("button", { name: "Show details for Ensembl VEP" }));
    expect(screen.getByText("Response 1240ms")).toBeInTheDocument();
    expect(screen.queryByText("Response 3802ms")).not.toBeInTheDocument();
  });

  it("reports an uncovered outage only when the fallback said it cannot serve", () => {
    setDiagnostics(
      svc({ healthy: false, fallback: fallback({ healthy: false, verdict: "unavailable" }) })
    );
    renderPanel();

    const row = ensemblRowWithin();
    expect(row.getByText("No Fallback")).toBeInTheDocument();
    expect(row.getByText(/No provider reachable/i)).toBeInTheDocument();
  });

  it("reports coverage as UNKNOWN, not an outage, when the probe could not tell", () => {
    // A timeout or transport error is not evidence that the provider cannot serve a real query;
    // announcing "no provider reachable" and advising a notation switch on that basis is wrong.
    setDiagnostics(
      svc({
        healthy: false,
        fallback: fallback({
          healthy: false,
          verdict: "unknown",
          message: "This operation was aborted"
        })
      })
    );
    renderPanel();

    const row = ensemblRowWithin();
    expect(row.getByText("Coverage Unknown")).toBeInTheDocument();
    expect(row.queryByText("No Fallback")).not.toBeInTheDocument();
    expect(row.queryByText(/No provider reachable/i)).not.toBeInTheDocument();
    expect(row.getByText(/may still work/i)).toBeInTheDocument();
  });

  it("still shows Offline when the server reported no fallback block", () => {
    // Backwards compatible: an older payload has no `fallback`, and that must not render as an
    // uncovered outage.
    setDiagnostics(svc({ healthy: false }));
    renderPanel();

    const row = ensemblRowWithin();
    expect(row.getByText("Offline")).toBeInTheDocument();
    expect(row.queryByText("No Fallback")).not.toBeInTheDocument();
    expect(row.queryByText("Coverage Unknown")).not.toBeInTheDocument();
  });

  it("does not turn a malformed fallback block into a definite outage claim", () => {
    // An empty or partial block means "unknown", not "both tiers are down" — reading `!undefined`
    // as false previously produced the exact opposite of the truth.
    setDiagnostics(svc({ healthy: false, fallback: {} as any }));
    renderPanel();

    const row = ensemblRowWithin();
    expect(row.queryByText("No Fallback")).not.toBeInTheDocument();
    expect(row.getByText("Offline")).toBeInTheDocument();
  });

  it("never renders a literal 'undefined' for a fallback with no name", () => {
    setDiagnostics(svc({ healthy: false, fallback: fallback({ name: undefined } as any) }));
    renderPanel();

    const row = ensemblRowWithin();
    expect(row.queryByText(/undefined/i)).not.toBeInTheDocument();
    expect(row.getByText(/the fallback provider taking over/i)).toBeInTheDocument();
  });

  it("ignores a non-boolean healthy flag instead of treating it as coverage", () => {
    setDiagnostics(svc({ healthy: false, fallback: fallback({ healthy: "yes" as any }) }));
    renderPanel();

    expect(ensemblRowWithin().queryByText("Fallback Ready")).not.toBeInTheDocument();
  });

  it("surfaces how old the coverage verdict is", () => {
    setDiagnostics(svc({ healthy: false, fallback: fallback({ ageMs: 45_000, stale: true }) }));
    renderPanel();

    const detail = ensemblRowWithin().getByText("VariantValidator taking over");
    expect(detail.getAttribute("title")).toMatch(/verified 45s ago/);
    expect(detail.getAttribute("title")).toMatch(/no longer current/);
  });

  it("names the degraded service in the header coverage tooltip", () => {
    setDiagnostics(svc({ healthy: false, fallback: fallback() }));
    renderPanel();

    const counter = screen.getByTitle(/services online/i);
    expect(counter.getAttribute("title")).toMatch(/VariantValidator taking over/i);
  });

  it("distinguishes a covered outage from an offline service in the header counter", () => {
    setDiagnostics(svc({ healthy: false, fallback: fallback() }));
    renderPanel();

    // The header previously read "4/5 Online" amber beside a row reading "Fallback Ready", so the
    // two contradicted each other.
    expect(screen.getByText(/on fallback/)).toBeInTheDocument();
  });

  it("re-checks the whole ladder from the drawer, and a click on the row alone does not", () => {
    setDiagnostics(svc({ healthy: false, fallback: fallback() }));
    renderPanel();

    // The header only opens the row. Re-running the ladder is a separate, named action.
    fireEvent.click(ensemblRow());
    expect(h.refresh).not.toHaveBeenCalled();
    expect(ensemblRowWithin().queryByRole("button", { name: /Re-check Ensembl VEP/i })).toBeNull();

    const drawer = document.querySelector('[data-service-detail="ensembl"]') as HTMLElement;
    const recheck = within(drawer).getByRole("button", { name: /Re-check Ensembl VEP and its fallback/i });
    expect(recheck.tagName).toBe("BUTTON");

    fireEvent.click(recheck);
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });

  it("offers no re-check action while the primary is healthy", () => {
    setDiagnostics(svc());
    renderPanel();

    expect(screen.queryByRole("button", { name: /Re-check Ensembl VEP/i })).not.toBeInTheDocument();
    expect(h.refresh).not.toHaveBeenCalled();
  });
});

describe("LiveTelemetryPanel — summary tone", () => {
  beforeEach(() => {
    h.state.current = null;
  });

  it("reads all-clear in the success tone when every service is online", () => {
    // The header used to send `onlineCount === totalCount` to AMBER, so the one fully healthy
    // state on the page wore the warning colour.
    sessionStorage.setItem("missenseTransientCredentials", JSON.stringify({ geminiApiKey: "k", alphagenomeApiKey: "a" }));
    h.state.current = {
      status: "ok",
      timestamp: "2026-01-01T00:00:00.000Z",
      foldxReady: true,
      geminiReady: false,
      modelServerReady: true,
      p2rankReady: true,
      serviceHealth: {
        ensembl: svc(), clinvar: svc(), myvariant: svc(), uniprot: svc(), europepmc: svc(), alphagenome: svc()
      }
    };
    renderPanel();

    const summary = screen.getByTitle(/services online/i);
    expect(summary.textContent).toMatch(/All 10 services online/);
    expect(summary.className).not.toMatch(/warning|danger/);
    sessionStorage.removeItem("missenseTransientCredentials");
  });

  it("renders a nominal status as quiet text, not a tinted chip", () => {
    setDiagnostics(svc());
    renderPanel();

    const pill = ensemblRowWithin().getByText("REST Live");
    expect(pill.className).not.toMatch(/bg-\[var\(--cs-bg-/);
  });

  it("gives every row exactly one visible cue, its disclosure chevron", () => {
    // Every row opens, so the chevron is the cue for all of them. A second glyph beside it (the
    // refresh icon, or an arrow for the action) read as two controls for one row.
    setDiagnostics(svc({ healthy: false, fallback: fallback() }));
    renderPanel();

    const rows = Array.from(document.querySelectorAll("[data-service-id]"));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const id = row.getAttribute("data-service-id");
      expect(row.querySelectorAll("svg"), `${id} renders more than one glyph`).toHaveLength(1);
      expect(row.querySelector("svg")!.closest("button"), `${id} cue is not the disclosure`).not.toBeNull();
    }
  });

  it("never renders an arrow beside the chevron on an action row", () => {
    setDiagnostics(svc({ healthy: false, fallback: fallback() }));
    renderPanel();

    expect(document.querySelector(".lucide-arrow-right")).toBeNull();
  });

  it("draws one chevron per row, not a matched pair", () => {
    // A collapsed `ChevronDown` rotated a quarter turn points right — the exact glyph
    // `ChevronRight` draws. A row that both opens and carries an action used to render both, so
    // the same chevron appeared twice, side by side, which reads as a rendering glitch rather
    // than as two separate affordances.
    setDiagnostics(svc());
    renderPanel();

    for (const row of Array.from(document.querySelectorAll("[data-service-id]"))) {
      const chevrons = row.querySelectorAll(".lucide-chevron-right, .lucide-chevron-down");
      expect(
        chevrons.length,
        `${row.getAttribute("data-service-id")} renders ${chevrons.length} chevrons`
      ).toBeLessThanOrEqual(1);
    }
  });
});

describe("LiveTelemetryPanel — Gemini session honesty", () => {
  const geminiRow = () => {
    const row = document.querySelector('[data-service-id="gemini"]');
    if (!row) throw new Error("Gemini row not rendered");
    return row as HTMLElement;
  };

  beforeEach(() => {
    h.state.current = null;
    sessionStorage.removeItem("missenseTransientCredentials");
  });

  it("names a live session and counts down, because 'Session Active' alone cannot age", () => {
    sessionStorage.setItem(
      "missenseTransientCredentials",
      JSON.stringify({
        geminiApiKey: "AIzaSyKeyTick",
        geminiSessionId: "live-session",
        geminiSessionExpiresAt: Date.now() + 6 * 60 * 1000
      })
    );
    setDiagnostics(svc());
    renderPanel();

    const status = within(geminiRow()).getByText(/^Session Active · \d+ min/);
    expect(status.textContent).toMatch(/Session Active · 6 min/);
  });

  it("shows a lapsed-while-idle session in the warning tone with an inline relink", async () => {
    sessionStorage.setItem(
      "missenseTransientCredentials",
      JSON.stringify({
        geminiApiKey: "AIzaSyKeyStale",
        geminiSessionId: "this-session-ago",
        geminiSessionExpiresAt: Date.now() - 1000
      })
    );
    // Everything else ready, so the row's own readiness is the only thing that moves the count.
    h.state.current = {
      status: "ok",
      timestamp: "2026-01-01T00:00:00.000Z",
      foldxReady: true,
      geminiReady: false,
      modelServerReady: true,
      p2rankReady: true,
      serviceHealth: {
        ensembl: svc(), clinvar: svc(), myvariant: svc(), uniprot: svc(), europepmc: svc(), alphagenome: svc()
      }
    };

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/v1/session/keys") {
        return Promise.resolve(
          new Response(JSON.stringify({ sessionId: "reinrelieved", expiresAt: Date.now() + 15 * 60 * 1000 }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          })
        );
      }
      return Promise.resolve(new Response("{}", { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    renderPanel();

    const row = geminiRow();
    const pill = within(row).getByText("Session Lapsed — Relink");
    // The warning tint, not the nominal quiet text: a lapsed session needs the reader's eye.
    expect(pill.className).toMatch(/cs-bg-warning/);
    // Ready count reflects it: the summary no longer claims a service that lapses is online.
    expect(screen.getByTitle(/services online/i).textContent).toMatch(/9\/10/);

    // The header opens the row; the relink itself is a named button in the drawer.
    expect(within(row).queryByRole('button', { name: 'Relink the stored Gemini key now' })).toBeNull();
    fireEvent.click(within(row).getByRole('button', { name: /Show details for Gemini Clinical AI/ }));
    const drawer = document.querySelector('[data-service-detail="gemini"]') as HTMLElement;
    expect(within(drawer).getByRole('button', { name: 'Relink the stored Gemini key now' }).tagName).toBe('BUTTON');

    // One click re-runs the same handshake Settings does.
    fireEvent.click(within(drawer).getByRole('button', { name: 'Relink the stored Gemini key now' }));
    await screen.findByText(/^Session Active ·/);

    const linkCall = fetchMock.mock.calls.find((call: any[]) => call[0] === "/api/v1/session/keys");
    expect(linkCall).toBeDefined();
    expect(JSON.parse(linkCall?.[1]?.body)).toEqual({ apiKey: "AIzaSyKeyStale" });
  });
});
