import { describe, it, expect } from "vitest";
import { classifyLogSource, leadingTag } from "../logSource";

describe("leadingTag", () => {
  it("reads the first bracketed tag, lower-cased", () => {
    expect(leadingTag("[FoldxService Error] pipeline failed")).toBe("foldxservice error");
    expect(leadingTag("  [Pocket Finder] notice")).toBe("pocket finder");
  });
  it("is null for untagged or non-string messages", () => {
    expect(leadingTag("plain message")).toBeNull();
    expect(leadingTag(new Error("x"))).toBeNull();
    expect(leadingTag("text [late tag]")).toBeNull();
  });
});

describe("classifyLogSource", () => {
  // Every tag the client actually emits today. Each one used to fall through to `console`, which is
  // how the Biophysics filter came to hide a FoldX failure.
  const cases: Array<[string, string]> = [
    ["[FoldxService Error] FoldX pipeline failed:", "biophysics"],
    ["[FoldxService] Polling network glitch", "biophysics"],
    ["[FoldX] calculation failed for p.Arg408Trp", "biophysics"],
    ["[ThermoMPNN] model service offline", "biophysics"],
    ["[BiophysicalService Error] failed", "biophysics"],
    ["[StructuralModel] SaProt failed", "biophysics"],
    ["[StructuralAnalysis] All deep language model evaluations failed", "biophysics"],
    ["[DynaMut2] job", "biophysics"],
    ["[ESMFold] De novo folding unavailable", "structure-3d"],
    ["[Pocket Detection Error]:", "structure-3d"],
    ["[Pocket Finder] notice", "structure-3d"],
    ["[StructureService] fetch", "structure-3d"],
    ["[MolstarViewer] init", "structure-3d"],
    ["[3D] camera", "structure-3d"],
    ["[Homologs] none", "structure-3d"],
    ["[NarrativeService Error] x", "ai-narrative"],
    ["[NarrativeFlight] x", "ai-narrative"],
    ["[Literature Fetch Error] x", "literature"],
    ["[Client Retry] attempt 2", "workflow"],
    ["[Backfill] Biophysics backfill failed", "workflow"],
    ["[Pipeline] stage", "workflow"],
    ["[WorkflowOrchestrator] x", "workflow"],
    ["[useJobPoller] DDMut reported unavailable", "workflow"],
    ["[apiClient] timeout", "network"],
    ["[Notification Error] x", "notification"],
    ["[ErrorBoundary:Console] x", "component"],
    ["[LazyRetry] chunk", "system"],
    ["[Vite Preload] outdated", "system"],
    ["[AlphaGenome region] x", "genomics"],
    ["[Landscape] x", "genomics"],
    ["[Molstar] Initialization error:", "structure-3d"],
    ["[UniProt] Unable to fetch sequence:", "structure-3d"],
    ["[Cache] Could not save this variant's results", "system"],
    ["[Stream Parse Warning] The final stream frame was dropped", "network"],
    ["[WorkflowOrchestrator] Top-level pipeline error:", "workflow"],
    ["[Settings] Could not save settings:", "console"],
  ];
  it.each(cases)("%s -> %s", (message, expected) => {
    expect(classifyLogSource([message])).toBe(expected);
  });

  it("keeps untagged and unknown-tag messages in the generic console bucket", () => {
    expect(classifyLogSource(["plain"])).toBe("console");
    expect(classifyLogSource(["[Share] copied"])).toBe("console");
    expect(classifyLogSource([])).toBe("console");
  });
});
