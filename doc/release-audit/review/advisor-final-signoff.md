# CLEAR FOR MERGE

**#2 cleared.** The transcript comparison requires an explicit version and an exact match. With two unversioned NM_000546 records and no genomic identifiers, the regression test confirms that the lookup selects the requested c.396G>C record (12366) and withholds PS1 evidence from c.396G>T. The corresponding versioned case still provides PS1 evidence.

All 31 tests in the two ClinVar files passed with zero skips. The TypeScript check passed with `tsc --noEmit`.

**#4 cleared.** The regression test ran both views with only the core and narrative stages marked complete. Insights and Report both returned unavailable. The Report hook and copy action now include both clinical loading flags.

**#6 cleared.** Coverage caching requires a positive query length. An incomplete peptide check evicts cached coverage so a retry can fetch fresh data. The DDMut-PPI fallback requires a positive query length before considering entry ranges.

In the earlier review, all 64 tests in the five requested files passed with zero skips. TypeScript passed with `tsc --noEmit`. This focused check carries forward the earlier clearance of the other findings.
