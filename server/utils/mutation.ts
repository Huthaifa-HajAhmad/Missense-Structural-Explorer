export interface Mutation {
  chain: string;
  position: number;
  wt: string; // 1-letter code
  mt: string; // 1-letter code
}

export interface ThermoResult {
  wt_sequence: string;
  mutation: Mutation;
  ddG: number;
}

/**
 * Applies a mutation to a wildtype protein sequence, returning the mutated sequence.
 * Expects 1-indexed residue position.
 */
export function applyMutation(wtSequence: string, mutation: Mutation): string {
  const { position, wt, mt } = mutation;
  
  if (position < 1 || position > wtSequence.length) {
    throw new Error(`Mutation position ${position} is out of bounds for sequence of length ${wtSequence.length}`);
  }

  // Double check that the wildtype residue matches what is in the sequence (if specified)
  if (wt) {
    const actualWt = wtSequence[position - 1];
    if (actualWt.toUpperCase() !== wt.toUpperCase()) {
      console.warn(`[Mutation Utility] Warning: WT residue mismatch at position ${position}. Sequence has '${actualWt}', mutation specifies '${wt}'.`);
    }
  }

  return wtSequence.substring(0, position - 1) + mt.toUpperCase() + wtSequence.substring(position);
}
