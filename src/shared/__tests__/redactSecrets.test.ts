import { describe, expect, it } from "vitest";
import { redactSecrets } from "../redactSecrets";

describe("redactSecrets", () => {
  it("masks credential fields and keeps everything else", () => {
    expect(redactSecrets({ apiKey: "AIzaSecret", apiUrl: "https://proxy.example", variant: "p.Asp116Gly" })).toEqual({
      apiKey: "[redacted]",
      apiUrl: "https://proxy.example",
      variant: "p.Asp116Gly",
    });
  });

  it("masks token, secret, password and authorization fields at any depth", () => {
    expect(
      redactSecrets({
        settings: { hfToken: "hf_x", biohubApiToken: "bh_x", alphagenomeApiKey: "k" },
        headers: { Authorization: "Bearer x", "x-client-secret": "s", password: "p" },
        list: [{ tamarindApiKey: "t" }],
      }),
    ).toEqual({
      settings: { hfToken: "[redacted]", biohubApiToken: "[redacted]", alphagenomeApiKey: "[redacted]" },
      headers: { Authorization: "[redacted]", "x-client-secret": "[redacted]", password: "[redacted]" },
      list: [{ tamarindApiKey: "[redacted]" }],
    });
  });

  it("leaves empty and non-string credential values and does not mutate its input", () => {
    const input = { apiKey: "", token: null, secret: 42, nested: { apiKey: "live" } };
    expect(redactSecrets(input)).toEqual({ apiKey: "", token: null, secret: 42, nested: { apiKey: "[redacted]" } });
    expect(input.nested.apiKey).toBe("live");
  });

  it("passes primitives through", () => {
    expect(redactSecrets("plain")).toBe("plain");
    expect(redactSecrets(null)).toBeNull();
    expect(redactSecrets(7)).toBe(7);
  });
});
