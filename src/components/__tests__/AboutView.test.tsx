// @vitest-environment jsdom
/**
 * AboutView — the page that carries the credit roll.
 *
 * The registry test holds the DATA honest; this holds the PAGE honest about it. Three things
 * can go wrong here that no data assertion would catch, and each is asserted below:
 *
 *   • a contents entry pointing at an anchor that no longer exists — a dead link in the one
 *     navigation aid a page this long has;
 *   • a group or a credit silently not rendering, which is indistinguishable from a source
 *     having been dropped from the workspace;
 *   • the "unpinned release" branch disappearing, which would make an unpinned source look
 *     like a pinned one.
 */
import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ATTRIBUTION_GROUPS } from "../../shared/attributions";
import { PROVENANCE_MODEL_REVISIONS } from "../../shared/provenance";

const openSettingsTab = vi.fn();

vi.mock("../../context/SettingsContext", () => ({
  useSettings: () => ({ openSettingsTab })
}));

vi.mock("../../hooks/useDiagnostics", () => ({
  useDiagnostics: () => ({ version: { version: "1.0.0", env: "test" } })
}));

// Imported after the mocks so the component picks them up.
import AboutView from "../AboutView";

function renderPage() {
  return render(<AboutView />);
}

describe("AboutView — attribution and acknowledgments", () => {
  beforeEach(() => {
    openSettingsTab.mockClear();
  });

  it("renders every credit group, with its count", () => {
    renderPage();
    for (const group of ATTRIBUTION_GROUPS) {
      const heading = screen.getByRole("heading", { name: new RegExp(group.title, "i") });
      expect(heading).toBeTruthy();
      expect(within(heading).getByText(String(group.entries.length))).toBeTruthy();
    }
  });

  it("renders every credited source, and each one states its release or says it is unpinned", () => {
    renderPage();
    const entries = ATTRIBUTION_GROUPS.flatMap((group) => group.entries);
    for (const entry of entries) {
      const row = document.getElementById(`credit-${entry.id}`);
      expect(row, `${entry.id} did not render`).not.toBeNull();
      if (entry.release === null) {
        expect(row!.textContent).toMatch(/not pinned by this workspace/i);
      } else {
        expect(row!.textContent).toContain(entry.release);
      }
    }
    // The unpinned branch has to actually be exercised by the roll, or the assertion above
    // would pass on a registry where everything claims a version.
    expect(entries.some((entry) => entry.release === null)).toBe(true);
  });

  it("points every contents entry at an anchor that exists", () => {
    renderPage();
    const tocLinks = Array.from(
      document.querySelectorAll<HTMLAnchorElement>(".about-toc-link")
    );
    expect(tocLinks.length).toBeGreaterThan(5);
    for (const link of tocLinks) {
      const target = link.getAttribute("href") ?? "";
      expect(target.startsWith("#")).toBe(true);
      expect(document.getElementById(target.slice(1)), `${target} has no target`).not.toBeNull();
    }
  });

  it("marks exactly one contents entry as current, and it is the first section", () => {
    renderPage();
    const current = document.querySelectorAll('.about-toc-link[aria-current="true"]');
    expect(current.length).toBe(1);
    expect(current[0].getAttribute("href")).toBe("#about-overview");
  });

  it("opens a credit link in a new tab without leaking the opener", () => {
    renderPage();
    const link = document.querySelector<HTMLAnchorElement>('.about-credit-link[href*="alphafold"]');
    expect(link).not.toBeNull();
    expect(link!.getAttribute("target")).toBe("_blank");
    expect(link!.getAttribute("rel")).toContain("noreferrer");
  });

  it("copies the BibTeX and says so in words, not only with an icon", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /copy bibtex/i }));

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0][0]).toMatch(/^@software\{/);
    // The label itself changes, so the confirmation survives a monochrome render and any
    // reader who cannot see the icon swap. It is awaited because the clipboard write is a
    // promise — asserting synchronously would pass on a control that never confirmed.
    expect(await screen.findByRole("button", { name: /bibtex copied/i })).toBeTruthy();
  });

  it("states the copy failure rather than swallowing it", async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) }
    });

    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /copy reference/i }));

    // Two live regions exist (the credit toolbar and the citation block); the failure belongs to
    // the citation block, and is asserted there.
    expect(await screen.findByText(/copy failed — select the text above/i)).toBeTruthy();
  });

  it("survives a browser with no clipboard API at all", async () => {
    // Served over plain HTTP — which this deployment is, hence the duckdns origin — the
    // Clipboard API is simply absent. `navigator.clipboard.writeText` then throws a
    // TypeError synchronously on an undefined property, before any promise exists, so this
    // is a different failure path from a rejected write and is asserted separately.
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true
    });

    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /copy bibtex/i }));

    // No unhandled rejection, and the reader is told rather than shown a button that
    // silently did nothing.
    // Two live regions exist (the credit toolbar and the citation block); the failure belongs to
    // the citation block, and is asserted there.
    expect(await screen.findByText(/copy failed — select the text above/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /copy bibtex/i })).toBeTruthy();
  });

  it("keeps the research-use framing on the page", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: /research use only/i })).toBeTruthy();
    expect(screen.getByText(/not a diagnosis/i)).toBeTruthy();
  });

  it("prints a revision beside every pinned model, not just the model name", () => {
    // A rail that lists ESM-2, SaProt and VESM with no revision beside them is a list, not a
    // provenance record. This reads the manifest rather than hard-coding a revision, so it
    // cannot be satisfied by a stale literal.
    renderPage();
    for (const [id, revision] of Object.entries(PROVENANCE_MODEL_REVISIONS) as [
      string,
      { model: string; commitSha?: string; weights?: string }
    ][]) {
      const row = Array.from(document.querySelectorAll("div")).find(
        (element) =>
          element.textContent?.startsWith(revision.model) &&
          element.children.length === 2
      );
      expect(row, `${revision.model} has no label/value row`).toBeDefined();
      const expected = revision.commitSha
        ? `@${revision.commitSha.slice(0, 10)}`
        : revision.weights || id;
      expect(row!.textContent, `${revision.model} is missing its revision`).toContain(expected);
    }
  });

  it("filters the roll, keeps every group anchor alive, and says how many are shown", () => {
    renderPage();
    fireEvent.change(screen.getByLabelText(/filter sources/i), { target: { value: "foldx" } });

    expect(document.getElementById("credit-foldx")).not.toBeNull();
    expect(document.getElementById("credit-gnomad")).toBeNull();
    // A group with no matches collapses but stays mounted, so its contents link still resolves.
    for (const group of ATTRIBUTION_GROUPS) {
      expect(document.getElementById(group.id), `${group.id} unmounted by the filter`).not.toBeNull();
    }
    expect(screen.getByText(/showing \d+ of \d+/i)).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/filter sources/i), { target: { value: "zzz-no-such-source" } });
    expect(screen.getByText(/no credited source matches/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /clear filters/i }));
    expect(document.getElementById("credit-gnomad")).not.toBeNull();
  });

  it("filters by kind with a pressed state a screen reader can read", () => {
    renderPage();
    const models = screen.getByRole("button", { name: /^model\s*\d+$/i });
    fireEvent.click(models);
    expect(models.getAttribute("aria-pressed")).toBe("true");
    const shown = ATTRIBUTION_GROUPS.flatMap((group) => group.entries).filter(
      (entry) => document.getElementById(`credit-${entry.id}`)
    );
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.every((entry) => entry.kind === "model")).toBe(true);
  });

  it("flags the manifest releases its own credits say are not established", () => {
    // The rail prints the manifest verbatim; without the flag it would state dbNSFP "4.4a" as
    // fact beside a credit that says the release is unresolved.
    renderPage();
    for (const id of ["dbnsfp", "clinvar"]) {
      const link = document.querySelector(`.about-kv-link[href="#credit-${id}"]`);
      expect(link, `${id} manifest row is not flagged`).not.toBeNull();
    }
  });

  it("keeps every element id unique", () => {
    renderPage();
    const ids = Array.from(document.querySelectorAll("[id]")).map((element) => element.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(dupes).toEqual([]);
  });

  it("opens a workspace view from the map when navigation is wired", () => {
    const onNavigateToView = vi.fn();
    render(<AboutView onNavigateToView={onNavigateToView} />);
    fireEvent.click(screen.getByRole("button", { name: /energetics/i }));
    expect(onNavigateToView).toHaveBeenCalledWith("energetics");
  });

  it("still routes to the data and cache management the guide promises", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /manage data & caches/i }));
    expect(openSettingsTab).toHaveBeenCalledWith("data");
  });

  it("quick-filters sources with topic presets and toggles back", () => {
    renderPage();
    const structureChip = screen.getByRole("button", { name: /^structure 3d$/i });
    expect(structureChip).toBeInTheDocument();
    expect(structureChip.getAttribute("aria-pressed")).toBe("false");

    // Click to filter
    fireEvent.click(structureChip);
    expect(structureChip.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByDisplayValue("structure")).toBeInTheDocument();

    // Toggle off
    fireEvent.click(structureChip);
    expect(structureChip.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByPlaceholderText(/filter by name/i)).toHaveValue("");
  });

  it("copies direct credit deep link with visual confirmation", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    renderPage();
    const anchorBtn = screen.getByRole("button", { name: /copy link to foldx/i });
    expect(anchorBtn).toBeInTheDocument();

    fireEvent.click(anchorBtn);
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0][0]).toContain("#credit-foldx");
    expect(await screen.findByRole("button", { name: /deep link copied/i })).toBeInTheDocument();
  });
});
