"""Cross-tab fact matrix for the release coherence audit.

For each captured variant, read the on-screen text of every Evidence tab and top-level view, pull out
facts that more than one screen states (transcripts, protein change, criterion codes, scores, pLDDT,
structure counts), and list every fact whose value differs between screens. The engine's own
criteria (from the analysis stream) are the reference for criterion codes.

Usage: python -I fact_matrix.py <raw-dir> <out-dir>
"""
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

PATTERNS = {
    "transcript_enst": r"\bENST\d{11}(?:\.\d+)?\b",
    "transcript_nm": r"\bNM_\d+(?:\.\d+)?\b",
    "protein_np": r"\bNP_\d+(?:\.\d+)?\b",
    "protein_change": r"\bp\.\(?[A-Z][a-z]{2}\d+[A-Z][a-z]{2}\)?",
    "revel": r"\bREVEL\b[^0-9\n]{0,25}(\d\.\d{2,3})",
    "alphamissense": r"\bAlphaMissense\b[^0-9\n]{0,25}(\d\.\d{2,3})",
    "bayesdel": r"\bBayesDel\b[^0-9\n-]{0,25}(−?-?\d\.\d{2,3})",
    "cadd": r"\bCADD\b[^0-9\n]{0,25}(\d{1,2}\.\d)",
    "plddt": r"\bpLDDT\b[^0-9\n]{0,20}(\d{1,3}(?:\.\d)?)",
    "solved_k_of_n": r"\b(\d+) of (\d+) solved structures?",
    "regional_oe": r"\b(?:Regional )?O/E\b[^0-9\n]{0,12}(\d\.\d{2,3})",
    "grpmax_faf": r"\bFAF95\b[^0-9\n]{0,40}(\d[\d.e−-]*%?)",
}
# Criterion codes with an optional strength, either "PP3_Moderate" or "PP3 · Moderate" / "PP3 Moderate".
CRIT = re.compile(r"\b(PVS1|PS[1-4]|PM[1-6]|PP[1-5]|BA1|BS[1-4]|BP[1-7])(?:(?:_| · | )(Very ?Strong|Strong|Moderate|Supporting|Stand-alone))?\b")
GENE_ALIASES = {"GBA1": r"\bGBA\b(?!1)"}


def norm_strength(code: str, strength: str | None) -> str:
    return f"{code}_{strength.replace(' ', '')}" if strength else code


def screens(variant_dir: Path) -> dict[str, str]:
    out = {}
    for sub in ("tabs", "views"):
        for f in sorted((variant_dir / sub).glob("*.txt")):
            out[f"{sub}/{f.stem}"] = f.read_text(encoding="utf-8", errors="replace")
    return out


def engine_criteria(variant_dir: Path) -> list[str]:
    """The last non-empty criteria list any analysis response carried (the structural pass merges last)."""
    last: list[str] = []
    for f in sorted((variant_dir / "api").glob("*analyze-variant*.json")):
        text = json.dumps(json.loads(f.read_text(encoding="utf-8")).get("body"))
        for m in re.finditer(r'acmgCriteria\\*"\s*:\s*(\[.*?\])\s*,\s*\\*"insilicoHasPvs1', text):
            codes = re.findall(r'code\\*"\s*:\s*\\*"([A-Za-z0-9_]+)', m.group(1))
            if codes:
                last = codes
    return last


def stated_records(text: str) -> list[str]:
    """What a screen says the engine recorded: the 'Engine record' line of Insights and Report."""
    return [m.group(1).strip() for m in re.finditer(r"Engine record\n(.+?)\. Tier:", text)]


def facts_for(text: str) -> dict[str, set[str]]:
    found: dict[str, set[str]] = defaultdict(set)
    for fact, pat in PATTERNS.items():
        for m in re.finditer(pat, text):
            found[fact].add("/".join(m.groups()) if m.groups() else m.group(0).strip("()"))
    for m in CRIT.finditer(text):
        found[f"criterion:{m.group(1)}"].add(norm_strength(m.group(1), m.group(2)))
    return found


def analyse(variant_dir: Path, gene: str) -> dict:
    per_screen = {name: facts_for(text) for name, text in screens(variant_dir).items()}
    by_fact: dict[str, dict[str, list[str]]] = defaultdict(dict)
    for name, facts in per_screen.items():
        for fact, values in facts.items():
            by_fact[fact][name] = sorted(values)
    conflicts = {}
    for fact, sites in by_fact.items():
        distinct = {v for vs in sites.values() for v in vs}
        # A bare code ("PP3") beside a graded one ("PP3_Moderate") is not a conflict; two grades are.
        graded = {v for v in distinct if "_" in v} if fact.startswith("criterion:") else distinct
        if len(graded) > 1:
            conflicts[fact] = sites
    aliases = {}
    for name, pat in GENE_ALIASES.items():
        if gene == name:
            hits = [s for s, t in screens(variant_dir).items() if re.search(pat, t)]
            if hits:
                aliases[name] = hits
    records = {s: r for s, t in screens(variant_dir).items() if (r := stated_records(t))}
    return {"engine_criteria": engine_criteria(variant_dir), "stated_records": records, "conflicts": conflicts,
            "retired_symbol_on": aliases, "screens": len(per_screen), "by_fact": by_fact}


def main(raw: Path, out: Path) -> None:
    panel = {v["id"]: v for v in json.loads((raw.parent / "panel.json").read_text(encoding="utf-8"))["variants"]}
    out.mkdir(parents=True, exist_ok=True)
    lines = ["# Fact matrix: values that differ between screens", ""]
    for vid, v in panel.items():
        d = raw / vid
        if not (d / "tabs").exists():
            lines.append(f"## {vid}: not captured\n")
            continue
        res = analyse(d, v["gene"])
        (out / f"{vid}.json").write_text(json.dumps(res, indent=1, default=sorted), encoding="utf-8", newline="\n")
        lines.append(f"## {vid} ({res['screens']} screens) — engine criteria: {', '.join(res['engine_criteria']) or 'none read'}")
        for screen, recs in sorted(res["stated_records"].items()):
            lines.append(f"- stated on `{screen}`: {' | '.join(recs)}")
        for fact, sites in sorted(res["conflicts"].items()):
            if fact.startswith("criterion:"):
                continue  # legends list every grade; criterion agreement is checked through stated records
            lines.append(f"- **{fact}**: " + "; ".join(f"`{s}` {', '.join(vs)}" for s, vs in sorted(sites.items())))
        for name, hits in res["retired_symbol_on"].items():
            lines.append(f"- **retired symbol for {name}** on: {', '.join(hits)}")
        lines.append("")
    (out / "README.md").write_text("\n".join(lines), encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main(Path(sys.argv[1]), Path(sys.argv[2]))
