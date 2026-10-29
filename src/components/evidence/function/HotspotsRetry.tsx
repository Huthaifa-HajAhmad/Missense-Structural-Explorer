import React from "react";
import { RefreshCw } from "lucide-react";
import { useApiClient } from "../../../apiClient";
import { readHotspots } from "../../../hooks/hotspotsRead";

/** The identity the hot-spot read is keyed by (the same three values the loader and the slot builder take). */
export interface HotspotsRead { gene: string; uniprot: string | null; transcript: string | null }

/**
 * Try the hot-spot read again. A leaf on purpose: it is mounted only while a read has failed or came back
 * incomplete, so the view and its tab render without an API client (and without the settings provider the client
 * needs) in every state where there is nothing to repair. Pressing it puts the slot back to "loading", which
 * unmounts it; no local state outlives the click.
 */
export function HotspotsRetry({ read, label = "Try again" }: { read: HotspotsRead; label?: string }) {
  const { fetchWithAuth } = useApiClient();
  return (
    <button type="button" className="fnd-button hsp-retry" data-testid="hotspots-retry" onClick={() => void readHotspots(fetchWithAuth, read.gene, read.uniprot, read.transcript)}>
      <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" /> {label}
    </button>
  );
}
