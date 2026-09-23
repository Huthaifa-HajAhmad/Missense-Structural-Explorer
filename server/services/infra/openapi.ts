/**
 * openapi.ts — Dynamic OpenAPI 3.1.0 specification generator.
 */
export function generateOpenApiSpec() {
  return {
  "openapi": "3.1.0",
  "info": {
    "title": "Missense Structural Explorer API",
    "version": "1.0.0",
    "description": "High-performance clinical missense variant interpretation, structural biophysics modeling, and ACMG rule-based classification API.",
    "contact": {
      "name": "Missense Structural Explorer Development Team"
    },
    "license": {
      "name": "MIT"
    }
  },
  "servers": [
    {
      "url": "/api/v1",
      "description": "Standard API v1 prefix"
    }
  ],
  "tags": [
    {
      "name": "Variant Translation",
      "description": "HGVS, cDNA, and genomic notation normalization"
    },
    {
      "name": "Variant Analysis",
      "description": "Core multi-source variant interpretation and progressive streaming"
    },
    {
      "name": "Structural Biophysics",
      "description": "FoldX energetic Delta Delta G, pocket detection, and residue modeling"
    },
    {
      "name": "Sequence Alignment",
      "description": "Pairwise Needleman-Wunsch & Smith-Waterman alignment"
    },
    {
      "name": "Literature & Insights",
      "description": "PubMed LitRAG search and Gemini clinical narrative synthesis"
    },
    {
      "name": "System & Session",
      "description": "Session authentication, health checks, and engine diagnostics"
    }
  ],
  "paths": {
    "/translate-variant": {
      "post": {
        "tags": [
          "Variant Translation"
        ],
        "summary": "Translate variant notation to MANE canonical transcript and UniProt mapping",
        "operationId": "translateVariant",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "variant"
                ],
                "properties": {
                  "variant": {
                    "type": "string",
                    "example": "NP_001032248.1:p.Lys281Asn",
                    "description": "Genomic HGVS, dashed coordinates, transcript cDNA, or a protein substitution qualified by the protein its numbering belongs to (`NP_…`, `<UniProt accession>[-isoform]`). An accession-qualified notation is mapped onto CANONICAL UniProt numbering; an unverifiable basis is refused rather than assumed."
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Successfully normalized variant metadata",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "required": [
                    "gene",
                    "variant",
                    "uniprotId"
                  ],
                  "properties": {
                    "gene": {
                      "type": "string",
                      "example": "BRAF"
                    },
                    "variant": {
                      "type": "string",
                      "example": "p.Val600Glu"
                    },
                    "uniprotId": {
                      "type": "string",
                      "example": "P15056"
                    },
                    "transcriptId": {
                      "type": "string",
                      "example": "ENST00000646891.2"
                    },
                    "isManeSelect": {
                      "type": "boolean",
                      "example": true
                    },
                    "isCanonical": {
                      "type": "boolean",
                      "example": true,
                      "description": "Ensembl's canonical-TRANSCRIPT flag, not a statement about residue numbering — use `numberingBasis`/`numberingVerified` for that."
                    },
                    "uniprotIsoform": {
                      "type": "string",
                      "example": "Q9Y305-1",
                      "description": "UniProt isoform whose numbering `variant` uses."
                    },
                    "numberingBasis": {
                      "type": "string",
                      "enum": ["canonical", "remapped", "unverified"],
                      "description": "How the numbering was established. `unverified` is disclosed in `transcriptWarning` and is never cached."
                    },
                    "numberingVerified": {
                      "type": "boolean",
                      "description": "False only for `unverified`."
                    },
                    "numberingProteinId": {
                      "type": "string",
                      "example": "NP_001032248.1",
                      "description": "Protein accession the numbering follows when the provider named no UniProt isoform."
                    },
                    "numberingRemap": {
                      "type": "object",
                      "description": "Present when the input notation was renumbered onto the canonical isoform.",
                      "properties": {
                        "reason": { "type": "string" },
                        "from": {
                          "type": "object",
                          "properties": {
                            "hgvsp": { "type": "string" },
                            "transcriptId": { "type": "string" },
                            "isoform": { "type": "string" },
                            "maneRefSeqId": { "type": "string" },
                            "accession": { "type": "string", "example": "NP_001032248.1" }
                          }
                        },
                        "to": {
                          "type": "object",
                          "properties": {
                            "hgvsp": { "type": "string" },
                            "transcriptId": { "type": "string" },
                            "isoform": { "type": "string" }
                          }
                        }
                      }
                    },
                    "transcriptWarning": {
                      "type": "string",
                      "description": "Human-readable disclosure of a renumbering or an unverifiable numbering basis."
                    },
                    "genomicCoordinates": {
                      "type": "string",
                      "nullable": true
                    }
                  }
                }
              }
            }
          },
          "400": {
            "$ref": "#/components/responses/BadRequestError"
          },
          "401": {
            "$ref": "#/components/responses/UnauthorizedError"
          },
          "422": {
            "description": "The notation is out of missense scope (`NON_MISSENSE_VARIANT`), its numbering cannot be mapped (`ISOFORM_NUMBERING_MISMATCH`), it is equally consistent with two numberings (`AMBIGUOUS_PROTEIN_NUMBERING`), or its numbering basis could not be established (`UNPROCESSABLE_ENTITY`)."
          },
          "503": {
            "description": "Every reference provider was unreachable or did not answer in time (`TRANSLATION_UNAVAILABLE`), sent with `Retry-After: 60`. The message tells the clinician to enter the protein-level substitution, which skips translation entirely."
          }
        }
      }
    },
    "/analyze-variant": {
      "post": {
        "tags": [
          "Variant Analysis"
        ],
        "summary": "Execute comprehensive multi-database variant evaluation (ClinVar, dbNSFP, gnomAD, ACMG)",
        "operationId": "analyzeVariant",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "gene",
                  "variant",
                  "uniprotId"
                ],
                "properties": {
                  "gene": {
                    "type": "string",
                    "example": "BRAF"
                  },
                  "variant": {
                    "type": "string",
                    "example": "p.Val600Glu"
                  },
                  "uniprotId": {
                    "type": "string",
                    "example": "P15056"
                  },
                  "acmgWeighting": {
                    "type": "string",
                    "enum": [
                      "standard",
                      "conservative",
                      "strict-structural"
                    ],
                    "default": "standard"
                  },
                  "numberingBasis": {
                    "type": "string",
                    "enum": [
                      "canonical"
                    ],
                    "description": "The reader's answer to an `AMBIGUOUS_PROTEIN_NUMBERING` refusal: these residue numbers ARE canonical numbering. Re-submitting the bare notation without it is refused again, so this is the only way to select the canonical reading of a genuinely ambiguous position. Honoured only when the canonical reading is consistent with the sequence, and reported back as `numberingDisambiguated`."
                  },
                  "assembly": {
                    "type": "string",
                    "enum": [
                      "GRCh37",
                      "GRCh38"
                    ],
                    "default": "GRCh38",
                    "description": "Genome build the caller's coordinate notation was expressed in. Nearly every coordinate-consuming source downstream is single-build (GPN-Star, local dbNSFP, Genos, dbnsfp.org, gnomAD r4 variant ids, AlphaGenome, splice-junction geometry), so the build is carried explicitly rather than assumed. Defaults to GRCh38 so existing clients keep their behaviour."
                  },
                  "genomicCoordinates": {
                    "type": "string",
                    "maxLength": 64,
                    "example": "X-23723975-C-A",
                    "description": "The genomic coordinate the protein notation was TRANSLATED FROM (hyphen form: chrom-pos-ref-alt), sent TOGETHER WITH `assembly`. The translate route returns it; forwarding it lets the predictor query Ensembl VEP by position instead of re-deriving the locus from protein HGVS — a notation VEP rejects for codon-ambiguous substitutions (e.g. Lys→Asn) and for genes whose MANE isoform is not the canonical one this platform models. Ignored unless `assembly` was explicitly stated in the same request (a defaulted build beside a GRCh37 position is the wrong-locus hazard the assembly gate exists to refuse), and only honoured by the predictor when the annotation proves it belongs to the requested gene AND states the requested substitution at the requested position; otherwise the request falls through to the protein-HGVS path. Coordinates are lifted to GRCh38 with a forward map, an exact reverse round-trip and a reference-base check."
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Full variant interpretation payload with database evidence and rule-based ACMG classification",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "ruleBasedInsights": {
                      "type": "object"
                    },
                    "numberingVerified": {
                      "type": "boolean",
                      "description": "False when the residue's numbering could not be verified across the gene's isoforms (see `numberingUnverifiedReason`); absent when the route established nothing. Carried on the streaming chunks too."
                    },
                    "numberingUnverifiedReason": {
                      "type": "string",
                      "description": "Machine-readable reason the numbering is unverified; the prose twin is `transcriptWarning`."
                    },
                    "numberingDisambiguated": {
                      "type": "boolean",
                      "description": "True when the caller answered an ambiguity refusal with `numberingBasis: \"canonical\"`, so the numbering was CHOSEN rather than derived. A report should state which."
                    },
                    "clinvar": {
                      "type": "object",
                      "nullable": true
                    },
                    "predictorData": {
                      "type": "object",
                      "nullable": true
                    },
                    "conservationData": {
                      "type": "object",
                      "nullable": true
                    },
                    "stringInteractions": {
                      "type": "array",
                      "items": {
                        "type": "object"
                      }
                    },
                    "gnomadConstraint": {
                      "type": "object",
                      "nullable": true
                    },
                    "gnomadFrequency": {
                      "type": "object",
                      "nullable": true
                    },
                    "metadata": {
                      "type": "object"
                    },
                    "serviceStatus": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          },
          "400": {
            "$ref": "#/components/responses/BadRequestError"
          },
          "429": {
            "$ref": "#/components/responses/RateLimitedError"
          }
        }
      }
    },
    "/analyze-variant/stream": {
      "post": {
        "tags": [
          "Variant Analysis"
        ],
        "summary": "Progressive NDJSON streaming endpoint for rapid initial triage (<150ms) followed by full evidence",
        "operationId": "streamAnalyzeVariant",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "gene",
                  "variant",
                  "uniprotId"
                ],
                "properties": {
                  "gene": {
                    "type": "string",
                    "example": "ACOT9"
                  },
                  "variant": {
                    "type": "string",
                    "example": "p.Lys272Asn"
                  },
                  "uniprotId": {
                    "type": "string",
                    "example": "Q9Y305"
                  },
                  "acmgWeighting": {
                    "type": "string",
                    "enum": [
                      "standard",
                      "conservative",
                      "strict-structural"
                    ],
                    "default": "standard"
                  },
                  "numberingBasis": {
                    "type": "string",
                    "enum": [
                      "canonical"
                    ],
                    "description": "The reader's answer to an `AMBIGUOUS_PROTEIN_NUMBERING` refusal — see POST /analyze-variant."
                  },
                  "assembly": {
                    "type": "string",
                    "enum": [
                      "GRCh37",
                      "GRCh38"
                    ],
                    "default": "GRCh38",
                    "description": "Build the caller's coordinate notation was expressed in — see POST /analyze-variant."
                  },
                  "genomicCoordinates": {
                    "type": "string",
                    "maxLength": 64,
                    "example": "X-23723975-C-A",
                    "description": "The coordinate the protein notation was translated from, sent together with `assembly` — see POST /analyze-variant. The streaming route forwards it to the same predictor path, so the first chunk carries coordinate-derived evidence (AlphaMissense, CADD, transcript selection) whenever the coordinate proves the locus."
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Chunked NDJSON progressive streaming stream",
            "content": {
              "application/x-ndjson": {
                "schema": {
                  "type": "string",
                  "description": "Stream of JSON objects containing chunkIndex, isFinal, and data."
                }
              }
            }
          },
          "400": {
            "$ref": "#/components/responses/BadRequestError"
          }
        }
      }
    },
    "/biophysical-analysis": {
      "post": {
        "tags": [
          "Structural Biophysics"
        ],
        "summary": "Submit FoldX molecular dynamics mutagenesis and thermodynamic Delta Delta G calculation",
        "operationId": "submitBiophysicalAnalysis",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "gene",
                  "variant",
                  "uniprotId"
                ],
                "properties": {
                  "gene": {
                    "type": "string",
                    "example": "BRAF"
                  },
                  "variant": {
                    "type": "string",
                    "example": "p.Val600Glu"
                  },
                  "uniprotId": {
                    "type": "string",
                    "example": "P15056"
                  },
                  "wtPdb": {
                    "type": "string",
                    "description": "Optional raw PDB text."
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Energetic calculations, consensus stability classification, and mutant PDB coordinates",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "ddG": {
                      "type": "number",
                      "nullable": true
                    },
                    "foldxDdG": {
                      "type": "number",
                      "nullable": true
                    },
                    "status": {
                      "type": "string"
                    },
                    "pdb": {
                      "type": "string",
                      "nullable": true
                    },
                    "energetics": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          },
          "400": {
            "$ref": "#/components/responses/BadRequestError"
          }
        }
      }
    },
    "/find-pocket": {
      "post": {
        "tags": [
          "Structural Biophysics"
        ],
        "summary": "Detect catalytic and ligand-binding pockets near mutated residue",
        "operationId": "findBindingPocket",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "pdbText",
                  "mutIndex"
                ],
                "properties": {
                  "pdbText": {
                    "type": "string"
                  },
                  "mutIndex": {
                    "type": "number"
                  },
                  "targetChain": {
                    "type": "string",
                    "default": "A"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "P2Rank pocket coordinates and druggability scores",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "pocketResidues": {
                      "type": "array",
                      "items": {
                        "type": "object"
                      }
                    },
                    "pocketScore": {
                      "type": "number"
                    },
                    "pocketVolume": {
                      "type": "number"
                    },
                    "status": {
                      "type": "string",
                      "enum": [
                        "success",
                        "fallback"
                      ]
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/nearest-residues": {
      "post": {
        "tags": [
          "Structural Biophysics"
        ],
        "summary": "Compute 3D Euclidean spatial neighbor residues within a distance threshold",
        "operationId": "getNearestResidues",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "targetIndex"
                ],
                "properties": {
                  "pdbText": {
                    "type": "string"
                  },
                  "pdbRef": {
                    "type": "string"
                  },
                  "uniprotId": {
                    "type": "string"
                  },
                  "targetIndex": {
                    "type": "number"
                  },
                  "distanceThreshold": {
                    "type": "number",
                    "default": 5
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Array of neighbor residues with contact distance and biochemical roles",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "residues": {
                      "type": "array",
                      "items": {
                        "type": "object"
                      }
                    },
                    "source": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/align-sequences": {
      "post": {
        "tags": [
          "Sequence Alignment"
        ],
        "summary": "Perform global (Needleman-Wunsch) or local (Smith-Waterman) pairwise sequence alignment",
        "operationId": "alignSequences",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "seqA",
                  "seqB"
                ],
                "properties": {
                  "seqA": {
                    "type": "string"
                  },
                  "seqB": {
                    "type": "string"
                  },
                  "algorithm": {
                    "type": "string",
                    "enum": [
                      "global",
                      "local"
                    ],
                    "default": "global"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Aligned sequences, identity %, similarity %, and visual alignment formatting",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "alignedSeqA": {
                      "type": "string"
                    },
                    "alignedSeqB": {
                      "type": "string"
                    },
                    "identityPercent": {
                      "type": "number"
                    },
                    "score": {
                      "type": "number"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/session/keys": {
      "post": {
        "tags": [
          "System & Session"
        ],
        "summary": "Exchange valid Gemini API key for an encrypted, ephemeral session token",
        "operationId": "createSession",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": ["apiKey"],
                "properties": {
                  "apiKey": { "type": "string", "description": "Google Gemini API key" }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Session created successfully",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "sessionId": { "type": "string" },
                    "expiresAt": { "type": "number" }
                  }
                }
              }
            }
          },
          "400": {
            "$ref": "#/components/responses/BadRequestError"
          }
        }
      }
    },
    "/session/refresh": {
      "post": {
        "tags": [
          "System & Session"
        ],
        "summary": "Refresh an existing session token before expiration",
        "operationId": "refreshSession",
        "responses": {
          "200": {
            "description": "Session refreshed successfully",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "sessionId": { "type": "string" },
                    "expiresAt": { "type": "number" }
                  }
                }
              }
            }
          },
          "401": {
            "$ref": "#/components/responses/UnauthorizedError"
          }
        }
      }
    }
  },
  "components": {
    "securitySchemes": {
      "SessionAuth": {
        "type": "apiKey",
        "in": "header",
        "name": "X-Gemini-Session-ID",
        "description": "Encrypted AES-256-GCM session identifier"
      },
      "BearerAuth": {
        "type": "http",
        "scheme": "bearer",
        "bearerFormat": "JWT",
        "description": "Static API token for server-to-server integrations"
      }
    },
    "responses": {
      "BadRequestError": {
        "description": "Bad Request — Invalid parameters or malformed JSON payload",
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/ErrorResponse"
            }
          }
        }
      },
      "UnauthorizedError": {
        "description": "Unauthorized — Missing or invalid authentication credentials",
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/ErrorResponse"
            }
          }
        }
      },
      "RateLimitedError": {
        "description": "Too Many Requests — Rate limit threshold reached",
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/ErrorResponse"
            }
          }
        }
      }
    },
    "schemas": {
      "ErrorResponse": {
        "type": "object",
        "required": [
          "error"
        ],
        "properties": {
          "error": {
            "type": "object",
            "required": [
              "code",
              "message"
            ],
            "properties": {
              "code": {
                "type": "string",
                "example": "INVALID_ARGUMENT"
              },
              "message": {
                "type": "string",
                "example": "Gene symbol is required."
              },
              "requestId": {
                "type": "string",
                "example": "d9e80e12-b2fa-48b2-8c88-e9f0c29f43f1"
              },
              "details": {
                "type": "object"
              }
            }
          }
        }
      }
    }
  }
};
}
