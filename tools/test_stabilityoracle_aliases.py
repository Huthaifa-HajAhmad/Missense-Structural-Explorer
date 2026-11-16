import unittest

try:
    from tools.model_server_app.routers.stabilityoracle import canonical_residue_name
except ImportError:  # the sidecar's heavy dependencies are not installed here
    canonical_residue_name = None


@unittest.skipIf(canonical_residue_name is None, "sidecar dependencies not installed")
class CanonicalResidueNameTest(unittest.TestCase):
    def test_protonation_states_map_to_the_standard_residue(self):
        for renamed, standard in {
            "HID": "HIS", "HIE": "HIS", "HIP": "HIS", "CYX": "CYS", "CYM": "CYS",
            "ASH": "ASP", "GLH": "GLU", "LYN": "LYS",
        }.items():
            self.assertEqual(canonical_residue_name(renamed), standard)

    def test_standard_names_are_unchanged(self):
        for name in ("ALA", "HIS", "CYS", "ASP", "GLU", "LYS", "TRP"):
            self.assertEqual(canonical_residue_name(name), name)

    def test_every_alias_target_has_table_entries(self):
        import json
        import os
        from tools.model_server_app.routers import stabilityoracle

        path = os.path.join(os.path.dirname(stabilityoracle.__file__), "..", "data", "stability_oracle_inputs.json")
        with open(path, encoding="utf-8") as fh:
            tables = json.load(fh)
        prefixes = {key.split()[0] for key in tables["heavyCharge"]}
        for target in set(stabilityoracle._PROTONATION_ALIASES.values()):
            self.assertIn(target, prefixes)

    def test_read_chain_atoms_canonicalizes_protonation_aliases(self):
        from tools.model_server_app.routers.stabilityoracle import _read_chain_atoms

        pdb_line = "ATOM      1  CA  HSD A  42       1.000   2.000   3.000  1.00  0.00           C"
        atoms = _read_chain_atoms(pdb_line, "A")
        self.assertEqual(len(atoms), 1)
        self.assertEqual(atoms[0]["res_name"], "HIS")


if __name__ == "__main__":
    unittest.main()
