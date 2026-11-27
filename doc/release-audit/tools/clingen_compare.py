"""Compare the app's criteria with ClinGen expert-panel (VCEP) criteria for the panel's ClinGen variants.

Only criteria the app can compute are compared. Each row says whether the app and the panel agree,
differ in strength, or one applies a criterion the other does not. Differences are not automatically
app errors: a VCEP may use gene-specific rules, and some criteria need case data the app never sees.

Usage: python -I clingen_compare.py <audit-dir>
"""
import json
import sys
from pathlib import Path

COMPUTABLE = ["PP3", "BP4", "PM2", "PM1", "BS1", "BA1", "PP2", "BS2", "BP1", "PM5", "PS1"]


def base(code: str) -> str:
    return code.split("_")[0]


def by_base(codes: list[str]) -> dict[str, str]:
    return {base(c): c for c in codes}


def engine_codes(audit: Path, vid: str) -> list[str] | None:
    f = audit / "fact-matrix" / f"{vid}.json"
    if not f.exists():
        return None
    return json.loads(f.read_text(encoding="utf-8"))["engine_criteria"]


def compare(vcep: dict, app: list[str]) -> list[tuple[str, str, str, str]]:
    met, not_met, mine = by_base(vcep["met"]), {base(c) for c in vcep["notMet"]}, by_base(app)
    rows = []
    for crit in COMPUTABLE:
        v = met.get(crit) or ("not met" if crit in not_met else "not stated")
        a = mine.get(crit, "not applied")
        if crit in met and crit in mine:
            verdict = "agree" if met[crit].replace("_Supporting", "") == mine[crit].replace("_Supporting", "") or met[crit] == mine[crit] else "strength differs"
        elif crit in met:
            verdict = "app misses"
        elif crit in mine:
            verdict = "app extra" if crit in not_met else "app only (panel silent)"
        else:
            verdict = "agree (neither)" if crit in not_met else "-"
        if verdict != "-":
            rows.append((crit, v, a, verdict))
    return rows


def main(audit: Path) -> None:
    panel = json.loads((audit / "panel.json").read_text(encoding="utf-8"))["variants"]
    out = ["# ClinGen expert-panel comparison", "",
           "Criteria the app can compute only. 'app misses' = the panel applied it and the app did not.", ""]
    totals: dict[str, int] = {}
    for v in (p for p in panel if p["set"] == "clingen"):
        app = engine_codes(audit, v["id"])
        out.append(f"## {v['id']} — panel: {v['vcep']['assertion']}")
        if app is None:
            out += ["Not captured.", ""]
            continue
        out.append(f"App engine criteria: {', '.join(app) or 'none'}")
        out += ["", "| Criterion | Panel | App | Result | Reason (lead) |", "|---|---|---|---|---|"]
        for crit, pv, av, verdict in compare(v["vcep"], app):
            totals[verdict] = totals.get(verdict, 0) + 1
            out.append(f"| {crit} | {pv} | {av} | {verdict} |  |")
        out.append("")
    out.insert(3, "Totals: " + ", ".join(f"{k} {n}" for k, n in sorted(totals.items())) + "\n")
    (audit / "clingen").mkdir(exist_ok=True)
    (audit / "clingen" / "comparison.md").write_text("\n".join(out), encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
