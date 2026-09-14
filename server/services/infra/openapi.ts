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
                    "example": "BRAF V600E",
                    "description": "Genomic, cDNA, HGVS, or gene-variant string notation."
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
                      "example": true
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
      "get": {
        "tags": [
          "Variant Analysis"
        ],
        "summary": "Progressive NDJSON streaming endpoint for rapid initial triage (<150ms) followed by full evidence",
        "operationId": "streamAnalyzeVariant",
        "parameters": [
          {
            "name": "gene",
            "in": "query",
            "required": true,
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "variant",
            "in": "query",
            "required": true,
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "uniprotId",
            "in": "query",
            "required": true,
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "acmgWeighting",
            "in": "query",
            "required": false,
            "schema": {
              "type": "string",
              "default": "standard"
            }
          }
        ],
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
