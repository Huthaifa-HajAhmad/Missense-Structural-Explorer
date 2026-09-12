import { fetchWithRetry } from "../http-client.ts";

export async function fetchRealConsurfData(pdbId: string, chainId: string, pos: number): Promise<number | null> {
  const cleanPdb = pdbId.toUpperCase();
  const cleanChain = chainId.toUpperCase();
  
  const selUrl = `https://consurfdb.tau.ac.il/scripts/chain_selection.php?pdb_ID=${cleanPdb}`;
  try {
    const selRes = await fetchWithRetry(selUrl, { timeout: 3000 }, 1);
    if (!selRes.ok) return null;
    const html = await selRes.text();
    
    let hash: string | null = null;
    const matches = [...html.matchAll(/<option\s+value=["'](\S+)\s+(\S+)["']/gi)];
    for (const match of matches) {
      if (match[1].toUpperCase() === cleanChain) {
        hash = match[2];
        break;
      }
    }
    
    if (!hash) return null;
    
    const sumUrl = `https://consurfdb.tau.ac.il/DB/${hash}/consurf_summary.txt`;
    const sumRes = await fetchWithRetry(sumUrl, { timeout: 3000 }, 1);
    if (!sumRes.ok) return null;
    const txt = await sumRes.text();
    
    let colorVal: number | null = null;
    const lines = txt.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("POS")) continue;
      const parts = trimmed.split(/\s+/);
      if (parts.length < 5) continue;
      
      const colPos = parts[0];
      const colAtom = parts[2];
      const colColor = parts[4];
      
      const posNum = parseInt(colPos, 10);
      const atomMatch = colAtom.match(/^[A-Z]{3}(\d+):/i);
      const atomResNum = atomMatch ? parseInt(atomMatch[1], 10) : null;
      
      if (posNum === pos || atomResNum === pos) {
        const colorInt = parseInt(colColor, 10);
        if (!isNaN(colorInt) && colorInt >= 1 && colorInt <= 9) {
          colorVal = colorInt;
          break;
        }
      }
    }
    return colorVal;
  } catch (err: any) {
    console.warn(`[ConSurf Fetch Warning] Failed to fetch ConSurf data for ${cleanPdb}:${cleanChain}:${pos}: ${err.message}`);
    return null;
  }
}
