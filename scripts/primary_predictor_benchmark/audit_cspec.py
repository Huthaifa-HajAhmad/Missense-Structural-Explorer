"""Audit all SequenceVariantInterpretation specs in the ClinGen CSpec Registry."""
from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
import time
import urllib.error
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import metrics as m  # noqa: E402

LIST_URL = "https://cspec.genome.network/cspec/SequenceVariantInterpretation/id?pg={pg}&pgSize={pg_size}"
DETAIL_URL = "https://cspec.genome.network/cspec/api/SequenceVariantInterpretation/id/{ent_id}?detail=high"


def fetch_json(url: str, retries: int = 4) -> dict[str, Any]:
    last_err: Exception | None = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(
                url, headers={"Accept": "application/json", "User-Agent": "MissenseExplorer-Phase5a"}
            )
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as err:
            last_err = err
            time.sleep(1.0 * (attempt + 1))
    raise RuntimeError(f"Failed fetching {url}: {last_err}")


def list_all_svi_ids(pg_size: int = 100) -> list[str]:
    ids: list[str] = []
    pg = 1
    while True:
        payload = fetch_json(LIST_URL.format(pg=pg, pg_size=pg_size))
        rows = payload.get("data") or []
        if not rows:
            break
        for row in rows:
            ent_id = row.get("entId")
            if ent_id:
                ids.append(str(ent_id))
        if len(rows) < pg_size:
            break
        pg += 1
    return ids


def fetch_or_load_svi(ent_id: str, cache_dir: Path) -> dict[str, Any]:
    cache_path = cache_dir / f"{ent_id}.json"
    if cache_path.exists():
        return json.loads(cache_path.read_text(encoding="utf-8"))
    doc = fetch_json(DETAIL_URL.format(ent_id=ent_id))
    cache_path.write_text(json.dumps(doc, indent=2), encoding="utf-8")
    return doc


def render_cspec_summary(audit: dict[str, Any]) -> str:
    lines = [
        "# ClinGen CSpec Registry PP3/BP4 Override Audit",
        "",
        f"Audited: {audit['audited_at']}",
        "",
        f"- Total SVI records fetched: {audit['total_svis']}",
        f"- Status breakdown: {audit['status_counts']}",
        f"- Active Released (non-legacy) VCEP specs: {audit['active_released_count']}",
        f"- Unique genes covered by active Released specs: {audit['active_unique_gene_count']}",
        "",
        "## Tools Mentioned Across Active Released PP3/BP4 Specifications",
        "",
        "| Tool / Family | Active Released Specs Mentioning |",
        "|---|---:|",
    ]
    for tool, cnt in audit["active_tool_spec_counts"].items():
        lines.append(f"| {tool} | {cnt} |")
    lines.extend(
        [
            "",
            "## Active Released Specs by Gene & Tool",
            "",
            "| CSpec ID | VCEP / Spec | Genes | PP3 Strengths | BP4 Strengths | Tools Mentioned |",
            "|---|---|---|---|---|---|",
        ]
    )
    for spec in audit["active_specs"]:
        genes_str = ", ".join(spec["genes"]) if spec["genes"] else "*(none listed)*"
        pp3_str = ", ".join(spec["pp3_applicable"]) or "—"
        bp4_str = ", ".join(spec["bp4_applicable"]) or "—"
        tools_str = ", ".join(spec["tools_mentioned"]) or "*(none)*"
        lines.append(
            f"| {spec['cspec_id']} (v{spec['version']}) | {spec['vcep'] or spec['label']} | "
            f"{genes_str} | {pp3_str} | {bp4_str} | {tools_str} |"
        )
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description="Audit ClinGen CSpec SVI PP3/BP4 rules")
    parser.add_argument(
        "--outdir",
        type=Path,
        default=Path("logs/primary_predictor_bench"),
    )
    parser.add_argument("--workers", type=int, default=8)
    args = parser.parse_args()

    cache_dir = args.outdir / "cspec_raw"
    cache_dir.mkdir(parents=True, exist_ok=True)

    svi_ids = list_all_svi_ids()
    print(f"Found {len(svi_ids)} SVI entries; fetching details...", flush=True)

    docs_by_id: dict[str, dict[str, Any]] = {}
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futs = {pool.submit(fetch_or_load_svi, eid, cache_dir): eid for eid in svi_ids}
        for fut in as_completed(futs):
            eid = futs[fut]
            docs_by_id[eid] = fut.result()

    parsed = [m.parse_cspec_svi_record(docs_by_id[eid]) for eid in svi_ids]
    status_counts = Counter((p["status"], p["legacy"]) for p in parsed)
    active = [p for p in parsed if p["is_active_released"]]

    tool_counts: Counter[str] = Counter()
    gene_to_specs: dict[str, list[str]] = {}
    for p in active:
        for t in p["tools_mentioned"]:
            tool_counts[t] += 1
        for g in p["genes"]:
            gene_to_specs.setdefault(g, []).append(p["cspec_id"])

    audit = {
        "audited_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "total_svis": len(parsed),
        "status_counts": {f"{k[0]}|legacy={k[1]}": v for k, v in status_counts.items()},
        "active_released_count": len(active),
        "active_unique_gene_count": len(gene_to_specs),
        "active_tool_spec_counts": dict(tool_counts.most_common()),
        "gene_to_active_specs": gene_to_specs,
        "active_specs": active,
        "all_specs_summary": [
            {
                "cspec_id": p["cspec_id"],
                "version": p["version"],
                "status": p["status"],
                "legacy": p["legacy"],
                "genes": p["genes"],
                "tools_mentioned": p["tools_mentioned"],
            }
            for p in parsed
        ],
    }

    out_json = args.outdir / "cspec_audit.json"
    out_md = args.outdir / "cspec_summary.md"
    out_json.write_text(json.dumps(audit, indent=2), encoding="utf-8")
    out_md.write_text(render_cspec_summary(audit), encoding="utf-8")
    print(
        f"Audited {len(parsed)} SVIs ({len(active)} active Released covering {len(gene_to_specs)} genes) -> {out_json}",
        flush=True,
    )


if __name__ == "__main__":
    main()
