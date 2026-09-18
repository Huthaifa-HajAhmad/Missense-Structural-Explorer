// @vitest-environment jsdom
import React from "react";
import { render, screen, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Ensembl is the head of a two-tier coordinate-translation ladder. These tests pin the three
 * states the rail must be able to tell apart, because collapsing them into a single "Offline"
 * pill is what made a covered outage look identical to an uncovered one.
 */

const h = vi.hoisted(() => ({ state: { current: null as any } }));

vi.mock("../../hooks/useDiagnostics", () => ({
  useDiagnostics: () => ({
    diagnostics: h.state.current,
    capabilities: null,
    version: null,
    loading: false,
    error: null,
    refresh: vi.fn()
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

/** Scopes queries to the Ensembl row: several services legitimately share a status label. */
function ensemblRow(): HTMLElement {
  const row = document.querySelector('[data-service-id="ensembl"]');
  if (!row) throw new Error("Ensembl row not rendered");
  return row as HTMLElement;
}

describe("LiveTelemetryPanel — Ensembl fallback reporting", () => {
  beforeEach(() => {
    h.state.current = null;
  });

  it("reports the primary as live when Ensembl is healthy", () => {
    setDiagnostics(svc({ latencyMs: 16 }));
    renderPanel();

    const row = within(ensemblRow());
    expect(row.getByText("REST Live")).toBeInTheDocument();
    expect(row.getByText("Transcript & consequence mapping")).toBeInTheDocument();
    expect(row.getByText("16ms")).toBeInTheDocument();
    // Healthy rows are not actionable, so no re-check affordance is offered. The row itself
    // would carry the button role, so it is read off the element rather than queried within it.
    expect(ensemblRow().getAttribute("role")).toBeNull();
  });

  it("reports a covered outage as Fallback Ready rather than Offline", () => {
    setDiagnostics(
      svc({
        healthy: false,
        latencyMs: 3802,
        message: "This operation was aborted",
        fallback: {
          id: "variant-validator",
          name: "VariantValidator",
          healthy: true,
          latencyMs: 1240,
          message: "Resolved MACO1 probe",
          timestamp: "2026-01-01T00:00:01.000Z"
        }
      })
    );
    renderPanel();

    const row = within(ensemblRow());
    expect(row.getByText("Fallback Ready")).toBeInTheDocument();
    expect(row.queryByText("Offline")).not.toBeInTheDocument();
    expect(row.getByText("VariantValidator taking over")).toBeInTheDocument();
    // The latency on show is the tier actually answering, not the dead primary's timeout.
    expect(row.getByText("1240ms")).toBeInTheDocument();
    expect(row.queryByText("3802ms")).not.toBeInTheDocument();
    // A degraded row is re-checkable, which re-runs the whole ladder including this probe.
    const recheck = screen.getByRole("button", { name: /Re-check Ensembl VEP and its fallback/i });
    expect(recheck).toBe(ensemblRow());
  });

  it("reports an uncovered outage when both tiers are unreachable", () => {
    setDiagnostics(
      svc({
        healthy: false,
        message: "timeout",
        fallback: {
          id: "variant-validator",
          name: "VariantValidator",
          healthy: false,
          latencyMs: 6000,
          message: "VariantValidator unreachable",
          timestamp: "2026-01-01T00:00:01.000Z"
        }
      })
    );
    renderPanel();

    const row = within(ensemblRow());
    expect(row.getByText("No Fallback")).toBeInTheDocument();
    expect(row.getByText(/No provider reachable/i)).toBeInTheDocument();
  });

  it("still shows Offline when the server reported no fallback block", () => {
    // Backwards compatible: an older diagnostics payload has no `fallback`, and that must not
    // be rendered as an uncovered outage.
    setDiagnostics(svc({ healthy: false, message: "timeout" }));
    renderPanel();

    const row = within(ensemblRow());
    expect(row.getByText("Offline")).toBeInTheDocument();
    expect(row.queryByText("No Fallback")).not.toBeInTheDocument();
  });

  it("names the degraded service in the header coverage tooltip", () => {
    setDiagnostics(
      svc({
        healthy: false,
        fallback: {
          id: "variant-validator",
          name: "VariantValidator",
          healthy: true,
          latencyMs: 1240,
          message: "Resolved MACO1 probe",
          timestamp: "2026-01-01T00:00:01.000Z"
        }
      })
    );
    renderPanel();

    const counter = screen.getByTitle(/services online/i);
    expect(counter.getAttribute("title")).toMatch(/VariantValidator taking over/i);
  });
});
