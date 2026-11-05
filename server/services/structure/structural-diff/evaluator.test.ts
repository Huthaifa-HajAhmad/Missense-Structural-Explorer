import { describe, it, expect, vi, afterEach } from "vitest";

// The command-line fallback is observed, never run: no test here may start a Python process.
const execFileMock = vi.hoisted(() => vi.fn());
vi.mock("child_process", () => ({ execFile: execFileMock }));

import { runEsm2Eval } from "./evaluator.ts";
import { toolsVenvPython } from "../../infra/tools-python.ts";

/**
 * These tests lock the two properties that keep fast ESM-2 triage from reporting a false
 * timeout on long proteins:
 *
 *  1. The sidecar is asked for the LLR only (`includeEmbeddings: false`), so it does not run the
 *     two unmasked WT/mutant forward passes that triage never reads.
 *  2. The request budget is scaled above the default for sequences over 500 residues, whose CPU
 *     forward pass is slower than the flat 15s the triage used to allow.
 *
 * Uniqueness of `seq` per case matters: `runEsm2Eval` memoises by sequence hash, so a repeated
 * sequence would return the cached result and never reach the fetch spy.
 */

const originalTimeout = AbortSignal.timeout.bind(AbortSignal);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  execFileMock.mockReset();
});

function stubSuccessfulSidecar() {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({ status: "success", llr: -2.5, verdict: "deleterious" })
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function captureTimeouts() {
  const seen: number[] = [];
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
    seen.push(ms);
    return originalTimeout(ms);
  });
  return seen;
}

describe("runEsm2Eval fast triage", () => {
  it("requests an llr-only payload and parses the verdict", async () => {
    const fetchMock = stubSuccessfulSidecar();
    const timeouts = captureTimeouts();

    const result = await runEsm2Eval("ACDEFGHIKLMNPQRSTVWY", 1, "A", "V");

    expect(result).toEqual({ llr: -2.5, verdict: "deleterious" });
    expect(timeouts).toEqual([15000]);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/predict/vesm");
    // The sidecar defaults this to true; triage must opt out so it skips the embedding passes.
    expect(JSON.parse(init.body as string)).toMatchObject({ includeEmbeddings: false });
  });

  it("scales the request budget for sequences longer than 500 residues", async () => {
    const fetchMock = stubSuccessfulSidecar();
    const timeouts = captureTimeouts();
    const longSeq = "ACDEFGHIKLMNPQRSTVWY".repeat(30); // 600 residues

    await runEsm2Eval(longSeq, 1, "A", "V");

    expect(timeouts).toEqual([25000]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("memoises the result for a repeated variant", async () => {
    const fetchMock = stubSuccessfulSidecar();

    const seq = "MEEPQSDPSVEPPLSQETFSDLWKLLPENNVLSPLPSQAMDDLMLSPDDIEQWFTEDPGP";
    const first = await runEsm2Eval(seq, 3, "E", "K");
    const second = await runEsm2Eval(seq, 3, "E", "K");

    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends the sidecar how long it will wait, so a request nobody waits for can be skipped", async () => {
    const fetchMock = stubSuccessfulSidecar();
    await runEsm2Eval("ACDEFGHIKLMNPQRSTVWYC", 2, "C", "V");
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["X-Budget-Ms"]).toBe("15000");
  });
});

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE COMMAND-LINE FALLBACK — only when no model server answers, and only through a launcher that exists
 * ─────────────────────────────────────────────────────────────────────────────
 * It ran `python -m uv run …`. In the production container the tools environment has no `uv` module, so
 * the fallback failed instantly ("No module named uv") on every busy-sidecar timeout. Had it worked, it
 * would have loaded a second copy of the model on the same two CPUs, slowing the sidecar it was
 * covering for.
 */
describe("runEsm2Eval command-line fallback", () => {
  const scriptOutput = { stdout: JSON.stringify({ status: "success", llr: -1.5, verdict: "tolerated" }), stderr: "" };

  it("does not start a second model process when the sidecar only timed out", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new DOMException("The operation was aborted due to timeout", "TimeoutError"); }));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(await runEsm2Eval("GGGGGGGGGGGGGGGGGGGGA", 21, "A", "V")).toBeNull();
    expect(execFileMock, "a busy sidecar is alive; a second model would only slow it").not.toHaveBeenCalled();
  });

  it("falls back to the tools environment's own interpreter when nothing is listening", async () => {
    const refused = Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    vi.stubGlobal("fetch", vi.fn(async () => { throw refused; }));
    execFileMock.mockImplementation((_command: string, _args: string[], _options: unknown, done: (...a: unknown[]) => void) => done(null, scriptOutput));

    const result = await runEsm2Eval("GGGGGGGGGGGGGGGGGGGAC", 21, "A", "V");

    expect(result).toEqual({ llr: -1.5, verdict: "tolerated" });
    const [command, args] = execFileMock.mock.calls[0] as [string, string[]];
    expect(command, "`python -m uv` does not exist in the container's environment").not.toBe("python");
    expect(args).not.toContain("-m");
    const venvPython = toolsVenvPython();
    if (venvPython) {
      expect(command).toBe(venvPython);
    } else {
      expect([command, ...args.slice(0, 2)]).toEqual(["uv", "run", "--no-project"]);
    }
  });

  it("keeps the old behaviour for an answer that is not a score (a misconfigured sidecar can still be covered)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })));
    execFileMock.mockImplementation((_command: string, _args: string[], _options: unknown, done: (...a: unknown[]) => void) => done(null, scriptOutput));

    expect(await runEsm2Eval("GGGGGGGGGGGGGGGGGGACA", 21, "A", "V")).toEqual({ llr: -1.5, verdict: "tolerated" });
    expect(execFileMock).toHaveBeenCalledTimes(1);
  });

  /**
   * The CPU gate refuses a pass with `503` when the caller's deadline had passed
   * (`GateDeadlineExceeded`). That is the model server ANSWERING, not failing: the same reason the
   * timeout above must not spawn a second model applies, more strongly.
   */
  it("does not start a second model process when the server refused because it was busy", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503, text: async () => JSON.stringify({ status: "busy" }) })));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(await runEsm2Eval("GGGGGGGGGGGGGGGGGGGCC", 21, "A", "V")).toBeNull();
    expect(execFileMock, "a refusal means the box is busy; a second model would make it busier").not.toHaveBeenCalled();
  });
});
