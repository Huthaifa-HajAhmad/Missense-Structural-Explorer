import { describe, it, expect } from "vitest";
import {
  CLINVAR_ABSENCE_SENTENCE,
  clinvarClassificationIsQuotable,
  clinvarPresence,
  type ClinvarPresence,
} from "../clinvarPresence";

/**
 * The state machine that decides what a surface may say about ClinVar.
 *
 * It exists because `clinvar === null` has THREE causes — never queried, timed out, errored — and the
 * first version of the narrative prompt reported all three as "ClinVar was not queried for this run".
 * On a timeout that is a false statement about the run, and the Population rail on the same screen
 * says "The ClinVar query timed out, so this variant's classification could not be read".
 *
 * The assertions below are therefore mostly about which states are DISTINCT, and about the absence
 * sentence never turning a failure to read into a finding of absence.
 */

const HELD = {
  classification: "Pathogenic",
  uid: "123456",
  reviewStatus: "criteria provided, multiple submitters, no conflicts",
  trait: "Hypomagnesemia 1, intestinal",
  alleleFrequencies: [],
  lastEvaluated: "2024-01-01",
};

/** What `clinvar.ts` returns when esearch finds nothing. */
const NOT_FOUND = { classification: "Not found in ClinVar", uid: null };

describe("clinvarPresence", () => {
  it("classifies a real submission as held and quotable", () => {
    expect(clinvarPresence(HELD, { clinvar: "ok" })).toBe("held");
    expect(clinvarClassificationIsQuotable("held")).toBe(true);
  });

  it("separates a FAILED query from an empty one and from an unqueried run", () => {
    // The three states that all arrive as a null record.
    expect(clinvarPresence(null, { clinvar: "timeout" })).toBe("unread");
    expect(clinvarPresence(null, { clinvar: "error" })).toBe("unread");
    expect(clinvarPresence(null, { clinvar: "not_found" })).toBe("recorded-negative");
    expect(clinvarPresence(null, null)).toBe("unqueried");

    const states = new Set<ClinvarPresence>([
      clinvarPresence(null, { clinvar: "timeout" }),
      clinvarPresence(null, { clinvar: "not_found" }),
      clinvarPresence(null, null),
    ]);
    expect(states.size, "a failure to read must not collapse into either absence").toBe(3);
  });

  it("treats a build-gated or in-flight query as unread, not as absence", () => {
    // `unsupported-build` is what the assembly gate records when it refuses before querying at all.
    for (const status of ["unsupported-build", "not-configured", "blocked", "pending"]) {
      expect(clinvarPresence(null, { clinvar: status }), status).toBe("unread");
    }
  });

  it("reads the sentinel case-insensitively, so a differently-cased record is not quoted", () => {
    // `reportStatus.test.ts` exercises "NOT FOUND" and "  Not Found  ". An exact-string comparison
    // would have emitted these as `- Classification: NOT FOUND`.
    for (const sentinel of ["NOT FOUND", "  Not Found  ", "not found in clinvar"]) {
      expect(clinvarPresence({ classification: sentinel, uid: null }), sentinel).toBe("recorded-negative");
    }
  });

  it("distinguishes a submission that records no classification from no submission at all", () => {
    /*
     * `clinvar.ts` yields `classification: "Unknown"` with a real `uid` when a matched entry carries no
     * germline_classification. A submitter DID engage, so "no submitter has classified it" is false —
     * and quoting "Unknown" as database grounding is worse than either.
     */
    expect(clinvarPresence({ classification: "Unknown", uid: "987654" }, { clinvar: "ok" })).toBe("unclassified");
    expect(clinvarPresence({ classification: "", uid: "987654" }, { clinvar: "ok" })).toBe("unclassified");
    expect(clinvarPresence({ classification: "   ", uid: "987654" }, { clinvar: "ok" })).toBe("unclassified");
  });

  it("prefers the failure status over a stale record", () => {
    // A record in hand after a timeout is the previous attempt's, and must not be quoted as this run's
    // result. Status-before-record is the whole reason the order in the implementation is the design.
    expect(clinvarPresence(HELD, { clinvar: "timeout" })).toBe("unread");
    expect(clinvarClassificationIsQuotable(clinvarPresence(HELD, { clinvar: "timeout" }))).toBe(false);
  });

  it("treats an unknown status as no claim rather than as success", () => {
    // A status this module has not seen must fail towards silence. `unqueried` says nothing about
    // ClinVar; `recorded-negative` would say ClinVar holds nothing.
    expect(clinvarPresence(null, { clinvar: "something-new" })).toBe("unqueried");
    expect(clinvarPresence(null, { somethingElse: "ok" })).toBe("unqueried");
  });

  it("never lets an absence sentence assert benignity or a classification", () => {
    for (const [state, sentence] of Object.entries(CLINVAR_ABSENCE_SENTENCE)) {
      expect(sentence, `${state} must not claim a classification`).not.toMatch(/\bclassified as\b/i);
      expect(sentence, `${state} must not claim benignity`).not.toMatch(/\bbenign\b/i);
    }
    // The failure states must say so, in the reader's terms.
    expect(CLINVAR_ABSENCE_SENTENCE.unread).toMatch(/could not be read/i);
    expect(CLINVAR_ABSENCE_SENTENCE.unread).toMatch(/not an absence/i);
    expect(CLINVAR_ABSENCE_SENTENCE.unqueried).toMatch(/was not queried/i);
    expect(CLINVAR_ABSENCE_SENTENCE["recorded-negative"]).toMatch(/no submitter has classified it/i);
  });
});
