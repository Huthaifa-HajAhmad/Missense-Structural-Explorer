# Task B extraction: one row per top-level doc/*.md with date, title, size, code references and whether they exist.
import csv, glob, os, re, subprocess, sys
sys.stdout.reconfigure(encoding="utf-8")
ROOT = "C:/Users/HSA19/antigravity/release-coherence-audit"
os.chdir(ROOT)

DATE_RX = re.compile(r"\b(20\d\d-\d\d-\d\d)\b")
PATH_RX = re.compile(r"`((?:server|src|tests|scripts|tools|deploy|public|doc|data|\.agents)/[^`\s]+|[\w.-]+\.(?:ts|tsx|js|mjs|py|sh|json|csv|md|yml|html|css))`")
IDENT_RX = re.compile(r"`((?:[a-z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*|[A-Z][a-z]+[A-Z][A-Za-z0-9]*)(?:\(\))?)`")  # camelCase / PascalCase
FN_RX = re.compile(r"`([A-Za-z_][A-Za-z0-9_]*)\(")  # `name(` anywhere

# Every word in src/ and server/ (the same test as grep -w).
words = set()
for base in ("src", "server"):
    for dp, dn, fn in os.walk(os.path.join(ROOT, base)):
        dn[:] = [d for d in dn if d != "node_modules"]
        for f in fn:
            if f.endswith((".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py")):
                with open(os.path.join(dp, f), encoding="utf-8", errors="replace") as fh:
                    words.update(re.findall(r"[A-Za-z_][A-Za-z0-9_]*", fh.read()))

TRACKED = set(subprocess.run(["git", "ls-files"], capture_output=True, text=True).stdout.split("\n"))
TRACKED_BASENAMES = {t.rsplit("/", 1)[-1] for t in TRACKED}

def path_exists(p):
    if "/" in p:
        return p in TRACKED or os.path.exists(os.path.join(ROOT, p))
    return p in TRACKED_BASENAMES

def git_date(path):
    return subprocess.run(["git", "log", "-1", "--format=%cs", "--", path], capture_output=True, text=True).stdout.strip()

rows = []
for path in sorted(glob.glob("doc/*.md")):
    text = open(path, encoding="utf-8", errors="replace").read()
    name = os.path.basename(path)
    m = DATE_RX.search(text)
    title_m = re.search(r"^#\s+(.+)$", text, re.M)
    title = title_m.group(1).strip() if title_m else ""
    refs_paths = sorted(set(PATH_RX.findall(text)))
    missing_paths = [p for p in refs_paths if not path_exists(p)]
    ids = sorted(set(IDENT_RX.findall(text)) | set(FN_RX.findall(text)))
    ids = [i.replace("()", "") for i in ids]
    missing_ids = [i for i in ids if i not in words]
    rows.append([f"doc/{name}", m.group(1) if m else "", git_date(f"doc/{name}"), title, len(text.encode("utf-8")),
                 len(refs_paths), ";".join(missing_paths), len(ids), ";".join(missing_ids)])

with open(ROOT + "/doc/release-audit/staleness/doc-extract.csv", "w", newline="\n", encoding="utf-8") as fh:
    w = csv.writer(fh)
    w.writerow(["doc", "date_first", "date_git", "title", "bytes", "n_paths", "missing_paths", "n_ids", "missing_ids"])
    w.writerows(rows)
print(len(rows), "docs")
