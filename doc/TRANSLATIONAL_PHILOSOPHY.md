# Translational philosophy

Status: active product standard. Updated 13 October 2026.

## Premise: clarity for the unfamiliar researcher

A researcher should be able to understand an unfamiliar result without already knowing the
model, metric or method behind it. The workspace must make meaning easy to find, resolve
ambiguity and communicate honestly. Scientific precision and accessible language are both
requirements: neither excuses the absence of the other.

Translate each result into the clearest statement its evidence supports. Preserve its value,
reference frame and provenance, and make the limits of that statement equally clear.

Success is a reader who can explain what was assessed, what the result means, what remains
unknown and what to inspect next. A technically accurate tooltip full of unfamiliar terms
does not satisfy this standard.

## The reader's questions

Every scientific surface must provide a short route to these answers:

1. What question does this result answer?
2. What was observed, calculated, predicted or asserted, and by whom?
3. How do I read the value, direction, units and comparator?
4. What conclusion does this evidence support in this context?
5. What would exceed that evidence, and what uncertainty or missingness matters?
6. What should I inspect next to resolve the remaining question?

Answer the first and fourth questions on the main surface. Put the qualifications that change
their meaning beside them. Exact records and traces belong in the inspector. A contextual
explanation drawer teaches the underlying concept. A drawer must never be the only place
where an important qualification is disclosed.

## Scientific honesty

### Keep the levels of inference visible

Distinguish experimental observations, source assertions, computed geometry, predictive scores,
exploratory hypotheses and recorded clinical criteria. Geometry computed from predicted
coordinates remains conditional on those coordinates. A numerical representation change is
not atomic movement. Stability is not disease causation. A hypothesis becomes an established
claim only when the relevant evidence supports it.

### Define the reference frame

Identify the allele, genome assembly, transcript or protein accession, residue mapping and
structure pair where relevant. Show units, sign convention and normalization. A rank needs its
reference distribution; a delta needs its comparator. Different tools may report opposite
signs for a quantity. Preserve source conventions when presenting normalized comparisons.

### Explain marks without inventing authority

Distinguish published clinical calibration, an author's operating point, an app-defined
reference mark and no established cut-point. Import numerical rules from the shared threshold
definitions. Colour never creates a biological or clinical category on its own.

The recorded rule-engine result determines which criterion this run actually applied. Help
content explains rules generally; it must not manufacture a criterion for the current variant.

### Preserve absence and uncertainty

Missing, zero, confirmed absence, unsupported input, running and failed requests are different
states. Describe the reason and available next action. Do not manufacture reassuring findings
from missingness or a method's inability to measure something.

Label uncertainty by what it measures. Repeat variability, predictive error, input confidence,
coverage and cross-model disagreement are different quantities. A numerical error margin
requires an actual estimate and a stated method. Identical repeated runs do not establish
accuracy. No uncertainty estimate means uncertainty is unquantified.

### Justify aggregation

Putting scores on a bounded scale does not establish comparability, independence or calibration.
Use descriptive agreement only with visible contributors, coverage and exclusions. Do not count
a composite beside its own inputs as independent evidence. A predictive composite requires
reproducible fitting and held-out validation for its stated purpose; missing-input handling is
part of that validation. The retired Local Perturbation Score is not a design requirement.

## Interpretation and language

Lead with meaning, then introduce the technical name. Expand an unfamiliar acronym on first
use. Use concrete subjects and comparators: "the model favours the native residue" is more
informative than "mutation penalty". Explain the direction without overstating causality.

Avoid promotional claims such as "gold standard", "state of the art" and "ultra-fast" in
explanations unless a specific, relevant comparison is cited. Model size belongs in provenance
when known and useful; it is not a proxy for confidence in a particular result.

Short tables can share a unit and legend. Every cell does not need an explanatory paragraph.
Preserve exact values through inspection while choosing readable precision for summaries.
Never round a small non-zero result into an apparent measured zero.

### Examples of useful translation

| Reading | Useful explanation | Unsupported extension |
|---|---|---|
| Negative alternate/native LLR | The model gives the alternate residue less probability than the native residue | The protein is destabilized |
| Positive displayed stability ΔΔG | This method predicts reduced stability under the displayed sign convention | The variant causes disease |
| Higher calculated accessible area | More surface area is accessible in the alternate model | The residue necessarily became less buried |
| High pLDDT | The model reports high local coordinate confidence | The site is functionally important |
| Missing population record | The source returned no record; inspect coverage and lookup state | The allele is absent from every population |

## Contextual explanation drawers

Model, metric and method notices open individual right-side drawers with a dimmed background.
The subject and triggering context determine the explanation. They are not a universal help
browser. Share accessible drawer mechanics, visual tokens and scientific vocabulary; tailor
the content and information hierarchy to the subject.

An explanation must give a plain-language answer, teach how to read the relevant output,
explain its material limitations, and identify its sources and useful next inspection.
Use an annotated scale, comparison, worked example or method sequence where it improves
comprehension. Label illustrative examples; do not present them as this variant's results.

Model explanations must distinguish capabilities from the operation actually performed.
Metric explanations must identify units, direction, comparator and meaningful boundaries.
Method explanations must identify inputs, operations, outputs and assumptions. A run-specific
notice must explain the actual state and consequence using the supplied record.

Opening a drawer keeps the research context intact. It must support keyboard use, Escape,
outside-click dismissal, explicit close, focus restoration, independently scrollable content,
light and dark themes, narrow screens and reduced motion. Its background is inert while open.
Shell shortcuts must yield to the active drawer. Returning from a related concept should restore
the reading position. Large text and short screens must retain both readable content and an exit.

## Workspace-wide application

This standard applies to evidence tabs, figures, legends, inspectors, 3D, Landscape, Insights,
Literature, reports, exports, source explanations and generated narratives. Different biological
questions need different figures; consistent meaning does not require identical layouts.

Use shared pure evidence models for interpretations that appear on several surfaces. Narrative
generation may explain supported findings but cannot strengthen them, add measurements or
replace recorded criteria. Exports retain relevant identity, provenance, coverage and limitations.
Material qualifications must remain visible in the exported reading; speaker notes alone are
insufficient. When the narrative evidence contract changes, invalidate its prior freshness claim
through the existing versioned provenance mechanism.

For every new or changed model, metric or method:

- Identify its question and permitted interpretation.
- Supply a contextual explanation and an entry point beside the relevant reading.
- Cite the method and any separate calibration; label app-defined choices explicitly.
- Verify missing, zero, fallback, disagreement and unsupported-input cases where applicable.
- Check consistency between the reading, explanation, inspector and exported claim.
- Review the rendered explanation for an unfamiliar reader, including keyboard and narrow-screen use.

Coverage is tracked in [the explanation coverage review](TRANSLATIONAL_COVERAGE.md). A topic
existing in a registry alone is not evidence that a reader can discover it in context.

## Authority and history

This document supersedes the external `design_philosophy.md` formerly linked from
`FUTURE_WORK.md`. That proposal established the translational intent but mandated unsupported
composites, a universal displacement mark, and method-specific labels that later audits corrected.

The scientific decisions recorded in [Perturbation](PERTURBATION_REVIEW.md),
[Energetics](ENERGETICS_TAB_REVIEW.md), [the retirement of stacking](CALIBRATED_STACKING.md)
and other domain audits remain the provenance of those corrections. This philosophy introduces
no new clinical criterion, strength, voting rule or numerical threshold.

Relevant primary guidance: [ClinGen computational evidence calibration](https://pmc.ncbi.nlm.nih.gov/articles/PMC9748256/),
[additional tool calibration](https://pmc.ncbi.nlm.nih.gov/articles/PMC12208618/), and
[AlphaFold confidence guidance](https://alphafold.ebi.ac.uk/faq).
