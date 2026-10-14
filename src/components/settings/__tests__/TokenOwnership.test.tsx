// @vitest-environment jsdom
/**
 * WP-I4 / I4b in Settings → Connections: saving a token to the account, the saved state, and the
 * "last request" line.
 */
import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { account, api } = vi.hoisted(() => ({
  account: { user: null as null | { id: string } },
  api: { savedSecrets: vi.fn(), saveSecret: vi.fn(), removeSecret: vi.fn() },
}));
vi.mock("../../../context/AccountContext", () => ({ useOptionalAccount: () => account }));
vi.mock("../../../api/accountApi", async importOriginal => ({
  ...(await importOriginal<typeof import("../../../api/accountApi")>()),
  accountApi: api,
}));

import { AccountTokenControls, LastCredentialUse, useSavedSecrets } from "../sections/TokenOwnership";
import { noteCredentialHeader } from "../../../api/authSession";
import { encodeCredentialUse } from "../../../shared/credentials";

function Harness({ browserToken, onClear = () => {} }: { browserToken: string; onClear?: () => void }) {
  const secrets = useSavedSecrets();
  return <AccountTokenControls kind="biohub" label="Biohub" browserToken={browserToken} clearBrowserToken={onClear} secrets={secrets} />;
}

beforeEach(() => {
  account.user = { id: "u1" };
  api.savedSecrets.mockResolvedValue({ available: true, secrets: [] });
  api.saveSecret.mockImplementation(async (kind: string, token: string) => ({ kind, hint: token.slice(-4), updatedAt: 1, readable: true }));
  api.removeSecret.mockResolvedValue(undefined);
});

afterEach(() => vi.clearAllMocks());

describe("AccountTokenControls", () => {
  it("shows nothing to a reader who is not signed in", () => {
    account.user = null;
    const { container } = render(<Harness browserToken="tok_typed_12345678" />);
    expect(container.textContent).toBe("");
    expect(api.savedSecrets).not.toHaveBeenCalled();
  });

  it("saves the typed token to the account and clears it from the browser", async () => {
    const onClear = vi.fn();
    render(<Harness browserToken="tok_typed_12345678" onClear={onClear} />);
    const button = await screen.findByRole("button", { name: /save/i });
    await act(async () => fireEvent.click(button));
    expect(api.saveSecret).toHaveBeenCalledWith("biohub", "tok_typed_12345678");
    expect(onClear).toHaveBeenCalled();
    expect(await screen.findByText(/Saved to your account \(ends …5678\)/)).toBeTruthy();
  });

  it("shows a saved token by its last four characters and removes it", async () => {
    api.savedSecrets.mockResolvedValue({ available: true, secrets: [{ kind: "biohub", hint: "wxyz", updatedAt: 1, readable: true }] });
    render(<Harness browserToken="" />);
    expect(await screen.findByText(/ends …wxyz/)).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /remove/i })));
    expect(api.removeSecret).toHaveBeenCalledWith("biohub");
    await waitFor(() => expect(screen.queryByText(/ends …wxyz/)).toBeNull());
  });

  it("asks for the token again when the server can no longer read it", async () => {
    api.savedSecrets.mockResolvedValue({ available: true, secrets: [{ kind: "biohub", hint: "wxyz", updatedAt: 1, readable: false }] });
    render(<Harness browserToken="" />);
    expect(await screen.findByText(/can no longer be read by the server; save it again/)).toBeTruthy();
  });

  it("offers no saving when the server cannot encrypt", async () => {
    api.savedSecrets.mockResolvedValue({ available: false, secrets: [] });
    render(<Harness browserToken="tok_typed_12345678" />);
    await waitFor(() => expect(api.savedSecrets).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
  });
});

describe("LastCredentialUse", () => {
  it("says whose token the last request ran on, or why it did not run", () => {
    render(<LastCredentialUse kind="huggingface" />);
    act(() => noteCredentialHeader(encodeCredentialUse([{ kind: "huggingface", source: "team" }])));
    expect(screen.getByTestId("last-credential-use-huggingface").textContent).toMatch(/ran on the team token/);
    act(() => noteCredentialHeader(encodeCredentialUse([{ kind: "huggingface", source: "none", refusal: "team-share-used" }])));
    expect(screen.getByTestId("last-credential-use-huggingface").textContent).toMatch(/your hourly share of the team token is used/);
  });
});
