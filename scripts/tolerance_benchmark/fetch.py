"""Build the per-gene benchmark slices in data/. Network step; run once, commit the output.

  python -I scripts/tolerance_benchmark/fetch.py [--genes SOD1,BRCA1,RYR2,LDLR] [--skip-bulk]

For each gene it records, with provenance:
  - the GRCh38 MANE transcript model from Ensembl (id AND version checked against sources.GENES) and the
    codon -> genomic position map built from it; the GRCh37 model of the same transcript id, kept only
    if it encodes the identical protein (the bridge CCR needs);
  - every gnomAD v4.1 SNV in the CDS (gnomAD GraphQL, the source the Landscape tab already calls), with
    its consequence recomputed on the MANE codon, so a most-severe-consequence on another transcript
    cannot leak in;
  - every ClinVar SNV in the CDS from the same API, classified with the tab's own rule;
  - the candidate scores, sliced by streaming the full public files and checking their hashes;
  - the v4.1.1 regional missense intervals from the app's pinned snapshot, projected per codon.

Bulk sources are streamed and never stored; only the gene rows survive (the "pre-slice per gene at build"
pattern a production ingest would follow).
"""
import argparse
import gzip
import hashlib
import io
import json
import sys
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from sources import (CCR, COMPLEMENT, ENSEMBL_37, ENSEMBL_38, GENES, GNOMAD_API, METADOME_FINAL,  # noqa: E402
                     MTR3DAF2, classify_clinvar, translate)

REPO = HERE.parent.parent
SNAPSHOT = REPO / "server" / "data" / "constraint" / "gnomad-4.1.2.json.gz"
UA = {"User-Agent": "missense-fold-tolerance-benchmark/1.0"}


def get(url, headers=None, data=None, timeout=180, tries=4):
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers={**UA, **(headers or {})})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception:
            if attempt == tries - 1:
                raise
            time.sleep(3 * (attempt + 1))


def gnomad(query):
    body = json.dumps({"query": query}).encode()
    out = json.loads(get(GNOMAD_API, {"Content-Type": "application/json"}, body))
    if out.get("errors"):
        raise RuntimeError(out["errors"][0].get("message"))
    return out["data"]


def ensembl_model(base, tx):
    meta = json.loads(get(f"{base}/lookup/id/{tx}?expand=1;content-type=application/json"))
    cds = get(f"{base}/sequence/id/{tx}?type=cds;content-type=text/plain").decode().strip()
    strand = meta["strand"]
    lo, hi = meta["Translation"]["start"], meta["Translation"]["end"]
    exons = sorted(((e["start"], e["end"]) for e in meta["Exon"]), reverse=strand < 0)
    positions = []
    for s, e in exons:
        a, b = max(s, lo), min(e, hi)
        if a > b:
            continue
        positions.extend(range(a, b + 1) if strand > 0 else range(b, a - 1, -1))
    if len(positions) != len(cds):
        raise RuntimeError(f"{tx}: CDS model {len(positions)} bp != sequence {len(cds)} bp")
    protein = translate(cds)
    if protein.endswith("*"):
        protein = protein[:-1]
    if "*" in protein:
        raise RuntimeError(f"{tx}: internal stop in translated CDS")
    return {"version": str(meta["version"]), "assembly": meta["assembly_name"], "chrom": str(meta["seq_region_name"]),
            "strand": strand, "cds": cds, "positions": positions, "protein": protein}


def classify_snv(model, pos, ref, alt, index):
    """Consequence of a genomic SNV on this transcript, or None when it is outside the CDS or REF disagrees."""
    i = index.get(pos)
    if i is None or len(ref) != 1 or len(alt) != 1:
        return None
    cref = ref if model["strand"] > 0 else COMPLEMENT.get(ref)
    calt = alt if model["strand"] > 0 else COMPLEMENT.get(alt)
    if cref != model["cds"][i]:
        return {"refMismatch": True}
    c0 = i - i % 3
    codon = model["cds"][c0:c0 + 3]
    alt_codon = codon[:i % 3] + calt + codon[i % 3 + 1:]
    a, b = translate(codon), translate(alt_codon)
    residue = c0 // 3 + 1
    if a == "*":
        csq = "stop_lost"
    elif b == "*":
        csq = "stop_gained"
    elif a == b:
        csq = "synonymous"
    else:
        csq = "missense"
    return {"residue": residue, "codon": codon, "altCodon": alt_codon, "codonPos": i % 3, "csq": csq, "refAa": a, "altAa": b}


def stream_rows(url, check):
    """Yield decoded lines of a remote gzip file while hashing the compressed bytes; verify at the end."""
    algo, expected = check
    h = hashlib.new(algo)
    req = urllib.request.Request(url, headers=UA)
    resp = urllib.request.urlopen(req, timeout=600)

    class Tee(io.RawIOBase):
        def readable(self):
            return True

        def readinto(self, b):
            d = resp.read(len(b))
            h.update(d)
            b[:len(d)] = d
            return len(d)

    for raw in gzip.GzipFile(fileobj=io.BufferedReader(Tee(), 1 << 20)):
        yield raw.decode("utf-8")
    while True:
        d = resp.read(1 << 20)
        if not d:
            break
        h.update(d)
    if h.hexdigest() != expected:
        raise RuntimeError(f"{url}: {algo} {h.hexdigest()} != pinned {expected}")


def slice_metadome(genes):
    keep = {g: {} for g in genes}
    want = {GENES[g]["transcript"] + "." + GENES[g]["version"]: g for g in genes}
    cols = None
    for line in stream_rows(METADOME_FINAL["url"], ("md5", METADOME_FINAL["md5"])):
        if line.startswith("#"):
            continue
        f = line.rstrip("\n").split("\t")
        if cols is None:
            cols = {c: i for i, c in enumerate(f)}
            continue
        g = want.get(f[cols["gencode_transcription_id"]])
        if not g:
            continue
        pos = int(f[cols["protein_pos"]])
        # A codon split over an exon boundary, or placed in several domains, repeats; the score is per codon.
        keep[g].setdefault(pos, {"sw_dn_ds": float(f[cols["sw_dn_ds"]]) if f[cols["sw_dn_ds"]] else None,
                                 "sw_coverage": float(f[cols["sw_coverage"]]) if f[cols["sw_coverage"]] else None,
                                 "ref_aa": f[cols["ref_aa"]], "ref_codon": f[cols["ref_codon"]],
                                 "protein_ac": f[cols["protein_ac"]]})
    return keep


def slice_mtr3daf2(genes):
    want = {GENES[g]["uniprot"]: g for g in genes}
    keep = {g: {} for g in genes}
    cols = None
    for line in stream_rows(MTR3DAF2["url"], ("sha256", MTR3DAF2["sha256"])):
        f = line.rstrip("\r\n").split(",")
        if cols is None:
            cols = {c: i for i, c in enumerate(f)}
            continue
        g = want.get(f[cols["uniprot"]])
        if not g:
            continue
        num = lambda k: float(f[cols[k]]) if f[cols[k]] not in ("", "NA", "nan") else None  # noqa: E731
        keep[g][int(f[cols["aa_num"]])] = {"transcript": f[cols["transcript"]], "resid": f[cols["resid"]],
                                           "plddt": num("mean_pLDDT"), "a5": num("mtr3daf2_5a"), "a8": num("mtr3daf2_8a"),
                                           "a11": num("mtr3daf2_11a"), "a14": num("mtr3daf2_14a")}
    return keep


def slice_ccr(windows):
    """windows: gene -> (chrom, lo, hi) on GRCh37. Keeps rows by coordinate, not by gene label."""
    keep = {g: [] for g in windows}
    for line in stream_rows(CCR["url"], ("sha256", CCR["sha256"])):
        if line.startswith("#"):
            continue
        f = line.rstrip("\n").split("\t")
        for g, (chrom, lo, hi) in windows.items():
            if f[0] == chrom and int(f[2]) >= lo and int(f[1]) <= hi:
                keep[g].append({"start0": int(f[1]), "end": int(f[2]), "pct": float(f[3]), "gene": f[4], "varflag": f[6]})
    return keep


def gnomad_gene(symbol):
    q = ("{ meta { clinvar_release_date } gene(gene_symbol:\"%s\", reference_genome:GRCh38){ gene_id gene_version "
         "mane_select_transcript { ensembl_id ensembl_version } "
         "variants(dataset: gnomad_r4){ variant_id pos ref alt exome { ac an filters } genome { ac an filters } joint { ac an filters } } "
         "clinvar_variants { variant_id pos ref alt clinical_significance gold_stars review_status clinvar_variation_id in_gnomad } } }") % symbol
    return gnomad(q)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--genes", default=",".join(GENES))
    ap.add_argument("--skip-bulk", action="store_true", help="refresh variants/models only; keep existing candidate slices")
    args = ap.parse_args()
    genes = args.genes.split(",")
    out_dir = HERE / "data"
    out_dir.mkdir(exist_ok=True)

    snapshot = json.load(gzip.open(SNAPSHOT))
    snap_rows = {r["transcriptId"]: r for r in snapshot["rows"] if r.get("mane")}

    models, models37, per_gene = {}, {}, {}
    for g in genes:
        pin = GENES[g]
        row = snap_rows.get(pin["transcript"])
        if not row or row["transcriptVersion"] != pin["version"]:
            raise RuntimeError(f"{g}: pinned constraint snapshot does not carry {pin['transcript']}.{pin['version']}")
        m = ensembl_model(ENSEMBL_38, pin["transcript"])
        if m["version"] != pin["version"]:
            raise RuntimeError(f"{g}: Ensembl serves {pin['transcript']}.{m['version']}, pinned {pin['version']}")
        models[g] = m
        m37 = ensembl_model(ENSEMBL_37, pin["transcript"])
        m37["identicalProtein"] = m37["protein"] == m["protein"]
        models37[g] = m37
        print(g, "GRCh38", m["version"], len(m["protein"]), "aa; GRCh37 v", m37["version"], "identical:", m37["identicalProtein"], flush=True)

    for g in genes:
        m = models[g]
        index = {p: i for i, p in enumerate(m["positions"])}
        data = gnomad_gene(g)
        gene = data["gene"]
        mane = gene["mane_select_transcript"]
        if mane["ensembl_id"] != GENES[g]["transcript"] or mane["ensembl_version"] != GENES[g]["version"]:
            raise RuntimeError(f"{g}: gnomAD MANE {mane} differs from pinned")
        snvs, mismatches = [], 0
        for v in gene["variants"]:
            c = classify_snv(m, v["pos"], v["ref"], v["alt"], index)
            if c is None:
                continue
            if c.get("refMismatch"):
                mismatches += 1
                continue
            ex, ge, jo = v.get("exome"), v.get("genome"), v.get("joint")
            snvs.append({"id": v["variant_id"], "pos": v["pos"], "ref": v["ref"], "alt": v["alt"], **c,
                         "exomeAc": ex["ac"] if ex else None, "exomeFilters": ex["filters"] if ex else None,
                         "genomeAc": ge["ac"] if ge else None, "genomeFilters": ge["filters"] if ge else None,
                         "jointAc": jo["ac"] if jo else None, "jointFilters": jo["filters"] if jo else None})
        clinvar, cv_mismatch = [], 0
        for v in gene["clinvar_variants"]:
            c = classify_snv(m, v["pos"], v["ref"], v["alt"], index)
            if c is None:
                continue
            if c.get("refMismatch"):
                cv_mismatch += 1
                continue
            clinvar.append({"id": v["variant_id"], "pos": v["pos"], "ref": v["ref"], "alt": v["alt"], **c,
                            "significance": v["clinical_significance"], "class": classify_clinvar(v["clinical_significance"]),
                            "stars": v["gold_stars"], "review": v["review_status"], "variationId": v["clinvar_variation_id"],
                            "inGnomad": v["in_gnomad"]})
        regions = []
        for r in snapshot["regions"]:
            if r["transcriptId"] != GENES[g]["transcript"]:
                continue
            res = sorted({i // 3 + 1 for i, p in enumerate(m["positions"]) if r["start"] <= p <= r["end"]})
            res = [x for x in res if x <= len(m["protein"])]
            if res:
                regions.append({"start": r["start"], "end": r["end"], "oe": r["oe"], "p": r["p"], "residues": [res[0], res[-1]], "n": len(res)})
        per_gene[g] = {"snvs": snvs, "clinvar": clinvar, "regions": regions, "refMismatch": mismatches, "clinvarRefMismatch": cv_mismatch,
                       "clinvarRelease": data["meta"]["clinvar_release_date"], "geneId": gene["gene_id"] + "." + gene["gene_version"]}
        print(g, "snvs", len(snvs), "clinvar", len(clinvar), "ref mismatches", mismatches, cv_mismatch, "regions", len(regions), flush=True)

    if args.skip_bulk:
        bulk = {g: json.load(gzip.open(out_dir / f"{g}.json.gz", "rt", encoding="utf-8"))["candidates"] for g in genes}
        md = {g: bulk[g]["metadomeRaw"] for g in genes}
        mt = {g: bulk[g]["mtr3daf2Raw"] for g in genes}
        ccr_rows = {g: bulk[g]["ccrRows"] for g in genes}
    else:
        print("streaming MetaDome final dataset (725 MB) ...", flush=True)
        md = {g: {str(k): v for k, v in d.items()} for g, d in slice_metadome(genes).items()}
        print("streaming MTR3D-AF2 bulk (564 MB) ...", flush=True)
        mt = {g: {str(k): v for k, v in d.items()} for g, d in slice_mtr3daf2(genes).items()}
        print("streaming CCR autosomes ...", flush=True)
        win = {g: (models37[g]["chrom"], min(models37[g]["positions"]) - 1, max(models37[g]["positions"])) for g in genes}
        ccr_rows = slice_ccr(win)

    for g in genes:
        m, m37 = models[g], models37[g]
        record = {
            "gene": g,
            "assembly": "GRCh38",
            "transcript": f"{GENES[g]['transcript']}.{m['version']}",
            "uniprot": GENES[g]["uniprot"],
            "protein": m["protein"],
            "strand": m["strand"],
            "chrom": m["chrom"],
            "codonPositions": [m["positions"][3 * i:3 * i + 3] for i in range(len(m["protein"]))],
            "cds": m["cds"][:3 * len(m["protein"])],
            "grch37": {"version": m37["version"], "identicalProtein": m37["identicalProtein"], "chrom": m37["chrom"],
                       "codonPositions": [m37["positions"][3 * i:3 * i + 3] for i in range(len(m37["protein"]))] if m37["identicalProtein"] else None},
            "provenance": {
                "ensembl38": ENSEMBL_38, "ensembl37": ENSEMBL_37, "gnomadApi": GNOMAD_API, "gnomadDataset": "gnomad_r4 (v4.1)",
                "clinvarRelease": per_gene[g]["clinvarRelease"], "geneId": per_gene[g]["geneId"],
                "metadome": METADOME_FINAL, "mtr3daf2": MTR3DAF2, "ccr": CCR,
                "constraintSnapshot": {"release": snapshot["release"], "regionalRelease": snapshot["regionalRelease"],
                                       "sourceSha256": snapshot["sourceSha256"], "regionalSha256": snapshot["regionalSha256"]},
                "fetched": time.strftime("%Y-%m-%d"),
            },
            "refMismatch": per_gene[g]["refMismatch"],
            "clinvarRefMismatch": per_gene[g]["clinvarRefMismatch"],
            "snvs": per_gene[g]["snvs"],
            "clinvar": per_gene[g]["clinvar"],
            "regions": per_gene[g]["regions"],
            "candidates": {"metadomeRaw": md[g], "mtr3daf2Raw": mt[g], "ccrRows": ccr_rows[g]},
        }
        path = out_dir / f"{g}.json.gz"
        with gzip.open(path, "wt", encoding="utf-8", compresslevel=9) as fh:
            json.dump(record, fh, separators=(",", ":"))
        print(g, "->", path.name, path.stat().st_size // 1024, "KiB", flush=True)


if __name__ == "__main__":
    main()
