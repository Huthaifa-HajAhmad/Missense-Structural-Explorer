/**
 * GZF1 / Q9H116 (711 aa), p.Arg591Trp — the protein map reference for repeated domains.
 *
 * Transcribed from UniProtKB `rest.uniprot.org/uniprotkb/Q9H116.json` (feature table), UniParc
 * `rest.uniprot.org/uniparc/accession/Q9H116` (InterPro member-database matches) and the InterPro API
 * (entry types, which the server attaches per InterPro entry), all read 2026-11-12. Ten C2H2 zinc fingers
 * are modelled by Pfam, SMART and two PROSITE signatures (a profile and a short pattern); the one disease
 * variant UniProt lists covers residues 289–711.
 */
import type { UniprotFeaturesData } from "../../contracts";

export const GZF1_UNIPROT: UniprotFeaturesData = {
  geneName: "GZF1",
  sequenceLength: 711,
  reviewed: true,
  features: [
    { type: "Domain", description: "BTB", start: 31, end: 103, evidence: [{ code: "ECO:0000255", source: "PROSITE-ProRule", id: "PRU00037" }] },
    { type: "Zinc finger", description: "C2H2-type 1", start: 317, end: 340, evidence: [{ code: "ECO:0000255", source: "PROSITE-ProRule", id: "PRU00042" }] },
    { type: "Zinc finger", description: "C2H2-type 2", start: 348, end: 371, evidence: [{ code: "ECO:0000255", source: "PROSITE-ProRule", id: "PRU00042" }] },
    { type: "Zinc finger", description: "C2H2-type 3", start: 377, end: 400, evidence: [{ code: "ECO:0000255", source: "PROSITE-ProRule", id: "PRU00042" }] },
    { type: "Zinc finger", description: "C2H2-type 4", start: 407, end: 429, evidence: [{ code: "ECO:0000255", source: "PROSITE-ProRule", id: "PRU00042" }] },
    { type: "Zinc finger", description: "C2H2-type 5", start: 435, end: 457, evidence: [{ code: "ECO:0000255", source: "PROSITE-ProRule", id: "PRU00042" }] },
    { type: "Zinc finger", description: "C2H2-type 6", start: 463, end: 485, evidence: [{ code: "ECO:0000255", source: "PROSITE-ProRule", id: "PRU00042" }] },
    { type: "Zinc finger", description: "C2H2-type 7", start: 491, end: 513, evidence: [{ code: "ECO:0000255", source: "PROSITE-ProRule", id: "PRU00042" }] },
    { type: "Zinc finger", description: "C2H2-type 8", start: 519, end: 541, evidence: [{ code: "ECO:0000255", source: "PROSITE-ProRule", id: "PRU00042" }] },
    { type: "Zinc finger", description: "C2H2-type 9", start: 547, end: 569, evidence: [{ code: "ECO:0000255", source: "PROSITE-ProRule", id: "PRU00042" }] },
    { type: "Zinc finger", description: "C2H2-type 10", start: 575, end: 597, evidence: [{ code: "ECO:0000255", source: "PROSITE-ProRule", id: "PRU00042" }] },
    { type: "Region", description: "Disordered", start: 153, end: 220, evidence: [{ code: "ECO:0000256", source: "SAM", id: "MobiDB-lite" }] },
    { type: "Region", description: "Disordered", start: 243, end: 312, evidence: [{ code: "ECO:0000256", source: "SAM", id: "MobiDB-lite" }] },
    { type: "Compositional bias", description: "Low complexity", start: 153, end: 168, evidence: [{ code: "ECO:0000256", source: "SAM", id: "MobiDB-lite" }] },
    { type: "Compositional bias", description: "Basic and acidic residues", start: 197, end: 212, evidence: [{ code: "ECO:0000256", source: "SAM", id: "MobiDB-lite" }] },
    { type: "Compositional bias", description: "Basic and acidic residues", start: 243, end: 252, evidence: [{ code: "ECO:0000256", source: "SAM", id: "MobiDB-lite" }] },
    { type: "Compositional bias", description: "Basic and acidic residues", start: 265, end: 277, evidence: [{ code: "ECO:0000256", source: "SAM", id: "MobiDB-lite" }] },
    { type: "Compositional bias", description: "Acidic residues", start: 298, end: 309, evidence: [{ code: "ECO:0000256", source: "SAM", id: "MobiDB-lite" }] },
    { type: "Modified residue", description: "Phosphoserine", start: 613, end: 613, evidence: [{ code: "ECO:0000250", source: "UniProtKB", id: "Q4VBD9" }] },
    { type: "Natural variant", description: "found in a renal cell carcinoma sample; somatic mutation", start: 97, end: 97, change: { from: "A", to: ["V"] }, evidence: [{ code: "ECO:0000269", source: "PubMed", id: "21248752" }] },
    { type: "Natural variant", description: "in dbSNP:rs3810574", start: 190, end: 190, change: { from: "N", to: ["S"] }, evidence: [] },
    { type: "Natural variant", description: "in dbSNP:rs6048760", start: 275, end: 275, change: { from: "Q", to: ["L"] }, evidence: [] },
    { type: "Natural variant", description: "in dbSNP:rs6048760", start: 275, end: 275, change: { from: "Q", to: ["P"] }, evidence: [{ code: "ECO:0000269", source: "PubMed", id: "14702039" }] },
    { type: "Natural variant", description: "in dbSNP:rs6048760", start: 275, end: 275, change: { from: "Q", to: ["R"] }, evidence: [] },
    { type: "Natural variant", description: "in JLSM", start: 289, end: 711, evidence: [{ code: "ECO:0000269", source: "PubMed", id: "28475863" }] },
    { type: "Natural variant", description: "in dbSNP:rs6114068", start: 318, end: 318, change: { from: "K", to: ["N"] }, evidence: [] },
    { type: "Natural variant", description: "in dbSNP:rs6048766", start: 667, end: 667, change: { from: "D", to: ["N"] }, evidence: [] },
    { type: "Mutagenesis", description: "Decreased repression activity.", start: 32, end: 32, change: { from: "D", to: ["N"] }, evidence: [{ code: "ECO:0000269", source: "PubMed", id: "14522971" }] },
    { type: "Mutagenesis", description: "Decreased repression activity.", start: 50, end: 50, change: { from: "K", to: ["D"] }, evidence: [{ code: "ECO:0000269", source: "PubMed", id: "14522971" }] },
  ],
  secondaryStructure: [],
  domainMatchesStatus: "ok",
  entryTypesStatus: "ok",
  uniparcId: "UPI000013C35D",
  domainMatches: [
    { database: "CDD", accession: "cd18211", interpro: null, locations: [{ start: 6, end: 133 }] },
    { database: "Pfam", accession: "PF00651", interpro: { id: "IPR000210", name: "BTB/POZ domain" }, entryType: "domain", locations: [{ start: 22, end: 130 }] },
    { database: "FunFam", accession: "G3DSA:3.30.160.60:FF:002343", interpro: null, locations: [{ start: 429, end: 460 }] },
    { database: "FunFam", accession: "G3DSA:3.30.160.60:FF:000701", interpro: null, locations: [{ start: 571, end: 599 }] },
    { database: "Gene3D", accession: "G3DSA:3.30.710.10", interpro: { id: "IPR011333", name: "SKP1/BTB/POZ domain superfamily" }, entryType: "homologous_superfamily", locations: [{ start: 7, end: 155 }] },
    { database: "FunFam", accession: "G3DSA:3.30.160.60:FF:001170", interpro: null, locations: [{ start: 374, end: 401 }] },
    { database: "PANTHER", accession: "PTHR24399", interpro: null, locations: [{ start: 406, end: 620 }] },
    { database: "SUPFAM", accession: "SSF54695", interpro: { id: "IPR011333", name: "SKP1/BTB/POZ domain superfamily" }, entryType: "homologous_superfamily", locations: [{ start: 9, end: 127 }] },
    { database: "PROSITE", accession: "PS50097", interpro: { id: "IPR000210", name: "BTB/POZ domain" }, entryType: "domain", locations: [{ start: 31, end: 103 }] },
    { database: "Gene3D", accession: "G3DSA:3.30.160.60", interpro: null, locations: [{ start: 285, end: 373 }, { start: 374, end: 401 }, { start: 403, end: 432 }, { start: 433, end: 460 }, { start: 461, end: 487 }, { start: 488, end: 516 }, { start: 545, end: 569 }, { start: 517, end: 544 }, { start: 570, end: 599 }] },
    { database: "PROSITE", accession: "PS00028", interpro: { id: "IPR013087", name: "Zinc finger C2H2-type" }, entryType: "domain", locations: [{ start: 350, end: 371 }, { start: 379, end: 400 }, { start: 409, end: 429 }, { start: 437, end: 457 }, { start: 465, end: 485 }, { start: 493, end: 513 }, { start: 521, end: 541 }, { start: 548, end: 569 }, { start: 577, end: 597 }] },
    { database: "Pfam", accession: "PF13912", interpro: { id: "IPR013087", name: "Zinc finger C2H2-type" }, entryType: "domain", locations: [{ start: 463, end: 485 }] },
    { database: "FunFam", accession: "G3DSA:3.30.160.60:FF:000657", interpro: null, locations: [{ start: 488, end: 515 }] },
    { database: "SMART", accession: "SM00355", interpro: { id: "IPR013087", name: "Zinc finger C2H2-type" }, entryType: "domain", locations: [{ start: 317, end: 340 }, { start: 348, end: 371 }, { start: 377, end: 400 }, { start: 407, end: 429 }, { start: 435, end: 457 }, { start: 463, end: 485 }, { start: 491, end: 513 }, { start: 519, end: 541 }, { start: 547, end: 569 }, { start: 575, end: 597 }] },
    { database: "SUPFAM", accession: "SSF57667", interpro: { id: "IPR036236", name: "Zinc finger C2H2 superfamily" }, entryType: "homologous_superfamily", locations: [{ start: 444, end: 500 }, { start: 499, end: 556 }, { start: 541, end: 593 }, { start: 406, end: 457 }, { start: 347, end: 396 }] },
    { database: "Pfam", accession: "PF00096", interpro: { id: "IPR013087", name: "Zinc finger C2H2-type" }, entryType: "domain", locations: [{ start: 437, end: 457 }, { start: 575, end: 597 }, { start: 491, end: 513 }, { start: 549, end: 569 }, { start: 348, end: 371 }, { start: 519, end: 541 }, { start: 407, end: 429 }] },
    { database: "Pfam", accession: "PF13894", interpro: null, locations: [{ start: 377, end: 400 }] },
    { database: "FunFam", accession: "G3DSA:3.30.710.10:FF:000090", interpro: null, locations: [{ start: 7, end: 155 }] },
    { database: "FunFam", accession: "G3DSA:3.30.160.60:FF:000912", interpro: null, locations: [{ start: 543, end: 570 }] },
    { database: "SMART", accession: "SM00225", interpro: { id: "IPR000210", name: "BTB/POZ domain" }, entryType: "domain", locations: [{ start: 31, end: 133 }] },
    { database: "FunFam", accession: "G3DSA:3.30.160.60:FF:000322", interpro: null, locations: [{ start: 461, end: 487 }] },
    { database: "PROSITE", accession: "PS50157", interpro: { id: "IPR013087", name: "Zinc finger C2H2-type" }, entryType: "domain", locations: [{ start: 575, end: 602 }, { start: 348, end: 376 }, { start: 317, end: 340 }, { start: 377, end: 405 }, { start: 407, end: 434 }, { start: 435, end: 462 }, { start: 463, end: 490 }, { start: 491, end: 518 }, { start: 519, end: 546 }, { start: 547, end: 574 }] },
    { database: "FunFam", accession: "G3DSA:3.30.160.60:FF:000709", interpro: null, locations: [{ start: 516, end: 542 }] },
    { database: "FunFam", accession: "G3DSA:3.30.160.60:FF:001633", interpro: null, locations: [{ start: 287, end: 373 }] },
    { database: "FunFam", accession: "G3DSA:3.30.160.60:FF:001563", interpro: null, locations: [{ start: 403, end: 428 }] },
  ],
};

export const GZF1_INPUT = {
  gene: "GZF1",
  uniprotId: "Q9H116",
  residue: 591,
  wildType: "Arg",
  mutant: "Trp",
  uniprot: GZF1_UNIPROT,
  serviceStatus: "ok",
  numberingBasis: "canonical" as const,
  transcriptId: "ENST00000338121.10",
  engineCriteria: [{ code: "PM2" }],
};
