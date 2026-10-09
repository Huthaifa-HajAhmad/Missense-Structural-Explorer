import type { AlphaGenomeEvidence } from '../../shared/alphagenomeEvidence';
import { fmtPercent } from '../../shared/alphagenomeEvidence';

/** Onboarding stays beside the real reading, with deeper terminology on demand. */
export function AlphaGenomeGuide({ evidence }: { evidence: AlphaGenomeEvidence }) {
  return <section className="evw-guide" aria-labelledby="avi-guide-title">
    <details className="evw-guide__disclosure"><summary><span className="eyebrow">New to AlphaGenome?</span><span id="avi-guide-title">Read the rank → explore contributors → follow up in context</span></summary>
    <div className="evw-guide__intro"><p>AlphaGenome predicts how a DNA change could affect molecular processes. The Atlas combines those predictions with other inputs into a variant impact score, or AVI.</p></div>
    <ol className="evw-guide__steps">
      <li><span aria-hidden="true">1</span><div><h3>Read the rank</h3><p>{evidence.topPercent !== null ? `Top ${fmtPercent(evidence.topPercent)} describes how few possible single-letter DNA changes score at least this high. It is not the chance that this variant causes disease.` : 'The rank compares this variant with possible single-letter DNA changes across the genome. An unavailable rank does not imply low impact.'}</p></div></li>
      <li><span aria-hidden="true">2</span><div><h3>Explore the contributors</h3><p>Longer marks have more influence on the raw score. Select a feature to learn what it represents. Colour distinguishes molecular predictions from other inputs; it does not mean harmful or protective.</p></div></li>
      <li><span aria-hidden="true">3</span><div><h3>Follow up in context</h3><p>Use the Atlas links to inspect predicted tracks and biosamples. A leading contribution suggests something to investigate; it does not establish the affected tissue or a disease mechanism.</p></div></li>
    </ol>
    </details>
    <details className="evw-glossary"><summary>What do AVI, Phred and SHAP mean?</summary>
      <dl><div><dt>AVI</dt><dd>A model score trained using rare and common variants as proxy labels. It supports prioritisation and is not counted as an ACMG criterion here.</dd></div>
        <div><dt>Phred rank</dt><dd>A logarithmic way to express genome-wide rank. A larger value means a smaller fraction of possible variants score as highly.</dd></div>
        <div><dt>SHAP contribution</dt><dd>An attribution to the model’s raw score. Positive raises that score; negative lowers it. Neither sign gives the direction of a biological change.</dd></div>
        <div><dt>Contribution share</dt><dd>The absolute size of one returned contribution divided by the summed absolute sizes. Missing features are excluded, so partial coverage limits the interpretation.</dd></div></dl>
      <a href="https://doi.org/10.64898/2026.09.16.26363192" target="_blank" rel="noopener noreferrer">Read the Atlas methods (preprint; opens in a new tab)</a>
    </details>
  </section>;
}
