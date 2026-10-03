import React, { useRef, useState } from "react";
import { useSettings } from "../../../context/SettingsContext";
import { useApiClient } from "../../../apiClient";
import { useVariantAnalysisStore } from "../../../stores/useVariantAnalysisStore";
import { SPLICEAI_WINDOWS, describeSpliceAiFailure, type SplicingEvidence } from "../../../shared/splicingEvidence";
import type { AnalysisResult } from "../../../types";

/**
 * The SpliceAI window, where the reader is looking at it.
 *
 * The window decides which gained or lost sites SpliceAI reports at all (it is -D: how far from the
 * variant a site may be), so a reader judging a splicing call needs to change it HERE, beside the
 * score, not three screens away in Settings. Choosing a window saves it as the default (the same
 * setting Settings → Analysis shows) and re-scores just this variant: a single request to
 * `/spliceai/score`, not a re-run of the analysis.
 *
 * What it will not do: replace a score with a failure. If the re-score fails, the score on screen
 * stays, labelled with the window it was actually computed under, and the control says why.
 */

export interface SpliceAiScoreResponse {
  distance: number;
  spliceai: NonNullable<NonNullable<AnalysisResult["conservationData"]>["spliceai"]> | null;
  spliceaiFailure: NonNullable<AnalysisResult["conservationData"]>["spliceaiFailure"] | null;
  attempted: boolean;
}

/**
 * Fold a re-score into the payload's conservation data. A new score replaces the old one and clears
 * any failure; no new score leaves the old one in place and records why. Pure.
 */
export function mergeSpliceAiRescore(
  conservation: NonNullable<AnalysisResult["conservationData"]>,
  response: SpliceAiScoreResponse
): NonNullable<AnalysisResult["conservationData"]> {
  if (response.spliceai) return { ...conservation, spliceai: response.spliceai, spliceaiFailure: null };
  return { ...conservation, spliceaiFailure: response.spliceaiFailure ?? conservation.spliceaiFailure ?? null };
}

const assemblyOf = (raw: unknown): "GRCh37" | "GRCh38" => (typeof raw === "string" && /37|hg19/i.test(raw) ? "GRCh37" : "GRCh38");

export function SpliceWindowControl({
  result,
  ev,
  disabled,
}: {
  result: AnalysisResult;
  ev: SplicingEvidence;
  disabled?: boolean;
}) {
  const { settings, updateSetting } = useSettings();
  const { fetchWithAuth } = useApiClient();
  const [target, setTarget] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A late reply for a window the reader has already moved off must not land.
  const latest = useRef(0);

  // `genomicCoordinates` and `assembly` ride on the payload's metadata beyond its declared type (as the rail reads them).
  const md: { genomicCoordinates?: string | null; assembly?: string | null } = (result as any).metadata ?? {};
  const coordinates = md.genomicCoordinates ?? null;
  const assembly = assemblyOf(md.assembly);
  const scoredWindow = ev.spliceai.provenance?.source === "broad-lookup" ? ev.spliceai.provenance.distanceBp : null;
  const selected =
    target ?? (scoredWindow !== null && (SPLICEAI_WINDOWS as readonly number[]).includes(scoredWindow) ? scoredWindow : settings.spliceaiWindow ?? 500);
  const busy = target !== null;
  const unavailable = !coordinates || Boolean(disabled);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const choose = async (distance: number) => {
    if (busy || distance === selected || unavailable) return;
    const mine = ++latest.current;
    setTarget(distance);
    setError(null);
    try {
      const response = await fetchWithAuth("/api/v1/spliceai/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coordinates, assembly, distance }),
      });
      if (!response.ok) throw new Error(`Server returned ${response.status}`);
      const json = (await response.json()) as SpliceAiScoreResponse;
      if (mine !== latest.current) return;
      if (!json.attempted) {
        setError("SpliceAI was not asked: this coordinate's genome build is not one its service covers.");
      } else if (json.spliceai) {
        updateSetting?.("spliceaiWindow", distance);
        const store = useVariantAnalysisStore.getState();
        store.setAnalysisState((prev: any) =>
          prev?.result?.conservationData ? { ...prev, result: { ...prev.result, conservationData: mergeSpliceAiRescore(prev.result.conservationData, json) } } : prev
        );
      } else {
        setError(`Kept ±${scoredWindow ?? settings.spliceaiWindow ?? 500} bp. ${json.spliceaiFailure ? describeSpliceAiFailure(json.spliceaiFailure) : "SpliceAI returned no score at that window."}`);
      }
    } catch (err: any) {
      if (mine === latest.current) setError(`Kept ±${scoredWindow ?? settings.spliceaiWindow ?? 500} bp. ${err?.message ?? "The re-score failed."}`);
    } finally {
      if (mine === latest.current) setTarget(null);
    }
  };

  // WAI-ARIA radiogroup keys: arrows (and Home/End) MOVE focus along the options; Space/Enter choose. Choosing
  // is a network request, so selection does not follow focus the way a free radio would.
  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = SPLICEAI_WINDOWS.length - 1;
    const next =
      e.key === "ArrowRight" || e.key === "ArrowDown" ? (index + 1) % (last + 1)
      : e.key === "ArrowLeft" || e.key === "ArrowUp" ? (index + last) % (last + 1)
      : e.key === "Home" ? 0
      : e.key === "End" ? last
      : null;
    if (next === null) return;
    e.preventDefault();
    optionRefs.current[next]?.focus();
  };
  // One tab stop for the group: the selected option, or the first when none is.
  const stop = Math.max(0, (SPLICEAI_WINDOWS as readonly number[]).indexOf(selected));

  return (
    <div className="spl-window" data-testid="splice-window">
      <span className="spl-window__label" id="spl-window-label">SpliceAI window</span>
      <div className="spl-window__group" role="radiogroup" aria-labelledby="spl-window-label" aria-busy={busy}>
        {SPLICEAI_WINDOWS.map((w, i) => (
          <button
            key={w}
            ref={el => { optionRefs.current[i] = el; }}
            tabIndex={i === stop ? 0 : -1}
            onKeyDown={e => onKeyDown(e, i)}
            type="button"
            role="radio"
            aria-checked={w === selected}
            className="spl-window__opt"
            data-selected={w === selected || undefined}
            disabled={unavailable || (busy && w !== selected)}
            onClick={() => void choose(w)}
          >
            ±{w}
          </button>
        ))}
      </div>
      <span className="spl-window__status" role="status" aria-live="polite" data-error={error ? true : undefined}>
        {busy ? `Re-scoring at ±${target}…` : error ?? (unavailable && !coordinates ? "No genomic coordinate to re-score" : "")}
      </span>
    </div>
  );
}
