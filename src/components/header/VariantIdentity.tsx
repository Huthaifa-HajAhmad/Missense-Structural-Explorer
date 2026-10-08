import React from "react";
import { ExternalLink, Scissors } from "lucide-react";
import { CopyBtn } from "./CopyBtn";
import type { VariantHeaderModel } from "./variantHeaderModel";

/**
 * The variant's identity, as the top bar's title: gene and HGVS, then the transcript, the coordinate
 * and the UniProt accession on the same line.
 *
 * The variant IS the page's subject on every analysis view, so it takes the title slot the breadcrumb
 * used to hold — the sidebar already says where you are and the page's H1 names the page.
 *
 * Splice proximity rides here as the last chip: it is CONTEXT about the variant's placement, not a
 * finding, and it reads on every evidence page — which is what this bar is for. Its words ("−6
 * donor", "Near splice site") carry the meaning; the scissors only say it is the splicing chip.
 *
 * The identifiers drop in a fixed order as the bar narrows (splice context first, then UniProt,
 * then the coordinate, then the transcript; see `.vid` container queries) and never wrap: the full
 * set is in the Population rail's Variant lineage. The gene and HGVS never drop.
 */
export function VariantIdentity({ model }: { model: VariantHeaderModel }) {
  const { gene, headlineVariant, transcript, coordinate, uniprotId, splicePlacement } = model;
  return (
    <div className="vid" role="group" aria-label="Active variant">
      <span className="vid-title">
        <span className="vid-gene">{gene}</span>
        {headlineVariant && (
          <span className="vid-hgvs">
            {headlineVariant}
            <CopyBtn text={headlineVariant} label="variant notation" />
          </span>
        )}
      </span>

      {transcript && (
        <span className="vid-chip vid-chip--transcript" title={transcript.title}>
          <span className="vh-sr-only">Transcript </span>
          <span className="vid-value">{transcript.id}</span>
          {transcript.tier.label && (
            <span className="vid-tag" data-tone={transcript.tier.tone}>
              {transcript.tier.label}
            </span>
          )}
          <CopyBtn text={transcript.id} label="transcript ID" />
        </span>
      )}

      {coordinate && (
        <span className="vid-chip vid-chip--coordinate" title={coordinate.title}>
          <span className="vh-sr-only">{coordinate.srLabel}</span>
          {/* The build named the way the field names it; an unreported build gets no key at all. */}
          {coordinate.assemblyKey && <span className="vid-key" aria-hidden="true">{coordinate.assemblyKey}</span>}
          <span className="vid-value">{coordinate.id}</span>
          <CopyBtn text={coordinate.id} label="genomic coordinates" />
        </span>
      )}

      {uniprotId && (
        <span className="vid-chip vid-chip--uniprot" title={`UniProt protein accession ${uniprotId}`}>
          <span className="vh-sr-only">UniProt accession </span>
          <span className="vid-key" aria-hidden="true">UniProt</span>
          <span className="vid-value">{uniprotId}</span>
          <a
            href={`https://www.uniprot.org/uniprotkb/${encodeURIComponent(uniprotId)}/entry`}
            target="_blank"
            rel="noopener noreferrer"
            className="vh-icon-btn"
            title={`Open ${uniprotId} in UniProt`}
            aria-label={`Open UniProt entry for ${uniprotId}`}
          >
            <ExternalLink size={11} strokeWidth={2} />
          </a>
        </span>
      )}

      {splicePlacement && (
        <span
          className="vid-chip vid-chip--splice"
          data-testid="splice-proximity-chip"
          title={`${splicePlacement.long}. Distance from a splice junction is context, not evidence of a splicing effect — see RNA splicing.`}
        >
          <span className="vh-sr-only">Splicing context </span>
          <Scissors className="vid-splice-icon" size={11} strokeWidth={1.75} aria-hidden="true" />
          <span className="vid-value">{splicePlacement.short}</span>
          <span className="vid-tag" data-tone="muted">
            Near splice site
          </span>
          <span className="vh-sr-only">
            Near a splice site: variant is {splicePlacement.long}. Distance is context, not evidence of a splicing effect.
          </span>
        </span>
      )}
    </div>
  );
}
