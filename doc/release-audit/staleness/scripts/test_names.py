# Task C: tests whose names, fixtures or assertions use retired feature names.
# Part 1: test titles (hand-classified from a grep of it()/describe() titles).
# Part 2: one row per test file, rolled up from retired-names.csv (kind = test).
import csv, sys
from collections import defaultdict
sys.stdout.reconfigure(encoding="utf-8")
STAG = "C:/Users/HSA19/antigravity/release-coherence-audit/doc/release-audit/staleness/"

TITLES = [
 # file, line, title, term, role, action
 ("src/components/evidence/__tests__/normalizeEvidenceTab.test.ts", 24, "sends the retired Structural perturbation tab to Energetics", "perturbation", "guard", "KEEP (redirect guard)"),
 ("src/components/settings/__tests__/ConnectionsSection.test.tsx", 164, "retires optional provider tokens (Tamarind Bio, Hugging Face)", "Hugging Face", "guard", "KEEP (retirement guard)"),
 ("src/components/__tests__/MasterSidebar.test.tsx", 43, "offers AlphaFold as the only structure model: the ESMFold view was retired", "ESMFold", "guard", "KEEP (retirement guard)"),
 ("src/context/__tests__/SettingsContext.test.tsx", 93, "scrubs legacy plaintext credentials and retired settings (GPN-MSA, Biohub, ESMFold, Tamarind) from localStorage", "GPN, biohub", "valid", "KEEP (cleanup of saved secrets)"),
 ("src/context/__tests__/SettingsContext.test.tsx", 108, "scrubs retired Biohub and Tamarind tokens from session storage", "biohub", "valid", "KEEP (cleanup of saved secrets)"),
 ("src/hooks/__tests__/useRetiredEvidenceTabRedirect.test.tsx", 7, "opens Energetics when asked for the retired Structural perturbation tab", "perturbation", "guard", "KEEP (redirect guard)"),
 ("src/shared/thresholds.test.ts", 62, "should evaluate ESM-1b scores against the Bergquist 2025 bands", "ESM1b", "valid", "KEEP (ESM1b is a valid dbNSFP score)"),
 ("src/shared/__tests__/predictorEvidence.test.ts", 80, "ESM1b runs the other way: more negative is more pathogenic", "ESM1b", "valid", "KEEP"),
 ("src/shared/__tests__/predictorEvidence.test.ts", 221, "shows no row for the retired runtime language models a saved analysis still carries, and keeps ESM1b", "ESM-2, SaProt, ESMC", "guard", "KEEP (retirement guard)"),
 ("src/shared/__tests__/primaryPredictor.test.ts", 21, "decidePrimaryInsilico: REVEL -> BayesDel noAF -> AlphaMissense -> ESM1b", "ESM1b", "valid", "KEEP"),
 ("server/routes/biophysics.test.ts", 198, "unregisters retired DynaMut2, DDMut, Tamarind, and ThermoMPNN polling routes", "Tamarind", "guard", "KEEP (retirement guard)"),
 ("server/services/external-api/gnomad-gene-constraint.test.ts", 5, "finds GBA1 in the v4.1.2 table, which still names it GBA", "GBA", "valid", "KEEP (GBA allowed for the constraint table)"),
 ("server/services/infra/gene-symbols.test.ts", 4, "gene symbols: GBA was renamed GBA1", "GBA", "valid", "KEEP"),
 ("server/services/orchestration/core-identity.test.ts", 96, "records only the AlphaGenome capability: Biohub was retired and no longer shapes a run", "biohub", "guard", "KEEP (retirement guard)"),
 ("server/services/orchestration/payload-assembler.test.ts", 143, "names the core VESM-150M evaluation", "VESM", "stale", "UPDATE: asserts a retired model is declared; delete with payload-assembler.ts lines 274-280"),
 ("server/services/prediction/predictors/vep-orchestrator.test.ts", 327, "a gene its sources know by two names (GBA1, formerly GBA)", "GBA", "valid", "KEEP"),
 ("server/services/stability/energy-models.test.ts", 466, "reports a wait that ran out as busy ... makes no Tamarind cloud fallback", "Tamarind", "guard", "KEEP (retirement guard)"),
 ("server/services/stability/foldx-queue-job.test.ts", 171, "lets StabilityOracle wait ... the model service runs ESM-2 passes ahead of it", "ESM-2", "stale", "UPDATE title and fixture: ESM-2 passes no longer run"),
 ("server/services/prediction/acmg/pp3-bp4-language-models.test.ts", 66, "never picks up strength from retired runtime language models", "ESM-2, ESMC, SaProt", "guard", "KEEP (retirement guard)"),
 ("src/shared/__tests__/structure3dEvidence.test.ts", 153, "reads a 0-1 pLDDT scale (ESM Atlas) apart from 0-100", "ESM Atlas", "valid", "KEEP (ESM Atlas is a live fold source; not a retired model)"),
 ("src/apiClient.test.ts", 17, "expects a message naming the ESM Atlas limit and EvolutionaryScale/BioHub", "ESM Atlas, biohub", "stale", "UPDATE: no source file produces this text; the test checks a mock only"),
 ("tests/energetics-packing.e2e.ts", 18, "packing page does not print SaProt, ESM-2, ESMC or VESM", "ESM-2, SaProt, ESMC, VESM", "guard", "KEEP (retirement guard)"),
 ("tests/proof/predictor-gata4.e2e.ts", 36, "predictor row shows ESM1b", "ESM1b", "valid", "KEEP"),
 ("src/shared/__tests__/fixtures/gata4Perturbation.ts", 1, "fixture named after the retired Structural perturbation tab (GATA4)", "perturbation, ESM-2, VESM, SaProt, ESMC", "stale", "RENAME to a retired-tab fixture; used as guard input by pp3-bp4 test"),
 ("src/shared/__tests__/fixtures/slc12a4Perturbation.ts", 1, "fixture named after the retired Structural perturbation tab (SLC12A4)", "perturbation, ESM-2, ESMC, SaProt, ESM3", "stale", "RENAME; holds retired-model results"),
 ("src/shared/__tests__/fixtures/nae1Result.ts", 11, "NAE1 result fixture with an ESMC evaluation", "ESMC", "stale", "UPDATE: drop esmcEval from the fixture"),
 ("tests/fixtures/predictor-gata4.json", 27, "predictor fixture carries retired sidecar errors, GPN-Star and ESM-2 labels", "ESM-2, VESM, SaProt, GPN-Star", "stale", "UPDATE: regenerate without retired fields"),
]

rows = list(csv.DictReader(open(STAG + "retired-names.csv", encoding="utf-8")))
by_file = defaultdict(list)
for r in rows:
    if r["kind"] == "test":
        by_file[r["file"]].append(r)

def roll(hits):
    v = {h["verdict"] for h in hits}
    if "live-use" in v:
        return "stale", "UPDATE: fixture or assertion still uses a retired name"
    if v == {"valid-use"}:
        return "valid", "KEEP (valid use)"
    return "guard", "KEEP (guard or comment)"

out = [["kind", "file", "line", "what", "retired_terms", "role", "action"]]
for f, line, title, terms, role, action in TITLES:
    out.append(["title", f, line, title, terms, role, action])
title_files = {t[0] for t in TITLES}
for f in sorted(by_file):
    if f in title_files:
        continue
    role, action = roll(by_file[f])
    terms = sorted({h["name"] for h in by_file[f]})
    lines = ";".join(sorted({h["line"] for h in by_file[f]}, key=int)[:12])
    out.append(["fixture-or-assertion", f, lines, f"{len(by_file[f])} hits", ", ".join(terms), role, action])

with open(STAG + "tests-retired-names.csv", "w", newline="\n", encoding="utf-8") as fh:
    csv.writer(fh).writerows(out)
from collections import Counter
print(len(out) - 1, "rows", Counter(o[5] for o in out[1:]))
