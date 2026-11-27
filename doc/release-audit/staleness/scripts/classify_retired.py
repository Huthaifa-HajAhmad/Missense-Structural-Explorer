# Adds kind and a first-pass verdict to raw-retired-hits.csv. Hand overrides live in overrides.csv.
import csv, re, sys
sys.stdout.reconfigure(encoding="utf-8")
ROOT = "C:/Users/HSA19/antigravity/release-coherence-audit/"
rows = list(csv.DictReader(open("raw-retired-hits.csv", encoding="utf-8")))

TEST_RX = re.compile(r"(__tests__/|\.test\.|\.spec\.|\.e2e\.ts|/tests/|test_\w+\.py|_test\.py|\.guard\.test|fixtures?/)")
ABSENT_RX = re.compile(r"not\.to|queryBy\w*\(.*\)\)?\.toBeNull|toBeUndefined|\.not\.|not\.toContain|absent|retired|removed|no longer|must not|never|rejected|dead|regression", re.I)
COMMENT_RX = re.compile(r"^\s*(//|\*|/\*|#|<!--|\{/\*)|^\s*-\s|^\s*\|")

def kind_of(rel, snip):
    if rel.startswith("doc/") or rel.endswith(".md") or rel.endswith(".csv") or rel.endswith(".json") and "results" in rel:
        return "doc"
    if TEST_RX.search(rel):
        return "test"
    if COMMENT_RX.search(snip):
        return "comment"
    if rel.startswith("src/") and rel.endswith((".tsx", ".ts")) and re.search(r"[A-Za-z]{3}.*[A-Za-z]{3}", snip) and ('"' in snip or ">" in snip or "`" in snip or "'" in snip):
        return "ui-text" if rel.endswith(".tsx") or "label" in snip.lower() or "text" in snip.lower() or "message" in snip.lower() else "code"
    return "code"

out = []
for r in rows:
    rel, snip, term = r["file"], r["snippet"], r["term"]
    kind = kind_of(rel, snip)
    if rel.startswith("doc/"):
        verdict = "historical-mention"  # refined per doc in the docs pass
    elif term == "ESM1b" and re.search(r"dbNSFP|predictor|REVEL|BayesDel|AlphaMissense|score|llr|ESM1b\s*\(?dbNSFP", snip, re.I) and not re.search(r"ESM-?2|SaProt|VESM|ESMC|ESM3", snip):
        verdict = "valid-use"
    elif kind == "test" and ABSENT_RX.search(snip):
        verdict = "historical-mention"
    elif kind == "comment" and ABSENT_RX.search(snip):
        verdict = "historical-mention"
    elif kind == "comment":
        verdict = "historical-mention"
    elif kind == "test":
        verdict = "live-use"  # tests that feed fixtures in; checked in Task C
    else:
        verdict = "live-use"
    out.append([term, rel, r["line"], kind, snip[:200], verdict])

with open("retired-candidates.csv", "w", newline="\n", encoding="utf-8") as fh:
    w = csv.writer(fh); w.writerow(["term","file","line","kind","snippet","verdict"]); w.writerows(out)
from collections import Counter
print(Counter((o[3], o[5]) for o in out))
