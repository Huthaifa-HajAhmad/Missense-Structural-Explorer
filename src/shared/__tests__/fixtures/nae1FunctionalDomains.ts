/**
 * NAE1 / Q13564 (534 aa), p.Asp116Gly — the Functional domains reference variant.
 *
 * Transcribed from UniProtKB `rest.uniprot.org/uniprotkb/Q13564.json` (feature table) and UniParc
 * `rest.uniprot.org/uniparc/accession/Q13564` (InterPro member-database matches), both read
 * 2026-09-29. Features UniProt lists with no evidence carry `evidence: []`. Only the secondary
 * structure elements next to residue 116 are kept; the fixture needs the neighbourhood, not all 70.
 */
import type { UniprotFeaturesData } from "../../contracts";

export const NAE1_UNIPROT: UniprotFeaturesData = {
  geneName: "NAE1",
  sequenceLength: 534,
  reviewed: true,
  features: [
    { type: "Region", description: "Interaction with UBA3", start: 331, end: 344, evidence: [] },
    { type: "Site", description: "Interaction with UBA3", start: 211, end: 211, evidence: [] },
    { type: "Modified residue", description: "N-acetylalanine", start: 2, end: 2, evidence: [{ code: "ECO:0007744", source: "PubMed", id: "22814378" }] },
    { type: "Modified residue", description: "N6-acetyllysine", start: 6, end: 6, evidence: [{ code: "ECO:0007744", source: "PubMed", id: "19608861" }] },
    { type: "Modified residue", description: "N6-acetyllysine", start: 341, end: 341, evidence: [{ code: "ECO:0000250", source: "UniProtKB", id: "Q8VBW6" }] },
    { type: "Natural variant", description: "in NEDFIH", start: 49, end: 49, change: { from: "L", to: ["F"] }, evidence: [{ code: "ECO:0000269", source: "PubMed", id: "36608681" }] },
    { type: "Natural variant", description: "in NEDFIH", start: 85, end: 85, change: { from: "R", to: ["Q"] }, evidence: [{ code: "ECO:0000269", source: "PubMed", id: "36608681" }] },
    { type: "Natural variant", description: "in dbSNP", start: 101, end: 101, change: { from: "S", to: ["F"] }, evidence: [] },
    { type: "Natural variant", description: "in NEDFIH", start: 294, end: 294, change: { from: "C", to: ["W"] }, evidence: [{ code: "ECO:0000269", source: "PubMed", id: "36608681" }] },
    { type: "Natural variant", description: "in NEDFIH", start: 430, end: 430, change: { from: "R", to: ["Q"] }, evidence: [{ code: "ECO:0000269", source: "PubMed", id: "36608681" }] },
    { type: "Mutagenesis", description: "Impairs NEDD8-UBA3 thioester formation.", start: 331, end: 331, change: { from: "D", to: ["A"] }, evidence: [{ code: "ECO:0000269", source: "PubMed", id: "12646924" }] },
  ],
  secondaryStructure: [
    { kind: "helix", start: 85, end: 94, pdb: "1TT5" },
    { kind: "strand", start: 104, end: 107, pdb: "1TT5" },
    { kind: "helix", start: 109, end: 114, pdb: "1TT5" },
    { kind: "helix", start: 117, end: 122, pdb: "1TT5" },
    { kind: "strand", start: 124, end: 130, pdb: "1TT5" },
  ],
  domainMatchesStatus: "ok",
  uniparcId: "UPI000006EBDC",
  domainMatches: [
    { database: "CDD", accession: "cd01493", interpro: null, locations: [{ start: 11, end: 532 }] },
    { database: "Gene3D", accession: "G3DSA:3.40.50.720", interpro: null, locations: [{ start: 2, end: 289 }, { start: 376, end: 534 }] },
    { database: "PIRSF", accession: "PIRSF039099", interpro: { id: "IPR030667", name: "NEDD8-activating enzyme E1 regulatory subunit APP-BP1" }, locations: [{ start: 9, end: 534 }] },
    { database: "PANTHER", accession: "PTHR10953", interpro: { id: "IPR045886", name: "ThiF/MoeB/HesA family" }, locations: [{ start: 10, end: 524 }] },
    { database: "Pfam", accession: "PF00899", interpro: { id: "IPR000594", name: "THIF-type NAD/FAD binding fold" }, locations: [{ start: 13, end: 530 }] },
    { database: "SUPFAM", accession: "SSF69572", interpro: { id: "IPR035985", name: "Ubiquitin-activating enzyme-like" }, locations: [{ start: 9, end: 534 }] },
  ],
};

/** The engine record here is a test input (PM1 absent), not a copy of a live run. */
export const NAE1_INPUT = {
  gene: "NAE1",
  uniprotId: "Q13564",
  residue: 116,
  wildType: "Asp",
  mutant: "Gly",
  uniprot: NAE1_UNIPROT,
  serviceStatus: "ok",
  numberingBasis: "canonical" as const,
  transcriptId: "NM_003905.4",
  engineCriteria: [{ code: "PM2" }, { code: "PP3" }],
};
