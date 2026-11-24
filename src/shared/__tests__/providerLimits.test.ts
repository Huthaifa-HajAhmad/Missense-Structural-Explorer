import { describe, it, expect } from "vitest";
import { providerLabelForHost, rateLimitedSentence, retryAfterSeconds } from "../providerLimits.ts";

describe("providerLimits — the words for a provider that is limiting the team (WP-I3)", () => {
  it("says the provider is limiting requests and when it retries, never that it is down", () => {
    const sentence = rateLimitedSentence("DDMut-PPI", 8);
    expect(sentence).toBe("DDMut-PPI is limiting requests; retrying in 8 s.");
    expect(sentence).not.toMatch(/down|unavailable|error/i);
  });

  it("never prints 0 s or a fraction", () => {
    expect(rateLimitedSentence("DDMut-PPI", 0)).toBe("DDMut-PPI is limiting requests; retrying in 1 s.");
    expect(rateLimitedSentence("DDMut-PPI", 2.2)).toBe("DDMut-PPI is limiting requests; retrying in 3 s.");
    expect(retryAfterSeconds(1)).toBe(1);
    expect(retryAfterSeconds(4_001)).toBe(5);
  });

  it("names known hosts and falls back to the hostname", () => {
    expect(providerLabelForHost("biosig.lab.uq.edu.au")).toBe("UQ BioSig (DDMut-PPI)");
    expect(providerLabelForHost("REST.ENSEMBL.ORG")).toBe("Ensembl");
    expect(providerLabelForHost("example.org")).toBe("example.org");
  });
});
