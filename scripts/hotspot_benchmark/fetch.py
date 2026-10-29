"""Build the 3D benchmark's inputs in data/. Network step; run once, commit the output.

  python -I scripts/hotspot_benchmark/fetch.py

SOD1, BRCA1 and LDLR reuse the tolerance benchmark's committed slices (scripts/tolerance_benchmark/data),
read-only. VHL, SCN1A and KCNQ2 are sliced here with the same helpers and the same rules (MANE transcript
pinned to the app's constraint snapshot, consequences recomputed on the MANE codon, ClinVar classified
with the app's rule), minus the tolerance candidates. Every gene's AlphaFold DB model is downloaded with
its sha256, so the benchmark runs offline.
"""
import gzip
import hashlib
import json
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
TOL = REPO / "scripts" / "tolerance_benchmark"
sys.path.insert(0, str(TOL))
from fetch import SNAPSHOT, classify_snv, ensembl_model, get, gnomad_gene  # noqa: E402
from sources import ENSEMBL_38, GNOMAD_API, classify_clinvar  # noqa: E402

TH = json.load(open(HERE / "thresholds.json", encoding="utf-8"))
REUSED = {"SOD1", "BRCA1", "LDLR"}
UNIPROT = {"SOD1": "P00441", "BRCA1": "P38398", "LDLR": "P01130", "VHL": "P40337", "SCN1A": "P35498", "KCNQ2": "O43526"}
AF_UA = {"User-Agent": "Mozilla/5.0 (missense-fold-hotspot-benchmark/1.0)"}


def new_slice(g, snapshot):
    pins = [r for r in snapshot["rows"] if r["gene"] == g and r.get("mane")]
    if len(pins) != 1:
        raise RuntimeError(f"{g}: expected one MANE row in the constraint snapshot, found {len(pins)}")
    pin = pins[0]
    m = ensembl_model(ENSEMBL_38, pin["transcriptId"])
    if m["version"] != pin["transcriptVersion"]:
        raise RuntimeError(f"{g}: Ensembl serves {pin['transcriptId']}.{m['version']}, snapshot pins {pin['transcriptVersion']}")
    index = {p: i for i, p in enumerate(m["positions"])}
    data = gnomad_gene(g)
    gene = data["gene"]
    mane = gene["mane_select_transcript"]
    if mane["ensembl_id"] != pin["transcriptId"] or mane["ensembl_version"] != pin["transcriptVersion"]:
        raise RuntimeError(f"{g}: gnomAD MANE {mane} differs from the snapshot pin")
    snvs, clinvar, mism, cv_mism = [], [], 0, 0
    for v in gene["variants"]:
        c = classify_snv(m, v["pos"], v["ref"], v["alt"], index)
        if c is None:
            continue
        if c.get("refMismatch"):
            mism += 1
            continue
        ex, ge, jo = v.get("exome"), v.get("genome"), v.get("joint")
        snvs.append({"id": v["variant_id"], "pos": v["pos"], "ref": v["ref"], "alt": v["alt"], **c,
                     "exomeAc": ex["ac"] if ex else None, "exomeFilters": ex["filters"] if ex else None,
                     "genomeAc": ge["ac"] if ge else None, "genomeFilters": ge["filters"] if ge else None,
                     "jointAc": jo["ac"] if jo else None, "jointFilters": jo["filters"] if jo else None})
    for v in gene["clinvar_variants"]:
        c = classify_snv(m, v["pos"], v["ref"], v["alt"], index)
        if c is None:
            continue
        if c.get("refMismatch"):
            cv_mism += 1
            continue
        clinvar.append({"id": v["variant_id"], "pos": v["pos"], "ref": v["ref"], "alt": v["alt"], **c,
                        "significance": v["clinical_significance"], "class": classify_clinvar(v["clinical_significance"]),
                        "stars": v["gold_stars"], "review": v["review_status"], "variationId": v["clinvar_variation_id"],
                        "inGnomad": v["in_gnomad"]})
    regions = []
    for r in snapshot["regions"]:
        if r["transcriptId"] != pin["transcriptId"]:
            continue
        res = sorted({i // 3 + 1 for i, p in enumerate(m["positions"]) if r["start"] <= p <= r["end"]})
        res = [x for x in res if x <= len(m["protein"])]
        if res:
            regions.append({"start": r["start"], "end": r["end"], "oe": r["oe"], "p": r["p"], "residues": [res[0], res[-1]], "n": len(res)})
    print(g, "snvs", len(snvs), "clinvar", len(clinvar), "mismatches", mism, cv_mism, "regions", len(regions), flush=True)
    return {"gene": g, "assembly": "GRCh38", "transcript": f"{pin['transcriptId']}.{m['version']}", "uniprot": UNIPROT[g],
            "protein": m["protein"], "provenance": {"ensembl38": ENSEMBL_38, "gnomadApi": GNOMAD_API, "gnomadDataset": "gnomad_r4 (v4.1)",
                                                    "clinvarRelease": data["meta"]["clinvar_release_date"], "geneId": gene["gene_id"] + "." + gene["gene_version"],
                                                    "constraintSnapshot": {"release": snapshot["release"], "regionalRelease": snapshot["regionalRelease"]},
                                                    "fetched": time.strftime("%Y-%m-%d")},
            "refMismatch": mism, "clinvarRefMismatch": cv_mism, "snvs": snvs, "clinvar": clinvar, "regions": regions}


def model(g):
    meta = json.loads(get(f"https://alphafold.ebi.ac.uk/api/prediction/{UNIPROT[g]}", AF_UA))
    canonical = [x for x in meta if x.get("uniprotAccession") == UNIPROT[g] and x.get("entryId", "").endswith("-F1")]
    if len(canonical) != 1:
        raise RuntimeError(f"{g}: expected one canonical F1 AlphaFold entry, found {len(canonical)}")
    entry = canonical[0]
    body = get(entry["pdbUrl"], AF_UA)
    return entry, body


def main():
    out = HERE / "data"
    out.mkdir(exist_ok=True)
    snapshot = json.load(gzip.open(SNAPSHOT))
    manifest = {}
    for g in TH["genes"]:
        if g not in REUSED:
            with gzip.open(out / f"{g}.json.gz", "wt", encoding="utf-8", compresslevel=9) as fh:
                json.dump(new_slice(g, snapshot), fh, separators=(",", ":"))
        entry, body = model(g)
        path = out / f"{g}.af.pdb.gz"
        with gzip.open(path, "wb", compresslevel=9) as fh:
            fh.write(body)
        manifest[g] = {"slice": f"scripts/tolerance_benchmark/data/{g}.json.gz" if g in REUSED else f"data/{g}.json.gz",
                       "model": {"entryId": entry["entryId"], "version": entry.get("latestVersion"), "url": entry["pdbUrl"],
                                 "sha256": hashlib.sha256(body).hexdigest(), "sequence": entry.get("uniprotSequence")}}
        print(g, entry["entryId"], "v", entry.get("latestVersion"), len(body) // 1024, "KiB", flush=True)
    json.dump(manifest, open(out / "manifest.json", "w", encoding="utf-8"), indent=1)


if __name__ == "__main__":
    main()
