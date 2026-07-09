# /// script
# dependencies = [
#   "biopython"
# ]
# ///

import sys
import json
import os
from Bio.PDB import PDBParser
from Bio.PDB.SASA import ShrakeRupley

# Tien et al. 2013 Max SASA values (empirical max SASA in Gly-X-Gly tripeptide)
MAX_SASA = {
    'ALA': 129.0, 'ARG': 274.0, 'ASN': 195.0, 'ASP': 193.0, 'CYS': 167.0,
    'GLN': 225.0, 'GLU': 223.0, 'GLY': 104.0, 'HIS': 224.0, 'ILE': 197.0,
    'LEU': 201.0, 'LYS': 236.0, 'MET': 224.0, 'PHE': 240.0, 'PRO': 159.0,
    'SER': 155.0, 'THR': 172.0, 'TRP': 285.0, 'TYR': 263.0, 'VAL': 174.0
}

def main():
    if len(sys.argv) < 4:
        print(json.dumps({"status": "error", "message": "Missing arguments. Usage: python sasa_eval.py <pdb_file> <chain_id> <pos>"}))
        return

    pdb_file = sys.argv[1]
    chain_id = sys.argv[2]
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
        
        # Calculate SASA using Shrake-Rupley (pure Python numerical algorithm)
        sr = ShrakeRupley()
        sr.compute(structure, level="R")  # residue level
        
        target_res = None
        for model in structure:
            if chain_id in model:
                chain = model[chain_id]
                for residue in chain:
                    # check residue sequence identifier
                    if residue.id[1] == pos:
                        target_res = residue
                        break
            if target_res:
                break
                
        if not target_res:
            print(json.dumps({"status": "error", "message": f"Residue {pos} in chain {chain_id} not found."}))
            return
            
        resname = target_res.get_resname().upper()
        sasa = getattr(target_res, 'sasa', None)
        
        if sasa is None:
            print(json.dumps({"status": "error", "message": "SASA calculation failed for target residue."}))
            return

        max_sasa = MAX_SASA.get(resname, 200.0) # fallback
        rsa = sasa / max_sasa
        
        # Classify based on standard Relative Solvent Accessibility (RSA) thresholds:
        # core: RSA < 0.05, surface: RSA > 0.25, boundary: 0.05 <= RSA <= 0.25
        if rsa < 0.05:
            burial_status = "core"
        elif rsa > 0.25:
            burial_status = "surface"
        else:
            burial_status = "boundary"

        print(json.dumps({
            "status": "success",
            "resName": resname,
            "resId": pos,
            "sasa": round(sasa, 2),
            "maxSasa": max_sasa,
            "rsa": round(rsa, 4),
            "burialStatus": burial_status
        }))
        
    except Exception as e:
        print(json.dumps({"status": "error", "message": str(e)}))

if __name__ == "__main__":
    main()
