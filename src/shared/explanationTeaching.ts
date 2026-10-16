/** Subject-specific teaching figures. Illustrative values never come from the analysed variant. */
export type TeachingFigure =
  | { kind: 'flow'; heading: string; steps: { label: string; text: string }[] }
  | { kind: 'comparison'; heading: string; columns: { label: string; text: string }[]; note: string }
  | { kind: 'example'; heading: string; values: { label: string; value: string }[]; explanation: string };
const flow = (input: string, operation: string, output: string): TeachingFigure => ({ kind: 'flow', heading: 'From input to result', steps: [
  { label: 'Input', text: input }, { label: 'Method', text: operation }, { label: 'Output', text: output },
] });
export const EXPLANATION_TEACHING: Record<string, TeachingFigure> = {
  boltz2: flow('The specified protein chains and their sequences.', 'Predict a candidate assembly for the submitted sequence combination.', 'Complex coordinates, confidence and contacts; binding change is computed separately.'),
  ddmut_ppi: flow('A wild-type complex, a chain and the substitution.', 'Predict the effect of the substitution on protein-protein binding.', 'A signed binding-energy change; negative means weaker binding.'),
  foldx: flow('A protein structure, the substitution and modelling conditions.', 'Repair the template and model the substitution with local side-chain repacking on a fixed backbone.', 'A paired structural comparison, estimated total stability change and separate energy components.'),
  esm2: flow('The protein sequence and the position being scored.', 'Compare the model’s preference for native and alternate amino acids in sequence context.', 'Residue probabilities and a model-native log-likelihood ratio; embeddings where available.'),
  esm1b: flow('Protein sequence context and a candidate substitution.', 'Compare alternate and native sequence likelihoods using the ESM-1b scoring method.', 'A log-likelihood ratio with tool-specific published calibration where applicable.'),
  esmc: flow('The protein sequence and the position being scored.', 'Use the served ESM C model, or a separately identified fallback.', 'Sequence representations and residue preferences on the served model’s own scale.'),
  vesm: flow('The protein sequence.', 'Use a compact distilled language model to score residue preferences.', 'VESM-labelled sequence scores; the result does not inherit the identity of another model.'),
  saprot: flow('An amino-acid sequence and available structure tokens.', 'Combine sequence identity with local structural context; flag unavailable structure tokens.', 'Residue preferences conditional on the context that was actually supplied.'),
  esm3: flow('Native and alternate protein sequences.', 'Compare the returned sequence embeddings for this analysis.', 'A representation distance. Structural generation is a separate operation.'),
  vesm_embedding: flow('Native and alternate sequences within the recorded scoring window.', 'VESM supplies embeddings through the fallback route. Compare paired vectors by cosine distance.', 'Unitless distances at covered residues. Missing positions remain unassessed; these are not LLR scores or coordinate movements.'),
  gpn_star: flow('A genomic substitution, multispecies alignment and phylogenetic context.', 'Estimate reference and alternate nucleotide preferences.', 'A nucleotide-level log-likelihood ratio.'),
  am: flow('A missense substitution with learned sequence and structural context.', 'Retrieve the AlphaMissense prediction and apply the separate published calibration for display.', 'A score, author class and calibrated evidence reading with distinct meanings.'),
  revel: flow('Multiple missense predictor annotations.', 'Combine the annotations in an ensemble model.', 'One REVEL score. Its components are not extra independent evidence.'),
  bayesdel: flow('Predictive annotations in the noAF model, without an allele-frequency feature.', 'Combine the annotations using the BayesDel method.', 'A noAF score; use the calibration for that version.'),
  cadd: flow('Conservation and other genomic annotations.', 'Score the substitution and rank it in the method’s reference distribution.', 'A PHRED-scaled rank, distinct from the raw model score.'),
  eve: flow('An alignment of related protein sequences.', 'Learn the sequence family’s patterns of variation.', 'An evolutionary variant-effect score and source classifications where provided.'),
  popeve: flow('Evolutionary model outputs and human population information.', 'Place scores on a proteome-wide scale.', 'A deleteriousness ranking; crossing neither deleterious mark does not create a benign call.'),
  metarnn: flow('Predictor scores, conservation and population-frequency features.', 'Apply a neural ensemble trained using clinical variant labels.', 'An author-defined deleteriousness score with overlapping evidence inputs.'),
  clinpred: flow('Variant annotations and population-frequency features.', 'Apply an ensemble trained on clinical variant labels.', 'A predicted class score; inspect overlap with ClinVar and frequency evidence.'),
  eigen: flow('Functional and conservation annotations.', 'Combine annotation structure without supervised clinical labels.', 'A raw or PHRED-transformed score; verify which was returned.'),
  dann: flow('Genomic annotations.', 'Apply a neural network to combine the features.', 'A predicted deleteriousness score, presented as informational.'),
  dynamut2: flow('A protein structure and substitution.', 'Combine structural and flexibility-related features in a learned stability method.', 'A stability estimate; the provider’s sign is normalized for the app’s comparison.'),
  ddmut: flow('A protein structure and substitution.', 'Apply a learned model of structural substitution effects.', 'A stability estimate; the provider’s sign is normalized for the app’s comparison.'),
  rasp: flow('A mapped protein and substitution in a precomputed table.', 'Retrieve a prediction from a model trained to approximate Rosetta calculations.', 'A stability estimate conditional on table coverage and its source structure.'),
  protvar: flow('The substitution on the AlphaFold DB model of the canonical sequence.', 'Retrieve the FoldX ΔΔG that EBI ProtVar precomputed on that model.', 'A FoldX estimate on a different template, shown as a cross-check and never counted beside FoldX (it counts as the FoldX reading only when no local value exists on an AlphaFold template).'),
  thermompnn: flow('The local environment of a substitution in a protein structure.', 'Use learned ProteinMPNN-derived structural representations for stability prediction.', 'A predicted stability change.'),
  stabilityoracle: flow('A wild-type structure and candidate substitution.', 'Use a learned structure-based stability predictor.', 'A predicted stabilizing or destabilizing change.'),
  spliceai: flow('The genomic substitution and surrounding DNA sequence.', 'Compare predicted donor and acceptor recognition between reference and alternate.', 'Four gain/loss delta scores and their positions when supplied.'),
  dbscsnv: flow('A substitution within the covered splice consensus region.', 'Apply AdaBoost and random-forest splice-effect predictors.', 'Two related scores with limited regional coverage.'),
  alphagenome: flow('Genomic identity and the Atlas variant features.', 'Combine features into AVI and attribute the raw score to reported inputs.', 'Raw AVI, PHRED rank and feature contributions, each answering a different question.'),
  p2rank: flow('A protein coordinate model and a P2Rank model profile.', 'Score surface points and group them into candidate pockets.', 'Pocket locations, residues and profile-specific rankings.'),
  esmfold: flow('Native and alternate protein sequences.', 'Predict each structure independently, then align matched residues.', 'Candidate coordinates and confidence; differences include prediction variability.'),
  llr: { kind: 'example', heading: 'Illustrative example · one model', values: [
    { label: 'Native residue probability', value: '40%' }, { label: 'Alternate residue probability', value: '4%' }, { label: 'Alternate / native', value: '0.1' },
  ], explanation: 'The model gives native ten times the probability of alternate. The natural logarithm of 0.1 is about −2.30 nats. This compares residue preferences, not disease probabilities.' },
  mutant_rank: { kind: 'comparison', heading: 'Rank and probability answer different questions', columns: [
    { label: 'Rank', text: 'Second among 20 amino acids tells you the order.' },
    { label: 'Probability', text: 'Native 90% and alternate 5% tells you how uneven the preference is.' },
  ], note: 'Illustrative values. Second place can still be much less probable than native.' },
  ddg: { kind: 'comparison', heading: 'Reading the displayed sign', columns: [
    { label: 'Negative', text: 'Predicted stabilization relative to the reference.' },
    { label: 'Positive', text: 'Predicted destabilization relative to the reference.' },
  ], note: 'Zero is the mathematical reference, not a validated boundary for no biological effect. Check method uncertainty and units.' },
  uncertainty: { kind: 'comparison', heading: 'Repeatability and accuracy', columns: [
    { label: 'Repeat variability', text: 'How much the same procedure varies between runs.' },
    { label: 'Prediction error', text: 'How far an estimate may be from the relevant experimental quantity.' },
  ], note: 'A small spread between runs does not establish a small prediction error.' },
  missing_data: { kind: 'comparison', heading: 'Two different evidence states', columns: [
    { label: 'Returned zero', text: 'A method supplied the numerical value zero for the named measurement.' },
    { label: 'No usable result', text: 'There is no value to interpret; the reason determines the next action.' },
  ], note: 'Neither a provider failure nor an unsupported measurement supplies a benign finding.' },
  allele_frequency: { kind: 'example', heading: 'Illustrative count-to-frequency calculation', values: [
    { label: 'Alternate allele copies · AC', value: '2' }, { label: 'Assessed allele copies · AN', value: '10,000' }, { label: 'Frequency · AC / AN', value: '0.0002 = 0.02%' },
  ], explanation: 'The denominator counts assessed allele copies, not people. The same alternate count in a smaller sample produces a different frequency.' },
  embedding_shift: { kind: 'comparison', heading: 'Keep the measured space clear', columns: [
    { label: 'Embedding distance', text: 'Difference between vectors inside a model; read its metric and scale.' },
    { label: 'Coordinate distance', text: 'Difference between positions of matched atoms, measured in angstroms.' },
  ], note: 'These quantities cannot share a physical displacement threshold.' },
  plddt: { kind: 'comparison', heading: 'Confidence belongs to the prediction', columns: [
    { label: 'Local confidence', text: 'How reliable the model expects nearby coordinate geometry to be.' },
    { label: 'Biological effect', text: 'Whether the substitution changes protein function or causes disease.' },
  ], note: 'pLDDT addresses the first question. It does not answer the second.' },
  burial_status: { kind: 'comparison', heading: 'Area and relative exposure', columns: [
    { label: 'SASA · Å²', text: 'The calculated accessible surface area.' },
    { label: 'RSA · fraction or %', text: 'Accessible area divided by a residue-specific reference area.' },
  ], note: 'Changing amino-acid size changes the reference as well as potentially changing the accessible area.' },
  structure_guide: flow('Identify the structure source, residue mapping and colour key.', 'Explore the site and compare matched models using the reported alignment.', 'Describe supported geometry while retaining confidence and modelling limitations.'),
  literature: flow('Read the query, retrieved paper and variant notation.', 'Verify the allele, experiment and relevant passage in the source.', 'Record the specific supported claim, with its citation and limitations.'),
  report: flow('The analysed allele, source evidence and recorded criteria.', 'Review author edits, missing evidence and qualifications before export.', 'A report whose conclusions remain traceable to the underlying evidence.'),
};
