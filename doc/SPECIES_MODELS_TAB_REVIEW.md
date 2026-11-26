# Species & models review

10 October 2026. Split from Expression & models and implemented as a dedicated Evidence workspace.
See [Context workspaces review](CONTEXT_WORKSPACES_REVIEW.md) for the audit, architecture,
verification and outstanding source limitations.

The three main views are Alliance orthologs, Ensembl variant-site alignments and curated model
phenotypes. Every one-to-many ortholog remains available; grouping uses taxon identity. Pins expose
provider-specific IDs, exact mapping and phenotype coverage. No cross-provider gene equivalence
is inferred from a species label, and no model observation supplies an automatic ACMG vote.

The IMPC source panel now renders every returned screen and preserves unknown availability.
Partial phenotype parsing and per-ortholog failures remain visible. Allele/assay/sex/age details
not present in the current provider contract are explicitly unavailable, not invented.

## Second audit: isoform mapping, review context and the tab answer

Reference variant: ABCG1 p.Gly358Arg. The run's protein is P45844 (678 residues); Ensembl Compara aligns
all ABCG1 orthologs to ENSP00000381467 (666 residues).

| Severity | Finding | Fix |
| --- | --- | --- |
| High | Protein alignments refused every residue when Compara aligned a different human isoform. For ABCG1 this hid 15 real ortholog alignments. | The site is placed on the aligned isoform only when the 21 residues around it occur exactly once there (`src/shared/isoformResidue.ts`, the rule popEVE already used, now shared). Otherwise no residue is mapped, as before. ABCG1 Gly358 maps to residue 358 of ENSP00000381467. |
| High | The count mixed one-to-one vertebrate orthologs with many-to-many family members (8 fly, 3 worm ABC transporters for ABCG1), so "3 of 15" understated a kept residue. | The answer and the card count one-to-one orthologs first ("2 of 4 one-to-one orthologs (mouse, rat)") and list many-to-many records apart. |
| Medium | The tab banner counted species and "identifiers" and never answered the variant question. | `src/shared/speciesFinding.ts` builds one answer (variant-site headline, then Orthologs, Mouse screen and Curated phenotypes lines). The tab and the rail's Reading step render the same object. |
| Medium | Disease onset changed nothing on this tab, yet it was shown and traced. | Onset is hidden on Species & models (field and rail step). Expression keeps it. |
| Medium | The review context showed on Protein alignments, where no choice applies. | Hidden there. On the other views each field says what it changes. |
| Low | The review box repeated its heading ("Review context" over "Shared review context") and folded twice. | Embedded layout: one fold, flat rows split by hairlines, the "Your choices" note in the summary row. The empty GenCC sentence now sits under a "Disease" label. |
| Low | A notice that is also a card body was centred with no side padding (`.ctx-card__body.ctx-notice`), and the alignment card had its frame removed. | One rule in `rail.css` keeps body padding and left alignment for every card; the alignment card is one framed card again. |
| Low | "Choose a disease…" showed when GenCC had no disease to choose; rail said "None selected" where the summary said "All systems". | Caption shown only when a choice exists; both say "All systems". |

No ACMG rule, criterion or score changed: conservation and model phenotypes stay context only.

Not done: the explorer's species table scrolls sideways at about 800px, hiding the phenotype column until
scrolled; Expression's review box has the same repeated heading and could use the embedded layout.

## Code review fixes

| Severity | Finding | Fix |
| --- | --- | --- |
| High | When the cross-species term table could not be read, the answer still said "none match the chosen disease". | It now says the disease overlap could not be checked. A single match also reads "1 matches". |
| Medium | A species with several records was named several times ("fruit fly, fruit fly"). | One shared helper names each species once, in the usual order, and keeps Latin capitals (X. tropicalis). |
| Low | One cause covered different failures, so the reason shown could be wrong. | The run's own reference residue is checked before the isoform. Rows built on different human sequences have their own cause. The card, the answer and the pinned reading share one sentence per cause. |
| Low | A missing protein identifier could print as "null" or as nothing. | It reads "a human protein". |
| Low | The shared isoform rule had no direct test; an unused style class and an outdated end-to-end sentence remained. | Tests added; class removed; the end-to-end test updated. |
