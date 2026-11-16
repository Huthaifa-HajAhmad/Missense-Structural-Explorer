# /// script
# dependencies = [
#   "biopython",
#   "biotite"
# ]
# ///

import sys
import json
import os
from Bio.PDB import PDBParser
from Bio.PDB.SASA import ShrakeRupley
import biotite.structure as stripe
import biotite.structure.io as stripe_io
from biotite.structure.sse import annotate_sse

# Tien et al. 2013 theoretical maximum SASA values (Gly-X-Gly tripeptide), doi:10.1371/journal.pone.0080635
MAX_SASA = {
    'ALA': 129.0, 'ARG': 274.0, 'ASN': 195.0, 'ASP': 193.0, 'CYS': 167.0,
    'GLN': 225.0, 'GLU': 223.0, 'GLY': 104.0, 'HIS': 224.0, 'ILE': 197.0,
    'LEU': 201.0, 'LYS': 236.0, 'MET': 224.0, 'PHE': 240.0, 'PRO': 159.0,
    'SER': 155.0, 'THR': 172.0, 'TRP': 285.0, 'TYR': 263.0, 'VAL': 174.0
}

def all_residues(pdb_file, chain_id):
    """RSA of every residue of one chain, with the same method and rounding as the single-residue mode below
    (Shrake-Rupley residue SASA over the whole structure, divided by the Tien 2013 maximum, rounded to 4
    places), so a residue reads the same number whichever mode asked. No secondary structure here: the
    Hotspots view needs accessibility only."""
    if not os.path.exists(pdb_file):
        return {"status": "error", "message": f"PDB file not found: {pdb_file}"}
    try:
        structure = PDBParser(QUIET=True).get_structure("protein", pdb_file)
        if len(structure) == 0:
            return {"status": "error", "message": "PDB file contains no models."}
        first_model = structure[0]
        ShrakeRupley().compute(first_model, level="R")
        out = []
        if chain_id in first_model:
            for residue in first_model[chain_id]:
                if residue.id[0] != " ":
                    continue  # waters and ligands
                sasa = getattr(residue, "sasa", None)
                name = residue.get_resname().upper()
                max_sasa = MAX_SASA.get(name)
                if sasa is None or max_sasa is None:
                    continue  # a residue with no Tien maximum has no RSA; never guess one
                rsa = round(sasa / max_sasa, 4)
                out.append({"resId": residue.id[1], "resName": name, "rsa": rsa})
        if not out:
            return {"status": "error", "message": f"Chain {chain_id} has no standard residues."}
        return {"status": "success", "residues": out}
    except Exception as e:
        return {"status": "error", "message": str(e)}

def main():
    if len(sys.argv) < 4:
        print(json.dumps({"status": "error", "message": "Missing arguments. Usage: python sasa_eval.py <pdb_file> <chain_id> <pos>"}))
        return

    pdb_file = sys.argv[1]
    chain_id = sys.argv[2]
    if sys.argv[3] == "all":
        print(json.dumps(all_residues(pdb_file, chain_id)))
        return
    try:
        pos = int(sys.argv[3])
    except ValueError:
        print(json.dumps({"status": "error", "message": "Position must be an integer."}))
        return

    if not os.path.exists(pdb_file):
        print(json.dumps({"status": "error", "message": f"PDB file not found: {pdb_file}"}))
        return

    try:
        parser = PDBParser(QUIET=True)
        structure = parser.get_structure("protein", pdb_file)
        if len(structure) == 0:
            print(json.dumps({"status": "error", "message": "PDB file contains no models."}))
            return
        first_model = structure[0]
        
        # Calculate SASA using Shrake-Rupley on the first model (matching Biotite [0])
        sr = ShrakeRupley()
        sr.compute(first_model, level="R")  # residue level
        
        target_res = None
        if chain_id in first_model:
            chain = first_model[chain_id]
            for residue in chain:
                if residue.id[0] != " ":
                    continue  # skip HETATM ligands and waters
                if residue.id[1] == pos:
                    if residue.id[2] == " ":
                        target_res = residue
                        break
                    if target_res is None:
                        target_res = residue
                
        if not target_res:
            print(json.dumps({"status": "error", "message": f"Residue {pos} in chain {chain_id} not found."}))
            return
            
        resname = target_res.get_resname().upper()
        sasa = getattr(target_res, 'sasa', None)
        
        if sasa is None:
            print(json.dumps({"status": "error", "message": "SASA calculation failed for target residue."}))
            return

        max_sasa = MAX_SASA.get(resname)
        if max_sasa is None:
            print(json.dumps({"status": "error", "message": f"Residue {resname} at {chain_id}:{pos} has no Tien maximum SASA."}))
            return
        # Band the value that is actually shipped, not a more precise one: the payload carries
        # round(rsa, 4) below, and the panel bands that, so banding the unrounded fraction let
        # a true 0.15004 be "core" here and "boundary" on screen (a 5e-5 disagreement window).
        rsa = round(sasa / max_sasa, 4)

        # The single burial definition for the whole app, mirrored in
        # src/shared/burialEvidence.ts (BURIAL_RSA_BANDS) and pinned by
        # src/shared/__tests__/burialEvidence.test.ts, which reads this file and
        # fails if the two drift apart.
        #
        # These were 0.05 / 0.25, so this script labelled a residue at RSA 0.12
        # "boundary" while the panel's own prose and the metric-explanation registry
        # called the same value "deeply buried in the hydrophobic core", and while
        # esm3_forge.ts labelled it "Hydrophobic core".
        BURIAL_RSA_CORE_MAX = 0.15
        BURIAL_RSA_SURFACE_MIN = 0.35
        if rsa <= BURIAL_RSA_CORE_MAX:
            burial_status = "core"
        elif rsa >= BURIAL_RSA_SURFACE_MIN:
            burial_status = "surface"
        else:
            burial_status = "boundary"

        # Calculate Secondary Structure using Biotite (completely DSSP-free)
        sse_char = "c"
        try:
            biotite_struct = stripe_io.load_structure(pdb_file)
            if isinstance(biotite_struct, stripe.AtomArrayStack):
                biotite_struct = biotite_struct[0]
            ca_atoms = biotite_struct[biotite_struct.atom_name == "CA"]
            sse_chars = annotate_sse(biotite_struct)
            
            for i, atom in enumerate(ca_atoms):
                if atom.res_id == pos and (atom.chain_id == chain_id or not chain_id):
                    if i < len(sse_chars):
                        sse_char = sse_chars[i].lower()
                    break
        except Exception as sse_err:
            pass

        print(json.dumps({
            "status": "success",
            "resName": resname,
            "resId": pos,
            "sasa": round(sasa, 2),
            "maxSasa": max_sasa,
            # Already rounded before banding, so this is the exact value the status was
            # computed from.
            "rsa": rsa,
            "burialStatus": burial_status,
            "sse": sse_char # 'a' = helix, 'b' = sheet, 'c' = coil/loop
        }))
        
    except Exception as e:
        print(json.dumps({"status": "error", "message": str(e)}))

if __name__ == "__main__":
    main()

