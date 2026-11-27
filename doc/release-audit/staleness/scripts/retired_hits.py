# Scan the code and docs for names of retired features (Task A).
# Writes a raw hit list; the verdicts are added later by hand.
import csv, os, re, sys

ROOT = "C:/Users/HSA19/antigravity/release-coherence-audit"
DIRS = ["src", "server", "tests", "scripts", "public", "doc", "tools", "data", "README.md", "server.ts", "e2e.config.ts", "e2e.bugbash.config.ts", "e2e.agent.ts", "docker-compose.yml", "Caddyfile", "deploy", ".github", ".agents", "AGENTS.md", "package.json", ".env.example"]
SKIP = {"node_modules", ".git", "dist", "build", "coverage"}
TEXT_EXT = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".md", ".csv", ".sh", ".py", ".html", ".css", ".yml", ".yaml", ".txt", ".example", ".cfg", ".conf", ".ps1", ".toml", ".sql", ".xml", ""}

PATTERNS = {
    "ESM-2/ESM2": r"\bESM-?2\b",
    "ESM-3/ESM3": r"\bESM-?3\b",
    "ESMC": r"\bESMC\b",
    "SaProt": r"\bSaProt\b",
    "VESM": r"\bVESM\w*\b",
    "ESM1b": r"\bESM-?1b\b",
    "perturbation": r"\bperturbation\w*\b",
    "ConSurf": r"\bConSurf\w*",
    "GPN": r"\bGPN\w*",
    "HuggingFace": r"\bhugging[ _-]?face\b|\bHF_TOKEN\b|\bhuggingface\w*",
    "biohub": r"\bbiohub\w*\b",
    "GBA": r"\bGBA\b",
    "gene-Z": r"\bgene[- _]?level[- _]?z\w*|\bz[- _]?score\w*|\bzScore\w*|\bgene_z\w*|\bgeneZ\w*",
    "MetaDome": r"\bMetaDome\w*\b",
    "MTR3D": r"\bMTR3D\w*\b",
    "CCR": r"\bCCR\b",
    "residue-tolerance": r"\bresidue[- _]tolerance\w*",
    "duckdns": r"\bduckdns\w*\b",
}
COMPILED = {k: re.compile(v, re.I) for k, v in PATTERNS.items()}

def walk():
    for d in DIRS:
        p = os.path.join(ROOT, d)
        if os.path.isfile(p):
            yield p
            continue
        if not os.path.isdir(p):
            continue
        for dp, dn, fn in os.walk(p):
            dn[:] = [x for x in dn if x not in SKIP]
            for f in fn:
                full = os.path.join(dp, f)
                ext = os.path.splitext(f)[1].lower()
                if ext in TEXT_EXT and os.path.getsize(full) < 1_500_000:
                    yield full

rows = []
for path in walk():
    rel = os.path.relpath(path, ROOT).replace("\\", "/")
    if rel.startswith("doc/release-audit/"):
        continue
    try:
        lines = open(path, encoding="utf-8", errors="replace").read().split("\n")
    except OSError:
        continue
    for i, line in enumerate(lines, 1):
        for name, rx in COMPILED.items():
            for m in rx.finditer(line):
                snippet = line.strip()[:220]
                rows.append([name, rel, i, m.group(0), snippet])

out = os.path.join(ROOT, "doc/release-audit/staleness/raw-retired-hits.csv")
with open(out, "w", newline="\n", encoding="utf-8") as fh:
    w = csv.writer(fh)
    w.writerow(["term", "file", "line", "match", "snippet"])
    w.writerows(rows)

from collections import Counter
c = Counter(r[0] for r in rows)
print(len(rows), "hits")
for k, v in c.most_common():
    print(f"{k}\t{v}")
print("files:", len({r[1] for r in rows}))
