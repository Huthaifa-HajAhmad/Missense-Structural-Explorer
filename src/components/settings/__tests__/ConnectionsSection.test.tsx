// @vitest-environment jsdom
/**
 * Settings → Connections: the notes that belong to one token (saved-to-account strip, last request)
 * stay in that token's own row group, so the card's hairlines fall between token fields and never
 * across a note's text.
 */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { account, api, diag } = vi.hoisted(() => ({
  diag: { diagnostics: null, loading: false, lastCheckFailed: false, refresh: () => {} } as Record<string, unknown>,
  account: { user: null as null | { id: string } },
  api: {
    savedSecrets: vi.fn(),
    saveSecret: vi.fn(),
    removeSecret: vi.fn(),
  },
}));
vi.mock("../../../context/AccountContext", () => ({ useOptionalAccount: () => account }));
vi.mock("../../../api/accountApi", async importOriginal => ({
  ...(await importOriginal<typeof import("../../../api/accountApi")>()),
  accountApi: api,
}));
vi.mock("../../../hooks/useApiConnections", () => {
  const quiet = { testing: false, status: null };
  return {
    useApiConnections: () => ({
      tests: { alphagenome: quiet, tamarind: quiet },
      runTest: vi.fn(),
      linking: false,
      linkError: null,
      linkGeminiKey: vi.fn(),
      clearLinkError: vi.fn(),
    }),
  };
});
vi.mock("../../../hooks/useDiagnostics", () => ({
  useDiagnostics: () => diag,
}));

import { ConnectionsSection } from "../sections/ConnectionsSection";
import { SettingsProvider } from "../../../context/SettingsContext";
import { noteCredentialHeader } from "../../../api/authSession";
import { encodeCredentialUse } from "../../../shared/credentials";

function renderConnections() {
  return render(
    <SettingsProvider>
      <ConnectionsSection />
    </SettingsProvider>
  );
}

beforeEach(() => {
  Object.assign(diag, { diagnostics: null, lastCheckFailed: false, loading: false });
  localStorage.clear();
  sessionStorage.clear();
  account.user = { id: "u1" };
  api.savedSecrets.mockResolvedValue({
    available: true,
    secrets: [
      { kind: "tamarind", hint: "PCMk", updatedAt: 1, readable: true },
    ],
  });
  vi.stubGlobal("matchMedia", vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })));
  global.fetch = vi.fn().mockRejectedValue(new Error("offline")) as unknown as typeof fetch;
});

describe("ConnectionsSection — each key says how its service is doing", () => {
  const statusOf = (id: string) => screen.getByTestId(`credential-status-${id}`).textContent ?? "";

  it("does not repeat the status panel's list of every service", () => {
    renderConnections();
    expect(document.querySelector("[data-service-id]")).toBeNull();
    expect(screen.queryByText(/FoldX/)).toBeNull();
  });

  it("puts the state line inside its own key's row group", () => {
    renderConnections();
    for (const [id, title] of [["gemini", "Google Gemini API key"], ["alphagenome", "AlphaGenome Atlas API key"]]) {
      const field = document.querySelector(`[data-setting-title="${title}"]`)!;
      expect(screen.getByTestId(`credential-status-${id}`).parentElement).toBe(field.parentElement);
    }
  });

  it("says a key is needed when the server has none and none is typed here", () => {
    Object.assign(diag, {
      diagnostics: {
        foldxReady: true, geminiReady: false, modelServerReady: true,
        serviceHealth: { alphagenome: { healthy: false, latencyMs: 0, message: "no key", timestamp: "", keySource: "none" } }
      }
    });
    renderConnections();
    expect(statusOf("alphagenome")).toContain("Not configured");
  });

  it("names a Gemini key typed in this browser, even when the server check failed", () => {
    Object.assign(diag, { lastCheckFailed: true });
    localStorage.setItem("missenseUserSettings", "{}");
    sessionStorage.setItem("missenseTransientCredentials", JSON.stringify({ geminiApiKey: "AIza-test" }));
    renderConnections();
    expect(statusOf("gemini")).toContain("Configured · key stored in this browser");
  });

  it("says 'Checking' while the first check runs", () => {
    Object.assign(diag, { loading: true });
    renderConnections();
    expect(statusOf("alphagenome")).toContain("Checking");
  });
});

describe("ConnectionsSection token rows", () => {
  it("keeps a token's account strip inside that token's row group", async () => {
    renderConnections();

    const saved = await screen.findByText(/Saved to your account \(ends …PCMk\)/);
    const strip = saved.closest("[data-testid='account-token-tamarind']");
    const field = document.querySelector('[data-setting-title="Tamarind Bio API key"]');

    expect(strip).not.toBeNull();
    expect(field).not.toBeNull();
    // Same group: the card's divider cannot land between the field and its own note.
    expect(strip!.parentElement).toBe(field!.parentElement);
    // And that group is a direct child of the card, so the hairline is drawn after the note.
    expect(strip!.parentElement!.parentElement).toHaveClass("settings-card");
    expect(strip!.parentElement).toHaveClass("settings-token-field");

    // Biohub was retired with ESMFold: no field, no account strip.
    expect(document.querySelector('[data-setting-title="EvolutionaryScale (Forge) token"]')).toBeNull();
    expect(document.querySelector("[data-testid='account-token-biohub']")).toBeNull();
  });

  it("keeps the last-request line with the token it belongs to", async () => {
    noteCredentialHeader(encodeCredentialUse([{ kind: "tamarind", source: "team" }]));
    renderConnections();

    const field = document.querySelector('[data-setting-title="Tamarind Bio API key"]')!;
    const lastUse = await screen.findByTestId("last-credential-use-tamarind");
    const strip = await screen.findByTestId("account-token-tamarind");

    expect(field.parentElement).toHaveClass("settings-token-field");
    expect(lastUse.parentElement).toBe(field.parentElement);
    expect(strip.parentElement).toBe(field.parentElement);
    // Nothing about this token leaks into another token's group.
    expect(
      document.querySelector('[data-setting-title="AlphaGenome Atlas API key"]')!.parentElement
    ).not.toBe(field.parentElement);
  });
});

describe("ConnectionsSection optional providers", () => {
  const sectionOf = (title: string) =>
    document.querySelector(`[data-setting-title="${title}"]`)!.closest("section.settings-group");

  it("keeps Tamarind apart from the credentials most people need, and offers no Hugging Face key", async () => {
    renderConnections();
    await screen.findByText(/Saved to your account \(ends …PCMk\)/);

    const optional = document.querySelector('section[data-setting-title="Optional providers"]');
    expect(optional).not.toBeNull();
    expect(sectionOf("Tamarind Bio API key")).toBe(optional);
    expect(sectionOf("AlphaGenome Atlas API key")).not.toBe(optional);
    expect(screen.queryByText(/Hugging Face/)).toBeNull();
  });

  it("says when the optional key is actually used", () => {
    renderConnections();
    expect(screen.getByText(/only when the lab's own ThermoMPNN service does not answer/i)).toBeTruthy();
  });
});
