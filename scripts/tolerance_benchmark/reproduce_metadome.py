"""Recompute MetaDome 2027's GRCh38 tolerance landscape from public gnomAD v4.1 and compare it with the
Zenodo deposit, codon by codon.

  python -I scripts/tolerance_benchmark/reproduce_metadome.py

MetaDome's code (release e8ec9a8, Zenodo 10.5281/zenodo.23384270) counts distinct SNV alleles from
gnomad.joint.v4.1.sites.exomes.vcf.gz with FILTER == PASS (GNOMAD_ACCEPTED_FILTERS), keeps AF_exomes >= 0
(min_frequency 0.0), classifies each against the transcript codon, and scores a 21-residue window with
((mis+1)/(mis_bg+1)) / ((syn+1)/(syn_bg+1)). Which gnomAD API fields equal that VCF filter is not documented,
so the candidate rules below are declared up front and each is reported; the verdict is "exact" only if one
rule reproduces every codon of SOD1 to 1e-9.
"""
import gzip
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from metrics import codon_background, tolerance_landscape  # noqa: E402
from sources import CODON  # noqa: E402

RULES = {
    "joint_pass_exome_ac": lambda s: s["jointFilters"] == [] and (s["exomeAc"] or 0) > 0,
    "joint_pass_exome_present": lambda s: s["jointFilters"] == [] and s["exomeAc"] is not None,
    "joint_pass_any": lambda s: s["jointFilters"] == [] and s["jointAc"] is not None,
    "exome_pass_ac": lambda s: s["exomeFilters"] == [] and (s["exomeAc"] or 0) > 0,
    "exome_present_any_filter": lambda s: s["exomeAc"] is not None,
    "inhouse_exome_or_genome_pass": lambda s: ((s["exomeAc"] or 0) > 0 and s["exomeFilters"] == []) or ((s["genomeAc"] or 0) > 0 and s["genomeFilters"] == []),
}


def recompute(rec, rule):
    L = len(rec["protein"])
    cds = rec["cds"]
    mis_bg, syn_bg = zip(*(codon_background(cds[3 * i:3 * i + 3], CODON) for i in range(L)))
    mis, syn = [0] * L, [0] * L
    for s in rec["snvs"]:
        if not rule(s) or not 1 <= s["residue"] <= L:
            continue
        # MetaDome classifies start-codon changes as missense (codon_background_rates['ATG'] missense 9).
        if s["csq"] in ("missense",):
            mis[s["residue"] - 1] += 1
        elif s["csq"] == "synonymous":
            syn[s["residue"] - 1] += 1
    return tolerance_landscape(mis, syn, list(mis_bg), list(syn_bg), half=10)


def compare(rec, scores):
    dep = rec["candidates"]["metadomeRaw"]
    diffs = []
    for k, v in dep.items():
        r = int(k)
        if v["sw_dn_ds"] is None or not 1 <= r <= len(scores):
            continue
        diffs.append((abs(scores[r - 1] - v["sw_dn_ds"]), r, scores[r - 1], v["sw_dn_ds"]))
    exact = sum(1 for d in diffs if d[0] < 1e-9)
    worst = max(diffs) if diffs else None
    return {"codons": len(diffs), "exact": exact, "exactFraction": exact / len(diffs) if diffs else None,
            "maxAbsDiff": worst[0] if worst else None, "worstResidue": worst[1] if worst else None,
            "worstRecomputed": worst[2] if worst else None, "worstDeposited": worst[3] if worst else None}


def main():
    out = {"method": __doc__.strip().splitlines()[0], "genes": {}}
    for g in ("SOD1", "BRCA1", "RYR2", "LDLR"):
        path = HERE / "data" / f"{g}.json.gz"
        if not path.exists():
            continue
        with gzip.open(path, "rt", encoding="utf-8") as fh:
            rec = json.load(fh)
        out["genes"][g] = {name: compare(rec, recompute(rec, rule)) for name, rule in RULES.items()}
    sod1 = out["genes"].get("SOD1", {})
    best = max(sod1.items(), key=lambda kv: kv[1]["exactFraction"] or 0) if sod1 else None
    out["bestRuleSOD1"] = best[0] if best else None
    out["verdict"] = "exact" if best and best[1]["exactFraction"] == 1.0 else "not reproduced"
    if best and out["verdict"] == "exact":
        out["sameRuleOtherGenes"] = {g: v[best[0]] for g, v in out["genes"].items()}
    (HERE / "reproduction.json").write_text(json.dumps(out, indent=1))
    print(json.dumps({"verdict": out["verdict"], "bestRuleSOD1": out["bestRuleSOD1"],
                      "byGene": {g: {r: (v["exact"], v["codons"], round(v["maxAbsDiff"], 6)) for r, v in rules.items()} for g, rules in out["genes"].items()}}, indent=1))


if __name__ == "__main__":
    main()
