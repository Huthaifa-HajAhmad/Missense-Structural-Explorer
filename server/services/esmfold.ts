function padLeft(str: string, length: number): string {
  return str.padStart(length, " ");
}

function padRight(str: string, length: number): string {
  return str.padEnd(length, " ");
}

function convertComplexToPdb(complex: any): string {
  const sequences = complex.sequence; // Array of 3-letter codes: e.g. ['MET', 'GLU', ...]
  const atomPositions = complex.atom_positions; // Array of [x, y, z]
  const atomElements = complex.atom_elements; // Array of elements
  const atomNames = complex.atom_names; // Array of atom names
  const tokenToAtoms = complex.token_to_atoms; // Array of [start, end]
  const plddt = complex.plddt; // Array of plddt scores (0 to 1)
  
  let pdbLines: string[] = [];
  let atomSerial = 1;

  for (let resIdx = 0; resIdx < sequences.length; resIdx++) {
    const resName = sequences[resIdx];
    const resSeq = resIdx + 1; // 1-indexed residue number
    const [startAtomIdx, endAtomIdx] = tokenToAtoms[resIdx];
    const resPlddt = (plddt && plddt[resIdx] !== undefined) ? plddt[resIdx] * 100 : 100.0; // scale to 0-100

    for (let atomIdx = startAtomIdx; atomIdx < endAtomIdx; atomIdx++) {
      const pos = atomPositions[atomIdx];
      if (!pos || pos[0] === null || pos[0] === undefined) continue;

      const [x, y, z] = pos;
      const element = atomElements[atomIdx] || "";
      const atomName = atomNames[atomIdx] || "";

      let formattedAtomName = atomName;
      if (formattedAtomName.length < 4) {
        formattedAtomName = " " + formattedAtomName;
      }
      formattedAtomName = padRight(formattedAtomName, 4);

      const record = "ATOM  ";
      const serialStr = padLeft(atomSerial.toString(), 5);
      const resNameStr = padLeft(resName.substring(0, 3).toUpperCase(), 3);
      const chainId = "A";
      const resSeqStr = padLeft(resSeq.toString(), 4);
      
      const xStr = x.toFixed(3).padStart(8);
      const yStr = y.toFixed(3).padStart(8);
      const zStr = z.toFixed(3).padStart(8);
      const occStr = "1.00".padStart(6);
      const bFactorStr = resPlddt.toFixed(2).padStart(6);
      const elemStr = padLeft(element.substring(0, 2).toUpperCase(), 2);

      const line = `${record}${serialStr} ${formattedAtomName} ${resNameStr} ${chainId}${resSeqStr}   ${xStr}${yStr}${zStr}${occStr}${bFactorStr}          ${elemStr}`;
      pdbLines.push(line);
      atomSerial++;
    }
  }
  pdbLines.push("END");
  return pdbLines.join("\n");
}

export async function foldSequence(
  sequence: string,
  biohubToken?: string | null
): Promise<string> {
  // 1. If API token is available, attempt query against Biohub Platform API
  if (biohubToken) {
    try {
      const response = await fetch("https://biohub.ai/api/v1/fold_all_atom", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${biohubToken}`
        },
        body: JSON.stringify({
          model: "esmfold2-fast-2026-05",
          all_atom_input: {
            sequences: [
              {
                type: "protein",
                id: "A",
                sequence: sequence
              }
            ]
          }
        }),
        signal: AbortSignal.timeout(20000)
      });

      if (response.ok) {
        const data = await response.json() as any;
        if (data && data.complex) {
          return convertComplexToPdb(data.complex);
        }
      } else {
        const errText = await response.text();
        console.warn(`[Biohub API ESMFold Error] status ${response.status}: ${errText}`);
      }
    } catch (apiErr: any) {
      console.warn(`[Biohub API ESMFold Warning] API call failed: ${apiErr.message}. Trying public ESM Atlas fallback...`);
    }
  }

  // 2. Free Public ESM Atlas Folding Fallback
  try {
    const atlasRes = await fetch("https://api.esmatlas.com/foldSequence/v1/pdb/", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: sequence,
      signal: AbortSignal.timeout(15000)
    });

    if (atlasRes.ok) {
      const pdbText = await atlasRes.text();
      if (pdbText && pdbText.includes("ATOM")) {
        return pdbText;
      }
    }
    if (atlasRes.status === 422 || sequence.length > 400) {
      throw new Error(`Sequence length (${sequence.length} aa) exceeds public ESM Atlas 400aa limit. An active Biohub / EvolutionaryScale API key is required for proteins > 400 aa.`);
    }
    throw new Error(`ESM Atlas returned status ${atlasRes.status}`);
  } catch (atlasErr: any) {
    throw new Error(`Protein folding failed: ${atlasErr.message}`);
  }
}
