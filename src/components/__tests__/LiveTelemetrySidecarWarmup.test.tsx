// @vitest-environment jsdom
import React from "react";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The ML sidecar answers `/health` with `status: "healthy"` from the moment uvicorn binds — up to
 * ~180 s before the weights it was spawned to load become usable — and reports that window only in
 * `state: "warming_up"`. These tests pin the three states the rail must tell apart, because the old
 * derivation folded the cold start into `modelServerReady` and drew a green "Neural Sidecar Live"
 * dot over engines that would refuse the next request.
 *
 * A fourth property is pinned as hard as the three states: warming is NOT the warning pulse. The
 * panel reserves `animate-pulse` for a state the operator must act on (a missing key); a cold start
 * resolves itself, so a pulsing dot there would compete with the one pulse that means something.
 */

const h = vi.hoisted(() => ({
  diag: { current: null as any },
  caps: { current: null as any }
}));

vi.mock("../../hooks/useDiagnostics", () => ({
  useDiagnostics: () => ({
    diagnostics: h.diag.current,
    capabilities: h.caps.current,
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

/** Every service ready except the ones the case is about, so the count is the only variable. */
const allReadyExcept = (over: Record<string, unknown>) => ({
  status: "ok",
  timestamp: "2026-01-01T00:00:00.000Z",
  foldxReady: true,
  geminiReady: false,
  modelServerReady: false,
  p2rankReady: true,
  serviceHealth: {
    ensembl: svc(),
    alphagenome: svc(),
    clinvar: svc(),
    myvariant: svc(),
    uniprot: svc(),
    europepmc: svc()
  },
  ...over
});

const renderPanel = () =>
  render(
    <SettingsProvider>
      <LiveTelemetryPanel />
    </SettingsProvider>
  );

const sidecarRow = (): HTMLElement => {
  const row = document.querySelector('[data-service-id="sidecar"]');
  if (!row) throw new Error("Sidecar row not rendered");
  return row as HTMLElement;
};

/** The leading status dot — the sidecar row carries no action icon, so this is unambiguous. */
const sidecarDot = (): HTMLElement => {
  const dot = sidecarRow().querySelector("span.rounded-full");
  if (!dot) throw new Error("Sidecar status dot not rendered");
  return dot as HTMLElement;
};


describe("LiveTelemetryPanel — ML sidecar cold start", () => {
  beforeEach(() => {
    h.diag.current = null;
    h.caps.current = null;
    sessionStorage.removeItem("missenseTransientCredentials");
  });

  it("names a warming sidecar and counts it out of the online total", () => {
    // Reported by /diagnostics: `modelServerState` is the field the route derives from `state`.
    h.diag.current = allReadyExcept({ modelServerState: "warming_up" });
    renderPanel();

    const row = within(sidecarRow());
    expect(row.getByText("Starting up")).toBeInTheDocument();
    expect(row.queryByText("Predictions ready")).not.toBeInTheDocument();

    // 6 healthy services + FoldX + P2Rank = 8 of 10; the warming sidecar is deliberately not counted.
    expect(screen.getByTitle(/services online/i).textContent).toMatch(/8\/10/);
    // The header's stated reason must use the same plain words as the row. "Warming up" is the
    // jargon this whole panel exists to avoid, and a tooltip is not exempt from that.
    expect(screen.getByTitle(/services online/i).getAttribute("title")).toMatch(/starting up/i);
    expect(screen.getByTitle(/services online/i).getAttribute("title")).not.toMatch(/warming/i);
  });

  it("detects warming from the adapter probe's own state, not only the route's summary", () => {
    // The SidecarAdapter exposes `state` directly, so a payload that carries it must be honoured
    // even when a coarser summary field disagrees.
    h.diag.current = allReadyExcept({
      modelServerReady: true,
      serviceHealth: {
        ensembl: svc(),
        alphagenome: svc(),
        clinvar: svc(),
        myvariant: svc(),
        uniprot: svc(),
        europepmc: svc(),
        sidecar: svc({ state: "warming_up", healthy: false, message: "Loading model weights" })
      }
    });
    renderPanel();

    expect(within(sidecarRow()).getByText("Starting up")).toBeInTheDocument();
    expect(screen.getByTitle(/services online/i).textContent).toMatch(/8\/10/);
  });

  it("detects warming from the capabilities engines as a third, independent witness", () => {
    // Capabilities probes the sidecar separately from /diagnostics; either one can be the only
    // witness, so both must be able to say "warming".
    h.diag.current = allReadyExcept({ modelServerReady: true });
    h.caps.current = {
      status: "ok",
      timestamp: "2026-01-01T00:00:00.000Z",
      engines: [
        { id: "thermompnn", name: "ThermoMPNN", category: "biophysical", status: "warming_up", details: {} }
      ]
    };
    renderPanel();

    expect(within(sidecarRow()).getByText("Starting up")).toBeInTheDocument();
    expect(screen.getByTitle(/services online/i).textContent).toMatch(/8\/10/);
  });

  it("shows warming as a steady amber, never the action-required pulse", () => {
    h.diag.current = allReadyExcept({ modelServerState: "warming_up" });
    renderPanel();

    const dot = sidecarDot();
    // The warning hue — the reader's eye belongs here.
    expect(dot.className).toMatch(/cs-text-warning/);
    // But NOT the pulse: a cold start needs no operator action, and the pulse is reserved for one.
    expect(dot.className).not.toMatch(/animate-pulse/);
    // And not green: readiness is precisely the claim that would be false.
    expect(dot.className).not.toMatch(/cs-text-success/);

    // The pill is tinted rather than quiet text, so the state is visible without being loud.
    const pill = within(sidecarRow()).getByText("Starting up");
    expect(pill.className).toMatch(/cs-bg-warning/);
  });

  it("still reports a ready sidecar as live and counts it online", () => {
    h.diag.current = allReadyExcept({
      modelServerReady: true,
      modelServerState: "ready"
    });
    renderPanel();

    const row = within(sidecarRow());
    expect(row.getByText("Predictions ready")).toBeInTheDocument();
    expect(row.queryByText("Starting up")).not.toBeInTheDocument();
    expect(row.getByText("ThermoMPNN, SaProt & StabilityOracle")).toBeInTheDocument();
    expect(sidecarDot().className).toMatch(/cs-text-success/);
    expect(sidecarDot().className).not.toMatch(/animate-pulse/);
    // The sidecar is counted once it can serve. 9 of 10 rather than 10 because Gemini carries no
    // key in this fixture — that one absent service is what makes the comparison to the warming
    // case exact: warming reads 8/10, ready reads 9/10, and the difference is this row alone.
    expect(screen.getByTitle(/services online/i).textContent).toMatch(/9\/10/);
    // All-clear is reserved for a fully healthy set, so a genuine gap must not read as "All 10 online".
    expect(screen.getByTitle(/services online/i).textContent).not.toMatch(/All \d+ services online/);
  });

  it("an unreachable sidecar with no sovereign fallback is standby, not warming", () => {
    // Absence of signal must not read as "warming": an offline sidecar needs a different reaction
    // from a booting one, and `state` is absent here rather than set.
    h.diag.current = allReadyExcept({});
    renderPanel();

    const row = within(sidecarRow());
    expect(row.getByText("Standby / Cloud")).toBeInTheDocument();
    expect(row.queryByText("Starting up")).not.toBeInTheDocument();
    // Neutral, not amber: this is not a cold start and must not borrow its tone.
    expect(sidecarDot().className).not.toMatch(/cs-text-warning/);
    expect(screen.getByTitle(/services online/i).textContent).toMatch(/8\/10/);
  });

  // ── Disclosure ────────────────────────────────────────────────────────────
  //
  // A collapsed row has room for three words beside a dot, which cannot tell a non-specialist what
  // "Starting up" means or whether they must act. These tests pin that clicking opens an
  // explanation answering those questions without using the vocabulary being explained.

  const detailPanel = (): HTMLElement | null =>
    document.querySelector('[data-service-detail="sidecar"]');

  it("starts collapsed — the rail stays scannable", () => {
    h.diag.current = allReadyExcept({ modelServerState: "warming_up" });
    renderPanel();

    expect(detailPanel()).toBeNull();
    expect(sidecarRow().getAttribute("data-expanded")).toBe("false");
  });

  it("opens on click and explains the state in plain language", () => {
    h.diag.current = allReadyExcept({ modelServerState: "warming_up" });
    renderPanel();

    fireEvent.click(sidecarRow());

    const detail = detailPanel() as HTMLElement;
    expect(detail).not.toBeNull();
    expect(sidecarRow().getAttribute("data-expanded")).toBe("true");
    // The three questions a non-specialist has, in order: is it broken, what is happening, what do I do.
    expect(within(detail).getByText("Not broken — just starting up")).toBeInTheDocument();
    expect(within(detail).getByText(/loading into memory/)).toBeInTheDocument();
    expect(within(detail).getByText(/can keep reading evidence and results now/)).toBeInTheDocument();
  });

  it("never explains the state using the vocabulary it is explaining", () => {
    // The whole point: a reader who does not know what a sidecar is learns nothing from being told
    // one is "warming up". The terms being explained must not appear in the explanation.
    h.diag.current = allReadyExcept({ modelServerState: "warming_up" });
    renderPanel();
    fireEvent.click(sidecarRow());

    const detailText = (detailPanel() as HTMLElement).textContent ?? "";
    for (const term of [/cold start/i, /warm/i, /ThermoMPNN/i, /StabilityOracle/i]) {
      expect(term.test(detailText), `explanation must not use the term ${term}`).toBe(false);
    }
  });

  it("names the row in words a non-specialist already knows", () => {
    // The collapsed row is the first thing read, and the only thing read by most. "Sidecar" is
    // internal vocabulary — it appears in logs and config, never in a clinician's working language.
    h.diag.current = allReadyExcept({ modelServerState: "warming_up" });
    renderPanel();

    const rowText = sidecarRow().textContent ?? "";
    expect(rowText).not.toMatch(/sidecar/i);
    expect(rowText).toMatch(/AI prediction models/);
  });

  it("keeps the technical name available for the reader who wants it", () => {
    // Plain language must not become a wall: the reader who meets "sidecar" in a log line or a bug
    // report needs somewhere in the UI to learn that this row is what it means.
    h.diag.current = allReadyExcept({ modelServerState: "warming_up" });
    renderPanel();
    fireEvent.click(sidecarRow());

    const detail = within(detailPanel() as HTMLElement);
    expect(detail.getByText("Technical name")).toBeInTheDocument();
    expect(detail.getByText("Python ML sidecar")).toBeInTheDocument();
  });

  it("does not invent a progress figure the server never reported", () => {
    // The sidecar reports only `warming_up` — not how far in, not how long remains. A fabricated
    // countdown or a guessed percentage is the fake-progress-bar defect recorded in
    // doc/UNMAPPING_DEFECT_SPLICE_AUDIT.md, so no digits claiming progress may appear.
    h.diag.current = allReadyExcept({ modelServerState: "warming_up" });
    renderPanel();
    fireEvent.click(sidecarRow());

    const text = (detailPanel() as HTMLElement).textContent ?? "";
    expect(text).not.toMatch(/\d+\s*%/);
    expect(text).not.toMatch(/\b\d+\s*(s|sec|seconds|min|minutes)\s*(left|remaining)\b/i);
    expect(text).not.toMatch(/\bETA\b/i);
  });

  it("breaks the state down per model, only from what the server reported", () => {
    h.diag.current = allReadyExcept({ modelServerState: "warming_up" });
    h.caps.current = {
      status: "ok",
      timestamp: "2026-01-01T00:00:00.000Z",
      engines: [
        { id: "thermompnn", name: "ThermoMPNN", category: "biophysical", status: "warming_up", details: {} },
        { id: "stabilityoracle", name: "StabilityOracle", category: "biophysical", status: "ready", details: {} },
        { id: "japanfold", name: "JapanFold", category: "biophysical", status: "ready", details: {} }
      ]
    };
    renderPanel();
    fireEvent.click(sidecarRow());

    const detail = within(detailPanel() as HTMLElement);
    // Per-model, so a reader can see WHICH is still loading rather than just that something is.
    // Each assertion is scoped to its own row: "Available" appears once per ready engine.
    const rowFor = (label: RegExp) => {
      const li = Array.from(
        (detailPanel() as HTMLElement).querySelectorAll("li")
      ).find(el => label.test(el.textContent ?? ""));
      if (!li) throw new Error(`no detail row matching ${label}`);
      return within(li as HTMLElement);
    };
    expect(rowFor(/ThermoMPNN/).getByText("Still loading")).toBeInTheDocument();
    expect(rowFor(/StabilityOracle/).getByText("Available")).toBeInTheDocument();
    expect(rowFor(/JapanFold/).getByText("Available")).toBeInTheDocument();
    // SaProt was not reported, so no row is invented for it.
    expect(detail.queryByText(/SaProt/)).toBeNull();
  });

  it("omits the per-model breakdown entirely when the server reported none", () => {
    // An empty breakdown must not render a heading with nothing under it.
    h.diag.current = allReadyExcept({ modelServerState: "warming_up" });
    renderPanel();
    fireEvent.click(sidecarRow());

    expect(within(detailPanel() as HTMLElement).queryByText("Still loading")).toBeNull();
    // No per-model line is invented for an engine the server never reported.
    expect(within(detailPanel() as HTMLElement).queryByText(/SaProt/)).toBeNull();
    // The explanation itself still stands on its own.
    expect(within(detailPanel() as HTMLElement).getByText(/loading into memory/)).toBeInTheDocument();
  });

  it("closes again on a second click", () => {
    h.diag.current = allReadyExcept({ modelServerState: "warming_up" });
    renderPanel();

    fireEvent.click(sidecarRow());
    expect(detailPanel()).not.toBeNull();
    fireEvent.click(sidecarRow());
    expect(detailPanel()).toBeNull();
    expect(sidecarRow().getAttribute("data-expanded")).toBe("false");
  });

  it("exposes the disclosure as a real focusable button, so the keyboard path is the platform's", () => {
    h.diag.current = allReadyExcept({ modelServerState: "warming_up" });
    renderPanel();

    // A native <button> is activated by Enter and Space by the browser itself, so there is no key
    // handler to duplicate here — and duplicating one would be the bug: two activations per press
    // on a real browser. What is pinned instead is that the control genuinely IS a button (not a
    // clickable div, which needs a hand-rolled handler and is silently unreachable without one),
    // that it takes focus, and that its name states what it opens.
    const chevron = within(sidecarRow()).getByRole("button", { name: /Show details for/i });
    expect(chevron.tagName).toBe("BUTTON");
    expect(chevron.getAttribute("type")).toBe("button");
    chevron.focus();
    expect(document.activeElement).toBe(chevron);

    // Activating it opens, and the name flips to describe the new state.
    fireEvent.click(chevron);
    expect(detailPanel()).not.toBeNull();
    expect(
      within(sidecarRow()).getByRole("button", { name: /Hide details for/i }).getAttribute("aria-expanded")
    ).toBe("true");

    fireEvent.click(within(sidecarRow()).getByRole("button", { name: /Hide details for/i }));
    expect(detailPanel()).toBeNull();
  });

  it("does not give a row with no action a button role it cannot honour", () => {
    // The row opens, but the chevron is the control. A second role on the header would be a second
    // tab stop for one action — and a role with no activation handler is worse than no role.
    h.diag.current = allReadyExcept({ modelServerState: "warming_up" });
    renderPanel();

    expect(sidecarRow().getAttribute("role")).toBeNull();
    // Exactly one disclosure control for this row, not two.
    expect(screen.getAllByRole("button", { name: /details for AI prediction models/i }).length).toBe(1);
  });

  it("keeps only one row open at a time, so the list stays readable", () => {
    h.diag.current = allReadyExcept({ modelServerState: "warming_up" });
    renderPanel();

    const clinvarChevron = within(
      document.querySelector('[data-service-id="clinvar"]') as HTMLElement
    ).getByRole("button", { name: /Show details for/i });
    fireEvent.click(clinvarChevron);
    expect(document.querySelector('[data-service-detail="clinvar"]')).not.toBeNull();

    // Opening another row closes the first, rather than stacking explanations down the rail.
    fireEvent.click(within(sidecarRow()).getByRole("button", { name: /Show details for/i }));
    expect(document.querySelector('[data-service-detail="sidecar"]')).not.toBeNull();
    expect(document.querySelector('[data-service-detail="clinvar"]')).toBeNull();
  });

  it.each(['alphagenome', 'gemini', 'foldx', 'p2rank'])(
    '%s disclosure leaves Enter and Space to the native button without configuring the service', id => {
      h.diag.current = allReadyExcept({});
      const configure = vi.fn();
      render(<SettingsProvider><LiveTelemetryPanel onConfigureClick={configure} /></SettingsProvider>);
      const row = document.querySelector(`[data-service-id="${id}"]`) as HTMLElement;
      const disclosure = within(row).getByRole('button', { name: /Show details for/ });
      for (const key of ['Enter', ' ']) {
        expect(fireEvent.keyDown(disclosure, { key })).toBe(true);
        expect(configure).not.toHaveBeenCalled();
      }
      fireEvent.click(disclosure);
      expect(disclosure).toHaveAttribute('aria-expanded', 'true');
      expect(configure).not.toHaveBeenCalled();
      expect(disclosure.closest('[role="button"]')).toBeNull();
      fireEvent.click(within(row).getByRole('button', { name: /Configure/ }));
      expect(configure).toHaveBeenCalledOnce();
    }
  );

  it("gives every service an explanation, so no status word is left unexplained", () => {
    h.diag.current = allReadyExcept({ modelServerState: "warming_up" });
    renderPanel();

    // All ten rows must be expandable: a rail where only the interesting row opens still leaves
    // "REST Live" and "Forcefield Live" as unexplained jargon.
    const rows = Array.from(document.querySelectorAll("[data-service-id]"));
    expect(rows.length).toBe(10);
    for (const row of rows) {
      expect(
        row.getAttribute("data-expanded"),
        `${row.getAttribute("data-service-id")} must be expandable`
      ).not.toBeNull();
    }
  });

  it("explains a ready sidecar as available rather than repeating its status", () => {
    h.diag.current = allReadyExcept({ modelServerReady: true, modelServerState: "ready" });
    renderPanel();
    fireEvent.click(sidecarRow());

    const detail = within(detailPanel() as HTMLElement);
    expect(detail.getByText("Ready")).toBeInTheDocument();
    expect(detail.getByText(/service is responding/)).toBeInTheDocument();
  });

  it("does not infer a permanent outage from a failed service check", () => {
    // The distinction that matters most in plain terms: broken-by-design vs broken-temporarily.
    h.diag.current = allReadyExcept({});
    renderPanel();
    fireEvent.click(sidecarRow());

    const detail = within(detailPanel() as HTMLElement);
    expect(detail.getByText("Not running")).toBeInTheDocument();
    expect(detail.getByText(/could not be reached on the last check/)).toBeInTheDocument();
    expect(detail.getByText(/Re-check the service status/)).toBeInTheDocument();
  });

  it("shows how current the explanation is, since a cold start resolves itself", () => {
    // 04:28 local, so the rendered label matches whatever zone the suite runs in.
    const swept = new Date();
    swept.setHours(16, 28, 0, 0);
    h.diag.current = allReadyExcept({
      modelServerState: "warming_up",
      timestamp: swept.toISOString()
    });
    renderPanel();
    fireEvent.click(sidecarRow());

    const expected = swept.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    // Without this, an explanation opened three minutes ago reads as current after the sidecar
    // has already gone green.
    expect(within(detailPanel() as HTMLElement).getByText(`Checked at ${expected}`)).toBeInTheDocument();
  });
});
