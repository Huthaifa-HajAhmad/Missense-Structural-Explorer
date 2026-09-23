// @vitest-environment jsdom
/**
 * AlphaGenomeTab.test.tsx — what the AlphaGenome panel is allowed to say when it has no score.
 *
 * This panel had no render test at all, which is why a three-day-old upstream change could break its
 * only user-visible contract silently: it kept asserting "Awaiting API key for exact rank" while the
 * key was configured and verified, because a GRCh38-only build gate had refused the GRCh37
 * coordinate (see doc/ALPHAGENOME_STANDBY_RCA_AND_UI_AUDIT.md §1).
 *
 * Every assertion below is a claim adversarial review proved the panel could get wrong. They are
 * written against the rendered DOM, not against the resolver — the resolver has its own suite, and
 * what these pin is that the *panel* consumes it rather than re-deriving a cause.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const REFUSAL =
  "alphagenome covers GRCh38 / hg38; this coordinate is GRCh37 / hg19 and was not scored.";

// Paths resolve from THIS file (`src/components/evidence/__tests__/`), which is one level deeper
// than the component's own `../../` — hence three `../`.
vi.mock("../../../context/SettingsContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../context/SettingsContext")>();
  return {
    ...actual,
    useSettings: () => ({
      // No browser-side key: `configured` is then `undefined` (unknown), never a definite false.
      settings: { alphagenomeApiKey: "", alphagenomeApiUrl: "" },
      openSettingsTab: vi.fn(),
    }),
  };
});

vi.mock("../../../apiClient", () => ({
  useApiClient: () => ({ fetchWithAuth: vi.fn() }),
}));

import { AlphaGenomeTab } from "../AlphaGenomeTab";

function renderTab(options: {
  alphagenome?: Record<string, unknown> | null;
  refusals?: Array<{ source: string; reason: string }> | null;
}) {
  const result = {
    metadata: { gene: "ACOT9", variant: "p.Lys272Asn", uniprotId: "Q9Y305" },
    predictorData: { gnomadVariantId: "X-23723975-C-A", gnomadVariantAssembly: "GRCh37" },
    conservationData: {
      alphagenome: options.alphagenome ?? null,
      assemblyRefusals: options.refusals ?? null,
    },
  };
  return render(<AlphaGenomeTab {...({ analysisState: { result } } as any)} />);
}

describe("a build refusal is stated as a coverage decision, never as a credential problem", () => {
  it("renders the canonical label and the server's own reason", () => {
    renderTab({ refusals: [{ source: "alphagenome", reason: REFUSAL }] });
    // The canonical label intentionally appears in two places — the status badge and the ClinGen SVI
    // card — so this asserts presence, not uniqueness.
    expect(screen.getAllByText("Not covered").length).toBeGreaterThan(0);
    // The reason is humanised, so the internal source key does not reach clinical prose.
    expect(screen.getByText(/AlphaGenome Atlas covers GRCh38 \/ hg38/)).toBeInTheDocument();
    expect(screen.queryByText(/^alphagenome covers/)).not.toBeInTheDocument();
  });

  it("never blames the API key — the defect this panel was diagnosed with", () => {
    renderTab({ refusals: [{ source: "alphagenome", reason: REFUSAL }] });
    expect(screen.queryByText(/Awaiting API key/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Add or check the AlphaGenome credential/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Standby/i)).not.toBeInTheDocument();
  });

  it("says plainly that no setting changes a coverage decision", () => {
    renderTab({ refusals: [{ source: "alphagenome", reason: REFUSAL }] });
    expect(screen.getByText(/No setting changes this\./)).toBeInTheDocument();
  });
});

describe("an actionable absence offers the remedy that can actually fix it", () => {
  it("sends a rejected credential to Settings, not to a retry loop", () => {
    renderTab({
      alphagenome: {
        status: "unavailable",
        aviPhred: null,
        message: "AlphaGenome API Key is invalid or expired.",
      },
    });
    expect(screen.getAllByText("Not available here").length).toBeGreaterThan(0);
    expect(screen.getByText(/Add or check the AlphaGenome credential in Settings/)).toBeInTheDocument();
    expect(screen.queryByText(/Re-evaluate the variant to ask the Atlas again/)).not.toBeInTheDocument();
  });

  it("offers a retry for a provider fault, and not a credential action", () => {
    renderTab({
      alphagenome: { status: "unavailable", aviPhred: null, message: "AlphaGenome Atlas query timed out." },
    });
    expect(screen.getAllByText("Provider error").length).toBeGreaterThan(0);
    expect(screen.getByText(/Re-evaluate the variant to ask the Atlas again/)).toBeInTheDocument();
    expect(screen.queryByText(/Add or check the AlphaGenome credential/)).not.toBeInTheDocument();
  });

  it("does not assert a third-party fault from a bare status with no message", () => {
    // `status` defaults to "unavailable" in the wire schema, so an absent field must not be reported
    // as "Provider error" on no evidence.
    renderTab({ alphagenome: { status: "unavailable", aviPhred: null } });
    expect(screen.queryByText("Provider error")).not.toBeInTheDocument();
    expect(screen.getAllByText("No result").length).toBeGreaterThan(0);
  });
});

describe("a live score and its attribution are separate axes", () => {
  it("reports the canonical positive state, not an invented word", () => {
    renderTab({
      alphagenome: { status: "live", aviPhred: 22.5, aviQuantile: 0.5, featureAttributions: { Splicing: 0.1 } },
    });
    expect(screen.getByText("Computed")).toBeInTheDocument();
    expect(screen.queryByText(/AVI assessed/)).not.toBeInTheDocument();
  });

  it("explains a live score that arrived without attributions, instead of showing 18 bare dashes", () => {
    // `alphagenome-client.ts` emits `featureAttributions: null` on live results whenever the
    // feature-importance scorer returns nothing; the panel used to claim a completed decomposition.
    renderTab({ alphagenome: { status: "live", aviPhred: 22.5, featureAttributions: null } });
    expect(screen.getByText(/returned without modality attributions/)).toBeInTheDocument();
    expect(screen.queryByText(/Decomposition of 9,440 functional tracks/)).not.toBeInTheDocument();
  });

  it("treats a measured quantile of 0 as a value, not as missing", () => {
    renderTab({ alphagenome: { status: "live", aviPhred: 22.5, aviQuantile: 0, featureAttributions: { Splicing: 0 } } });
    expect(screen.getByText("0.00000")).toBeInTheDocument();
  });
});

describe("the wrapper's guard", () => {
  it("renders nothing without a result, and without tripping the hooks order", () => {
    // The guard used to sit above ten hooks inside the body; it now lives in a hook-free wrapper, so
    // mounting with no result must be a clean no-op rather than a render-phase violation.
    const { container } = render(<AlphaGenomeTab {...({ analysisState: { result: null } } as any)} />);
    expect(container).toBeEmptyDOMElement();
  });
});

/**
 * The "Leading Driver: Cactus" defect.
 *
 * The payload's `topModality` is an `argmax |SHAP|` across all eighteen layers including the two
 * conservation tracks, so for ACOT9 p.Ser489Cys it elected Cactus (the 241-way placental-mammal
 * alignment) at +0.531 — seven times the coding signal — and the panel labelled it "Primary
 * biological regulatory disruption". Conservation is not a mechanism, and presenting it as the driver
 * made the hero quietly contradict the coding/splicing panel directly below it.
 *
 * These pin the split: mechanisms and constraint are ranked separately, and a conservation track can
 * never occupy the mechanism slot.
 */
describe("mechanism and constraint are ranked separately", () => {
  it("names the leading MECHANISM even when a conservation track scores higher", () => {
    renderTab({
      alphagenome: {
        status: "live",
        aviPhred: 22.7,
        featureAttributions: { AlphaMissense: 0.076, Splicing: 0.008, Cactus: 0.531 },
      },
    });
    // AlphaMissense also appears as a modality card, so assert presence rather than uniqueness.
    expect(screen.getAllByText("AlphaMissense").length).toBeGreaterThan(0);
    // ...and the conservation signal is named, but explicitly as corroboration rather than a driver.
    expect(screen.getByText(/Constraint corroboration/)).toBeInTheDocument();
    expect(screen.getByText(/conservation evidence, not a mechanism/)).toBeInTheDocument();
    expect(screen.queryByText(/Primary biological regulatory disruption/)).not.toBeInTheDocument();
  });

  it("leaves the mechanism slot empty when ONLY conservation was attributed", () => {
    // The load-bearing case: a conservation-only vector must not be able to claim a mechanism.
    renderTab({
      alphagenome: { status: "live", aviPhred: 22.7, featureAttributions: { Cactus: 0.531 } },
    });
    expect(screen.getByText(/Largest attribution across coding, splicing and regulatory layers/))
      .toBeInTheDocument();
    // The conservation value is still reported — real evidence, just not a mechanism.
    expect(screen.getByText(/Constraint corroboration/)).toBeInTheDocument();
  });

  it("never labels a conservation track as the primary regulatory disruption", () => {
    renderTab({
      alphagenome: {
        status: "live",
        aviPhred: 22.7,
        featureAttributions: { Cactus: 0.531, PhastCons: 0.138, ProteinTermination: 0.02 },
      },
    });
    expect(screen.queryByText(/Primary biological regulatory disruption/)).not.toBeInTheDocument();
  });
});
