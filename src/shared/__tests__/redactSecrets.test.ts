import { describe, expect, it } from "vitest";
import { redactSecrets, redactRequestBody } from "../redactSecrets";

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

describe('diagnostic request body capture', () => {
  it('redacts JSON and form bodies, including encoded keys and duplicate fields', () => {
    expect(redactRequestBody(JSON.stringify({ apiKey: 'secret-json', variant: 'p.Asp116Gly' }))).toEqual({ apiKey: '[redacted]', variant: 'p.Asp116Gly' });
    const encoded = redactRequestBody('%61pi%5Fkey=secret-form&token=a&token=b&gene=NAE1&gene=PTEN') as string;
    const fields = new URLSearchParams(encoded);
    expect(fields.get('api_key')).toBe('[redacted]');
    expect(fields.getAll('token')).toEqual(['[redacted]', '[redacted]']);
    expect(fields.getAll('gene')).toEqual(['NAE1', 'PTEN']);
    expect(redactRequestBody(new URLSearchParams({ password: 'private', gene: 'NAE1' }))).toBe('password=%5Bredacted%5D&gene=NAE1');
    expect(encoded).not.toContain('secret-form');
  });
  it('omits unsupported and malformed bodies instead of exporting their secrets verbatim', () => {
    for (const body of ['api_key: secret-plain', '{"apiKey":"secret-broken"', '"api_key=secret-string"', 'x'.repeat(4097)]) {
      expect(redactRequestBody(body)).toBeUndefined();
    }
    expect(redactRequestBody(new FormData())).toBeUndefined();
  });
});
