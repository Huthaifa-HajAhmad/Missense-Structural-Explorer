// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { SettingsProvider } from "../../../context/SettingsContext";
import { AccountProvider } from "../../../context/AccountContext";
import { AccountMenu } from "../AccountMenu";
import type { SessionInfo } from "../../../api/accountApi";

const USER = {
  id: "u1",
  email: "researcher@lab.example",
  displayName: "Test Researcher",
  role: "admin" as const,
  status: "active" as const,
  shareResults: true,
  placementPref: "auto" as const,
  createdAt: 0,
  lastLoginAt: null,
};

function session(over: Partial<SessionInfo>): SessionInfo {
  return { mode: "accounts", provider: "password", user: USER, setupAvailable: false, accountsExist: true, ...over };
}

type Handler = (url: string, init?: RequestInit) => { status: number; body?: unknown; headers?: Record<string, string> };

function mockFetch(handler: Handler) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const r = handler(url, init);
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), {
      status: r.status,
      headers: r.headers ?? { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("AccountMenu", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("navigates with ArrowUp from the container to the last menuitem", async () => {
    mockFetch((url) => {
      if (url.includes("/auth/session")) return { status: 200, body: session({ mode: "hybrid", accountsExist: true, user: USER }) };
      return { status: 200, body: {} };
    });

    render(
      <SettingsProvider>
        <AccountProvider>
          <AccountMenu />
        </AccountProvider>
      </SettingsProvider>
    );

    const btn = await screen.findByRole("button", { name: /Account: Test Researcher/i });
    fireEvent.click(btn);

    const menu = await screen.findByRole("menu");
    const items = screen.getAllByRole("menuitem");
    expect(items.length).toBe(3);

    // Ensure document.activeElement is not a menu item (i = -1)
    items[0].blur();
    (document.activeElement as HTMLElement)?.blur?.();
    fireEvent.keyDown(menu, { key: "ArrowUp" });

    // Should focus the last item (Sign out)
    expect(document.activeElement).toBe(items[items.length - 1]);
  });

  it("handles sign-out failure gracefully without an unhandled promise rejection", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockFetch((url) => {
      if (url.includes("/auth/session")) return { status: 200, body: session({ mode: "hybrid", accountsExist: true, user: USER }) };
      if (url.includes("/auth/logout")) return { status: 500, body: { error: { message: "Internal error" } } };
      return { status: 200, body: {} };
    });

    render(
      <SettingsProvider>
        <AccountProvider>
          <AccountMenu />
        </AccountProvider>
      </SettingsProvider>
    );

    const btn = await screen.findByRole("button", { name: /Account: Test Researcher/i });
    fireEvent.click(btn);

    const signOutBtn = await screen.findByRole("menuitem", { name: /Sign out/i });
    fireEvent.click(signOutBtn);

    await waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith("[AccountMenu] Sign-out failed:", expect.any(Error));
    });

    errorSpy.mockRestore();
  });
});
