/**
 * ABCG1 p.Gly358Arg (NM_016818.3, UniProtKB P45844): the reference for a residue that no solved
 * structure models (doc/INTERFACES_PPI_AUDIT_2026-11-26.md). Captured from the live services on
 * 2026-11-26 through `analyzeMultimerStructure` (lookups only), `analyzePpiBinding` and
 * `fetchUniprotFeatures`: five native homodimer entries (7FDV, 7OZ1, 7R8C, 7R8D, 7R8E), none with
 * coordinates for residues 348-396; SUBUNIT names "partners of the ABCG subfamily" and ABCG4; STRING
 * returns its top 500 functional partners. UniProt features kept to the types the track draws.
 */
/* eslint-disable */
export const ABCG1_INTERFACES: any = {
 "result": {
  "metadata": {
   "gene": "ABCG1",
   "variant": "p.Gly358Arg",
   "uniprotId": "P45844",
   "residueIndex": 358,
   "sequence": "MACLMAAFSVGTAMNASSYSAEMTEPKSVCVSVDEVVSSNMEATETDLLNGHLKKVDNNLTEAQRFSSLPRRAAVNIEFRDLSYSVPEGPWWRKKGYKTLLKGISGKFNSGELVAIMGPSGAGKSTLMNILAGYRETGMKGAVLINGLPRDLRCFRKVSCYIMQDDMLLPHLTVQEAMMVSAHLKLQEKDEGRREMVKEILTALGLLSCANTRTGSLSGGQRKRLAIALELVNNPPVMFFDEPTSGLDSASCFQVVSLMKGLAQGGRSIICTIHQPSAKLFELFDQLYVLSQGQCVYRGKVCNLVPYLRDLGLNCPTYHNPADFVMEVASGEYGDQNSRLVRAVREGMCDSDHKRDLGGDAEVNPFLWHRPSEEVKQTKRLKGLRKDSSSMEGCHSFSASCLTQFCILFKRTFLSIMRDSVLTHLRITSHIGIGLLIGLLYLGIGNEAKKVLSNSGFLFFSMLFLMFAALMPTVLTFPLEMGVFLREHLNYWYSLKAYYLAKTMADVPFQIMFPVAYCSIVYWMTSQPSDAVRFVLFAALGTMTSLVAQSLGLLIGAASTSLQVATFVGPVTAIPVLLFSGFFVSFDTIPTYLQWMSYISYVRYGFEGVILSIYGLDREDLHCDIDETCHFQKSEAILRELDVENAKLYLDFIVLGIFFISLRLIAYFVLRYKIRAER"
  },
  "uniprotFeatures": {
   "features": [
    {
     "type": "Topological domain",
     "description": "Cytoplasmic",
     "start": 1,
     "end": 426,
     "evidence": [
      {
       "code": "ECO:0000255"
      }
     ]
    },
    {
     "type": "Transmembrane",
     "description": "Helical",
     "start": 427,
     "end": 445,
     "evidence": [
      {
       "code": "ECO:0000255"
      }
     ]
    },
    {
     "type": "Topological domain",
     "description": "Extracellular",
     "start": 446,
     "end": 456,
     "evidence": [
      {
       "code": "ECO:0000255"
      }
     ]
    },
    {
     "type": "Transmembrane",
     "description": "Helical",
     "start": 457,
     "end": 477,
     "evidence": [
      {
       "code": "ECO:0000255"
      }
     ]
    },
    {
     "type": "Topological domain",
     "description": "Cytoplasmic",
     "start": 478,
     "end": 506,
     "evidence": [
      {
       "code": "ECO:0000255"
      }
     ]
    },
    {
     "type": "Transmembrane",
     "description": "Helical",
     "start": 507,
     "end": 525,
     "evidence": [
      {
       "code": "ECO:0000255"
      }
     ]
    },
    {
     "type": "Topological domain",
     "description": "Extracellular",
     "start": 526,
     "end": 533,
     "evidence": [
      {
       "code": "ECO:0000255"
      }
     ]
    },
    {
     "type": "Transmembrane",
     "description": "Helical",
     "start": 534,
     "end": 555,
     "evidence": [
      {
       "code": "ECO:0000255"
      }
     ]
    },
    {
     "type": "Topological domain",
     "description": "Cytoplasmic",
     "start": 556,
     "end": 567,
     "evidence": [
      {
       "code": "ECO:0000255"
      }
     ]
    },
    {
     "type": "Transmembrane",
     "description": "Helical",
     "start": 568,
     "end": 586,
     "evidence": [
      {
       "code": "ECO:0000255"
      }
     ]
    },
    {
     "type": "Topological domain",
     "description": "Extracellular",
     "start": 587,
     "end": 649,
     "evidence": [
      {
       "code": "ECO:0000255"
      }
     ]
    },
    {
     "type": "Transmembrane",
     "description": "Helical",
     "start": 650,
     "end": 669,
     "evidence": [
      {
       "code": "ECO:0000255"
      }
     ]
    },
    {
     "type": "Topological domain",
     "description": "Cytoplasmic",
     "start": 670,
     "end": 678,
     "evidence": [
      {
       "code": "ECO:0000255"
      }
     ]
    },
    {
     "type": "Domain",
     "description": "ABC transporter",
     "start": 77,
     "end": 317,
     "evidence": [
      {
       "code": "ECO:0000255",
       "source": "PROSITE-ProRule",
       "id": "PRU00434"
      }
     ]
    },
    {
     "type": "Domain",
     "description": "ABC transmembrane type-2",
     "start": 415,
     "end": 673,
     "evidence": []
    },
    {
     "type": "Binding site",
     "description": "Ligand: ATP",
     "start": 118,
     "end": 125,
     "evidence": [
      {
       "code": "ECO:0000255",
       "source": "PROSITE-ProRule",
       "id": "PRU00434"
      }
     ]
    }
   ],
   "subunitComment": "Homodimer; disulfide-linked (PubMed:16702602). Homooligomer (PubMed:16702602). May form heterodimers with several heterologous partners of the ABCG subfamily. Forms heterodimers with ABCG4 (PubMed:27228027). Interacts with CAV1; this interaction regulates ABCG1-mediated cholesterol efflux (PubMed:24576892)",
   "sequenceLength": 678,
   "interactionPartners": [
    {
     "accession": "Q9H172",
     "gene": "ABCG4",
     "experiments": 2
    },
    {
     "accession": "Q13520",
     "gene": "AQP6",
     "experiments": 3
    },
    {
     "accession": "P13473-2",
     "gene": "LAMP2",
     "experiments": 3
    },
    {
     "accession": "O75400-2",
     "gene": "PRPF40A",
     "experiments": 3
    },
    {
     "accession": "Q9Y371",
     "gene": "SH3GLB1",
     "experiments": 3
    }
   ],
   "domainMatches": [
    {
     "database": "PROSITE",
     "accession": "PS00211",
     "interpro": {
      "id": "IPR017871",
      "name": "ABC transporter-like, conserved site"
     },
     "entryType": "conserved_site",
     "locations": [
      {
       "start": 217,
       "end": 231
      }
     ]
    },
    {
     "database": "Gene3D",
     "accession": "G3DSA:3.40.50.300",
     "interpro": {
      "id": "IPR027417",
      "name": "P-loop containing nucleoside triphosphate hydrolase"
     },
     "entryType": "homologous_superfamily",
     "locations": [
      {
       "start": 74,
       "end": 340
      }
     ]
    },
    {
     "database": "NCBIfam",
     "accession": "TIGR00955",
     "interpro": {
      "id": "IPR005284",
      "name": "Pigment precursor permease/Protein ATP-binding cassette sub-family G"
     },
     "entryType": "family",
     "locations": [
      {
       "start": 61,
       "end": 677
      }
     ]
    },
    {
     "database": "SUPFAM",
     "accession": "SSF52540",
     "interpro": {
      "id": "IPR027417",
      "name": "P-loop containing nucleoside triphosphate hydrolase"
     },
     "entryType": "homologous_superfamily",
     "locations": [
      {
       "start": 77,
       "end": 309
      }
     ]
    },
    {
     "database": "Pfam",
     "accession": "PF19055",
     "interpro": {
      "id": "IPR043926",
      "name": "ABC transporter family G domain"
     },
     "entryType": "domain",
     "locations": [
      {
       "start": 274,
       "end": 332
      }
     ]
    },
    {
     "database": "SMART",
     "accession": "SM00382",
     "interpro": {
      "id": "IPR003593",
      "name": "AAA+ ATPase domain"
     },
     "entryType": "domain",
     "locations": [
      {
       "start": 110,
       "end": 293
      }
     ]
    },
    {
     "database": "Pfam",
     "accession": "PF00005",
     "interpro": {
      "id": "IPR003439",
      "name": "ABC transporter-like, ATP-binding domain"
     },
     "entryType": "domain",
     "locations": [
      {
       "start": 101,
       "end": 245
      }
     ]
    },
    {
     "database": "PROSITE",
     "accession": "PS50893",
     "interpro": {
      "id": "IPR003439",
      "name": "ABC transporter-like, ATP-binding domain"
     },
     "entryType": "domain",
     "locations": [
      {
       "start": 77,
       "end": 317
      }
     ]
    },
    {
     "database": "FunFam",
     "accession": "G3DSA:3.40.50.300:FF:000267",
     "interpro": null,
     "locations": [
      {
       "start": 74,
       "end": 330
      }
     ]
    },
    {
     "database": "PANTHER",
     "accession": "PTHR48041",
     "interpro": {
      "id": "IPR050352",
      "name": "ATP-binding cassette subfamily G transporters"
     },
     "entryType": "family",
     "locations": [
      {
       "start": 55,
       "end": 666
      }
     ]
    },
    {
     "database": "CDD",
     "accession": "cd03213",
     "interpro": null,
     "locations": [
      {
       "start": 74,
       "end": 299
      }
     ]
    },
    {
     "database": "Pfam",
     "accession": "PF01061",
     "interpro": {
      "id": "IPR013525",
      "name": "ABC-2 type transporter, transmembrane domain"
     },
     "entryType": "domain",
     "locations": [
      {
       "start": 403,
       "end": 612
      }
     ]
    }
   ],
   "domainMatchesStatus": "ok",
   "entryTypesStatus": "ok"
  }
 },
 "assembly": {
  "status": "not-requested",
  "gene": "ABCG1",
  "uniprotId": "P45844",
  "oligomericState": "Homodimer",
  "chainCount": 2,
  "chainIds": [
   "A",
   "B"
  ],
  "complexPdb": null,
  "ipTm": null,
  "pTm": null,
  "interfaceContacts": [],
  "variantPosition": 358,
  "variantAtInterface": null,
  "provenance": "Boltz-2 via JapanFold",
  "subunitComment": "Homodimer; disulfide-linked (PubMed:16702602). Homooligomer (PubMed:16702602). May form heterodimers with several heterologous partners of the ABCG subfamily. Forms heterodimers with ABCG4 (PubMed:27228027). Interacts with CAV1; this interaction regulates ABCG1-mediated cholesterol efflux (PubMed:24576892)",
  "assembly": {
   "qualifier": null,
   "statements": [
    {
     "kind": "homomer",
     "label": "Homodimer",
     "qualifier": null,
     "sentence": "Homodimer; disulfide-linked (PubMed:16702602).",
     "partnerGenes": [],
     "family": null
    },
    {
     "kind": "heteromer",
     "label": "Heterodimer",
     "qualifier": null,
     "sentence": "May form heterodimers with several heterologous partners of the ABCG subfamily.",
     "partnerGenes": [],
     "family": "ABCG subfamily"
    },
    {
     "kind": "heteromer",
     "label": "Heterodimer",
     "qualifier": null,
     "sentence": "Forms heterodimers with ABCG4 (PubMed:27228027).",
     "partnerGenes": [
      "ABCG4"
     ],
     "family": null
    }
   ],
   "kind": "homomer",
   "label": "Homodimer",
   "copies": 2,
   "homoAssumed": false,
   "sentence": "Homodimer; disulfide-linked (PubMed:16702602).",
   "alsoStated": [
    "Heterodimer"
   ],
   "partners": []
  },
  "experimental": {
   "status": "ok",
   "partners": [
    {
     "accession": "P45844",
     "name": "ATP-binding cassette sub-family G member 1",
     "residues": [
      119,
      120,
      218,
      221,
      224,
      245,
      246,
      247,
      248,
      249,
      250,
      252,
      253,
      274,
      275,
      277,
      278,
      279,
      282,
      305,
      309,
      315,
      316,
      317,
      318,
      319,
      320,
      321,
      323,
      326,
      327,
      330,
      332,
      333,
      419,
      421,
      422,
      425,
      426,
      429,
      433,
      436,
      437,
      439,
      440,
      441,
      442,
      444,
      450,
      452,
      453,
      456,
      459,
      460,
      463,
      464,
      467,
      471,
      472,
      475,
      479,
      562,
      563,
      564,
      566,
      567,
      568,
      570,
      571,
      574,
      575,
      577,
      578,
      579,
      582,
      583,
      584,
      585,
      588,
      589,
      590,
      592,
      593,
      596,
      630,
      640
     ],
     "support": [
      1,
      2,
      1,
      1,
      1,
      1,
      1,
      1,
      2,
      3,
      2,
      1,
      1,
      1,
      1,
      3,
      4,
      5,
      2,
      3,
      2,
      3,
      1,
      3,
      4,
      4,
      1,
      3,
      2,
      1,
      4,
      1,
      4,
      2,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      2,
      4,
      5,
      5,
      5,
      2,
      3,
      4,
      4,
      4,
      5,
      4,
      4,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      5,
      5,
      4,
      5,
      5,
      3,
      5,
      3,
      5,
      5,
      5,
      1,
      3,
      4
     ],
     "pdbEntries": [
      "7fdv",
      "7oz1",
      "7r8c",
      "7r8d",
      "7r8e"
     ],
     "homomeric": true,
     "artefact": null,
     "context": "native",
     "gene": "ABCG1",
     "organism": null,
     "variantAtInterface": false,
     "variantEntries": [],
     "modelledEntries": [],
     "unmodelled": [
      {
       "start": 1,
       "end": 71
      },
      {
       "start": 89,
       "end": 95
      },
      {
       "start": 348,
       "end": 396
      }
     ]
    }
   ],
   "entryKinds": "ok",
   "crystalChecked": true,
   "coverageChecked": true
  },
  "chains": [
   {
    "accession": "P45844",
    "gene": "ABCG1",
    "length": 678,
    "carriesVariant": true,
    "id": "A"
   },
   {
    "accession": "P45844",
    "gene": "ABCG1",
    "length": 678,
    "carriesVariant": false,
    "id": "B"
   }
  ]
 },
 "ppi": {
  "status": "success",
  "gene": "ABCG1",
  "variant": "p.Gly358Arg",
  "uniprotId": "P45844",
  "position": 358,
  "stringPartners": [
   {
    "partner": "NR1H3",
    "score": 0.955
   },
   {
    "partner": "APOA1",
    "score": 0.914
   },
   {
    "partner": "NR1H2",
    "score": 0.911
   },
   {
    "partner": "XPR1",
    "score": 0.871
   },
   {
    "partner": "SREBF2",
    "score": 0.868
   }
  ],
  "string": {
   "physical": [
    {
     "partner": "NEDD4",
     "score": 0.802
    },
    {
     "partner": "ABCG4",
     "score": 0.493
    },
    {
     "partner": "APOA1",
     "score": 0.479
    },
    {
     "partner": "HNRNPL",
     "score": 0.457
    },
    {
     "partner": "PDCD6IP",
     "score": 0.457
    },
    {
     "partner": "ABCG5",
     "score": 0.456
    },
    {
     "partner": "ADGRG5",
     "score": 0.428
    },
    {
     "partner": "ABCA1",
     "score": 0.404
    },
    {
     "partner": "CTNNB1",
     "score": 0.35
    },
    {
     "partner": "YARS1",
     "score": 0.246
    },
    {
     "partner": "ATP5F1D",
     "score": 0.219
    },
    {
     "partner": "ACSL4",
     "score": 0.193
    },
    {
     "partner": "DIDO1",
     "score": 0.166
    },
    {
     "partner": "AP1S2",
     "score": 0.16
    }
   ],
   "functional": [
    {
     "partner": "NR1H3",
     "score": 0.955
    },
    {
     "partner": "APOA1",
     "score": 0.914
    },
    {
     "partner": "NR1H2",
     "score": 0.911
    },
    {
     "partner": "XPR1",
     "score": 0.871
    },
    {
     "partner": "SREBF2",
     "score": 0.868
    },
    {
     "partner": "APOE",
     "score": 0.851
    },
    {
     "partner": "SREBF1",
     "score": 0.837
    },
    {
     "partner": "LDLR",
     "score": 0.825
    },
    {
     "partner": "SCARB1",
     "score": 0.82
    },
    {
     "partner": "CYP7A1",
     "score": 0.815
    },
    {
     "partner": "NEDD4",
     "score": 0.814
    },
    {
     "partner": "RXRA",
     "score": 0.81
    },
    {
     "partner": "NPC1",
     "score": 0.773
    },
    {
     "partner": "GPS2",
     "score": 0.759
    },
    {
     "partner": "PPARG",
     "score": 0.758
    },
    {
     "partner": "CETP",
     "score": 0.74
    },
    {
     "partner": "MYLIP",
     "score": 0.731
    },
    {
     "partner": "MATK",
     "score": 0.707
    },
    {
     "partner": "SCARB2",
     "score": 0.706
    },
    {
     "partner": "CD36",
     "score": 0.705
    },
    {
     "partner": "SULT2B1",
     "score": 0.7
    },
    {
     "partner": "HMGCR",
     "score": 0.697
    },
    {
     "partner": "PLTP",
     "score": 0.688
    },
    {
     "partner": "PCP4",
     "score": 0.686
    },
    {
     "partner": "LCAT",
     "score": 0.666
    },
    {
     "partner": "APOB",
     "score": 0.663
    },
    {
     "partner": "CYP46A1",
     "score": 0.646
    },
    {
     "partner": "ABCG5",
     "score": 0.642
    },
    {
     "partner": "PCSK9",
     "score": 0.636
    },
    {
     "partner": "OLR1",
     "score": 0.634
    },
    {
     "partner": "NPC1L1",
     "score": 0.619
    },
    {
     "partner": "CYP27A1",
     "score": 0.61
    },
    {
     "partner": "ABCC5",
     "score": 0.606
    },
    {
     "partner": "CPT1A",
     "score": 0.604
    },
    {
     "partner": "VCAM1",
     "score": 0.592
    },
    {
     "partner": "CYP8B1",
     "score": 0.591
    },
    {
     "partner": "RXRB",
     "score": 0.587
    },
    {
     "partner": "SOAT1",
     "score": 0.58
    },
    {
     "partner": "LPL",
     "score": 0.575
    },
    {
     "partner": "ABCC1",
     "score": 0.573
    },
    {
     "partner": "ATP8B1",
     "score": 0.57
    },
    {
     "partner": "CROT",
     "score": 0.568
    },
    {
     "partner": "NR1H4",
     "score": 0.567
    },
    {
     "partner": "PPARA",
     "score": 0.55
    },
    {
     "partner": "KDM3A",
     "score": 0.537
    },
    {
     "partner": "ABCD4",
     "score": 0.525
    },
    {
     "partner": "KDM1A",
     "score": 0.519
    },
    {
     "partner": "SCAP",
     "score": 0.517
    },
    {
     "partner": "KDM4A",
     "score": 0.516
    },
    {
     "partner": "DHCR24",
     "score": 0.514
    },
    {
     "partner": "LIPA",
     "score": 0.513
    },
    {
     "partner": "PKNOX1",
     "score": 0.512
    },
    {
     "partner": "LIPC",
     "score": 0.509
    },
    {
     "partner": "APOA2",
     "score": 0.506
    },
    {
     "partner": "KDM1B",
     "score": 0.503
    },
    {
     "partner": "HMGCS1",
     "score": 0.503
    },
    {
     "partner": "PHOSPHO1",
     "score": 0.501
    },
    {
     "partner": "ABCG4",
     "score": 0.499
    },
    {
     "partner": "HADHB",
     "score": 0.498
    },
    {
     "partner": "ABCA1",
     "score": 0.498
    },
    {
     "partner": "IL1B",
     "score": 0.494
    },
    {
     "partner": "ITGAX",
     "score": 0.494
    },
    {
     "partner": "PON1",
     "score": 0.492
    },
    {
     "partner": "INS",
     "score": 0.488
    },
    {
     "partner": "ABCC3",
     "score": 0.486
    },
    {
     "partner": "NCEH1",
     "score": 0.485
    },
    {
     "partner": "IL6",
     "score": 0.484
    },
    {
     "partner": "LIPG",
     "score": 0.483
    },
    {
     "partner": "CD5L",
     "score": 0.483
    },
    {
     "partner": "HNRNPL",
     "score": 0.481
    },
    {
     "partner": "SQLE",
     "score": 0.477
    },
    {
     "partner": "FASN",
     "score": 0.475
    },
    {
     "partner": "PDCD6IP",
     "score": 0.473
    },
    {
     "partner": "LPA",
     "score": 0.467
    },
    {
     "partner": "CH25H",
     "score": 0.466
    },
    {
     "partner": "CYP7B1",
     "score": 0.465
    },
    {
     "partner": "CBSL",
     "score": 0.461
    },
    {
     "partner": "TNF",
     "score": 0.46
    },
    {
     "partner": "CTNNB1",
     "score": 0.46
    },
    {
     "partner": "VLDLR",
     "score": 0.459
    },
    {
     "partner": "TLR4",
     "score": 0.457
    },
    {
     "partner": "NDUFV3",
     "score": 0.454
    },
    {
     "partner": "PDK4",
     "score": 0.452
    },
    {
     "partner": "ADGRG5",
     "score": 0.447
    },
    {
     "partner": "LCK",
     "score": 0.447
    },
    {
     "partner": "ABCB8",
     "score": 0.444
    },
    {
     "partner": "ABCC11",
     "score": 0.444
    },
    {
     "partner": "CCL2",
     "score": 0.442
    },
    {
     "partner": "NPC2",
     "score": 0.442
    },
    {
     "partner": "ATP5F1D",
     "score": 0.44
    },
    {
     "partner": "ICAM1",
     "score": 0.437
    },
    {
     "partner": "PCK1",
     "score": 0.437
    },
    {
     "partner": "PTTG1IP",
     "score": 0.437
    },
    {
     "partner": "SCD",
     "score": 0.437
    },
    {
     "partner": "CBS",
     "score": 0.437
    },
    {
     "partner": "CD68",
     "score": 0.436
    },
    {
     "partner": "APOC2",
     "score": 0.436
    },
    {
     "partner": "HMGCS2",
     "score": 0.434
    },
    {
     "partner": "ACTB",
     "score": 0.431
    },
    {
     "partner": "APOC3",
     "score": 0.429
    },
    {
     "partner": "GAPDH",
     "score": 0.429
    },
    {
     "partner": "INSIG1",
     "score": 0.428
    },
    {
     "partner": "WDR4",
     "score": 0.428
    },
    {
     "partner": "JAM2",
     "score": 0.425
    },
    {
     "partner": "DHCR7",
     "score": 0.424
    },
    {
     "partner": "MTTP",
     "score": 0.423
    },
    {
     "partner": "GPS1",
     "score": 0.42
    },
    {
     "partner": "ACACA",
     "score": 0.418
    },
    {
     "partner": "U2AF1",
     "score": 0.412
    },
    {
     "partner": "SOAT2",
     "score": 0.411
    },
    {
     "partner": "CBX8",
     "score": 0.409
    },
    {
     "partner": "SIRT1",
     "score": 0.408
    },
    {
     "partner": "APOC1",
     "score": 0.406
    },
    {
     "partner": "PPARD",
     "score": 0.404
    },
    {
     "partner": "FDFT1",
     "score": 0.402
    },
    {
     "partner": "MSR1",
     "score": 0.401
    },
    {
     "partner": "APOM",
     "score": 0.4
    },
    {
     "partner": "MSMO1",
     "score": 0.397
    },
    {
     "partner": "TXNIP",
     "score": 0.396
    },
    {
     "partner": "ABCC10",
     "score": 0.395
    },
    {
     "partner": "SEC14L1",
     "score": 0.395
    },
    {
     "partner": "ABCA7",
     "score": 0.393
    },
    {
     "partner": "FABP4",
     "score": 0.392
    },
    {
     "partner": "ALB",
     "score": 0.392
    },
    {
     "partner": "PLIN2",
     "score": 0.39
    },
    {
     "partner": "ABCF1",
     "score": 0.388
    },
    {
     "partner": "AKT1",
     "score": 0.388
    },
    {
     "partner": "LRP1",
     "score": 0.385
    },
    {
     "partner": "SLC25A25",
     "score": 0.385
    },
    {
     "partner": "SYNJ1",
     "score": 0.385
    },
    {
     "partner": "ARHGAP45",
     "score": 0.385
    },
    {
     "partner": "ZNF423",
     "score": 0.385
    },
    {
     "partner": "NAXE",
     "score": 0.381
    },
    {
     "partner": "LIPE",
     "score": 0.379
    },
    {
     "partner": "RPL19",
     "score": 0.377
    },
    {
     "partner": "ACOX1",
     "score": 0.376
    },
    {
     "partner": "ABCB1",
     "score": 0.375
    },
    {
     "partner": "CYP51A1",
     "score": 0.374
    },
    {
     "partner": "IFNG",
     "score": 0.373
    },
    {
     "partner": "ABCF3",
     "score": 0.372
    },
    {
     "partner": "AGPAT1",
     "score": 0.367
    },
    {
     "partner": "PXDN",
     "score": 0.366
    },
    {
     "partner": "RUSC2",
     "score": 0.366
    },
    {
     "partner": "NOS3",
     "score": 0.364
    },
    {
     "partner": "MAPK15",
     "score": 0.363
    },
    {
     "partner": "CAV1",
     "score": 0.36
    },
    {
     "partner": "CCR2",
     "score": 0.358
    },
    {
     "partner": "IL10",
     "score": 0.358
    },
    {
     "partner": "SOCS3",
     "score": 0.357
    },
    {
     "partner": "PPARGC1A",
     "score": 0.356
    },
    {
     "partner": "STAR",
     "score": 0.356
    },
    {
     "partner": "PXDNL",
     "score": 0.354
    },
    {
     "partner": "RXRG",
     "score": 0.353
    },
    {
     "partner": "HIF3A",
     "score": 0.353
    },
    {
     "partner": "NLRX1",
     "score": 0.351
    },
    {
     "partner": "LRP2",
     "score": 0.35
    },
    {
     "partner": "LTA4H",
     "score": 0.349
    },
    {
     "partner": "ABCC12",
     "score": 0.349
    },
    {
     "partner": "ADIPOQ",
     "score": 0.349
    },
    {
     "partner": "RNF145",
     "score": 0.349
    },
    {
     "partner": "ABCA2",
     "score": 0.348
    },
    {
     "partner": "PIK3CD",
     "score": 0.348
    },
    {
     "partner": "MRC1",
     "score": 0.348
    },
    {
     "partner": "APOA4",
     "score": 0.346
    },
    {
     "partner": "AGT",
     "score": 0.346
    },
    {
     "partner": "ATP5F1B",
     "score": 0.344
    },
    {
     "partner": "CDCA8",
     "score": 0.344
    },
    {
     "partner": "CYP39A1",
     "score": 0.342
    },
    {
     "partner": "ADAMTS1",
     "score": 0.342
    },
    {
     "partner": "INSR",
     "score": 0.341
    },
    {
     "partner": "ABCB5",
     "score": 0.341
    },
    {
     "partner": "ATP5PD",
     "score": 0.34
    },
    {
     "partner": "OSBPL6",
     "score": 0.34
    },
    {
     "partner": "ABCC4",
     "score": 0.34
    },
    {
     "partner": "TLR2",
     "score": 0.339
    },
    {
     "partner": "NLRP3",
     "score": 0.339
    },
    {
     "partner": "MMP9",
     "score": 0.339
    },
    {
     "partner": "ABCB11",
     "score": 0.339
    },
    {
     "partner": "ITGAM",
     "score": 0.338
    },
    {
     "partner": "ARL4C",
     "score": 0.337
    },
    {
     "partner": "LPCAT3",
     "score": 0.336
    },
    {
     "partner": "PAPPA",
     "score": 0.336
    },
    {
     "partner": "ANGPTL3",
     "score": 0.336
    },
    {
     "partner": "APOA5",
     "score": 0.335
    },
    {
     "partner": "PIK3CG",
     "score": 0.333
    },
    {
     "partner": "PIK3CA",
     "score": 0.332
    },
    {
     "partner": "NR1I2",
     "score": 0.331
    },
    {
     "partner": "MERTK",
     "score": 0.33
    },
    {
     "partner": "FDPS",
     "score": 0.33
    },
    {
     "partner": "CRP",
     "score": 0.329
    },
    {
     "partner": "LRP8",
     "score": 0.329
    },
    {
     "partner": "TREM2",
     "score": 0.329
    },
    {
     "partner": "APOF",
     "score": 0.329
    },
    {
     "partner": "DGAT1",
     "score": 0.329
    },
    {
     "partner": "TGFB1",
     "score": 0.327
    },
    {
     "partner": "ACSL4",
     "score": 0.326
    },
    {
     "partner": "SIRT6",
     "score": 0.325
    },
    {
     "partner": "MLXIPL",
     "score": 0.323
    },
    {
     "partner": "SLC2A4",
     "score": 0.323
    },
    {
     "partner": "SRA1",
     "score": 0.323
    },
    {
     "partner": "ABCB10",
     "score": 0.323
    },
    {
     "partner": "PSMA7",
     "score": 0.323
    },
    {
     "partner": "APP",
     "score": 0.322
    },
    {
     "partner": "MYD88",
     "score": 0.322
    },
    {
     "partner": "MTOR",
     "score": 0.32
    },
    {
     "partner": "PCF11",
     "score": 0.317
    },
    {
     "partner": "GOT2",
     "score": 0.316
    },
    {
     "partner": "TAP1",
     "score": 0.315
    },
    {
     "partner": "DICER1",
     "score": 0.315
    },
    {
     "partner": "PIK3CB",
     "score": 0.315
    },
    {
     "partner": "PLIN1",
     "score": 0.314
    },
    {
     "partner": "UBASH3A",
     "score": 0.314
    },
    {
     "partner": "TBL1Y",
     "score": 0.314
    },
    {
     "partner": "CLU",
     "score": 0.313
    },
    {
     "partner": "ALOX5AP",
     "score": 0.312
    },
    {
     "partner": "OSBP",
     "score": 0.311
    },
    {
     "partner": "FABP1",
     "score": 0.31
    },
    {
     "partner": "LEP",
     "score": 0.31
    },
    {
     "partner": "RRP1B",
     "score": 0.309
    },
    {
     "partner": "PLA2G10",
     "score": 0.309
    },
    {
     "partner": "CD4",
     "score": 0.308
    },
    {
     "partner": "CFTR",
     "score": 0.306
    },
    {
     "partner": "COX15",
     "score": 0.306
    },
    {
     "partner": "ABCB4",
     "score": 0.306
    },
    {
     "partner": "ACLY",
     "score": 0.306
    },
    {
     "partner": "HMOX1",
     "score": 0.305
    },
    {
     "partner": "CSF2",
     "score": 0.305
    },
    {
     "partner": "PNPLA2",
     "score": 0.303
    },
    {
     "partner": "ESR1",
     "score": 0.303
    },
    {
     "partner": "HADH",
     "score": 0.303
    },
    {
     "partner": "IL4",
     "score": 0.301
    },
    {
     "partner": "NFKB1",
     "score": 0.3
    },
    {
     "partner": "MAPK3",
     "score": 0.3
    },
    {
     "partner": "STARD4",
     "score": 0.3
    },
    {
     "partner": "APOD",
     "score": 0.299
    },
    {
     "partner": "HIF1A",
     "score": 0.299
    },
    {
     "partner": "NR0B2",
     "score": 0.298
    },
    {
     "partner": "ABCA12",
     "score": 0.298
    },
    {
     "partner": "SELE",
     "score": 0.298
    },
    {
     "partner": "IL18",
     "score": 0.297
    },
    {
     "partner": "AGTR2",
     "score": 0.296
    },
    {
     "partner": "CASP1",
     "score": 0.296
    },
    {
     "partner": "ABCG8",
     "score": 0.295
    },
    {
     "partner": "PLA2G7",
     "score": 0.295
    },
    {
     "partner": "DGAT2",
     "score": 0.294
    },
    {
     "partner": "ACAT1",
     "score": 0.294
    },
    {
     "partner": "TP53",
     "score": 0.294
    },
    {
     "partner": "ARG1",
     "score": 0.294
    },
    {
     "partner": "ATP5PB",
     "score": 0.294
    },
    {
     "partner": "APOC4",
     "score": 0.294
    },
    {
     "partner": "ABCC2",
     "score": 0.294
    },
    {
     "partner": "STAT3",
     "score": 0.293
    },
    {
     "partner": "CYBB",
     "score": 0.293
    },
    {
     "partner": "EZH2",
     "score": 0.292
    },
    {
     "partner": "UCP2",
     "score": 0.29
    },
    {
     "partner": "INSIG2",
     "score": 0.288
    },
    {
     "partner": "CCR5",
     "score": 0.288
    },
    {
     "partner": "ACACB",
     "score": 0.288
    },
    {
     "partner": "GBE1",
     "score": 0.288
    },
    {
     "partner": "CD163",
     "score": 0.287
    },
    {
     "partner": "CSF1",
     "score": 0.285
    },
    {
     "partner": "MPO",
     "score": 0.284
    },
    {
     "partner": "ABCA5",
     "score": 0.284
    },
    {
     "partner": "ABCB6",
     "score": 0.282
    },
    {
     "partner": "ATP5PO",
     "score": 0.282
    },
    {
     "partner": "TAP2",
     "score": 0.282
    },
    {
     "partner": "H7C0C1_HUMAN",
     "score": 0.282
    },
    {
     "partner": "MVK",
     "score": 0.281
    },
    {
     "partner": "UCP1",
     "score": 0.28
    },
    {
     "partner": "ABCE1",
     "score": 0.28
    },
    {
     "partner": "ABCA3",
     "score": 0.28
    },
    {
     "partner": "FGF21",
     "score": 0.28
    },
    {
     "partner": "ATP5MC2",
     "score": 0.28
    },
    {
     "partner": "GLP1R",
     "score": 0.279
    },
    {
     "partner": "KLF4",
     "score": 0.279
    },
    {
     "partner": "CEL",
     "score": 0.279
    },
    {
     "partner": "SMPD1",
     "score": 0.278
    },
    {
     "partner": "IRS2",
     "score": 0.278
    },
    {
     "partner": "ELOVL5",
     "score": 0.277
    },
    {
     "partner": "PRKAA1",
     "score": 0.276
    },
    {
     "partner": "ABCF2-2",
     "score": 0.275
    },
    {
     "partner": "CD8A",
     "score": 0.275
    },
    {
     "partner": "SLC27A1",
     "score": 0.274
    },
    {
     "partner": "ATP5PF",
     "score": 0.274
    },
    {
     "partner": "ABCC6",
     "score": 0.273
    },
    {
     "partner": "ABCF2",
     "score": 0.273
    },
    {
     "partner": "FABP5",
     "score": 0.273
    },
    {
     "partner": "ATP8B3",
     "score": 0.272
    },
    {
     "partner": "NSDHL",
     "score": 0.272
    },
    {
     "partner": "JUN",
     "score": 0.272
    },
    {
     "partner": "ACSL1",
     "score": 0.272
    },
    {
     "partner": "ABCA8",
     "score": 0.272
    },
    {
     "partner": "PTGS2",
     "score": 0.271
    },
    {
     "partner": "NFE2L2",
     "score": 0.27
    },
    {
     "partner": "HMGA1",
     "score": 0.27
    },
    {
     "partner": "SLC2A1",
     "score": 0.27
    },
    {
     "partner": "IL17A",
     "score": 0.27
    },
    {
     "partner": "GPAM",
     "score": 0.269
    },
    {
     "partner": "NCOR1",
     "score": 0.269
    },
    {
     "partner": "ABCB9",
     "score": 0.269
    },
    {
     "partner": "G6PC",
     "score": 0.268
    },
    {
     "partner": "SCP2",
     "score": 0.268
    },
    {
     "partner": "ABCA13",
     "score": 0.268
    },
    {
     "partner": "PNLIP",
     "score": 0.267
    },
    {
     "partner": "LPIN1",
     "score": 0.267
    },
    {
     "partner": "PTPRC",
     "score": 0.267
    },
    {
     "partner": "ALOX15",
     "score": 0.266
    },
    {
     "partner": "CXCR2",
     "score": 0.264
    },
    {
     "partner": "CXCL8",
     "score": 0.261
    },
    {
     "partner": "IL1A",
     "score": 0.26
    },
    {
     "partner": "SLC25A47",
     "score": 0.26
    },
    {
     "partner": "HSD17B7",
     "score": 0.259
    },
    {
     "partner": "SAMD12",
     "score": 0.259
    },
    {
     "partner": "CASP3",
     "score": 0.258
    },
    {
     "partner": "APOL1",
     "score": 0.258
    },
    {
     "partner": "LPGAT1",
     "score": 0.258
    },
    {
     "partner": "GPX3",
     "score": 0.258
    },
    {
     "partner": "HDAC3",
     "score": 0.257
    },
    {
     "partner": "ATP5F1E",
     "score": 0.256
    },
    {
     "partner": "EDN1",
     "score": 0.256
    },
    {
     "partner": "KMT2B",
     "score": 0.256
    },
    {
     "partner": "ZNF202",
     "score": 0.256
    },
    {
     "partner": "KMT2A",
     "score": 0.256
    },
    {
     "partner": "ENSP00000498126",
     "score": 0.256
    },
    {
     "partner": "CSF1R",
     "score": 0.255
    },
    {
     "partner": "ABCB7",
     "score": 0.254
    },
    {
     "partner": "LGALS3",
     "score": 0.254
    },
    {
     "partner": "ACAT2",
     "score": 0.254
    },
    {
     "partner": "ATP5MD",
     "score": 0.254
    },
    {
     "partner": "YARS1",
     "score": 0.254
    },
    {
     "partner": "ATP5MF",
     "score": 0.253
    },
    {
     "partner": "C17ORF80",
     "score": 0.253
    },
    {
     "partner": "PRKACB",
     "score": 0.253
    },
    {
     "partner": "ATP5ME",
     "score": 0.252
    },
    {
     "partner": "PMVK",
     "score": 0.252
    },
    {
     "partner": "BCL2",
     "score": 0.252
    },
    {
     "partner": "UQCRB",
     "score": 0.252
    },
    {
     "partner": "SOD2-2",
     "score": 0.251
    },
    {
     "partner": "GPIHBP1",
     "score": 0.251
    },
    {
     "partner": "ZFAT",
     "score": 0.25
    },
    {
     "partner": "SORL1",
     "score": 0.249
    },
    {
     "partner": "ACOX3",
     "score": 0.249
    },
    {
     "partner": "ACSL3",
     "score": 0.249
    },
    {
     "partner": "GCG",
     "score": 0.249
    },
    {
     "partner": "SPI1",
     "score": 0.248
    },
    {
     "partner": "PDZK1",
     "score": 0.248
    },
    {
     "partner": "GIT2",
     "score": 0.246
    },
    {
     "partner": "CX3CR1",
     "score": 0.246
    },
    {
     "partner": "PNLIPRP3",
     "score": 0.246
    },
    {
     "partner": "GIT1",
     "score": 0.246
    },
    {
     "partner": "RSPH1",
     "score": 0.244
    },
    {
     "partner": "CUBN",
     "score": 0.244
    },
    {
     "partner": "GALNT2",
     "score": 0.243
    },
    {
     "partner": "SCD5",
     "score": 0.242
    },
    {
     "partner": "TFRC",
     "score": 0.242
    },
    {
     "partner": "ELOVL6",
     "score": 0.242
    },
    {
     "partner": "GPT",
     "score": 0.242
    },
    {
     "partner": "NCOA1",
     "score": 0.242
    },
    {
     "partner": "KDM6B",
     "score": 0.241
    },
    {
     "partner": "LRP6",
     "score": 0.241
    },
    {
     "partner": "ABCG2",
     "score": 0.241
    },
    {
     "partner": "CYP3A4",
     "score": 0.241
    },
    {
     "partner": "MMP2",
     "score": 0.24
    },
    {
     "partner": "CTSS",
     "score": 0.24
    },
    {
     "partner": "FOXO1",
     "score": 0.24
    },
    {
     "partner": "PLA2G2A",
     "score": 0.24
    },
    {
     "partner": "PRKACG",
     "score": 0.239
    },
    {
     "partner": "ABCA10",
     "score": 0.238
    },
    {
     "partner": "WDPCP",
     "score": 0.238
    },
    {
     "partner": "RETNLB",
     "score": 0.238
    },
    {
     "partner": "YY1",
     "score": 0.237
    },
    {
     "partner": "TM7SF2",
     "score": 0.237
    },
    {
     "partner": "ZFP42",
     "score": 0.237
    },
    {
     "partner": "IDI1",
     "score": 0.237
    },
    {
     "partner": "UMODL1",
     "score": 0.237
    },
    {
     "partner": "YY2",
     "score": 0.237
    },
    {
     "partner": "GPBAR1",
     "score": 0.237
    },
    {
     "partner": "G6PC3",
     "score": 0.236
    },
    {
     "partner": "G6PC2",
     "score": 0.236
    },
    {
     "partner": "CEBPA",
     "score": 0.236
    },
    {
     "partner": "ABCC8",
     "score": 0.236
    },
    {
     "partner": "AMN",
     "score": 0.235
    },
    {
     "partner": "PRKACA",
     "score": 0.235
    },
    {
     "partner": "ALOX5",
     "score": 0.235
    },
    {
     "partner": "MBTPS2",
     "score": 0.235
    },
    {
     "partner": "ENPP3",
     "score": 0.235
    },
    {
     "partner": "LTB4R2",
     "score": 0.235
    },
    {
     "partner": "ENPP1",
     "score": 0.235
    },
    {
     "partner": "BMP4",
     "score": 0.234
    },
    {
     "partner": "KLF2",
     "score": 0.234
    },
    {
     "partner": "ABCC9",
     "score": 0.234
    },
    {
     "partner": "RAG1",
     "score": 0.234
    },
    {
     "partner": "STARD3",
     "score": 0.234
    },
    {
     "partner": "CCT4",
     "score": 0.234
    },
    {
     "partner": "CXCL10",
     "score": 0.233
    },
    {
     "partner": "PLIN3",
     "score": 0.232
    },
    {
     "partner": "RPS3",
     "score": 0.232
    },
    {
     "partner": "LDLRAP1",
     "score": 0.232
    },
    {
     "partner": "APOH",
     "score": 0.231
    },
    {
     "partner": "SPTLC2",
     "score": 0.231
    },
    {
     "partner": "SORT1",
     "score": 0.231
    },
    {
     "partner": "CYP11A1",
     "score": 0.231
    },
    {
     "partner": "ATF3",
     "score": 0.231
    },
    {
     "partner": "CCL5",
     "score": 0.231
    },
    {
     "partner": "SC5D",
     "score": 0.229
    },
    {
     "partner": "ABCA4",
     "score": 0.229
    },
    {
     "partner": "JAK2",
     "score": 0.229
    },
    {
     "partner": "PRMT2",
     "score": 0.229
    },
    {
     "partner": "NR3C1",
     "score": 0.228
    },
    {
     "partner": "MBTPS1",
     "score": 0.228
    },
    {
     "partner": "FCGR3A",
     "score": 0.228
    },
    {
     "partner": "MMP12",
     "score": 0.228
    },
    {
     "partner": "CTSD",
     "score": 0.227
    },
    {
     "partner": "IRS1",
     "score": 0.227
    },
    {
     "partner": "ABCA9",
     "score": 0.227
    },
    {
     "partner": "HCAR2",
     "score": 0.227
    },
    {
     "partner": "ARG2",
     "score": 0.226
    },
    {
     "partner": "CDR2",
     "score": 0.226
    },
    {
     "partner": "STARD5",
     "score": 0.226
    },
    {
     "partner": "SLC37A1",
     "score": 0.226
    },
    {
     "partner": "ADIPOR2",
     "score": 0.226
    },
    {
     "partner": "MT-ATP8",
     "score": 0.226
    },
    {
     "partner": "SPEF1",
     "score": 0.226
    },
    {
     "partner": "HDAC9",
     "score": 0.226
    },
    {
     "partner": "CXCL16",
     "score": 0.225
    },
    {
     "partner": "PSEN1",
     "score": 0.225
    },
    {
     "partner": "ECHS1",
     "score": 0.225
    },
    {
     "partner": "PDK1",
     "score": 0.225
    },
    {
     "partner": "CSF2RB",
     "score": 0.225
    },
    {
     "partner": "PECAM1",
     "score": 0.225
    },
    {
     "partner": "NOX4",
     "score": 0.224
    },
    {
     "partner": "REN",
     "score": 0.224
    },
    {
     "partner": "CYCS",
     "score": 0.224
    },
    {
     "partner": "GPX6",
     "score": 0.224
    },
    {
     "partner": "XDH",
     "score": 0.224
    },
    {
     "partner": "NFKBIA",
     "score": 0.223
    },
    {
     "partner": "CLEC7A",
     "score": 0.223
    },
    {
     "partner": "ZBTB21",
     "score": 0.223
    },
    {
     "partner": "CES1",
     "score": 0.223
    },
    {
     "partner": "KCNQ1",
     "score": 0.222
    },
    {
     "partner": "TNFRSF10A",
     "score": 0.222
    },
    {
     "partner": "KDR",
     "score": 0.222
    },
    {
     "partner": "MGLL",
     "score": 0.222
    },
    {
     "partner": "IL3",
     "score": 0.222
    },
    {
     "partner": "MT-ATP6",
     "score": 0.222
    },
    {
     "partner": "CD44",
     "score": 0.222
    },
    {
     "partner": "FTO",
     "score": 0.222
    },
    {
     "partner": "PDK2",
     "score": 0.222
    },
    {
     "partner": "ATP5MG",
     "score": 0.221
    },
    {
     "partner": "EIF2AK3",
     "score": 0.221
    },
    {
     "partner": "STAT1",
     "score": 0.221
    },
    {
     "partner": "ATP5MGL",
     "score": 0.221
    },
    {
     "partner": "PDK3",
     "score": 0.221
    },
    {
     "partner": "TAC4",
     "score": 0.22
    },
    {
     "partner": "ALDH18A1",
     "score": 0.22
    },
    {
     "partner": "SLC29A3",
     "score": 0.22
    },
    {
     "partner": "NR4A1",
     "score": 0.22
    },
    {
     "partner": "CX3CL1",
     "score": 0.219
    },
    {
     "partner": "CEBPB",
     "score": 0.219
    },
    {
     "partner": "FCGR3B",
     "score": 0.219
    },
    {
     "partner": "PFKFB3",
     "score": 0.219
    },
    {
     "partner": "SERPINE1",
     "score": 0.218
    },
    {
     "partner": "CCR7",
     "score": 0.218
    },
    {
     "partner": "F3",
     "score": 0.218
    },
    {
     "partner": "SPP1",
     "score": 0.218
    },
    {
     "partner": "GGPS1",
     "score": 0.217
    },
    {
     "partner": "CXCL12",
     "score": 0.217
    },
    {
     "partner": "CSF3",
     "score": 0.216
    },
    {
     "partner": "FLOT1",
     "score": 0.216
    },
    {
     "partner": "GPX5",
     "score": 0.216
    },
    {
     "partner": "RETN",
     "score": 0.215
    },
    {
     "partner": "VWF",
     "score": 0.215
    },
    {
     "partner": "OSBPL5",
     "score": 0.215
    },
    {
     "partner": "TFEB",
     "score": 0.215
    },
    {
     "partner": "CXCR4",
     "score": 0.215
    },
    {
     "partner": "ABHD5",
     "score": 0.215
    },
    {
     "partner": "ACE",
     "score": 0.214
    },
    {
     "partner": "CSTF3",
     "score": 0.214
    },
    {
     "partner": "SERPINA1",
     "score": 0.214
    },
    {
     "partner": "ACADM",
     "score": 0.213
    },
    {
     "partner": "FOXP3",
     "score": 0.213
    },
    {
     "partner": "TSPO",
     "score": 0.213
    },
    {
     "partner": "DROSHA",
     "score": 0.213
    },
    {
     "partner": "EEPD1",
     "score": 0.212
    },
    {
     "partner": "SIK1",
     "score": 0.212
    },
    {
     "partner": "KIT",
     "score": 0.212
    },
    {
     "partner": "TLR3",
     "score": 0.212
    },
    {
     "partner": "CPT2",
     "score": 0.212
    },
    {
     "partner": "C1QA",
     "score": 0.212
    },
    {
     "partner": "SIK1B",
     "score": 0.212
    },
    {
     "partner": "SCML2",
     "score": 0.211
    },
    {
     "partner": "PDXK",
     "score": 0.211
    },
    {
     "partner": "TCERG1",
     "score": 0.211
    },
    {
     "partner": "SLC27A4",
     "score": 0.211
    },
    {
     "partner": "SCMH1",
     "score": 0.211
    },
    {
     "partner": "TCERG1L",
     "score": 0.211
    },
    {
     "partner": "AIF1",
     "score": 0.211
    },
    {
     "partner": "SCML1",
     "score": 0.211
    },
    {
     "partner": "CCL3",
     "score": 0.211
    },
    {
     "partner": "TCF7L2",
     "score": 0.211
    }
   ],
   "limit": 500,
   "minScore": 0.15
  },
  "stringVersion": "12.5",
  "subunitComment": "Homodimer; disulfide-linked (PubMed:16702602). Homooligomer (PubMed:16702602). May form heterodimers with several heterologous partners of the ABCG subfamily. Forms heterodimers with ABCG4 (PubMed:27228027). Interacts with CAV1; this interaction regulates ABCG1-mediated cholesterol efflux (PubMed:24576892)",
  "curatedInteractions": [
   {
    "accession": "Q9H172",
    "gene": "ABCG4",
    "experiments": 2,
    "evidence": null
   },
   {
    "accession": "Q13520",
    "gene": "AQP6",
    "experiments": 3,
    "evidence": null
   },
   {
    "accession": "P13473-2",
    "gene": "LAMP2",
    "experiments": 3,
    "evidence": null
   },
   {
    "accession": "O75400-2",
    "gene": "PRPF40A",
    "experiments": 3,
    "evidence": null
   },
   {
    "accession": "Q9Y371",
    "gene": "SH3GLB1",
    "experiments": 3,
    "evidence": null
   }
  ],
  "interactionSites": [],
  "sequenceLength": 678,
  "lookups": {
   "stringPartners": "ok",
   "stringPhysical": "ok",
   "intact": "ok",
   "uniprot": "ok"
  }
 }
};
