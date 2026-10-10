// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { SettingsProvider } from "../../../context/SettingsContext";
import { AccountProvider } from "../../../context/AccountContext";
import { AccountGate } from "../AccountGate";
import { AccountMenu } from "../AccountMenu";
import type { SessionInfo } from "../../../api/accountApi";

/**
 * What the reader sees before the app mounts, driven by `/auth/session` and the URL — the decisions
 * `AccountGate` exists to make, and the ones that would lock a team out or leak a token if wrong.
 */

const ADMIN = {
  id: "u1",
  email: "owner@lab.example",
  displayName: "Huthaifa Haj Ahmad",
  role: "admin" as const,
  status: "active" as const,
  shareResults: true,
  placementPref: "auto" as const,
  createdAt: 0,
  lastLoginAt: null,
};

function session(over: Partial<SessionInfo>): SessionInfo {
  return { mode: "legacy", provider: "password", user: null, setupAvailable: false, accountsExist: false, ...over };
}

type Handler = (url: string, init?: RequestInit) => { status: number; body?: unknown; headers?: Record<string, string> };

function mockFetch(handler: Handler) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const r = handler(url, init);
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status, headers: r.headers });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function renderGate() {
  return render(
    <SettingsProvider>
      <AccountProvider>
        <AccountGate>
          <div>
            <p>THE APP</p>
            <AccountMenu />
          </div>
        </AccountGate>
      </AccountProvider>
    </SettingsProvider>,
  );
}

beforeEach(() => {
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AccountGate", () => {
  it("legacy with no accounts: the app, and no account chrome at all", async () => {
    mockFetch(() => ({ status: 200, body: session({}) }));
    renderGate();
    await screen.findByText("THE APP");
    expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
  });

  it("an older server without account routes: the app, exactly as before", async () => {
    mockFetch(() => ({ status: 404, body: { error: { code: "NOT_FOUND", message: "nope" } } }));
    renderGate();
    await screen.findByText("THE APP");
    expect(screen.queryByRole("button", { name: /sign in/i })).toBeNull();
  });

  it("accounts mode, signed out: a full-page sign-in instead of the app", async () => {
    mockFetch(() => ({ status: 200, body: session({ mode: "accounts", accountsExist: true }) }));
    renderGate();
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeTruthy();
    expect(screen.getByText(/asks everyone to sign in/)).toBeTruthy();
    expect(screen.queryByText("THE APP")).toBeNull();
  });

  it("hybrid, signed out: the app with a Sign in button that opens a dismissable dialog", async () => {
    mockFetch(() => ({ status: 200, body: session({ mode: "hybrid", accountsExist: true }) }));
    renderGate();
    fireEvent.click(await screen.findByRole("button", { name: "Sign in" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText("THE APP")).toBeTruthy();
  });

  it("a locked account shows a countdown and disables the button", async () => {
    mockFetch((url) =>
      url.endsWith("/auth/login")
        ? { status: 429, body: { error: { code: "TOO_MANY_ATTEMPTS", message: "Too many attempts." } }, headers: { "Retry-After": "900" } }
        : { status: 200, body: session({ mode: "accounts", accountsExist: true }) },
    );
    renderGate();
    await screen.findByRole("heading", { name: "Sign in" });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.org" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "whatever-password" } });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
    expect(await screen.findByText(/You can try again in/)).toBeTruthy();
    expect(screen.getByText("15:00")).toBeTruthy();
    expect((screen.getByRole("button", { name: /sign in/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("an invite link opens the invite page and leaves no token in the address bar", async () => {
    window.history.replaceState(null, "", "/#invite=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG");
    mockFetch((url) =>
      url.endsWith("/auth/invite-info") ? { status: 200, body: { email: "new@lab.org", role: "member" } } : { status: 200, body: session({ mode: "hybrid", accountsExist: true }) },
    );
    renderGate();
    expect(await screen.findByText("Join the workspace")).toBeTruthy();
    expect(screen.getByText("new@lab.org")).toBeTruthy();
    expect(window.location.hash).toBe("");
  });

  it("a used invite says so, with the way forward, instead of a form that cannot work", async () => {
    window.history.replaceState(null, "", "/#invite=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG");
    mockFetch((url) =>
      url.endsWith("/auth/invite-info")
        ? { status: 404, body: { error: { code: "INVITE_INVALID", message: "expired" } } }
        : { status: 200, body: session({ mode: "hybrid", accountsExist: true }) },
    );
    renderGate();
    expect(await screen.findByText("This invite link no longer works")).toBeTruthy();
    expect(screen.getByText(/Ask your workspace admin for a new link/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Go to the workspace" }));
    expect(await screen.findByText("THE APP")).toBeTruthy();
  });

  it("/setup after the first admin exists explains that setup is closed", async () => {
    window.history.replaceState(null, "", "/setup");
    mockFetch(() => ({ status: 200, body: session({ mode: "legacy", accountsExist: true }) }));
    renderGate();
    expect(await screen.findByText("Setup is already complete")).toBeTruthy();
  });
});

describe("AccountMenu", () => {
  it("shows the signed-in reader's initials and an accessible menu with Team for admins", async () => {
    mockFetch(() => ({ status: 200, body: session({ mode: "hybrid", accountsExist: true, user: ADMIN }) }));
    renderGate();
    const button = await screen.findByRole("button", { name: "Account: Huthaifa Haj Ahmad" });
    expect(button.textContent).toBe("HA");
    await act(async () => fireEvent.click(button));
    const items = screen.getAllByRole("menuitem").map((el) => el.textContent?.trim());
    expect(items).toEqual(["Account & preferences", "Team", "Sign out"]);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(document.activeElement).toBe(button);
  });

  it("a member's menu has no Team entry", async () => {
    mockFetch(() => ({ status: 200, body: session({ mode: "hybrid", accountsExist: true, user: { ...ADMIN, role: "member" } }) }));
    renderGate();
    // Find first, then click inside act: a findBy awaited INSIDE act() cannot see the render act holds back.
    const button = await screen.findByRole("button", { name: /^Account:/ });
    await act(async () => fireEvent.click(button));
    expect(screen.getAllByRole("menuitem").map((el) => el.textContent?.trim())).toEqual(["Account & preferences", "Sign out"]);
  });
});
