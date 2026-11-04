import { describe, expect, it } from "vitest";
import { parseVcvConditions } from "./clinvar-conditions.ts";
import { VCV_CNNM2_E357K } from "./clinvar-vcv.fixture.ts";


/** A complete variant record whose condition list is `inner`. */
const wrap = (inner: string) => `<ClinVarResult-Set><VariationArchive><ClassifiedRecord><ConditionList>${inner}</ConditionList></ClassifiedRecord></VariationArchive></ClinVarResult-Set>`;

describe("parseVcvConditions", () => {
  const conditions = parseVcvConditions(VCV_CNNM2_E357K)!;

  it("reads the variant's own conditions only, never the submitters' wording of them", () => {
    // The record also carries one trait set per submitter, among them the OMIM title of the disease above.
    // Read as conditions they would list that disease a second time, as if it were a different one.
    expect(conditions).toHaveLength(2);
    expect(conditions.map(c => c.label)).not.toContain("HYPOMAGNESEMIA, SEIZURES, AND IMPAIRED INTELLECTUAL DEVELOPMENT 1");
  });

  it("reads every condition, including one that does not count toward the aggregate", () => {
    expect(conditions.map(c => c.label)).toEqual(["Hypomagnesemia, seizures, and intellectual disability 1", "not provided"]);
  });

  it("keeps only the identifiers written on the trait itself", () => {
    // Allelic-variant numbers (607803.0004) and the name-level cross references must not read as diseases.
    expect(conditions[0].xrefs).toEqual([
      { source: "Orphanet", id: "34527" },
      { source: "MedGen", id: "C4225333" },
      { source: "MONDO", id: "MONDO:0020787" },
      { source: "OMIM", id: "616418" },
    ]);
    expect(conditions[1].xrefs).toEqual([{ source: "MedGen", id: "C3661900" }]);
  });

  it("attaches each condition's own germline record and whether it counts toward the aggregate", () => {
    expect(conditions[0].record).toEqual({
      accession: "RCV000172914", classification: "Pathogenic", reviewStatus: "no assertion criteria provided",
      lastEvaluated: "2014-04-01", inAggregate: false,
    });
    expect(conditions[1].record).toMatchObject({ accession: "RCV004819998", inAggregate: true, reviewStatus: "criteria provided, multiple submitters, no conflicts" });
  });

  it("decodes XML entities in names", () => {
    const xml = `<TraitSet ID="1" ContributesToAggregateClassification="true"><Trait ID="2"><Name><ElementValue Type="Preferred">Charcot &amp; Marie &lt;type 1&gt;</ElementValue></Name><XRef ID="MONDO:1" DB="MONDO"/></Trait></TraitSet>`;
    expect(parseVcvConditions(wrap(xml))).toEqual([{ label: "Charcot & Marie <type 1>", xrefs: [{ source: "MONDO", id: "MONDO:1" }] }]);
  });

  it("leaves a condition without a record bare", () => {
    const xml = `<TraitSet ID="7"><Trait ID="2"><Name><ElementValue Type="Preferred">X</ElementValue></Name><XRef ID="MONDO:2" DB="MONDO"/></Trait></TraitSet>`;
    expect(parseVcvConditions(wrap(xml))![0]).not.toHaveProperty("record");
  });

  it("tells a record that was read from text that was not, whatever the number of conditions", () => {
    // A complete record with an empty condition list was read: it has no conditions.
    expect(parseVcvConditions(wrap(""))).toEqual([]);
    // Cut off before its end, an error page, a record type without a condition list, and nothing at all were not.
    expect(parseVcvConditions(VCV_CNNM2_E357K.slice(0, VCV_CNNM2_E357K.indexOf("</VariationArchive>")))).toBeNull();
    expect(parseVcvConditions("<html>maintenance</html>")).toBeNull();
    expect(parseVcvConditions("<ClinVarResult-Set><VariationArchive><IncludedRecord/></VariationArchive></ClinVarResult-Set>")).toBeNull();
    expect(parseVcvConditions("")).toBeNull();
  });

  it("records an unstated aggregate flag as unknown, not false", () => {
    const xml = VCV_CNNM2_E357K.replace(' ContributesToAggregateClassification="false"', "");
    expect(parseVcvConditions(xml)![0].record?.inAggregate).toBeNull();
  });

  it("drops a record whose accession is not an RCV accession", () => {
    const xml = VCV_CNNM2_E357K.replace('Accession="RCV000172914"', 'Accession="javascript:alert(1)"');
    expect(parseVcvConditions(xml)![0]).not.toHaveProperty("record");
  });
});
