/**
 * SOD1 p.Ala5Val (UniProtKB P00441; legacy A4V): the densest reference for the Interfaces & PPI tab
 * (doc/INTERFACES_PPI_REVIEW.md). Captured from the live services on 2026-10-04 through
 * `analyzeMultimerStructure` (lookups only) and `analyzePpiBinding`, after the fibril split: 142 native
 * homodimer entries, 15 amyloid fibril entries, an antibody and an unmapped chain, mouse SOD1 and
 * yeast CCS1, 80 UniProt partners (66 from one two-hybrid screen), STRING 213 physical and 500
 * functional (its cap). UniProt features kept to the types the track draws.
 */
/* eslint-disable */
export const SOD1_INTERFACES: any = {
 "result": {
  "metadata": {
   "gene": "SOD1",
   "variant": "p.Ala5Val",
   "uniprotId": "P00441",
   "residueIndex": 5,
   "sequence": "MATKAVCVLKGDGPVQGIINFEQKESNGPVKVWGSIKGLTEGLHGFHVHEFGDNTAGCTSAGPHFNPLSRKHGGPKDEERHVGDLGNVTADKDGVADVSIEDSVISLSGDHCIIGRTLVVHEKADDLGKGGNEESTKTGNAGSRLACGVIGIAQ"
  },
  "uniprotFeatures": {
   "subunitComment": "Homodimer; non-disulfide-linked (By similarity). Homodimerization may take place via the ditryptophan cross-link at Trp-33. Heterodimer with CCS (PubMed:31292775). The heterodimer CCS:SOD1 interacts with SLC31A1; this heterotrimer is Cu(1+)-mediated and its maintenance is regulated through SOD1 activation (PubMed:31292775). Interacts with DAOA; the interaction is direct (PubMed:30037290)",
   "sequenceLength": 154,
   "features": []
  }
 },
 "assembly": {
  "gene": "SOD1",
  "uniprotId": "P00441",
  "complexPdb": null,
  "ipTm": null,
  "pTm": null,
  "interfaceContacts": [],
  "variantPosition": 5,
  "variantAtInterface": null,
  "subunitComment": "Homodimer; non-disulfide-linked (By similarity). Homodimerization may take place via the ditryptophan cross-link at Trp-33. Heterodimer with CCS (PubMed:31292775). The heterodimer CCS:SOD1 interacts with SLC31A1; this heterotrimer is Cu(1+)-mediated and its maintenance is regulated through SOD1 activation (PubMed:31292775). Interacts with DAOA; the interaction is direct (PubMed:30037290)",
  "assembly": {
   "qualifier": "By similarity",
   "statements": [
    {
     "kind": "homomer",
     "label": "Homodimer",
     "qualifier": "By similarity",
     "sentence": "Homodimer; non-disulfide-linked (By similarity).",
     "partnerGenes": [],
     "family": null
    },
    {
     "kind": "heteromer",
     "label": "Heterodimer",
     "qualifier": null,
     "sentence": "Heterodimer with CCS (PubMed:31292775).",
     "partnerGenes": [
      "CCS"
     ],
     "family": null
    },
    {
     "kind": "heteromer",
     "label": "Heterotrimer",
     "qualifier": null,
     "sentence": "The heterodimer CCS:SOD1 interacts with SLC31A1; this heterotrimer is Cu(1+)-mediated and its maintenance is regulated through SOD1 activation (PubMed:31292775).",
     "partnerGenes": [
      "CCS",
      "SLC31A1"
     ],
     "family": null
    }
   ],
   "kind": "homomer",
   "label": "Homodimer",
   "copies": 2,
   "homoAssumed": false,
   "sentence": "Homodimer; non-disulfide-linked (By similarity).",
   "alsoStated": [
    "Heterodimer",
    "Heterotrimer"
   ],
   "partners": []
  },
  "experimental": {
   "status": "ok",
   "partners": [
    {
     "accession": "P00441",
     "name": "Superoxide dismutase [Cu-Zn]",
     "residues": [
      1,
      3,
      4,
      6,
      7,
      8,
      10,
      11,
      12,
      13,
      14,
      16,
      18,
      20,
      29,
      30,
      31,
      32,
      33,
      34,
      35,
      36,
      37,
      38,
      39,
      50,
      51,
      52,
      53,
      54,
      55,
      56,
      57,
      60,
      109,
      110,
      111,
      112,
      114,
      115,
      116,
      147,
      149,
      150,
      151,
      152,
      153,
      154
     ],
     "support": [
      1,
      1,
      1,
      104,
      1,
      104,
      31,
      2,
      1,
      1,
      1,
      1,
      96,
      1,
      2,
      2,
      2,
      2,
      2,
      2,
      2,
      2,
      2,
      2,
      2,
      3,
      104,
      104,
      103,
      103,
      104,
      1,
      1,
      1,
      1,
      3,
      2,
      1,
      103,
      104,
      101,
      1,
      104,
      9,
      104,
      104,
      101,
      102
     ],
     "pdbEntries": [
      "1azv",
      "1ba9",
      "1dsw",
      "1fun",
      "1hl4",
      "1hl5",
      "1kmg",
      "1l3n",
      "1mfm",
      "1n18",
      "1n19",
      "1oez",
      "1ozt",
      "1ozu",
      "1p1v",
      "1ptz",
      "1pu0",
      "1rk7",
      "1sos",
      "1spd",
      "1uxl",
      "1uxm",
      "23wu",
      "2af2",
      "2c9s",
      "2c9u",
      "2c9v",
      "2gbt",
      "2gbu",
      "2gbv",
      "2lu5",
      "2mp3",
      "2nam",
      "2nnx",
      "2r27",
      "2v0a",
      "2vr6",
      "2vr7",
      "2vr8",
      "2wko",
      "2wyt",
      "2wyz",
      "2wz0",
      "2wz5",
      "2wz6",
      "2xjk",
      "2xjl",
      "2zkw",
      "2zkx",
      "2zky",
      "3cqp",
      "3cqq",
      "3ecu",
      "3ecv",
      "3ecw",
      "3gqf",
      "3gtv",
      "3gzo",
      "3gzp",
      "3gzq",
      "3h2p",
      "3h2q",
      "3hff",
      "3k91",
      "3kh3",
      "3kh4",
      "3ltv",
      "3qqd",
      "3re0",
      "3t5w",
      "4a7g",
      "4a7q",
      "4a7s",
      "4a7t",
      "4a7u",
      "4a7v",
      "4b3e",
      "4bcy",
      "4bcz",
      "4bd4",
      "4ff9",
      "4mcm",
      "4mcn",
      "4oh2",
      "4xcr",
      "5dli",
      "5iiw",
      "5j07",
      "5j0c",
      "5j0f",
      "5j0g",
      "5k02",
      "5o3y",
      "5o40",
      "5u9m",
      "5yto",
      "5ytu",
      "5yul",
      "6a9o",
      "6dtk",
      "6ffk",
      "6flh",
      "6foi",
      "6fol",
      "6fon",
      "6fp6",
      "6spa",
      "6sph",
      "6spi",
      "6spj",
      "6spk",
      "6z3v",
      "6z4g",
      "6z4h",
      "6z4i",
      "6z4j",
      "6z4k",
      "6z4l",
      "6z4m",
      "6z4o",
      "7cjv",
      "7cjw",
      "7fb6",
      "7fb9",
      "7nxx",
      "7t8e",
      "7t8f",
      "7t8g",
      "7t8h",
      "7xx3",
      "8ccx",
      "8gsq",
      "8k33",
      "8k3a",
      "8k3l",
      "8q6m",
      "8yaf",
      "8yat",
      "8yd3",
      "9iyk",
      "9xj0",
      "9xji"
     ],
     "homomeric": true,
     "artefact": null,
     "context": "native",
     "gene": "SOD1",
     "organism": null,
     "variantAtInterface": false,
     "variantEntries": []
    },
    {
     "accession": "P00441",
     "name": "Superoxide dismutase [Cu-Zn]",
     "residues": [
      2,
      3,
      4,
      5,
      6,
      7,
      8,
      9,
      10,
      11,
      12,
      13,
      14,
      15,
      16,
      17,
      18,
      19,
      20,
      21,
      22,
      23,
      24,
      25,
      26,
      27,
      28,
      29,
      30,
      31,
      32,
      33,
      34,
      35,
      36,
      37,
      38,
      39,
      40,
      41,
      42,
      43,
      44,
      45,
      46,
      47,
      48,
      49,
      50,
      51,
      52,
      53,
      54,
      55,
      56,
      82,
      83,
      84,
      85,
      86,
      87,
      88,
      89,
      90,
      91,
      92,
      93,
      94,
      95,
      96,
      97,
      98,
      99,
      100,
      101,
      102,
      103,
      104,
      105,
      106,
      107,
      108,
      109,
      110,
      111,
      112,
      113,
      114,
      115,
      116,
      117,
      118,
      119,
      120,
      121,
      122,
      123,
      124,
      125,
      126,
      127,
      128,
      129,
      130,
      131,
      132,
      133,
      134,
      135,
      136,
      137,
      138,
      139,
      140,
      141,
      142,
      143,
      144,
      145,
      146,
      147,
      148,
      149,
      150,
      151,
      152,
      153,
      154
     ],
     "support": [
      3,
      3,
      4,
      4,
      4,
      4,
      4,
      4,
      4,
      4,
      4,
      4,
      4,
      4,
      4,
      4,
      4,
      4,
      4,
      4,
      4,
      4,
      4,
      4,
      4,
      4,
      4,
      7,
      7,
      8,
      8,
      8,
      8,
      8,
      8,
      7,
      7,
      7,
      5,
      4,
      4,
      2,
      2,
      2,
      2,
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
      3,
      4,
      4,
      5,
      6,
      6,
      6,
      6,
      6,
      6,
      6,
      6,
      6,
      7,
      7,
      7,
      7,
      7,
      7,
      8,
      8,
      8,
      8,
      8,
      8,
      8,
      7,
      7,
      7,
      7,
      7,
      7,
      7,
      7,
      7,
      7,
      7,
      7,
      7,
      7,
      5,
      5,
      5,
      5,
      5,
      5,
      5,
      5,
      5,
      5,
      5,
      5,
      5,
      5,
      5,
      5,
      5,
      5,
      5,
      5,
      5,
      5,
      5,
      5,
      5,
      7,
      7,
      7,
      7,
      7,
      7,
      7
     ],
     "pdbEntries": [
      "4nin",
      "4nio",
      "4nip",
      "5wmj",
      "5wor",
      "6b79",
      "7vzf",
      "8ihu",
      "8ihv",
      "9iyd",
      "9iyj",
      "9jbo",
      "9jbp",
      "9li1",
      "9mil"
     ],
     "homomeric": true,
     "artefact": null,
     "context": "fibril",
     "gene": "SOD1",
     "organism": null,
     "variantAtInterface": true,
     "variantEntries": [
      "7vzf",
      "9jbo",
      "9jbp",
      "9li1"
     ]
    },
    {
     "accession": "O14618",
     "name": "Copper chaperone for superoxide dismutase",
     "residues": [
      6,
      8,
      18,
      51,
      52,
      53,
      54,
      55,
      56,
      59,
      60,
      62,
      112,
      114,
      115,
      116,
      149,
      151,
      152,
      153,
      154
     ],
     "support": [
      3,
      3,
      3,
      3,
      3,
      3,
      3,
      3,
      1,
      1,
      1,
      1,
      3,
      3,
      3,
      3,
      3,
      3,
      3,
      2,
      3
     ],
     "pdbEntries": [
      "6fol",
      "6fon",
      "6fp6"
     ],
     "homomeric": false,
     "artefact": null,
     "context": "native",
     "gene": "CCS",
     "organism": null,
     "variantAtInterface": false,
     "variantEntries": []
    },
    {
     "accession": "P08228",
     "name": "Superoxide dismutase [Cu-Zn]",
     "residues": [
      6,
      8,
      18,
      51,
      52,
      53,
      54,
      55,
      114,
      115,
      149,
      151,
      152,
      153,
      154
     ],
     "support": [
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
      1
     ],
     "pdbEntries": [
      "3gtv",
      "3ltv"
     ],
     "homomeric": false,
     "artefact": null,
     "context": "native",
     "gene": "Sod1",
     "organism": "Mouse",
     "variantAtInterface": false,
     "variantEntries": []
    },
    {
     "accession": "P40202",
     "name": "Superoxide dismutase 1 copper chaperone",
     "residues": [
      6,
      8,
      10,
      12,
      51,
      52,
      53,
      54,
      55,
      112,
      114,
      115,
      116,
      149,
      151,
      152,
      153,
      154
     ],
     "support": [
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
      1
     ],
     "pdbEntries": [
      "5u9m"
     ],
     "homomeric": false,
     "artefact": null,
     "context": "native",
     "gene": "CCS1",
     "organism": "Baker's yeast",
     "variantAtInterface": false,
     "variantEntries": []
    },
    {
     "accession": "IG-heavy chain",
     "name": "NB1",
     "residues": [
      12,
      13,
      14,
      16,
      25,
      27,
      28,
      29,
      31,
      37,
      38,
      39,
      40,
      41,
      42,
      43,
      68,
      70,
      75,
      76,
      77,
      78,
      87,
      89,
      92,
      93,
      94,
      99,
      100,
      101,
      102,
      103,
      104,
      111,
      122,
      123,
      124,
      125,
      126,
      127,
      129,
      130,
      131,
      132,
      140,
      143,
      145
     ],
     "support": [
      1,
      1,
      4,
      3,
      2,
      2,
      2,
      2,
      2,
      3,
      4,
      4,
      5,
      5,
      3,
      3,
      2,
      1,
      2,
      4,
      2,
      1,
      3,
      2,
      4,
      4,
      4,
      2,
      2,
      2,
      2,
      2,
      2,
      1,
      2,
      3,
      3,
      3,
      3,
      3,
      3,
      3,
      3,
      3,
      3,
      2,
      3
     ],
     "pdbEntries": [
      "7nxx",
      "8k33",
      "8k3a",
      "8k3l",
      "8yaf",
      "8yat"
     ],
     "homomeric": false,
     "artefact": "antibody or nanobody, a tool binder",
     "context": "native",
     "gene": null,
     "organism": null,
     "variantAtInterface": false,
     "variantEntries": []
    },
    {
     "accession": "Other",
     "name": "Other",
     "residues": [
      6,
      8,
      9,
      10,
      16,
      18,
      109,
      110,
      112,
      114,
      115,
      149,
      151,
      152,
      153,
      154
     ],
     "support": [
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
      1
     ],
     "pdbEntries": [
      "23wu"
     ],
     "homomeric": false,
     "artefact": "chain with no UniProt record",
     "context": "native",
     "gene": null,
     "organism": null,
     "variantAtInterface": false,
     "variantEntries": []
    },
    {
     "accession": "Other",
     "name": "Other",
     "residues": [
      10
     ],
     "support": [
      1
     ],
     "pdbEntries": [
      "9jbp"
     ],
     "homomeric": false,
     "artefact": "chain with no UniProt record",
     "context": "fibril",
     "gene": null,
     "organism": null,
     "variantAtInterface": false,
     "variantEntries": []
    }
   ],
   "entryKinds": "ok",
   "crystalChecked": true
  },
  "oligomericState": "Homodimer",
  "chainCount": 2,
  "chainIds": [
   "A",
   "B"
  ],
  "chains": [
   {
    "accession": "P00441",
    "gene": "SOD1",
    "length": 154,
    "carriesVariant": true,
    "id": "A"
   },
   {
    "accession": "P00441",
    "gene": "SOD1",
    "length": 154,
    "carriesVariant": false,
    "id": "B"
   }
  ],
  "provenance": "Boltz-2 via JapanFold",
  "status": "not-requested"
 },
 "ppi": {
  "status": "success",
  "gene": "SOD1",
  "variant": "p.Ala5Val",
  "uniprotId": "P00441",
  "position": 5,
  "stringPartners": [
   {
    "partner": "CCS",
    "score": 0.999
   },
   {
    "partner": "SOD2",
    "score": 0.998
   },
   {
    "partner": "PARK7",
    "score": 0.996
   },
   {
    "partner": "CAT",
    "score": 0.985
   },
   {
    "partner": "BCL2",
    "score": 0.98
   }
  ],
  "string": {
   "physical": [
    {
     "partner": "CCS",
     "score": 0.999
    },
    {
     "partner": "BCL2",
     "score": 0.962
    },
    {
     "partner": "SOD2",
     "score": 0.957
    },
    {
     "partner": "HSPA4",
     "score": 0.939
    },
    {
     "partner": "RNF19A",
     "score": 0.932
    },
    {
     "partner": "PARK7",
     "score": 0.922
    },
    {
     "partner": "PRDX5",
     "score": 0.859
    },
    {
     "partner": "STUB1",
     "score": 0.802
    },
    {
     "partner": "COMMD1",
     "score": 0.802
    },
    {
     "partner": "OPTN",
     "score": 0.802
    },
    {
     "partner": "HSPA8",
     "score": 0.788
    },
    {
     "partner": "YWHAE",
     "score": 0.765
    },
    {
     "partner": "ENO1",
     "score": 0.758
    },
    {
     "partner": "TPI1",
     "score": 0.692
    },
    {
     "partner": "PRDX1",
     "score": 0.631
    },
    {
     "partner": "NME2",
     "score": 0.619
    },
    {
     "partner": "PPIA",
     "score": 0.616
    },
    {
     "partner": "NME1",
     "score": 0.605
    },
    {
     "partner": "EDRF1",
     "score": 0.596
    },
    {
     "partner": "SQSTM1",
     "score": 0.594
    },
    {
     "partner": "PRDX2",
     "score": 0.587
    },
    {
     "partner": "SNCA",
     "score": 0.587
    },
    {
     "partner": "MDH2",
     "score": 0.578
    },
    {
     "partner": "ALDOA",
     "score": 0.57
    },
    {
     "partner": "DDX39B",
     "score": 0.569
    },
    {
     "partner": "KARS1",
     "score": 0.567
    },
    {
     "partner": "PITRM1",
     "score": 0.565
    },
    {
     "partner": "BAG3",
     "score": 0.564
    },
    {
     "partner": "ANXA5",
     "score": 0.561
    },
    {
     "partner": "GAPDH",
     "score": 0.561
    },
    {
     "partner": "MIF",
     "score": 0.56
    },
    {
     "partner": "DERL1",
     "score": 0.56
    },
    {
     "partner": "PDIA3",
     "score": 0.557
    },
    {
     "partner": "VDAC1",
     "score": 0.557
    },
    {
     "partner": "PGAM1",
     "score": 0.556
    },
    {
     "partner": "PEBP1",
     "score": 0.554
    },
    {
     "partner": "GIMAP6",
     "score": 0.516
    },
    {
     "partner": "IQSEC1",
     "score": 0.516
    },
    {
     "partner": "UBE2M",
     "score": 0.514
    },
    {
     "partner": "TKT",
     "score": 0.493
    },
    {
     "partner": "HECW1",
     "score": 0.492
    },
    {
     "partner": "ERN1",
     "score": 0.487
    },
    {
     "partner": "EIF2AK3",
     "score": 0.476
    },
    {
     "partner": "DIP2A",
     "score": 0.476
    },
    {
     "partner": "HSPE1",
     "score": 0.467
    },
    {
     "partner": "TARDBP",
     "score": 0.457
    },
    {
     "partner": "PLEKHA4",
     "score": 0.457
    },
    {
     "partner": "CDC123",
     "score": 0.457
    },
    {
     "partner": "AMFR",
     "score": 0.457
    },
    {
     "partner": "SSR4",
     "score": 0.457
    },
    {
     "partner": "TP53INP1",
     "score": 0.457
    },
    {
     "partner": "UBE2H",
     "score": 0.457
    },
    {
     "partner": "DCAF4",
     "score": 0.457
    },
    {
     "partner": "MARCHF5",
     "score": 0.457
    },
    {
     "partner": "ZRANB1",
     "score": 0.457
    },
    {
     "partner": "PJA1",
     "score": 0.457
    },
    {
     "partner": "TRIM67",
     "score": 0.457
    },
    {
     "partner": "PSMD4",
     "score": 0.457
    },
    {
     "partner": "HDAC6",
     "score": 0.457
    },
    {
     "partner": "ZC3H18",
     "score": 0.457
    },
    {
     "partner": "BAP1",
     "score": 0.457
    },
    {
     "partner": "USP26",
     "score": 0.457
    },
    {
     "partner": "RNF4",
     "score": 0.457
    },
    {
     "partner": "LGALS8",
     "score": 0.457
    },
    {
     "partner": "UBC",
     "score": 0.457
    },
    {
     "partner": "CDK4",
     "score": 0.456
    },
    {
     "partner": "TMEM192",
     "score": 0.456
    },
    {
     "partner": "LAMP1",
     "score": 0.456
    },
    {
     "partner": "HSPD1",
     "score": 0.456
    },
    {
     "partner": "MAPT",
     "score": 0.456
    },
    {
     "partner": "RAC1",
     "score": 0.456
    },
    {
     "partner": "DYNLT1",
     "score": 0.456
    },
    {
     "partner": "NOXO1",
     "score": 0.456
    },
    {
     "partner": "CRYAB",
     "score": 0.456
    },
    {
     "partner": "DYNC2LI1",
     "score": 0.456
    },
    {
     "partner": "UBE3A",
     "score": 0.456
    },
    {
     "partner": "PGM1",
     "score": 0.426
    },
    {
     "partner": "EGFR",
     "score": 0.414
    },
    {
     "partner": "APOL2",
     "score": 0.388
    },
    {
     "partner": "CENPV",
     "score": 0.388
    },
    {
     "partner": "STXBP2",
     "score": 0.385
    },
    {
     "partner": "ACOT13",
     "score": 0.38
    },
    {
     "partner": "OPA3",
     "score": 0.373
    },
    {
     "partner": "TXN2",
     "score": 0.363
    },
    {
     "partner": "HIBADH",
     "score": 0.363
    },
    {
     "partner": "FABP3",
     "score": 0.363
    },
    {
     "partner": "ACY1",
     "score": 0.363
    },
    {
     "partner": "PHKA1",
     "score": 0.349
    },
    {
     "partner": "SUMO2",
     "score": 0.349
    },
    {
     "partner": "RGN",
     "score": 0.346
    },
    {
     "partner": "CBFB",
     "score": 0.346
    },
    {
     "partner": "TIAL1",
     "score": 0.331
    },
    {
     "partner": "PGK1",
     "score": 0.329
    },
    {
     "partner": "SET",
     "score": 0.327
    },
    {
     "partner": "SPTBN1",
     "score": 0.322
    },
    {
     "partner": "PPP2CA",
     "score": 0.32
    },
    {
     "partner": "NEDD4",
     "score": 0.313
    },
    {
     "partner": "HSP90B1",
     "score": 0.312
    },
    {
     "partner": "CKB",
     "score": 0.311
    },
    {
     "partner": "PTEN",
     "score": 0.298
    },
    {
     "partner": "PTPN11",
     "score": 0.298
    },
    {
     "partner": "PLS3",
     "score": 0.296
    },
    {
     "partner": "GSTZ1",
     "score": 0.295
    },
    {
     "partner": "TXNDC2",
     "score": 0.293
    },
    {
     "partner": "TOP1",
     "score": 0.293
    },
    {
     "partner": "BASP1",
     "score": 0.292
    },
    {
     "partner": "PTMS",
     "score": 0.292
    },
    {
     "partner": "STMN1",
     "score": 0.292
    },
    {
     "partner": "PDIA4",
     "score": 0.292
    },
    {
     "partner": "POLR2C",
     "score": 0.29
    },
    {
     "partner": "TKTL2",
     "score": 0.275
    },
    {
     "partner": "BCL2L13",
     "score": 0.274
    },
    {
     "partner": "PFN1",
     "score": 0.273
    },
    {
     "partner": "MLLT10",
     "score": 0.268
    },
    {
     "partner": "TRIM24",
     "score": 0.268
    },
    {
     "partner": "AHCYL1",
     "score": 0.262
    },
    {
     "partner": "ATP5IF1",
     "score": 0.258
    },
    {
     "partner": "ANP32B",
     "score": 0.257
    },
    {
     "partner": "HMGN1",
     "score": 0.257
    },
    {
     "partner": "PTMA",
     "score": 0.252
    },
    {
     "partner": "DSTN",
     "score": 0.251
    },
    {
     "partner": "ANP32A",
     "score": 0.25
    },
    {
     "partner": "LDHAL6A",
     "score": 0.246
    },
    {
     "partner": "TPM3",
     "score": 0.244
    },
    {
     "partner": "COLEC10",
     "score": 0.243
    },
    {
     "partner": "CEP78",
     "score": 0.243
    },
    {
     "partner": "PCMT1",
     "score": 0.24
    },
    {
     "partner": "AK2",
     "score": 0.239
    },
    {
     "partner": "PRR12",
     "score": 0.236
    },
    {
     "partner": "PDCD6IP",
     "score": 0.235
    },
    {
     "partner": "TRIM33",
     "score": 0.234
    },
    {
     "partner": "ATOX1",
     "score": 0.231
    },
    {
     "partner": "MAVS",
     "score": 0.227
    },
    {
     "partner": "PHF21A",
     "score": 0.226
    },
    {
     "partner": "PITPNB",
     "score": 0.226
    },
    {
     "partner": "PPIB",
     "score": 0.225
    },
    {
     "partner": "CALR",
     "score": 0.225
    },
    {
     "partner": "RPRD1B",
     "score": 0.225
    },
    {
     "partner": "MARCKS",
     "score": 0.225
    },
    {
     "partner": "CALM1",
     "score": 0.225
    },
    {
     "partner": "LDHAL6B",
     "score": 0.222
    },
    {
     "partner": "PRCC",
     "score": 0.22
    },
    {
     "partner": "NAA40",
     "score": 0.219
    },
    {
     "partner": "EWSR1",
     "score": 0.219
    },
    {
     "partner": "HEXB",
     "score": 0.218
    },
    {
     "partner": "TRAP1",
     "score": 0.215
    },
    {
     "partner": "SYNE2",
     "score": 0.214
    },
    {
     "partner": "NBR1",
     "score": 0.206
    },
    {
     "partner": "CEP55",
     "score": 0.206
    },
    {
     "partner": "HIVEP1",
     "score": 0.206
    },
    {
     "partner": "LAMP2",
     "score": 0.206
    },
    {
     "partner": "DCTN2",
     "score": 0.206
    },
    {
     "partner": "UFM1",
     "score": 0.202
    },
    {
     "partner": "FKBP1A",
     "score": 0.201
    },
    {
     "partner": "FABP5",
     "score": 0.199
    },
    {
     "partner": "GLOD4",
     "score": 0.199
    },
    {
     "partner": "CAT",
     "score": 0.198
    },
    {
     "partner": "C11ORF54",
     "score": 0.198
    },
    {
     "partner": "ASCC1",
     "score": 0.198
    },
    {
     "partner": "NUTF2",
     "score": 0.195
    },
    {
     "partner": "HIBCH",
     "score": 0.195
    },
    {
     "partner": "AKR1A1",
     "score": 0.195
    },
    {
     "partner": "RAE1",
     "score": 0.194
    },
    {
     "partner": "LGALS1",
     "score": 0.193
    },
    {
     "partner": "PIN1",
     "score": 0.193
    },
    {
     "partner": "SORD",
     "score": 0.191
    },
    {
     "partner": "POFUT1",
     "score": 0.191
    },
    {
     "partner": "FKBP1B",
     "score": 0.191
    },
    {
     "partner": "UFC1",
     "score": 0.19
    },
    {
     "partner": "OAT",
     "score": 0.19
    },
    {
     "partner": "GSTP1",
     "score": 0.19
    },
    {
     "partner": "UBE2L3",
     "score": 0.19
    },
    {
     "partner": "TANGO2",
     "score": 0.19
    },
    {
     "partner": "QDPR",
     "score": 0.186
    },
    {
     "partner": "PPIL3",
     "score": 0.186
    },
    {
     "partner": "PDXK",
     "score": 0.185
    },
    {
     "partner": "CFL2",
     "score": 0.185
    },
    {
     "partner": "MPI",
     "score": 0.185
    },
    {
     "partner": "LDHC",
     "score": 0.185
    },
    {
     "partner": "ADK",
     "score": 0.185
    },
    {
     "partner": "ADSL",
     "score": 0.185
    },
    {
     "partner": "LGALS3",
     "score": 0.183
    },
    {
     "partner": "PABPC3",
     "score": 0.183
    },
    {
     "partner": "UBE2V1",
     "score": 0.183
    },
    {
     "partner": "TMEM189-UBE2V1",
     "score": 0.183
    },
    {
     "partner": "FKBP7",
     "score": 0.183
    },
    {
     "partner": "OXCT1",
     "score": 0.182
    },
    {
     "partner": "COX17",
     "score": 0.182
    },
    {
     "partner": "GNPDA2",
     "score": 0.182
    },
    {
     "partner": "GLRX",
     "score": 0.182
    },
    {
     "partner": "PPIF",
     "score": 0.181
    },
    {
     "partner": "ALB",
     "score": 0.181
    },
    {
     "partner": "NFS1",
     "score": 0.181
    },
    {
     "partner": "LGMN",
     "score": 0.181
    },
    {
     "partner": "SRI",
     "score": 0.18
    },
    {
     "partner": "FABP7",
     "score": 0.18
    },
    {
     "partner": "AKR1B15",
     "score": 0.18
    },
    {
     "partner": "FUS",
     "score": 0.179
    },
    {
     "partner": "LACTB2",
     "score": 0.178
    },
    {
     "partner": "NUDC",
     "score": 0.178
    },
    {
     "partner": "SERPINB5",
     "score": 0.178
    },
    {
     "partner": "AKR1C2",
     "score": 0.177
    },
    {
     "partner": "PGM5",
     "score": 0.177
    },
    {
     "partner": "SCYL2",
     "score": 0.177
    },
    {
     "partner": "PMP2",
     "score": 0.175
    },
    {
     "partner": "DBI",
     "score": 0.175
    },
    {
     "partner": "EIF5A",
     "score": 0.172
    },
    {
     "partner": "FAAP20",
     "score": 0.172
    },
    {
     "partner": "TNIP2",
     "score": 0.166
    },
    {
     "partner": "USP9X",
     "score": 0.16
    },
    {
     "partner": "ACTB",
     "score": 0.16
    },
    {
     "partner": "TKTL1",
     "score": 0.153
    },
    {
     "partner": "DNM1L",
     "score": 0.153
    }
   ],
   "functional": [
    {
     "partner": "CCS",
     "score": 0.999
    },
    {
     "partner": "SOD2",
     "score": 0.998
    },
    {
     "partner": "PARK7",
     "score": 0.996
    },
    {
     "partner": "CAT",
     "score": 0.985
    },
    {
     "partner": "BCL2",
     "score": 0.98
    },
    {
     "partner": "VDAC1",
     "score": 0.978
    },
    {
     "partner": "SOD2-2",
     "score": 0.977
    },
    {
     "partner": "TARDBP",
     "score": 0.976
    },
    {
     "partner": "NEFL",
     "score": 0.976
    },
    {
     "partner": "HSPA4",
     "score": 0.973
    },
    {
     "partner": "DERL1",
     "score": 0.97
    },
    {
     "partner": "HSPA5",
     "score": 0.964
    },
    {
     "partner": "OPTN",
     "score": 0.962
    },
    {
     "partner": "PPARGC1A",
     "score": 0.955
    },
    {
     "partner": "RNF19A",
     "score": 0.954
    },
    {
     "partner": "PRDX5",
     "score": 0.953
    },
    {
     "partner": "PRDX1",
     "score": 0.945
    },
    {
     "partner": "DNAH8",
     "score": 0.94
    },
    {
     "partner": "PEBP1",
     "score": 0.934
    },
    {
     "partner": "FUS",
     "score": 0.931
    },
    {
     "partner": "COX17",
     "score": 0.929
    },
    {
     "partner": "TOMM40",
     "score": 0.922
    },
    {
     "partner": "PPP3R1",
     "score": 0.918
    },
    {
     "partner": "PPP3CA",
     "score": 0.918
    },
    {
     "partner": "HSPA8",
     "score": 0.916
    },
    {
     "partner": "PPP3CB",
     "score": 0.912
    },
    {
     "partner": "DNAH3",
     "score": 0.906
    },
    {
     "partner": "GAPDH",
     "score": 0.906
    },
    {
     "partner": "PPP3CC",
     "score": 0.905
    },
    {
     "partner": "ENSP00000478249",
     "score": 0.905
    },
    {
     "partner": "PRDX2",
     "score": 0.903
    },
    {
     "partner": "DNAH9",
     "score": 0.902
    },
    {
     "partner": "DNAH6",
     "score": 0.902
    },
    {
     "partner": "DNAH2",
     "score": 0.902
    },
    {
     "partner": "DNAH11",
     "score": 0.902
    },
    {
     "partner": "DNAL1",
     "score": 0.901
    },
    {
     "partner": "DNAL4",
     "score": 0.9
    },
    {
     "partner": "DNAH5",
     "score": 0.9
    },
    {
     "partner": "DNALI1",
     "score": 0.9
    },
    {
     "partner": "DNAH7",
     "score": 0.9
    },
    {
     "partner": "DNAH12",
     "score": 0.9
    },
    {
     "partner": "TOMM40L",
     "score": 0.9
    },
    {
     "partner": "DNAH17",
     "score": 0.9
    },
    {
     "partner": "DNAH14",
     "score": 0.9
    },
    {
     "partner": "DNAI2",
     "score": 0.9
    },
    {
     "partner": "DNAH1",
     "score": 0.9
    },
    {
     "partner": "DNAI1",
     "score": 0.9
    },
    {
     "partner": "DNAH10",
     "score": 0.9
    },
    {
     "partner": "PPP3R2",
     "score": 0.9
    },
    {
     "partner": "ATOX1",
     "score": 0.891
    },
    {
     "partner": "ENO1",
     "score": 0.89
    },
    {
     "partner": "TXN",
     "score": 0.886
    },
    {
     "partner": "C9ORF72",
     "score": 0.886
    },
    {
     "partner": "SNCA",
     "score": 0.885
    },
    {
     "partner": "TPI1",
     "score": 0.882
    },
    {
     "partner": "ALS2",
     "score": 0.874
    },
    {
     "partner": "GPX2",
     "score": 0.873
    },
    {
     "partner": "STUB1",
     "score": 0.871
    },
    {
     "partner": "GPX3",
     "score": 0.871
    },
    {
     "partner": "SQSTM1",
     "score": 0.869
    },
    {
     "partner": "ATXN2",
     "score": 0.869
    },
    {
     "partner": "COMMD1",
     "score": 0.867
    },
    {
     "partner": "GPX7",
     "score": 0.867
    },
    {
     "partner": "GPX8",
     "score": 0.867
    },
    {
     "partner": "GPX6",
     "score": 0.859
    },
    {
     "partner": "GPX5",
     "score": 0.859
    },
    {
     "partner": "PSMD4",
     "score": 0.857
    },
    {
     "partner": "DCTN1",
     "score": 0.848
    },
    {
     "partner": "SLC31A2",
     "score": 0.846
    },
    {
     "partner": "PSMB1",
     "score": 0.837
    },
    {
     "partner": "GPX4",
     "score": 0.836
    },
    {
     "partner": "MDH2",
     "score": 0.835
    },
    {
     "partner": "YWHAE",
     "score": 0.832
    },
    {
     "partner": "ANXA5",
     "score": 0.832
    },
    {
     "partner": "VAPB",
     "score": 0.831
    },
    {
     "partner": "ACO2",
     "score": 0.83
    },
    {
     "partner": "PPIA",
     "score": 0.82
    },
    {
     "partner": "NFE2L2",
     "score": 0.816
    },
    {
     "partner": "CYBB",
     "score": 0.806
    },
    {
     "partner": "MT1E",
     "score": 0.797
    },
    {
     "partner": "PSMA7",
     "score": 0.789
    },
    {
     "partner": "MAPT",
     "score": 0.787
    },
    {
     "partner": "PSMB6",
     "score": 0.783
    },
    {
     "partner": "MAP3K5",
     "score": 0.783
    },
    {
     "partner": "NEFH",
     "score": 0.779
    },
    {
     "partner": "PRDX3",
     "score": 0.777
    },
    {
     "partner": "HSPE1",
     "score": 0.774
    },
    {
     "partner": "PSMB4",
     "score": 0.771
    },
    {
     "partner": "PSMA1",
     "score": 0.767
    },
    {
     "partner": "HTT",
     "score": 0.765
    },
    {
     "partner": "SETX",
     "score": 0.762
    },
    {
     "partner": "PSMB3",
     "score": 0.759
    },
    {
     "partner": "PSMA2",
     "score": 0.757
    },
    {
     "partner": "PSMB5",
     "score": 0.756
    },
    {
     "partner": "PRDX6",
     "score": 0.755
    },
    {
     "partner": "DCTN2",
     "score": 0.755
    },
    {
     "partner": "STAT4",
     "score": 0.754
    },
    {
     "partner": "VCP",
     "score": 0.754
    },
    {
     "partner": "PSMD14",
     "score": 0.754
    },
    {
     "partner": "PSMA4",
     "score": 0.75
    },
    {
     "partner": "UBQLN2",
     "score": 0.75
    },
    {
     "partner": "PSMA5",
     "score": 0.749
    },
    {
     "partner": "HECW1",
     "score": 0.749
    },
    {
     "partner": "SKP1",
     "score": 0.747
    },
    {
     "partner": "PFN1",
     "score": 0.746
    },
    {
     "partner": "SSR4",
     "score": 0.741
    },
    {
     "partner": "PSMA3",
     "score": 0.739
    },
    {
     "partner": "PSMA6",
     "score": 0.736
    },
    {
     "partner": "GSR",
     "score": 0.734
    },
    {
     "partner": "ALDOA",
     "score": 0.734
    },
    {
     "partner": "PSMB2",
     "score": 0.731
    },
    {
     "partner": "PSMC4",
     "score": 0.73
    },
    {
     "partner": "PSMB7",
     "score": 0.73
    },
    {
     "partner": "NME2",
     "score": 0.73
    },
    {
     "partner": "HMOX1",
     "score": 0.729
    },
    {
     "partner": "PSMC2",
     "score": 0.729
    },
    {
     "partner": "TXN2",
     "score": 0.728
    },
    {
     "partner": "PSMD8",
     "score": 0.727
    },
    {
     "partner": "PSMC3",
     "score": 0.726
    },
    {
     "partner": "MIF",
     "score": 0.725
    },
    {
     "partner": "CRYAB",
     "score": 0.724
    },
    {
     "partner": "CHAT",
     "score": 0.723
    },
    {
     "partner": "TKT",
     "score": 0.723
    },
    {
     "partner": "PSMC5",
     "score": 0.721
    },
    {
     "partner": "PSMD7",
     "score": 0.719
    },
    {
     "partner": "NOX1",
     "score": 0.715
    },
    {
     "partner": "FIG4",
     "score": 0.714
    },
    {
     "partner": "PSMC1",
     "score": 0.714
    },
    {
     "partner": "ACE",
     "score": 0.714
    },
    {
     "partner": "BAG3",
     "score": 0.714
    },
    {
     "partner": "SUMO2",
     "score": 0.713
    },
    {
     "partner": "PSMD2",
     "score": 0.712
    },
    {
     "partner": "NME1",
     "score": 0.712
    },
    {
     "partner": "PSMD11",
     "score": 0.708
    },
    {
     "partner": "GFAP",
     "score": 0.707
    },
    {
     "partner": "SLC1A2",
     "score": 0.707
    },
    {
     "partner": "PDIA3",
     "score": 0.707
    },
    {
     "partner": "CYCS",
     "score": 0.707
    },
    {
     "partner": "GCLC",
     "score": 0.705
    },
    {
     "partner": "HSPD1",
     "score": 0.704
    },
    {
     "partner": "ADRM1",
     "score": 0.704
    },
    {
     "partner": "PGAM1",
     "score": 0.703
    },
    {
     "partner": "SMN1",
     "score": 0.695
    },
    {
     "partner": "PSMD3",
     "score": 0.694
    },
    {
     "partner": "SMN2",
     "score": 0.694
    },
    {
     "partner": "KEAP1",
     "score": 0.694
    },
    {
     "partner": "PSMD9",
     "score": 0.694
    },
    {
     "partner": "PSMD1",
     "score": 0.692
    },
    {
     "partner": "COX6C",
     "score": 0.689
    },
    {
     "partner": "ACTB",
     "score": 0.688
    },
    {
     "partner": "PSMC6",
     "score": 0.684
    },
    {
     "partner": "APOE",
     "score": 0.683
    },
    {
     "partner": "DCTN3",
     "score": 0.683
    },
    {
     "partner": "ACTR10",
     "score": 0.682
    },
    {
     "partner": "HAP1",
     "score": 0.682
    },
    {
     "partner": "PSMD12",
     "score": 0.682
    },
    {
     "partner": "GSTP1",
     "score": 0.682
    },
    {
     "partner": "PSMD6",
     "score": 0.682
    },
    {
     "partner": "TUBA4A",
     "score": 0.68
    },
    {
     "partner": "NDUFS5",
     "score": 0.68
    },
    {
     "partner": "APP",
     "score": 0.679
    },
    {
     "partner": "HINT1",
     "score": 0.676
    },
    {
     "partner": "PGM1",
     "score": 0.675
    },
    {
     "partner": "IL1B",
     "score": 0.672
    },
    {
     "partner": "PRDX4",
     "score": 0.67
    },
    {
     "partner": "PSMA8",
     "score": 0.668
    },
    {
     "partner": "NQO1",
     "score": 0.667
    },
    {
     "partner": "DCTN4",
     "score": 0.667
    },
    {
     "partner": "DCTN6",
     "score": 0.664
    },
    {
     "partner": "ACTR1B",
     "score": 0.663
    },
    {
     "partner": "DCTN5",
     "score": 0.662
    },
    {
     "partner": "PSMD13",
     "score": 0.662
    },
    {
     "partner": "ABCB7",
     "score": 0.661
    },
    {
     "partner": "EIF2AK3",
     "score": 0.661
    },
    {
     "partner": "ACTR1A",
     "score": 0.661
    },
    {
     "partner": "DBI",
     "score": 0.661
    },
    {
     "partner": "PINK1",
     "score": 0.656
    },
    {
     "partner": "ERN1",
     "score": 0.656
    },
    {
     "partner": "GCLM",
     "score": 0.655
    },
    {
     "partner": "ARHGEF28",
     "score": 0.654
    },
    {
     "partner": "KIFAP3",
     "score": 0.652
    },
    {
     "partner": "HDAC6",
     "score": 0.648
    },
    {
     "partner": "NOS1",
     "score": 0.647
    },
    {
     "partner": "SIRT1",
     "score": 0.645
    },
    {
     "partner": "HSP90AB1",
     "score": 0.644
    },
    {
     "partner": "HSPA9",
     "score": 0.643
    },
    {
     "partner": "COX4I1",
     "score": 0.643
    },
    {
     "partner": "CHCHD2",
     "score": 0.642
    },
    {
     "partner": "CALM2",
     "score": 0.64
    },
    {
     "partner": "CASP3",
     "score": 0.639
    },
    {
     "partner": "PITRM1",
     "score": 0.638
    },
    {
     "partner": "CDK5",
     "score": 0.638
    },
    {
     "partner": "PGK1",
     "score": 0.637
    },
    {
     "partner": "CD5",
     "score": 0.633
    },
    {
     "partner": "BDNF",
     "score": 0.632
    },
    {
     "partner": "UBC",
     "score": 0.631
    },
    {
     "partner": "HSP90AA1",
     "score": 0.629
    },
    {
     "partner": "ALB",
     "score": 0.627
    },
    {
     "partner": "CASP8",
     "score": 0.627
    },
    {
     "partner": "PXDN",
     "score": 0.623
    },
    {
     "partner": "STXBP2",
     "score": 0.622
    },
    {
     "partner": "PXDNL",
     "score": 0.618
    },
    {
     "partner": "TXNRD1",
     "score": 0.615
    },
    {
     "partner": "CHMP2B",
     "score": 0.613
    },
    {
     "partner": "TALDO1",
     "score": 0.611
    },
    {
     "partner": "DAXX",
     "score": 0.61
    },
    {
     "partner": "CALM3",
     "score": 0.61
    },
    {
     "partner": "SRP14",
     "score": 0.609
    },
    {
     "partner": "SND1",
     "score": 0.609
    },
    {
     "partner": "TOP1",
     "score": 0.609
    },
    {
     "partner": "XDH",
     "score": 0.609
    },
    {
     "partner": "LAMP1",
     "score": 0.607
    },
    {
     "partner": "ANG",
     "score": 0.604
    },
    {
     "partner": "GLRX",
     "score": 0.604
    },
    {
     "partner": "IL10",
     "score": 0.604
    },
    {
     "partner": "CHCHD10",
     "score": 0.602
    },
    {
     "partner": "ATP5PF",
     "score": 0.598
    },
    {
     "partner": "HNRNPA1",
     "score": 0.597
    },
    {
     "partner": "DDX39B",
     "score": 0.597
    },
    {
     "partner": "EDRF1",
     "score": 0.596
    },
    {
     "partner": "CHEK2",
     "score": 0.596
    },
    {
     "partner": "MARCHF5",
     "score": 0.595
    },
    {
     "partner": "PRKN",
     "score": 0.592
    },
    {
     "partner": "MFN2",
     "score": 0.59
    },
    {
     "partner": "FADD",
     "score": 0.589
    },
    {
     "partner": "KARS1",
     "score": 0.589
    },
    {
     "partner": "TBK1",
     "score": 0.588
    },
    {
     "partner": "MATR3-2",
     "score": 0.588
    },
    {
     "partner": "MATR3",
     "score": 0.588
    },
    {
     "partner": "SAP18",
     "score": 0.588
    },
    {
     "partner": "PRNP",
     "score": 0.586
    },
    {
     "partner": "UBB",
     "score": 0.586
    },
    {
     "partner": "NOX4",
     "score": 0.584
    },
    {
     "partner": "UQCRFS1",
     "score": 0.584
    },
    {
     "partner": "RAC1",
     "score": 0.581
    },
    {
     "partner": "BAX",
     "score": 0.58
    },
    {
     "partner": "COX5B",
     "score": 0.579
    },
    {
     "partner": "NEK1",
     "score": 0.579
    },
    {
     "partner": "SPG11",
     "score": 0.577
    },
    {
     "partner": "AMFR",
     "score": 0.577
    },
    {
     "partner": "EGFR",
     "score": 0.575
    },
    {
     "partner": "UBE3A",
     "score": 0.573
    },
    {
     "partner": "CDK4",
     "score": 0.572
    },
    {
     "partner": "IL6",
     "score": 0.571
    },
    {
     "partner": "TNF",
     "score": 0.57
    },
    {
     "partner": "UBE2M",
     "score": 0.569
    },
    {
     "partner": "SIGMAR1",
     "score": 0.567
    },
    {
     "partner": "ATP5PD",
     "score": 0.567
    },
    {
     "partner": "FIS1",
     "score": 0.566
    },
    {
     "partner": "PSEN1",
     "score": 0.564
    },
    {
     "partner": "AIF1",
     "score": 0.563
    },
    {
     "partner": "GSTK1",
     "score": 0.563
    },
    {
     "partner": "AKT1",
     "score": 0.563
    },
    {
     "partner": "HSP90B1",
     "score": 0.561
    },
    {
     "partner": "DYNLT1",
     "score": 0.56
    },
    {
     "partner": "COX6A1",
     "score": 0.559
    },
    {
     "partner": "INS",
     "score": 0.559
    },
    {
     "partner": "COX6B1",
     "score": 0.559
    },
    {
     "partner": "ARL6IP5",
     "score": 0.558
    },
    {
     "partner": "LDHA",
     "score": 0.552
    },
    {
     "partner": "ATP5IF1",
     "score": 0.549
    },
    {
     "partner": "EDF1",
     "score": 0.548
    },
    {
     "partner": "UBL5",
     "score": 0.548
    },
    {
     "partner": "ENO2",
     "score": 0.547
    },
    {
     "partner": "SCO1",
     "score": 0.545
    },
    {
     "partner": "GSTO1",
     "score": 0.544
    },
    {
     "partner": "SUMO1",
     "score": 0.543
    },
    {
     "partner": "COX11",
     "score": 0.541
    },
    {
     "partner": "NOXO1",
     "score": 0.538
    },
    {
     "partner": "MFN1",
     "score": 0.536
    },
    {
     "partner": "HNRNPA2B1",
     "score": 0.535
    },
    {
     "partner": "GART",
     "score": 0.535
    },
    {
     "partner": "TKTL2",
     "score": 0.534
    },
    {
     "partner": "TP53INP1",
     "score": 0.534
    },
    {
     "partner": "MTOR",
     "score": 0.534
    },
    {
     "partner": "LTN1",
     "score": 0.533
    },
    {
     "partner": "IQSEC1",
     "score": 0.527
    },
    {
     "partner": "COX7A2",
     "score": 0.526
    },
    {
     "partner": "NDUFB9",
     "score": 0.525
    },
    {
     "partner": "GABARAPL2",
     "score": 0.521
    },
    {
     "partner": "CKB",
     "score": 0.52
    },
    {
     "partner": "NDUFA1",
     "score": 0.52
    },
    {
     "partner": "GDNF",
     "score": 0.52
    },
    {
     "partner": "TTN",
     "score": 0.52
    },
    {
     "partner": "GIMAP6",
     "score": 0.52
    },
    {
     "partner": "PJA1",
     "score": 0.519
    },
    {
     "partner": "PTGS2",
     "score": 0.519
    },
    {
     "partner": "IFNG",
     "score": 0.518
    },
    {
     "partner": "CASP9",
     "score": 0.518
    },
    {
     "partner": "DNM1L",
     "score": 0.517
    },
    {
     "partner": "NDFIP1",
     "score": 0.516
    },
    {
     "partner": "NDFIP2",
     "score": 0.516
    },
    {
     "partner": "XBP1",
     "score": 0.514
    },
    {
     "partner": "PLB1",
     "score": 0.514
    },
    {
     "partner": "NDUFB8",
     "score": 0.511
    },
    {
     "partner": "SP1",
     "score": 0.511
    },
    {
     "partner": "STMN1",
     "score": 0.511
    },
    {
     "partner": "ATP5PO",
     "score": 0.509
    },
    {
     "partner": "RNF4",
     "score": 0.509
    },
    {
     "partner": "ATP2A2",
     "score": 0.509
    },
    {
     "partner": "ATP7A",
     "score": 0.508
    },
    {
     "partner": "NDUFB4",
     "score": 0.507
    },
    {
     "partner": "VCL",
     "score": 0.507
    },
    {
     "partner": "CHCHD4",
     "score": 0.507
    },
    {
     "partner": "DSTN",
     "score": 0.506
    },
    {
     "partner": "ERP29",
     "score": 0.505
    },
    {
     "partner": "COX7C",
     "score": 0.505
    },
    {
     "partner": "TP53",
     "score": 0.504
    },
    {
     "partner": "PTEN",
     "score": 0.504
    },
    {
     "partner": "HMGB1",
     "score": 0.503
    },
    {
     "partner": "GUK1",
     "score": 0.502
    },
    {
     "partner": "SCO2",
     "score": 0.502
    },
    {
     "partner": "SLC1A1",
     "score": 0.501
    },
    {
     "partner": "NDUFA4",
     "score": 0.501
    },
    {
     "partner": "TAGLN2",
     "score": 0.501
    },
    {
     "partner": "SLC31A1",
     "score": 0.501
    },
    {
     "partner": "DYNLL1",
     "score": 0.501
    },
    {
     "partner": "LGALS8",
     "score": 0.501
    },
    {
     "partner": "TIAL1",
     "score": 0.5
    },
    {
     "partner": "FASLG",
     "score": 0.499
    },
    {
     "partner": "CFL1",
     "score": 0.499
    },
    {
     "partner": "MANF",
     "score": 0.499
    },
    {
     "partner": "HMGN1",
     "score": 0.498
    },
    {
     "partner": "UNC13A",
     "score": 0.498
    },
    {
     "partner": "PPARG",
     "score": 0.497
    },
    {
     "partner": "FTH1",
     "score": 0.495
    },
    {
     "partner": "GPD1",
     "score": 0.495
    },
    {
     "partner": "UBE2H",
     "score": 0.495
    },
    {
     "partner": "GRN",
     "score": 0.494
    },
    {
     "partner": "FABP5",
     "score": 0.494
    },
    {
     "partner": "LRRK2",
     "score": 0.494
    },
    {
     "partner": "DIP2A",
     "score": 0.494
    },
    {
     "partner": "KIF5A",
     "score": 0.494
    },
    {
     "partner": "BECN1",
     "score": 0.493
    },
    {
     "partner": "ATXN3",
     "score": 0.493
    },
    {
     "partner": "DYNC1H1",
     "score": 0.492
    },
    {
     "partner": "STIP1",
     "score": 0.491
    },
    {
     "partner": "GLRX2",
     "score": 0.491
    },
    {
     "partner": "UQCRQ",
     "score": 0.49
    },
    {
     "partner": "FABP3",
     "score": 0.488
    },
    {
     "partner": "ATP2A1",
     "score": 0.486
    },
    {
     "partner": "AASS",
     "score": 0.486
    },
    {
     "partner": "CDC123",
     "score": 0.484
    },
    {
     "partner": "IGF1",
     "score": 0.484
    },
    {
     "partner": "ATP7B",
     "score": 0.483
    },
    {
     "partner": "PEPD",
     "score": 0.483
    },
    {
     "partner": "TMEM192",
     "score": 0.481
    },
    {
     "partner": "FLNA",
     "score": 0.481
    },
    {
     "partner": "RRM1",
     "score": 0.48
    },
    {
     "partner": "CP",
     "score": 0.479
    },
    {
     "partner": "ZRANB1",
     "score": 0.479
    },
    {
     "partner": "ATG7",
     "score": 0.478
    },
    {
     "partner": "PPP2CA",
     "score": 0.478
    },
    {
     "partner": "NFKB1",
     "score": 0.477
    },
    {
     "partner": "APOB",
     "score": 0.477
    },
    {
     "partner": "LAMTOR5",
     "score": 0.477
    },
    {
     "partner": "ZC3H18",
     "score": 0.476
    },
    {
     "partner": "YIPF6",
     "score": 0.476
    },
    {
     "partner": "TGFB1",
     "score": 0.474
    },
    {
     "partner": "TIA1",
     "score": 0.474
    },
    {
     "partner": "TBCA",
     "score": 0.473
    },
    {
     "partner": "NDUFA6",
     "score": 0.473
    },
    {
     "partner": "PDIA4",
     "score": 0.473
    },
    {
     "partner": "ATP5F1C",
     "score": 0.472
    },
    {
     "partner": "HSPA1B",
     "score": 0.472
    },
    {
     "partner": "YWHAQ",
     "score": 0.471
    },
    {
     "partner": "ISCU",
     "score": 0.47
    },
    {
     "partner": "RGN",
     "score": 0.47
    },
    {
     "partner": "HSPB1",
     "score": 0.469
    },
    {
     "partner": "TXNDC2",
     "score": 0.469
    },
    {
     "partner": "NGF",
     "score": 0.469
    },
    {
     "partner": "TFAM",
     "score": 0.468
    },
    {
     "partner": "TXNL1",
     "score": 0.467
    },
    {
     "partner": "SLC25A3",
     "score": 0.467
    },
    {
     "partner": "GRIA2",
     "score": 0.467
    },
    {
     "partner": "CENPV",
     "score": 0.467
    },
    {
     "partner": "ATP5F1A",
     "score": 0.467
    },
    {
     "partner": "PPIF",
     "score": 0.466
    },
    {
     "partner": "NDUFB10",
     "score": 0.465
    },
    {
     "partner": "PPARD",
     "score": 0.465
    },
    {
     "partner": "CALR",
     "score": 0.465
    },
    {
     "partner": "TARS1",
     "score": 0.464
    },
    {
     "partner": "RBM8A",
     "score": 0.464
    },
    {
     "partner": "UCHL1",
     "score": 0.463
    },
    {
     "partner": "GSK3B",
     "score": 0.463
    },
    {
     "partner": "UQCRB",
     "score": 0.463
    },
    {
     "partner": "TBP",
     "score": 0.462
    },
    {
     "partner": "KLF4",
     "score": 0.462
    },
    {
     "partner": "DNAJB1",
     "score": 0.461
    },
    {
     "partner": "HSPB8",
     "score": 0.461
    },
    {
     "partner": "HIF1A",
     "score": 0.461
    },
    {
     "partner": "PGM2",
     "score": 0.46
    },
    {
     "partner": "ATP5F1B",
     "score": 0.459
    },
    {
     "partner": "MAP1LC3B",
     "score": 0.459
    },
    {
     "partner": "MAPK3",
     "score": 0.458
    },
    {
     "partner": "AKR1A1",
     "score": 0.458
    },
    {
     "partner": "PLEKHA4",
     "score": 0.457
    },
    {
     "partner": "DCAF4",
     "score": 0.457
    },
    {
     "partner": "TRIM67",
     "score": 0.457
    },
    {
     "partner": "BAP1",
     "score": 0.457
    },
    {
     "partner": "USP26",
     "score": 0.457
    },
    {
     "partner": "GSTZ1",
     "score": 0.457
    },
    {
     "partner": "LGALS3",
     "score": 0.456
    },
    {
     "partner": "ATXN3L",
     "score": 0.456
    },
    {
     "partner": "DYNC2LI1",
     "score": 0.456
    },
    {
     "partner": "CIRBP",
     "score": 0.455
    },
    {
     "partner": "OPA1",
     "score": 0.454
    },
    {
     "partner": "FGGY",
     "score": 0.454
    },
    {
     "partner": "RAD51",
     "score": 0.454
    },
    {
     "partner": "RPL13",
     "score": 0.453
    },
    {
     "partner": "PLEK",
     "score": 0.452
    },
    {
     "partner": "PPARA",
     "score": 0.452
    },
    {
     "partner": "EWSR1",
     "score": 0.452
    },
    {
     "partner": "RPL37",
     "score": 0.451
    },
    {
     "partner": "PPIB",
     "score": 0.451
    },
    {
     "partner": "SNRPD2",
     "score": 0.451
    },
    {
     "partner": "ARG1",
     "score": 0.451
    },
    {
     "partner": "MT-CYB",
     "score": 0.45
    },
    {
     "partner": "PKM",
     "score": 0.449
    },
    {
     "partner": "BACE1",
     "score": 0.448
    },
    {
     "partner": "PSEN2",
     "score": 0.448
    },
    {
     "partner": "JUN",
     "score": 0.447
    },
    {
     "partner": "RBX1",
     "score": 0.446
    },
    {
     "partner": "FOXO3",
     "score": 0.445
    },
    {
     "partner": "SIRT3",
     "score": 0.445
    },
    {
     "partner": "TARS2",
     "score": 0.444
    },
    {
     "partner": "CALM1",
     "score": 0.444
    },
    {
     "partner": "NDUFAB1",
     "score": 0.443
    },
    {
     "partner": "EGR1",
     "score": 0.442
    },
    {
     "partner": "ECHS1",
     "score": 0.442
    },
    {
     "partner": "TLR4",
     "score": 0.442
    },
    {
     "partner": "TRMT112",
     "score": 0.442
    },
    {
     "partner": "MT-CO2",
     "score": 0.441
    },
    {
     "partner": "VSX1",
     "score": 0.441
    },
    {
     "partner": "CFAP410",
     "score": 0.441
    },
    {
     "partner": "RBFOX3",
     "score": 0.441
    },
    {
     "partner": "UCP2",
     "score": 0.441
    },
    {
     "partner": "TLN1",
     "score": 0.44
    },
    {
     "partner": "HADHB",
     "score": 0.44
    },
    {
     "partner": "AKR1B1",
     "score": 0.439
    },
    {
     "partner": "ATG5",
     "score": 0.439
    },
    {
     "partner": "CYBA",
     "score": 0.438
    },
    {
     "partner": "IDH1",
     "score": 0.438
    },
    {
     "partner": "NDUFB2",
     "score": 0.438
    },
    {
     "partner": "PIK3CG",
     "score": 0.438
    },
    {
     "partner": "NFE2",
     "score": 0.437
    },
    {
     "partner": "DUOX1",
     "score": 0.436
    },
    {
     "partner": "TOMM20",
     "score": 0.436
    },
    {
     "partner": "PIK3CB",
     "score": 0.436
    },
    {
     "partner": "CCL2",
     "score": 0.435
    },
    {
     "partner": "PIK3CD",
     "score": 0.435
    },
    {
     "partner": "NOS3",
     "score": 0.434
    },
    {
     "partner": "ACO1",
     "score": 0.434
    },
    {
     "partner": "MGST3",
     "score": 0.434
    },
    {
     "partner": "ACOT13",
     "score": 0.433
    },
    {
     "partner": "RPS27A",
     "score": 0.433
    },
    {
     "partner": "CCNF",
     "score": 0.433
    },
    {
     "partner": "PPP1R15A",
     "score": 0.432
    },
    {
     "partner": "NOS2",
     "score": 0.432
    },
    {
     "partner": "MT-CO1",
     "score": 0.432
    },
    {
     "partner": "VDAC2",
     "score": 0.432
    },
    {
     "partner": "GLO1",
     "score": 0.432
    },
    {
     "partner": "TARS3",
     "score": 0.431
    },
    {
     "partner": "PIK3CA",
     "score": 0.43
    },
    {
     "partner": "SUMO3",
     "score": 0.43
    },
    {
     "partner": "SRXN1",
     "score": 0.429
    },
    {
     "partner": "PSORS1C1",
     "score": 0.428
    },
    {
     "partner": "PIK3C3",
     "score": 0.428
    },
    {
     "partner": "FTL",
     "score": 0.428
    },
    {
     "partner": "COX8A",
     "score": 0.427
    },
    {
     "partner": "IDH2",
     "score": 0.427
    },
    {
     "partner": "RPL8",
     "score": 0.426
    },
    {
     "partner": "IL1A",
     "score": 0.425
    },
    {
     "partner": "COX5A",
     "score": 0.425
    },
    {
     "partner": "MAP3K7",
     "score": 0.425
    },
    {
     "partner": "TXNRD2",
     "score": 0.425
    },
    {
     "partner": "CASP1",
     "score": 0.425
    },
    {
     "partner": "ENDOD1",
     "score": 0.424
    },
    {
     "partner": "BCL2L1",
     "score": 0.423
    },
    {
     "partner": "PCNA",
     "score": 0.423
    },
    {
     "partner": "UCP3",
     "score": 0.422
    },
    {
     "partner": "MMP9",
     "score": 0.422
    },
    {
     "partner": "TREM2",
     "score": 0.422
    },
    {
     "partner": "AK3",
     "score": 0.422
    },
    {
     "partner": "GATM",
     "score": 0.422
    },
    {
     "partner": "WDR1",
     "score": 0.421
    },
    {
     "partner": "GLOD4",
     "score": 0.419
    },
    {
     "partner": "ATP2A3",
     "score": 0.419
    },
    {
     "partner": "ATP2C2",
     "score": 0.419
    },
    {
     "partner": "ATP2C1",
     "score": 0.419
    },
    {
     "partner": "ATF6",
     "score": 0.418
    },
    {
     "partner": "AK2",
     "score": 0.418
    },
    {
     "partner": "NDUFB6",
     "score": 0.417
    },
    {
     "partner": "HIBADH",
     "score": 0.416
    },
    {
     "partner": "PTMA",
     "score": 0.416
    },
    {
     "partner": "HABP4",
     "score": 0.416
    },
    {
     "partner": "RPL6",
     "score": 0.416
    },
    {
     "partner": "RPL12",
     "score": 0.415
    },
    {
     "partner": "TKTL1",
     "score": 0.415
    },
    {
     "partner": "H3-3B",
     "score": 0.414
    }
   ],
   "limit": 500,
   "minScore": 0.15
  },
  "stringVersion": "12.5",
  "subunitComment": "Homodimer; non-disulfide-linked (By similarity). Homodimerization may take place via the ditryptophan cross-link at Trp-33. Heterodimer with CCS (PubMed:31292775). The heterodimer CCS:SOD1 interacts with SLC31A1; this heterotrimer is Cu(1+)-mediated and its maintenance is regulated through SOD1 activation (PubMed:31292775). Interacts with DAOA; the interaction is direct (PubMed:30037290)",
  "curatedInteractions": [
   {
    "accession": "P13928",
    "gene": "ANXA8",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "P63010-2",
    "gene": "AP2B1",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "Q0P5N6",
    "gene": "ARL16",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "Q16611",
    "gene": "BAK1",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "P10415",
    "gene": "BCL2",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "Q9BXK5",
    "gene": "BCL2L13",
    "experiments": 2,
    "evidence": {
     "methods": [
      "anti tag coimmunoprecipitation"
     ],
     "pubmed": [
      "28514442",
      "33961781"
     ],
     "twoHybridOnly": false
    }
   },
   {
    "accession": "Q5SZD1",
    "gene": "C6orf141",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "P02748",
    "gene": "C9",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "Q8N5S9-2",
    "gene": "CAMKK1",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "Q13191",
    "gene": "CBLB",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "O14618",
    "gene": "CCS",
    "experiments": 7,
    "evidence": {
     "methods": [
      "anti tag coimmunoprecipitation",
      "pull down"
     ],
     "pubmed": [
      "12968035",
      "22508683",
      "28514442",
      "33961781"
     ],
     "twoHybridOnly": false
    }
   },
   {
    "accession": "P53672",
    "gene": "CRYBA2",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "P48730-2",
    "gene": "CSNK1D",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "P98082",
    "gene": "DAB2",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "Q8TCX1",
    "gene": "DYNC2LI1",
    "experiments": 3,
    "evidence": null
   },
   {
    "accession": "P29692",
    "gene": "EEF1D",
    "experiments": 3,
    "evidence": {
     "methods": [
      "cross-linking study",
      "display technology"
     ],
     "pubmed": [
      "20195357",
      "29128334"
     ],
     "twoHybridOnly": false
    }
   },
   {
    "accession": "Q8TC29",
    "gene": "ENKUR",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "P02671-2",
    "gene": "FGA",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "Q8WW76",
    "gene": "FGA",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "F2Z2M7",
    "gene": "GALNT10",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "P04406",
    "gene": "GAPDH",
    "experiments": 3,
    "evidence": {
     "methods": [
      "anti bait coimmunoprecipitation"
     ],
     "pubmed": [
      "29128334"
     ],
     "twoHybridOnly": false
    }
   },
   {
    "accession": "P62879",
    "gene": "GNB2",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "Q9Y4H4",
    "gene": "GPSM3",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "Q8WVV9-3",
    "gene": "HNRNPLL",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "P09017",
    "gene": "HOXC4",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "P80217-2",
    "gene": "IFI35",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "Q6DN90-2",
    "gene": "IQSEC1",
    "experiments": 3,
    "evidence": {
     "methods": [
      "bioluminescence resonance energy transfer",
      "luminescence based mammalian interactome mapping",
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": false
    }
   },
   {
    "accession": "O14713",
    "gene": "ITGB1BP1",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "Q15046",
    "gene": "KARS1",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "Q9NVX7-2",
    "gene": "KBTBD4",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "Q8N4N3-2",
    "gene": "KLHL36",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "Q96JM7-2",
    "gene": "L3MBTL3",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "Q9BYZ2",
    "gene": "LDHAL6B",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "Q8N448",
    "gene": "LNX2",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "O95777",
    "gene": "LSM8",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "Q8TDB4",
    "gene": "MGARP",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "A4FUJ8",
    "gene": "MKL1",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "Q8N594",
    "gene": "MPND",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "Q96FW1",
    "gene": "OTUB1",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "Q6GQQ9-2",
    "gene": "OTUD7B",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "Q9BYU1",
    "gene": "PBX4",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "Q13113",
    "gene": "PDZK1IP1",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "Q08209-2",
    "gene": "PPP3CA",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "P30044",
    "gene": "PRDX5",
    "experiments": 10,
    "evidence": {
     "methods": [
      "anti bait coimmunoprecipitation",
      "anti tag coimmunoprecipitation",
      "cross-linking study"
     ],
     "pubmed": [
      "29128334"
     ],
     "twoHybridOnly": false
    }
   },
   {
    "accession": "P28062-2",
    "gene": "PSMB8",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "P62191",
    "gene": "PSMC1",
    "experiments": 5,
    "evidence": {
     "methods": [
      "cross-linking study",
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "29128334",
      "32814053"
     ],
     "twoHybridOnly": false
    }
   },
   {
    "accession": "P17980",
    "gene": "PSMC3",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "P43686-2",
    "gene": "PSMC4",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "Q09028",
    "gene": "RBBP4",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "Q6ZNA4-2",
    "gene": "RNF111",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "Q9ULX5",
    "gene": "RNF112",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "Q9NV58",
    "gene": "RNF19A",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "Q9BUL9",
    "gene": "RPP25",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "P08865",
    "gene": "RPSA",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "Q8N488",
    "gene": "RYBP",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "P60896",
    "gene": "SEM1",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "Q15393",
    "gene": "SF3B3",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "Q2NKQ1-4",
    "gene": "SGSM1",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "Q9GZS3",
    "gene": "SKIC8",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "P37840",
    "gene": "SNCA",
    "experiments": 9,
    "evidence": null
   },
   {
    "accession": "Q3SY56",
    "gene": "SP6",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "Q8NHS9",
    "gene": "SPATA22",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "Q96MF2",
    "gene": "STAC3",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "Q92797-2",
    "gene": "SYMPK",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "Q9BZK7",
    "gene": "TBL1XR1",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "Q15554-4",
    "gene": "TERF2",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "Q9H3N1",
    "gene": "TMX1",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "Q13829",
    "gene": "TNFAIP1",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "P07951-2",
    "gene": "TPM2",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "P07437",
    "gene": "TUBB",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "P0CG47",
    "gene": "UBB",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "O75604-3",
    "gene": "USP2",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "Q96NC0",
    "gene": "ZMAT2",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "O95789-4",
    "gene": "ZMYM6",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "Q8NBB4-2",
    "gene": "ZSCAN1",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "Q2QGD7",
    "gene": "ZXDC",
    "experiments": 3,
    "evidence": {
     "methods": [
      "two hybrid array",
      "two hybrid pooling approach",
      "validated two hybrid"
     ],
     "pubmed": [
      "32814053"
     ],
     "twoHybridOnly": true
    }
   },
   {
    "accession": "P26339",
    "gene": "Chga",
    "experiments": 5,
    "evidence": {
     "methods": [
      "anti bait coimmunoprecipitation",
      "anti tag coimmunoprecipitation",
      "cosedimentation through density gradient",
      "electron microscopy",
      "fluorescence microscopy"
     ],
     "pubmed": [
      "16369483"
     ],
     "twoHybridOnly": false,
     "organism": "mouse"
    },
    "organismDiffer": true
   },
   {
    "accession": "P16014",
    "gene": "Chgb",
    "experiments": 6,
    "evidence": {
     "methods": [
      "anti bait coimmunoprecipitation",
      "anti tag coimmunoprecipitation",
      "fluorescence microscopy",
      "two hybrid"
     ],
     "pubmed": [
      "16369483"
     ],
     "twoHybridOnly": false,
     "organism": "mouse"
    },
    "organismDiffer": true
   },
   {
    "accession": "P01041",
    "gene": "Cstb",
    "experiments": 3,
    "evidence": null,
    "organismDiffer": true
   },
   {
    "accession": "P20029",
    "gene": "Hspa5",
    "experiments": 7,
    "evidence": null,
    "organismDiffer": true
   }
  ],
  "interactionSites": [],
  "sequenceLength": 154,
  "lookups": {
   "stringPartners": "ok",
   "stringPhysical": "ok",
   "intact": "ok",
   "uniprot": "ok"
  }
 }
};
