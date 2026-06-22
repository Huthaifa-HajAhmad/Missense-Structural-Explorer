export const AMINO_ACID_1_TO_3: Record<string, string> = {
  "A": "ALA", "R": "ARG", "N": "ASN", "D": "ASP", "C": "CYS",
  "Q": "GLN", "E": "GLU", "G": "GLY", "H": "HIS", "I": "ILE",
  "L": "LEU", "K": "LYS", "M": "MET", "F": "PHE", "P": "PRO",
  "S": "SER", "T": "THR", "W": "TRP", "Y": "TYR", "V": "VAL"
};

export const AMINO_ACID_1_TO_3_TITLE: Record<string, string> = {
  "A": "Ala", "R": "Arg", "N": "Asn", "D": "Asp", "C": "Cys",
  "Q": "Gln", "E": "Glu", "G": "Gly", "H": "His", "I": "Ile",
  "L": "Leu", "K": "Lys", "M": "Met", "F": "Phe", "P": "Pro",
  "S": "Ser", "T": "Thr", "W": "Trp", "Y": "Tyr", "V": "Val"
};

export const AMINO_ACID_3_TO_1: Record<string, string> = {
  "ALA": "A", "ARG": "R", "ASN": "N", "ASP": "D", "CYS": "C",
  "GLN": "Q", "GLU": "E", "GLY": "G", "HIS": "H", "ILE": "I",
  "LEU": "L", "LYS": "K", "MET": "M", "PHE": "F", "PRO": "P",
  "SER": "S", "THR": "T", "TRP": "W", "TYR": "Y", "VAL": "V",
  
  "Ala": "A", "Arg": "R", "Asn": "N", "Asp": "D", "Cys": "C",
  "Gln": "Q", "Glu": "E", "Gly": "G", "His": "H", "Ile": "I",
  "Leu": "L", "Lys": "K", "Met": "M", "Phe": "F", "Pro": "P",
  "Ser": "S", "Thr": "T", "Trp": "W", "Tyr": "Y", "Val": "V"
};

export const CLINVAR_AA_MAP: Record<string, string> = {
  "ala": "a", "arg": "r", "asn": "n", "asp": "d", "cys": "c",
  "gln": "q", "glu": "e", "gly": "g", "his": "h", "ile": "i",
  "leu": "l", "lys": "k", "met": "m", "phe": "f", "pro": "p",
  "ser": "s", "thr": "t", "trp": "w", "tyr": "y", "val": "v"
};

export const CLINVAR_REV_AA_MAP: Record<string, string> = {
  "a": "ala", "r": "arg", "n": "asn", "d": "asp", "c": "cys",
  "q": "gln", "e": "glu", "g": "gly", "h": "his", "i": "ile",
  "l": "leu", "k": "lys", "m": "met", "f": "phe", "p": "pro",
  "s": "ser", "t": "thr", "w": "trp", "y": "tyr", "v": "val"
};
