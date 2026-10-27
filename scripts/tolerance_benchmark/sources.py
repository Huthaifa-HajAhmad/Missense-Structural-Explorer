"""Pinned inputs for the residue-tolerance benchmark. Python stdlib only.

Every per-gene number the benchmark reports traces to one of these byte sources. Hashes are checked
while streaming; a mismatch stops the slice rather than benchmarking different bytes.
"""

# MANE Select on GRCh38. Versions must equal the pinned gnomAD v4.1.2 constraint snapshot
# (server/data/constraint/gnomad-4.1.2.json.gz), which is the identity rule regional constraint uses.
GENES = {
    "SOD1": {"transcript": "ENST00000270142", "version": "11", "uniprot": "P00441"},
    "BRCA1": {"transcript": "ENST00000357654", "version": "9", "uniprot": "P38398"},
    "RYR2": {"transcript": "ENST00000366574", "version": "7", "uniprot": "Q92736"},
    "LDLR": {"transcript": "ENST00000558518", "version": "6", "uniprot": "P01130"},
}

ZENODO_METADOME = "https://zenodo.org/records/19376150/files/"
METADOME_FINAL = {
    "url": ZENODO_METADOME + "MetaDome_v2.0_GRCh38.p14_GENCODE-v45_UniProt-2025-01_Pfam-37.4_gnomAD-v4.1_ClinVar-2025-10-06_final-dataset-sw10.tsv.gz?download=1",
    "md5": "6e791a9aa72d9deb22d5b61d75c30da5",  # Zenodo record 19376150 file checksum
    "doi": "10.5281/zenodo.19376150",
}
METADOME_SOURCE = {"url": "https://zenodo.org/records/23384270", "doi": "10.5281/zenodo.23384270", "commit": "e8ec9a8"}
METADOME_PREPRINT_DOI = "10.64898/2026.08.26.747388"

MTR3DAF2 = {
    "url": "https://biosig.lab.uq.edu.au/mtr3daf2/download_data/mtr_data.csv.gz",
    # No checksum is published; this is the sha256 of the bytes served on 2026-10-26 (Last-Modified 2024-07-23).
    "sha256": "30e660f401719f7b35dacee124a98138bead699450014ed7af4cb370b747e531",
    "doi": "10.1002/pro.5112",
}
CCR = {
    "url": "https://s3.us-east-2.amazonaws.com/ccrs/ccrs/ccrs.autosomes.v2.20180420.bed.gz",
    # No checksum is published; sha256 of the bytes served on 2026-10-26.
    "sha256": "711e1d46faff85e541a379a402afe27e8d2b4c360c795e1cc92c7ecf41812e19",
    "doi": "10.1038/s41588-018-0294-6",
    "assembly": "GRCh37",
}

GNOMAD_API = "https://gnomad.broadinstitute.org/api"
ENSEMBL_38 = "https://rest.ensembl.org"
ENSEMBL_37 = "https://grch37.rest.ensembl.org"

CODON = {}
_bases = "TCAG"
_aas = "FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG"
for _i, _a in enumerate(_bases):
    for _j, _b in enumerate(_bases):
        for _k, _c in enumerate(_bases):
            CODON[_a + _b + _c] = _aas[16 * _i + 4 * _j + _k]
COMPLEMENT = {"A": "T", "C": "G", "G": "C", "T": "A"}


def translate(cds):
    return "".join(CODON.get(cds[i:i + 3], "X") for i in range(0, len(cds) - 2, 3))


def classify_clinvar(significance):
    """Python twin of src/shared/clinvarClassification.ts, so the benchmark reads ClinVar as the tab does."""
    s = str(significance or "").lower()
    if "conflicting" in s:
        return "other"
    path, benign = "pathogenic" in s, "benign" in s
    if path and not benign:
        return "plp"
    if benign and not path:
        return "blb"
    return "other"
