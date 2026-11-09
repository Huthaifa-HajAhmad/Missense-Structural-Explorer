// @vitest-environment jsdom
import React from "react";
import { render, within, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

/** Every number and word in the rail must say how far it can be trusted. */
const h = vi.hoisted(() => ({
  reading: {} as Record<string, unknown>,
  lapse: null as null | { at: number; url: string },
  serverGemini: false,
}));

vi.mock("../../hooks/useDiagnostics", () => ({
  useDiagnostics: () => ({ capabilities: null, loading: false, error: null, refresh: vi.fn(), checkedAt: Date.now(), lastCheckFailed: false, coveragePending: false, ...h.reading }),
}));
vi.mock("../../api/authSession", async original => ({
  ...(await original<any>()),
  getAuthLapse: () => h.lapse,
  subscribeAuthLapse: () => () => {},
}));

import LiveTelemetryPanel, { type ServiceSummary } from "./LiveTelemetryPanel";
import { SettingsProvider } from "../../context/SettingsContext";

const svc = (over = {}) => ({ healthy: true, latencyMs: 1, message: "ok", timestamp: "t", ...over });
const diagnostics = (serviceOver = {}, over = {}) => ({
  status: "ok", timestamp: "2026-01-01T00:00:00.000Z", foldxReady: true, geminiReady: true, modelServerReady: true, p2rankReady: true,
  serviceHealth: { ensembl: svc(), alphagenome: svc(), clinvar: svc(), myvariant: svc(), uniprot: svc(), europepmc: svc(), sidecar: svc(), ...serviceOver },
  ...over,
});

function mount() {
  let summary: ServiceSummary | undefined;
  render(<SettingsProvider><LiveTelemetryPanel onSummary={value => { summary = value; }} /></SettingsProvider>);
  return () => summary!;
}
const row = (id: string) => within(document.querySelector(`[data-service-id="${id}"]`) as HTMLElement);

beforeEach(() => {
  h.reading = { diagnostics: diagnostics() };
  h.lapse = null;
  sessionStorage.removeItem("missenseTransientCredentials");
});

describe("rows and the header agree", () => {
  it("does not count a row as online while it says Degraded", () => {
    h.lapse = { at: 1, url: "/x" };
    const summary = mount();
    expect(row("gemini").getByText("Degraded")).toBeInTheDocument();
    expect(summary().online).toBe(summary().total - 1);
  });

  it("raises the danger tone when a row says Unreachable", () => {
    h.reading = { diagnostics: diagnostics({ clinvar: svc({ healthy: false }) }) };
    const summary = mount();
    expect(row("clinvar").getByText("Unreachable")).toBeInTheDocument();
    expect(summary().tone).toBe("danger");
  });

  it("shows Checking, not Unreachable, while the fallback verdict is still on its way", () => {
    h.reading = { diagnostics: diagnostics({ ensembl: svc({ healthy: false }) }), coveragePending: true };
    const summary = mount();
    expect(row("ensembl").getByText("Checking")).toBeInTheDocument();
    expect(summary().tone).toBe("warn");
  });
});

describe("Connected means something answered", () => {
  it("says Configured for a key typed in this browser that nothing has checked", () => {
    sessionStorage.setItem("missenseTransientCredentials", JSON.stringify({ alphagenomeApiKey: "AG" }));
    h.reading = { diagnostics: diagnostics({ alphagenome: svc({ healthy: false, keySource: "none" }) }) };
    mount();
    expect(row("alphagenome").getByText("Configured")).toBeInTheDocument();
    expect(row("alphagenome").queryByText("Connected")).toBeNull();
  });

  it("says Configured for a typed endpoint", () => {
    sessionStorage.setItem("missenseTransientCredentials", JSON.stringify({ alphagenomeApiUrl: "https://x.test" }));
    h.reading = { diagnostics: diagnostics({ alphagenome: svc({ healthy: false, keySource: "none" }) }) };
    mount();
    expect(row("alphagenome").getByText("Configured")).toBeInTheDocument();
  });

  it("still counts a Configured row as available, so a working setup does not look broken", () => {
    sessionStorage.setItem("missenseTransientCredentials", JSON.stringify({ alphagenomeApiKey: "AG" }));
    h.reading = { diagnostics: diagnostics({ alphagenome: svc({ healthy: false, keySource: "none" }) }) };
    const summary = mount();
    expect(summary().online).toBe(summary().total);
  });
});

describe("an out-of-date reading says so", () => {
  it("marks probe-based rows Out of date after a failed re-check", () => {
    h.reading = { diagnostics: diagnostics(), lastCheckFailed: true, error: "Diagnostics unavailable (HTTP 502)." };
    mount();
    expect(row("clinvar").getByText("Out of date")).toBeInTheDocument();
    expect(row("clinvar").queryByText("Connected")).toBeNull();
  });

  it("does not count an out-of-date row as online, and warns in the header", () => {
    h.reading = { diagnostics: diagnostics(), lastCheckFailed: true };
    const summary = mount();
    expect(summary().online).toBeLessThan(summary().total);
    expect(summary().tone).toBe("warn");
    expect(screen.getByTitle(/could not re-check/i)).toBeInTheDocument();
  });

  it("treats a reading far older than the poll as out of date even without a failure", () => {
    h.reading = { diagnostics: diagnostics(), checkedAt: Date.now() - 10 * 60_000 };
    mount();
    expect(row("uniprot").getByText("Out of date")).toBeInTheDocument();
  });
});

describe("a check that never answered", () => {
  it("says it could not check, instead of calling every service down", () => {
    h.reading = { diagnostics: null, loading: false, checkedAt: null, lastCheckFailed: true, error: "Diagnostics unavailable." };
    const summary = mount();
    expect(screen.getByTitle(/could not re-check/i)).toBeInTheDocument();
    expect(row("clinvar").getByText("Out of date")).toBeInTheDocument();
    expect(row("clinvar").queryByText("Unreachable")).toBeNull();
    expect(summary()).toMatchObject({ online: 0, tone: "warn", stale: true });
  });
});
