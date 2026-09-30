import { describe, it, expect } from "vitest";
import {
  buildLiteratureEvidence,
  highlightSegments,
  narrowCitations,
  paperIdentifier,
  paperLink,
  parseVariantForms,
  readMentions,
  scopeOf,
  variantSearchQuery,
  type Citation,
  type LiteratureEvidenceInput,
} from "../literatureEvidence";

const GENE = "NAE1";
const VARIANT = "p.Asp116Gly";

/** Shaped like the papers on the reference screen: the first matched in full text, not the abstract. */
const FISH: Citation = {
  id: "PMC13295995",
  title: "Advances in Fish Gene Editing",
  abstract: "CRISPR tools have transformed aquaculture genetics.",
  authors: "Xu J, Cheng F",
  journal: "Animals : an open access journal from MDPI",
  year: 2026,
  url: "https://europepmc.org/article/PMC/PMC13295995",
};
const NEDD: Citation = {
  id: "41695624",
  title: "Neddylation and the NAE1 subunit in disease",
  abstract: "NAE1 encodes a subunit of the NEDD8-activating enzyme. We review its role in cullin neddylation.",
  authors: "Sun Y, Liu B",
  journal: "Frontiers in neurology",
  year: 2026,
  url: "https://pubmed.ncbi.nlm.nih.gov/41695624/",
};
const HIT: Citation = {
  id: "30000001",
  title: "A de novo NAE1 missense change in a patient with hypotonia",
  abstract: "We report a child with developmental delay. Sequencing found NAE1 p.Asp116Gly, absent from gnomAD. Functional data are pending.",
  authors: "Doe J",
  journal: "Am J Med Genet A",
  year: 2021,
  url: "https://pubmed.ncbi.nlm.nih.gov/30000001/",
};

const base: LiteratureEvidenceInput = {
  gene: GENE,
  variant: VARIANT,
  citations: [FISH, NEDD, HIT],
  response: {
    hitCount: 747,
    europePmcQuery: 'NAE1 AND (mutation OR variant OR functional OR "pathogenic")',
    degraded: false,
    fetchedAt: 1_700_000_000_000,
    pageSize: 25,
  },
  executedQuery: "",
  narrowingFilter: "",
  groupFilter: "all",
  pinnedIds: new Set<string>(),
  probe: { state: "idle", hitCount: null },
  load: "ready",
  error: null,
};

describe("parseVariantForms", () => {
  it("lists every notation a paper might use for a substitution", () => {
    const f = parseVariantForms("p.Asp116Gly")!;
    expect(f.label).toBe("p.Asp116Gly");
    expect(f.forms).toEqual(["p.Asp116Gly", "Asp116Gly", "D116G", "p.D116G"]);
  });

  it("reads the same change from one-letter and transcript-prefixed input", () => {
    expect(parseVariantForms("D116G")!.label).toBe("p.Asp116Gly");
    expect(parseVariantForms("NM_003905.4(NAE1):p.Asp116Gly")!.label).toBe("p.Asp116Gly");
  });

  it("adds the X and * spellings for a nonsense change", () => {
    const f = parseVariantForms("p.Arg97Ter")!;
    expect(f.forms).toEqual(expect.arrayContaining(["p.Arg97Ter", "R97X", "R97*"]));
  });

  it("has no protein-level form for a synonymous change, an indel or nothing", () => {
    expect(parseVariantForms("p.Asp116=")).toBeNull();
    expect(parseVariantForms("p.Asp116Asp")).toBeNull();
    expect(parseVariantForms("c.1224C>T")).toBeNull();
    expect(parseVariantForms("")).toBeNull();
    expect(parseVariantForms(null)).toBeNull();
  });
});

describe("variantSearchQuery and scopeOf", () => {
  it("quotes each notation and keeps the gene in scope", () => {
    const q = variantSearchQuery(GENE, parseVariantForms(VARIANT));
    expect(q).toBe('NAE1 AND ("p.Asp116Gly" OR "Asp116Gly" OR "D116G" OR "p.D116G")');
  });

  it("recognises its own query as the variant scope, case-insensitively, and a gene-wide default as empty", () => {
    const q = variantSearchQuery(GENE, parseVariantForms(VARIANT));
    expect(scopeOf("", q)).toBe("gene");
    expect(scopeOf(q!.toLowerCase(), q)).toBe("variant");
    expect(scopeOf("neddylation", q)).toBe("custom");
  });
});

describe("readMentions", () => {
  const forms = parseVariantForms(VARIANT);

  it("finds the variant in the abstract and quotes the sentence that names it", () => {
    const m = readMentions(HIT, GENE, forms);
    expect(m.level).toBe("variant");
    expect(m.variantIn).toBe("abstract");
    expect(m.matchedForm).toBe("p.Asp116Gly");
    expect(m.snippet).toBe("Sequencing found NAE1 p.Asp116Gly, absent from gnomAD.");
  });

  it("separates a paper that names only the gene from one that names neither", () => {
    expect(readMentions(NEDD, GENE, forms).level).toBe("gene");
    const fish = readMentions(FISH, GENE, forms);
    // Europe PMC matched this on full text: neither title nor abstract carries the gene.
    expect(fish.level).toBe("elsewhere");
    expect(fish.geneIn).toEqual([]);
  });

  it("matches a one-letter form exactly and never inside a longer token", () => {
    const tight = { ...HIT, abstract: "Variant D116G was found. Not AD116GX." };
    expect(readMentions(tight, GENE, forms).matchedForm).toBe("D116G");
    const inside = { ...HIT, title: "x", abstract: "Not AD116GX here." };
    expect(readMentions(inside, GENE, forms).level).not.toBe("variant");
  });

  it("does not treat a common word as the gene: only the symbol as written or capitalised", () => {
    const set = { ...NEDD, title: "We set out to test", abstract: "An experiment to set a baseline." };
    expect(readMentions(set, "SET", null).geneIn).toEqual([]);
    expect(readMentions({ ...NEDD, title: "Nae1 knockout in mouse", abstract: "" }, "NAE1", null).geneIn).toEqual(["title"]);
  });

  it("says when there is no abstract, so a title-only check is not read as a full one", () => {
    expect(readMentions({ ...HIT, abstract: "" }, GENE, forms).hasAbstract).toBe(false);
  });
});

describe("highlightSegments", () => {
  it("marks variant notations and the gene, variant winning any overlap", () => {
    const segs = highlightSegments("NAE1 p.Asp116Gly is rare", GENE, parseVariantForms(VARIANT));
    expect(segs.map(s => [s.text, s.kind])).toEqual([
      ["NAE1", "gene"],
      [" ", null],
      ["p.Asp116Gly", "variant"],
      [" is rare", null],
    ]);
  });

  it("returns the text whole when nothing matches", () => {
    expect(highlightSegments("nothing here", GENE, null)).toEqual([{ text: "nothing here", kind: null }]);
  });
});

describe("paperIdentifier and paperLink", () => {
  it("labels each kind of identifier for what it is", () => {
    expect(paperIdentifier("41695624").label).toBe("PMID 41695624");
    expect(paperIdentifier("PMC13295995")).toEqual({ kind: "pmcid", label: "PMC13295995" });
    expect(paperIdentifier("PPR123456").kind).toBe("preprint");
  });

  it("never builds a dead PubMed deep link for a non-PMID id", () => {
    expect(paperLink({ ...FISH, url: null }).href).toBe("https://europepmc.org/search?query=PMC13295995");
    expect(paperLink({ ...NEDD, url: null }).href).toBe("https://pubmed.ncbi.nlm.nih.gov/41695624/");
    expect(paperLink({ ...NEDD, url: "/relative" }).usable).toBe(false);
  });
});

describe("narrowCitations", () => {
  it("narrows on the whole phrase, then on any free term once operators and field tags are stripped", () => {
    expect(narrowCitations([FISH, NEDD, HIT], "neddylation")).toEqual([NEDD]);
    expect(narrowCitations([FISH, NEDD, HIT], '(hypotonia[Title]) AND "delay"')).toEqual([HIT]);
    expect(narrowCitations([FISH, NEDD, HIT], "")).toHaveLength(3);
  });
});

describe("buildLiteratureEvidence", () => {
  it("orders the list variant → gene → elsewhere, keeping the server's newest-first order inside each group", () => {
    const ev = buildLiteratureEvidence(base);
    expect(ev.papers.map(p => p.citation.id)).toEqual(["30000001", "41695624", "PMC13295995"]);
    expect(ev.counts).toMatchObject({ total: 3, variant: 1, gene: 1, elsewhere: 1, visible: 3 });
  });

  it("states the variant count in words before the variant-specific search has run", () => {
    const f = buildLiteratureEvidence(base).finding;
    expect(f.figure).toBe("1");
    expect(f.headline).toBe("1 of 3 loaded papers name p.Asp116Gly in the title or abstract.");
    expect(f.predicate).toBe("Only the loaded page has been read");
  });

  it("words a zero as a count of records matched by a stated query — never as absence of evidence", () => {
    const ev = buildLiteratureEvidence({ ...base, probe: { state: "done", hitCount: 0 } });
    expect(ev.finding.figure).toBe("0");
    expect(ev.finding.headline).toBe("Europe PMC holds no record that names p.Asp116Gly.");
    expect(ev.finding.predicate).toContain("matched 0 records");
    expect(ev.finding.predicate).toContain("another notation");
    expect(ev.finding.predicate).not.toMatch(/no evidence|benign/i);
  });

  it("reports a failed variant search as a fault and does not invent a count", () => {
    const ev = buildLiteratureEvidence({ ...base, probe: { state: "error", hitCount: null } });
    expect(ev.finding.headline).toBe("The variant-specific search did not complete.");
    expect(ev.faults).toContain("The variant-specific search did not complete, so its count is not shown.");
  });

  it("prints the query the server sent, not one rebuilt on the client", () => {
    const ev = buildLiteratureEvidence(base);
    const sent = ev.trace.find(s => s.key === "sent")!;
    expect(sent.value).toBe('NAE1 AND (mutation OR variant OR functional OR "pathogenic")');
    expect(sent.mono).toBe(true);
    expect(JSON.stringify(ev.trace)).not.toContain("[Gene]");
  });

  it("does not claim a query was sent before any response", () => {
    const ev = buildLiteratureEvidence({ ...base, response: null, citations: [], load: "idle" });
    expect(ev.trace.find(s => s.key === "sent")!.value).toBe("Not sent yet");
    expect(ev.trace.find(s => s.key === "sent")!.state).toBe("idle");
  });

  it("keeps the gene-wide fact on the gene-wide count while the variant scope is showing", () => {
    const q = variantSearchQuery(GENE, parseVariantForms(VARIANT))!;
    const ev = buildLiteratureEvidence({
      ...base,
      executedQuery: q,
      citations: [],
      response: { ...base.response!, hitCount: 0, europePmcQuery: q },
      geneHitCount: 747,
    });
    expect(ev.scope).toBe("variant");
    // `hitCount` here is the variant query's 0; labelling it "gene-wide" was a defect.
    expect(ev.facts[0]).toMatchObject({ label: "Gene-wide matches", value: "747" });
    const unknown = buildLiteratureEvidence({ ...base, executedQuery: q, citations: [], response: { ...base.response!, hitCount: 0, europePmcQuery: q } });
    expect(unknown.facts[0].value).toBe("—");
  });

  it("flags a degraded fallback and withholds its hit count", () => {
    const ev = buildLiteratureEvidence({ ...base, response: { ...base.response!, degraded: true, hitCount: 747 } });
    expect(ev.faults[0]).toContain("did not answer");
    expect(ev.facts[0].value).toBe("—");
    expect(ev.trace.find(s => s.key === "matched")!.value).toBe("No answer");
  });

  it("filters by group and by typed text, and exports exactly what is visible", () => {
    const grouped = buildLiteratureEvidence({ ...base, groupFilter: "elsewhere" });
    expect(grouped.visible.map(p => p.citation.id)).toEqual(["PMC13295995"]);
    const narrowed = buildLiteratureEvidence({ ...base, narrowingFilter: "hypotonia" });
    expect(narrowed.displayed.map(c => c.id)).toEqual(["30000001"]);
    expect(narrowed.counts.total).toBe(3);
  });

  it("marks pinned papers", () => {
    const ev = buildLiteratureEvidence({ ...base, pinnedIds: new Set(["41695624"]) });
    expect(ev.counts.pinned).toBe(1);
    expect(ev.papers.find(p => p.citation.id === "41695624")!.pinned).toBe(true);
  });

  it("has no variant scope for a change with no protein notation, and says why", () => {
    const ev = buildLiteratureEvidence({ ...base, variant: "c.1224C>T" });
    expect(ev.forms).toBeNull();
    expect(ev.variantQuery).toBeNull();
    expect(ev.finding.headline).toBe("This variant has no protein-level notation to search for.");
  });

  it("carries no verdict and no journal metric anywhere in the model", () => {
    // No journal ranking is sourced here, and no ACMG code is emitted from what a paper says.
    const text = JSON.stringify(buildLiteratureEvidence(base));
    expect(text).not.toMatch(/impact factor|quartile|journalRank/i);
    expect(text).not.toMatch(/"(PS3|PS4|PP1|PM1|PP3)"/);
    expect(buildLiteratureEvidence(base).facts.at(-1)).toEqual({ label: "Engine record", value: "None", sub: "Literature is read, not scored" });
  });
});
