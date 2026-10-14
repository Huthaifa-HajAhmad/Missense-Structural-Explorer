/**
 * WP-I4: after a remote model result the reader is told whose token it ran on, or why it did not run.
 */
import { describe, expect, it } from "vitest";
import { CREDENTIAL_NOTICE_QUIET_MS, CREDENTIAL_REFUSAL_QUIET_MS, usesToAnnounce } from "../useCredentialUseNotice";
import { getLastCredentialUse, noteCredentialHeader, subscribeCredentialUse } from "../../api/authSession";
import {
  credentialUseSentence,
  encodeCredentialUse,
  parseCredentialUse,
  type CredentialUse,
} from "../../shared/credentials";

describe("X-MSE-Credentials", () => {
  it("round-trips one entry per kind and rejects junk", () => {
    const value = encodeCredentialUse([
      { kind: "biohub", source: "team" },
      { kind: "biohub", source: "own" },
      { kind: "huggingface", source: "none", refusal: "team-share-used" },
    ]);
    expect(parseCredentialUse(value)).toEqual([
      { kind: "biohub", source: "own" },
      { kind: "huggingface", source: "none", refusal: "team-share-used" },
    ]);
    expect(parseCredentialUse("nope")).toEqual([]);
    expect(parseCredentialUse('[{"kind":"openai","source":"own"},{"kind":"biohub","source":"stolen"},{"kind":"tamarind","source":"none","refusal":"x"}]')).toEqual([]);
    expect(parseCredentialUse(null)).toEqual([]);
  });

  it("reads as a plain sentence, and says nothing when there is nothing to say", () => {
    expect(credentialUseSentence({ kind: "biohub", source: "own" })).toBe("Biohub ran on your token.");
    expect(credentialUseSentence({ kind: "huggingface", source: "team" })).toMatch(
      /^Hugging Face ran on the team token\. Add your own in Settings → Connections/
    );
    expect(credentialUseSentence({ kind: "tamarind", source: "none", refusal: "team-share-used" })).toMatch(
      /^Tamarind was not run: you have used your share of the team token this hour\./
    );
    expect(credentialUseSentence({ kind: "biohub", source: "none", refusal: "team-token-off" })).toMatch(/does not lend its team token/);
    expect(credentialUseSentence({ kind: "biohub", source: "none" })).toBeNull();
  });
});

describe("usesToAnnounce", () => {
  const own: CredentialUse = { kind: "biohub", source: "own" };
  const refused: CredentialUse = { kind: "huggingface", source: "none", refusal: "team-share-used" };

  it("names each use once per quiet period, and repeats a refusal sooner", () => {
    const shown = new Map<string, number>();
    expect(usesToAnnounce([own, refused], shown, 0).map(a => a.use)).toEqual([own, refused]);
    expect(usesToAnnounce([own, refused], shown, 1_000)).toEqual([]);
    expect(usesToAnnounce([own, refused], shown, CREDENTIAL_REFUSAL_QUIET_MS).map(a => a.use)).toEqual([refused]);
    expect(usesToAnnounce([own], shown, CREDENTIAL_NOTICE_QUIET_MS).map(a => a.use)).toEqual([own]);
    // A different source for the same provider is news at once.
    expect(usesToAnnounce([{ kind: "biohub", source: "team" }], shown, CREDENTIAL_NOTICE_QUIET_MS + 1)).toHaveLength(1);
  });

  it("skips a use with nothing to say", () => {
    expect(usesToAnnounce([{ kind: "biohub", source: "none" }], new Map(), 0)).toEqual([]);
  });
});

describe("the client signal", () => {
  it("publishes the header's uses and keeps the latest per kind", () => {
    const seen: unknown[] = [];
    const off = subscribeCredentialUse(r => seen.push(r.uses));
    noteCredentialHeader(null);
    noteCredentialHeader(encodeCredentialUse([{ kind: "tamarind", source: "team" }]));
    off();
    expect(seen).toEqual([[{ kind: "tamarind", source: "team" }]]);
    expect(getLastCredentialUse().tamarind?.use).toEqual({ kind: "tamarind", source: "team" });
  });
});
