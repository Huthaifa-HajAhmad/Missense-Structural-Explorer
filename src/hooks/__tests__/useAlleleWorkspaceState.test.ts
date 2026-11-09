// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useAlleleWorkspaceState } from "../useAlleleWorkspaceState";

const initial = { view: "comparison" };
const allele = (extra: object = {}, gene = "SOD1") => ({ metadata: { gene, variant: "p.Ala5Val", uniprotId: "P00441", residueIndex: 5 }, ...extra }) as any;
const predictor = (id: string) => ({ predictorData: { transcriptId: "ENST1", gnomadVariantId: id, gnomadVariantAssembly: "GRCh38" } });

function openRecordsView(firstResult: any) {
  const hook = renderHook(({ result }) => useAlleleWorkspaceState<"predictors", typeof initial>(result, initial), { initialProps: { result: firstResult } });
  act(() => hook.result.current.update("predictors", { view: "records" }));
  return hook;
}

const predictorsState = (hook: ReturnType<typeof openRecordsView>) => (hook.result.current.states as Partial<Record<"predictors", typeof initial>>).predictors;

describe("Evidence selections while a result streams in", () => {
  it("survive when the transcript and gnomAD ids arrive for the same allele", () => {
    const hook = openRecordsView(allele());
    hook.rerender({ result: allele(predictor("21-1-C-T")) });
    expect(predictorsState(hook)?.view).toBe("records");
  });

  it("reset when a known gnomAD id changes to another", () => {
    const hook = openRecordsView(allele(predictor("21-1-C-T")));
    hook.rerender({ result: allele(predictor("21-9-G-A")) });
    expect(predictorsState(hook)).toBeUndefined();
  });

  it("reset when the gene changes", () => {
    const hook = openRecordsView(allele());
    hook.rerender({ result: allele({}, "PAH") });
    expect(predictorsState(hook)).toBeUndefined();
  });

  it("reset when the result is cleared for a new run", () => {
    const hook = openRecordsView(allele());
    hook.rerender({ result: null });
    expect(predictorsState(hook)).toBeUndefined();
  });
});
