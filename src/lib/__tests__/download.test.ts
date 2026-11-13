// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadBlob } from "../download";

describe("downloadBlob", () => {
  const createObjectURL = vi.fn(() => "blob:test-url");
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("creates, clicks, and removes an anchor element and defers URL revocation", () => {
    const appendSpy = vi.spyOn(document.body, "appendChild");
    const removeSpy = vi.spyOn(document.body, "removeChild");
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    downloadBlob("example.json", "application/json", '{"ok":true}', 250);

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const createdAnchor = appendSpy.mock.calls[0]?.[0] as HTMLAnchorElement;
    expect(createdAnchor.download).toBe("example.json");
    expect(createdAnchor.href).toBe("blob:test-url");
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(removeSpy).toHaveBeenCalledWith(createdAnchor);
    expect(document.body.contains(createdAnchor)).toBe(false);
    expect(revokeObjectURL).not.toHaveBeenCalled();

    vi.advanceTimersByTime(250);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test-url");
  });
});
