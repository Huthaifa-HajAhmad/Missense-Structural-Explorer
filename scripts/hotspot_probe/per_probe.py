"""Gene-wise PER (Perez-Palma 2020) re-run on current gnomAD v4 + ClinVar, mirroring
dlal-group/PERs Part-2-burden-analysis.R: bin=4 (9-aa window), window centres every 5 aa,
2x2 Fisher one-sided 'greater' on residue-hit counts in/out of window (patient vs population),
Bonferroni over windows, adj.p < 0.05 -> PER; consecutive significant windows merged.
Feasibility probe only. Usage: python -I per_probe.py SOD1 NAE1
"""
import json, re, sys, urllib.request
from math import lgamma, exp

API = "https://gnomad.broadinstitute.org/api"
Q = """query($gene: String!) { gene(gene_symbol: $gene, reference_genome: GRCh38) {
  canonical_transcript_id
  clinvar_variants { clinical_significance hgvsp transcript_id gold_stars }
  variants(dataset: gnomad_r4) { consequence hgvsp transcript_id exome { ac filters } genome { ac filters } }
} }"""
AA3 = "Ala Arg Asn Asp Cys Gln Glu Gly His Ile Leu Lys Met Phe Pro Ser Thr Trp Tyr Val".split()
MISSENSE = re.compile(r"^p\.(%s)(\d+)(%s)$" % ("|".join(AA3), "|".join(AA3)))


def gql(gene):
    req = urllib.request.Request(API, json.dumps({"query": Q, "variables": {"gene": gene}}).encode(),
                                 {"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=120))["data"]["gene"]


def residue(h):
    m = MISSENSE.match(h or "")
    return int(m.group(2)) if m and m.group(1) != m.group(3) else None


def plp(sig):
    s = (sig or "").lower()
    return "conflicting" not in s and "pathogenic" in s and "benign" not in s


def logc(n, k):
    return lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1)


def fisher_greater(a, b, c, d):
    # P(X >= a) for table [[a, c], [b, d]]: rows clinvar/gnomad, cols in/out.
    r1, c1, n = a + c, a + b, a + b + c + d
    lo, hi = max(0, c1 - (n - r1)), min(r1, c1)
    den = logc(n, c1)
    return min(1.0, sum(exp(logc(r1, x) + logc(n - r1, c1 - x) - den) for x in range(a, hi + 1)))


def burden(patient, population, length):
    """Pure PER burden test on residue sets; mirrors src/shared/perBurden.ts. No network."""
    P = {r for r in patient if 1 <= r <= length}
    N = {r for r in population if 1 <= r <= length}
    tc, tg = len(P), len(N)
    wins = []
    for centre in range(5, length - 4 + 1, 5):
        rng = range(centre - 4, centre + 5)
        a = sum(r in P for r in rng)
        b = sum(r in N for r in rng)
        wins.append({"centre": centre, "start": centre - 4, "end": centre + 4, "patient": a, "population": b,
                     "p": fisher_greater(a, b, tc - a, tg - b)})
    m = len(wins)
    for w in wins:
        w["adjP"] = min(1.0, w["p"] * m)
    groups = []  # [first centre, last centre, min adjP] for each run of significant centres
    for w in wins:
        if w["adjP"] < 0.05:
            if groups and w["centre"] - groups[-1][1] <= 5:
                groups[-1][1] = w["centre"]
                groups[-1][2] = min(groups[-1][2], w["adjP"])
            else:
                groups.append([w["centre"], w["centre"], w["adjP"]])
    regions = [{"start": s - 4, "end": e + 4, "minAdjP": q} for s, e, q in groups]
    return {"length": length, "patientResidues": tc, "populationResidues": tg, "windows": wins, "regions": regions}


def run(gene, length_hint=None):
    g = gql(gene)
    tx = (g["canonical_transcript_id"] or "").split(".")[0]
    on = lambda r: not tx or not r.get("transcript_id") or r["transcript_id"].split(".")[0] == tx
    pat = {residue(r["hgvsp"]) for r in g["clinvar_variants"] if on(r) and plp(r["clinical_significance"])} - {None}
    pop_all, pop_pass = set(), set()
    for r in g["variants"]:
        if not on(r) or r.get("consequence") != "missense_variant":
            continue
        p = residue(r["hgvsp"])
        if p is None:
            continue
        for src in (r.get("exome"), r.get("genome")):
            if src and (src.get("ac") or 0) > 0:
                pop_all.add(p)
                if not src.get("filters"):
                    pop_pass.add(p)
    L = max([*pat, *pop_all, length_hint or 0])
    # The app windows over the AlphaFold model's length; this probe has no model, so without an explicit
    # --length it falls back to the last observed variant. That changes the window count and the
    # Bonferroni m, so a parity claim needs the same length on both sides.
    if not length_hint:
        print(f"[warn] {gene}: no --length given; using the last observed residue ({L}). The app uses the "
              f"AlphaFold model length, so window counts and adjusted p-values can differ.", file=sys.stderr)
    out = {"gene": gene, "transcript": tx, "length_seen": L, "patient_residues": len(pat),
           "population_residues_pass": len(pop_pass), "population_residues_any": len(pop_all)}
    for label, pop in (("PASS-only (as published)", pop_pass),):
        res = burden(pat, pop, L)
        wins = res["windows"]
        best = min(wins, key=lambda w: w["p"]) if wins else None
        out[label] = {"windows": len(wins), "PERs": [{"start": r["start"], "end": r["end"], "min_adj_p": r["minAdjP"]} for r in res["regions"]],
                      "best_window": [best["centre"], best["patient"], best["population"], best["p"]] if best else None}
    return out


if __name__ == "__main__":
    # `per_probe.py GENE... [--length N]`: N is the AlphaFold model's residue count, the axis the app windows over.
    args = sys.argv[1:]
    length = None
    if "--length" in args:
        i = args.index("--length")
        length = int(args[i + 1])
        del args[i:i + 2]
    for gene in args:
        print(json.dumps(run(gene, length), indent=1))
