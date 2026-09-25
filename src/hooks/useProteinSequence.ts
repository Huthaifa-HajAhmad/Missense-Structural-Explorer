import { useEffect, useRef, useState } from "react";
import { useApiClient } from "../apiClient";
import { useVariantAnalysisStore } from "../stores/useVariantAnalysisStore";
import {
  isUsableUniprotAccession,
  normalizeUniprotAccession
} from "../shared/uniprotAccession";

export interface ProteinSequenceState {
  sequence: string;
  isLoading: boolean;
  error: string | null;
}

/**
 * Owns the UniProt sequence for the queried accession: fetches it, keeps it in local state for
 * the sequence views, and publishes it to the store so residue-level views can resolve an amino
 * acid by index without a second request.
 *
 * Published under the accession it was fetched for. A viewer that switched protein while a fetch
 * was in flight then reads "unknown" rather than a residue letter from the previous protein.
 */
export function useProteinSequence(
  uniprotId: string | null | undefined
): ProteinSequenceState {
  const { fetchWithAuth } = useApiClient();
  // Held in a ref: the sequence follows the accession, not the auth session, so a token refresh
  // mid-analysis must not re-issue it.
  const fetchRef = useRef(fetchWithAuth);
  fetchRef.current = fetchWithAuth;

  const [sequence, setSequence] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const accession = normalizeUniprotAccession(uniprotId);

    const publish = (value: string) => {
      setSequence(value);
      useVariantAnalysisStore.getState().setProteinSequence(accession, value);
    };

    if (!accession) {
      publish("");
      setError(null);
      setIsLoading(false);
      return;
    }

    if (!isUsableUniprotAccession(accession)) {
      publish("");
      setError("Invalid UniProt ID identifier.");
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    (async () => {
      try {
        const response = await fetchRef.current(
          `/api/v1/sequence/${encodeURIComponent(accession)}`
        );
        if (!response.ok) {
          throw new Error(`Failed to retrieve sequence data: ${response.statusText}`);
        }
        const data = await response.json();
        if (active) publish(typeof data?.sequence === "string" ? data.sequence : "");
      } catch (err) {
        if (!active) return;
        console.warn("Unable to fetch UniProt sequence:", err);
        publish("");
        setError("UniProt sequence data unavailable. Check network or server connection.");
      } finally {
        if (active) setIsLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [uniprotId]);

  return { sequence, isLoading, error };
}
