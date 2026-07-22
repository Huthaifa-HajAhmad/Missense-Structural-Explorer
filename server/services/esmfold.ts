export async function foldSequence(
  sequence: string,
  biohubToken?: string | null
): Promise<string> {
  // 1. If Biohub token is available, attempt to query the official Biohub ESMFold2 model
  if (biohubToken) {
    try {
      const response = await fetch("https://api.biohub.ai/v1/esmfold2/predict", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${biohubToken}`
        },
        body: JSON.stringify({
          model: "esmfold2-fast-2026-05",
          proteins: [{ id: "A", sequence: sequence }]
        }),
        signal: AbortSignal.timeout(10000) // Folding is computationally heavy; give it 10 seconds
      });

      if (response.ok) {
        const data = await response.json() as any;
        if (data && data.pdb) {
          return data.pdb;
        }
      }
    } catch (apiErr: any) {
      console.warn(`[Biohub ESMFold2 Warning] API call failed: ${apiErr.message}. Trying public ESM Atlas fallback...`);
    }
  }

  // 2. Free Public ESM Atlas Folding Fallback
  // Meta's public ESM Atlas endpoint takes a raw sequence string in the body and returns the PDB text.
  try {
    const atlasRes = await fetch("https://api.esmatlas.com/foldSequence/v1/pdb/", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: sequence,
      signal: AbortSignal.timeout(10000)
    });

    if (atlasRes.ok) {
      const pdbText = await atlasRes.text();
      if (pdbText && pdbText.includes("ATOM")) {
        return pdbText;
      }
    }
    throw new Error(`ESM Atlas returned status ${atlasRes.status}`);
  } catch (atlasErr: any) {
    throw new Error(`Protein folding failed: ${atlasErr.message}`);
  }
}
