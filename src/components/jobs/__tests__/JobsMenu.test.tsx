// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { SettingsProvider } from "../../../context/SettingsContext";
import { AccountProvider } from "../../../context/AccountContext";
import { JobsMenu } from "../JobsMenu";
import type { SessionInfo } from "../../../api/accountApi";
import type { JobSummary } from "../../../api/jobsApi";
import { JOBS_CHANGED_EVENT } from "../../../api/jobsApi";

/**
 * The header's "My jobs" control: shown only to a signed-in person, a badge for what is still active,
 * a panel that says where each job stands, and a cancel that tells the truth about shared jobs.
 */

const USER = {
  id: "u1", email: "me@lab.org", displayName: "Me Myself", role: "member" as const, status: "active" as const,
  shareResults: true, placementPref: "auto" as const, createdAt: 0, lastLoginAt: null,
};

const NOW = Date.now();
function job(over: Partial<JobSummary>): JobSummary {
  return {
    id: "j", type: "foldx", status: "queued", createdAt: NOW - 60_000, startedAt: null, completedAt: null,
    ownerId: "u1", mine: true, queuedAhead: 2, etaMs: 4 * 60_000, elapsedMs: null, label: "R175H", watchers: 1, ...over,
  };
}

function mockServer(opts: { session: Partial<SessionInfo>; jobs: JobSummary[]; cancel?: unknown }) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url.endsWith("/auth/session")) {
      return new Response(JSON.stringify({ mode: "hybrid", provider: "password", user: null, setupAvailable: false, accountsExist: true, ...opts.session }), { status: 200 });
    }
    if (url.endsWith("/my-jobs")) return new Response(JSON.stringify({ jobs: opts.jobs }), { status: 200 });
    if (url.includes("/cancel")) return new Response(JSON.stringify(opts.cancel ?? { cancelled: true, stillRunningForOthers: false, remainingWatchers: 0 }), { status: 200 });
    return Promise.reject(new Error("offline"));
  }));
  return calls;
}

function renderMenu() {
  return render(
    <SettingsProvider>
      <AccountProvider>
        <JobsMenu />
      </AccountProvider>
    </SettingsProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("matchMedia", vi.fn().mockImplementation((q: string) => ({
    matches: false, media: q, onchange: null, addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  })));
});
afterEach(() => vi.unstubAllGlobals());

describe("JobsMenu", () => {
  it("is absent without a signed-in person", async () => {
    const calls = mockServer({ session: { user: null }, jobs: [] });
    renderMenu();
    // Wait for the session to have RESOLVED first: sleeping a fixed 50 ms and then asserting absence
    // passes when the answer is merely slow, which is not the same as the guard hiding the control.
    await waitFor(() => expect(calls).toContain("GET /api/v1/auth/session"));
    await waitFor(() => expect(screen.queryByRole("button", { name: /My jobs/ })).toBeNull());
    expect(calls.some((c) => c.endsWith("/my-jobs"))).toBe(false);
  });

  it("badges the active jobs and lists where each stands", async () => {
    mockServer({
      session: { user: USER },
      jobs: [
        job({ id: "a", label: "R175H" }),
        job({ id: "b", label: "G12D", status: "running", startedAt: NOW - 5 * 60_000, queuedAhead: null, etaMs: null }),
        job({ id: "c", label: "V600E", status: "failed", error: "Cancelled.", completedAt: NOW - 3 * 60_000 }),
      ],
    });
    renderMenu();
    const button = await screen.findByRole("button", { name: "My jobs (2 active)" }, { timeout: 5000 });
    await act(async () => fireEvent.click(button));
    const dialog = await screen.findByRole("dialog", { name: "My jobs" }, { timeout: 5000 });
    expect(dialog.textContent).toMatch(/2 jobs ahead · starts in about 4 min/);
    expect(dialog.textContent).toMatch(/Running for 5 min/);
    expect(screen.getByText("Cancelled")).toBeTruthy(); // the chip, not "Failed"
    expect(screen.getAllByRole("button", { name: /^Cancel / })).toHaveLength(2); // only active rows
  });

  it("cancelling a shared job says it keeps running for the other person", async () => {
    const calls = mockServer({
      session: { user: USER },
      jobs: [job({ id: "shared-1", mine: false, ownerId: null, watchers: 2 })],
      cancel: { cancelled: false, stillRunningForOthers: true, remainingWatchers: 1 },
    });
    renderMenu();
    // Find first, then click inside act: a findBy awaited INSIDE act() cannot see the render act holds back.
    const button = await screen.findByRole("button", { name: /My jobs/ }, { timeout: 5000 });
    await act(async () => fireEvent.click(button));
    expect(await screen.findByText(/Shared with someone who asked for the same result/)).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Cancel R175H" })));
    await waitFor(() => expect(screen.getAllByText(/keeps running for one other person/).length).toBeGreaterThan(0));
    expect(calls).toContain("POST /api/v1/jobs/shared-1/cancel");
  });

  it("tells the OWNER of a shared job that stopping it only removes their interest", async () => {
    // The owner is a watcher too, so `mine: true` with two watchers is shared work: the row must warn
    // before the click, not afterwards, and the tooltip must not promise to stop it.
    mockServer({
      session: { user: USER },
      jobs: [job({ id: "shared-2", mine: true, watchers: 2 })],
    });
    renderMenu();
    const button = await screen.findByRole("button", { name: /My jobs/ }, { timeout: 5000 });
    await act(async () => fireEvent.click(button));
    expect(await screen.findByText(/Shared with someone who asked for the same result/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel R175H" }).getAttribute("title")).toBe("Remove from my jobs");
  });

  it("renders a failed job's reason in plain words, with the server text kept for whoever needs it", async () => {
    mockServer({
      session: { user: USER },
      jobs: [job({
        id: "f1", status: "failed", completedAt: NOW - 60_000, queuedAhead: null, etaMs: null,
        error: "FoldX binary not found or not executable at: /app/tools/foldx_linux/FoldX",
      })],
    });
    renderMenu();
    const button = await screen.findByRole("button", { name: /My jobs/ }, { timeout: 5000 });
    await act(async () => fireEvent.click(button));
    const plain = await screen.findByText(/not installed on the server that ran it/);
    expect(plain.getAttribute("title")).toContain("/app/tools/foldx_linux/FoldX");
  });

  it("refreshes when a job is submitted elsewhere in the app", async () => {
    // The badge's other triggers (mount, window focus, its own interval) all miss a job started in
    // this window while nothing was active yet.
    const calls = mockServer({ session: { user: USER }, jobs: [] });
    renderMenu();
    await screen.findByRole("button", { name: "My jobs" }, { timeout: 5000 });
    const before = calls.filter((c) => c.endsWith("/my-jobs")).length;
    await act(async () => {
      window.dispatchEvent(new Event(JOBS_CHANGED_EVENT));
    });
    await waitFor(() => expect(calls.filter((c) => c.endsWith("/my-jobs")).length).toBeGreaterThan(before));
  });

  it("Escape closes the panel and returns focus to the button", async () => {
    mockServer({ session: { user: USER }, jobs: [] });
    renderMenu();
    const button = await screen.findByRole("button", { name: "My jobs" }, { timeout: 5000 });
    await act(async () => fireEvent.click(button));
    const dialog = await screen.findByRole("dialog");
    expect(await screen.findByText(/No jobs yet/)).toBeTruthy();
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(button);
  });
});
