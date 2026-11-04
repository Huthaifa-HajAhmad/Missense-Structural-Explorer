/**
 * Conditions of one ClinVar variant, read from its full record (VCV XML).
 *
 * WHY THIS EXISTS
 * ClinVar's summary endpoint (esummary) lists only the conditions behind the variant's AGGREGATE
 * classification. A condition on a record that does not count toward the aggregate is missing there.
 * Example: CNNM2 p.Glu357Lys. The summary says the only condition is "not provided", but the full
 * record also holds an OMIM-sourced record for "Hypomagnesemia, seizures, and intellectual disability 1"
 * (MONDO:0020787). Matching a selected disease against the summary alone gave a false "not listed".
 *
 * WHAT IT READS
 *   - only the variant's own `<ConditionList>`. The document also holds one `<TraitSet>` per submitter
 *     (`<ClinicalAssertionList>`): hundreds for a common variant, with the submitters' own wording
 *     ("Clinodactyly", "See cases", the OMIM title of a disease already listed). Those are not the
 *     variant's conditions and are never read;
 *   - for each condition (one `<Trait>` in a `<TraitSet>`): the preferred name, and the identifiers
 *     written directly on the trait (MONDO, OMIM, Orphanet, MedGen). Identifiers written inside `<Name>`,
 *     `<Symbol>` or `<AttributeSet>` are NOT the trait's: they include OMIM allelic-variant numbers
 *     (`607803.0004`) that would read as a disease number, so they are skipped;
 *   - the condition's own record (`<RCVAccession>`): accession, germline classification, review status,
 *     date evaluated, and whether it counts toward the aggregate.
 *
 * RETURNS `null` when the text is not a complete variant record (cut off, an error page, or a record
 * type with no condition list). Whether the record was READ is decided here, from the document, and
 * never from how many conditions came out: a record with none is still a record that was read.
 *
 * ClinVar's XML is machine-written and regular, so a few narrow patterns are enough. No XML library is
 * added for one reader. Pure: no network, no clock. Anything not found is left out, never guessed.
 */

export interface ClinVarConditionRecord {
  /** RCV accession: ClinVar's record for this variant and this condition. */
  accession: string;
  classification: string;
  reviewStatus: string;
  lastEvaluated: string;
  /** Whether this record counts toward ClinVar's variant-level aggregate; null when the file does not say. */
  inAggregate: boolean | null;
}

export interface ClinVarCondition {
  label: string;
  xrefs: Array<{ source: string; id: string }>;
  record?: ClinVarConditionRecord;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s: string) => s.replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => ENTITIES[name]).trim();
const attributes = (tag: string) => Object.fromEntries([...tag.matchAll(/([\w:]+)="([^"]*)"/g)].map(m => [m[1], decode(m[2])]));
const RCV_ACCESSION = /^RCV\d{9}$/;

/** The germline record of each condition, keyed by the id of its trait set. */
function readRecords(xml: string): Map<string, Omit<ClinVarConditionRecord, 'inAggregate'>> {
  const records = new Map<string, Omit<ClinVarConditionRecord, 'inAggregate'>>();
  for (const rcv of xml.matchAll(/<RCVAccession\b([^>]*)>([\s\S]*?)<\/RCVAccession>/g)) {
    const accession = attributes(rcv[1]).Accession;
    const traitSetId = /<ClassifiedConditionList\b[^>]*\bTraitSetID="(\d+)"/.exec(rcv[2])?.[1];
    const germline = /<GermlineClassification>([\s\S]*?)<\/GermlineClassification>/.exec(rcv[2])?.[1];
    const description = germline && /<Description\b([^>]*)>([^<]*)<\/Description>/.exec(germline);
    if (!accession || !RCV_ACCESSION.test(accession) || !traitSetId || !germline || !description) continue;
    records.set(traitSetId, {
      accession,
      classification: decode(description[2]),
      reviewStatus: decode(/<ReviewStatus>([^<]*)<\/ReviewStatus>/.exec(germline)?.[1] ?? ''),
      lastEvaluated: attributes(description[1]).DateLastEvaluated ?? '',
    });
  }
  return records;
}

export function parseVcvConditions(xml: string): ClinVarCondition[] | null {
  const list = /<ConditionList>([\s\S]*?)<\/ConditionList>/.exec(xml)?.[1];
  if (list === undefined || !xml.includes('</VariationArchive>')) return null;
  const records = readRecords(xml);
  const conditions: ClinVarCondition[] = [];
  for (const set of list.matchAll(/<TraitSet\b([^>]*)>([\s\S]*?)<\/TraitSet>/g)) {
    const { ID, ContributesToAggregateClassification } = attributes(set[1]);
    const found = ID ? records.get(ID) : undefined;
    const record = found && { ...found, inAggregate: ContributesToAggregateClassification === undefined ? null : ContributesToAggregateClassification === 'true' };
    for (const trait of set[2].matchAll(/<Trait\b[^>]*>([\s\S]*?)<\/Trait>/g)) {
      const label = /<Name>\s*<ElementValue Type="Preferred">([^<]*)<\/ElementValue>/.exec(trait[1])?.[1];
      if (!label) continue;
      const own = trait[1].replace(/<(Name|Symbol|AttributeSet)\b[\s\S]*?<\/\1>/g, '');
      const xrefs = [...own.matchAll(/<XRef\b([^>]*)\/>/g)].map(m => attributes(m[1]))
        .filter(x => x.DB && x.ID && x.Type !== 'Allelic variant')
        .map(x => ({ source: x.DB, id: x.ID }));
      conditions.push({ label: decode(label), xrefs, ...(record ? { record } : {}) });
    }
  }
  return conditions;
}
