// @vitest-environment jsdom
import React from "react";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Activity } from "lucide-react";
import { PerturbationModelCards, type PerturbModelDef } from "../PerturbationModelCards";

/**
 * A fallback card replaces one model's numbers with another's, so it has to be able to say why —
 * per tier. The defects pinned here:
 *
 *  1. Only the *remote* engine's failure was carried (`hfError`), so a card whose local SaProt load
 *     failed pointed the reader at the wrong engine, with a parse error that read like a bug in this
 *     codebase. Observed production message:
 *     "SaProt fill mask returned insufficient valid amino acid tokens (0/20 matched)".
 *  2. The diagnostic was rendered only on a fallback card, so a run that recovered locally after a
 *     failed remote attempt hid its diagnostic entirely.
 *  3. "SaProt unavailable" was the whole explanation unless you hovered; the cause is now visible.
 */

function card(overrides: Record<string, unknown> = {}): PerturbModelDef {
  return {
    id: "saprot",
    name: "VESM-150M (Local Fallback - SaProt unavailable)",
    description: "Structure-aware residue and conformation predictor",
    data: {
      llr: -8.8546,
      embeddingShift: 5.8749,
      provenance: "VESM-150M (Local Fallback - SaProt unavailable)",
      ...overrides
    },
    icon: Activity,
    tokenName: "Hugging Face Access Token",
    tokenSettingKey: "hfToken",
    hasKey: true
  };
}

function renderCards(model: PerturbModelDef) {
  return render(
    <PerturbationModelCards models={[model]} activeModelId="saprot" onSelectModel={vi.fn()} />
  );
}

/**
 * The diagnostic affordance specifically. A bare `[title]` query would also match the ΔLLR
 * "uncalibrated" note, which carries its own tooltip and is unrelated to this contract.
 */
const diagnosticInfo = (container: HTMLElement) =>
  container.querySelector<HTMLElement>("span.cursor-help");

const REMOTE_CAUSE =
  "Remote engine (HF serverless): ValueError: SaProt fill mask returned insufficient valid amino acid tokens (0/20 matched)";
const LOCAL_CAUSE = "SaProt_35M_AF2: PermissionError: HF cache lock could not be created";

describe("PerturbationModelCards fallback diagnostics", () => {
  it("labels each tier's failure instead of presenting the remote error as the cause", () => {
    const { container } = renderCards(
      card({
        remoteEngineNote: REMOTE_CAUSE.replace("Remote engine (HF serverless): ", ""),
        fallbackReason: LOCAL_CAUSE
      })
    );

    const info = diagnosticInfo(container);
    expect(info).not.toBeNull();
    const tooltip = info!.getAttribute("title") || "";
    expect(tooltip).toContain("Remote engine (HF serverless)");
    expect(tooltip).toContain("0/20 matched");
    expect(tooltip).toContain("Local SaProt candidates");
    expect(tooltip).toContain("PermissionError");

    // The reason that actually forced the fallback is visible without a hover.
    expect(container.textContent).toContain(`Cause: ${LOCAL_CAUSE}`);
  });

  it("still offers the remote diagnostic when the run recovered on the local engine", () => {
    const { container } = renderCards(
      card({
        provenance: "SaProt (SaProt_35M_AF2 - Local CPU)",
        remoteEngineNote: "ValueError: SaProt fill mask returned insufficient valid amino acid tokens (0/20 matched)"
      })
    );

    // Not a fallback badge, but the diagnostic must not vanish.
    expect(container.textContent).not.toContain("Fallback (CPU)");
    expect(container.textContent).not.toContain("Cause:");
    expect(diagnosticInfo(container)!.getAttribute("title")).toContain("Remote engine (HF serverless)");
  });

  it("falls back to the legacy hfError field when no tier note is present", () => {
    const { container } = renderCards(card({ hfError: "TimeoutError: HF inference timed out" }));

    expect(diagnosticInfo(container)!.getAttribute("title")).toContain("HF inference timed out");
  });

  it("shows no diagnostic affordance when nothing failed", () => {
    const { container } = renderCards(
      card({ provenance: "ESMC-6B (Remote)", embeddingShift: 37.363 })
    );

    expect(diagnosticInfo(container)).toBeNull();
    expect(container.textContent).not.toContain("Cause:");
  });
});
