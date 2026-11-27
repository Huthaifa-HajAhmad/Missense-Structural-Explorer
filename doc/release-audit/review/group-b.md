# Group B review: "Does it break the protein?"

Scope: Evidence tabs **Residue shifts & pockets**, **Interfaces & PPI** (Interface map, Partners, Assemblies & models), **Functional domains** (Protein map, Annotation details, Hotspots), and the top-level views **3D structure**, **Energetics** and **Landscape**.

Read-only. No source file was edited and nothing was committed. This file is the only thing written.

## 0. How this was checked, and what was not

- Variants: TP53_R175H, UROD_G318R, ABCG1_G358R, SOD1_A5V. These were the variant folders with status "ok" when the review started (ABCG1 is "timeout", see below). GBA1_N409S and HBB_E7V appeared in `raw/` after the start, so they are not included. `erepo/` has no meta.json.
- Evidence: the text captures in `raw/<variant>/tabs` and `raw/<variant>/views`, the API responses in `raw/<variant>/api`, `axe.json`, and the code in `src/`.
- Screenshots read (four): `ABCG1_G358R/views/view__landscape.png`, `ABCG1_G358R/tabs/function__hotspots.png`, `UROD_G318R/views/view__energetics.png`, `SOD1_A5V/views/view__energetics.png`. Other visual claims come from the text capture only.
- Capture problems that change how far a finding can be trusted:

| Problem | Evidence | Effect on this review |
| --- | --- | --- |
| ABCG1 analysis hit the 360 s limit; `complete: false` | `ABCG1_G358R/meta.json` (`timeouts`) | ABCG1 screens may be partial. Re-run before fixing B8 as a product bug. |
| FoldX still "Running" when the capture gave up (UROD, SOD1) | `views/view__energetics.txt`; spinner waited 60 s past an elapsed counter of 1m 47s / 1m 57s | Treated as "still running at capture end", not as proven stuck. The product's own text says a small structure can take "up to a few minutes". |
| Numbering-proof API returned 401 "Invalid or missing API token" | TP53, ABCG1, SOD1 `api/*numbering-proof*.json` | Screens that depend on the proof were not really tested. The Hotspots numbering counts come from the hotspots API, not the proof. |
| Narrative request aborted (`ERR_ABORTED`) on all four | `meta.json` (`failedRequests`) | Residue shifts shows "No result" everywhere. May be a capture artifact (B24). |
| Energetics sub-tabs ("Engine records", "Packing & geometry") not captured | `views/` | Packing and geometry claims could not be checked. |
| Energetics and Landscape `main` text includes rail text | compare text vs screenshot | A block that appears twice in the text is not automatically twice on screen. Checked in the two screenshots: the rail appears once. |

Glossary, for terms used below:
- **MANE**: the one transcript (protein version) chosen as the standard for a gene. **Isoform**: one protein version made from a gene. **ENST**: Ensembl transcript ID. **NM_**: RefSeq transcript ID.
- **pLDDT**: AlphaFold's 0–100 confidence per residue. Below about 50 it is weak.
- **ΔΔG**: predicted change in folding stability, in kcal/mol. Negative means more stable.
- **FoldX**, **ProtVar FoldX**, **RaSP**, **ThermoMPNN**, **StabilityOracle**: the stability engines on the Energetics tab.
- **PM1**, **PP2**, **BP1**: ACMG evidence rules (PM1: functional hot spot; PP2/BP1: gene-level missense constraint bands).
- **O/E**: observed over expected missense count (1.0 is neutral).
- **RSA**: relative solvent accessibility (burial). **P2Rank**: cavity finder used for "pockets".
- **axe**: an automatic accessibility checker. "Serious" and "moderate" are its impact levels.

Severity used below: **blocker** = a wrong or self-contradicting statement, or a verdict shown too early, that a clinician could act on for this variant. **important** = a wrong number, a conflicting label, or a duplicate that a careful reader would notice. **polish** = wording, precision or repetition. **SCIENCE — lead to decide** = a judgment call the audit lead must make; no rule is proposed here.

## 1. Lead item: transcript, isoform and structure names

### 1a. ABCG1 p.Gly358Arg

Facts checked in the captures:
- UniProt P45844 is **678 residues**, and residue 358 is **G** (`api/002`).
- ENST00000398449 is the **MANE** transcript: `api/022` and `api/025` say `transcriptBasis: "mane"`; the header chip reads `NM_016818.3 MANE Select` (screenshots). The 666-residue length is from the audit lead, not from the captures.
- The stream response names `canonicalEnsemblId: ENST00000361802.7` (`api/020`). That is the 678-residue isoform. **No screen shows this ID.**

| Screen (file) | What it names | Consistent with P45844 = 678? | Consistent with the other screens? |
| --- | --- | --- | --- |
| Header chip (Hotspots and Landscape screenshots) | `NM_016818.3`, MANE Select; UniProt `P45844` | Names the MANE | Same transcript as the trace, under a different ID type |
| Functional domains, protein map, annotation details, hotspots rule traces (`function__protein-map.txt`, `__annotation-details.txt`, `__hotspots.txt`) | "Residue numbered on **canonical** P45844 (ENST00000398449.8)" | **No.** It calls the 666-residue MANE "canonical" for a 678-residue entry | Conflicts with Hotspots numbering check (below) |
| Functional domains, Hotspots card (`function__hotspots.txt`) | "Variants: ClinVar … ENST00000398449"; "Model AF-P45844-F1 v6"; "Numbering: 185 of 486 … differ" | Mixed: variant data from MANE, model from P45844 | **No.** The check says the two numberings disagree for 185 residues |
| Landscape (`views/view__landscape.txt`) | "Basis: gnomAD v4.1.1 regional missense, **ENST00000398449** protein residues"; axis "**1–678** residues"; "665 / 678 residues scored" | Mixed: MANE rows drawn on the 678 axis | **No.** Shows regional O/E 0.89502 where the header and Hotspots withhold it (B1) |
| 3D structure (`views/view__3d-structure.txt`) | AF-P45844-F1 v6, residues 1–678; no transcript named | Yes | Yes |
| Energetics (`views/view__energetics.txt`) | "Template residues 678 (chain A: 1 to 678)"; ProtVar model AF-P45844-F1 | Yes | Yes |
| Interfaces (three sub-tabs) | "UniProtKB P45844 SUBUNIT"; Boltz-2 complex "1,356 residues" (= 2 × 678); "Residues 1–678" | Yes | Yes |
| Residue shifts (`structure__*.txt`) | No transcript named; "Measured in AlphaFold model" | n/a | Yes |

**Verdict.** The residue number is right for the 678-residue model: G358 in P45844 is what the 3D view, FoldX and the Interfaces tab use. The problem is the **label and the data**:
1. The Functional trace calls the MANE transcript "canonical". That is wrong for ABCG1: the UniProt canonical isoform and the MANE are different proteins here (B2).
2. ClinVar and gnomAD rows come from the MANE, and the Hotspots check says 185 of 486 residues disagree with the model. The Landscape still draws those rows on the 678 axis and shows a regional O/E (B1).
3. The header chip shows NM_016818.3 and the traces show ENST00000398449.8. These are the same isoform in two ID systems, so this alone is not a contradiction.

### 1b. The other three variants

| Variant | Transcript named on every screen | Numbering check on Hotspots | Verdict |
| --- | --- | --- | --- |
| TP53 p.Arg175His | ENST00000269305 (Landscape basis; Hotspots variants; Functional "canonical P04637 (ENST00000269305)") | "Verified: 385 HGVSp reference residues match the model" | Consistent across the screens. The header chip was not captured as text, so the MANE status was not checked. |
| UROD p.Gly318Arg | ENST00000246337 (Landscape; Hotspots; Functional "canonical P06132 (ENST00000246337)"); header NM_000374.5 | "Verified: 266 …" | Consistent |
| SOD1 p.Ala5Val | ENST00000270142 (Landscape; Hotspots; Functional "canonical P00441 (ENST00000270142)"); header NM_000454.5 | "Verified: 127 …" | Consistent. The numbering note ("older literature may call this A4V … residue 5 is 4") appears once on Functional and every other screen uses 5. |

## 2. Coherence: the same fact, stated on each screen

| Fact | TP53 R175H | UROD G318R | ABCG1 G358R | SOD1 A5V | Verdict |
| --- | --- | --- | --- | --- | --- |
| Residue number and amino acid | Arg175 everywhere | Gly318 everywhere | Gly358 everywhere | Ala5 everywhere | Consistent |
| Structure used for burial (RSA) | AlphaFold model (Residue shifts, 3D) | PDB 1R3Q (Residue shifts "Measured in PDB 1r3q"; 3D "on PDB 1R3Q") | AlphaFold model | PDB 2C9V (Residue shifts "Measured in PDB 2c9v"; 3D "on PDB 2C9V") | Consistent within each variant |
| Structure used for FoldX template | AF-P04637-F1 (Energetics) | "Experimental structure · 1R3Q:A" | AF-P45844-F1 (3D, Energetics) | "Experimental structure · 2C9V:A" | Consistent with burial, but the 3D canvas subtitle says "AlphaFold model" for UROD and SOD1 (**B7**) |
| pLDDT at the residue | canvas "97"; panel "96.6"; Hotspots table "97" | canvas "99"; panel "98.8" | canvas "27"; panel "27.2 very low"; Energetics "27.2" | canvas "99"; panel "98.8" | Same value, different precision on one screen (**B21**) |
| Solved-structure counts | 3D "7 listed"; Interfaces "137 solved structures" with "2/90" on the same row | 3D "8 listed"; Interfaces "19 solved structures", "0 of 19" | 3D "7 listed" and "5 solved structures spanning residue 358"; Interfaces "–/5"; Partners "Solved: 5 structures" | 3D "1 listed"; Interfaces "1 solved structure" | Different populations with no label (**B6**) |
| Domain name at the residue | "p53, DNA-binding domain" (Pfam); "dna binding dna binding" (typo, **B19**) | "Uroporphyrinogen decarboxylase (Pfam 15–360)" | No domain; "cytoplasmic topological domain (1–426)" | Not compared | Consistent except the TP53 typo |
| ΔΔG headline and unit | FoldX +10.07 kcal/mol; "Mostly destabilizing"; median +1.28 | ProtVar −0.97, RaSP −1.45, ThermoMPNN +0.47, StabilityOracle −0.76; FoldX **still running**; "No destabilization" (**B4**) | FoldX −1.17; ProtVar −0.47; "No destabilization", median −0.56 | ProtVar +2.70; FoldX **still running**; "Mostly moderately destabilizing" with a false sentence (**B3**) | Units consistent (kcal/mol) on the captured default view; the kJ/mol setting was not captured (**B16**) |
| Burial and pocket words | "core" at 3.2%; pocket rim 9.2 Å | "boundary" at 22.2% (Residue shifts) vs "Intermediate · RSA 22%" (3D) | "surface" 78.2%; pocket 16.3 Å "distal" | "core" 3.3%; pocket 22.6 Å | Same band, two names on UROD (**B20**) |
| PM1 | "PM1 not met" on Functional and Hotspots | "PM1 not met" (three times) | "PM1 not met" with the same reason | "PM1 not met" (three times) | Consistent |
| Regional O/E (gene constraint) | Hotspots 0.89 "between the calibrated bands: no evidence either way"; Landscape 0.88513 | Hotspots 0.81 "between …"; header "0.81 No calibrated band"; Landscape 0.80751 | Hotspots "**Not shown**"; header "**Unverified locus**"; Landscape "**0.89502**" | Hotspots 0.70 "between …"; header "0.70 No calibrated band"; Landscape 0.70431 | Consistent except ABCG1 (**B1**) |
| Interface yes/no for the residue | Headline "at the interface with HLA-A in all 6 solved structures"; Partners row for the same accession "Arg175 not modelled" | "Not at the interface … any of 19" | "Not modelled" (all three sub-tabs) | "Whether Ala5 touches another protein has not been measured" (Interfaces) vs Hotspots "—" in the interface column | TP53 contradicts itself (**B5**); SOD1 uses two words for one gap |

### Explicit cross-checks requested

- **Hotspots vs Functional domains vs Landscape.** PM1 is "not met" on every variant, with the same reason, on the Functional and Hotspots screens. Regional O/E agrees on TP53, UROD and SOD1 (Hotspots, header and Landscape give the same number). It disagrees on ABCG1 (B1).
- **Interfaces vs 3D structure.** None of the four 3D screens says whether the residue is at an interface. There is no contradiction, but also no link: the 3D rail cannot show the interface answer (B33). The ABCG1 3D sentence "No solved structure shows this residue" agrees with the Interfaces "not modelled".
- **Energetics vs Residue shifts.** Burial source and FoldX template agree within each variant. The stability wording (for example TP53: "core", "loses its positive charge", "Mostly destabilizing") does not contradict the residue-shift text. The Packing & geometry sub-tab was not captured, so packing claims are unchecked.

## 3. Findings

Each finding lists: severity, screens, quoted evidence, the producing file (`src/`), and a fix. Fixes that change behaviour should start with a failing test (TDD).

### B1 · blocker · ABCG1 regional O/E has three different answers
- **Screens.** Landscape (`views/view__landscape.txt`): "Regional O/E 0.89502 across residues 1–425"; "Basis: gnomAD v4.1.1 regional missense, ENST00000398449 protein residues". Header (Landscape screenshot, top bar): "Regional O/E — **Unverified locus**". Hotspots (`tabs/function__hotspots.txt`): "Regional missense O/E · **Not shown** · 185 of 486 ClinVar/gnomAD residues differ from the model's sequence".
- **Evidence.** `api/032`: `numbering.status: "mismatch"`, checked 486, mismatches 185. `api/022`: `transcriptBasis: "mane"`.
- **Producers.** `src/components/inspector/LandscapeLocalContext.tsx:54` prints the value with no numbering check. The header withholds it through the `unverified-locus` status (`src/components/header/constraintMetrics.ts:395`). Hotspots withholds it through the numbering check (`src/shared/hotspotEvidence.ts:469`, `src/components/evidence/function/HotspotsView.tsx:317`).
- **Why it matters.** A clinician comparing the header with the Landscape sees the same residue as both "withheld" and "0.895". The Landscape is also drawn on the 678 axis (view: "1–678 residues") with MANE-based rows.
- **Fix.** One numbering status used by the header, Hotspots, Landscape and the Functional trace. The Landscape should withhold the O/E the way the header does, or show the mismatch warning beside it. **SCIENCE — lead to decide** whether the regional O/E is shown at all when numbering is unverified. The default proposed here is to match the header.

### B2 · important · "canonical" is applied to the MANE transcript (lead item)
- **Screens.** Functional domains, three sub-tabs: "Residue numbered on canonical P45844 (ENST00000398449.8)." (`function__protein-map.txt`, `__annotation-details.txt`, `__hotspots.txt`, rule trace step 1).
- **Evidence.** P45844 is 678 residues. ENST00000398449 is the MANE (666 residues, per the lead). The stream names ENST00000361802.7 as the canonical Ensembl ID (`api/020`). For the other three variants, the screens name one transcript for both roles, so ABCG1 is the only one shown with two different isoforms.
- **Producer.** `src/shared/functionEvidence.ts:1069–1074` writes "canonical" whenever `numberingBasis` is `"canonical"`, and appends the transcript ID. `numberingBasis` is the reader's choice at the numbering prompt (`src/components/VariantSearchPanel.tsx:777–790`), not the result of the numbering check.
- **Fix.** Name each ID for what it is: "Numbered on UniProt P45844 (678 residues). Scores from MANE ENST00000398449.8 (NM_016818.3)." Show the numbering-check result on the same line. Do not write "canonical" unless the transcript length equals the UniProt length. Fix together with B1.

### B3 · blocker · SOD1 Energetics says "predict no destabilisation" when no method does
- **Screen.** SOD1 Energetics (`views/view__energetics.txt`, and screenshot `SOD1_A5V/views/view__energetics.png`). Headline "**Mostly moderately destabilizing**". Sentence under it: "Most methods give a moderately destabilising reading under their local marks; **predict no destabilisation**." Rule trace step 3 on the same screen: "1 destabilizing · 2 moderate · **0 not destabilizing**".
- **Producer.** `src/shared/energeticsComparison.ts:108` builds the sentence from the list of "not destabilizing" methods. That list is empty, so the subject is blank and the verb "predict" stays.
- **Fix.** Add the clause only when the list is non-empty. Write a failing unit test for an empty list first.

### B4 · blocker · Verdict "No destabilization" is shown while FoldX is still running (UROD; SOD1 shows the same pattern with "Mostly moderately destabilizing")
- **Screen.** UROD Energetics (`views/view__energetics.txt`; screenshot `UROD_G318R/views/view__energetics.png`). Headline "**No destabilization**" in the largest type. Explanation: "The 3 methods that reported so far do not predict destabilisation". The only flag is a small line: "Provisional · 1 still running". The left navigation shows "Median ΔΔG = −0.76 kcal/mol" while FoldX is pending. The rule trace says "Summary: No destabilization · median −0.76 kcal/mol".
- **Why it matters.** FoldX is the counted engine that other engines are compared with. The median and the verdict can change when it finishes.
- **Producers.** `src/components/EnergeticsView.tsx:178` (Provisional line); `src/shared/energeticsEvidence.ts:866` (verdict label); `src/shared/energeticsComparison.ts:105` (sentence).
- **Fix.** While counted engines are pending, the headline shows a pending state ("Not yet: FoldX running"), not a verdict. Do not show the median in the navigation while pending. **SCIENCE — lead to decide** which engines must finish before a verdict may appear.

### B5 · blocker · TP53: the Interfaces headline and the Partners row contradict each other for the same HLA-A accession
- **Screens.**
  - Interface map (`tabs/interfaces__interface-map.txt`, first line) and Assemblies & models (`interfaces__assemblies-models.txt`, around line 139): HLA-A **A0A140T913**: "Arg175 at the interface in 6VQO, 6VR1, 6VR5, 6VRM, 6VRN, 6W51 … **6 of 6**."
  - Partners (`interfaces__partners.txt`, lines 486–488): "HLA-A · A0A140T913 · **Solved: 1 structure** – of 1 · Arg175 **not modelled**."
- **Also.** The "At site" list on the Interface map does not show HLA-A (it lists the TP53 other chain 2/90, SFN, cobB, E6, TP53BP1, UBE3A, TP53 fibril). HLA-A appears only inside "43 more solved partners". HLA-A appears under four accessions (A0A140T913, Q861F7, P04439, Q8WLS4) with four different answers (6 of 6; not modelled; 1 of 1; not modelled).
- **Producers.** Headline: `src/shared/interfaces/finding.ts:32`. Partner row: `src/shared/interfaces/partnerGroups.ts:59` (total). At-site list: `src/components/evidence/interfaces/InterfaceOverview.tsx:18` (k/n).
- **Fix.** Use one partner key (accession, or gene with accession shown) for the headline, the row and the list. Before writing the copy, check that the Partners row takes "Solved" from the same entries as the headline. The contradiction may be a grouping bug, which would be a fix, not a copy change.
- **SCIENCE — lead to decide.** Whether the six 6VQO-series entries (TP53 peptide on MHC) count as a native "interface" for TP53. The app excludes TCR and antibody contacts as tool binders but keeps the MHC contact.

### B6 · important · "How many structures?" has four different answers on one variant
- **Examples.** ABCG1 3D: "7 listed" (`views/view__3d-structure.txt`), and on the same screen "none of the 5 solved structures spanning residue 358 has coordinates". Interface map: "5 solved structures … –/5". TP53 Interfaces row: "137 solved structures" beside "2/90". UROD: 3D "8 listed" vs Interfaces "19".
- **Producers.** `src/components/inspector/StructureInspector.tsx:196` ("N listed" = number of rows); `src/shared/refusedTemplate.ts:16–17` ("none of the N solved structures spanning residue"); `src/shared/interfaces/partnerGroups.ts:59` (total); `src/components/evidence/interfaces/InterfaceOverview.tsx:18` (k/n); `src/shared/interfaces/finding.ts:66,125,128`; `src/shared/interfaces/format.ts:50–51`; `src/shared/insightsEvidence.ts:355`.
- **Fix.** One named count per use: "entries for this protein" (3D list); "structures of this pair" (Interfaces); "k of n that model the residue" (with n shown as modelled). Never show a total next to a modelled count without naming both.
- **Merge proposal.** Show one "structure census" per variant on the 3D tab, with the three counts (entries, structures of the pair, structures that model the residue) as labelled rows. Today they appear on three tabs with three labels.

### B7 · important · 3D canvas says "AlphaFold model, FoldX variant" for UROD and SOD1, whose FoldX template is a PDB entry
- **Screens.** UROD 3D (`views/view__3d-structure.txt`): subtitle "AlphaFold model, FoldX variant" (line 28), then "FoldX template 1R3Q" (lines 69–70) and burial "on PDB 1R3Q". SOD1: same pattern with 2C9V. Energetics: "Experimental structure · 1R3Q:A" (UROD), "Experimental structure · 2C9V:A" (SOD1).
- **Producer.** `src/components/inspector/ViewInspector.tsx:91` (fixed subtitle for the AlphaFold view, whatever the template).
- **Fix.** Build the subtitle from the template the FoldX run actually used.

### B8 · important · Secondary-structure state says "Reading…" and "No assignment has been read" on the same screen
- **Screens.** 3D structure for ABCG1 and TP53: "Reading the secondary-structure assignment from the model…" (fold note) and, in the selected-residue card, "No assignment has been read for this model." Both on `views/view__3d-structure.txt`.
- **Producers.** `src/components/inspector/StructureInspector.tsx:142` (reading state); `src/components/inspector/StructureSelectionCard.tsx:67` (no-assignment text).
- **Caveat.** ABCG1's run timed out, so part of this may be a timeout effect. Re-run first. The code still keeps two sources for one fact.
- **Fix.** One state for the secondary-structure read. Show "no assignment" only after the read has ended.

### B9 · important · "136 transmembrane segments" for ABCG1; the data has 6
- **Screen.** ABCG1 Functional domains, annotation details: "TOPOLOGY AND PROCESSING · 136 transmembrane segments" (`tabs/function__annotation-details.txt`).
- **Evidence.** `api/020` holds 78 "Transmembrane" feature records covering **6 unique spans** (427–445, 457–477, 507–525, 534–555, 568–586, 650–669). The Interface map's own count says "6 membrane segments".
- **Producers.** `src/shared/functionEvidence.ts:743` counts rows, not spans. `src/components/evidence/function/DomainArchitecture.tsx:67–69` does the same.
- **Fix.** Count unique spans. Write a failing test with a duplicated feature first.

### B10 · important · The binding-change card has three names for one state
- **Screens.** ABCG1 Interface map rail, step 7: "Binding change — **Not covered**". ABCG1 Assemblies card: under the title "ΔΔG_bind · DDMut-PPI on a wild-type complex" the same card shows "**Not covered**", then "**Not measured**". TP53 Assemblies: "**Not run yet**. DDMut-PPI on a solved complex…".
- **Producers.** `src/shared/interfaces/binding.ts:63` ("Not run yet."); `src/shared/engineStatus.ts:384` ("Not covered"); `src/components/evidence/interfaces/BindingCard.tsx:14` ("Not measured yet" / "Not measured"); `src/shared/interfaces/verdict.ts:115` ("Not measured").
- **Fix.** Three states with fixed meanings, one per cause: "Not run (on request)"; "No solved complex to score"; "Not measured". Use one per cause everywhere.

### B11 · important · Hotspots repeats one sentence eight times, and the rail repeats the cards
- **Screen.** ABCG1 Hotspots (`tabs/function__hotspots.txt`; screenshot `ABCG1_G358R/tabs/function__hotspots.png`). The sentence "185 of 486 ClinVar/gnomAD residues differ from the model's sequence at the same number, so the variants are not placed on this protein" appears in four card bodies and in the rail. The rail's "HOT-SPOT DEFINITIONS" repeats all six card definitions. The lane label "Withheld: numbering differs from the model" appears twice on the screen.
- **Producers.** `src/shared/hotspotEvidence.ts:469` (the sentence, reused on every axis); `src/components/evidence/function/HotspotsView.tsx:317` (lane label); `src/components/inspector/FunctionRail.tsx` (definitions list).
- **Fix.** State the numbering problem once, in the verdict line. Each card shows "Withheld (numbering)". The rail shows the definitions or the cards, not both.

### B12 · important · Interfaces repeats the same "not modelled" headline on three sub-tabs
- **Screens.** ABCG1 Interface map, Partners and Assemblies & models all open with "Gly358 is not modelled in any of the 5 solved structures of ABCG1, so they cannot show whether it is at an interface." The same sentence is repeated in the card and the rail on each sub-tab. "Residues 348–396 have no coordinates" repeats in the body and the rail.
- **Producers.** `src/shared/interfaces/finding.ts:91`; `src/shared/insightsEvidence.ts:582`.
- **Fix.** Keep the headline. Remove the card and rail repeats; the rail can show the trace numbers only.

### B13 · polish · Residue shifts repeats the same burial and pocket facts
- **Screen.** ABCG1 Residue comparison: "78.2%" appears four times (headline "reads as surface at 78.2% relative accessibility"; "BURIAL Surface 78.2%"; table row "78.2% Surface"; rail "Surface, 78.2% accessibility"). The sentence "The side chain becomes bulkier and gains a positive charge, 16.3 Å from the nearest predicted pocket" appears twice.
- **Producer.** `src/shared/residueContextEvidence.ts:395` (the "reads as" sentence).
- **Fix.** One burial line and one pocket line per screen.

### B14 · important · Energetics uses four different denominators for the engine count
- **Screens.** UROD and SOD1 Energetics: header "**4 of 5** scores ready"; under the headline "**3 of 4** methods returned a value"; rule trace "**3 of 4** engines". ABCG1: "4 of 4 methods returned a value; 4 counted" while the chart shows **5** estimates.
- **Producers.** `src/components/energetics/ProgressPanel.tsx:95` ("engine scores", five readings); `src/components/EnergeticsView.tsx:206` ("methods", four intended); `src/shared/energeticsComparison.ts:85` (displayed estimates).
- **Fix.** One word and one denominator: "5 engines run; 4 returned a value; 3 counted." The word "counted" appears in one place only.

### B15 · important · FoldX's error is given as three numbers on one screen
- **Screens.** ABCG1 and TP53 Energetics: "FoldX was typically off by about **2.54** kcal/mol" (local-repair test); "FoldX's typical error on those variants was about **2.5** kcal/mol" (92-variant repair test); "In a test on 667 variants … FoldX was off by about **2.0** kcal/mol" (method text).
- **Producers.** `src/shared/energeticsEvidence.ts:1034`; `src/shared/foldxRepairMode.ts:69`, `:84`.
- **SCIENCE — lead to decide** which error figure a clinician should see.
- **Fix (display).** Name each test once and show one number per test. Drop the others from the same screen.

### B16 · important · The repair-mode paragraph ignores the kJ/mol setting
- **Producer.** `src/shared/foldxRepairMode.ts:68`, `:69`, `:84` write "kcal/mol" into the text. The "How far off" sentence is unit-aware (`src/shared/energeticsEvidence.ts:1026–1034`), so only the repair-mode paragraph is affected.
- **Status.** Not verified on screen: no kJ/mol capture exists. The unit toggle is at `src/components/settings/SettingsDrawer.tsx:91`.
- **Fix.** Pass the unit into the paragraph builder. Capture one kJ/mol run to confirm.

### B17 · important · Landscape's "Data cautions (2)" is collapsed by default
- **Screen.** ABCG1 Landscape, first line of the text: "Data cautions (2) — review before comparing scores", inside a collapsed `<summary>`. The two cautions are not visible until opened, although the same screen asks the reader to review them before comparing scores.
- **Producer.** `src/components/SequenceVisualizer.tsx:455`.
- **Fix.** Open the cautions by default when there are any, or show the count next to the score bars.

### B18 · important · Accessibility: serious and moderate issues in group B (axe)
- **Serious.** `color-contrast` on the mutant residue code, on Residue shifts for all four variants (`src/components/evidence/residue/ResidueGlyph.tsx:217`; colour in `src/styles/residue.css:330`). `definition-list` on the family-matches list, on TP53 Functional domains (protein map, annotation details, hotspots) (`src/components/inspector/FunctionRail.tsx:215`).
- **Moderate.** `heading-order` on the residue rail trace (`src/components/inspector/ResidueShiftInspector.tsx:159–161`), all four variants. `page-has-heading-one` on 3D structure and Landscape, all four variants (page shell).
- **Zero violations** on the captured default views of Energetics and of the three Interfaces sub-tabs. Those sub-tabs were not all captured (see section 0).
- **Fix.** Use a colour token that passes 4.5:1 for the mutant code; render the family list as dt/dd pairs; make the trace heading level 2; give each view one level-one heading.

### B19 · polish · "dna binding dna binding" (TP53 protein map)
- **Screen.** TP53 Functional protein map: "It lies in the dna binding dna binding (102–292)" (`tabs/function__protein-map.txt`).
- **Producer.** `src/shared/functionEvidence.ts:892` joins the feature name and the feature type; both read "DNA binding".
- **Fix.** Skip the type when it equals the name.

### B20 · polish · Burial band has two names; PDB IDs have two cases
- **Screens.** UROD Residue shifts: "reads as **boundary** at 22.2%". UROD 3D: "**Intermediate** · RSA 22% · on PDB 1R3Q". Residue shifts also says "Measured in PDB **1r3q**" (lower case), while 3D says "1R3Q".
- **Producers.** `src/shared/residueContextEvidence.ts:395` (uses the burial label, "boundary"; the band is set in `src/shared/burialEvidence.ts:33`); `src/lib/useStructure3dEvidence.ts:134` ("Intermediate").
- **Fix.** One band vocabulary from `burialEvidence.ts`, and one ID case.

### B21 · polish · pLDDT is shown with different precision on the same screen
- **Screens.** ABCG1 3D: canvas "pLDDT 27 at this residue"; panel "27.2 very low". TP53: canvas "97"; panel "96.6"; Hotspots table "97". UROD and SOD1: canvas "99"; panel "98.8".
- **Producers.** `src/components/MolstarViewer.tsx:244` (whole number on the canvas); the panel shows one decimal (`src/shared/structure3dEvidence.ts:1076`).
- **Fix.** One formatter, one decimal everywhere.

### B22 · polish · An internal repository path is shown to readers
- **Screens.** ABCG1 and TP53 Hotspots rail: "3D benchmark: **doc/HOTSPOT_3D_DECISION.md** (pre-registered)".
- **Producers.** `src/components/inspector/FunctionRail.tsx:109`; `src/shared/hotspotEvidence.ts:244`.
- **Fix.** Replace it with a readable citation ("Pre-registered 3D benchmark, decision record"). Keep the path in the docs.

### B23 · polish · Two gnomAD versions in one header bar, with no reason given
- **Screens.** UROD and SOD1 header (screenshots): "GENE CONSTRAINT gnomAD v4.1.2" and, further right, "Regional O/E … v4.1.1". The Landscape basis says v4.1.1.
- **Producer.** Version label per metric in `src/components/header/constraintMetrics.ts`.
- **Fix.** Either one version, or label the source of each metric in the header.

### B24 · polish · Residue shifts shows "No result" for the narrative, with no reason
- **Screens.** All four Residue shifts rails: "MODEL NARRATIVE · No result · No AI biochemical narrative was returned for this substitution…" and a "Write the narrative again" button.
- **Evidence.** The narrative request was aborted in all four captures (`ERR_ABORTED`).
- **Producers.** `src/shared/residueShiftEvidence.ts:717`; `src/components/inspector/ResidueShiftInspector.tsx:236`.
- **Fix.** Say why it failed when it fails, and offer the retry. Confirm in a run without the capture harness before changing copy.

### B25 · polish · An empty heading on Hotspots
- **Screen.** ABCG1 Hotspots: "Nearest in sequence first" with the text "No residue is listed, because the variant positions are withheld."
- **Producer.** `src/components/evidence/function/HotspotsView.tsx:156`.
- **Fix.** Hide the heading when there are no rows.

### B26 · polish · Energetics wording: plural error, jargon, and "placeholder"
- **Screens.** SOD1 and UROD: "1 displayed methods have no estimate". ABCG1 Energetics: "the 1.33 gap mark is this app's, near FoldX's reported error". Rail text: "app-defined local placeholder pending held-out recalibration" (ABCG1 and TP53 Energetics).
- **Producers.** `src/shared/energeticsComparison.ts:85`; `src/components/inspector/EnergeticsMethodInspector.tsx:116`; `src/components/inspector/EnergeticsInspector.tsx:94`; `src/components/inspector/EnergeticsMethodInspector.tsx:69`.
- **Fix.** "1 displayed method has no estimate." "Difference marker" instead of "gap mark." Replace the "placeholder" wording (the mark's status is **SCIENCE — lead to decide**, see B29).
- **Also.** The ClinGen row says "Read 2026-11-27" (`HotspotsView`), which means "source checked on this date". Rename to "Source checked 2026-11-27".

### B27 · polish · The Interfaces rail counts more reported partners than the Partners tab
- **Screen.** ABCG1 Interfaces rail, step 5: "6 reported partners: curated, structural or co-purified". The Partners tab says "Reported binding 5" and files ABCG4 under "Assembly 3".
- **Producers.** `src/shared/interfaces/trace.ts:122`; `src/shared/interfaces/partnerGroups.ts:6` (a comment that says the count depends on whether the subfamily is included).
- **Fix.** Use the Partners tab's count in the rail.

### B28 · polish · Landscape window ends at 425; Functional says the domain ends at 426
- **Screens.** ABCG1 Landscape: "Regional O/E 0.89502 across residues **1–425**". Functional: "cytoplasmic topological domain (**1–426**)".
- **Producer.** `src/components/inspector/LandscapeLocalContext.tsx:54`.
- **Fix.** State the window rule once. It may be correct (a gnomAD window that ends one residue early), but a reader will not know that.

### B29 · SCIENCE — lead to decide · Stability verdicts shown at very low confidence, and very large values without a value-level flag
- **ABCG1.** Headline "No destabilization" with "Low confidence in the AlphaFold template here (pLDDT 27.2)" and "structure-based estimates are unreliable here" on the same screen.
- **TP53.** FoldX **+10.07 kcal/mol**, shown as "Mostly destabilizing". The screen says large values tend to overstate, and that FoldX values of +3 or more averaged about +4.3. The caveat is on the page, but nothing flags this value.
- **Producers.** `src/shared/energeticsComparison.ts:105`, `src/shared/energeticsEvidence.ts:866`; `src/shared/foldxRepairMode.ts:79` (overstatement text).
- **Decision needed.** Should a stability verdict appear when the residue's pLDDT is very low? Should a value far outside the calibrated range get its own flag? No engine rule is proposed here.

### B30 · SCIENCE — lead to decide · PM1 "not met" while the ClinGen PM1 text is not read (TP53)
- **Screen.** TP53 Hotspots: "The expert panel's PM1 text is the authority; read it below." The expert specification says "residue lists are not parsed, because some panels publish them as images." The Engine record says "PM1 not met."
- **Decision needed.** Whether "PM1 not met" may be shown before the expert text has been read.

### B31 · SCIENCE / polish · "CALIBRATED (PREPRINT)" on a band the header presents as calibrated
- **Screen.** ABCG1 and TP53 Hotspots: "CALIBRATED (PREPRINT) · Regional missense O/E". The header labels the same family of bands with its PP2 cut-offs (`src/components/header/constraintMetrics.ts`), with no preprint note.
- **Producer.** Hotspots card label in `src/components/evidence/function/HotspotsView.tsx`.
- **Decision needed.** Whether a clinical band needs a "preprint" status on each screen where it appears.

### B32 · polish · "DDMut" name is both retired and live
- **Evidence.** The code says DDMut was retired (`src/shared/deepModelEvidence.ts:54`; `src/services/pipeline/variantCache.ts:86`). DDMut-PPI, a different engine for binding change, still runs on request on the Interfaces tab (`src/shared/interfaces/binding.ts:29–31`; `src/components/evidence/interfaces/BindingCard.tsx:24`).
- **Decision needed.** Confirm DDMut-PPI is kept on purpose. Then rename or footnote the retired note so the two are not confused.

### B33 · polish · The 3D view has no interface answer (cross-check gap)
- **Evidence.** None of the four 3D screens says whether the residue is at an interface, although the Interfaces tab has a "Show interface in 3D" action.
- **Fix.** One line in the 3D rail: "At an interface: yes / no / not modelled" with a link to the Interfaces tab.

## 4. Proposed merges, splits, renames and removals

- **Merge** the three "how many structures" readouts (3D list, Interfaces counts, Partners "Solved") into one structure census per variant, with labelled rows. Reason: four labels for three counts (B6).
- **Remove** the repeated copy in Hotspots: the cards and the rail repeat the same six definitions and the same sentence (B11). Reason: the reader sees it up to eight times on one screen.
- **Remove** the repeats in Interfaces (B12) and Residue shifts (B13). Reason: the same fact is stated three to four times per screen.
- **Rename** "canonical" in the Functional trace to the actual isoform and numbering (B2). Reason: the label is wrong for ABCG1.
- **Rename** the binding-change states to three fixed labels (B10). Reason: "Not covered", "Not run yet" and "Not measured" mean different things.
- **Split** the Landscape's regional O/E from the bars, so its numbering status is shown on the lane (B1). Reason: the bars are the data; the O/E is a separate claim.
- **Rename** "Read 2026-11-27" to "Source checked 2026-11-27" (B26), and "gap mark" to "difference marker" (B26). Reason: the words are not plain English.
- **Remove** the internal doc path from the Hotspots rail (B22) and the word "placeholder" from the Energetics rails (B26, with the SCIENCE decision in B29).

## 5. Nielsen's 10 heuristics, applied to the group-B flow

Screenshots cited were read; other examples are from text captures.

| Heuristic | Where it breaks | Evidence |
| --- | --- | --- |
| 1. Visibility of system status | Energetics shows "Running" in five places at once (progress box, "Running" chip, "Provisional · 1 still running", rule trace, navigation spinner). Verdict is still shown (B4). The 3D secondary-structure line says "Reading…" and "No assignment" together (B8). | `UROD_G318R/views/view__energetics.png`; `views/view__3d-structure.txt` |
| 2. Match between system and the real world | "gap mark", "placeholder pending held-out recalibration", "Shown, not counted", "CALIBRATED (PREPRINT)", "Read 2026-11-27", "PM1 · CRITICAL FUNCTIONAL REGION" (plain-English names missing). | B26, B31 |
| 3. User control and freedom | The unit toggle, "Hide pending engines" and "Counted only" give control. The "No result" narrative offers "Write the narrative again" but no reason (B24). "Data cautions (2)" is collapsed, so the reader cannot see what to review (B17). | `ABCG1_G358R/views/view__landscape.png` |
| 4. Consistency and standards | Burial band words (B20); four denominators for engines (B14); four counts of solved structures (B6); three labels for the binding state (B10); pLDDT precision (B21). | section 2 table |
| 5. Error prevention | Verdict shown before the counted engine finishes (B4). Landscape shows an O/E that the header withholds (B1). A false sentence about "no destabilisation" (B3). A typo "dna binding dna binding" (B19). | section 3 |
| 6. Recognition rather than recall | The reader must compare the header, Hotspots and Landscape to learn that ABCG1's regional O/E is unverified. No screen links the three. | B1 |
| 7. Flexibility and efficiency | Filters exist (Landscape focus, Energetics "Counted only"). Nothing blocks an expert. | — |
| 8. Aesthetic and minimalist design | The repeated sentences in Hotspots (B11), Interfaces (B12), Residue shifts (B13). Two gnomAD versions on one header bar (B23). | `ABCG1_G358R/tabs/function__hotspots.png` |
| 9. Help users recognise, diagnose and recover from errors | "Withheld: numbering differs from the model" says what is wrong but not what to do (B1). "No result" gives no reason (B24). | B1, B24 |
| 10. Help and documentation | "How to read" buttons exist. The "How far off this can be" maths and the "gap mark" need a definition on the screen. An internal doc path is shown instead of a citation (B22). | B22, B26 |

## 6. Staleness

- **Retired engines in group-B captures.** I searched every group-B text capture for ESM-2, SaProt, VESM, ESMC, ESM3, perturbation, ConSurf, GPN, MetaDome, MTR3D, CCR, DynaMut2 and DDMut. **No hits** except DDMut-PPI, which is live (B32). The retired-engine notes remain only in code comments.
- **Engines shown as running.** UROD and SOD1 Energetics still showed FoldX "Running" at capture end, about two minutes in (B4). ABCG1's analysis timed out at 360 s (section 0).
- **Placeholder or stuck text.** "placeholder pending held-out recalibration" (B26); "No result" (B24); "Reading the secondary-structure assignment…" next to "No assignment has been read" (B8).
- **Contradictions between tabs.** B1, B2, B5, B6, B7, B10, B14.
- **Repository paths in the UI.** B22.

## 7. Axe, per tab (group B, four variants)

| Tab or view | Rule (impact) | Variants | Shared or tab-specific | Where |
| --- | --- | --- | --- | --- |
| Residue shifts (residue comparison) | color-contrast (serious) on `.rsx-glyph-code--mut` | all four | shared | `ResidueGlyph.tsx:217` |
| Residue shifts (environment and pockets) | heading-order (moderate) on `#rsx-rail-trace` | all four | shared | `ResidueShiftInspector.tsx:159–161` |
| Functional domains (protein map, annotation details, hotspots) | definition-list (serious) on `dl[data-testid="family-matches"]` | TP53 only | content-specific; the component is shared | `FunctionRail.tsx:215` |
| 3D structure | page-has-heading-one (moderate) | all four | shared (page shell) | view shell |
| Landscape | page-has-heading-one (moderate) | all four | shared (page shell) | view shell |
| Energetics | none on the default view | — | — | — |
| Interfaces (three sub-tabs) | none | — | — | — |
| Functional domains, protein map and hotspots for ABCG1, UROD, SOD1 | none | — | — | — |

Not in group B but shown in the same files: Insights `scrollable-region-focusable` (serious, all four) and Literature and Report `color-contrast` (serious, all four); these belong to other groups.

## 8. Which variant shows each tab at its worst

| Tab | Worst variant | Why |
| --- | --- | --- |
| Residue shifts | ABCG1 | Same layout for all four, but ABCG1 repeats "78.2%" four times and has the "No result" narrative. |
| Interfaces | TP53 | The headline and the Partners row contradict each other (B5); four HLA-A accessions; "137 solved" beside "2/90" (B6). ABCG1 is the worst for repetition (B12). |
| Functional domains | ABCG1 | Hotspots withholds everything and repeats the same sentence eight times (B11); wrong isoform label (B2); "136 transmembrane segments" (B9). TP53 has the axe violation and the typo (B18, B19). |
| 3D structure | ABCG1 | "7 listed" vs "5 solved" (B6); secondary-structure contradiction (B8); pLDDT 27 with a "very low" label. UROD and SOD1 have the canvas label problem (B7). |
| Energetics | SOD1 | False sentence (B3); counts 4 of 5 vs 3 of 4 (B14); FoldX still running. UROD shows the early verdict (B4). ABCG1 shows a verdict at pLDDT 27.2 (B29). TP53 shows +10.07 kcal/mol (B29). |
| Landscape | ABCG1 | Shows regional O/E the header withholds (B1); cautions collapsed (B17); MANE rows on the 678 axis. |

## 9. Ranked top 7

1. **B1 (blocker)**: ABCG1 regional O/E is withheld in the header and in Hotspots but shown as 0.895 in the Landscape, which also draws MANE-numbered rows on the 678 axis.
2. **B5 (blocker)**: TP53 says HLA-A is at the interface in 6 of 6 structures; the Partners row for the same accession says "Solved: 1 structure, not modelled". (SCIENCE: whether MHC contacts count.)
3. **B3 (blocker)**: SOD1 Energetics says "predict no destabilisation" when zero methods predict it. Empty-list bug.
4. **B4 (blocker)**: UROD shows "No destabilization" as the headline while FoldX, a counted engine, is still running. (SCIENCE: when a verdict may show.)
5. **B2 (important, lead item)**: the Functional trace calls ENST00000398449.8 (MANE) the "canonical" isoform of P45844, which is a different 678-residue protein.
6. **B6 (important)**: "how many structures" is answered four ways on one variant (7 listed, 5 solved, 137 solved, 2/90).
7. **B7 (important)**: the 3D canvas says "AlphaFold model, FoldX variant" for UROD and SOD1, whose FoldX template is a PDB entry (1R3Q, 2C9V).

Next in line: B9 ("136 transmembrane segments" when the data has 6), B8 (secondary-structure state), B14 (engine counts), B10 (binding-state labels).

## 10. Not checked

- The kJ/mol view (B16 is unverified on screen).
- Energetics "Engine records" and "Packing & geometry" sub-tabs.
- Interfaces header chips (the header was read from screenshots only on Hotspots and Landscape).
- GBA1_N409S and HBB_E7V (appeared after the start).
- Whether the ABCG1 and TP53 secondary-structure text survives a complete, non-timed-out run (B8).
- Whether the narrative failure (B24) happens outside the capture harness.
