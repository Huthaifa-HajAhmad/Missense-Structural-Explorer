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
    expect(row.getByText("Transcript & consequence mapping")).toBeInTheDocument();
    expect(row.getByText("16ms")).toBeInTheDocument();
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
    expect(row.getByText("1240ms")).toBeInTheDocument();
    expect(row.queryByText("3802ms")).not.toBeInTheDocument();
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

  it("re-checks the whole ladder when the degraded row is clicked", () => {
    setDiagnostics(svc({ healthy: false, fallback: fallback() }));
    renderPanel();

    const recheck = screen.getByRole("button", { name: /Re-check Ensembl VEP and its fallback/i });
    expect(recheck).toBe(ensemblRow());

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

  it("gives every clickable row a visible action cue", () => {
    setDiagnostics(svc());
    renderPanel();

    for (const row of Array.from(document.querySelectorAll('[data-service-id][role="button"]'))) {
      expect(row.querySelector("svg"), `${row.getAttribute("data-service-id")} needs a visible cue`).not.toBeNull();
    }
  });
});
