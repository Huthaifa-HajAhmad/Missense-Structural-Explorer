/**
 * attributions.ts — Third-party credit registry for the About page.
 *
 * WHY THIS IS A MODULE AND NOT PAGE COPY
 * --------------------------------------
 * The About page is the one surface whose whole job is to say *who else made this
 * possible*. That makes it the surface where a wrong claim costs the most: a DOI that
 * does not resolve, a version the code never pinned, or a licence note that is missing on
 * a licence-bound tool are all misattributions, and a reader who finds one has no reason
 * to trust the rest of the page. Keeping the credits as data — with the repository path
 * that actually calls each source recorded beside it — means the page can be corrected
 * once, and that every claim is checkable rather than remembered.
 *
 * WHAT THIS FILE IS NOT
 * ---------------------
 * `shared/provenance.ts` is the *run* manifest: which releases and model revisions served
 * one specific analysis, exported with the report. This file is the standing *credit roll*:
 * what the workspace depends on at all. The two overlap deliberately at one point —
 * `PROVENANCE_MODEL_REVISIONS` holds the pinned weights the rail prints, and the model
 * entries here cite the papers — so the page never restates a revision, it links to the
 * manifest rail for the numbers and the paper for the science.
 *
 * `release: null` is a load-bearing value: it means the code establishes no version, and
 * the page must say so rather than invent one. Do not fill those in from a vendor's
 * marketing page.
 */

/** What kind of third party this is, used to group and to pick the row's chip label. */
export type AttributionKind = "dataset" | "model" | "service" | "software";

export interface AttributionEntry {
  /** Stable id: React key, and the fragment a deep link can target. */
  id: string;
  /** Display name of the thing being credited. */
  name: string;
  /** Who maintains it. Named so credit lands on people, not on a domain. */
  provider: string;
  kind: AttributionKind;
  /** What this workspace actually uses it for, in one sentence. */
  role: string;
  /** Canonical landing page or the endpoint itself. */
  url: string;
  /**
   * The release the pipeline pins or is observed to use. `null` when the code
   * establishes none — the page then says so explicitly.
   */
  release: string | null;
  /**
   * Why the release is what it is, when that needs saying — most often because the manifest
   * declares a string the code does not establish. Rendered under the release, never inside it,
   * so a version column never has to hold a paragraph.
   */
  releaseNote?: string;
  /** Full citation as it should appear in a report bibliography. `null` when none fits. */
  citation: string | null;
  /**
   * Access or redistribution terms a reader must know before reusing the output.
   * Only set where the constraint is real and documented.
   */
  licence?: string;
  /**
   * Repository paths that call this source. This is what makes the credit verifiable:
   * a reader can open the file and see the query.
   */
  usedBy: string[];
}

export interface AttributionGroup {
  id: string;
  /** Anchor target and section heading. */
  title: string;
  /** Why the group exists — what its members have in common. */
  blurb: string;
  entries: AttributionEntry[];
}

/**
 * Group 1 — the evidence floor.
 *
 * Everything here answers "what is already known about this variant" before a model runs.
 * Two entries (`myvariant`, `genos`) are supplementary routes, and one (`string-db`) is
 * recorded as deliberately unpinned: the client queries a live endpoint and never reads a
 * version, so the page must not print one.
 */
const REFERENCE_SOURCES: AttributionEntry[] = [
  {
    id: 'dgtex', name: 'Developmental GTEx', provider: 'dGTEx Consortium / NDRI / Broad Institute', kind: 'dataset',
    role: 'Pediatric tissue and public age-cohort gene TPM, summarized by donor from a locally installed snapshot; context only.',
    url: 'https://gtexportal.org/home/downloads/developmental-gtex', release: 'dGTEx Analysis V1 / GENCODE v47',
    releaseNote: 'Pinned data may differ from the latest portal release. Public age cohorts do not disclose exact ages.',
    citation: 'Coorens, T. H. H., et al. (2025). The human and non-human primate developmental GTEx projects. Nature 637, 557–564. https://doi.org/10.1038/s41586-024-08244-9',
    licence: 'GTEx Portal data licence: attribution, no endorsement, and disclose when distributed data is not current.',
    usedBy: ['scripts/import-dgtex-context.py', 'server/services/evidence-context/dgtex.ts', 'src/components/evidence/DevelopmentalExpressionCard.tsx'],
  },
  {
    id: 'g2p', name: 'Gene2Phenotype', provider: 'EMBL-EBI / G2P curators', kind: 'dataset',
    role: 'Gene–disease mechanism records retaining allelic requirement, modifiers, confidence and support; context only.',
    url: 'https://www.ebi.ac.uk/gene2phenotype/', release: null,
    releaseNote: 'Operator bulk snapshot fingerprint and review dates are retained; no release identifier is invented.',
    citation: null, licence: 'EMBL-EBI Terms of Use; source attribution requested. No CC licence is inferred from the paper or software.',
    usedBy: ['scripts/import-g2p-context.ts', 'server/services/evidence-context/g2p.ts', 'src/components/evidence/MechanismContextCard.tsx'],
  },
  {
    id: 'gencc', name: 'GenCC', provider: 'Gene Curation Coalition and contributing submitters', kind: 'dataset',
    role: 'Per-submitter gene–disease validity assertions, scoped to disease and inheritance; context only.',
    url: 'https://thegencc.org/', release: null,
    releaseNote: 'The installed snapshot reports its retrieval time and hash; no source release identifier is invented.',
    citation: null, licence: 'CC0 1.0; attribution requested to GenCC and contributing sources.',
    usedBy: ['scripts/import-gencc-context.ts', 'server/services/evidence-context/gencc.ts', 'src/components/evidence/GeneDiseaseTab.tsx'],
  },
  {
    id: 'clingen-dosage', name: 'ClinGen dosage sensitivity', provider: 'ClinGen Dosage Sensitivity Working Group', kind: 'dataset',
    role: 'Gene-level haploinsufficiency and triplosensitivity calls with curated disease; context only, no ACMG vote.',
    url: 'https://search.clinicalgenome.org/kb/gene-dosage', release: null,
    releaseNote: 'Fetched live and cached for a day; the response carries no release identifier, so none is invented.',
    citation: null, licence: 'ClinGen terms of use; attribution requested.',
    usedBy: ['server/services/evidence-context/clingenDosage.ts', 'src/components/evidence/DosageSensitivityCard.tsx'],
  },
  {
    id: 'gtex', name: 'GTEx', provider: 'GTEx Consortium / Broad Institute', kind: 'dataset',
    role: 'Adult tissue median gene expression and RNA-seq cohort sample counts; context only.',
    url: 'https://gtexportal.org/', release: 'gtex_v10 / GENCODE v39',
    citation: null, licence: 'GTEx portal data-use and citation policies apply.',
    usedBy: ['server/services/evidence-context/gtex.ts', 'src/components/evidence/ExpressionModelsTab.tsx'],
  },
  {
    id: "gnomad",
    name: "gnomAD",
    provider: "Broad Institute (gnomAD Consortium)",
    kind: "dataset",
    role: "Population allele frequencies, cohort counts and gene-level constraint (pLI, missense Z, LOEUF) — the numbers the ACMG engine's PM2, BS1 and BA1 arms actually read.",
    url: "https://gnomad.broadinstitute.org/",
    release: "r4 (GraphQL API)",
    citation:
      "Chen, S., et al. (2024). A genomic mutational constraint map using variation in 76,156 human genomes. Nature 625, 92–100. https://doi.org/10.1038/s41586-023-06045-0",
    usedBy: ["server/services/external-api/gnomad.ts", "server/services/prediction/landscape.ts"]
  },
  {
    id: "clinvar",
    name: "ClinVar",
    provider: "National Center for Biotechnology Information (NCBI)",
    kind: "dataset",
    role: "Curated clinical significance, review status and reported conditions, retrieved through the E-utilities esearch/esummary endpoints for a gene plus protein change.",
    url: "https://www.ncbi.nlm.nih.gov/clinvar/",
    /*
     * Not established. "2024-latest" is a hand-maintained string (server/services/infra/
     * cache-keys.ts) that the app uses to version its cache keys; no code reads a version back
     * from NCBI. It is repeated here only so the reader can see exactly what the workspace
     * claims for itself, and not because the value was observed.
     */
    release: null,
    releaseNote: "The manifest's \"2024-latest\" is a hand-maintained cache-key string, not a version read back from NCBI.",
    citation:
      "Landrum, M. J., et al. (2020). ClinVar: improvements to accessing data. Nucleic Acids Research 48, D835–D844. https://doi.org/10.1093/nar/gkz972",
    usedBy: ["server/services/external-api/clinvar.ts"]
  },
  {
    id: "dbnsfp",
    name: "dbNSFP",
    provider: "Liu & Boerwinkle laboratory, UTHealth Houston",
    kind: "dataset",
    role: "Precomputed per-substitution predictor columns — REVEL, CADD, AlphaMissense, MetaRNN, ClinPred, Eigen, DANN, BayesDel, ESM-1b, GERP++, phyloP — used to answer predictor lookups locally instead of over the network.",
    url: "https://sites.google.com/site/jpopgen/dbNSFP",
    /*
     * The release is deliberately NOT stated as "4.4a", even though that is the string in
     * `PROVENANCE_DATA_SOURCES` and the cache-key registry. The ingest writes its artefact to
     * `data/dbnsfp_v5.sqlite` (tools/ingest_dbnsfp.ts:13), so the manifest and the artefact
     * name disagree and the code establishes neither. A reader told "4.4a" would have no way
     * to know that.
     */
    release: null,
    releaseNote: "The manifest declares \"4.4a\", but the local ingest writes data/dbnsfp_v5.sqlite. Which release is held locally is unresolved — see doc/ARCHITECTURE.md §6.",
    citation:
      "Liu, H., et al. (2020). dbNSFP v4: a comprehensive database of transcript-specific functional predictions and annotations for human nonsynonymous and splice-site SNVs. Genome Medicine 12, 103. https://doi.org/10.1186/s13073-020-00803-9",
    licence:
      "Offered by its authors for academic use; the ingest keeps only the columns this workspace reads. Check the release's own terms before redistributing the database itself.",
    usedBy: ["tools/ingest_dbnsfp.ts", "server/services/dbnsfp_local.ts", "server/services/prediction/predictors/dbnsfp-query.ts"]
  },
  {
    id: "uniprot",
    name: "UniProt Knowledgebase",
    provider: "UniProt Consortium (EMBL-EBI, SIB, PIR)",
    kind: "dataset",
    role: "Canonical and isoform sequences, accessions and curated feature annotations (domains, binding sites, mutagenesis, alternative products) behind every structure model and the functional-domain track.",
    url: "https://www.uniprot.org/",
    release: null,
    citation:
      "UniProt Consortium (2023). UniProt: the Universal Protein Knowledgebase in 2023. Nucleic Acids Research 51, D523–D531. https://doi.org/10.1093/nar/gkac1052",
    usedBy: ["server/services/external-api/uniprot.ts", "server/services/prediction/predictors/transcript-resolver.ts", "server/services/llm/curated-literature.ts"]
  },
  {
    id: "ensembl-vep",
    name: "Ensembl VEP REST",
    provider: "Ensembl / EMBL-EBI",
    kind: "service",
    role: "The notation gateway: resolves a gene plus HGVS protein change (or a genomic coordinate) to a transcript, a consequence, a UniProt accession and — critically — the residue numbering a result is expressed on.",
    url: "https://rest.ensembl.org/",
    release: "GRCh38 host (rest.ensembl.org) and GRCh37 host (grch37.rest.ensembl.org)",
    citation:
      "McLaren, W., et al. (2016). The Ensembl Variant Effect Predictor. Genome Biology 17, 122. https://doi.org/10.1186/s13059-016-0974-4",
    usedBy: ["server/services/prediction/predictors/vep-orchestrator.ts", "server/services/translation/coordinate-resolver.ts"]
  },
  {
    id: "variant-validator",
    name: "VariantValidator",
    provider: "University of Leicester / openvar",
    kind: "service",
    role: "The second opinion on HGVS. When VEP cannot settle which isoform a notation is numbered on, this service is consulted rather than assuming canonical numbering.",
    url: "https://rest.variantvalidator.org/",
    release: null,
    citation:
      "Freeman, P. J., et al. (2018). VariantValidator: accurate validation, mapping, and formatting of sequence variation descriptions. Human Mutation 39, 61–68. https://doi.org/10.1002/humu.23348",
    usedBy: ["server/services/translation/variant-validator.ts", "server/services/prediction/predictors/transcript-resolver.ts"]
  },
  {
    id: "myvariant",
    name: "MyVariant.info",
    provider: "The Su Lab, Scripps Research",
    kind: "service",
    role: "Fallback annotation and predictor lookup used when the primary route cannot answer. Records are keyed by an hg19 `_id`, which is why a coordinate sourced this way is tagged GRCh37 instead of being assumed GRCh38.",
    url: "https://docs.myvariant.info/",
    release: null,
    citation:
      "Xin, J., et al. (2016). High-performance web services for querying gene and variant annotation. Genome Biology 17, 95. https://doi.org/10.1186/s13059-016-0953-9",
    usedBy: ["server/services/prediction/predictors/vep-orchestrator.ts", "server/services/prediction/landscape.ts"]
  },
  {
    id: "alphafold-db",
    name: "AlphaFold Protein Structure Database",
    provider: "Google DeepMind & EMBL-EBI",
    kind: "dataset",
    role: "The default wild-type 3D model. The current model version is resolved through the EBI prediction API before a file is downloaded, because the CDN path's version suffix is not stable.",
    url: "https://alphafold.ebi.ac.uk/",
    release: "Version resolved per request from the EBI prediction API — no fixed version is pinned",
    citation:
      "Varadi, M., et al. (2022). AlphaFold Protein Structure Database: massively expanding the structural coverage of protein-sequence space with high-accuracy models. Nucleic Acids Research 50, D439–D444. https://doi.org/10.1093/nar/gkab1061 · Method: Jumper, J., et al. (2021). Highly accurate protein structure prediction with AlphaFold. Nature 596, 583–589. https://doi.org/10.1038/s41586-021-03819-2",
    usedBy: ["server/services/structure/structure-fetcher.ts", "server/services/structure/structure-resolver.ts"]
  },
  {
    id: "rcsb-pdb",
    name: "RCSB Protein Data Bank",
    provider: "wwPDB (RCSB PDB)",
    kind: "dataset",
    role: "Experimental coordinate files, entry metadata, and the sequence homolog search behind the comparison structures. Which entry best covers a residue is decided by PDBe's mapping (below), not here.",
    url: "https://www.rcsb.org/",
    release: null,
    citation:
      "Berman, H. M., et al. (2000). The Protein Data Bank. Nucleic Acids Research 28, 235–242. https://doi.org/10.1093/nar/28.1.235",
    usedBy: ["server/services/structure/structure-fetcher.ts", "server/services/structure/pocket/runner.ts"]
  },
  {
    id: "pdbe",
    name: "PDBe and SIFTS mappings",
    provider: "Protein Data Bank in Europe (EMBL-EBI)",
    kind: "service",
    role: "The best-structure ranking that prefers an experimental entry when one covers the residue, the UniProt-to-PDB residue mappings an alignment is checked against, and the interface residues behind the protein-interactions panel.",
    url: "https://www.ebi.ac.uk/pdbe/",
    release: null,
    citation:
      "Armstrong, D. R., et al. (2020). PDBe: improved findability of macromolecular structure data in the PDB. Nucleic Acids Research 48, D335–D343. https://doi.org/10.1093/nar/gkz990",
    usedBy: ["server/services/structure/structure-fetcher.ts", "server/services/structure/sequence-aligner.ts", "server/services/external-api/pdbe-interfaces.ts"]
  },
  {
    id: "string-db",
    name: "STRING-db",
    provider: "STRING Consortium (Szklarczyk et al.)",
    kind: "dataset",
    role: "Functional interaction partners and their combined association-confidence scores for the protein-interaction panel.",
    url: "https://string-db.org/",
    release: null,
    citation:
      "Szklarczyk, D., et al. (2023). The STRING database in 2023: protein–protein association networks and functional enrichment analyses for any sequenced genome of interest. Nucleic Acids Research 51, D638–D646. https://doi.org/10.1093/nar/gkac1000",
    licence:
      "The client queries the live endpoint and never reads a version, so a result states no STRING release. That gap is recorded rather than papered over: do not cite a STRING version from this workspace.",
    usedBy: ["server/services/external-api/string.ts", "server/services/external-api/ppi.ts"]
  },
  {
    id: "spliceai",
    name: "SpliceAI Lookup",
    provider: "Broad Institute (lookup service); the SpliceAI model is Illumina's",
    kind: "dataset",
    role: "Donor and acceptor gain/loss delta scores (DS_AG, DS_AL, DS_DG, DS_DL) around a variant, plus the reference distance the junction geometry is measured against.",
    url: "https://spliceailookup.broadinstitute.org/",
    release: "Per-build endpoints served for GRCh38 and GRCh37",
    citation:
      "Jaganathan, K., et al. (2019). Predicting splicing from primary sequence with deep learning. Cell 176, 535–548. https://doi.org/10.1016/j.cell.2018.12.015",
    usedBy: ["server/services/external-api/spliceai_broad.ts", "server/services/prediction/predictors/conservation-orchestrator.ts"]
  },
  {
    id: "ucsc",
    name: "UCSC Genome Browser API",
    provider: "UCSC Genomics Institute, University of California, Santa Cruz",
    kind: "service",
    role: "Exon boundaries from the hg38 gene-annotation tracks, read in a window around the variant so the splice geometry is measured against real junctions rather than inferred ones.",
    url: "https://genome.ucsc.edu/goldenPath/help/api.html",
    release: "hg38 annotation tracks, read live",
    citation:
      "Kent, W. J., et al. (2002). The human genome browser at UCSC. Genome Research 12, 996–1006. https://doi.org/10.1101/gr.229102",
    usedBy: ["server/services/prediction/splice_resolver.ts"]
  },
  {
    id: "dbscsnv",
    name: "dbscSNV",
    provider: "Jian, Boerwinkle & Liu (UTHealth Houston)",
    kind: "dataset",
    role: "AdaBoost and Random Forest splice-consensus scores, shown beside SpliceAI as context on the authors' 0.6 cut-point. They make no call: the splicing rule reads SpliceAI alone (Walker 2023).",
    url: "https://doi.org/10.1093/nar/gku1206",
    release: null,
    citation:
      "Jian, X., Boerwinkle, E., & Liu, X. (2014). In silico prediction of splice-altering single nucleotide variants in the human genome. Nucleic Acids Research 42, 13534–13544. https://doi.org/10.1093/nar/gku1206",
    usedBy: ["src/shared/splicingEvidence.ts", "server/services/prediction/predictors/dbnsfp-query.ts"]
  },
  {
    id: "consurf",
    name: "ConSurf",
    provider: "Ben-Tal laboratory, Tel Aviv University",
    kind: "dataset",
    role: "Per-residue evolutionary conservation grades shown on the sequence track and used as corroboration when a predictor is silent.",
    url: "https://consurf.tau.ac.il/",
    release: null,
    citation:
      "Ashkenazy, H., et al. (2016). ConSurf 2016: an improved methodology to estimate and visualize evolutionary conservation in macromolecules. Nucleic Acids Research 44, W344–W350. https://doi.org/10.1093/nar/gkw408",
    usedBy: ["server/services/prediction/predictors/consurf-resolver.ts"]
  },
  {
    id: "popeve-data",
    name: "popEVE precomputed score tracks",
    provider: "Marks Lab, Harvard University",
    kind: "dataset",
    role: "popEVE scores for human proteins, fetched per RefSeq transcript and matched on GRCh38 coordinates.",
    url: "https://data.evemodel.org/",
    release: "popEVE v1.1",
    citation:
      "Orenbuch, R., et al. (2025). Proteome-wide model for human disease genetics. Nature Genetics 57, 3165–3174. https://doi.org/10.1038/s41588-025-02400-1",
    usedBy: ["server/services/prediction/predictors/popeve-resolver.ts", "scripts/setup-popeve.sh"]
  },
  {
    id: "genos",
    name: "Genos",
    provider: "Genos (query.genos.us)",
    kind: "service",
    role: "A supplementary, credentialed variant-annotation query, consulted beside the primary routes when a deployment configures an account. Calls are serialised through one rate-limited queue because the service throttles per account.",
    url: "https://query.genos.us/",
    release: null,
    citation: null,
    licence: "Requires a Genos account configured for this deployment (GENOS_EMAIL, GENOS_ACCESS_KEY); without one the route is skipped.",
    usedBy: ["server/services/external-api/genos_web.ts", "server/services/external-api/core-data-fetcher.ts"]
  }
];
/**
 * Group 2 — learned scorers.
 *
 * Every entry here is somebody's trained model. The workspace's own rule is that a score
 * may only be tinted against a cut-point that was calibrated for *that* model's scale, so
 * the page states which of these are calibrated and which are informational rather than
 * letting one threshold speak for all of them. Pinned weight revisions are not repeated
 * here — the provenance rail prints those from `PROVENANCE_MODEL_REVISIONS`.
 */
const MODEL_SOURCES: AttributionEntry[] = [
  {
    id: "esm2",
    name: "ESM-2",
    provider: "Meta FAIR (Fundamental AI Research)",
    kind: "model",
    role: "Zero-shot masked-marginal log-likelihood ratios (ΔLLR) for the wild-type to mutant substitution, from the pinned 650M (and smaller 150M) checkpoints.",
    url: "https://huggingface.co/facebook/esm2_t33_650M_UR50D",
    release: "Weights pinned by commit SHA in the provenance manifest",
    citation:
      "Lin, Z., et al. (2023). Evolutionary-scale prediction of atomic-level protein structure with a language model. Science 379, 1123–1130. https://doi.org/10.1126/science.ade2574",
    usedBy: ["server/services/external-api/esm2.ts", "src/shared/modelCalibration.ts"]
  },
  {
    id: "esm3-esmc",
    name: "ESM-3 and ESMC",
    provider: "EvolutionaryScale (served through the Biohub Platform)",
    kind: "model",
    role: "De novo folding requests and the zero-shot ESMC variant-fitness score. A biohub token is required; without one the workspace falls back to the local VESM embedding model rather than inventing a number.",
    url: "https://www.evolutionaryscale.ai/",
    release: "Served by the remote platform — the workspace pins no revision",
    citation:
      "Hayes, T., et al. (2025). Simulating 500 million years of evolution with a language model. Science 387, 850–858. https://doi.org/10.1126/science.ads0018",
    usedBy: ["server/services/external-api/esmc.ts", "server/services/external-api/esm3_forge.ts", "server/services/structure/esmfold.ts"]
  },
  {
    id: "esmfold",
    name: "ESMFold",
    provider: "Meta FAIR (Fundamental AI Research)",
    kind: "model",
    role: "De novo wild-type folding for the ESMFold view, from sequence alone. Served by JapanFold or EvolutionaryScale Forge when available, falling back to the keyless ESM Metagenomic Atlas endpoint; the engine that answered is recorded with the structure.",
    url: "https://esmatlas.com/about",
    release: "Engine recorded per structure — the workspace pins no revision",
    citation:
      "Lin, Z., et al. (2023). Evolutionary-scale prediction of atomic-level protein structure with a language model. Science 379, 1123–1130. https://doi.org/10.1126/science.ade2574",
    usedBy: ["server/services/structure/esmfold.ts"]
  },
  {
    id: "boltz2",
    name: "Boltz-2",
    provider: "Boltz team (MIT Jameel Clinic) with Recursion",
    kind: "model",
    role: "Complex structure prediction on the Interfaces & PPI tab, run on request: the variant complex, and, only when no solved complex of the protein exists, the wild-type complex that DDMut-PPI scores. Run on JapanFold.",
    url: "https://github.com/jwohlwend/boltz",
    release: null,
    citation:
      "Passaro, S., Corso, G., Wohlwend, J., et al. (2025). Boltz-2: towards accurate and efficient binding affinity prediction. bioRxiv. https://doi.org/10.1101/2025.06.14.659707",
    usedBy: ["server/services/external-api/japanfold-client.ts", "server/services/structure/multimer.ts"]
  },
  {
    id: "saprot",
    name: "SaProt 650M AF2",
    provider: "Westlake University",
    kind: "model",
    role: "Structure-aware ΔLLR: the sequence is interleaved with Foldseek 3Di structural tokens, so the likelihood is conditioned on the actual 3D fold rather than on the sequence alone.",
    url: "https://huggingface.co/westlake-repl/SaProt_650M_AF2",
    release: "Weights pinned by commit SHA in the provenance manifest (35M variant selectable)",
    citation:
      "Su, J., et al. (2024). SaProt: protein language modeling with structure-aware vocabulary. ICLR 2024; bioRxiv preprint https://doi.org/10.1101/2023.10.01.560349",
    usedBy: ["server/services/external-api/saprot.ts", "src/shared/perturbationModels.ts"]
  },
  {
    id: "vesm",
    name: "VESM++ (co-distilled)",
    provider: "Ntranos laboratory",
    kind: "model",
    role: "The local sidecar model: a 150M-parameter distillation used for embedding and fitness scoring when remote ESM-3/ESMC is unavailable. Strictly informational — it casts no ACMG vote.",
    url: "https://github.com/ntranoslab/vesm",
    release: "ntranoslab/vesm · VESM_150M.pth (see the provenance rail)",
    citation:
      "Dinh, T., et al. (2026). Compressing the collective knowledge of ESM into a single protein language model. Nature Methods 23, 772–784. https://doi.org/10.1038/s41592-026-03050-9",
    usedBy: ["tools/model_server.py", "src/shared/perturbationModels.ts"]
  },
  {
    id: "alphamissense",
    name: "AlphaMissense",
    provider: "Google DeepMind",
    kind: "model",
    role: "A 0–1 pathogenicity score for the substitution, voted in the PP3/BP4 rule against ClinGen's calibrated bands (Bergquist et al. 2025: PP3 ≥ 0.792, BP4 ≤ 0.169). The authors' own classes (0.34 / 0.564) are not a calibration.",
    url: "https://github.com/google-deepmind/alphamissense",
    release: "Precomputed genome-wide tracks, read via dbNSFP or the AlphaMissense release",
    citation:
      "Cheng, J., et al. (2023). Accurate proteome-wide missense variant effect prediction with AlphaMissense. Science 381, eadg7492. https://doi.org/10.1126/science.adg7492",
    usedBy: ["src/shared/thresholds/evaluators.ts", "src/components/evidence/PredictorsTab.tsx"]
  },
  {
    id: "alphagenome",
    name: "AlphaGenome",
    provider: "Google DeepMind",
    kind: "model",
    role: "Regulatory and splice-region effect tracks with per-feature attributions. Scored on GRCh38 only, so a GRCh37 coordinate is refused with the build named rather than scored on the wrong locus.",
    url: "https://deepmind.google.com/science/alphagenome/",
    release: "AlphaGenome Atlas (live service; the workspace pins no revision)",
    citation:
      "Avsec, Ž., et al. (2026). Advancing regulatory variant effect prediction with AlphaGenome. Nature 649, 1206–1218. https://doi.org/10.1038/s41586-025-10014-0",
    usedBy: ["server/services/external-api/alphagenome-bridge.ts", "src/shared/assembly.ts"]
  },
  {
    id: "gpn-star",
    name: "GPN-Star",
    provider: "Song Lab, University of California, Berkeley",
    kind: "model",
    role: "Phylogeny-aware genomic language-model LLR across vertebrate alignments — the conservation prior read at nucleotide resolution, including non-coding positions.",
    url: "https://huggingface.co/datasets/songlab/gpn-msa-hg38-scores",
    release: "hg38 score tracks (GRCh38 only)",
    citation:
      "Ye, C., Benegas, G., et al. (2025). Predicting functional constraints across evolutionary timescales with phylogeny-informed genomic language models. bioRxiv. https://doi.org/10.1101/2025.09.21.677619",
    usedBy: ["server/services/external-api/gpn.ts", "src/shared/thresholds/evaluators.ts"]
  },
  {
    id: "eve",
    name: "EVE",
    provider: "Marks Lab, Harvard University",
    kind: "model",
    role: "Variational-autoencoder fitness model trained on evolutionary sequence families; the base model behind the population-calibrated popEVE score.",
    url: "https://evemodel.org/",
    release: null,
    citation:
      "Frazer, J., et al. (2021). Disease variant prediction with deep generative models of evolutionary data. Nature 599, 91–95. https://doi.org/10.1038/s41586-021-04043-8",
    usedBy: ["server/services/prediction/predictors/popeve-resolver.ts"]
  },
  {
    id: "revel",
    name: "REVEL",
    provider: "Ioannidis et al. (ensemble of 13 predictors)",
    kind: "model",
    role: "Ensemble pathogenicity score; one arm of the PP3/BP4 vote, called against ClinGen's calibrated bands (Pejaver et al. 2022: PP3 ≥ 0.644, BP4 ≤ 0.290) and shown as the calibrated single-tool reference.",
    url: "https://sites.google.com/site/revelgenomics/",
    release: null,
    citation:
      "Ioannidis, N. M., et al. (2016). REVEL: an ensemble method for predicting the pathogenicity of rare missense variants. American Journal of Human Genetics 99, 877–885. https://doi.org/10.1016/j.ajhg.2016.08.016",
    usedBy: ["src/shared/thresholds/evaluators.ts", "src/components/evidence/PredictorsTab.tsx"]
  },
  {
    id: "cadd",
    name: "CADD",
    provider: "Kircher (Berlin Institute of Health) and Shendure (University of Washington) laboratories",
    kind: "model",
    role: "PHRED-scaled deleteriousness integrating conservation, epigenetic and functional annotations; reported as a supporting in-silico signal.",
    url: "https://cadd.gs.washington.edu/",
    release: null,
    citation:
      "Kircher, M., et al. (2014). A general framework for estimating the relative pathogenicity of human genetic variants. Nature Genetics 46, 310–315. https://doi.org/10.1038/ng.2892",
    usedBy: ["src/shared/thresholds/evaluators.ts", "src/components/evidence/PredictorsTab.tsx"]
  },
  {
    id: "metarnn",
    name: "MetaRNN",
    provider: "Li et al. (Genome Medicine)",
    kind: "model",
    role: "Recurrent ensemble over 28 deep-learning, conservation and structural features, used as a supporting computational signal.",
    url: "https://doi.org/10.1186/s13073-022-01120-z",
    release: null,
    citation:
      "Li, C., et al. (2022). MetaRNN: differentiating rare pathogenic and rare benign missense SNVs and InDels using deep learning. Genome Medicine 14, 115. https://doi.org/10.1186/s13073-022-01120-z",
    usedBy: ["src/shared/thresholds/evaluators.ts"]
  },
  {
    id: "clinpred",
    name: "ClinPred",
    provider: "Alirezaie et al. (American Journal of Human Genetics)",
    kind: "model",
    role: "Gradient-boosted classifier trained directly on ClinVar pathogenic versus benign labels, with allele frequency as a feature.",
    url: "https://doi.org/10.1016/j.ajhg.2018.08.005",
    release: null,
    citation:
      "Alirezaie, N., Kernohan, K. D., Hartley, T., Majewski, J., & Hocking, T. D. (2018). ClinPred: prediction tool to identify disease-relevant nonsynonymous single-nucleotide variants. American Journal of Human Genetics 103, 474–483. https://doi.org/10.1016/j.ajhg.2018.08.005",
    usedBy: ["src/shared/thresholds/evaluators.ts"]
  },
  {
    id: "eigen",
    name: "Eigen / Eigen-PC",
    provider: "Ionita-Laza laboratory, Columbia University",
    kind: "model",
    role: "Unsupervised functional-annotation score that needs no labelled training set, reported on the PHRED scale.",
    url: "https://doi.org/10.1038/ng.3477",
    release: null,
    citation:
      "Ionita-Laza, I., McCallum, K., Xu, B., & Buxbaum, J. D. (2016). A spectral approach integrating functional genomic annotations for coding and noncoding variants. Nature Genetics 48, 214–220. https://doi.org/10.1038/ng.3477",
    usedBy: ["src/shared/thresholds/evaluators.ts"]
  },
  {
    id: "dann",
    name: "DANN",
    provider: "Quang, Chen & Xie (Bioinformatics)",
    kind: "model",
    role: "Deep feed-forward network trained on CADD's feature set, used to capture non-linear annotation interactions.",
    url: "https://doi.org/10.1093/bioinformatics/btu703",
    release: null,
    citation:
      "Quang, D., Chen, Y., & Xie, X. (2015). DANN: a deep learning approach for annotating the pathogenicity of genetic variants. Bioinformatics 31, 761–763. https://doi.org/10.1093/bioinformatics/btu703",
    usedBy: ["src/shared/thresholds/evaluators.ts"]
  },
  {
    id: "bayesdel",
    name: "BayesDel (noAF)",
    provider: "Feng (Human Mutation)",
    kind: "model",
    role: "Bayesian meta-predictor. The no-allele-frequency variant is used deliberately, so population frequency is never counted twice inside one verdict.",
    url: "https://doi.org/10.1002/humu.23158",
    release: null,
    citation:
      "Feng, B.-J. (2017). PERCH: a unified framework for disease gene prioritization (introduces BayesDel). Human Mutation 38, 243–251. https://doi.org/10.1002/humu.23158",
    usedBy: ["src/shared/thresholds/evaluators.ts"]
  }
];

/**
 * Group 3 — structure, energetics and cavity engines.
 *
 * These produce the numbers the workspace is named for. Two things belong in this credit
 * that a generic "powered by" list would omit: FoldX is licence-bound and is deliberately
 * not redistributed here, and P2Rank's probabilities are only comparable within the model
 * profile that produced them.
 */
const ENGINE_SOURCES: AttributionEntry[] = [
  {
    id: "foldx",
    name: "FoldX 5 — BuildModel & RepairPDB",
    provider: "Centre for Genomic Regulation (CRG), Barcelona",
    kind: "service",
    role: "Repairs a modelled structure, rebuilds the mutant side chain on the wild-type backbone, and scores the change in folding free energy (ΔΔG). BuildModel is asked for five stochastic runs (--numberOfRuns=5) so a mean and a standard deviation exist rather than a single draw.",
    url: "https://foldxsuite.crg.eu/",
    release: "FoldX 5.0 (local binary; the exact executable name is recorded per run)",
    citation:
      "Schymkowitz, J., et al. (2005). The FoldX web server: an online force field. Nucleic Acids Research 33, W382–W388. https://doi.org/10.1093/nar/gki387",
    licence:
      "Licence-bound. A free academic/non-commercial licence must be obtained from CRG, and the executable is not redistributed with this repository — a deployment places its own copy in tools/foldx/. Results inherit those terms.",
    usedBy: ["server/services/stability/foldx/runner.ts", "server/services/stability/foldx.ts"]
  },
  {
    id: "dynamut2",
    name: "DynaMut2",
    provider: "Ascher laboratory (Biosig), University of Queensland",
    kind: "service",
    role: "Second ΔΔG opinion, from normal-mode analysis of protein flexibility combined with a machine-learning regressor trained on experimental stability data.",
    url: "https://biosig.lab.uq.edu.au/dynamut2/",
    release: null,
    citation:
      "Rodrigues, C. H. M., Pires, D. E. V., & Ascher, D. B. (2021). DynaMut2: assessing changes in stability and flexibility upon single and multiple point missense mutations. Protein Science 30, 60–69. https://doi.org/10.1002/pro.3942",
    usedBy: ["server/services/stability/dynamut.ts", "src/shared/engineStatus.ts"]
  },
  {
    id: "ddmut",
    name: "DDMut and DDMut-PPI",
    provider: "Ascher laboratory (Biosig), University of Queensland",
    kind: "service",
    role: "Graph-plus-transformer ΔΔG prediction, submitted to the remote service and polled; one of the engines counted in the Energetics agreement (not independent of the others: same template, overlapping training data). DDMut-PPI scores the change in binding energy across the interface on the Interfaces & PPI tab, on a solved complex where one has the residue at the interface.",
    url: "https://biosig.lab.uq.edu.au/ddmut/",
    release: null,
    citation:
      "Zhou, Y., Pan, Q., Pires, D. E. V., Rodrigues, C. H. M., & Ascher, D. B. (2023). DDMut: predicting effects of mutations on protein stability using deep learning. Nucleic Acids Research 51, W122–W128. https://doi.org/10.1093/nar/gkad472 · Zhou, Y., et al. (2024). DDMut-PPI: predicting effects of mutations on protein–protein interactions using graph-based deep learning. Nucleic Acids Research 52, W207–W214. https://doi.org/10.1093/nar/gkae412",
    usedBy: ["server/services/stability/ddmut-ppi.ts", "server/services/stability/energy-models.ts"]
  },
  {
    id: "stabilityoracle",
    name: "StabilityOracle",
    provider: "Diaz et al. (Nature Communications)",
    kind: "model",
    role: "Structure-based graph-transformer ΔΔG estimate, run as a local service and counted beside the other engines in the Energetics agreement.",
    url: "https://doi.org/10.1038/s41467-024-49780-2",
    release: null,
    citation:
      "Diaz, D. J., et al. (2024). Stability Oracle: a structure-based graph-transformer framework for identifying stabilizing mutations. Nature Communications 15, 6170. https://doi.org/10.1038/s41467-024-49780-2",
    usedBy: ["server/services/stability/stabilityoracle.ts", "src/shared/thresholds/consensus.ts"]
  },
  {
    id: "rasp",
    name: "RaSP — Rapid Stability Prediction",
    provider: "Lindorff-Larsen laboratory, University of Copenhagen",
    kind: "model",
    role: "ΔΔG from a self-supervised 3D convolutional network with a supervised head trained to reproduce Rosetta cartesian_ddg, looked up from the authors' published predictions ingested into SQLite: their experimental-structure table (1,345 proteins) by default, plus their AlphaFold human-proteome predictions (23,391 proteins) when a deployment ingests them (`npm run migrate:rasp -- --proteome <dir>`). Positive-native: a larger value means destabilization.",
    url: "https://doi.org/10.7554/eLife.82593",
    release: "Precomputed lookup table built from the authors' published dataset",
    citation:
      "Blaabjerg, L. M., et al. (2023). Rapid protein stability prediction using deep learning representations. eLife 12, e82593. https://doi.org/10.7554/eLife.82593",
    licence:
      "The lookup table is built from the authors' published datasets — Zenodo 10.5281/zenodo.6835877 and, optionally, the proteome predictions at sid.erda.dk/sharelink/fFPJWflLeE (see scripts/build-rasp-sqlite.ts). Cite the dataset as well as the paper when redistributing the table itself.",
    usedBy: ["scripts/build-rasp-sqlite.ts", "server/services/stability/energy-models.ts"]
  },
  {
    id: "thermompnn",
    name: "ThermoMPNN",
    provider: "Kuhlman laboratory, University of North Carolina (served by Tamarind Bio)",
    kind: "model",
    role: "ΔΔG from a ProteinMPNN-based transfer-learning model, submitted as a job to Tamarind Bio and polled. Optional: it runs only when a Tamarind credential is configured.",
    url: "https://github.com/Kuhlman-Lab/ThermoMPNN",
    release: null,
    citation:
      "Dieckhaus, H., Brocidiacono, M., Randolph, N. Z., & Kuhlman, B. (2024). Transfer learning to leverage larger datasets for improved prediction of protein stability changes. PNAS 121, e2314853121. https://doi.org/10.1073/pnas.2314853121",
    usedBy: ["server/services/stability/energy-models.ts", "server/services/stability/biophysics-bridge.ts"]
  },
  {
    id: "p2rank",
    name: "P2Rank",
    provider: "Krivák & Hoksza, Charles University",
    kind: "model",
    role: "Template-free ligand-binding pocket detection from the 3D model: the cavity residues the spatial classification is measured against, plus a per-cavity ranking probability.",
    url: "https://prankweb.cz/",
    release: "Bundled distribution (model profile chosen from the structure's B-factor semantics)",
    citation:
      "Krivák, R., & Hoksza, D. (2018). P2Rank: machine learning based tool for rapid and accurate prediction of ligand binding sites from protein structure. Journal of Cheminformatics 10, 39. https://doi.org/10.1186/s13321-018-0285-8",
    licence:
      "Runs on a local Java 17+ runtime rather than a remote service, so a result depends on the bundled P2Rank distribution and on the model profile it was scored with. Probabilities are not comparable across profiles.",
    usedBy: ["server/services/structure/pocket/runner.ts", "server/services/structure/pocket/java-detector.ts", "src/shared/residueShiftEvidence.ts"]
  }
];


/**
 * Group 4 — literature, synthesis and remote execution.
 *
 * The services here are the ones that receive prose rather than coordinates: a gene symbol,
 * a bibliographic query, or the assembled evidence bundle. That makes them the group a
 * privacy-conscious reader will look for first, which is also why the transmission
 * disclosure below lists hosts rather than only vendors.
 */
const SYNTHESIS_SOURCES: AttributionEntry[] = [
  {
    id: "europepmc",
    name: "Europe PMC",
    provider: "Europe PMC consortium (EMBL-EBI and partners)",
    kind: "service",
    role: "The literature index behind the search workspace: titles, abstracts, journals and identifiers retrieved by gene or free-text query, then embedded locally for the narrative's retrieval step.",
    url: "https://europepmc.org/",
    release: "Live REST service (no version recorded per query)",
    citation:
      "Ferguson, C., et al. (2021). Europe PMC in 2020. Nucleic Acids Research 49, D1507–D1514. https://doi.org/10.1093/nar/gkaa994",
    usedBy: ["server/services/llm/literature-rag.ts", "src/components/LiteratureView.tsx"]
  },
  {
    id: "pubmed",
    name: "PubMed & NCBI E-utilities",
    provider: "National Library of Medicine (NCBI)",
    kind: "service",
    role: "Bibliographic records and identifier resolution (PMID, PMC) for cited literature, and the index the clinical narrative is instructed to cite rather than paraphrase.",
    url: "https://eutils.ncbi.nlm.nih.gov/",
    release: null,
    citation: null,
    usedBy: ["server/services/llm/literature-rag.ts", "server/services/external-api/clinvar.ts"]
  },
  {
    id: "gemini",
    name: "Gemini",
    provider: "Google (via the @google/genai SDK)",
    kind: "service",
    role: "Assembles the clinical narrative and the ACMG rule proposals from the run's own evidence. The model is given the evidence bundle and instructed to reason from it, not to recall variants.",
    url: "https://ai.google.dev/",
    release: "Model id is configurable (GEMINI_MODEL, with a documented fallback list)",
    citation: null,
    licence:
      "A user-supplied API key is required. Narrative output is retained in the run bundle and exported with the report, so a reader can see which sentences came from the model.",
    usedBy: ["server/services/llm/gemini.ts", "server/routes/variant/narrative.ts"]
  },
  {
    id: "japanfold",
    name: "JapanFold (Boltz-2, ESMC, SaProt)",
    provider: "Tenstorrent Galaxy™ execution tier",
    kind: "service",
    role: "Primary remote execution for the structure-aware models: Boltz-2 models complexes on request (the variant complex on the Interfaces & PPI tab, and a wild-type complex for DDMut-PPI when no solved one exists), ESMC and SaProt supply structure-conditioned likelihoods.",
    url: "https://api.japanfold.aiand.com",
    release: "Live endpoint configured by JAPANFOLD_URL",
    citation: null,
    usedBy: ["server/services/external-api/japanfold-client.ts", "server/services/external-api/ppi.ts", "server/services/structure/multimer.ts"]
  }
];

/**
 * Group 5 — the software this workspace is built on.
 *
 * A credit roll for a research tool is incomplete without these: the viewer that makes a
 * structure legible, the typefaces the report is set in, and the databases the caches live
 * in are all other people's work. Grouped by role rather than by spelling out every
 * transitive dependency, which no reader would use.
 */
const SOFTWARE_SOURCES: AttributionEntry[] = [
  {
    id: "molstar",
    name: "Mol* (Molstar)",
    provider: "Mol* Consortium (David Sehnal, Sebastian Bittrich, and contributors)",
    kind: "software",
    role: "The 3D viewer: renders the wild-type and mutant models, residue highlighting, polar contacts and the pocket overlay.",
    url: "https://molstar.org/",
    release: "molstar ^5 (see the repository's lockfile for the exact version)",
    citation:
      "Sehnal, D., et al. (2021). Mol* Viewer: modern web app for 3D visualization and analysis of large biomolecular structures. Nucleic Acids Research 49, W431–W437. https://doi.org/10.1093/nar/gkab314",
    usedBy: ["src/components/MolstarViewer.tsx", "src/components/molstar/useMolstarStructure.ts"]
  },
  {
    id: "react",
    name: "React & the client toolchain",
    provider: "Meta and the open-source contributors to React, Vite, TypeScript and Tailwind CSS",
    kind: "software",
    role: "The interface itself: component model, build pipeline, type checking and the utility CSS that carries this workspace's token system.",
    url: "https://react.dev/",
    release: null,
    citation: null,
    licence: "All four are distributed under permissive open-source licences (MIT for React and Vite, Apache-2.0 for TypeScript, MIT for Tailwind CSS).",
    usedBy: ["package.json", "vite.config.ts", "src/index.css"]
  },
  {
    id: "server-stack",
    name: "Express, Zod, Zustand and the Node.js SQLite driver",
    provider: "Open-source maintainers of those projects; Node.js is maintained by the OpenJS Foundation",
    kind: "software",
    role: "The HTTP surface, the runtime validators that keep a malformed payload out of the pipeline, the client state store, and the on-disk caches (analyses, landscape, RaSP, literature) via node:sqlite.",
    url: "https://nodejs.org/",
    release: "Node.js >= 22.5.0 (declared engine requirement)",
    citation: null,
    licence:
      "node:sqlite is a Node.js built-in — the caches are plain SQLite files under data/, readable with any SQLite client.",
    usedBy: ["server.ts", "server/services/infra/analysis-db.ts", "src/shared/contracts.ts"]
  },
  {
    id: "queues",
    name: "BullMQ and Redis",
    provider: "Taskforce.sh (BullMQ) and the Redis maintainers",
    kind: "software",
    role: "The durable biophysical job queue and its event bus, which is what lets a FoldX or remote-engine request outlive a page refresh without being run twice.",
    url: "https://docs.bullmq.io/",
    release: null,
    citation: null,
    usedBy: ["server/services/infra/biophysical-queue.ts", "server/services/infra/cache-registry.ts"]
  },
  {
    id: "typography",
    name: "Lora, Source Sans 3 and Source Code Pro",
    provider: "Cyreal (Lora) and Adobe (Source Sans 3, Source Code Pro)",
    kind: "software",
    role: "The typefaces: Lora sets the report and section headings, Source Sans 3 carries interface copy, and Source Code Pro holds every identifier, score and version string so numerals align in a column.",
    url: "https://github.com/adobe-fonts/source-sans",
    release: "Delivered as variable fonts via @fontsource",
    citation: null,
    licence:
      "All three are licensed under the SIL Open Font License 1.1, which permits bundling and redistribution.",
    usedBy: ["src/styles/variables.css", "package.json"]
  }
];

/**
 * Where a query physically goes.
 *
 * This is the disclosure a reader needs in order to decide whether a query is safe to run
 * at all, and it is deliberately written as hosts-and-payloads rather than as vendor names:
 * "we use Ensembl" does not tell anyone that a chromosome coordinate leaves the machine.
 * Credentials for the optional services live in `sessionStorage` for the tab's lifetime
 * only — never on disk, and never inside an exported settings file.
 */
export const QUERY_TRANSMISSION = {
  blurb:
    "A query is resolved by sending the notation, and then the identifiers it resolves to, to the hosts below. None of them receives a patient identifier: what leaves the machine is a gene symbol, an HGVS notation, a genomic coordinate, a UniProt accession, a PDB id, a RefSeq transcript id, a sequence, or a free-text literature query.",
  hosts: [
    { host: "search.clinicalgenome.org", sent: "Nothing about the query: the whole public dosage table is downloaded and filtered on the server", note: "ClinGen dosage sensitivity context. The gene is matched locally, so no gene symbol leaves the machine." },
    { host: "gtexportal.org", sent: "Gene symbol, resolved GENCODE gene identifier and tissue metadata request", note: "Adult GTEx v10 expression context. Disease, onset and review-system selections stay in the browser." },
    { host: "rest.ensembl.org · grch37.rest.ensembl.org", sent: "Gene symbol, HGVS notation, transcript or genomic coordinate", note: "Ensembl VEP. The host is chosen from the genome build, so a GRCh37 notation never reaches the GRCh38 endpoint." },
    { host: "rest.variantvalidator.org", sent: "Gene symbol and HGVS notation", note: "Consulted for validation and isoform numbering only." },
    { host: "myvariant.info", sent: "Gene symbol and protein change", note: "Fallback route; its records are hg19-keyed." },
    { host: "eutils.ncbi.nlm.nih.gov", sent: "Gene symbol, variant term, publication id", note: "ClinVar and PubMed lookups." },
    { host: "rest.uniprot.org", sent: "Gene symbol or UniProt accession", note: "Returns the canonical sequence and the curated feature annotations." },
    { host: "gnomad.broadinstitute.org", sent: "Variant id (chromosome–position–ref–alt) and gene symbol", note: null },
    { host: "api.genome.ucsc.edu", sent: "Genomic window (hg38 chromosome, start, end) and an annotation track name", note: "Exon boundaries used to resolve the splice architecture." },
    { host: "consurfdb.tau.ac.il", sent: "PDB identifier and residue selection", note: "Conservation grading for the sequence track." },
    { host: "query.dbnsfp.org", sent: "Gene symbol and protein change", note: "Used only when the local dbNSFP ingest is absent; the columns are otherwise read from the local SQLite file." },
    { host: "alphafold.ebi.ac.uk · files.rcsb.org · search.rcsb.org · data.rcsb.org", sent: "UniProt accession or PDB id", note: "Structure retrieval only — no variant data." },
    { host: "string-db.org", sent: "Gene symbol", note: null },
    { host: "spliceai-38-xwkwwwxdwq-uc.a.run.app · spliceai-37-xwkwwwxdwq-uc.a.run.app", sent: "Genomic coordinate", note: "One endpoint per genome build. Named in full because the hostnames are opaque, which is also how a reader can recognise them in a network log." },
    { host: "query.genos.us · genos.app", sent: "Gene and coordinate", note: "Requires a credential configured for this workspace. The second host serves the adapter's health probe." },
    { host: "data.evemodel.org", sent: "RefSeq transcript id", note: null },
    { host: "huggingface.co · api.japanfold.aiand.com · forge.evolutionaryscale.ai · biohub.ai", sent: "Sequence, structure payloads, model weight downloads", note: "Structure-aware model execution. The Biohub / EvolutionaryScale tier is optional and falls back to the local VESM model. Server-side encode calls go to forge.evolutionaryscale.ai, falling back to biohub.ai." },
    { host: "api.esmatlas.com", sent: "Amino-acid sequence", note: "Keyless de novo folding fallback, used when no Biohub token is configured." },
    { host: "app.tamarind.bio", sent: "Structure coordinates and the mutation string", note: "ThermoMPNN job submission; requires a credential." },
    { host: "biosig.lab.uq.edu.au", sent: "Structure coordinates (PDB upload) and the mutation string", note: "DynaMut2, DDMut and DDMut-PPI. The whole modelled structure leaves the machine, uploaded to a server in Australia." },
    { host: "deepmind.google.com", sent: "GRCh38 interval", note: "GRCh38 only — a GRCh37 coordinate is refused here rather than sent." },
    { host: "www.ebi.ac.uk", sent: "Literature text query and gene symbol; UniProt accession", note: "Europe PMC's search endpoint, and the PDBe API for structure mappings and interface residues." },
    { host: "generativelanguage.googleapis.com", sent: "The assembled evidence bundle for this run, plus your optional directions field", note: "Directions are screened for identifiers before they are sent, and that screening is best-effort — never type patient data into that field." }
  ]
} as const;

/**
 * The groups, in the order the page presents them: what the workspace reads, what scores,
 * what models the molecule, what writes, and what it is made of.
 */
export const ATTRIBUTION_GROUPS: AttributionGroup[] = [
  {
    id: "about-reference",
    title: "Datasets and reference services",
    blurb:
      "The evidence floor: what is already known about a variant before a model runs. Where a release is pinned in code it is stated; where it is not, the entry says so, because an unpinned database is a reproducibility caveat rather than a detail.",
    entries: REFERENCE_SOURCES
  },
  {
    id: "about-models",
    title: "Foundation models and learned predictors",
    blurb:
      "Every score in this group is another laboratory's trained model. A score is only coloured against a cut-point calibrated for its own scale, so the informational models are named as such instead of borrowing a threshold from a neighbour.",
    entries: MODEL_SOURCES
  },
  {
    id: "about-engines",
    title: "Structure, energetics and cavity engines",
    blurb:
      "The biophysics: an empirical force field (FoldX), learned ΔΔG estimators (DynaMut2, DDMut, StabilityOracle, RaSP, ThermoMPNN) and a cavity detector (P2Rank). The estimators' agreement — and their disagreement — is what the consensus verdict is built from.",
    entries: ENGINE_SOURCES
  },
  {
    id: "about-synthesis",
    title: "Literature, synthesis and remote execution",
    blurb:
      "Services that receive prose or evidence bundles rather than coordinates: the literature index, the language model that drafts the narrative, and the execution tier that runs the structure-aware models.",
    entries: SYNTHESIS_SOURCES
  },
  {
    id: "about-software",
    title: "Software and typography",
    blurb:
      "The viewer, the runtime, the caches and the typefaces. Research software is mostly other people's infrastructure, and a credit roll that stopped at models would leave most of the actual work uncredited.",
    entries: SOFTWARE_SOURCES
  }
];

/** Every credited third party, flattened — used for the hero's count. */
export const ATTRIBUTION_ENTRY_COUNT = ATTRIBUTION_GROUPS.reduce(
  (total, group) => total + group.entries.length,
  0
);

/**
 * How to cite this workspace.
 *
 * Kept beside the credits because the two answer the same question from opposite sides:
 * this is what a reader writes down when *this* software produced a result, while the
 * groups above are what the software itself owes to its dependencies.
 */
export const WORKSPACE_CITATION = {
  plain:
    "Missense & Fold — a structural exploration workspace for human missense variants (v1.0.0). Huthaifa HajAhmad. https://github.com/Huthaifa-HajAhmad/Missense-Structural-Explorer",
  bibtex: [
    "@software{missense_and_fold,",
    "  title     = {Missense \\& Fold: a structural exploration workspace for human missense variants},",
    "  author    = {HajAhmad, Huthaifa},",
    "  year      = {2026},",
    "  version   = {1.0.0},",
    "  url       = {https://github.com/Huthaifa-HajAhmad/Missense-Structural-Explorer},",
    "  note      = {Research use only. Cite the data sources and models listed in the",
    "               workspace's About page alongside this entry.}",
    "}"
  ].join("\n")
} as const;
