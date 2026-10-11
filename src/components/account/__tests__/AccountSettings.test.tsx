// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import SettingsDrawer from "../../settings/SettingsDrawer";
import { SettingsProvider, useSettings } from "../../../context/SettingsContext";
import { AccountProvider, useAccount } from "../../../context/AccountContext";
import { AccountGate } from "../AccountGate";
import { AccountMenu } from "../AccountMenu";
import type { AccountUser, SessionInfo } from "../../../api/accountApi";

/**
 * The account surfaces inside the real Settings drawer, and the keyboard contracts the review asked
 * for: who sees which section, what happens when a visible section disappears, and that a dialog or
 * menu on top never lets the drawer underneath act on Escape/Tab.
 */

const ADMIN: AccountUser = {
  id: "u1",
  email: "owner@lab.example",
  displayName: "Huthaifa Haj Ahmad",
  role: "admin",
  status: "active",
  shareResults: true,
  placementPref: "auto",
  createdAt: 0,
  lastLoginAt: null,
};

function mockSession(session: Partial<SessionInfo>) {
  const full: SessionInfo = { mode: "hybrid", provider: "password", user: null, setupAvailable: false, accountsExist: true, ...session };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return new Response(JSON.stringify(full), { status: 200 });
      if (url.endsWith("/admin/users")) return new Response(JSON.stringify({ users: [full.user] }), { status: 200 });
      if (url.endsWith("/admin/invites")) return new Response(JSON.stringify({ invites: [] }), { status: 200 });
      if (url.endsWith("/auth/me")) {
        return new Response(JSON.stringify({ user: full.user, mode: full.mode, quota: { queuedPerUser: 25, serverSecondsPerDay: null }, usage: { todaySeconds: 720, weekSeconds: 6000 } }), { status: 200 });
      }
      return Promise.reject(new Error("offline"));
    }),
  );
}

function Harness() {
  const { openSettingsTab } = useSettings();
  const account = useAccount();
  return (
    <>
      <button onClick={() => openSettingsTab("team")}>open-team</button>
      <button onClick={() => openSettingsTab("appearance")}>open-settings</button>
      <button onClick={() => account.openSignIn("requested")}>open-signin</button>
      <button onClick={() => account.user && account.setUser({ ...account.user, role: "member" })}>demote-me</button>
      <AccountMenu />
      <SettingsDrawer />
    </>
  );
}

function renderAll() {
  return render(
    <SettingsProvider>
      <AccountProvider>
        <AccountGate>
          <Harness />
        </AccountGate>
      </AccountProvider>
    </SettingsProvider>,
  );
}

const tabNames = () => screen.getAllByRole("tab").map((t) => t.textContent?.trim());

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe("Settings: account sections", () => {
  it("a member sees Account but not Team", async () => {
    mockSession({ user: { ...ADMIN, role: "member" } });
    renderAll();
    fireEvent.click(await screen.findByText("open-settings"));
    await screen.findByRole("dialog");
    expect(tabNames()).toContain("Account");
    expect(tabNames()).not.toContain("Team");
  });

  it("an admin sees both", async () => {
    mockSession({ user: ADMIN });
    renderAll();
    fireEvent.click(await screen.findByText("open-settings"));
    await screen.findByRole("dialog");
    expect(tabNames()).toEqual(expect.arrayContaining(["Account", "Team"]));
  });

  it("a server with no accounts shows neither", async () => {
    mockSession({ mode: "legacy", accountsExist: false });
    renderAll();
    fireEvent.click(await screen.findByText("open-settings"));
    await screen.findByRole("dialog");
    expect(tabNames()).not.toContain("Account");
  });

  it("when the open section disappears, another tab is selected and the panel stays labelled", async () => {
    mockSession({ user: ADMIN });
    renderAll();
    fireEvent.click(await screen.findByText("open-team"));
    await screen.findByText("Invite someone");
    // Demoting oneself hides Team while it is open.
    await act(async () => fireEvent.click(screen.getByText("demote-me")));
    await waitFor(() => expect(tabNames()).not.toContain("Team"));
    const selected = screen.getAllByRole("tab").filter((t) => t.getAttribute("aria-selected") === "true");
    expect(selected).toHaveLength(1);
    const labelledBy = screen.getByRole("tabpanel").getAttribute("aria-labelledby");
    expect(labelledBy && document.getElementById(labelledBy)).toBeTruthy();
  });
});

describe("Settings: server time used", () => {
  it("shows today's and the week's server time, and the limits that apply", async () => {
    mockSession({ user: { ...ADMIN, role: "member" } });
    renderAll();
    fireEvent.click(await screen.findByText("open-settings"));
    fireEvent.click(await screen.findByRole("tab", { name: "Account" }));
    expect(await screen.findByText("12 min")).toBeTruthy();
    expect(screen.getByText("1.7 h")).toBeTruthy();
    expect(screen.getByText("No daily limit on server time.")).toBeTruthy();
  });
});

describe("keyboard contracts", () => {
  it("Escape on the sign-in dialog closes only the dialog, not the Settings drawer under it", async () => {
    mockSession({ user: null });
    renderAll();
    fireEvent.click(await screen.findByText("open-settings"));
    const drawer = await screen.findByRole("dialog");
    fireEvent.click(screen.getByText("open-signin"));
    await waitFor(() => expect(screen.getAllByRole("dialog")).toHaveLength(2));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(screen.getAllByRole("dialog")).toHaveLength(1));
    expect(screen.getByRole("dialog")).toBe(drawer);
  });

  it("Tab in the account menu closes it and returns focus to the avatar", async () => {
    mockSession({ user: ADMIN });
    renderAll();
    const button = await screen.findByRole("button", { name: /^Account:/ });
    await act(async () => fireEvent.click(button));
    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "Tab" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(document.activeElement).toBe(button);
  });
});
