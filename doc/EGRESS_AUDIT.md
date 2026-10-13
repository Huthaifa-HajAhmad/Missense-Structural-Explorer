# Egress audit: outbound calls and their caches

Date: 2026-10-09
Branch: feat/compute-routing
Worktree: `C:\Users\HSA19\antigravity\mse-compute-routing`

This file is the output of the I2 cache audit in `doc/COMPUTE_ROUTING_PLAN.md` (section 7, WP-I2, and section 3 item 12). It lists every outbound call from `server/` to a remote provider. For each call it records what is cached, under which key, for how long, whether identical concurrent calls share one upstream request, whether failures are cached, and which credential is used. It was produced by reading the code only. No code was changed.

File:line references are to the worktree as it stood on this date. Test files are excluded.

## 1. Summary

Counts (server TypeScript, tests excluded):

- `fetchWithRetry(` call lines: 65. Of these, 58 are remote calls (section 4) and 7 are health checks (section 6).
- Raw `fetch(` call lines: 58, including the raw call inside the Genos wrapper (`genos_web.ts:52`). Of these, 39 are remote calls to migrate (section 5) and 19 are loopback sidecar, health, deployment-control or remote connection tests (section 6).
- Other transports, which are not `fetch` and so are invisible to a `fetch(` ratchet: 17 call sites. These are Gemini SDK (5), gRPC (3), `node:https` (2), `genosFetch` wrapper call sites (6) and `@gmod/tabix` range reads (1). See section 4.
- Remote call sites covered by the tables: 114 (58 `fetchWithRetry`, 39 raw `fetch`, 17 other transports), in 112 call-site rows. Row 25 covers three `fetchWithRetry` sites. Row 72 is a cache wrapper and is not a call site.
- Cache status of the 97 remote fetch rows (58 `fetchWithRetry` + 39 raw): 84 cached, either directly or by an enclosing cache; 12 uncached; 1 unknown.
- Plan discrepancies. Section 3 item 12 says 29 files call `fetchWithRetry` and about 26 call raw `fetch`. The code has 27 files (excluding `http-client.ts`) and 58 raw lines. Section 3 item 12 and WP-I3 also say a 429 does not count toward the circuit breaker. The code counts it (`http-client.ts:375`, see finding 6).

### Ranked findings

1. **The server's AlphaGenome key is sent to a URL the request chooses.** When a request sends `x-alphagenome-url` (or `alphagenomeApiUrl`) and no AlphaGenome key, the server sends `Authorization: Bearer <ALPHAGENOME_API_KEY>` to that URL. The fallback to the env key is at `routes/variant/alphagenome.ts:21-33`, `services/external-api/alphagenome-bridge.ts:121-122`, and `routes/variant/variant-parser.ts:558-559`. The send is at `alphagenome-bridge.ts:241-246` and `:486-490`. The GPN path has a guard for this case (`variant-parser.ts:546-556`); the AlphaGenome path has none. A successful answer from that URL is then cached for 30 days under a key with no endpoint in it (`alphagenome-bridge.ts:306`, `:34-36`), so every user gets it.
2. **Credentials and credential hashes appear in cache keys or change answers without appearing in the key.** The Gemini routes build `biophysical_..._key:${keyHash}` and `clinical_..._key:${keyHash}` where `keyHash = sha256(activeApiKey)` (`routes/biophysics/generation.ts:166-171`, `routes/variant/narrative.ts:224`, `:252`). Those results are therefore never shared between users. The conservation payload is cached for 14 days under a key with no GPN token or endpoint in it, but its GPN result depends on whether the caller has an HF token (`services/prediction/predictors/conservation-orchestrator.ts:171`, `:178`, `:971-975`). The AlphaGenome key (`alphagenome-bridge.ts:125`) has the same gap, see finding 1.
3. **Failed upstream answers are cached as "absent" for 7 days.** `transcript-resolver.ts:39-42` and `:104-107` cache `{refseqId:null, ensemblId:null}` for 7 days on any non-OK response or thrown error. `popeve-resolver.ts:78-81` and `:96-99` cache `null` in `refseqCache` for 7 days on the same conditions. Both caches are in-process only.
4. **An empty 200 body is cached for 30 days.** `uniprot.ts:662-672` (`fetchUniprotSequence`) has no `shouldCache`, so a 200 with an empty body caches `""` in L1 and L2 for 30 days. `uniprot.ts:626-646` (`fetchDisplayedIsoformId`) has the same gap, so a 200 without the alternative-products comment caches `{isoformId:null}` for 30 days. The isoform fetcher (`uniprot.ts:369-373`) already documents why this is wrong.
5. **Expensive submits have no cross-user dedupe and no result cache.** DynaMut2 and DDMut submits (`stability/dynamut.ts:200`) are not cached at this layer and are not single-flight. The same holds for Tamarind ThermoMPNN submits (`energy-models.ts:650`), SpliceAI (`spliceai_broad.ts:307`), and JapanFold ESMC, ESMFold-2 and SaProt (`japanfold-client.ts:88`, `:149`, `:244`). Two users who ask for the same mutation at the same time cause two upstream calls.
6. **Raw `fetch` and other transports bypass the host semaphore and breaker.** 39 raw `fetch` sites, the Genos wrapper, gRPC, `node:https` and the Tabix reader do not go through `fetchWithRetry`. They get no per-host semaphore, no circuit breaker, no retry and no deadline. Separately, `http-client.ts:375` records a breaker failure for every 429 or 5xx that ends a call, so 429s count toward the breaker. WP-I3 assumes they do not.
7. **A provider API key is written to logs.** ClinVar sends `api_key` as a URL query parameter (`clinvar.ts:100-102`). `http-client.ts:338` and `:371` log the full URL on every retry, and `:379-383` puts it in the thrown error message.
8. **Public endpoints fire outbound calls.** `/health` and `/capabilities` are in `PUBLIC_ENDPOINTS` (`routes/state.ts:51`, `:65`). `/capabilities` sends a JapanFold probe on every request with no cache (`routes/capabilities.ts:156-170`). `checkAllHealth` has a 15 s cache (`routes/health.ts:140`).
9. **Smaller defects.** The lift L1 TTL is wrong. It is `ttl: LIFT_TTL_SECONDS / 1000`, which is about 5 minutes, not 10 years (`liftover.ts:48-51`). The L2 entry is correct. The exon single-flight returns an in-flight result without checking `requireCds` (`splice_resolver.ts:228-230`). The landscape result is written to a 30-day cache after a silent UniProt sequence failure (`landscape.ts:174-182`, `:279`). The gnomAD fetcher returns `null` for any error (`gnomad.ts:197-199`), so callers cannot tell a failure from an absent variant.
10. **Most caches are in-process only.** About 25 module-level LRUs and Maps (section 3.3) hold data for hours to 30 days and lose it on restart or blue/green handover. Only the registry caches reach the `external_cache` table.

## 2. Method

- Call sites: `grep -rn "fetchWithRetry("`, `grep -rn "(^|[^A-Za-z_.])fetch\("`, and searches for `genosFetch(`, `httpGetWithBody(`, `withHostLock(`, `TabixIndexedFile(`, `client.` gRPC calls, and `@google/genai` calls. Comment-only lines and method definitions were filtered out.
- Caches: `grep` for `getCachedOrFetch`, `singleFlight`, `registerCache`, `external_cache`, `saveExternalCacheAsync`, `new LRUCache`, `new Map`, `ttl`, `TTL`, and `ttlSeconds`.
- Every row was checked against the file it cites. Where a value was not read, the row says so.

## 3. Cache and transport layer (read from code)

### 3.1 `fetchWithRetry` (`services/infra/http-client.ts`)

- Signature `fetchWithRetry(url, options, retries = 3, delay = 1000)` (`:213`). No user or credential awareness.
- Per-host `Semaphore(5)` (`:133-139`). It is acquired before the retry loop and released after it (`:223`, `:387`), so a call holds its slot through every backoff sleep.
- Per-host `CircuitBreaker(5, 60000)` (`:108`, `:105-112`). The gate is `if (!probe && !breaker.canExecute())` (`:228`). `probe: true` skips both the gate and the accounting (`:183-192`, `:344`, `:365`, `:375`).
- A 429 or 5xx is retried with jittered backoff, unless it is a fast refusal under 1 s and `Retry-After` does not fit (`:282-333`). A `Retry-After` value is clamped to 50 ms to 10 s (`:24`, `:32`, `:305`).
- After the loop, `if (!probe) breaker.recordFailure();` runs for any call that did not return a response (`:375`). A 429 or 5xx that ends the call therefore counts as one breaker failure.
- The `cappedByCaller` exemption applies only to a timeout the caller imposed (`:362-365`).
- Default `User-Agent` is set on every call (`:51-52`, `:276`).
- Transport is `fetch` at `:273`.

### 3.2 `getCachedOrFetch` (`services/infra/cache-registry.ts`, `cache.ts`)

- Order: L1 LRU check (`:197-200`), then the L2 `external_cache` table (`:203-220`), then `singleFlight(key, fetcher)` (`:223`).
- A value is written to L1 and L2 when `shouldCache(result)` is true. The default is `result !== null && result !== undefined` (`:227`). A `null` from the fetcher is therefore never cached unless `shouldCache` says so, but `""`, `[]` and `{isoformId: null}` are cached by default.
- `singleFlight` is keyed by the cache key only (`:175-185`). It holds no user or credential identity. The first caller's fetcher runs and later callers share its promise. If the fetcher captures the first caller's `AbortSignal`, a cancellation by that caller fails every follower. Several UniProt and coordinate fetchers capture the signal this way.
- L2 writes use `ttlSeconds`. When it is absent, `expires_at` is `NULL` and the row never expires (`services/infra/analysis-db-core.ts:352`). Reads return only rows with `expires_at IS NULL OR expires_at > now` (`analysis-db-core.ts:377-380`).
- No stale-serve path exists. The read filter drops expired rows, so I2 stale-on-rate-limit has no hook yet.

### 3.3 Caches outside the registry (in-process only)

These do not reach `external_cache`. They are lost on restart.

- `pdbe-entries.ts` `jsonCache` (7 d), `pdbCache` (24 h).
- `pdbe-interfaces.ts` `cache` (7 d), `fibrilCache`, `crystalCache`, `speciesCache` (30 d each).
- `intact.ts` `cache` (7 d).
- `string.ts` `partnerListCache` (14 d).
- `transcript-resolver.ts` `transcriptMappingCache` (7 d).
- `popeve-resolver.ts` uses registry `refseqCache` (7 d) and `popEveOnlineCache` (24 h).
- `landscape-context.ts` `cache` Map (24 h).
- `landscape.ts` `myVariantVersion` (24 h) and the landscape L1 (24 h) and its own SQLite file `data/landscape_cache.sqlite` (30 d).
- `sequence-aligner.ts` `siftsEntryCache` Map (1 h).
- Evidence-context: `pext`, `hpo`, `hpa`, `gtex`, `alignment`, `modelOrganisms`, `modelPhenotypes` (24 h each, keyed by gene), `modelPhenotypes` `uphenoCache` (7 d), `clingenDosage` (24 h), `allianceRelease` (6 h or 5 min).
- `japanfold-client.ts` `japanFoldCache` (14 d) and `pendingBoltzJobs` (6 h). `japanfold.ts` `japanfoldCache` (12 h).
- `esmfold.ts` `esmfoldCache` (no TTL, 100 MB).
- `esm3_forge.ts` `esm3StructureCache` (24 h).
- `alphagenome-bridge.ts` `alphagenomeCache` and `alphagenomeRegionCache` (30 d).
- `spliceai_broad.ts` `spliceAiCache` (30 d positive, 60 s negative).
- `ddmut-ppi.ts` `ppiResultCache` (24 h).
- `energy-models.ts` `thermompnnCache` (no TTL, 200 entries).
- `genos_web.ts` `genosResultCache` Map (10 min).
- `structure-fetcher.ts` uses `pdbCache` with no TTL (100 MB).

### 3.4 Non-`fetch` transports

- Gemini: `@google/genai` (`services/llm/gemini.ts`). Client cache `geminiClientCache` is an LRU with a 15-minute TTL (`gemini.ts:26-29`). Its key was not read.
- gRPC: `@grpc/grpc-js` to `gdmscience.googleapis.com:443` (`services/external-api/alphagenome-client.ts:97`, `:172`). Metadata `x-goog-api-key` (`:216`). No host semaphore or breaker is applied (`withHostLock` is not used in this file).
- `node:https`: `httpGetWithBody` (`services/stability/dynamut.ts:43`), wrapped in `withHostLock` at the poll call sites (`dynamut.ts:287`, `ddmut-ppi.ts:160`). No retry.
- `@gmod/tabix`: `TabixIndexedFile` over Hugging Face (`services/external-api/gpn.ts:28-31`, `getLines` at `:140`). The library makes its own range requests. Neither `fetchWithRetry` nor the host semaphore applies. Whether the library uses global `fetch` was not verified.

## 4. Remote call sites, by provider

Column key:

- **Method**: `fWR` is `fetchWithRetry`. `raw` is `fetch`. Other values name the transport.
- **Cached**: mechanism. `reg` means `getCachedOrFetch`. `mem` means a module-level LRU or Map. `enc` means the call is inside a function whose result is cached by the named cache. `none` means no cache.
- **Key**: quoted from code where it is built in the same function. The source file and line are given.
- **User in key**: `YES` marks a flagged row.
- **TTL**: value and source.
- **Single-flight**: `yes (reg)` means the registry's `singleFlight`. `no` means nothing dedupes concurrent calls.
- **Negative**: what is cached when the call fails or returns nothing.
- **Credential**: `none`, or the env name or request header.

### 4.1 ClinVar (NCBI E-utilities), 2 rows

| # | File:line | Method | Cached | Key (quoted) | User in key | TTL | Single-flight | Negative caching | Credential |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `external-api/clinvar.ts:104` (esearch) | fWR | reg; L1 `clinvarCache`, L2 | `buildClinvarKey`: `clinvar_${normGene}_${cleanVar}${notStr}_condition-xrefs1_schema:${CACHE_SCHEMA_VERSION}` (`cache-keys.ts:61`) | no | L2 `ttlSeconds: 7*24*60*60` (`clinvar.ts:77`); L1 `ttl: 1h` (`cache-registry.ts:87-90`) | yes (reg) | Not-found (`uid: null`) is not cached (`clinvar.ts:79`). Empty esearch idlist is put in L1 for 5 min (`:116`). Errors throw and are not cached. | `NCBI_API_KEY` (optional) in URL as `api_key` (`:100-102`); see finding 7 |
| 2 | `external-api/clinvar.ts:121` (esummary) | fWR | enc (row 1) | same | no | same | yes (reg) | same | same as row 1 |

### 4.2 gnomAD, 3 rows

| # | File:line | Method | Cached | Key (quoted) | User in key | TTL | Single-flight | Negative caching | Credential |
|---|---|---|---|---|---|---|---|---|---|
| 3 | `external-api/gnomad.ts:95` (GraphQL, `variant`) | fWR | reg; L1 `gnomadFreqCache` | `buildGnomadFreqKey`: `gnomad_freq_${clean}_${assembly ?? "unknown"}_schema:${CACHE_SCHEMA_VERSION}` (`cache-keys.ts:53`) | no | L2 `14*24*60*60` (`gnomad.ts:61`); L1 `24h` (`cache-registry.ts:127-130`) | yes (reg) | Fetcher returns `null` on any error (`gnomad.ts:197-199`), and `null` is not cached by default. Callers cannot tell failure from absence. | none |
| 4 | `services/prediction/landscape-context.ts:62` (`gnomadQuery`, three queries) | fWR (2 tries) | mem `cache` Map, keyed `gene` (`:115-116`) | `gene = normalizeGeneSymbol(geneSymbol).toUpperCase()` | no | `TTL_MS = 24h` (`:43`) | no | Stored only when no source failed (`:224-229`). No negative caching. | none |
| 5 | `external-api/pext.ts:19` (gnomAD GraphQL, `pext`) | raw | mem LRU `cache`, keyed `gene` (`:14-15`) | `cache.get(gene)` | no | `24h` (`pext.ts:10`) | yes (`flights` Map keyed `gene`, `:11`) | `not-found` is returned without caching (`:20-29`). Errors not cached. | none |

### 4.3 UniProt (`rest.uniprot.org`), 14 rows

| # | File:line | Method | Cached | Key (quoted) | User in key | TTL | Single-flight | Negative caching | Credential |
|---|---|---|---|---|---|---|---|---|---|
| 6 | `external-api/uniprot.ts:70` (gene search) | fWR | reg; L1 `uniprotCache` | `buildUniprotIdKey`: `uniprot_id_${normGene}_schema:${CACHE_SCHEMA_VERSION}` (`cache-keys.ts:112`) | no | L2 `30*24*60*60` (`uniprot.ts:64`) | yes (reg) | Every failure and "no hit" returns `null` (`:74-86`), which is not cached. | none |
| 7 | `uniprot.ts:157` (entry name to accession) | fWR (1 try) | reg; L1 `uniprotEntryNameCache` | `buildUniprotEntryNameKey`: `uniprot_entry_name_${entryName}_schema:${CACHE_SCHEMA_VERSION}` (`cache-keys.ts:244`) | no | L2 30 d (`uniprot.ts:145`); L1 30 d immutable (`:109-111`) | yes (reg); fetcher captures first caller's `signal` (`:163`) | 400 or 404 caches `{accession:null}` for 30 d (`:170`), treated as definitive. Other non-OK throws. | none |
| 8 | `uniprot.ts:271` (entry reference: symbols, Ensembl xrefs) | fWR (1 try) | reg; L1 `uniprotEntryReferenceCache` | `buildUniprotEntryReferenceKey`: `uniprot_entry_reference_${uniprotId}_schema:${CACHE_SCHEMA_VERSION}` (`cache-keys.ts:261`) | no | L2 30 d (`uniprot.ts:263`) | yes (reg); captures `signal` | `shouldCache` non-empty (`:269`). 400/404 gives empty data, not cached. Other non-OK throws. | none |
| 9 | `uniprot.ts:382` (isoform FASTA via `stream`) | fWR (default retries) | reg; L1 `uniprotIsoformsCache` | `buildUniprotIsoformKey`: `uniprot_isoforms_${uniprotId}_schema:${CACHE_SCHEMA_VERSION}` (`cache-keys.ts:232`) | no | L2 30 d (`uniprot.ts:367`) | yes (reg); captures `signal` | `shouldCache` needs at least one isoform (`:372`). Zero records throws (`:407-411`). | none |
| 10 | `uniprot.ts:487` (RefSeq protein to UniProt) | fWR (1 try) | reg; L1 `refSeqProteinCache` | `buildRefSeqProteinKey`: `refseq_protein_${key}_schema:${CACHE_SCHEMA_VERSION}` (`cache-keys.ts:221`) | no | L2 30 d (`uniprot.ts:478`) | yes (reg); captures `signal` | Caches `absent` only (`:481`). 400/404 gives `absent` (`:494-497`). Others throw. | none |
| 11 | `uniprot.ts:565` (MANE-Select) | fWR | reg; L1 `uniprotIsoformsCache` | `buildManeIsoformKey`: `uniprot_mane_isoform_${uniprotId}_schema:${CACHE_SCHEMA_VERSION}` (`cache-keys.ts:249`) | no | L2 30 d (`uniprot.ts:554`) | yes (reg); captures `signal` | `shouldCache`: MANE found or `entryConfirmed` (`:559`). Non-OK throws. | none |
| 12 | `uniprot.ts:626` (displayed isoform) | fWR | reg; L1 `uniprotIsoformsCache` | `buildDisplayedIsoformKey`: `uniprot_displayed_isoform_${uniprotId}_schema:${CACHE_SCHEMA_VERSION}` (`cache-keys.ts:266`) | no | L2 30 d (`uniprot.ts:623`) | yes (reg); captures `signal` | **No `shouldCache`** (`:619-646`). A 200 without the alternative-products comment caches `{isoformId:null}` for 30 d. Non-OK throws. | none |
| 13 | `uniprot.ts:662` (sequence FASTA) | fWR | reg; L1 `uniprotSeqCache` (no TTL, `:330`) | `buildUniprotSequenceKey`: `uniprot_seq_${key}_schema:${CACHE_SCHEMA_VERSION}` (`cache-keys.ts:107`) | no | L2 30 d (`uniprot.ts:658`) | yes (reg); does not pass `signal` | **No `shouldCache`** (`:654-672`). A 200 with an empty body returns `""`, which is cached in L1 and L2 for 30 d. Non-OK throws. | none |
| 14 | `uniprot.ts:793` (InterPro entry types) | fWR (1 try, `probe: true`) | enc (row 16, features) | n/a | no | n/a | n/a | Folded into features cache only when `entryTypesStatus` is not `error` (`:878-881`). `probe: true` skips the breaker gate and accounting (`:795`). | none |
| 15 | `uniprot.ts:828` (UniParc) | fWR (1 try) | enc (row 16, features) | n/a | no | n/a | n/a | Folded into features; `domainMatchesStatus: "error"` is not cached (`:878-881`). | none |
| 16 | `uniprot.ts:896` (entry JSON for features) | fWR (2 tries) | reg; L1 `uniprotFeaturesCache` | `buildUniprotFeaturesKey`: `uniprot_features_${clean}_subunit2_fd2_schema:${CACHE_SCHEMA_VERSION}` (`cache-keys.ts:102`) | no | L2 14 d (`uniprot.ts:876`); L1 3 d (`cache-registry.ts:137-140`) | yes (reg); does not pass caller `signal` | `shouldCache` excludes `null` and `status: error` (`:881`). Failures return `null` (`:906-909`, `:1070-1073`). | none |
| 17 | `services/prediction/predictors/transcript-resolver.ts:39` (UniProt by accession or gene search) | fWR | mem LRU `transcriptMappingCache` | raw input: `proteinOrGene.trim()` (`:29`) | no | **7 d** (`transcript-resolver.ts:20-23`) | no | **Any non-OK (`:40-44`) or thrown error (`:104-108`) stores `{refseqId:null, ensemblId:null}` for 7 d.** | none |
| 18 | `services/prediction/predictors/popeve-resolver.ts:78` (RefSeq for popEVE) | fWR | registry LRU `refseqCache` (`cache-registry.ts:122-125`) | raw input `cleanInput` (`popeve-resolver.ts:68-69`) | no | **7 d** (`cache-registry.ts:122-125`) | no | **Non-OK (`:80-81`) or thrown error (`:98-99`) stores `null` for 7 d.** | none |
| 19 | `services/llm/curated-literature.ts:200` (UniProt entry for curated citations) | fWR | reg; L1 `curatedVariantCitationsCache`, `bypassSqlite: true` | `curated-variant/v1::${cleanGene}::${accession}::${wildType}${position}${alternate}` (`curated-literature.ts:338`, key built at `:336-337`) | no | L1 `CURATED_CITATIONS_TTL_MS` = 24 h (`curated-literature.ts:71`, `:73-76`) | yes (reg) | `state: error` is not cached (`:336`). 400/404 gives `unavailable` and is cached (`:216-217`). | none |

The UniProt group has 14 rows (rows 6 to 19). Rows 14 and 15 are enrichment calls folded into the features cache (row 16).

### 4.4 PDBe, RCSB, AlphaFold DB and SIFTS, 14 rows

| # | File:line | Method | Cached | Key (quoted) | User in key | TTL | Single-flight | Negative caching | Credential |
|---|---|---|---|---|---|---|---|---|---|
| 20 | `external-api/pdbe-entries.ts:32` (`getJson`: experiment, SIFTS, residue listing) | fWR | mem `jsonCache` | full URL (`:29`, `:35`) | no | 7 d (`pdbe-entries.ts:20`) | no | Non-OK returns `null` and is not stored (`:33`). | none |
| 21 | `pdbe-entries.ts:108` (RCSB `.pdb` download) | fWR | mem `pdbCache` | `id = pdbId.toUpperCase()` (`:104`) | no | 24 h (`:25`) | no | Non-OK or non-ATOM returns `null` and is not stored (`:109-112`). | none |
| 22 | `external-api/pdbe-interfaces.ts:242` (RCSB GraphQL, entries and assemblies) | fWR (2 tries) | mem `fibrilCache`, `crystalCache` | lower-case entry ids (`:247-260`) | no | 30 d each (`pdbe-interfaces.ts:95`, `:97`) | no | A 200 that omits an id stores `false` for 30 d (`:249`, `:260`). Errors return `null`, not stored. | none |
| 23 | `pdbe-interfaces.ts:277` (UniProt species, batch of up to 100) | fWR (2 tries) | mem `speciesCache` | accession (`:288`) | no | 30 d (`:98`) | no | Only returned rows are stored. Non-OK returns. | none |
| 24 | `pdbe-interfaces.ts:346` (PDBe `interface_residues`) | fWR | mem `cache`, keyed `accession` (`:342`) | UniProt accession (`:338`) | no | 7 d (`:93`) | no | 404 stores `none` for 7 d (`:350-353`). An empty parse also stores `none` for 7 d (`:359-362`). Result stored only when entry kinds were checked (`:381`). | none |
| 25 | `services/structure/structure-fetcher.ts:49` (cached AF URL), `:66` (AF API), `:112` (AF candidate files) | fWR | singleFlightPdb into `pdbCache` (no TTL); URL memo `afUrlCache` (24 h) | `af_pdb_${validatedUniprot}` (`:43`) | no | `pdbCache`: none. `afUrlCache`: 24 h (`cache-registry.ts`) | yes (`singleFlight`) | API 404 returns `null` and is not cached (`:75`). Candidate failures are skipped. Up to five candidate URLs are tried per call (`:99-125`). | none |
| 26 | `structure-fetcher.ts:166` (PDBe `best_structures`) | fWR | reg-like: `bestPdbCache` (LRU, 24 h default, `cache-registry.ts:78-81`) with per-write TTL | `${validatedUniprot}:${pos ?? "any"}` (`:159`) | no | Non-OK: **5 min** (`:172`). Body without array: **1 h** (`:178`). No suitable structure: **1 h** (`:200`). Mapping: 24 h (`:197`). | no | **Non-OK (a 429 or 5xx that survives retries) is cached as `null` for 5 min** (`:170-173`). | none |
| 27 | `structure-fetcher.ts:285` (RCSB full entry) | fWR | singleFlightPdb into `pdbCache` | `pdb_full_${upper.toLowerCase()}` (`:279`) | no | none (`pdbCache`) | yes (`singleFlight`) | Non-OK returns `null` (`:288`); not stored. | none |
| 28 | `structure-fetcher.ts:410` (RCSB PDB by id and chain) | fWR | singleFlightPdb into `pdbCache` | `pdb_rcsb_${id}_chain_${chain}_unp_${unpStart}_struct_${structStart}_pos_${pos}_acc_${...}` (`:404`) | no | none (`pdbCache`) | yes (`singleFlight`) | Non-OK returns `null`; not stored. | none |
| 29 | `structure-fetcher.ts:597` (RCSB search v2, homolog candidates) | fWR (1 try) | singleFlight; `pdbCache` and L2 `external_cache` | `raw_homologs_v3_${validatedUniprot}` (`:562`) | no | `pdbCache`: none. L2: `7*24*60*60` (`:778`). | yes (`singleFlight`, `:580`) | Non-OK returns `[]` (`:635-639`), not stored. Success stored at `:775-778`. | none |
| 30 | `structure-fetcher.ts:693` (RCSB GraphQL, metadata) | fWR (1 try) | enc (row 29) | enc (row 29) | no | enc | enc | GraphQL non-OK returns `[]` (`:706-709`), not stored. | none |
| 31 | `services/structure/sequence-aligner.ts:287` (SIFTS mapping) | fWR | mem Map `siftsEntryCache` | lower-case PDB id (`:275-281`) | no | **1 h** (`:272`) | no | 404 stores `null` for 1 h (`:288-290`), definitive. Non-OK returns `undefined`, not stored (`:293`). | none |


### 4.5 STRING and IntAct, 4 rows

| # | File:line | Method | Cached | Key (quoted) | User in key | TTL | Single-flight | Negative caching | Credential |
|---|---|---|---|---|---|---|---|---|---|
| 32 | `external-api/string.ts:69` (network) | fWR | reg; L1 `stringCache` | `buildStringKey`: `string_ppi_${normGene}_schema:${CACHE_SCHEMA_VERSION}` (`cache-keys.ts:165`) | no | L2 14 d (`string.ts:58`); L1 1 h (`cache-registry.ts:107-110`) | yes (reg) | Empty OK is put in L1 as `status: ok` for **5 min** (`:93`). Non-OK or thrown is put in L1 as `status: failed` for **5 min** (`:103`), so a 429 is cached briefly. Only non-empty OK goes to L2 (`:62-63`). | none |
| 33 | `string.ts:157` (`interaction_partners`, physical and functional) | fWR | mem `partnerListCache` | `normGene` (`:191-193`) | no | 14 d (`string.ts:149`) | no | Stored only when both lists are non-null (`:201`). | none |
| 34 | `string.ts:181` (version) | fWR | none | n/a | no | n/a | no | n/a | none |
| 35 | `external-api/intact.ts:67` (PSICQUIC) | fWR | mem `cache` | `accession.toUpperCase().replace(/-\d+$/, "")` (`:63`) | no | 7 d (`intact.ts:19`) | no | Non-OK and thrown are not stored (`:72`, `:78`). 200 with empty body is stored as an empty map (`:73-74`), which the source comment treats as definitive. | none |

### 4.6 Ensembl REST, VEP and the coordinate ladder, 6 rows

| # | File:line | Method | Cached | Key (quoted) | User in key | TTL | Single-flight | Negative caching | Credential |
|---|---|---|---|---|---|---|---|---|---|
| 36 | `services/prediction/splice_resolver.ts:257` (`lookup/id`) | fWR (1 try) | mem `exonCache` (LRU, no TTL, `:26`); L2 `exon:v2:${cleanId}` | `cleanId` (transcript id without version, `:216-217`) | no | L2 `90*86400` (`:313`); L1 none | yes (`inFlightExonFetches`, `:27-28`, `:228-231`) | Only successes are stored (`:308-310`). **The in-flight branch returns the existing promise without checking `requireCds`** (`:228-230`). | none |
| 37 | `splice_resolver.ts:68` (UCSC `track`) | fWR | enc (row 36) | enc | no | enc | enc | enc | none |
| 38 | `predictors/vep-orchestrator.ts:354` (Ensembl VEP, region) | fWR (1 try) | reg (predictor cache in `fetchPredictorData`, `vep-orchestrator.ts:666`) | `predictors_${normGene}_${cleanVar}${uId}${coordPart}_schema:${CACHE_SCHEMA_VERSION}` (`cache-keys.ts:138`) | no | L2 14 d (`vep-orchestrator.ts:670`); L1 1 h | yes (reg) | `shouldCache` and `isUsable` use `isUsablePredictorResult` (`:57-61`, `:680-681`). A fallback answer is stored when `policyVersion` matches, and `retryable` is set only when `canonicalBy === null` (`:617`). **A fallback answer obtained while VEP was failing is stored for 14 d if a canonical locus is known.** | none |
| 39 | `vep-orchestrator.ts:801` (Ensembl VEP, HGVS) | fWR | enc (row 38) | enc | no | enc | enc | enc | none |
| 40 | `services/translation/coordinate-resolver.ts:477` (Ensembl VEP consequence in ladder) | fWR | reg (coordinate cache) | `buildCoordinateTranslationKey`: `coord_translation_${assembly.toUpperCase()}_${normalizedNotation.trim().toLowerCase()}_schema:${CACHE_SCHEMA_VERSION}` (`cache-keys.ts:210`) | no | L2 `COORDINATE_TRANSLATION_TTL_SECONDS = 315_360_000` (10 y, `coordinate-resolver.ts:630`); L1 365 d (`:621-624`) | yes (reg); fetcher captures caller `signal` | `isCacheable` rejects protein-free and unverified numbering (`:642-647`). Failures are not stored. | none |
| 41 | `services/translation/liftover.ts:173` (Ensembl `map`) | fWR (1 try, `deadlineAt`) | reg (lift cache) | `buildCoordinateLiftKey`: `lift_${normChrom}:${pos}:${ref}>${alt}_${from}>${to}_schema:${CACHE_SCHEMA_VERSION}` (`cache-keys.ts:198`) | no | L2 `LIFT_TTL_SECONDS = 315_360_000` (`liftover.ts:46`). **L1 `ttl: LIFT_TTL_SECONDS / 1000` (`:48-51`) is 315,360 ms, about 5 min.** | yes (reg) | Refusals are thrown and never stored (`LiftRefused`, `:351-380`). | none |
| 42 | `liftover.ts:202` (Ensembl sequence region) | fWR (1 try) | enc (row 41) | enc | no | enc | enc | enc | none |

Row 43 is VariantValidator (section 4.7).

### 4.7 VariantValidator, 1 row

| # | File:line | Method | Cached | Key (quoted) | User in key | TTL | Single-flight | Negative caching | Credential |
|---|---|---|---|---|---|---|---|---|---|
| 43 | `services/translation/variant-validator.ts:289` (`variantvalidator`) | fWR | enc (row 40, coordinate cache) | enc | no | enc | enc | Not stored on failure; a rung failure is not cached. | none (keyless) |

### 4.8 MyVariant.info, dbNSFP, ConSurf, popEVE, UCSC and SpliceAI, 12 rows

| # | File:line | Method | Cached | Key (quoted) | User in key | TTL | Single-flight | Negative caching | Credential |
|---|---|---|---|---|---|---|---|---|---|
| 44 | `predictors/vep-orchestrator.ts:179` (MyVariant `hgvs` id) | fWR (1 try) | enc (row 38, predictor cache) | enc | no | enc | enc | enc (see row 38 caveat) | none |
| 45 | `vep-orchestrator.ts:491` (MyVariant query by protein change, fallback) | fWR (1 try) | enc (row 38) | enc | no | enc | enc | enc | none |
| 46 | `services/prediction/predictors/conservation-orchestrator.ts:470` (MyVariant dbNSFP query) | fWR | enc (row 72, conservation cache) | enc | no | enc | enc | Zero hits store `defaultRes` in L1 for 5 min (`:520`). | none |
| 47 | `services/prediction/landscape.ts:106` (MyVariant metadata, dbNSFP version) | fWR | mem variable `myVariantVersion` | none (one value) | no | **24 h** (`landscape.ts:101-118`) | no | Failure stores `value = null` for 24 h. Non-definitive failure cached (low impact, version label only). | none |
| 48 | `landscape.ts:142` (MyVariant query, window) | fWR | enc (landscape cache) | `${normGene}_${accessionKey}_${windowed ? `${startPos}_${endPos}` : "full"}_${CACHE_SCHEMA}` (`landscape.ts:202`) | no | L1 24 h (`cache-registry.ts:142-145`); SQLite `data/landscape_cache.sqlite` 30 d (`landscape.ts:26`) | no | Non-OK throws (`:143-144`), so no store. **The result is written at `:279` even when `loadReferenceSequence` failed silently (`:174-182`), so a transient UniProt failure is kept for 30 d.** | none |
| 49 | `services/prediction/predictors/dbnsfp-query.ts:28` (`query.dbnsfp.org`) | fWR | enc (row 72, conservation cache, called at `conservation-orchestrator.ts:415`) | enc | no | enc | enc | Non-OK returns `null` (`:38`). | none |
| 50 | `predictors/consurf-resolver.ts:9` (ConSurf chain selection) | fWR (1 try, 3 s) | enc (row 72); uncached in progressive path (`conservation-orchestrator.ts:781`) | none | no | enc | enc | Non-OK returns `null` (`:10`). | none |
| 51 | `consurf-resolver.ts:25` (ConSurf summary) | fWR (1 try, 3 s) | enc (row 72) | none | no | enc | enc | Non-OK returns `null` (`:26`). | none |
| 52 | `predictors/locus-resolver.ts:80` (UCSC `getData/sequence`, hg38) | fWR (1 try, 6 s) | enc: row 38 when called from `vep-orchestrator.ts:296`; uncached from `locus-resolver.ts:142` unless the caller caches | none | no | n/a | n/a | Failure returns a value with `failure` (`:85`). | none |
| 53 | `predictors/popeve-resolver.ts:116` (popEVE CSV, `data.evemodel.org`) | fWR (1 try, 3 s) | mem registry `popEveOnlineCache` (24 h default) | `${proteinOrGene}_${variant}` (`popeve-resolver.ts:104`) | no | 24 h (`cache-registry.ts:117-120`); negatives **5 min** (`popeve-resolver.ts:110-111`, `:117-118`); unparseable variant stored with no TTL (`:126`) | no | 5 min for a missing RefSeq and for non-OK (`:110-111`, `:117-118`). Unparseable variant stored for 24 h (`:126`). | none |
| 54 | `services/external-api/spliceai_broad.ts:307` (SpliceAI Lookup, Cloud Run) | fWR (1 try) | mem `spliceAiCache` | `["spliceai", assembly, contig, pos, ref, alt, distance, mask].join(":")` (`spliceai_broad.ts:218-227`) | no | positive **30 d** (`:77`); negative **60 s** (`:316`, `:388`) | no | **429 is stored as `rate-limited`, 5xx as `upstream-error`, timeout and network errors as `timeout` or `network`, all for 60 s** (`:316`, `:382-389`). Also 400 and 422 as `coordinate-rejected` (`:325`). | none (keyless) |


### 4.9 DynaMut2, DDMut and DDMut-PPI (UQ BioSig), 5 rows

| # | File:line | Method | Cached | Key (quoted) | User in key | TTL | Single-flight | Negative caching | Credential |
|---|---|---|---|---|---|---|---|---|---|
| 55 | `services/stability/dynamut.ts:200` (submit, DynaMut2 and DDMut) | fWR | none at this layer. The biophysics route caches the combined result under `biophysical_..._key:${keyHash}` (row 92) | none | no | n/a | no | n/a | none |
| 56 | `dynamut.ts:299` (poll) | fWR | none | none | no | n/a | no | n/a | none |
| 57 | `dynamut.ts:287` (poll, `node:https` inside `withHostLock`) | node:https | none | none | no | n/a | no | n/a | none |
| 58 | `services/stability/ddmut-ppi.ts:104` (submit) | fWR | mem `ppiResultCache` and in-flight Map | `ddmut_ppi:${hash}:${chain}:${mutationCode}` (`ddmut-ppi.ts:232`; `hash` = sha256 of PDB text, first 16 hex, `:231`) | no | 24 h (`ddmut-ppi.ts:42-44`) | yes (`inFlightPpiRequests`, `:238-241`) | Only `done` is stored (`:273`). | none |
| 59 | `ddmut-ppi.ts:160` (poll, `node:https` inside `withHostLock`) | node:https | enc (row 58) | enc | no | enc | enc | enc | none |

### 4.10 JapanFold (`api.japanfold.aiand.com`), 8 rows

| # | File:line | Method | Cached | Key (quoted) | User in key | TTL | Single-flight | Negative caching | Credential |
|---|---|---|---|---|---|---|---|---|---|
| 60 | `external-api/japanfold-client.ts:88` (`queryEsmc`) | raw | mem `japanFoldCache` | `japanfold:esmc:${seqHash}:${pos}:${wt}:${mut}` (`:78`) | no | 14 d (`:40-49`) | no | Failures return `null` and are not stored (`:103`, `:124-128`). | `CONFIG.services.japanfoldApiKey` (env `JAPANFOLD_API_KEY`, `config.ts:118`) as `Authorization` and `X-API-Key` (`:56-62`) |
| 61 | `japanfold-client.ts:149` (ESMFold-2 submit) | raw | mem `japanFoldCache` | `japanfold:esmfold2:${seqHash}` (`:139`) | no | 14 d | no | Failures not stored (`:213-219`). | JapanFold key (as row 60) |
| 62 | `japanfold-client.ts:183` (ESMFold-2 poll, `resultsUrl`) | raw | enc (row 61) | enc | no | enc | enc | enc | JapanFold key (as row 60), sent to the URL returned by the service |
| 63 | `japanfold-client.ts:244` (`querySaProt`) | raw | mem `japanFoldCache` | `japanfold:saprot:${seqHash}:${pos}:${wt}:${mut}` (`:234`) | no | 14 d | no | Failures not stored (`:283-287`). | JapanFold key (as row 60) |
| 64 | `japanfold-client.ts:390` (Boltz-2 submit, `submitBoltz2`) | raw | mem `japanFoldCache`; in-flight Map; `pendingBoltzJobs` | `japanfold:boltz2:${chainHash}` (`:439`); `chainHash = sha256(JSON.stringify(chains)).slice(0,16)` (`:438`) | no | result 14 d; pending job 6 h (`:315-318`) | yes (`inflightBoltzSubmits`, `:361`, `:451-454`) | Failures not cached (comment `:298-306`). Submit takes no caller signal (`:386-390`). | JapanFold key (as row 60) |
| 65 | `japanfold-client.ts:466` (Boltz-2 poll) | raw | enc (row 64) | enc | no | enc | enc | enc | JapanFold key (as row 60) |
| 66 | `external-api/japanfold.ts:52` (`runJapanFoldInference` submit) | raw | mem `japanfoldCache` | `${model}:${seqHash}` (`japanfold.ts:32`) | no | 12 h (`:19`) | no | Not stored on failure. | `process.env.JAPANFOLD_API_KEY` (`:38-44`) |
| 67 | `japanfold.ts:83` (poll) | raw | enc (row 66) | enc | no | enc | enc | enc | as row 66 |

Note: `runJapanFoldInference` (rows 66 and 67) has no callers besides its own re-export in `services/japanfold.ts`. It looks unused. Confirm before deleting.

### 4.11 Biohub, Forge and Hugging Face token probes, 3 rows

| # | File:line | Method | Cached | Key (quoted) | User in key | TTL | Single-flight | Negative caching | Credential |
|---|---|---|---|---|---|---|---|---|---|
| 68 | `routes/structure.ts:481` (`forge.evolutionaryscale.ai/api/v1/encode`, probe) | raw | none | none | no | n/a | no | n/a | per request: `x-biohub-token` (`structure.ts:354`) or body `token` (`:463`), else env `BIOHUB_API_TOKEN` or `ESM3_FORGE_API_KEY` (`:355`). A real `esm3-small` encode of `"M"`, so it spends the token's allowance. |
| 69 | `structure.ts:489` (`biohub.ai/api/v1/encode`, fallback on 451) | raw | none | none | no | n/a | no | n/a | as row 68 |
| 70 | `routes/biophysics/stability.ts:77` (`huggingface.co/api/whoami-v2`) | raw | none | none | no | n/a | no | n/a | per request `x-hf-token` (`stability.ts:73`), body `hfToken`, or env `HF_TOKEN` |

### 4.12 ESM Atlas, 1 row

| # | File:line | Method | Cached | Key (quoted) | User in key | TTL | Single-flight | Negative caching | Credential |
|---|---|---|---|---|---|---|---|---|---|
| 71 | `services/structure/esmfold.ts:117` (`api.esmatlas.com/foldSequence/v1/pdb/`) | raw | enc: `esmfoldCache` in `foldSequenceWithProvenance` (`esmfold.ts:38-46`) | `esmfold:seq:${seqHash}` (`:38`) | no | none on `esmfoldCache` (`:26-30`, max 100, 100 MB) | no | Atlas errors throw (`:134-136`), so nothing is stored. | none (keyless) |

### 4.13 Conservation predictor payload (cached wrapper for rows 46, 49, 50, 51, 52 and GPN)

| # | File:line | Method | Cached | Key (quoted) | User in key | TTL | Single-flight | Negative caching | Credential |
|---|---|---|---|---|---|---|---|---|---|
| 72 | `services/prediction/predictors/conservation-orchestrator.ts:173` (`fetchConservationData`, wraps rows 46, 49 to 51, GPN) | n/a (wrapper) | reg; L1 `conservationCache` (1 h, `cache-registry.ts:102-105`) | `buildConservationKey`: `conservation_${normGene}_${cleanVar}_${pdbId}_${chainId}_${pos}_${gnomadVariantId}_${assembly}_schema:${CACHE_SCHEMA_VERSION}` (`cache-keys.ts:160`) | **no caller identity, but the answer depends on the caller's HF token and `gpnApiUrl`, neither of which is in the key** (`conservation-orchestrator.ts:971-975`, `:729`) | L2 14 d (`:177`) | yes (reg) | Stored only when `available === true` (`:178`). When GPN has no token, its status is `token_required` and that is stored. | Depends on the caller's HF token |

### 4.14 AlphaGenome, 2 raw rows and 3 gRPC rows

| # | File:line | Method | Cached | Key (quoted) | User in key | TTL | Single-flight | Negative caching | Credential |
|---|---|---|---|---|---|---|---|---|---|
| 73 | `services/external-api/alphagenome-bridge.ts:241` (`endpoint` POST, analysis) | raw | reg-like: `alphagenomeCache` (mem LRU) with `defaultCacheRegistry.singleFlight` (`:133`) | `buildAlphaGenomeKey`: `alphagenome_${chr}:${pos}:${ref}>${alt}_${assembly}_schema:${CACHE_SCHEMA_VERSION}` (`cache-keys.ts:176`) | **no endpoint or credential identity in the key** | 30 d (`alphagenome-bridge.ts:34-36`) | yes (`singleFlight`, `:133`). The leader's `apiKey` and `apiUrl` are used for the whole flight. | Schema failure: 5 min (`:301`). Thrown error: 5 min (`:322`). "not indexed": kept 30 d (`:128`). 5-min error entries are served only when `!hasCredentials` (`:129-130`), so with credentials they are effectively not served. | **`Authorization: Bearer ${apiKey or env ALPHAGENOME_API_KEY or CONFIG}` (`:121`, `:245`) to `endpoint = apiUrl or env ALPHAGENOME_API_URL or CONFIG` (`:122`). See finding 1.** |
| 74 | `alphagenome-bridge.ts:486` (`${baseEndpoint}/region-saturation`) | raw | mem `alphagenomeRegionCache` with singleFlight (`:377`) | `alphagenome:region:${normChrom}:${start}-${end}:${transcriptId \|\| "all"}${exonKey}` (`:365`); **no assembly** | no endpoint or credential in key | 30 d (`:40-42`) | yes (`singleFlight`, `:377`) | As row 73. | As row 73 (`:368`, `:490`) |
| 75 | `services/external-api/alphagenome-client.ts:235` (gRPC `GetDenseVariantScores`, from `alphagenome-bridge.ts:207`) | gRPC | `alphagenomeCache`, stored when `live` (`alphagenome-bridge.ts:204`) | as row 73 | no | 30 d | yes (`singleFlight`, from row 73) | Not stored unless `live` or "not indexed" (`:203`). | `x-goog-api-key` (`alphagenome-client.ts:216`), from the same effective key |
| 76 | `alphagenome-client.ts:540` (gRPC `ListDenseVariantScores`, region) | gRPC | region cache (row 74) | as row 74 | no | 30 d | yes (row 74) | Not traced line by line. | `x-goog-api-key` (`:469`) |
| 77 | `alphagenome-client.ts:827` (gRPC `ListVariantScoresMetadata`, connection test, from `routes/variant/alphagenome.ts`) | gRPC | none | none | no | n/a | no | n/a | `x-goog-api-key` from request or env (`:821-822`) |

Row 74 uses the cache key `alphagenome:region:...` without the assembly. The comment at `cache-keys.ts:170-172` says AlphaGenome is GRCh38-only, so this is a deliberate omission but should be stated in the key.

### 4.15 Genos (`query.genos.us`), 7 rows

| # | File:line | Method | Cached | Key (quoted) | User in key | TTL | Single-flight | Negative caching | Credential |
|---|---|---|---|---|---|---|---|---|---|
| 78 | `services/external-api/genos_web.ts:52` (raw call inside `genosFetch`) | raw | enc (rows 79 to 83) | enc | no | enc | enc | enc | enc |
| 79 | `genos_web.ts:106` (`/api/login`) | genosFetch | session cookie kept in process, 30 min (`genos_web.ts:18`) | none | no | 30 min | no | Failure throws. | `GENOS_EMAIL`, `GENOS_ACCESS_KEY` (`:92-98`) |
| 80 | `genos_web.ts:185` (`/api/query`, point) | genosFetch | reg (`queryGenosWebservice`, `:153-156`) | `buildGenosKey`: `genos_${normGene}_${cleanVar}${gId}_schema:${CACHE_SCHEMA_VERSION}` (`cache-keys.ts:68`) | no | L2 14 d (`genos_web.ts:156`); no L1 | yes (reg) | `null` for circuit open (`:160`), error (`:201`, `:208`, `:298`) and no tables (`:245`). Not stored. | Session cookie (row 79) |
| 81 | `genos_web.ts:225` (table fetch) | genosFetch | enc (row 80) | enc | no | enc | enc | enc | Session cookie |
| 82 | `genos_web.ts:400` (`/api/query`, landscape) | genosFetch | `genosResultCache` Map, `landscape_${normGene}_${startPos}_${endPos}` (`:335`) | `landscape_${normGene}_${startPos ?? ""}_${endPos ?? ""}` (`:335`) | no | **10 min** (`genos_web.ts:81`, `:517`) | no | A failed batch is logged and skipped (`:506-508`), and the partial result is stored at `:517`. **Partial results cached 10 min.** | Session cookie |
| 83 | `genos_web.ts:409` (`/api/query`, retry) | genosFetch | enc (row 82) | enc | no | enc | no | enc | Session cookie |
| 84 | `genos_web.ts:437` (table, landscape) | genosFetch | enc (row 82) | enc | no | enc | no | enc | Session cookie |

Genos has its own global serialised queue with `GENOS_MIN_DELAY_MS = 1200` (`genos_web.ts:23-25`, `:44-60`) and its own breaker (`:30-37`). It does not use `withHostLock` or `fetchWithRetry`.

### 4.16 Literature (Europe PMC), 4 rows

| # | File:line | Method | Cached | Key (quoted) | User in key | TTL | Single-flight | Negative caching | Credential |
|---|---|---|---|---|---|---|---|---|---|
| 85 | `services/llm/literature-rag.ts:605` (`fetchLiteraturePage`, one cursor page) | raw | none in this function; the caller decides | none | no | n/a | no | Not stored on error (throws, `:606-615`). | none |
| 86 | `literature-rag.ts:627` (`fetchCitationsByPmids`) | raw | none in this function (no store writes seen at `:618-643`) | none | no | n/a | no | Throws on error (`:637`). | none |
| 87 | `literature-rag.ts:694` (`syncLiteratureForGene`) | raw | SQLite `literature_abstracts`, `literature_syncs`, `literature_query_members` | `literatureCacheKey(gene, query)` = `v${LITERATURE_CACHE_SCHEMA_VERSION}::${GENE}` plus `::${query}` (`literature-rag.ts:142-147`) | **free-text `query` is in the key** (user-entered, not identity) | 7 d staleness (`:134`, `:190`) | unknown (not traced) | Throws on non-OK (`:700-701`). Storage on failure not traced. | none |
| 88 | `literature-rag.ts:1072` (`searchGeneLiterature`, live) | raw | DB-first with 7 d staleness (`:1004-1020`); write-back of the live result not traced | as row 87 | free-text query, see row 87 | 7 d | unknown | Degraded result on error (`:1062-1064`) | none |

### 4.17 Gemini (`@google/genai` SDK), 5 call sites

| # | File:line | Method | Cached | Key (quoted) | User in key | TTL | Single-flight | Negative caching | Credential |
|---|---|---|---|---|---|---|---|---|---|
| 89 | `services/llm/gemini.ts:505` (`models.list`, key validation) | Gemini SDK | none | none | no | n/a | no | n/a | the key being validated (user input) |
| 90 | `gemini.ts:537` (`generateContent`, key validation) | Gemini SDK | none | none | no | n/a | no | n/a | as row 89 |
| 91 | `gemini.ts:1025` (`performGeminiAnalysis`, narrative) | Gemini SDK | `narrativeCache` (L1 only, 24 h) via `clinical_...` key (`routes/variant/narrative.ts:252`) | `clinical_${uniprotId}_${variant}_${acmgWeighting}_${userDirections or ""}_${evidenceHash}_literature:${citationDigest}_key:${keyHash}_model:${model}_schema:v${NARRATIVE_PROMPT_SCHEMA_VERSION}`, with `keyHash = sha256(activeApiKey)` (`narrative.ts:224`) | **YES: credential hash, and free-text `userDirections`** | 24 h (`cache-registry.ts:147-150`) | unknown | Stored on success only (`narrative.ts:312`); the catch at `:314+` does not store. | session key from `x-gemini-session-id` (`getApiKeyFromSession`, 15 min), else env `GEMINI_API_KEY` |
| 92 | `gemini.ts:1411` (`performGeminiBiophysicalAnalysis`) | Gemini SDK | `narrativeCache` (L1 only, 24 h) via `biophysical_...` key (`generation.ts:171`) | `biophysical_${uniprotId}_${variant}_key:${keyHash}_model:${model}_schema:v2` (`generation.ts:171`), `keyHash = sha256(activeApiKey)` (`:170`) | **YES: credential hash** | 24 h | unknown | Stored at `generation.ts:208` after the call returns. A fallback result that is returned without throwing would also be stored (not verified). | as row 91 (`generation.ts:157-166`) |
| 93 | `services/llm/literature-rag.ts:320` (`embedContent`, `getEmbedding`) | Gemini SDK | embedding stored with each citation in SQLite (`insertCitation`, `:541`) | per citation, by `literatureCacheKey` | free-text query (row 87) | none | unknown | not traced | `getGeminiClient(customApiKey)` (user session or env) |

Row 89 and row 90 are key checks, not analysis. Row 92 mirrors row 91 for the biophysics route.

### 4.18 Tamarind (ThermoMPNN), 3 rows

| # | File:line | Method | Cached | Key (quoted) | User in key | TTL | Single-flight | Negative caching | Credential |
|---|---|---|---|---|---|---|---|---|---|
| 94 | `services/stability/energy-models.ts:545` (`/api/tools`, connection test) | raw | none | none | no | n/a | no | n/a | `apiKey` from request, else env `TAMARIND_API_KEY` (`:540`), as `x-api-key` |
| 95 | `energy-models.ts:650` (`/api/submit-job`) | raw | `thermompnnCache` (LRU max 200, no TTL, `:531`), only `prediction !== null` | `${mutation}_${pdbHash}` (`:571`), `pdbHash = sha256(pdbContent).slice(0,16)` (`:570`) | no | none | no | Only done predictions are cached (`:573`). | as row 94 |
| 96 | `energy-models.ts:726` (`/api/jobs?jobName=`, poll) | raw | enc (row 95) | enc | no | enc | no | enc | as row 94 |

### 4.19 GPN-Star (custom endpoint or Hugging Face), 3 rows

| # | File:line | Method | Cached | Key (quoted) | User in key | TTL | Single-flight | Negative caching | Credential |
|---|---|---|---|---|---|---|---|---|---|
| 97 | `services/external-api/gpn.ts:90` (POST `sidecarUrl`, from `customEndpoint` or env `GPN_API_URL`) | raw | none at this call; the conservation payload (row 72) caches the result | none | no | n/a | no | n/a | none on this call. `sidecarUrl` is request-supplied (`x-gpn-api-url`, body `gpnApiUrl`), validated by `sanitizeUrl` (`variant-parser.ts:106-125`). |
| 98 | `gpn.ts:232` (POST `sidecarUrl`, with score) | raw | enc (row 72) | enc | no | enc | no | enc | `Authorization: Bearer ${gpnToken}`, where `gpnToken = hfToken` (`conservation-orchestrator.ts:971`). `hfToken` is the user's `x-hf-token`, or the server `HF_TOKEN` when the URL is not custom (`variant-parser.ts:546-556`). |
| 99 | `gpn.ts:140` (Tabix range read on `huggingface.co/datasets/songlab/gpn-msa-hg38-scores`, `:28-31`) | @gmod/tabix | reg; L1 `gpnCache` (30 d, `gpn.ts:14-16`) | `gpn_tabix_${cleanChrom}_${pos}_${cleanRef}_${cleanAlt}` (`:118`); **no assembly** (GRCh38-only by design) | no | L2 30 d (`:124`) | yes (reg) | `shouldCache` excludes results whose message contains "timed out" or "error" (`:126`). The string match is fragile. "Unindexed" is stored for 30 d. | none (public dataset) |

### 4.20 Evidence-context and Zenodo (raw `fetch`, process-memory caches), 14 rows

These calls are raw `fetch` with no host semaphore, no breaker and no retry. Each has its own module-level cache, which is lost on restart. None uses the registry or `external_cache`.

| # | File:line | Method | Cached | Key (quoted) | User in key | TTL | Single-flight | Negative caching | Credential |
|---|---|---|---|---|---|---|---|---|---|
| 100 | `services/evidence-context/alignment.ts:22` (Ensembl Compara homology, `homology/symbol/human/`) | raw | mem LRU `cache` (`:12`) keyed by `gene` (`:15-16`) | `gene` | no | 24 h (`:12`) | yes (`flights` Map keyed `gene`, `:13`) | 400 or 404 returns `not-found` without storing (`:24`). Errors not stored. Success stored (`:39`). | none |
| 101 | `evidence-context/allianceRelease.ts:19` (Alliance `releaseInfo`) | raw | module variable `cached` (`:5`) | single value | no | value 6 h, miss 5 min (`:6-8`, `:16`) | no | A failure becomes `null` and is cached for 5 min (`:21-22`). Non-definitive, low impact (release label only). | none |
| 102 | `evidence-context/clingenDosage.ts:25` (ClinGen dosage table) | raw | module LRU `cache`, key `'table'`, max 1 (`:19`) | `'table'` | no | 24 h (`:19`) | yes (`flight`, `:20`) | Failure and incomplete table throw (`:26`, `:29`). Not stored. | none |
| 103 | `evidence-context/g2p.ts:40` (EBI Gene2Phenotype `panel/all/download`) | raw | on-disk snapshot, installed on first use when the file is missing (`g2p.ts:50-56`) | file path | no | none (file); reinstalled only if absent | yes (`installOnce` keyed by target, `snapshotInstall.ts:39`) | Failure backs off for `RETRY_AFTER_MS` (`snapshotInstall.ts:40`, `:43`). | none. Gated by `autoInstallEnabled()` (definition not read). |
| 104 | `evidence-context/gencc.ts:29` (GenCC CSV download) | raw | none. Used only by `scripts/import-gencc-context.ts:9`, not by the server runtime | n/a | no | n/a | no | n/a | none |
| 105 | `evidence-context/gtex.ts:21` (GTEx v2 reference, expression, tissue; three calls via `read`) | raw | mem LRU `cache` (`:18`) keyed `${DATASET}\|v39\|${gene}` (`:30`) | as stated | no | 24 h (`:18`) | yes (`flights`, same key, `:19`, `:31-32`) | `not-found` returned without storing (`:37`). Errors not stored (`:59`). | none |
| 106 | `evidence-context/hpa.ts:25` (HGNC `fetch/symbol/`) | raw | mem LRU `cache` (`:16`) keyed `gene` | `gene` | no | 24 h (`:16`) | yes (`flights`, `:17`) | Empty or not-found returned without storing (`:27`, `:35`). Success stored (`:41`). | none |
| 107 | `evidence-context/hpa.ts:31` (Human Protein Atlas `${ensemblId}.json`) | raw | enc (row 106) | enc | no | enc | enc | 404 returns `not-found` (`:32`). Errors not stored. | none |
| 108 | `evidence-context/hpo.ts:28` (JAX ontology `network/annotation/<disease id>`) | raw | mem LRU `cache` (`:13`) keyed `${gene}\|${ids.join(',')}` (`:22`) | the disease ids are chosen by the user (input, not identity) | no (user input only) | 24 h (`:13`) | yes (`flights`, `:14`, `:22-23`) | All ids 404 stores `none404` (`:39-40`). Other errors not stored (`:41`). | none |
| 109 | `evidence-context/modelOrganisms.ts:34` (HGNC, Alliance, IMPC through a `fetch(url)` helper) | raw | mem LRU `cache` (`:31`) keyed `gene` | `gene` | no | 24 h (`:31`) | yes (`flights`, `:32`) | Stored unless IMPC errored (`:86`). | none |
| 110 | `evidence-context/modelPhenotypes.ts:26` (UPHENO SSSOM TSV, `raw.githubusercontent.com`) | raw | module `uphenoCache` (`:20`), flight `uphenoFlight` (`:21`) | one file | no | 7 d (`:30`) | yes (`uphenoFlight`) | `.catch(() => null)` (`:45`). Failure not stored. | none |
| 111 | `evidence-context/modelPhenotypes.ts:52` (Alliance `gene/<id>/phenotypes`, per organism) | raw | mem LRU `cache` (`:17`) keyed `gene`, stored only when every species is ready and UPHENO is present (`:73`) | `gene` | no | 24 h (`:17`) | yes (`flights`, `:18`) | Per-species error returns `status: error` for that species (`:65`). The gene-level result is not stored unless all species are ready. | none |
| 112 | `services/stability/energy-models.ts:381` (Zenodo record `6835877`, metadata) | raw | on-disk database `data/df_rasp_gnomad_clinvar.csv` (`:61`), installed once | file | no | none | no | `!ok` throws (`:382-384`). No timeout, no retry. | none |
| 113 | `energy-models.ts:394` (Zenodo file download, `links.self`) | raw | enc (row 112, on-disk install) | enc | no | enc | no | No timeout. MD5 check after download (`:405-412`); mismatch deletes the file and throws. | none |

## 5. Raw `fetch` call sites to migrate (ratchet baseline for I1)

These are the remote raw `fetch` calls in `server/`, excluding sidecar, health and deployment-control calls. Plus the Genos wrapper. Each is listed with file:line. I1 migrated them to `governedFetch` (`http-client.ts`), not `fetchWithRetry`: the governor keys providers by hostname, so no `provider` option exists. The file:line references below are as audited, before the migration.

1. `server/routes/biophysics/stability.ts:77`
2. `server/routes/structure.ts:481`
3. `server/routes/structure.ts:489`
4. `server/services/evidence-context/alignment.ts:22`
5. `server/services/evidence-context/allianceRelease.ts:19`
6. `server/services/evidence-context/clingenDosage.ts:25`
7. `server/services/evidence-context/g2p.ts:40`
8. `server/services/evidence-context/gencc.ts:29`
9. `server/services/evidence-context/gtex.ts:21`
10. `server/services/evidence-context/hpa.ts:25`
11. `server/services/evidence-context/hpa.ts:31`
12. `server/services/evidence-context/hpo.ts:28`
13. `server/services/evidence-context/modelOrganisms.ts:34`
14. `server/services/evidence-context/modelPhenotypes.ts:26`
15. `server/services/evidence-context/modelPhenotypes.ts:52`
16. `server/services/evidence-context/pext.ts:19`
17. `server/services/external-api/alphagenome-bridge.ts:241`
18. `server/services/external-api/alphagenome-bridge.ts:486`
19. `server/services/external-api/gpn.ts:90`
20. `server/services/external-api/gpn.ts:232`
21. `server/services/external-api/japanfold-client.ts:88`
22. `server/services/external-api/japanfold-client.ts:149`
23. `server/services/external-api/japanfold-client.ts:183`
24. `server/services/external-api/japanfold-client.ts:244`
25. `server/services/external-api/japanfold-client.ts:390`
26. `server/services/external-api/japanfold-client.ts:466`
27. `server/services/external-api/japanfold.ts:52`
28. `server/services/external-api/japanfold.ts:83`
29. `server/services/external-api/genos_web.ts:52` (inside `genosFetch`)
30. `server/services/llm/literature-rag.ts:605`
31. `server/services/llm/literature-rag.ts:627`
32. `server/services/llm/literature-rag.ts:694`
33. `server/services/llm/literature-rag.ts:1072`
34. `server/services/stability/energy-models.ts:381`
35. `server/services/stability/energy-models.ts:394`
36. `server/services/stability/energy-models.ts:545`
37. `server/services/stability/energy-models.ts:650`
38. `server/services/stability/energy-models.ts:726`
39. `server/services/structure/esmfold.ts:117`

**Migrated by WP-I1:** all 39 now call `governedFetch` (`http-client.ts`). The remaining raw calls and their reasons are the allowed list in `server/services/infra/egress-ratchet.test.ts`.

Count: 39. The Genos call sites (`genos_web.ts:106`, `:185`, `:225`, `:400`, `:409`, `:437`) go through `genosFetch` and are counted under the Genos wrapper (item 29). They must move as well.

## 6. Excluded call sites

### 6.1 `fetchWithRetry` health checks (7, `probe: true`)

- `services/external-api/adapters/service-adapters.ts:28` (ClinVar `einfo`)
- `service-adapters.ts:106` (Genos `/api/v1/health`)
- `service-adapters.ts:147` (UniProt `P04637`)
- `service-adapters.ts:256` (Ensembl `software` and `ping`)
- `service-adapters.ts:329` (Europe PMC)
- `service-adapters.ts:370` (MyVariant metadata)
- `services/translation/variant-validator.ts:472` (VariantValidator health)

Callers: `routes/health.ts:238` (`adapterRegistry.checkAllHealth`, cached 15 s, `routes/health.ts:140`), `routes/health.ts:112` (VariantValidator fallback probe, in-flight de-duplicated), and `services/external-api/adapters/registry.ts:51`. `/health` is public (`routes/state.ts:51`).

### 6.2 Raw `fetch` health, deployment-control and sidecar (16)

Health and deployment-control:

- `deployment-control.ts:53` (sidecar `/health`)
- `routes/capabilities.ts:139` (sidecar `/health`)
- `routes/health.ts:226` (sidecar `/health`)
- `routes/structure.ts:285` (sidecar `/health`)
- `routes/structure.ts:434` (sidecar `/health`)
- `services/external-api/adapters/service-adapters.ts:186` (sidecar `/health`)
- `sidecar-supervisor.ts:237` (sidecar `/health`)

Loopback sidecar prediction (`SIDECAR_URL`, default `http://127.0.0.1:8000`, `config.ts:116`):

- `services/external-api/esm2.ts:68`
- `services/external-api/esm3_forge.ts:125` (Biohub token is sent to the sidecar in the body, `:136`)
- `services/external-api/esmc.ts:92` (Biohub token in body, `:103`)
- `services/external-api/saprot.ts:104` (HF token in body, `:116`)
- `services/structure/folding-engines.ts:91` (Biohub token from env fallback, `:88`, `:102`)
- `services/structure/esmfold.ts:84` (Biohub token in body, `:92`)
- `services/stability/stabilityoracle.ts:50` (`SIDECAR_SECRET` header)
- `services/structure/structural-diff/evaluator.ts:35`
- `services/stability/energy-models.ts:597` (ThermoMPNN sidecar)

The sidecar makes its own outbound calls to Biohub, Hugging Face and similar services. Those calls are in `tools/` and were not audited.

### 6.3 Remote raw calls that are health or connection tests (3)

- `routes/capabilities.ts:158` and `:163` (JapanFold probe with `OPTIONS` then `GET`, `JAPANFOLD_API_URL` or default). Public endpoint. No cache (`:156-170`).
- `routes/variant/alphagenome.ts:41` (`${userApiUrl}/health` with `Authorization: Bearer ${userApiKey}`). This sends the server's env key to a request-chosen URL when no key is given. See finding 1.

## 7. Unknowns

- **Gemini single-flight**: not traced. Whether the route layer dedupes concurrent identical narrative calls.
- **Gemini client cache key**: `geminiClientCache` at `services/llm/gemini.ts:26-29` is keyed by something; the key was not read.
- **`performGeminiBiophysicalAnalysis` fallback**: whether it returns a fallback object without throwing (which would be cached at `generation.ts:208`).
- **Literature write-back**: whether `searchGeneLiterature` (`literature-rag.ts:1072`) and `fetchCitationsByPmids` (`:627`) store their results, and the failure path of `syncLiteratureForGene` (`:694`).
- **Structure resolver memo**: whether a transient PDBe error can select tier 2 or 3 and then be memoised for 6 h (`structure-resolver.ts:51`). The re-probe at `:341` runs only when re-materialisation fails.
- **VEP fallback caching**: how often a fallback answer obtained during an Ensembl failure is stored for 14 d (`vep-orchestrator.ts:617`).
- **Tabix transport**: whether `@gmod/tabix` makes its requests through global `fetch`. If so, the HF range reads are not visible to the grep.
- **Sidecar egress**: what the Python sidecar in `tools/` sends to Biohub, Hugging Face, ESM Atlas and others, and whether it caches. Tokens are passed to it in request bodies.
- **Startup RaSP download**: `initializeRaspDatabase` (`energy-models.ts:413`) has no caller found in `server/`. Whether it runs at startup is unknown.
- **`autoInstallEnabled()`**: the gate for the g2p runtime download (`snapshotInstall.ts`) was not read.
- **CircuitBreaker reset semantics**: `CircuitBreaker` in `server/utils.ts` was not read, so whether a success resets the failure count is unknown.
- **Log exposure**: whether callers log errors that contain a URL with `api_key` beyond `http-client.ts`.
- **Production configuration**: whether `NCBI_API_KEY`, `ALPHAGENOME_API_URL`, `GPN_API_URL`, `JAPANFOLD_API_KEY` and `TAMARIND_API_KEY` are set in production, and whether `GPN_API_URL` points at loopback or a remote host.
- **Prewarm**: `prewarm-manager.ts` was not traced separately. Its outbound calls are whatever the functions in sections 4 and 5 make.
