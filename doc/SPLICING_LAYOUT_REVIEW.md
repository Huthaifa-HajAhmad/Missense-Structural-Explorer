# Splicing layout correction

The reporting-window control now accepts the resolved gnomAD locus displayed in the header when submitted metadata has no coordinate. Its genome build must accompany it; request identity includes this pair so late responses cannot cross loci.

The workspace keeps one channel table under the map, removing the duplicate quiet chips and comparison tracks. Legacy standalone rendering is retained. dbscSNV context is visible in the main map view. The junction summary uses a compact grid and the empty inspector prompt is reduced to one sentence.

No thresholds, source scores, engine rules or classifications changed. Existing scientific references in SPLICING_TAB_REVIEW.md remain applicable. The fallback regression uses GATA4 locus 8-11708788-C-G, GRCh38, from the reported header.

Review follow-up: the quiet legend key stays beside the Predicted sites table (which re-uses its mark tone), the accessible map name composes its no-signal placement per layout instead of patching the sentence, and the figure-scope line hides when no contribution is returned. Thread scratch (browser profiles, probe payloads) is git-ignored.
