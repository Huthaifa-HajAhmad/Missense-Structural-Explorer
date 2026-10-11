/**
 * openapi.ts — Dynamic OpenAPI 3.1.0 specification generator.
 *
 * The queued-compute, account, job and admin paths live in `openapi-compute.ts`.
 */
import { COMPUTE_PATHS, COMPUTE_SCHEMAS, COMPUTE_TAGS } from "./openapi-compute.ts";

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
      "name": "Literature & Insights",
      "description": "PubMed LitRAG search and Gemini clinical narrative synthesis"
    },
    {
      "name": "System & Session",
      "description": "Session authentication, health checks, and engine diagnostics"
    },
    ...COMPUTE_TAGS
  ],
  "paths": {
    ...COMPUTE_PATHS,
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
                    "description": "Genomic HGVS, dashed coordinates, transcript cDNA, or a protein substitution qualified by the protein its numbering belongs to (`NP_…`, `<UniProt accession>[-isoform]`). An accession-qualified notation is mapped onto CANONICAL UniProt numbering; an unverifiable basis is refused rather than assumed. A build may be stated inline — `Chr1(GRCh37):g.…` for a coordinate, `NM_004333.6(GRCh37):c.…` for cDNA, where it qualifies the transcript's own reference sequence — and it then decides which Ensembl host answers; without one the coordinate is read as GRCh38, and EXACTLY ONE may be stated (two annotations are refused as a contradiction). A `c.` description must name a nucleotide reference sequence with the lower-case HGVS prefix: a bare `c.…`, a protein accession, or `C.…` is refused with the fix in the message, because no provider can parse any of them. A GRCh37 genomic coordinate is lifted onto GRCh38 first (reverse-verified) and the response reports both builds."
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
                    "geneSymbolUpdated": {
                      "type": "object",
                      "description": "Present when the provider named the resolved gene with a RETIRED symbol that UniProt lists as a synonym of this entry, so `gene` is the current HGNC symbol instead (Ensembl's GRCh37 archive answers `CPSF3L` for `INTS11`).",
                      "properties": {
                        "from": { "type": "string", "example": "CPSF3L" },
                        "to": { "type": "string", "example": "INTS11" }
                      }
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
                      "nullable": true,
                      "description": "The locus the SUBMITTED coordinate denotes, hyphen form, in the build named by `assembly` — what a report cites, and the coordinate that must be paired with `assembly` downstream."
                    },
                    "resolvedAssembly": {
                      "type": "string",
                      "enum": [
                        "GRCh37",
                        "GRCh38"
                      ],
                      "description": "Build the returned `variant`/`uniprotId` were ANNOTATED on. Equals `assembly` unless the submitted coordinate was verified onto the canonical build first (see `coordinateLift`), in which case it is `GRCh38` while `assembly` still states what the caller typed. Read THIS — not `assembly` — when asking which reference release numbered the protein."
                    },
                    "liftedGenomicCoordinates": {
                      "type": "string",
                      "description": "The verified canonical-build locus (hyphen form), present only when a lift was verified. Forward it to the analysis routes together with `resolvedAssembly`, so the predictor does not lift the submitted coordinate a second time."
                    },
                    "coordinateLift": {
                      "type": "object",
                      "description": "How the genome build was decided for this coordinate, and — when no lift was used — why. Policy: coordinates are lifted to the canonical build when the input build differs, and the lift is reverse-verified (forward map, exact reverse round-trip, reference-base check) before use. A lift that fails any check is refused, never coerced; the coordinate is then annotated on its own build, whose annotations come from Ensembl's GRCh37 archive and predate MANE Select.",
                      "properties": {
                        "status": {
                          "type": "string",
                          "enum": ["lifted", "unavailable", "not-needed", "not-applicable"],
                          "description": "`lifted` = verified onto the canonical build; `unavailable` = a lift was attempted and could not be verified (annotated on the submitted build); `not-needed` = the submitted build is already canonical; `not-applicable` = nothing liftable was submitted (cDNA, indel, protein notation)."
                        },
                        "fromAssembly": { "type": "string", "enum": ["GRCh37", "GRCh38"] },
                        "toAssembly": { "type": "string", "enum": ["GRCh37", "GRCh38"] },
                        "fromCoordinates": { "type": "string", "example": "1-1256452-C-A" },
                        "toCoordinates": { "type": "string", "example": "1-1321072-C-A" },
                        "reverseVerified": { "type": "boolean" },
                        "reason": { "type": "string" }
                      }
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
            "description": "The notation is out of missense scope (`NON_MISSENSE_VARIANT`), its numbering cannot be mapped (`ISOFORM_NUMBERING_MISMATCH`), it is equally consistent with two numberings (`AMBIGUOUS_PROTEIN_NUMBERING`), its numbering basis could not be established (`UNPROCESSABLE_ENTITY`), or its REF allele matches no reference base on the build it was read against (`COORDINATE_REFERENCE_MISMATCH`). The last one carries `details.buildHint` — the same coordinate annotated with the OTHER build, ready to submit — but only when that build was CHECKED to carry the submitted allele; the usual cause is a genome-build mismatch and the remedy is to state the build, while a position neither build carries needs the alleles re-read instead, which the message says. It is deliberately NOT sent with `Retry-After`: re-running the same coordinate is refused identically."
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
                    "description": "The genomic coordinate the protein notation was TRANSLATED FROM (hyphen form: chrom-pos-ref-alt), sent TOGETHER WITH `assembly`. The translate route returns it; forwarding it lets the predictor query Ensembl VEP by position instead of re-deriving the locus from protein HGVS — a notation VEP rejects for codon-ambiguous substitutions (e.g. Lys→Asn) and for genes whose MANE isoform is not the canonical one this platform models. Ignored unless `assembly` was explicitly stated in the same request (a defaulted build beside a GRCh37 position is the wrong-locus hazard the assembly gate exists to refuse), and only honoured by the predictor when the annotation proves it belongs to the requested gene AND states the requested substitution at the requested position; otherwise the request falls through to the protein-HGVS path."
                  },
                  "liftedGenomicCoordinates": {
                    "type": "string",
                    "maxLength": 64,
                    "example": "X-23705858-C-A",
                    "description": "The VERIFIED canonical-build (GRCh38) locus of the same variant, sent together with `resolvedAssembly` when the translate route lifted the caller's coordinate. Forwarded BESIDE `genomicCoordinates`, never instead of it: the submitted pair is what a report cites, this pair is where the annotation came from. The predictor prefers this one — it is already on the build every coordinate-consuming source is pinned to, so it needs no second lift and cannot disagree with the annotation that produced the protein substitution."
                  },
                  "resolvedAssembly": {
                    "type": "string",
                    "enum": [
                      "GRCh37",
                      "GRCh38"
                    ],
                    "description": "Build the annotation came from; equals `assembly` unless a lift was verified. Required to make `liftedGenomicCoordinates` usable (an unpaired coordinate is dropped, never assumed canonical)."
                  },
                  "coordinateLift": {
                    "type": "object",
                    "readOnly": true,
                    "description": "NOT a request field: the route DERIVES the build decision from `assembly`, `genomicCoordinates`, `resolvedAssembly` and `liftedGenomicCoordinates` (`deriveCoordinateLift`), and returns it on the result. A disclosure a caller could assert would be decoration rather than evidence — nothing would stand behind `{status:\"lifted\", reverseVerified:true}`. It is listed here only to document the shape the RESPONSE carries.",
                    "properties": {
                      "status": { "type": "string", "enum": ["lifted", "unavailable", "not-needed", "not-applicable"] },
                      "fromAssembly": { "type": "string", "enum": ["GRCh37", "GRCh38"] },
                      "toAssembly": { "type": "string", "enum": ["GRCh37", "GRCh38"] },
                      "fromCoordinates": { "type": "string" },
                      "toCoordinates": { "type": "string" },
                      "reverseVerified": { "type": "boolean" },
                      "reason": { "type": "string" }
                    }
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
                    "assembly": {
                      "type": "string",
                      "nullable": true,
                      "enum": ["GRCh37", "GRCh38", null],
                      "description": "Genome build the CALLER's coordinate is expressed in — what the submitted `genomicCoordinates` (forwarded to the predictor) belongs to."
                    },
                    "resolvedAssembly": {
                      "type": "string",
                      "nullable": true,
                      "enum": ["GRCh37", "GRCh38", null],
                      "description": "Build the annotation came from. Differs from `assembly` exactly when the canonical pair was sent and used, i.e. when the translate route verified a lift."
                    },
                    "liftedGenomicCoordinates": {
                      "type": "string",
                      "nullable": true,
                      "description": "Hyphen form of the verified canonical locus, present only when the caller supplied the canonical pair."
                    },
                    "coordinateLift": {
                      "type": "object",
                      "nullable": true,
                      "description": "The DERIVED build decision (`deriveCoordinateLift`), so a result, a rail and a report can state the trail without inferring it. Never echoed from the request: see the request-side note."
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
                  },
                  "liftedGenomicCoordinates": {
                    "type": "string",
                    "maxLength": 64,
                    "example": "X-23705858-C-A",
                    "description": "Verified canonical-build locus, sent with `resolvedAssembly` — see POST /analyze-variant."
                  },
                  "resolvedAssembly": {
                    "type": "string",
                    "enum": [
                      "GRCh37",
                      "GRCh38"
                    ],
                    "description": "Build the annotation came from — see POST /analyze-variant."
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Chunked NDJSON progressive streaming stream. Each chunk's `data` object carries the same genome-build trail as `POST /analyze-variant` (`assembly`, `resolvedAssembly`, `liftedGenomicCoordinates`, `coordinateLift`) — the streaming route assembles its payload with the same builder, and the pipeline prefers it, so leaving the trail undocumented here meant the endpoint the client actually uses could not be discovered from the spec.",
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
          },
          "400": {
            "description": "BAD_REQUEST."
          },
          "409": {
            "description": "STALE_STRUCTURE_REF: the `structureRef` has expired; submit the structure again."
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
      "SessionCookie": {
        "type": "apiKey",
        "in": "cookie",
        "name": "mse_session",
        "description": "A signed-in browser session (HttpOnly, SameSite=Lax), set by /auth/login, /setup, /auth/accept-invite and /auth/reset. With AUTH_MODE=hybrid or accounts, every write needs it (hybrid also accepts the APP_API_TOKEN bearer)."
      },
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
      ...COMPUTE_SCHEMAS,
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
