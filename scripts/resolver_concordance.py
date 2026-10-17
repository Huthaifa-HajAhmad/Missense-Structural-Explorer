"""Coordinate-resolver concordance: local dbNSFP vs ProtVar vs Ensembl VEP vs VariantValidator.

Evidence for ordering the resolver ladder (cache -> local -> ProtVar -> VEP -> VariantValidator).
Every provider's answer is a canonical-numbered protein change (gene, position, wild type, mutant), and
each is checked against an oracle none of them controls: the UniProt canonical sequence's residue at the
reported position (`oracle`). Pairwise agreement is then computed on (position, wt, mut).

Input: a JSON list of GRCh38 SNVs drawn from the local store (see doc/RESOLVER_CONCORDANCE.md for how
the sample was drawn), each with the stored row's gene/transcript/pos/aaref/aaalt and `on_mane`.
Output: per-variant JSONL and a summary JSON. Network only; no app code, no caches.

    python -I scripts/resolver_concordance.py SAMPLE.json OUT_DIR
"""
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter

UA = "Missense-Structural-Explorer/1.0 (resolver concordance study)"
THREE = {"Ala": "A", "Arg": "R", "Asn": "N", "Asp": "D", "Cys": "C", "Gln": "Q", "Glu": "E", "Gly": "G",
         "His": "H", "Ile": "I", "Leu": "L", "Lys": "K", "Met": "M", "Phe": "F", "Pro": "P", "Ser": "S",
         "Thr": "T", "Trp": "W", "Tyr": "Y", "Val": "V"}


def http(url, body=None, timeout=60, tries=3):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"User-Agent": UA, "Accept": "application/json"}
    if data:
        headers["Content-Type"] = "application/json"
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, data=data, headers=headers), timeout=timeout) as r:
                return r.status, r.read().decode()
        except urllib.error.HTTPError as e:
            if e.code in (429, 502, 503, 504) and attempt < tries - 1:
                time.sleep(float(e.headers.get("Retry-After") or 2 * (attempt + 1)))
                continue
            return e.code, e.read().decode(errors="replace")
        except Exception as e:  # timeout / transport
            if attempt < tries - 1:
                time.sleep(2 * (attempt + 1))
                continue
            return None, str(e)
    return None, "exhausted"


def parse_hgvsp(h):
    """'ENSP..:p.Arg175His' or 'p.(Arg175His)' -> (175, 'R', 'H'); None for non-missense."""
    m = re.search(r"p\.\(?([A-Z][a-z]{2})(\d+)([A-Z][a-z]{2})\)?$", h or "")
    if not m or m.group(1) not in THREE or m.group(3) not in THREE:
        return None
    return int(m.group(2)), THREE[m.group(1)], THREE[m.group(3)]


def vep_batch(variants):
    out = {}
    for i in range(0, len(variants), 200):
        chunk = variants[i:i + 200]
        notes = [f"{v['chr']}:g.{v['pos_genomic']}{v['ref']}>{v['alt']}" for v in chunk]
        t0 = time.time()
        st, txt = http("https://rest.ensembl.org/vep/human/hgvs?hgvs=1&canonical=1&uniprot=1&mane=1",
                       {"hgvs_notations": notes}, timeout=300)
        ms = (time.time() - t0) * 1000 / max(len(chunk), 1)
        if st != 200:
            for v in chunk:
                out[key(v)] = {"error": f"http {st}: {txt[:120]}"}
            continue
        for rec in json.loads(txt):
            k = rec.get("input", "").replace(":g.", "-").replace(">", "-")
            k = re.sub(r"^(\w+)-(\d+)([ACGT])-([ACGT])$", r"\1-\2-\3-\4", k)
            tcs = [t for t in rec.get("transcript_consequences", []) if parse_hgvsp(t.get("hgvsp"))]
            pick = (next((t for t in tcs if t.get("mane_select")), None)
                    or next((t for t in tcs if t.get("canonical") in (1, True, "1")), None)
                    or (tcs[0] if tcs else None))
            if not pick:
                out[k] = {"answer": None, "ms": ms}
                continue
            pos, wt, mut = parse_hgvsp(pick["hgvsp"])
            iso = pick.get("uniprot_isoform") or []
            out[k] = {"answer": {"gene": pick.get("gene_symbol"), "pos": pos, "wt": wt, "mut": mut,
                                 "accession": (pick.get("swissprot") or [None])[0],
                                 "isoform": iso if isinstance(iso, list) else [iso],
                                 "transcript": pick.get("transcript_id"), "mane": bool(pick.get("mane_select"))},
                      "ms": ms}
    return out


def protvar(v):
    t0 = time.time()
    st, txt = http("https://www.ebi.ac.uk/ProtVar/api/mapping?" + urllib.parse.urlencode(
        {"q": key(v), "assembly": "GRCh38"}))
    ms = (time.time() - t0) * 1000
    if st != 200:
        return {"error": f"http {st}: {txt[:120]}", "ms": ms}
    answers = []
    for inp in json.loads(txt).get("content", {}).get("inputs", []):
        for dv in inp.get("derivedGenomicVariants") or []:
            for g in dv.get("genes") or []:
                for iso in g.get("isoforms") or []:
                    if iso.get("canonical") and iso.get("refAA") in THREE and iso.get("variantAA") in THREE:
                        answers.append({"gene": g.get("geneName"), "pos": iso.get("isoformPosition"),
                                        "wt": THREE[iso["refAA"]], "mut": THREE[iso["variantAA"]],
                                        "accession": iso.get("accession"), "consequence": iso.get("consequences")})
    return {"answer": answers[0] if len(answers) == 1 else None, "all": answers, "ms": ms}


def variant_validator(v):
    note = key(v)  # VCF-style chr-pos-ref-alt, accepted by VariantValidator
    t0 = time.time()
    st, txt = http("https://rest.variantvalidator.org/VariantValidator/variantvalidator/GRCh38/"
                   + urllib.parse.quote(note, safe="") + "/mane?content-type=application/json", timeout=90)
    ms = (time.time() - t0) * 1000
    if st != 200:
        return {"error": f"http {st}: {txt[:120]}", "ms": ms}
    body = json.loads(txt)
    for k, rec in body.items():
        if ":" not in k or not isinstance(rec, dict):
            continue
        p = rec.get("hgvs_predicted_protein_consequence") or {}
        parsed = parse_hgvsp(p.get("tlr") or p.get("slr") or "")
        if parsed:
            pos, wt, mut = parsed
            return {"answer": {"gene": rec.get("gene_symbol"), "pos": pos, "wt": wt, "mut": mut,
                               "transcript": k.split(":")[0], "protein": (p.get("tlr") or "").split(":")[0]},
                    "ms": ms}
    return {"answer": None, "ms": ms}


_seq = {}


def uniprot_seq(acc):
    acc = (acc or "").split("-")[0].split(".")[0]
    if not acc:
        return None
    if acc not in _seq:
        st, txt = http(f"https://rest.uniprot.org/uniprotkb/{acc}.fasta")
        _seq[acc] = "".join(txt.splitlines()[1:]) if st == 200 else None
    return _seq[acc]


def key(v):
    return f"{v['chr']}-{v['pos_genomic']}-{v['ref']}-{v['alt']}"


def main(sample_path, out_dir):
    sample = json.load(open(sample_path))
    vep = vep_batch(sample)
    rows = []
    for i, v in enumerate(sample):
        pv = protvar(v)
        time.sleep(0.25)
        vv = variant_validator(v)
        time.sleep(0.5)
        local = {"answer": {"gene": v["gene"], "pos": v["pos"], "wt": v["aaref"], "mut": v["aaalt"],
                            "transcript": v["transcript"]} if v.get("on_mane") else None,
                 "stored_basis": v["transcript_basis"]}
        r = {"key": key(v), "stratum": v["stratum"], "local": local, "protvar": pv,
             "vep": vep.get(key(v), {"error": "missing from batch"}), "vv": vv}
        # Oracle: the canonical accession comes from VEP's swissprot, else ProtVar's canonical accession.
        acc = ((r["vep"].get("answer") or {}).get("accession") or (pv.get("answer") or {}).get("accession"))
        seq = uniprot_seq(acc)
        r["oracle_accession"] = acc
        for p in ("local", "protvar", "vep", "vv"):
            a = r[p].get("answer")
            r[p]["oracle"] = (None if not a or not seq else
                              (0 < a["pos"] <= len(seq) and seq[a["pos"] - 1] == a["wt"]))
        rows.append(r)
        if (i + 1) % 25 == 0:
            print(f"{i + 1}/{len(sample)}", file=sys.stderr, flush=True)
    with open(f"{out_dir}/concordance.jsonl", "w") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")

    providers = ("local", "protvar", "vep", "vv")
    summary = {"n": len(rows), "providers": {}, "pairwise": {}, "by_stratum": {}}
    for p in providers:
        ans = [r for r in rows if r[p].get("answer")]
        ms = sorted(r[p]["ms"] for r in rows if isinstance(r[p].get("ms"), (int, float)))
        summary["providers"][p] = {
            "answered": len(ans),
            "errors": sum(1 for r in rows if r[p].get("error")),
            "oracle_pass": sum(1 for r in ans if r[p]["oracle"] is True),
            "oracle_fail": sum(1 for r in ans if r[p]["oracle"] is False),
            "oracle_unchecked": sum(1 for r in ans if r[p]["oracle"] is None),
            "median_ms": ms[len(ms) // 2] if ms else None,
            "p95_ms": ms[int(len(ms) * 0.95)] if ms else None,
        }
    for i, a in enumerate(providers):
        for b in providers[i + 1:]:
            both = [r for r in rows if r[a].get("answer") and r[b].get("answer")]
            same = [r for r in both if all(r[a]["answer"][k] == r[b]["answer"][k] for k in ("pos", "wt", "mut"))]
            summary["pairwise"][f"{a}~{b}"] = {"both": len(both), "agree": len(same),
                                              "disagree": [r["key"] for r in both if r not in same]}
    for s, n in Counter(r["stratum"] for r in rows).items():
        summary["by_stratum"][s] = {p: sum(1 for r in rows if r["stratum"] == s and r[p].get("answer"))
                                    for p in providers} | {"n": n}
    json.dump(summary, open(f"{out_dir}/summary.json", "w"), indent=1)
    print(json.dumps(summary, indent=1))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
