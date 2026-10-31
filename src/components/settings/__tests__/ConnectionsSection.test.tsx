// @vitest-environment jsdom
/**
 * Settings → Connections: the notes that belong to one token (saved-to-account strip, last request)
 * stay in that token's own row group, so the card's hairlines fall between token fields and never
 * across a note's text.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { account, api } = vi.hoisted(() => ({
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
      tests: { biohub: quiet, hf: quiet, alphagenome: quiet, tamarind: quiet },
      runTest: vi.fn(),
      linking: false,
      linkError: null,
      linkGeminiKey: vi.fn(),
      clearLinkError: vi.fn(),
    }),
  };
});
vi.mock("../../../hooks/useDiagnostics", () => ({
  useDiagnostics: () => ({ diagnostics: null, loading: false }),
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
  localStorage.clear();
  sessionStorage.clear();
  account.user = { id: "u1" };
  api.savedSecrets.mockResolvedValue({
    available: true,
    secrets: [
      { kind: "biohub", hint: "wvae", updatedAt: 1, readable: true },
      { kind: "huggingface", hint: "PCMk", updatedAt: 1, readable: true },
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

describe("ConnectionsSection token rows", () => {
  it("keeps a token's account strip inside that token's row group", async () => {
    renderConnections();

    const saved = await screen.findByText(/Saved to your account \(ends …wvae\)/);
    const strip = saved.closest("[data-testid='account-token-biohub']");
    const field = document.querySelector('[data-setting-title="EvolutionaryScale (Forge) token"]');

    expect(strip).not.toBeNull();
    expect(field).not.toBeNull();
    // Same group: the card's divider cannot land between the field and its own note.
    expect(strip!.parentElement).toBe(field!.parentElement);
    // And that group is a direct child of the card, so the hairline is drawn after the note.
    expect(strip!.parentElement!.parentElement).toHaveClass("settings-card");
    expect(strip!.parentElement).toHaveClass("settings-token-field");

    // The note for one token never sits under a different token's field.
    expect(field!.parentElement).not.toBe(
      document.querySelector('[data-setting-title="Hugging Face access token"]')!.parentElement
    );
  });

  it("keeps the last-request line with the token it belongs to", async () => {
    noteCredentialHeader(encodeCredentialUse([{ kind: "huggingface", source: "team" }]));
    renderConnections();

    const field = document.querySelector('[data-setting-title="Hugging Face access token"]')!;
    const lastUse = await screen.findByTestId("last-credential-use-huggingface");
    const strip = await screen.findByTestId("account-token-huggingface");

    expect(field.parentElement).toHaveClass("settings-token-field");
    expect(lastUse.parentElement).toBe(field.parentElement);
    expect(strip.parentElement).toBe(field.parentElement);
    // Nothing about this token leaks into another token's group.
    expect(
      document.querySelector('[data-setting-title="EvolutionaryScale (Forge) token"]')!.parentElement
    ).not.toBe(field.parentElement);
  });
});
