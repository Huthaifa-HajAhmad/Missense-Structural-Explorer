/**
 * numbering-intake.ts — POST /numbering-proof: the numbering check for a typed protein notation, at intake.
 *
 * `POST /translate-variant` signs a numbering proof for coordinate and `NP_…` input, but a typed protein
 * notation (`p.Lys281Asn`) never passes through it. The browser starts the structure, FoldX, landscape,
 * multimer and PPI requests in parallel with the analysis, so a proof returned by the analysis would reach
 * almost none of them. This route runs the analysis route's own check first (`validateAndParseVariantRequest`:
 * the gene's UniProt accession, the wild type, canonical against MANE numbering) and signs the residue
 * it verified, so every request of the run can carry the proof (doc/VERIFIED_RESIDUE_DESIGN.md §2).
 *
 * It answers what the analysis would answer: the same refusals (wild-type mismatch, ambiguous numbering),
 * and no proof for an unverified residue. It also returns the resolved accession, so it replaces the
 * browser's separate gene lookup.
 */
import { type Router } from "express";
import { validateAndParseVariantRequest } from "./variant-parser.ts";
import { issueNumberingProof } from "../../services/translation/numbering-proof.ts";

export function registerNumberingIntakeRoute(apiRouter: Router, jsonParserRegular: any): void {
  apiRouter.post("/numbering-proof", jsonParserRegular, async (req, res) => {
    // The parser has already sent its refusal when it returns null.
    const context = await validateAndParseVariantRequest(req, res);
    if (!context) return;

    const residueProof = context.numberingAudit.numberingProof;
    const numberingProof = issueNumberingProof({
      accession: context.uniprotId,
      position: context.pos,
      wildType: context.wt1Letter,
      mutant: context.mut1Letter,
      proof: residueProof,
    });
    res.json({
      gene: context.gene,
      variant: context.variant,
      uniprotId: context.uniprotId,
      residueProof,
      ...(numberingProof ? { numberingProof } : {}),
    });
  });
}
