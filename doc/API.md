# MissenseResolve® — API Reference

All backend endpoints are prefixed with `/api/v1` and are defined in `server/routes.ts`.

## Authentication & Sessions

Endpoints marked with 🔒 require the standard Bearer Token auth (`Authorization: Bearer <API_TOKEN>`) configured on the server via `APP_API_TOKEN`.

For Gemini analysis, a stateless session key is exchanged via `/session/keys`. The client sends their Gemini API key, and receives an encrypted stateless session token (`sessionId`) which must be supplied in the `X-Gemini-Session-ID` header for analysis requests.

---

## Endpoint Index

### 1. Health check
* **Route**: `GET /api/v1/health`
* **Auth**: None
* **Description**: Returns server status and current timestamp. Useful for container readiness probes.
* **Response**:
  ```json
  {
    "status": "ok",
    "timestamp": "2026-06-24T07:34:52.000Z"
  }
  ```

### 2. Version information
* **Route**: `GET /api/v1/version`
* **Auth**: None
* **Description**: Returns the API version and the revision the running container was built from.
* **Response**:
  ```json
  {
    "version": "1.0.0",
    "env": "production",
    "commit": "4a6a949…",
    "builtAt": null
  }
  ```
  `commit` is the CI-validated revision the deploy pipeline checked out (`null` when the build did not record one). It exists so "did my fix ship?" is answerable without shell access: deployments are gated on a green CI run, and a failed run once deployed anyway, which made that question impossible to settle from outside.

### 3. Session Key Initialization
* **Route**: `POST /api/v1/session/keys`
* **Auth**: 🔒 (Bearer Token)
* **Request Body**:
  ```json
  {
    "apiKey": "AIzaSy..."
  }
  ```
* **Description**: Validates Gemini API key format/length and returns an AES-256-GCM encrypted stateless session token (`sessionId`).
* **Response**:
  ```json
  {
    "sessionId": "iv:ciphertext:tag",
    "expiresAt": 1782298000000
  }
  ```

### 4. Analyze Variant
* **Route**: `POST /api/v1/analyze-variant`
* **Auth**: 🔒 (Bearer Token) + `X-Gemini-Session-ID` header
* **Rate Limits**: 120 requests per minute per IP for general endpoints, 10 requests per minute for Gemini API.
* **Request Body**:
  ```json
  {
    "gene": "PAH",
    "variant": "p.Arg408Trp",
    "uniprotId": "P00439",
    "userDirections": "Focus on salt-bridge disruptions.",
    "numberingBasis": "canonical"
  }
  ```
* **Numbering verification**: before anything is modelled, the residue is checked against the gene's isoform model, because a bare notation's numbers may belong to the MANE protein rather than the canonical sequence (they differ by an offset, and at some positions the wild-type letter coincides while the residue is elsewhere). The check is bounded (2.5s) and advisory, and its outcome travels with the result on BOTH the JSON response and the `analyze-variant/stream` chunks:
  - `numberingVerified: false` plus `numberingUnverifiedReason` (prose twin in `transcriptWarning`) — the check could not be completed, so the numbering is disclosed, never asserted, and never cached;
  - `numberingVerified: true` — no other reading of that position exists *within the scope checked*
    (canonical versus the MANE protein, the pair a report uses). When ANOTHER isoform of the gene also
    reads the position at a different canonical residue, the canonical reading is still accepted but
    reported as `numberingVerified: false` with a reason naming that isoform — the alternative would be
    to assert a verification that only ever compared one pair;
  - `numberingDisambiguated: true` — the caller answered an `AMBIGUOUS_PROTEIN_NUMBERING` refusal with `numberingBasis: "canonical"`, so the numbering was CHOSEN. A report should say so: the residue numbers rest on a human decision rather than a provider's metadata.
  Optional request field `numberingBasis: "canonical"` carries that decision; it is only honoured when the canonical reading is consistent with the sequence (it cannot settle a wild-type mismatch).
* **Genome-build trail (on the result)**: every analysis payload — the JSON response and each `analyze-variant/stream` chunk — carries the coordinate's build trail, so a surface or a report never has to infer a build:
  - `assembly` — the build the CALLER's `genomicCoordinates` is expressed in;
  - `resolvedAssembly` — the build the annotation came from; the two differ exactly when the translate route verified a lift and the client forwarded the canonical pair;
  - `liftedGenomicCoordinates` — the verified canonical locus (present only with that pair);
  - `coordinateLift` — the decision, `DERIVED` by this route from those facts (`deriveCoordinateLift`). It is deliberately **not** a request field: a disclosure a caller can assert is decoration, not evidence (the pair itself is bound downstream by the coordinate-first predictor query's contig/position/REF, gene and substitution checks). Its `status` is `lifted` for a complete canonical pair, `not-needed` for a canonical submitted build, and `unavailable` for a non-canonical one that arrived without a pair — the case where the annotation comes from an older release. That derived record carries **no `reasonCode`**: this route never attempts a lift, so it cannot know whether one would have been refused for a retryable cause or for a fact about the reference, and it will not invent the one field a caller branches on.
* **Retry as the other build (`buildHint`)**: when the notation translation refuses the coordinate because its REF allele matches no reference base on the build it was read against (`422 COORDINATE_REFERENCE_MISMATCH`, raised by the translate route), the analysis state carries `buildHint` beside the error message — `{ assembly, triedAssembly, notation, reason }`, where `notation` is the SAME coordinate annotated with the other build and ready to submit. It reaches the result through the same channel as `numberingChoices` (the thrown error's `code`/`details`, re-validated against `buildHintSchema` before anything renders it — including that the notation really does state the build it offers), together with the refusal's **build trail** (`assembly`, `resolvedAssembly`, `coordinateLift`, `assemblyNote`), so the prompt can say whether that build was STATED or merely the default. Nothing is verified by the hint itself — the retried request is verified exactly like a hand-typed annotation — but the server only offers a build whose reference sequence was checked to carry the submitted allele, which is why the state also carries no hint at all for the cases listed above.
* **Description**: Coordinates multi-modal fetches (ClinVar, gnomAD, VEP predictors, MyVariant.info, STRING network) and passes the curated evidence profile to Gemini for structured clinical-narrative analysis.
* **Response**: Returns a detailed markdown analysis, ACMG criteria, structural impact indicators, and consensus datasets.
  ```json
  {
    "analysis": "# Narrative Analysis...",
    "insights": {
      "biochemicalShift": "Substitution of positive hydrophilic Arg with a neutral bulky hydrophobic Trp...",
      "structuralImpact": "Steric packing clashes within helix backbone...",
      "pathogenicity": "Pathogenic",
      "acmgCriteria": [
        { "code": "PM1", "reason": "Justification..." }
      ],
      "source": "ai_inference"
    },
    "disclaimer": "This analysis is automatically generated by an artificial intelligence model...",
    "authoritativeEvidence": {
      "clinvar": { ... },
      "predictorData": { ... },
      "conservationData": { ... },
      "stringInteractions": [ ... ]
    },
    "disruptionPredictor": {
      "level": "high",
      "reason": "Severe core steric expansion (volume increase of +139 Å³ from R to W at position 408), expected to cause steric clashes in the packed hydrophobic core.",
      "plddt": 92.5
    },
    "metadata": {
      "gene": "PAH",
      "variant": "p.Arg408Trp",
      "uniprotId": "P00439",
      "residueIndex": 408,
      "wildType": "R",
      "mutant": "W"
    }
  }
  ```
* **Error Codes**:
  - `401 SESSION_EXPIRED`: Returned if session ID header `X-Gemini-Session-ID` is invalid, expired, or missing.
  - `403 API_KEY_INVALID`: Returned if custom Gemini API key is invalid/unauthorized.
  - `429 RESOURCE_EXHAUSTED` / `RATE_LIMITED`: Returned if rate limits are exceeded or Gemini API quota is exhausted.
  - `503 MODEL_UNAVAILABLE`: Returned if Gemini model fails/is unavailable.

### 5. Biophysical Mutant Generation
* **Route**: `POST /api/v1/generate-mutant`
* **Auth**: 🔒 (Bearer Token)
* **Request Body**: (JSON payload containing PDB text)
  ```json
  {
    "wtPdb": "ATOM      1  CA...",
    "mutation": "RA408W",
    "uniprotId": "P00439"
  }
  ```
* **Description**: Writes PDB to temporary file and runs FoldX `BuildModel` command-line biophysical simulation across 3 runs. It computes sample standard deviation, VdW clash deltas, electrostatic interactions, and sidechain packaging RMSD. If FoldX is not installed or fails, the API does **not** fall back to WT coordinates; instead, it fails-loud and throws a hard error.
* **Response**:
  ```json
  {
    "pdb": "ATOM      1  CA...",
    "ddG": 1.54,
    "status": "success",
    "foldedResidueIndex": 408,
    "energetics": {
      "foldx": 1.54,
      "foldxMean": 1.54,
      "foldxSd": 0.12,
      "vdw": 2.15,
      "electrostatics": -0.45,
      "stericClashWarning": false,
      "localSidechainRmsd": 1.12,
      "dynamut2": null,
      "consensusVerdict": "High-Risk Pathogenic (FoldX)"
    }
  }
  ```
* **Error Codes**:
  - `503 MODELING_UNAVAILABLE`: Returned with `{ foldxReady: false }` if FoldX is missing or execution fails.
  - `422 UNPROCESSABLE_ENTITY`: Returned if the target residue is missing from the PDB file or there is a residue mismatch.
  - `502 BAD_GATEWAY`: Returned if FoldX runs but outputs an invalid/corrupt result.

### 6. Translate Variant
* **Route**: `POST /api/v1/translate-variant`
* **Auth**: 🔒 (Bearer Token)
* **Request Body**:
  ```json
  {
    "variant": "Chr1(GRCh38):g.25484258G>A"
  }
  ```
* **Description**: Uses Ensembl VEP endpoints to translate genomic / cDNA coordinate inputs into IUPAC protein-level **missense** variant notations and UniProt accessions. Resolution runs as a provider ladder — L2 cache → Ensembl VEP → VariantValidator — and the response reports which provider answered (`provenance`). Every rung is asked for a **protein-altering** consequence; a payload with none is a miss, not an answer, so another provider's annotation release gets its chance before the coordinate is refused.
* **Accepted Notations** (see `src/shared/variantNotation.ts` — the single source of truth):
  | Family | Example |
  | --- | --- |
  | Genomic HGVS | `chr1:g.25484258G>A` |
  | Genomic HGVS + assembly annotation | `Chr1(GRCh38):g.25484258G>A` |
  | RefSeq RefSeqGene accession | `NC_000001.11:g.25484258G>A` |
  | Dashed genomic coordinates | `20-23365054-G-A` |
  | Transcript cDNA HGVS | `NM_004333.6:c.1799T>A` |
  | Transcript cDNA + assembly annotation | `NM_004333.6(GRCh37):c.1799T>A` |
  | Accession-qualified protein notation | `NP_001032248.1:p.Lys281Asn`, `Q9Y305-4:p.Lys281Asn` |
* **Accession-qualified protein notation**: a protein substitution whose residue numbers belong to a named protein — how lab/clinical pipelines report variants. The basis is resolved **exactly, never inferred**:
  - the RefSeq accession is looked up among **reviewed human** entries only (an unfiltered search ranks unreviewed TrEMBL records first, which would number the analysis against a protein nobody reviewed);
  - `<accession>-1` and the bare accession both mean the **canonical** isoform — UniProt writes it both ways, and comparing them literally once refused *canonical* notations with a false "no such isoform";
  - when a declared isoform has no matching sequence record, the entry's ALTERNATIVE PRODUCTS comment is consulted, because UniProt labels the *displayed* isoform's sequence with the bare accession;
  - if the basis **cannot** be established (unknown accession, or a RefSeq cross-reference stating no isoform) the request is refused with that reason instead of converted on an assumption — assuming canonical numbering is how an isoform-numbered position came to be modelled against the canonical sequence, silently, whenever the wild-type letters coincided.
  `NP_001032248.1:p.Lys281Asn` (ACOT9) therefore returns `p.Lys272Asn` on `Q9Y305`, with `numberingRemap` recording the input notation, its isoform (`from.isoform`), its accession (`from.accession`) and its transcript. A UniProt failure is a **503** with retry guidance, never a 422 about the user's accession.
* **Position mapping**: anchoring uses up to 25 residues on each side of the position, requires at least 8 on each side in total, and includes the residue itself — so a window that straddles an isoform difference (or a repeated motif) cannot be located and is reported instead of converted.
* **Assembly Routing (lift-first)**: an inline `(GRCh38)` / `(GRCh37)` / `(hg38)` / `(hg19)` annotation states the build the submitted coordinate is expressed in; a notation without one defaults to GRCh38, and a **RefSeq chromosome accession** (`NC_000001.10:g.…`) also states it, because the accession names the reference sequence itself (verified per build: `NC_000001.10` is GRCh37, `NC_000001.11` is GRCh38; `NC_012920.1`, the mitochondrion, is the same sequence in both and therefore states nothing). Where an accession and an annotation disagree, the **accession wins** and `assemblyNote` says so. **Exactly one** build may be stated: a notation carrying two annotations (`Chr1(GRCh37)(GRCh38):g.…`) is refused with `400 BAD_REQUEST`, because any reading of it decides for the caller which reference to use.
  A **cDNA** notation states it the same way, on the transcript's own sequence: `NM_004333.6(GRCh37):c.1799T>A`. The annotation sits before the colon rather than before the coordinate, because it qualifies the reference sequence the transcript belongs to — and it decides which Ensembl host answers, so hg19 cDNA is annotated against hg19 rather than silently read as GRCh38. The accession rule applies here too: `NC_000001.10:c.1799T>A` is a GRCh37 sequence whichever coordinate type follows it, and it wins over a contradicting annotation exactly as it does for `g.`. A `c.` description must name a **nucleotide** reference sequence, written with the lower-case HGVS type prefix; a bare `c.1222C>T` (`400`, missing transcript), a `NP_…:c.…` (`400`: a protein accession carries `p.` positions) and a `C.1222C>T` (`400`: the prefix is part of the notation's grammar) are each refused up front, with the fix in the message — no provider can parse any of them, so the alternative was a ladder run that could only answer "the providers returned unusable responses". cDNA carries no genomic locus, so `coordinateLift` is `not-applicable` (code `no-genomic-locus`); the build it stated is reported as `assembly`/`resolvedAssembly` with `coordinateLift.buildDeclared: true`.
  A submitted **GRCh37 coordinate is lifted onto GRCh38 and annotated there** — the policy declared in `src/shared/assembly.ts` is "lift to the canonical build when the input build differs, and REVERSE-VERIFY the lift before use". The lift is verified by three checks (exactly one single-base same-contig forward mapping, an exact reverse round-trip, and the GRCh38 reference base equal to the submitted REF allele) and is refused outright if any fails; only single substitutions are lifted, which is exactly the platform's missense scope. Doing this makes a GRCh37 and a GRCh38 spelling of one variant converge on **one** answer — measured on `Chr1(GRCh37):g.1256452C>A` (= `Chr1(GRCh38):g.1321072C>A`, INTS11/CPSF3L): both now resolve to canonical `p.Arg17Leu` on `Q5TA45-1`, where annotating on the GRCh37 archive gave `p.Arg23Leu` on isoform `Q5TA45-5`.
  - `assembly` = the build the **submitted** coordinate is in; `genomicCoordinates` = its locus in that build (a report cites this pair).
  - `resolvedAssembly` = the build the **annotation** came from; `liftedGenomicCoordinates` = the verified canonical locus (present only when a lift was verified).
  - `coordinateLift` states the decision machine-readably: `lifted` / `not-needed` / `unavailable` / `not-applicable`, both assemblies, both loci, `reverseVerified`, and — when no lift was used — **why**, as both a `reason` sentence and a `reasonCode` a caller can branch on: `no-mapping`, `ambiguous-mapping`, `contig-changed`, `round-trip-failed`, `reference-discontinuity`, `map-unavailable`, `budget-exceeded`, `invalid-coordinate` (a refusal), plus `no-genomic-locus` / `unsupported-contig` (nothing was liftable in the first place, so no lift was attempted). The distinction that matters is **retryable versus definitive**: `map-unavailable` and `budget-exceeded` say the assembly map did not answer, or that our own deadline stopped the attempt, and another request may well succeed; the rest describe the coordinate's place in the reference, which no number of retries changes — and `reference-discontinuity` in particular means the two assemblies disagree at that base. `ambiguous-mapping` covers every non-unique answer the map can give (several mappings, a strand flip, a range expansion), so it does not mean "mapped more than once". `isRetryableLiftRefusal()` (`src/shared/contracts.ts`) is the shared predicate, and the build row's note acts on it: it invites a retry only for the two retryable codes.
  - When no verified lift exists the coordinate is annotated on its own build and the response says what that means: annotations then come from Ensembl's **GRCh37 archive**, which predates MANE Select. The lift is capped (12s: a forward map, then the reverse round-trip and the reference-base check together) and cached for ~10 years once obtained, so a slow map costs the lift — never the request. Failures are **not** cached, so the next request for that locus retries it. The whole call is bounded at 52s (inside the client's 60s) with whatever the lift leaves going to the provider ladder, so the two budgets cannot sum past the caller's deadline.
  - **Analysis routes**: forward `liftedGenomicCoordinates` + `resolvedAssembly` (plus `coordinateLift`) BESIDE `genomicCoordinates` + `assembly`. The predictor prefers the verified canonical pair: it is already on the build every coordinate-consuming source is pinned to, so it needs no second lift and cannot disagree with the annotation that produced the protein substitution. A canonical coordinate sent **without** its build is dropped, never assumed canonical.
* **Old-annotation payload repair (fallback path only)**: when no lift can be verified, the GRCh37 host's VEP release predates three things this pipeline needs — all verified live for the coordinate above:
  - `swissprot` carries the UniProt **entry name** (`INT11_HUMAN`) where the GRCh38 host carries the **accession** (`Q5TA45.162`). The name is converted through UniProt's exact `id:` query before it reaches `uniprotId`; a name UniProt cannot resolve is **dropped** (the response then omits the accession, which the client resolves from the gene) rather than forwarded, because a non-accession must never fail — or silently mislead — a coordinate that resolved;
  - `uniprot_isoform` is **absent**, so the numbering basis is read from the entry's Ensembl cross-references (which state `isoformId` per transcript, e.g. `ENST00000540437` → `Q5TA45-5`). Without that, the archive's own canonical transcript `ENST00000540437` (`p.Arg23Leu`) would be returned against canonical `Q5TA45` — where position 23 is `S` — and the analysis would refuse it (or model the wrong residue had the letters coincided). With the basis stated, the sibling on canonical isoform `Q5TA45-1` becomes a canonically-numbered sibling and the verdict is `remapped` → **`p.Arg17Leu`**;
  - the gene symbol is the **retired** `CPSF3L`. When UniProt lists the reported symbol as a primary name or synonym of the resolved entry, the response returns the **current HGNC symbol** (`INTS11`) and records the swap in `geneSymbolUpdated`; a symbol UniProt does not list for that entry is never rewritten.
  These repairs run only for a payload that declares **no** isoform metadata anywhere — where the provider states it (every current release, and the GRCh38 host), its own answer is authoritative and no extra lookup is made. A UniProt outage costs the enrichment (the previous `unverified` disclosure stays in place) and never the request.
* **Isoform Numbering Reconciliation**: `hgvsp` is numbered on the *selected transcript's* protein, while `swissprot` names the *canonical* UniProt accession. When the protein a notation was reported on is a non-canonical UniProt isoform these disagree (e.g. ACOT9: MANE `NM_001037171.2` → isoform `Q9Y305-4` `p.Lys281Asn`, canonical `Q9Y305`/`Q9Y305-1` → `p.Lys272Asn`; INTS11 on GRCh37: archive-canonical `ENST00000540437` → `Q5TA45-5` `p.Arg23Leu`, canonical `Q5TA45-1` → `p.Arg17Leu`). Because AlphaFold DB / PDB structures follow canonical numbering, resolution reconciles the numbering before returning — there are **four** outcomes, reported as `numberingBasis`:
  - `canonical` — numbering proven to follow the canonical accession (either stated by the provider, or inferred when an unannotated consequence sits at the same residue position as a canonically-numbered sibling) → returned unchanged, `numberingVerified: true`;
  - `remapped` — numbering follows another isoform, and the same substitution is reported by a canonically-numbered sibling → that sibling's HGVSp is returned, with `numberingRemap` and a `transcriptWarning` stating both notations. A remap requires the same gene, the same amino-acid change (VEP `amino_acids`, else the letters in `hgvsp`), a residue position inside a biologically possible range, and unanimous agreement on the numbering offset across every canonically-numbered sibling; any disagreement refuses instead;
  - `unverified` — the basis cannot be established (the provider reported no UniProt accession, as VariantValidator never does, or stated no isoform and offered nothing to compare against). The notation is returned **with a `transcriptWarning` and `numberingVerified: false`**, and the result is deliberately **not cached**, so it can be re-resolved once a metadata-carrying provider is reachable. Residue numbers in this state may not match the canonical sequence;
  - `unsupported` — the numbering is known to be non-canonical and no safe sibling exists → `422 ISOFORM_NUMBERING_MISMATCH` rather than a numbering the modelling pipeline cannot honour.
* **Response (additions)**:
  ```json
  {
    "gene": "MACO1",
    "variant": "p.Glu433Lys",
    "uniprotId": "Q8N5G0",
    "uniprotIsoform": "Q8N5G0-1",
    "numberingBasis": "canonical",
    "numberingVerified": true,
    "assembly": "GRCh38",
    "resolvedAssembly": "GRCh38",
    "genomicCoordinates": "1-25484258-G-A",
    "coordinateLift": { "status": "not-needed", "fromAssembly": "GRCh38", "toAssembly": "GRCh38", "fromCoordinates": "1-25484258-G-A" },
    "notationNormalized": "chr1:g.25484258G>A",
    "assemblyNote": "Notation annotated \"(GRCh38)\" — resolved against the GRCh38 reference assembly."
  }
  ```
  A GRCh37 coordinate that verified onto the canonical build:
  ```json
  {
    "gene": "INTS11",
    "variant": "p.Arg17Leu",
    "uniprotId": "Q5TA45",
    "assembly": "GRCh37",
    "resolvedAssembly": "GRCh38",
    "genomicCoordinates": "1-1256452-C-A",
    "liftedGenomicCoordinates": "1-1321072-C-A",
    "coordinateLift": {
      "status": "lifted",
      "fromAssembly": "GRCh37",
      "toAssembly": "GRCh38",
      "fromCoordinates": "1-1256452-C-A",
      "toCoordinates": "1-1321072-C-A",
      "reverseVerified": true
    }
  }
  ```
  When no lift could be verified, `coordinateLift.status` is `unavailable`, `toAssembly` equals `fromAssembly`, `liftedGenomicCoordinates` is absent, `reason` says why, and `assemblyNote` states that the annotation came from the older archive.
  When the provider's gene symbol was retired and refreshed from UniProt, the response records the swap:
  ```json
  {
    "gene": "INTS11",
    "geneSymbolUpdated": { "from": "CPSF3L", "to": "INTS11" }
  }
  ```
  When a remap occurred, the response also carries:
  ```json
  {
    "numberingRemap": {
      "reason": "the reported protein's numbering follows a non-canonical UniProt isoform",
      "from": { "hgvsp": "ENSP00000368605.5:p.Lys281Asn", "transcriptId": "ENST00000379303", "isoform": "Q9Y305-4", "maneRefSeqId": "NM_001037171.2" },
      "to": { "hgvsp": "ENSP00000336580.7:p.Lys272Asn", "transcriptId": "ENST00000336430", "isoform": "Q9Y305-1" }
    },
    "transcriptWarning": "Protein numbering remapped for structural analysis: …"
  }
  ```
  `numberingBasis: "unverified"` instead carries `numberingUnverifiedReason` and a `transcriptWarning` beginning "Protein numbering could not be verified against …". When the provider named the protein the numbering follows without naming a UniProt isoform (VariantValidator reports `NP_…`), it is returned as `numberingProteinId` so the basis can still be checked.
* **Field caveat — `isCanonical`**: this is Ensembl's canonical-transcript flag, NOT a statement that the residue numbering follows the canonical UniProt isoform. A MANE Select transcript is routinely Ensembl-canonical while being numbered on a different UniProt isoform; use `numberingBasis` / `numberingVerified` for anything numbering-related.
* **Error Codes**:
  - `400 BAD_REQUEST`: Notation is not a recognized coordinate format. The message enumerates every accepted family. Also returned — with the fix named rather than the rule — for a notation that states **two** genome builds, and for a `c.` description that names no transcript (`c.1222C>T`), names a **protein** accession (`NP_…:c.…`), or writes the type prefix in upper case (`C.1222C>T`). None of the three can be parsed by any provider, so each is refused before the ladder rather than after it.
  - `422 NON_MISSENSE_VARIANT`: The notation is a recognized coordinate but is **not a single-nucleotide substitution** (deletion, insertion, duplication, inversion, delins, `=`), **or** it resolved to a non-missense protein consequence (stop-gain, frameshift, protein indel, synonymous / no-change `p.(=)`, unknown effect `p.?`, start-loss `p.Met1?`), **or** every provider returned transcript consequences carrying **no protein change at all** (intronic, UTR, splice-region, non-coding gene) so no HGVSp can exist. For the no-HGVSp case the response `details` carries `gene`, `transcriptId`, `hgvsc`, `consequence`, `notation` and `assembly` where known — keys with no value are omitted, so `details` may be absent (a consequence with protein-altering terms and no HGVSp is reported as an annotation gap, never as proof the protein is unaffected). MissenseResolve models single amino-acid substitutions only.
  - `422 ISOFORM_NUMBERING_MISMATCH`: The resolved notation is numbered on a non-canonical UniProt isoform and no canonically-numbered transcript reports the same substitution (or the canonically-numbered transcripts disagree on its position), so no structure can be modelled for it. `details` carries `gene`, `hgvsp`, `transcriptId`, `isoform`, `uniprotId`, `reason`, `notation` and `assembly`; re-enter the substitution in canonical numbering, or — a route that works from this refusal — qualify it with the protein it is numbered on (`Q5TA45-5:p.Arg23Leu`), which is mapped onto the canonical sequence by the accession-qualified notation path above.
  - `422 AMBIGUOUS_PROTEIN_NUMBERING`: A protein substitution whose residue is equally consistent with two numberings *at different canonical positions* — the wild-type letter coincides across an isoform offset, which the analysis route raises for a BARE notation (a MANE-numbered report and the canonical sequence read the same number differently). `details.candidates` lists the readings as OBJECTS — `{ variant, basisId, basisKind, canonicalPosition, label }` — where `variant` is already expressed in canonical numbering. Ambiguity is never resolved by choosing one, so the caller decides and says so: submit a candidate's `variant` (the isoform reading needs nothing more), or re-submit the SAME notation with `numberingBasis: "canonical"` to record that these numbers are canonical numbering. That confirmation is honoured only on the match path and is reported back as `numberingDisambiguated: true`, so a report can distinguish a chosen numbering from a derived one. Without it the canonical reading is unselectable: the re-submitted string is identical, so the refusal would repeat.
  - `422 UNPROCESSABLE_ENTITY` (protein notation): the accession is unknown to UniProt's **reviewed human** set, the numbering basis cannot be established (no isoform stated, or none matching), the declared protein does not carry the stated wild-type residue at that position, or the position cannot be anchored uniquely. `details` carries `accession`, `notation` and `reason`; a provider outage is a `503` instead, never this. The **analysis** endpoints refuse this notation family outright (`422`), directing callers here: they resolve protein input by residue index against the canonical sequence, which would silently apply an isoform-numbered position to a different residue.
  - `422 COORDINATE_REFERENCE_MISMATCH`: A provider answered that the submitted **REF allele does not match its reference sequence at that position** — so no transcript consequence can exist. This is a statement about the *coordinate*, not about the provider (it answered, and its answer is usable), and the usual cause is a **genome-build mismatch**: the same locus has a different reference base in GRCh37 and GRCh38, so a coordinate from the other build looks exactly like a typo. The response carries `details.buildHint`:
    ```json
    {
      "error": {
        "code": "COORDINATE_REFERENCE_MISMATCH",
        "message": "The reference allele does not match the reference sequence at that position on the genome build the coordinate was read against …",
        "details": {
          "buildHint": {
            "assembly": "GRCh37",
            "triedAssembly": "GRCh38",
            "notation": "Chr1(GRCh37):g.1256452C>A",
            "reason": "the reference allele matched no reference base on GRCh38 at that position, and the same locus is spelled differently on GRCh37"
          },
          "assembly": "GRCh38",
          "resolvedAssembly": "GRCh38",
          "coordinateLift": { "status": "not-needed", "fromAssembly": "GRCh38", "toAssembly": "GRCh38" }
        }
      }
    }
    ```
    `buildHint.notation` is the **same coordinate annotated with the other build**, composed by the server, so retrying is a resubmit that *states* its build rather than assuming one — the UI offers it as one click beside the refusal. It is **verified before it is offered**: the route checks that the other build carries the submitted allele at that position (the same sequence check the lift performs), so a position that exists in neither build — or one whose allele matches nothing — is not dressed up as a remedy. When no offer can be verified, `buildHint` is absent and the refusal's **message says why**, because the sentence a reader needs differs per case:
    - neither build carries the allele → check the position and the REF/ALT alleles;
    - the build already read against carries it → the build is not what disagrees;
    - the coordinate was verified against the other build first (a lift was used) → there is no untried build;
    - cDNA → a `c.` position names no assembly base to check, so the message states the transcript-level remedy (`NM_000277.5(GRCh37):c.…`) instead of offering an unverified spelling.
    That verification is also why a retry cannot loop: the offered build is the one that carries the submitted allele, so annotating there cannot reproduce the same mismatch at that position — and the "both builds carry it" case, where a ping-pong would otherwise be endless, is withheld. `triedAssembly` names the build the coordinate was read against, so the refusal says what happened and not only what to try. **No `Retry-After` is sent**: the same coordinate is refused identically, so unlike a `502`/`503` the client must not re-run the ladder.
  - `404 NOT_FOUND`: No reference provider produced any transcript consequence for the coordinate (unknown coordinate or wrong genome build); the message also names the non-coding possibility.
  - `502 BAD_GATEWAY`: A provider returned a malformed or structurally unusable response.
  - `503 TRANSLATION_UNAVAILABLE`: Every provider was unreachable or failed to answer in time. Sent with **`Retry-After: 60`**; the message tells the clinician to enter the protein-level substitution directly, which skips coordinate translation entirely. Clients should **return** this response rather than retrying inside the request: the advertised cooldown outlasts any interactive budget (the client utility does exactly that for any `Retry-After` above 2s).
  - `504 TIMEOUT`: The coordinate-translation call was aborted by the caller (client disconnect).

### 7. Sequence Fetcher
* **Route**: `GET /api/v1/sequence/:uniprotId`
* **Auth**: 🔒 (Bearer Token)
* **Description**: Fetches canonical FASTA sequence for the given UniProt accession.
* **Error Codes**:
  - `424 SEQUENCE_UNAVAILABLE`: Returned if the sequence fetch fails and no preset sequence is found in the local database.

### 8. Binding Pocket Finder
* **Route**: `POST /api/v1/pocket-finder`
* **Auth**: 🔒 (Bearer Token)
* **Request Body**: (JSON containing PDB text)
  ```json
  {
    "pdbText": "ATOM      1  CA...",
    "targetIndex": 408
  }
  ```
* **Description**: Runs P2Rank machine learning predictions on coordinates to detect ligand-binding pocket proximity. Follows a strict No-Heuristics Policy: returns ML-detected pockets or explicit `none_detected`/`unavailable` status. No heuristic approximations are permitted.

### 9. Nearest Residues
* **Route**: `POST /api/v1/nearest-residues`
* **Auth**: 🔒 (Bearer Token)
* **Request Body**:
  ```json
  {
    "pdbText": "ATOM      1  CA...",
    "targetIndex": 408,
    "n": 5
  }
  ```
* **Description**: Computes the N nearest residues to the target residue by true Euclidean C-alpha distance from the coordinate file.
* **Response**:
  ```json
  {
    "residues": [
      { "index": 407, "name": "ASP", "distance": 3.8, "properties": "Acidic", "role": "Stabilizing", "classBadge": "bg-rose-500" }
    ],
    "source": "computed"
  }
  ```

### 10. Resolve Gene Accessions
* **Route**: `POST /api/v1/resolve-gene`
* **Auth**: 🔒 (Bearer Token)
* **Request Body**:
  ```json
  {
    "gene": "PAH"
  }
  ```
* **Description**: Resolves HGNC gene symbols to canonical UniProt accessions using local mapping dictionaries.

### 11. AlphaFold PDB Proxy
* **Route**: `GET /api/v1/alphafold-pdb/:uniprotId`
* **Auth**: 🔒 (Bearer Token)
* **Description**: Proxies coordinate fetching for AlphaFold models from the EMBL-EBI CDN to bypass browser cross-origin constraints.

### 12. Submit Biophysical Stability Job
* **Routes**: 
  - `POST /api/v1/dynamut2-submit`
  - `POST /api/v1/ddmut-submit`
  - `POST /api/v1/thermompnn-submit`
* **Auth**: 🔒 (Bearer Token)
* **Request Body**: (JSON payload containing mutation coordinates and parameters)
* **Description**: Starts an asynchronous stability job via remote server request and returns a tracking `jobId` immediately.

### 13. Poll Biophysical Stability Job
* **Routes**: 
  - `GET /api/v1/dynamut2-job/:jobId`
  - `GET /api/v1/ddmut-job/:jobId`
  - `GET /api/v1/thermompnn-job/:jobId`
* **Auth**: 🔒 (Bearer Token)
* **Description**: Retrieves current simulation execution progress. Once complete, returns stability change values (ddG) and status values.

### 14. ESMfold & ESM3 Structure Validation
* **Routes**:
  - `POST /api/v1/esmfold` (Predict structures from primary sequence using ESMFold)
  - `POST /api/v1/esm3-structure-eval` (Evaluate 3D templates with remote ESM3 models)
  - `POST /api/v1/validate-biohub-token` (Check status of the BioHub API token)
* **Auth**: 🔒 (Bearer Token)
* **Description**: Interface modules to evaluate remote language model predictions and generate structures.

### 15. Structural Diff & Superposition
* **Routes**:
  - `POST /api/v1/structural-diff` (Align wt/mutant Cα atoms and compute local RMSD displacements)
  - `POST /api/v1/structural-align` (Superimpose two arbitrary structure coordinate files using Kabsch's SVD algorithm)
* **Auth**: 🔒 (Bearer Token)
* **Description**: High-performance alignment pipelines utilizing Singular Value Decomposition to map conformational shifts.

### 16. Server Diagnostics
* **Route**: `GET /api/v1/diagnostics`
* **Auth**: None
* **Description**: Provides runtime statistics, sidecar availability checks, FoldX local build state, and process memory configurations.

