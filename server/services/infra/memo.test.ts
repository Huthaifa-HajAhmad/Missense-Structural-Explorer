import { describe, it, expect, vi, beforeEach } from "vitest";
import { memo, clearMemoForTests } from "./memo.ts";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE RUN PER QUESTION — including the questions asked at the same moment
 * ─────────────────────────────────────────────────────────────────────────────
 * A cache of finished values would not have helped the case this exists for: the burial reading and
 * the ESM3 evaluation ask the same accessibility question about the same structure concurrently, so
 * the second caller arrives while the first is still running. Caching the PROMISE is what makes that
 * one run. And a value that is not an answer must never be remembered, or a busy host could never be
 * retried.
 */
describe("memo", () => {
  beforeEach(() => clearMemoForTests());

  it("runs a question once when two callers ask it at the same moment", async () => {
    let release!: (value: string) => void;
    const run = vi.fn(() => new Promise<string>(resolve => { release = resolve; }));

    const first = memo("test", { q: 1 }, run);
    const second = memo("test", { q: 1 }, run);
    release("answer");

    expect(await first).toBe("answer");
    expect(await second).toBe("answer");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("answers a later caller from the remembered answer", async () => {
    const run = vi.fn(async () => "answer");
    await memo("test", { q: 2 }, run);
    expect(await memo("test", { q: 2 }, run)).toBe("answer");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("treats different inputs as different questions", async () => {
    const run = vi.fn(async () => "answer");
    await memo("test", { q: 3 }, run);
    await memo("test", { q: 4 }, run);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("does not remember a value the caller says is not an answer", async () => {
    type Answer = { status: "success" | "error"; message: string };
    const failed = vi.fn(async (): Promise<Answer> => ({ status: "error", message: "busy" }));
    expect(await memo("test", { q: 5 }, failed, value => value.status === "success")).toEqual({ status: "error", message: "busy" });

    // The retry must actually reach the tool: a failure is not a fact about the inputs.
    const retried = vi.fn(async (): Promise<Answer> => ({ status: "success", message: "ok" }));
    expect(await memo("test", { q: 5 }, retried, value => value.status === "success")).toEqual({ status: "success", message: "ok" });
    expect(retried).toHaveBeenCalledTimes(1);
  });

  it("does not remember a rejection", async () => {
    const rejected = vi.fn(async () => { throw new Error("torn"); });
    await expect(memo("test", { q: 6 }, rejected)).rejects.toThrow("torn");

    const retried = vi.fn(async () => "answer");
    expect(await memo("test", { q: 6 }, retried)).toBe("answer");
    expect(retried).toHaveBeenCalledTimes(1);
  });
});
