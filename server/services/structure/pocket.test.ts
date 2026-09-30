import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { discoverJavaHome, _resetJavaHomeCache, checkP2RankCapability, pocketCache, findBindingPocket } from "./pocket.ts";
import os from "os";
import path from "path";

describe("Pocket Service - Java & Fallback Resilience", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    _resetJavaHomeCache();
    pocketCache.clear();
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

  it("should report P2Rank capability status accurately via checkP2RankCapability", async () => {
    const cap = await checkP2RankCapability();
    expect(cap).toBeDefined();
    expect(typeof cap.installed).toBe("boolean");
    expect(typeof cap.javaVersionCompatible).toBe("boolean");
    expect(typeof cap.ready).toBe("boolean");
  });

  it("should not cache transient unavailable states in pocketCache", async () => {
    // Calling findBindingPocket with empty text returns unavailable without caching
    // A job directory under the OS temp dir: a Windows literal became a file named "C:\Fake\JobDir"
    // in the working tree on Linux.
    const res = await findBindingPocket("", 1, path.join(os.tmpdir(), "pocket-test-unused-job"));
    expect(res.status).toBe("unavailable");
    expect(pocketCache.size).toBe(0);
  });
});
