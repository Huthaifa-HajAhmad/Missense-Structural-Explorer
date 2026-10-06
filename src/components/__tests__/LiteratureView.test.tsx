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
import { MechanismPanel } from "../literature/MechanismPanel";

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
const FUNCTIONAL = paper("30000002", 2024, "NAE1 activity", "NAE1 p.Asp116Gly activity was reduced in vitro.");
const CLINICAL_FUNCTIONAL = paper("30000003", 2023, "NAE1 case and assay", "A patient with NAE1 p.Asp116Gly had reduced activity in vitro.");

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
    expect(finding.textContent).toContain("No matches for the searched protein notations of p.Asp116Gly.");
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
  it("keeps full-text-only records out of the default shortlist and labels their screening observation when All is chosen", async () => {
    serve();
    renderView();
    await screen.findByTestId("paper-41695624");
    fireEvent.click(screen.getByRole("button", { name: "Show all tiers" }));
    const row = await screen.findByTestId("paper-PMC13295995");
    expect(within(row).getByText("Not in title/abstract")).toBeTruthy();
    expect(within(await screen.findByTestId("paper-41695624")).getByText("Gene named")).toBeTruthy();
  });

  it("lists a paper that names the variant first, with a chip and the quoted sentence when opened", async () => {
    serve({ citations: [NEDD, HIT, FISH], hitCount: 3 }, { citations: [HIT], hitCount: 1 });
    renderView();
    const table = await screen.findByTestId("literature-table");
    const firstRow = within(table).getAllByTestId(/^paper-/)[0];
    expect(firstRow.getAttribute("data-testid")).toBe("paper-30000001");
    expect(within(firstRow).getByText("Variant named")).toBeTruthy();

    fireEvent.click(within(firstRow).getByRole("button", { name: /^A de novo NAE1 missense change/ }));
    expect(await screen.findByText(/Variant named · lexicon/i)).toBeTruthy();
    expect(screen.getAllByText("p.Asp116Gly", { selector: "mark" }).length).toBeGreaterThan(0);
  });

  it("switches to the variant scope with one request for the variant query, not a forced gene search", async () => {
    serve();
    renderView();
    await screen.findByTestId("paper-41695624");
    getLiterature.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /Naming p\.Asp116Gly/ }));
    await waitFor(() => expect(getLiterature).toHaveBeenCalled());
    expect(getLiterature).toHaveBeenCalledWith(GENE, false, expect.any(AbortSignal), VARIANT_Q, expect.objectContaining({ variant: VARIANT }));
    expect(await screen.findByText("No matches for these protein notations of p.Asp116Gly")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Naming p\.Asp116Gly/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("filters by what the text check found", async () => {
    serve({ citations: [NEDD, HIT, FISH], hitCount: 3 }, { citations: [HIT], hitCount: 1 });
    renderView();
    await screen.findByTestId("paper-30000001");
    fireEvent.click(screen.getByRole("button", { name: "Show all tiers" }));
    fireEvent.click(screen.getByRole("button", { name: /Neither in title\/abstract/ }));
    expect(screen.queryByTestId("paper-30000001")).toBeNull();
    expect(screen.getByTestId("paper-PMC13295995")).toBeTruthy();
  });

  it("shows zero-inclusive shortlist counts, applies the count control, and combines screening chips with AND semantics", async () => {
    serve({ citations: [FUNCTIONAL, CLINICAL_FUNCTIONAL, FISH], hitCount: 3 });
    const view = renderView();
    const shortlist = await screen.findByRole("group", { name: "Filter by reading tier" });
    expect(within(shortlist).getByRole("button", { name: /Read first2/ })).toBeTruthy();
    expect(within(shortlist).getByRole("button", { name: /Read next0/ }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Show all tiers" }));
    const controls = screen.getByRole("group", { name: "Filter by screening observation" });
    fireEvent.click(within(controls).getByRole("button", { name: /Assay language2/ }));
    fireEvent.click(within(controls).getByRole("button", { name: /Clinical study1/ }));
    expect(screen.getByTestId("paper-30000003")).toBeTruthy();
    expect(screen.queryByTestId("paper-30000002")).toBeNull();
    await waitFor(() => expect(view.evidence()?.trace.find(step => step.key === "order")?.value).toContain("1 shown"));
  });

  it("defaults to attention ordering and sorts by year even when retrieval order is not chronological", async () => {
    serve({ citations: [HIT, NEDD], hitCount: 2 });
    renderView();
    const table = await screen.findByTestId("literature-table");
    expect(within(table).getAllByTestId(/^paper-/)[0].getAttribute("data-testid")).toBe("paper-30000001");
    fireEvent.click(screen.getByRole("button", { name: "Show all tiers" }));
    fireEvent.click(screen.getByRole("button", { name: "Newest" }));
    expect(within(table).getAllByTestId(/^paper-/)[0].getAttribute("data-testid")).toBe("paper-41695624");
  });

  it("explains an empty screening intersection and restores papers when cleared", async () => {
    const clinical = paper("30000004", 2022, "NAE1 patient", "A patient with NAE1 p.Asp116Gly was diagnosed.");
    serve({ citations: [FUNCTIONAL, clinical], hitCount: 2 });
    renderView();
    await screen.findByTestId("paper-30000002");
    const filters = screen.getByRole("group", { name: "Filter by screening observation" });
    fireEvent.click(within(filters).getByRole("button", { name: /Assay language1/ }));
    fireEvent.click(within(filters).getByRole("button", { name: /Clinical study1/ }));
    expect(await screen.findByText("No loaded paper matches these screening filters")).toBeTruthy();
    expect(screen.queryByText("No papers returned")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Clear screening filters" }));
    expect(await screen.findByTestId("paper-30000002")).toBeTruthy();
    expect(screen.getByTestId("paper-30000004")).toBeTruthy();
  });

  it("shows a curated record relationship with its provider link and keeps it out of the query's loaded count", async () => {
    const curatedLink = {
      provider: "uniprot" as const,
      featureId: "VAR_088123",
      accession: "Q13564",
      variant: "D116G",
      variantDescription: "in NEDFIH",
      evidenceCode: "ECO:0000269",
      pmid: "30000009",
      source: "PubMed",
      sourceUrl: "https://www.uniprot.org/uniprotkb/Q13564/variant/VAR_088123",
      retrievedAt: "2026-10-05T00:00:00.000Z",
    };
    const curatedOnly = paper("30000009", 2020, "NAE1 curated-only record", "An abstract that never mentions the substitution.");
    getLiterature.mockImplementation(async (_g: string, _f: boolean, _s: unknown, query?: string) =>
      query && query.includes("D116G")
        ? reply({ citations: [], hitCount: 0, europePmcQuery: VARIANT_Q })
        : reply({ citations: [NEDD], hitCount: 1, curatedCitations: [{ ...curatedOnly, curatedLinks: [curatedLink] }], curated: { state: "complete", linked: 1 } })
    );
    renderView();

    const row = await screen.findByTestId("paper-30000009");
    expect(within(row).getByText("Cited by UniProt variant record")).toBeTruthy();
    fireEvent.click(within(row).getByRole("button", { name: /^NAE1 curated-only record/ }));
    expect(await screen.findByText(/VAR_088123/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Provider record/ }).getAttribute("href")).toBe(curatedLink.sourceUrl);
    // The curated-only record is shown but is not query membership: the loaded fact stays at 1.
    const loadedFact = screen.getByText("Loaded here").closest(".lit-fact") as HTMLElement;
    expect(within(loadedFact).getByText("1")).toBeTruthy();
    expect(within(loadedFact).queryByText("2")).toBeNull();
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

describe("Literature tab — mechanism comparison states", () => {
  const terms = [{ term: "loss-of-function", quote: "The variant causes loss-of-function." }];
  it("renders the flag, constraint-silent, and unavailable states in words", () => {
    const { rerender } = render(<MechanismPanel terms={terms} constraint={{ pli: 0.1, loeuf: 0.9, missense_z: 1, oe_mis: 1 }} />);
    expect(screen.queryByText("terms differ from context")).toBeNull();
    expect(screen.getByText(/Constraint alone does not establish/)).toBeTruthy();
    rerender(<MechanismPanel terms={[{ term: "gain-of-function", quote: "Activation." }]} constraint={{ pli: 0.1, loeuf: 0.9, missense_z: 1, oe_mis: 1 }} />);
    expect(screen.getByText("Constraint cannot speak to this mechanism.")).toBeTruthy();
    rerender(<MechanismPanel terms={terms} constraint={null} unavailableReason="Not available here — constraint is absent for this result." />);
    expect(screen.getByText(/Not available here — constraint is absent/)).toBeTruthy();
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
    expect(rail.textContent).toContain("Up to 5 relevant abstracts from bounded gene, protein-notation and clinical/functional searches");
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

  it("keeps screening tags and counts out of the hero and every ACMG surface", async () => {
    serve({ citations: [HIT], hitCount: 1 });
    renderView();
    const hero = await screen.findByTestId("literature-finding");
    expect(hero.textContent).not.toMatch(/functional|clinical case|same residue|mechanism|review|preprint|read first/i);
    const source = FILES.map(file => fs.readFileSync(path.join(process.cwd(), file), "utf-8")).join("\n");
    expect(source).not.toMatch(/acmgCriteria[\s\S]*screening|screening[\s\S]*acmgCriteria/i);
  });
});

describe("pagination and honest summary inputs", () => {
  it("keeps the chosen tier while appending another query page", async () => {
    serve({ citations: [{ ...NEDD, abstract: "NAE1 enzyme activity was measured." }, FISH], hitCount: 60, nextCursor: "page-2" });
    const view = renderView();
    await screen.findByTestId("paper-41695624");
    expect(screen.getByRole("button", { name: /Read next1/ }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Show all tiers" }));
    getLiterature.mockResolvedValueOnce({ gene: GENE, citations: [NEDD, HIT], hitCount: 60, nextCursor: null, degraded: false });
    fireEvent.click(screen.getByRole("button", { name: "Load 25 more" }));
    await screen.findByTestId("paper-30000001");
    expect(screen.getByRole("button", { name: "Show all tiers" }).getAttribute("aria-pressed")).toBe("true");
    expect(getLiterature).toHaveBeenLastCalledWith(GENE, false, expect.any(AbortSignal), undefined, { cursor: "page-2" });
    await waitFor(() => expect(view.evidence()?.counts.total).toBe(3));
    expect(screen.queryByRole("button", { name: "Load 25 more" })).toBeNull();
  });
  it("keeps loaded papers and offers retry after a next-page error", async () => {
    serve({ citations: [NEDD], hitCount: 60, nextCursor: "page-2" });
    renderView();
    await screen.findByTestId("paper-41695624");
    getLiterature.mockRejectedValueOnce(new Error("Next page failed"));
    fireEvent.click(screen.getByRole("button", { name: "Load 25 more" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Next page failed");
    expect(screen.getByTestId("paper-41695624")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Load 25 more" }).hasAttribute("disabled")).toBe(false);
  });
  it("reports unknown summary provenance instead of presenting the current filters as AI inputs", () => {
    render(<LiteratureInspector gene={GENE} variant={VARIANT} />);
    expect(screen.getByText(/Summary inputs are not recorded/)).toBeTruthy();
  });
});
