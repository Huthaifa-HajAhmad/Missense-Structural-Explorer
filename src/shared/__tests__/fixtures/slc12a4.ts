/**
 * SLC12A4 p.Gln867His (UniProtKB Q9UP95, KCC1): the reference variant of doc/INTERFACES_AUDIT.md.
 * Captured from the live services on 2026-10-02 through `analyzeMultimerStructure` (lookups only) and
 * `analyzePpiBinding`. STRING functional list (379 rows) trimmed to its top 40 plus every curated
 * partner it contains, so each partner the tests read keeps its real score.
 */
/* eslint-disable */
export const SLC12A4: any = {
 "result": {
  "metadata": {
   "gene": "SLC12A4",
   "variant": "p.Gln867His",
   "uniprotId": "Q9UP95",
   "residueIndex": 867
  },
  "uniprotFeatures": {
   "subunitComment": "Homodimer; adopts a domain-swap conformation at the scissor helices connecting the transmembrane domain and C-terminal domain (PubMed:31649201, PubMed:34031912, PubMed:35759661). Heterodimer with other K-Cl cotransporters (Probable)",
   "sequenceLength": 1085,
   "features": [
    {
     "type": "Topological domain",
     "description": "Cytoplasmic",
     "start": 1,
     "end": 119
    },
    {
     "type": "Transmembrane",
     "description": "Discontinuously helical; Name=1",
     "start": 120,
     "end": 141
    },
    {
     "type": "Topological domain",
     "description": "Extracellular",
     "start": 142,
     "end": 149
    },
    {
     "type": "Transmembrane",
     "description": "Helical; Name=2",
     "start": 150,
     "end": 172
    },
    {
     "type": "Topological domain",
     "description": "Cytoplasmic",
     "start": 173,
     "end": 196
    },
    {
     "type": "Transmembrane",
     "description": "Helical; Name=3",
     "start": 197,
     "end": 225
    },
    {
     "type": "Topological domain",
     "description": "Extracellular",
     "start": 226,
     "end": 248
    },
    {
     "type": "Transmembrane",
     "description": "Helical; Name=4",
     "start": 249,
     "end": 271
    },
    {
     "type": "Transmembrane",
     "description": "Helical; Name=5",
     "start": 272,
     "end": 297
    },
    {
     "type": "Topological domain",
     "description": "Extracellular",
     "start": 298,
     "end": 419
    },
    {
     "type": "Transmembrane",
     "description": "Helical; Name=6",
     "start": 420,
     "end": 440
    },
    {
     "type": "Topological domain",
     "description": "Cytoplasmic",
     "start": 441,
     "end": 450
    },
    {
     "type": "Transmembrane",
     "description": "Helical; Name=7",
     "start": 451,
     "end": 473
    },
    {
     "type": "Topological domain",
     "description": "Extracellular",
     "start": 474,
     "end": 504
    },
    {
     "type": "Transmembrane",
     "description": "Helical; Name=8",
     "start": 505,
     "end": 531
    },
    {
     "type": "Topological domain",
     "description": "Cytoplasmic",
     "start": 532,
     "end": 554
    },
    {
     "type": "Transmembrane",
     "description": "Helical; Name=9",
     "start": 555,
     "end": 575
    },
    {
     "type": "Transmembrane",
     "description": "Helical; Name=10",
     "start": 576,
     "end": 598
    },
    {
     "type": "Topological domain",
     "description": "Cytoplasmic",
     "start": 599,
     "end": 612
    },
    {
     "type": "Transmembrane",
     "description": "Helical; Name=11",
     "start": 613,
     "end": 635
    },
    {
     "type": "Transmembrane",
     "description": "Helical; Name=12",
     "start": 636,
     "end": 651
    },
    {
     "type": "Topological domain",
     "description": "Cytoplasmic",
     "start": 652,
     "end": 1085
    },
    {
     "type": "Region",
     "description": "Scissor helix",
     "start": 665,
     "end": 681
    }
   ]
  }
 },
 "assembly": {
  "gene": "SLC12A4",
  "uniprotId": "Q9UP95",
  "complexPdb": null,
  "ipTm": null,
  "pTm": null,
  "interfaceContacts": [],
  "variantPosition": 867,
  "variantAtInterface": null,
  "subunitComment": "Homodimer; adopts a domain-swap conformation at the scissor helices connecting the transmembrane domain and C-terminal domain (PubMed:31649201, PubMed:34031912, PubMed:35759661). Heterodimer with other K-Cl cotransporters (Probable)",
  "assembly": {
   "qualifier": null,
   "statements": [
    {
     "kind": "homomer",
     "label": "Homodimer",
     "qualifier": null,
     "sentence": "Homodimer; adopts a domain-swap conformation at the scissor helices connecting the transmembrane domain and C-terminal domain (PubMed:31649201, PubMed:34031912, PubMed:35759661).",
     "partnerGenes": [],
     "family": null
    },
    {
     "kind": "heteromer",
     "label": "Heterodimer",
     "qualifier": "Probable",
     "sentence": "Heterodimer with other K-Cl cotransporters (Probable)",
     "partnerGenes": [],
     "family": "other K-Cl cotransporters"
    }
   ],
   "kind": "homomer",
   "label": "Homodimer",
   "copies": 2,
   "homoAssumed": false,
   "sentence": "Homodimer; adopts a domain-swap conformation at the scissor helices connecting the transmembrane domain and C-terminal domain (PubMed:31649201, PubMed:34031912, PubMed:35759661).",
   "alsoStated": [
    "Heterodimer"
   ],
   "partners": []
  },
  "experimental": {
   "status": "ok",
   "partners": [
    {
     "accession": "Q9UP95",
     "name": "Solute carrier family 12 member 4",
     "residues": [
      242,
      252,
      344,
      352,
      386,
      402,
      403,
      404,
      405,
      406,
      537,
      540,
      541,
      542,
      543,
      544,
      556,
      563,
      567,
      570,
      571,
      603,
      631,
      635,
      636,
      639,
      640,
      643,
      647,
      648,
      650,
      651,
      659,
      660,
      661,
      662,
      663,
      665,
      666,
      669,
      670,
      673,
      674,
      676,
      677,
      678,
      679,
      680,
      681,
      683,
      684,
      685,
      687,
      688,
      689,
      691,
      693,
      721,
      722,
      723,
      724,
      726,
      735,
      736,
      739,
      746,
      750,
      759,
      761,
      762,
      763,
      765,
      766,
      767,
      768,
      769,
      772,
      776,
      779,
      780,
      781,
      782,
      783,
      785,
      786,
      787,
      816,
      817,
      820,
      821,
      867,
      903
     ],
     "support": [
      3,
      1,
      1,
      1,
      3,
      3,
      3,
      3,
      3,
      4,
      1,
      2,
      3,
      3,
      3,
      1,
      1,
      2,
      3,
      4,
      3,
      3,
      2,
      5,
      4,
      5,
      3,
      2,
      3,
      1,
      1,
      3,
      2,
      3,
      4,
      4,
      1,
      3,
      4,
      4,
      4,
      2,
      4,
      4,
      4,
      4,
      3,
      4,
      4,
      1,
      2,
      2,
      3,
      1,
      4,
      4,
      4,
      2,
      3,
      4,
      3,
      1,
      4,
      1,
      2,
      1,
      3,
      4,
      4,
      1,
      3,
      4,
      4,
      4,
      1,
      2,
      1,
      4,
      4,
      4,
      2,
      3,
      4,
      2,
      4,
      3,
      1,
      3,
      2,
      2,
      1,
      3
     ],
     "pdbEntries": [
      "6kkr",
      "6kkt",
      "6kku",
      "7aip",
      "7aiq",
      "7air",
      "7tth",
      "7tti"
     ],
     "homomeric": true,
     "artefact": null,
     "variantAtInterface": true,
     "variantEntries": [
      "7aiq"
     ]
    }
   ]
  },
  "oligomericState": "Homodimer",
  "chainCount": 2,
  "chainIds": [
   "A",
   "B"
  ],
  "chains": [
   {
    "accession": "Q9UP95",
    "gene": "SLC12A4",
    "length": 1085,
    "carriesVariant": true,
    "id": "A"
   },
   {
    "accession": "Q9UP95",
    "gene": "SLC12A4",
    "length": 1085,
    "carriesVariant": false,
    "id": "B"
   }
  ],
  "provenance": "Boltz-2 via JapanFold",
  "status": "not-requested"
 },
 "ppi": {
  "status": "success",
  "gene": "SLC12A4",
  "variant": "p.Gln867His",
  "uniprotId": "Q9UP95",
  "position": 867,
  "stringPartners": [
   {
    "partner": "SLC12A6",
    "score": 0.999
   },
   {
    "partner": "SLC12A7",
    "score": 0.982
   },
   {
    "partner": "SLC12A5",
    "score": 0.957
   },
   {
    "partner": "LGALS9C",
    "score": 0.933
   },
   {
    "partner": "WNK3",
    "score": 0.904
   }
  ],
  "string": {
   "physical": [
    {
     "partner": "SLC12A6",
     "score": 0.999
    },
    {
     "partner": "SLC12A7",
     "score": 0.982
    },
    {
     "partner": "SLC12A5",
     "score": 0.938
    },
    {
     "partner": "LGALS9C",
     "score": 0.933
    },
    {
     "partner": "LGALS9",
     "score": 0.803
    },
    {
     "partner": "PLP2",
     "score": 0.586
    },
    {
     "partner": "LGALS3",
     "score": 0.576
    },
    {
     "partner": "RAB6B",
     "score": 0.576
    },
    {
     "partner": "TMEM9B",
     "score": 0.544
    },
    {
     "partner": "LYPD6",
     "score": 0.533
    },
    {
     "partner": "TMEM102",
     "score": 0.529
    },
    {
     "partner": "FAM189A2",
     "score": 0.501
    },
    {
     "partner": "RAB6A",
     "score": 0.498
    },
    {
     "partner": "KRAS",
     "score": 0.482
    },
    {
     "partner": "HNRNPH1",
     "score": 0.457
    },
    {
     "partner": "ZRANB1",
     "score": 0.457
    },
    {
     "partner": "TRIM67",
     "score": 0.457
    },
    {
     "partner": "AGRN",
     "score": 0.457
    },
    {
     "partner": "SNX27",
     "score": 0.457
    },
    {
     "partner": "LGALS8",
     "score": 0.454
    },
    {
     "partner": "POPDC2",
     "score": 0.438
    },
    {
     "partner": "HRAS",
     "score": 0.43
    },
    {
     "partner": "SLC1A1",
     "score": 0.408
    },
    {
     "partner": "LYSMD4",
     "score": 0.408
    },
    {
     "partner": "ATRNL1",
     "score": 0.408
    },
    {
     "partner": "PKN2",
     "score": 0.408
    },
    {
     "partner": "PCDHA3",
     "score": 0.399
    },
    {
     "partner": "LNPEP",
     "score": 0.38
    },
    {
     "partner": "CLCN3",
     "score": 0.38
    },
    {
     "partner": "MCOLN1",
     "score": 0.38
    },
    {
     "partner": "SLC1A3",
     "score": 0.38
    },
    {
     "partner": "PRKAR2A",
     "score": 0.38
    },
    {
     "partner": "TMEM9",
     "score": 0.38
    },
    {
     "partner": "CLCN5",
     "score": 0.38
    },
    {
     "partner": "CLCN4",
     "score": 0.38
    },
    {
     "partner": "PTPRD",
     "score": 0.38
    },
    {
     "partner": "SMCR8",
     "score": 0.38
    },
    {
     "partner": "CHRND",
     "score": 0.354
    },
    {
     "partner": "IL17RC",
     "score": 0.353
    },
    {
     "partner": "GPR21",
     "score": 0.353
    },
    {
     "partner": "SLC17A2",
     "score": 0.353
    },
    {
     "partner": "TNFRSF10A",
     "score": 0.343
    },
    {
     "partner": "FLOT1",
     "score": 0.33
    },
    {
     "partner": "PTH1R",
     "score": 0.325
    },
    {
     "partner": "CD55",
     "score": 0.306
    },
    {
     "partner": "TMEM43",
     "score": 0.277
    },
    {
     "partner": "ILF3",
     "score": 0.262
    },
    {
     "partner": "PCDHB16",
     "score": 0.225
    },
    {
     "partner": "NRN1",
     "score": 0.223
    },
    {
     "partner": "HSD17B10",
     "score": 0.22
    },
    {
     "partner": "MCAM",
     "score": 0.219
    },
    {
     "partner": "CWC27",
     "score": 0.188
    },
    {
     "partner": "ABCA2",
     "score": 0.171
    },
    {
     "partner": "OR10S1",
     "score": 0.165
    },
    {
     "partner": "KRTAP19-2",
     "score": 0.161
    },
    {
     "partner": "NRAS",
     "score": 0.155
    }
   ],
   "functional": [
    {
     "partner": "SLC12A6",
     "score": 0.999
    },
    {
     "partner": "SLC12A7",
     "score": 0.982
    },
    {
     "partner": "SLC12A5",
     "score": 0.957
    },
    {
     "partner": "LGALS9C",
     "score": 0.933
    },
    {
     "partner": "WNK3",
     "score": 0.904
    },
    {
     "partner": "PSKH1",
     "score": 0.815
    },
    {
     "partner": "LGALS9",
     "score": 0.803
    },
    {
     "partner": "WNK1",
     "score": 0.777
    },
    {
     "partner": "WNK4",
     "score": 0.76
    },
    {
     "partner": "CLCN3",
     "score": 0.678
    },
    {
     "partner": "STK39",
     "score": 0.674
    },
    {
     "partner": "PSMB10",
     "score": 0.661
    },
    {
     "partner": "OXSR1",
     "score": 0.629
    },
    {
     "partner": "LCAT",
     "score": 0.628
    },
    {
     "partner": "PLP2",
     "score": 0.6
    },
    {
     "partner": "RAB6B",
     "score": 0.591
    },
    {
     "partner": "WNK2",
     "score": 0.58
    },
    {
     "partner": "LGALS3",
     "score": 0.576
    },
    {
     "partner": "TMEM102",
     "score": 0.545
    },
    {
     "partner": "TMEM9B",
     "score": 0.544
    },
    {
     "partner": "LYPD6",
     "score": 0.541
    },
    {
     "partner": "FAM189A2",
     "score": 0.518
    },
    {
     "partner": "RAB6A",
     "score": 0.515
    },
    {
     "partner": "CLCN5",
     "score": 0.512
    },
    {
     "partner": "CLCN4",
     "score": 0.508
    },
    {
     "partner": "GABRA1",
     "score": 0.499
    },
    {
     "partner": "SLC1A3",
     "score": 0.489
    },
    {
     "partner": "FGD3",
     "score": 0.487
    },
    {
     "partner": "KRAS",
     "score": 0.482
    },
    {
     "partner": "AGRN",
     "score": 0.48
    },
    {
     "partner": "TRIM67",
     "score": 0.469
    },
    {
     "partner": "ZRANB1",
     "score": 0.459
    },
    {
     "partner": "SLC4A4",
     "score": 0.458
    },
    {
     "partner": "POPDC2",
     "score": 0.457
    },
    {
     "partner": "HNRNPH1",
     "score": 0.457
    },
    {
     "partner": "SNX27",
     "score": 0.457
    },
    {
     "partner": "LGALS8",
     "score": 0.454
    },
    {
     "partner": "SLC12A2",
     "score": 0.45
    },
    {
     "partner": "HRAS",
     "score": 0.443
    },
    {
     "partner": "SLC12A3",
     "score": 0.442
    },
    {
     "partner": "KRTAP19-2",
     "score": 0.161
    }
   ],
   "limit": 500,
   "minScore": 0.15
  },
  "stringVersion": "12.5",
  "subunitComment": "Homodimer; adopts a domain-swap conformation at the scissor helices connecting the transmembrane domain and C-terminal domain (PubMed:31649201, PubMed:34031912, PubMed:35759661). Heterodimer with other K-Cl cotransporters (Probable)",
  "curatedInteractions": [
   {
    "accession": "Q9Y2T2",
    "gene": "AP3M1",
    "experiments": 4,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid prey pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32296183"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "Q9BYD5",
    "gene": "CNFN",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid prey pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32296183"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "A8MQ03",
    "gene": "CYSRT1",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid prey pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32296183"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "P59991",
    "gene": "KRTAP12-2",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid prey pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32296183"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "Q3LHN2",
    "gene": "KRTAP19-2",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid prey pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32296183"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "Q8IYB1",
    "gene": "MB21D2",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid prey pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32296183"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "Q8N9M5",
    "gene": "TMEM102",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid prey pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32296183"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "Q8N720",
    "gene": "ZNF655",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid prey pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32296183"
     ],
     "twoHybridOnly": true
    }
   }
  ],
  "interactionSites": [],
  "sequenceLength": 1085,
  "lookups": {
   "stringPartners": "ok",
   "stringPhysical": "ok",
   "intact": "ok",
   "uniprot": "ok"
  }
 }
};
