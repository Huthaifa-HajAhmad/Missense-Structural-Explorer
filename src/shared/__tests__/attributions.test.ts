import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  ATTRIBUTION_ENTRY_COUNT,
  ATTRIBUTION_GROUPS,
  QUERY_TRANSMISSION,
  WORKSPACE_CITATION
} from "../attributions";

/**
 * The credit roll's own integrity.
 *
 * An attribution page is only worth reading if every claim on it can be checked, and a claim
 * that cannot be checked is worse than no claim: a reader who finds one broken citation has
 * no reason to trust the rest. These assertions are all about that — the paths exist, the
 * ids are unique, the release is either a version or an honest "not pinned", and the
 * licence-bound tools keep their note.
 *
 * They assert the REGISTRY, not the page. A page that dropped an entry would still pass
 * here, and the component test covers that half.
 */

const REPO_ROOT = process.cwd();
const ALL_ENTRIES = ATTRIBUTION_GROUPS.flatMap((group) => group.entries);

describe("attribution registry", () => {
  it("names a provider and a role for every credited third party", () => {
    for (const entry of ALL_ENTRIES) {
      expect(entry.provider.trim(), `${entry.id} must name its provider`).not.toBe("");
      expect(entry.role.trim(), `${entry.id} must state what it is used for`).not.toBe("");
      expect(entry.name.trim(), `${entry.id} must have a name`).not.toBe("");
    }
  });

  it("records at least one call site per credit, and every one of those files exists", () => {
    // This is the assertion the page's whole claim rests on. A reader is told "called from
    // server/services/…"; if that file is gone, the credit is decoration.
    for (const entry of ALL_ENTRIES) {
      expect(entry.usedBy.length, `${entry.id} must record a call site`).toBeGreaterThan(0);
      for (const callSite of entry.usedBy) {
        expect(
          fs.existsSync(path.join(REPO_ROOT, callSite)),
          `${entry.id} names ${callSite}, which does not exist`
        ).toBe(true);
      }
    }
  });

  it("keeps credit ids unique, so an anchor can address exactly one entry", () => {
    const ids = ALL_ENTRIES.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps group anchors distinct and prefixed, so the contents rail cannot collide", () => {
    const ids = ATTRIBUTION_GROUPS.map((group) => group.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.startsWith("about-")).toBe(true);
  });

  it("states a release or states plainly that the code establishes none", () => {
    // `null` is the load-bearing value: it means "unpinned", which is a fact the reader is
    // entitled to, and it must never be replaced by a plausible-looking version.
    for (const entry of ALL_ENTRIES) {
      expect(
        entry.release === null || entry.release.trim().length > 0,
        `${entry.id} must have a release string or null, never an empty one`
      ).toBe(true);
    }
    // And at least one entry must actually exercise the unpinned branch, or the render path
    // for "not pinned by this workspace" is never covered by the roll itself.
    expect(ALL_ENTRIES.some((entry) => entry.release === null)).toBe(true);
  });

  it("gives every citation a resolvable link", () => {
    for (const entry of ALL_ENTRIES) {
      if (!entry.citation) continue;
      expect(
        /https?:\/\/\S+/.test(entry.citation),
        `${entry.id} cites without a link the reader could follow`
      ).toBe(true);
    }
  });

  it("links every credit somewhere", () => {
    for (const entry of ALL_ENTRIES) {
      expect(() => new URL(entry.url), `${entry.id} has an unparseable url`).not.toThrow();
    }
  });

  it("keeps the licence note on the licence-bound engine", () => {
    // FoldX cannot be redistributed and a deployment must supply its own binary. A future
    // tidy-up that dropped the note would turn a licensing constraint into a silent one.
    const foldx = ALL_ENTRIES.find((entry) => entry.id === "foldx");
    expect(foldx).toBeDefined();
    expect(foldx!.licence ?? "").toMatch(/licence-bound|license/i);
    expect(foldx!.licence ?? "").toMatch(/not redistributed/i);
  });

  it("derives its own count, so the figure the page shows cannot drift from the roll", () => {
    expect(ATTRIBUTION_ENTRY_COUNT).toBe(ALL_ENTRIES.length);
  });

  it("discloses what a query sends, per host", () => {
    expect(QUERY_TRANSMISSION.hosts.length).toBeGreaterThan(0);
    for (const host of QUERY_TRANSMISSION.hosts) {
      expect(host.host.trim(), "a transmission row must name its host").not.toBe("");
      expect(host.sent.trim(), `${host.host} must say what is sent to it`).not.toBe("");
    }
  });

  it("offers a copyable citation for this workspace, not just for its dependencies", () => {
    expect(WORKSPACE_CITATION.plain).toMatch(/https?:\/\//);
    expect(WORKSPACE_CITATION.bibtex).toMatch(/^@software\{/);
  });
});
