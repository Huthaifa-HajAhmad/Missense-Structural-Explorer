// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { YourComputers } from "../YourComputers";
import { TeamFoldx } from "../TeamFoldx";
import { ComputeLimits, describeHostClass } from "../ComputeLimits";

/**
 * The two WP-F screens: "Your computers" (Settings → Account) and "FoldX for the team" (Settings → Team).
 * What matters: the status is said in plain words, the code is shown once asked for, and the FoldX upload
 * cannot be sent without the licence confirmation.
 */

type Handler = (url: string, init?: RequestInit) => { status: number; body?: unknown };

function mockFetch(handler: Handler) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const r = handler(String(input), init);
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const AGENT = {
  id: "a1",
  name: "Lab desktop",
  createdAt: 0,
  lastSeenAt: Date.now(),
  online: true,
  paused: false,
  runningJobs: 0,
  os: "win32",
  totalRamBytes: 16 * 1024 ** 3,
  tools: { foldx: { state: "missing", version: null, detail: null }, p2rank: { state: "ready", version: "2.6-alpha", detail: null } },
  foldxSource: "none",
};

describe("Your computers", () => {
  it("shows each computer's state in plain words, and a one-time code on request", async () => {
    mockFetch((url, init) => {
      if (url.endsWith("/me/agents")) return { status: 200, body: { agents: [AGENT] } };
      if (url.endsWith("/me/agent-downloads")) return { status: 200, body: { platforms: [{ platform: "win32-x64", label: "Windows", sizeBytes: 40 * 1048576, url: "/api/v1/me/agent-download/win32-x64" }] } };
      if (url.endsWith("/agent/pair") && init?.method === "POST") return { status: 201, body: { code: "K7M-Q2X", expiresAt: Date.now() + 600_000 } };
      return { status: 404 };
    });
    render(<YourComputers />);
    expect(await screen.findByText("Lab desktop")).toBeTruthy();
    expect(screen.getByText(/open the agent page on that computer to finish/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Windows · 40 MB/ }).getAttribute("href")).toBe("/api/v1/me/agent-download/win32-x64");

    fireEvent.click(screen.getByRole("button", { name: "Connect my computer" }));
    expect(await screen.findByText("K7M-Q2X")).toBeTruthy();
    expect(screen.getByText(/Works once, for 9:5\d|Works once, for 10:00/)).toBeTruthy();
  });

  it("says plainly when nothing is connected and no agent is available yet", async () => {
    mockFetch((url) => (url.endsWith("/me/agents") ? { status: 200, body: { agents: [] } } : { status: 200, body: { platforms: [] } }));
    render(<YourComputers />);
    expect(await screen.findByText("No computer connected yet.")).toBeTruthy();
    expect(screen.getByText(/has not made the agent available here yet/)).toBeTruthy();
  });
});

describe("a computer's own speed", () => {
  it("is shown once it has done some work", async () => {
    const recent = { days: 30, completed: 4, handedBack: 0, foldx: { jobs: 4, medianMs: 9_400, medianResidues: 305 }, p2rank: null };
    mockFetch((url) => {
      if (url.endsWith("/me/agents")) return { status: 200, body: { agents: [{ ...AGENT, recent }] } };
      if (url.endsWith("/me/agent-downloads")) return { status: 200, body: { platforms: [] } };
      return { status: 404 };
    });
    render(<YourComputers />);
    expect(await screen.findByText("In the last 30 days it finished 4 of your jobs. FoldX took about 9 s (structures around 305 residues).")).toBeTruthy();
  });
});

describe("Learned memory limits", () => {
  it("lists what was learned, says when it is not applied yet, and forgets on confirmation", async () => {
    let ceilings = [
      { type: "foldx", hostClass: "arm64-emulated-2c-12g", residues: 1085, onServer: true },
      { type: "p2rank", hostClass: "agent/x64-native-8c-16g", residues: 3000, onServer: false },
    ];
    const fetchFn = mockFetch((url, init) => {
      if (url.endsWith("/admin/compute/ceilings") && init?.method === "DELETE") {
        ceilings = [];
        return { status: 200, body: { removed: 2 } };
      }
      if (url.endsWith("/admin/compute/ceilings")) return { status: 200, body: { enforced: false, ceilings } };
      return { status: 404 };
    });
    vi.stubGlobal("confirm", vi.fn(() => true));
    render(<ComputeLimits />);
    expect(await screen.findByText(/on the shared server: a structure of 1,085 residues ran out of memory, so that size and larger would be refused there/)).toBeTruthy();
    expect(screen.getByText(/members' computers with 8 cores and 16 GB of memory/)).toBeTruthy();
    expect(screen.getByText(/recorded but not applied yet/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Forget these limits" }));
    const outcome = await screen.findByText("The learned limits were forgotten.");
    await waitFor(() => expect(outcome.closest("[tabindex='-1']")).toBe(document.activeElement)); // focus is not lost
    expect(await screen.findByText(/None learned/)).toBeTruthy();
    expect(fetchFn.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "DELETE")).toBe(true);
  });
});

describe("Learned memory limits, edge cases", () => {
  it("says it could not load, rather than that nothing was learned", async () => {
    mockFetch(() => ({ status: 500, body: { error: { code: "X", message: "The server answered 500." } } }));
    render(<ComputeLimits />);
    expect(await screen.findByText(/The server answered 500/)).toBeTruthy();
    expect(screen.queryByText(/None learned/)).toBeNull();
  });

  it("describes a host class in plain words", () => {
    expect(describeHostClass({ hostClass: "arm64-emulated-2c-12g", onServer: true })).toBe("the shared server");
    expect(describeHostClass({ hostClass: "agent/x64-native-8c-16g", onServer: false })).toBe("members' computers with 8 cores and 16 GB of memory");
    expect(describeHostClass({ hostClass: "arm64-emulated-4c-24g", onServer: false })).toBe("servers with 4 cores and 24 GB of memory (running FoldX under emulation)");
    expect(describeHostClass({ hostClass: "agent/odd", onServer: false })).toBe("members' computers of class agent/odd");
  });
});

describe("FoldX for the team", () => {
  it("cannot share a zip until the licence is confirmed, then sends the confirmation header", async () => {
    const calls = mockFetch((url, init) => {
      if (url.endsWith("/admin/tools/foldx") && (!init || init.method === undefined || init.method === "GET")) return { status: 200, body: { platforms: [] } };
      if (url.endsWith("/admin/tools/foldx/win32")) return { status: 201, body: { bundle: { platform: "win32", version: "1", expiry: "2027-01-31" } } };
      return { status: 404 };
    });
    render(<TeamFoldx />);
    expect(await screen.findByText(/Not shared/)).toBeTruthy();
    const share = screen.getByRole("button", { name: "Share with the team" }) as HTMLButtonElement;
    expect(share.disabled).toBe(true);

    const file = new File([new Uint8Array([0x50, 0x4b])], "foldx.zip", { type: "application/zip" });
    fireEvent.change(screen.getByLabelText("FoldX zip"), { target: { files: [file] } });
    expect(share.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(share.disabled).toBe(false);
    fireEvent.click(share);
    await waitFor(() => expect(screen.getByText(/FoldX for Windows is shared; this build works until 2027-01-31/)).toBeTruthy());
    const put = calls.mock.calls.find(([u]) => String(u).endsWith("/admin/tools/foldx/win32"))!;
    expect((put[1]!.headers as Record<string, string>)["X-Foldx-Licence-Confirmed"]).toBe("yes");
  });
});
