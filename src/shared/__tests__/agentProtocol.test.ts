import { describe, it, expect } from "vitest";
import { describeAgent, formatPairingCode, normalisePairingCode, type AgentView } from "../agentProtocol.ts";

const view = (over: Partial<AgentView> = {}): AgentView => ({
  id: "a",
  name: "Desk",
  createdAt: 0,
  lastSeenAt: 0,
  online: true,
  paused: false,
  runningJobs: 0,
  os: "win32",
  totalRamBytes: 16 * 1024 ** 3,
  tools: { foldx: { state: "ready", version: "5.1", detail: null }, p2rank: { state: "ready", version: "2.6-alpha", detail: null } },
  foldxSource: "team",
  ...over,
});

describe("describeAgent", () => {
  it("says what the computer does, in plain words", () => {
    expect(describeAgent(view())).toMatchObject({ label: "Connected", tone: "ready", detail: "Connected (16 GB): runs your FoldX and pocket detection jobs." });
    expect(describeAgent(view({ runningJobs: 1 })).detail).toMatch(/working on one of your jobs now/);
  });

  it("names the one thing to do when FoldX is missing, and that FoldX runs on the server meanwhile", () => {
    const c = describeAgent(view({ tools: { foldx: { state: "missing", version: null, detail: null }, p2rank: { state: "ready", version: "2.6-alpha", detail: null } } }));
    expect(c.tone).toBe("attention");
    expect(c.detail).toMatch(/open the agent page on that computer to finish/);
    expect(c.detail).toMatch(/run on the shared server meanwhile/);
  });

  it("offline and paused are said as such, never as an error", () => {
    expect(describeAgent(view({ online: false }))).toMatchObject({ label: "Not connected", tone: "offline" });
    expect(describeAgent(view({ paused: true }))).toMatchObject({ label: "Paused", tone: "paused" });
    expect(describeAgent(view({ tools: { foldx: { state: "installing", version: null, detail: null }, p2rank: { state: "installing", version: null, detail: null } } })).label).toBe("Setting up");
  });
});

describe("pairing codes", () => {
  it("ignore case, spaces and dashes, and refuse look-alike characters", () => {
    expect(normalisePairingCode(" abc-def ")).toBe("ABCDEF");
    expect(normalisePairingCode("ABC DE2")).toBe("ABCDE2");
    expect(normalisePairingCode("ABCDE0")).toBeNull(); // 0 is not in the alphabet
    expect(normalisePairingCode("ABCDE")).toBeNull();
    expect(formatPairingCode("ABCDEF")).toBe("ABC-DEF");
  });
});
