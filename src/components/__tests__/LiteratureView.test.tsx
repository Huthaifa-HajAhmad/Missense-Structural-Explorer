// @vitest-environment jsdom
/**
 * LiteratureView.test.tsx — what the Literature screen and its rail are allowed to claim.
 *
 * Each assertion pins a claim the previous screen got wrong or could not make:
 *
 *   • the query shown was a client-built default, not the one the server ran;
 *   • a record returned on full text, with the gene nowhere in its abstract, sat in the list as if it
 *     were gene literature;
 *   • variant-specific literature was never asked for, so "nothing found" and "never searched" looked
 *     the same;
 *   • an upstream failure that fell back to cached rows was invisible;
 *   • three buttons ran the identical forced search.
 *
 * The screen renders from `src/shared/literatureEvidence.ts`; the API client is mocked at the module
 * boundary so the test controls exactly what the server "sent".
 */
import React from "react";
import fs from "fs";
import path from "path";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { findLegacyLabels } from "../../shared/engineStatus";
import type { LiteratureEvidence } from "../../shared/literatureEvidence";

// One stable object, like the real hook's `useMemo`: a fresh client per render would change the effect
// dependencies every time and loop. `vi.hoisted` because `vi.mock` runs before module-level consts.
const hoisted = vi.hoisted(() => {
  const getLiterature = vi.fn();
  return { getLiterature, client: { apiClient: { getLiterature } } };
});
const getLiterature = hoisted.getLiterature;
vi.mock("../../apiClient", () => ({ useApiClient: () => hoisted.client }));

import LiteratureView from "../LiteratureView";
import LiteratureInspector from "../inspector/LiteratureInspector";

const GENE = "NAE1";
const VARIANT = "p.Asp116Gly";
const DEFAULT_Q = 'NAE1 AND (mutation OR variant OR functional OR "pathogenic")';
const VARIANT_Q = 'NAE1 AND ("p.Asp116Gly" OR "Asp116Gly" OR "D116G" OR "p.D116G")';

const paper = (id: string, year: number, title: string, abstract: string, journal = "J Test") => ({
  id, title, abstract, authors: "Doe J, Roe R", journal, year, url: /^\d+$/.test(id) ? `https://pubmed.ncbi.nlm.nih.gov/${id}/` : null,
});
const FISH = paper("PMC13295995", 2026, "Advances in Fish Gene Editing", "CRISPR tools have transformed aquaculture genetics.");
const NEDD = paper("41695624", 2026, "Neddylation and NAE1 in disease", "NAE1 encodes a NEDD8-activating enzyme subunit.");
const HIT = paper("30000001", 2021, "A de novo NAE1 missense change", "We report a child. Sequencing found NAE1 p.Asp116Gly, absent from gnomAD.");

const reply = (over: Record<string, unknown> = {}) => ({
  gene: GENE,
  citations: [NEDD, FISH],
  hitCount: 747,
  europePmcQuery: DEFAULT_Q,
  degraded: false,
  fetchedAt: 1_700_000_000_000,
  pageSize: 25,
  ...over,
});

/** The default query returns `def`; the variant query returns `variant`. */
function serve(def: Record<string, unknown> = {}, variant: Record<string, unknown> = {}) {
  getLiterature.mockImplementation(async (_gene: string, _force: boolean, _signal: unknown, query?: string) =>
    query && query.includes("D116G")
      ? reply({ citations: [], hitCount: 0, europePmcQuery: VARIANT_Q, ...variant })
      : reply(def)
  );
}

function renderView(extra: Partial<React.ComponentProps<typeof LiteratureView>> = {}) {
  let latest: LiteratureEvidence | null = null;
  const utils = render(
    <LiteratureView gene={GENE} variant={VARIANT} onEvidenceChange={e => { latest = e; }} {...extra} />
  );
  return { ...utils, evidence: () => latest };
}

beforeEach(() => {
  getLiterature.mockReset();
});

describe("Literature tab — the finding", () => {
  it("says how many Europe PMC records name the variant, worded as a count of a stated query", async () => {
    serve();
    renderView();
    const finding = await screen.findByTestId("literature-finding");
    await waitFor(() => expect(within(finding).getByTestId("literature-figure").textContent).toBe("0"));
    expect(finding.textContent).toContain("Europe PMC holds no record that names p.Asp116Gly.");
    expect(finding.textContent).toContain("matched 0 records");
    expect(finding.textContent).toContain("another notation");
    expect(finding.textContent).not.toMatch(/no evidence|benign|N\/A/i);
  });

  it("states that nothing here is counted in the ACMG verdict and that the engine record is none", async () => {
    serve();
    renderView();
    const finding = await screen.findByTestId("literature-finding");
    expect(within(finding).getByText("Not counted in the ACMG verdict")).toBeTruthy();
    expect(within(finding).getByText("Literature is read, not scored")).toBeTruthy();
  });

  it("reports a failed variant search as a fault, never as a zero", async () => {
    getLiterature.mockImplementation(async (_g: string, _f: boolean, _s: unknown, query?: string) => {
      if (query && query.includes("D116G")) throw new Error("boom");
      return reply();
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderView();
    await waitFor(() => expect(screen.getByText("The variant-specific search did not complete.")).toBeTruthy());
    expect(screen.getAllByText(/did not complete, so its count is not shown/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/holds no record/)).toBeNull();
    spy.mockRestore();
  });

  it("flags a degraded fallback instead of passing cached rows off as this search's results", async () => {
    serve({ degraded: true, hitCount: null, fetchedAt: null });
    renderView();
    await waitFor(() => expect(screen.getAllByText(/Europe PMC did not answer this search/).length).toBeGreaterThan(0));
    expect(screen.getByText("Europe PMC did not answer")).toBeTruthy();
  });
});

describe("Literature tab — the papers", () => {
  it("marks a record matched on full text as not naming the gene in its abstract", async () => {
    serve();
    renderView();
    const row = await screen.findByTestId("paper-PMC13295995");
    expect(within(row).getByText("NAE1 not in abstract")).toBeTruthy();
    expect(within(await screen.findByTestId("paper-41695624")).getByText("Names NAE1 only")).toBeTruthy();
  });

  it("lists a paper that names the variant first, with a chip and the quoted sentence when opened", async () => {
    serve({ citations: [NEDD, HIT, FISH], hitCount: 3 }, { citations: [HIT], hitCount: 1 });
    renderView();
    const table = await screen.findByTestId("literature-table");
    const firstRow = within(table).getAllByTestId(/^paper-/)[0];
    expect(firstRow.getAttribute("data-testid")).toBe("paper-30000001");
    expect(within(firstRow).getByText("Names p.Asp116Gly")).toBeTruthy();

    fireEvent.click(within(firstRow).getByRole("button", { name: /^A de novo NAE1 missense change/ }));
    expect(await screen.findByText("Sentence naming the variant")).toBeTruthy();
    expect(screen.getAllByText("p.Asp116Gly", { selector: "mark" }).length).toBeGreaterThan(0);
  });

  it("switches to the variant scope with one request for the variant query, not a forced gene search", async () => {
    serve();
    renderView();
    await screen.findByTestId("paper-41695624");
    getLiterature.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /Naming p\.Asp116Gly/ }));
    await waitFor(() => expect(getLiterature).toHaveBeenCalled());
    expect(getLiterature).toHaveBeenCalledWith(GENE, false, expect.any(AbortSignal), VARIANT_Q);
    expect(await screen.findByText("No record names p.Asp116Gly")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Naming p\.Asp116Gly/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("filters by what the text check found", async () => {
    serve({ citations: [NEDD, HIT, FISH], hitCount: 3 }, { citations: [HIT], hitCount: 1 });
    renderView();
    await screen.findByTestId("paper-30000001");
    fireEvent.click(screen.getByRole("button", { name: /NAE1 not in abstract/ }));
    expect(screen.queryByTestId("paper-30000001")).toBeNull();
    expect(screen.getByTestId("paper-PMC13295995")).toBeTruthy();
  });

  it("pins and unpins a paper from the row, without opening it", async () => {
    serve();
    renderView();
    const row = await screen.findByTestId("paper-41695624");
    const pin = within(row).getByRole("button", { name: /Add ".*" to the report/ });
    expect(pin.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(pin);
    await waitFor(() => expect(within(screen.getByTestId("paper-41695624")).getByRole("button", { name: /Remove ".*" from the report/ }).getAttribute("aria-pressed")).toBe("true"));
    fireEvent.click(within(screen.getByTestId("paper-41695624")).getByRole("button", { name: /Remove/ }));
    await waitFor(() => expect(within(screen.getByTestId("paper-41695624")).getByRole("button", { name: /Add/ }).getAttribute("aria-pressed")).toBe("false"));
  });

  it("explains an empty narrowing filter and offers the upstream search", async () => {
    serve();
    renderView();
    await screen.findByTestId("paper-41695624");
    fireEvent.change(screen.getByLabelText("Search literature"), { target: { value: "zzzqqq" } });
    const empty = await screen.findByTestId("literature-empty");
    expect(empty.textContent).toContain("No matches in the loaded list");
    expect(empty.textContent).toContain("Press Enter to search Europe PMC");
  });

  it("shows a failed search as an amber, recoverable statement with the old list kept", async () => {
    serve();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderView();
    await screen.findByTestId("paper-41695624");
    getLiterature.mockRejectedValue(new Error("Europe PMC is unreachable"));
    fireEvent.submit(screen.getByRole("search"));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Europe PMC search failed.");
    expect(alert.textContent).toContain("previously loaded list is still shown below");
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.getByTestId("paper-41695624")).toBeTruthy();
    spy.mockRestore();
  });
});

describe("Literature rail — the trace", () => {
  it("prints the query the server sent, and offers the variant query as a suggestion that is not yet run", async () => {
    serve();
    let evidence: LiteratureEvidence | null = null;
    render(<LiteratureView gene={GENE} variant={VARIANT} onEvidenceChange={e => { evidence = e; }} />);
    await screen.findByTestId("paper-41695624");
    await waitFor(() => expect(evidence).not.toBeNull());

    render(<LiteratureInspector gene={GENE} variant={VARIANT} evidence={evidence} searchQuery="" />);
    const rail = screen.getByTestId("literature-rail");
    expect(within(rail).getByTestId("trace-sent").textContent).toBe(DEFAULT_Q);
    expect(rail.textContent).not.toContain("[Gene]");
    expect(within(rail).getByText("Suggested query — not run yet")).toBeTruthy();
    expect((within(rail).getByRole("textbox") as HTMLTextAreaElement).value).toBe(VARIANT_Q);
    expect(within(rail).getByTestId("trace-check").textContent).toContain("name p.Asp116Gly");
  });

  it("says what reads the list: nothing in the engine, at most 5 abstracts in the AI summary", () => {
    render(<LiteratureInspector gene={GENE} variant={VARIANT} evidence={null} />);
    const rail = screen.getByTestId("literature-rail");
    expect(rail.textContent).toContain("Nothing. No criterion is scored from literature.");
    expect(rail.textContent).toContain("Up to 5 abstracts from the gene-wide set");
    expect(within(rail).getByText("No search has run yet.")).toBeTruthy();
  });

  it("disables export when nothing is shown and says so", () => {
    render(<LiteratureInspector gene={GENE} variant={VARIANT} evidence={null} />);
    const rail = screen.getByTestId("literature-rail");
    expect(within(rail).getByText("No papers are shown, so there is nothing to export.")).toBeTruthy();
    expect((within(rail).getByRole("button", { name: /BibTeX/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("applies the query in the box when the button is pressed", async () => {
    const onSearch = vi.fn();
    render(<LiteratureInspector gene={GENE} variant={VARIANT} evidence={null} searchQuery="custom AND term" onSearch={onSearch} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Search Europe PMC/ }));
    });
    expect(onSearch).toHaveBeenCalledWith("custom AND term");
  });
});

describe("Literature surfaces — what they may never print", () => {
  const FILES = [
    "src/components/LiteratureView.tsx",
    "src/components/literature/PaperTable.tsx",
    "src/components/literature/MarkedText.tsx",
    "src/components/inspector/LiteratureInspector.tsx",
    "src/shared/literatureEvidence.ts",
  ];

  it.each(FILES)("%s has no retired status word and no journal metric", file => {
    const source = fs.readFileSync(path.join(process.cwd(), file), "utf-8");
    expect(findLegacyLabels(source)).toEqual([]);
    expect(source).not.toMatch(/["'`][^"'`\n]*\bN\/A\b[^"'`\n]*["'`]/);
    expect(source).not.toMatch(/impactFactor|journalRank|quartile/i);
  });

  it("uses tokens and no Tailwind palette colours, hex literals or pulse loaders", () => {
    const css = fs.readFileSync(path.join(process.cwd(), "src/styles/literature.css"), "utf-8");
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/rgba?\(/);
    for (const file of FILES.slice(0, 4)) {
      const source = fs.readFileSync(path.join(process.cwd(), file), "utf-8");
      expect(source, file).not.toMatch(/\b(rose|emerald|amber|indigo|sky)-\d{2,3}\b/);
      expect(source, file).not.toMatch(/animate-(spin|pulse|ping)/);
    }
  });
});
