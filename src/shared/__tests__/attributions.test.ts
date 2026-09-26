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

/** Strips the cosmetic parts of a host so the two sets can be compared as strings. */
const normalizeHost = (host: string): string =>
  host.trim().toLowerCase().replace(/^www\./, "").replace(/\.$/, "");

/**
 * Every host the server can actually reach, from the `https?://host` literals in its own
 * source. Test files are excluded deliberately: they carry fixture hosts (a placeholder
 * sidecar URL) that no request ever goes to.
 */
function collectOutboundHosts(): Set<string> {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) files.push(full);
    }
  };
  walk(path.join(REPO_ROOT, "server"));
  files.push(path.join(REPO_ROOT, "server.ts"));

  const hosts = new Set<string>();
  for (const file of files) {
    const source = fs.readFileSync(file, "utf-8");
    for (const match of source.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
      hosts.add(normalizeHost(match[1]));
    }
  }
  return hosts;
}

/**
 * Every host the About page discloses. A row may name several, separated by the middot the
 * page renders, so the field is split rather than treated as one host.
 */
function collectDisclosedHosts(): Set<string> {
  const hosts = new Set<string>();
  for (const row of QUERY_TRANSMISSION.hosts) {
    for (const part of row.host.split("·")) {
      const host = normalizeHost(part);
      // A row may name a path, e.g. "deepmind.google.com/science/alphagenome".
      if (host) hosts.add(host.split("/")[0]);
    }
  }
  return hosts;
}

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

  it("discloses every host the server actually calls, and invents none", () => {
    /**
     * Why this exists: the first version of the disclosure named `api.biohub.ai`, a host the
     * code never contacts, while omitting `forge.evolutionaryscale.ai` and `biohub.ai`, which
     * it does. A privacy disclosure with a typo in it is worse than none, and nothing caught
     * it — the page was written by hand and verified by reading, not by comparing against the
     * code. This compares the two directly, in both directions.
     */
    const called = collectOutboundHosts();
    const disclosed = collectDisclosedHosts();

    const allowlist: Record<string, string> = {
      // Served to the browser on the /docs page only; no variant data ever reaches it.
      "cdn.jsdelivr.net": "API-reference stylesheet/script for the docs page, not a data path",
      // Outbound only as a citation or repository link. Nothing is ever sent to them.
      "github.com": "repository and documentation links",
      "biosig.lab.uq.edu.au": "citation links for DynaMut2 and DDMut",
      "zenodo.org": "citation link for the RaSP dataset",
      "consurf.tau.ac.il": "the ConSurf project page; the API host is disclosed separately",
      "europepmc.org": "article links; the search API is www.ebi.ac.uk",
      "ncbi.nlm.nih.gov": "article links; the API is eutils.ncbi.nlm.nih.gov",
      "pubmed.ncbi.nlm.nih.gov": "article links only",
      // Built by the @google/genai SDK rather than written here, so it cannot appear as a
      // literal in this repository. It IS called, on every narrative request.
      "generativelanguage.googleapis.com":
        "the Gemini endpoint; the URL is constructed inside @google/genai, not in this repo",
      // This deployment's own public origin, listed in the CORS allowlist. It is not called
      // by the server; it is where the server is reached.
      "missense-resolve.duckdns.org": "this workspace's own public origin, not an outbound call"
    };
    const localHosts = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);

    const undisclosed = [...called].filter(
      (host) => !disclosed.has(host) && !allowlist[host] && !localHosts.has(host)
    );
    expect(
      undisclosed,
      undisclosed.length
        ? `The server calls these hosts but the About page does not disclose them:\n` +
          undisclosed.map((h) => `  ${h}`).join("\n") +
          `\nAdd them to QUERY_TRANSMISSION, or record why in the allowlist above.`
        : ""
    ).toEqual([]);

    // The other direction: a disclosed host that nothing calls is either a typo or a stale
    // claim, and a reader cannot tell which.
    const invented = [...disclosed].filter(
      (host) => !called.has(host) && !allowlist[host] && !localHosts.has(host)
    );
    expect(
      invented,
      invented.length
        ? `The About page discloses hosts the server never calls:\n` +
          invented.map((h) => `  ${h}`).join("\n") +
          `\nA typo here is indistinguishable from a real host to a reader.`
        : ""
    ).toEqual([]);
  });

  it("offers a copyable citation for this workspace, not just for its dependencies", () => {
    expect(WORKSPACE_CITATION.plain).toMatch(/https?:\/\//);
    expect(WORKSPACE_CITATION.bibtex).toMatch(/^@software\{/);
  });
});
