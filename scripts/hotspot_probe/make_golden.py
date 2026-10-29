"""Writes src/shared/__tests__/fixtures/perBurdenGolden.json: the Python burden test (per_probe.burden) run on the
SOD1 and VHL hotspot fixtures and two synthetic cases. perBurdenParity.test.ts replays the same inputs through
src/shared/perBurden.ts. Standard library only. Usage: python -I scripts/hotspot_probe/make_golden.py
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)  # python -I leaves the script directory off sys.path
from per_probe import burden

FIXTURES = os.path.normpath(os.path.join(HERE, "..", "..", "src", "shared", "__tests__", "fixtures"))


def from_fixture(name):
    with open(os.path.join(FIXTURES, name), encoding="utf-8") as f:
        d = json.load(f)["distribution"]
    return {"length": d["length"],
            "patient": sorted({h["pos"] for h in d["plp"]}),
            "population": sorted({g["pos"] for g in d["gnomad"] if g["pass"] > 0})}


ALL = range(1, 201)
inputs = {
    "SOD1": from_fixture("hotspotsSod1.json"),
    "VHL": from_fixture("hotspotsVhl.json"),
    # one stretch of patient hits, with the population absent from 36-65
    "SYNTH_ONE_REGION": {"length": 200, "patient": list(range(41, 61)),
                         "population": [r for r in ALL if not 36 <= r <= 65]},
    # two such stretches far apart: must give two regions, not one
    "SYNTH_TWO_REGIONS": {"length": 200, "patient": list(range(21, 31)) + list(range(151, 161)),
                          "population": [r for r in ALL if not (16 <= r <= 35 or 146 <= r <= 165)]},
}
golden = {"generator": "scripts/hotspot_probe/make_golden.py", "inputs": inputs,
          "outputs": {k: burden(v["patient"], v["population"], v["length"]) for k, v in inputs.items()}}

with open(os.path.join(FIXTURES, "perBurdenGolden.json"), "w", encoding="utf-8", newline="\n") as f:
    json.dump(golden, f, indent=1)
    f.write("\n")

for k, out in golden["outputs"].items():
    print(k, "length", out["length"], "windows", len(out["windows"]),
          "regions", [(r["start"], r["end"], r["minAdjP"]) for r in out["regions"]])
