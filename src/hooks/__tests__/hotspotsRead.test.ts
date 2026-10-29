import { beforeEach, describe, expect, it, vi } from "vitest";
import { useVariantAnalysisStore } from "../../stores/useVariantAnalysisStore";
import { hotspotsSlot } from "../../shared/evidenceKeys";
import { hotspotContextSchema } from "../../shared/hotspotEvidence";
import sod1Raw from "../../shared/__tests__/fixtures/hotspotsSod1.json";
import { readHotspots } from "../hotspotsRead";

/** The one hot-spot reader: every state the slot can end in, and that a read already running is not started twice. */
const slot = hotspotsSlot("SOD1", "P00441", "ENST00000270142");
const answer = (body: unknown, ok = true, status = 200) =>
  vi.fn(async () => ({ ok, status, json: async () => body, body: { cancel: async () => {} } }) as unknown as Response);
const state = () => useVariantAnalysisStore.getState().extraContexts[slot];

beforeEach(() => useVariantAnalysisStore.setState({ extraContexts: {} }));

describe("readHotspots", () => {
  it("asks for the protein and transcript, and stores the parsed answer as ready", async () => {
    const fetchWithAuth = answer(sod1Raw);
    await readHotspots(fetchWithAuth, "SOD1", "P00441", "ENST00000270142");
    expect(fetchWithAuth).toHaveBeenCalledWith("/api/v1/evidence-context/SOD1/hotspots?uniprot=P00441&transcript=ENST00000270142", { timeout: 120000 });
    expect(state().status).toBe("ready");
    expect((state().data as ReturnType<typeof hotspotContextSchema.parse>).gene).toBe("SOD1");
  });

  it("reads a result with no UniProt accession from the bare endpoint instead of waiting forever", async () => {
    const fetchWithAuth = answer({ ...sod1Raw, uniprotId: null });
    await readHotspots(fetchWithAuth, "SOD1", null, null);
    expect(fetchWithAuth).toHaveBeenCalledWith("/api/v1/evidence-context/SOD1/hotspots", { timeout: 120000 });
    expect(useVariantAnalysisStore.getState().extraContexts[hotspotsSlot("SOD1", null, null)].status).toBe("ready");
  });

  it("stores a transport failure, a schema failure and another gene's answer as errors, in plain words", async () => {
    await readHotspots(answer({}, false, 502), "SOD1", "P00441", "ENST00000270142");
    expect(state()).toMatchObject({ status: "error", data: null });
    expect(state().error).toMatch(/HTTP 502/);
    await readHotspots(answer({ gene: "SOD1" }), "SOD1", "P00441", "ENST00000270142");
    expect(state().error).toMatch(/could not be validated/);
    await readHotspots(answer({ ...sod1Raw, gene: "VHL" }), "SOD1", "P00441", "ENST00000270142");
    expect(state().status).toBe("error");
  });

  it("does not start a second read while one is running", async () => {
    const pending = vi.fn(() => new Promise<Response>(() => {}));
    void readHotspots(pending, "SOD1", "P00441", "ENST00000270142");
    await readHotspots(pending, "SOD1", "P00441", "ENST00000270142");
    expect(pending).toHaveBeenCalledTimes(1);
    expect(state().status).toBe("loading");
  });

  it("reads nothing without a gene", async () => {
    const fetchWithAuth = answer(sod1Raw);
    await readHotspots(fetchWithAuth, "", "P00441", null);
    expect(fetchWithAuth).not.toHaveBeenCalled();
  });
});
