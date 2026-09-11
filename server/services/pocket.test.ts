import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { discoverJavaHome, _resetJavaHomeCache } from "./pocket.ts";

describe("Pocket Service - Java & Fallback Resilience", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    _resetJavaHomeCache();
  });

  afterEach(() => {
    process.env = originalEnv;
    _resetJavaHomeCache();
  });

  it("should ignore invalid P2RANK_JAVA_HOME and not return the invalid path", async () => {
    process.env.P2RANK_JAVA_HOME = "C:\\Fake\\NonExistent\\Java17";
    const home = await discoverJavaHome();
    expect(home).not.toBe("C:\\Fake\\NonExistent\\Java17");
  });

  it("should auto-discover compatible Java 17+ on the host system", async () => {
    delete process.env.P2RANK_JAVA_HOME;
    delete process.env.JAVA_HOME;
    const home = await discoverJavaHome();
    expect(typeof home === "string").toBe(true);
  });

  it("should prioritize P2RANK_JAVA_HOME when it points to a valid Java installation", async () => {
    const discovered = await discoverJavaHome();
    if (discovered) {
      _resetJavaHomeCache();
      process.env.P2RANK_JAVA_HOME = discovered;
      const home = await discoverJavaHome();
      expect(home).toBe(discovered);
    }
  });

  it("should cache discovery result until cache is reset", async () => {
    const first = await discoverJavaHome();
    process.env.P2RANK_JAVA_HOME = "C:\\Another\\Fake\\Path";
    const second = await discoverJavaHome();
    expect(second).toBe(first);

    _resetJavaHomeCache();
    delete process.env.P2RANK_JAVA_HOME;
    const third = await discoverJavaHome();
    expect(third).toBe(first);
  });
});
