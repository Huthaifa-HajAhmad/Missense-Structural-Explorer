import { z } from "zod";
import {
  validateGene,
  validateVariant,
  validateUniProt,
  sendError,
  filterPII,
  formatZodError,
} from "../../utils.ts";
import {
  fetchUniprotSequence,
  resolveGeneToUniprot,
} from "../../services/external.ts";
import { AMINO_ACID_3_TO_1 } from "../../../src/shared/aminoAcids.ts";
import { parseVariantCoordinate } from "../../../src/shared/variantCoordinate.ts";
import { classifyNotation, type GenomeAssembly } from "../../../src/shared/variantNotation.ts";
import { resolveGeneProteinNumbering } from "../../services/translation/protein-numbering.ts";
import { buildAmbiguousNumberingMessage } from "../../services/translation/isoform-remap.ts";

export const analyzeVariantSchema = z.object({
  gene: z.string().min(1).max(100),
  variant: z.string().min(1).max(200),
  /**
   * Genome build the caller's coordinate notation was expressed in.
   *
   * Carried explicitly because nearly every coordinate-consuming source downstream is
   * single-build (GPN-Star, local dbNSFP, Genos, dbnsfp.org, gnomAD r4 variant ids, and
   * the SpliceAI Lookup client), and this application supports GRCh37 input by design.
   * Without it the build was silently assumed to be GRCh38. Defaults to GRCh38 so
   * existing clients keep their current behaviour.
   */
  assembly: z.enum(["GRCh37", "GRCh38"]).optional().default("GRCh38"),
  uniprotId: z.string().max(50).optional().default(""),
  acmgWeighting: z.enum(["standard", "conservative", "strict-structural"]).optional(),
  userDirections: z.string().max(1000).optional(),
  originalNotation: z.string().max(200).optional(),
  biohubToken: z.string().optional(),
  hfToken: z.string().optional(),
  gpnApiUrl: z.string().url().max(512).optional(),
  alphagenomeApiKey: z.string().optional(),
  alphagenomeApiUrl: z.string().url().max(512).optional(),
  saprotEngine: z.enum(["saprot-650m", "saprot-35m", "remote-hf"]).or(z.string()).optional(),
});

const BLOCKED_HOST_REGEX = /^(169\.254\.\d+\.\d+|metadata\.google\.internal|metadata|instance-data|0\.0\.0\.0|localhost|::1|\[::1\]|::|\[::\])$/i;

export const sanitizeToken = (val: unknown): string | null => {
  if (!val) return null;
  const raw = Array.isArray(val) ? val[0] : val;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  // Enforce reasonable length bound (max 256 chars) and printable ASCII only
  if (trimmed.length === 0 || trimmed.length > 256 || !/^[\x21-\x7E]+$/.test(trimmed)) {
    return null;
  }
  return trimmed;
};

export const sanitizeUrl = (val: unknown): string | null => {
  if (!val) return null;
  const raw = Array.isArray(val) ? val[0] : val;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 512) {
    return null;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    const hostname = parsed.hostname.toLowerCase();
    if (BLOCKED_HOST_REGEX.test(hostname)) {
      return null;
    }

    const cleanHost = hostname.replace(/^\[|\]$/g, "");
    if (
      cleanHost === "::1" ||
      cleanHost === "::" ||
      cleanHost.startsWith("fe80:") ||
      cleanHost.startsWith("fc00:") ||
      cleanHost.startsWith("fd00:") ||
      cleanHost.startsWith("::ffff:127.") ||
      cleanHost.startsWith("::ffff:169.254.")
    ) {
      return null;
    }

    if (process.env.NODE_ENV === "production") {
      // Disallow localhost and RFC1918 private subnets in production environments
      if (
        hostname === "localhost" ||
        hostname.startsWith("127.") ||
        hostname.startsWith("10.") ||
        hostname.startsWith("192.168.") ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
        cleanHost.startsWith("::ffff:10.") ||
        cleanHost.startsWith("::ffff:192.168.") ||
        /^::ffff:172\.(1[6-9]|2\d|3[01])\./.test(cleanHost)
      ) {
        return null;
      }
    }
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
};

export const getEngine = (val: unknown): string | undefined => {
  if (!val) return undefined;
  const raw = Array.isArray(val) ? val[0] : val;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim().toLowerCase();
  return trimmed === "local" || trimmed === "remote" ? trimmed : undefined;
};

export interface ParsedVariantContext {
  gene: string;
  variant: string;
  uniprotId: string;
  originalNotation?: string;
  userDirections?: string;
  acmgWeighting: "standard" | "conservative" | "strict-structural";
  /**
   * Build the supplied coordinate notation was expressed in. Threaded to every
   * coordinate-consuming consumer so a single-build source can never be handed the
   * wrong build's coordinates. Optional in the type because the parser always fills it
   * (the request schema defaults it to GRCh38); consumers default it identically.
   */
  assembly?: GenomeAssembly;
  residueIndex: string;
  wildType: string;
  mutant: string;
  sequence: string;
  pos: number;
  wt1Letter: string;
  mut1Letter: string;
  /**
   * False when the numbering could not be verified across the gene's isoforms (UniProt
   * unreachable). The analysis still runs — a provider outage must not fail a valid query — but the
   * result is disclosed as unverified rather than presented as a clean canonical match.
   */
  numberingVerified?: boolean;
  /** Human-readable disclosure for the unverified case; surfaced with the analysis result. */
  numberingWarning?: string;
  biohubToken?: string | null;
  hfToken?: string | null;
  gpnApiUrl?: string | null;
  alphagenomeApiKey?: string | null;
  alphagenomeApiUrl?: string | null;
  saprotEngine?: "saprot-650m" | "saprot-35m" | "remote-hf" | string;
}

export async function validateAndParseVariantRequest(req: any, res: any): Promise<ParsedVariantContext | null> {
  const parseResult = analyzeVariantSchema.safeParse(req.body);
  if (!parseResult.success) {
    sendError(res, 400, "BAD_REQUEST", formatZodError(parseResult.error));
    return null;
  }

  let gene: string, variant: string, uniprotId: string;
  let userDirections: string | undefined;
  let acmgWeighting: "standard" | "conservative" | "strict-structural" = "standard";
  let originalNotation: string | undefined;

  // An accession-qualified notation names the protein its residue numbers belong to, so it MUST be
  // resolved (and converted onto canonical numbering) by the translation service — never read by
  // index here. Checked BEFORE `validateVariant`, which rejects the accession as a malformed
  // substitution (400) and would hide the real problem: the protein parser strips the accession and
  // applies the position to the CANONICAL sequence, which is a different residue (the MANE letter
  // coincides at ~3.6% of positions for a 9-residue offset).
  if (classifyNotation(typeof req.body?.variant === "string" ? req.body.variant : "").kind === "protein-accessioned") {
    sendError(
      res,
      422,
      "UNPROCESSABLE_ENTITY",
      `"${req.body.variant}" states the protein its numbering belongs to, so it must be resolved before analysis: ` +
        "POST /api/v1/translate-variant returns the canonical-numbered substitution (the UI does this automatically). " +
        "Alternatively enter the substitution in canonical numbering, or use the genomic/cDNA coordinate."
    );
    return null;
  }

  try {
    gene = validateGene(req.body.gene);
    variant = validateVariant(req.body.variant);
    const requestedUniprotId = typeof req.body.uniprotId === "string" ? req.body.uniprotId.trim() : "";
    if (requestedUniprotId) {
      uniprotId = validateUniProt(requestedUniprotId);
    } else {
      const resolvedUniprotId = await resolveGeneToUniprot(gene);
      if (!resolvedUniprotId) {
        throw new Error(`Could not resolve gene '${gene}' to a UniProt accession. Please provide the UniProt ID manually.`);
      }
      uniprotId = validateUniProt(resolvedUniprotId);
    }
    originalNotation = req.body.originalNotation ? String(req.body.originalNotation) : undefined;

    if (req.body.userDirections !== undefined) {
      if (typeof req.body.userDirections !== "string") {
        throw new Error("userDirections must be a string");
      }
      userDirections = filterPII(req.body.userDirections.slice(0, 1000));
    }

    if (req.body.acmgWeighting !== undefined) {
      if (req.body.acmgWeighting === "standard" || req.body.acmgWeighting === "conservative" || req.body.acmgWeighting === "strict-structural") {
        acmgWeighting = req.body.acmgWeighting;
      } else {
        throw new Error("acmgWeighting must be one of: standard, conservative, strict-structural");
      }
    }
  } catch (err: any) {
    sendError(res, 400, "BAD_REQUEST", err.message);
    return null;
  }

  // NOTE: the accessioned-family gate above runs before this block on purpose (see there).
  let coord;
  try {
    coord = parseVariantCoordinate(variant, { gene, uniprotId });
  } catch (parseErr: any) {
    sendError(res, 400, "BAD_REQUEST", parseErr.message || `Invalid protein variant format: ${variant}`);
    return null;
  }

  const residueIndex = String(coord.pos);
  const wildType = coord.wt3;
  const mutant = coord.mut3;
  const wt1Letter = coord.wt1;
  const mut1Letter = coord.mut1;
  const pos = coord.pos;

  let sequence: string;
  try {
    sequence = await fetchUniprotSequence(uniprotId);
  } catch (seqErr: any) {
    sendError(res, 502, "BAD_GATEWAY", `Failed to retrieve protein sequence from UniProt: ${seqErr.message}`);
    return null;
  }

  if (pos < 1 || pos > sequence.length) {
    sendError(
      res,
      422,
      "UNPROCESSABLE_ENTITY",
      `Mutation residue index ${pos} is out of bounds for protein ${uniprotId} (sequence length: ${sequence.length}).`
    );
    return null;
  }

  const actualWt = sequence[pos - 1];
  if (actualWt !== wt1Letter) {
    /**
     * Diagnose WHY, before answering. A MANE Select notation is the common cause and it has a
     * remedy that works today (the accession-qualified form), so the answer names it — and when
     * two numberings are equally consistent at DIFFERENT canonical positions it says so instead
     * of picking one, because choosing here would model an arbitrary residue.
     *
     * Best-effort: `resolveGeneProteinNumbering` returns null when UniProt is unreachable, so an
     * outage leaves the previous message in place rather than failing the request.
     */
    const numbering = await resolveGeneProteinNumbering({ gene, notation: variant, canonicalAccession: uniprotId });

    if (numbering?.status === "ambiguous" && numbering.candidates?.length) {
      sendError(
        res,
        422,
        "AMBIGUOUS_PROTEIN_NUMBERING",
        buildAmbiguousNumberingMessage(variant, numbering.candidates) +
          ` (${gene} position ${pos} does not carry ${wt1Letter} in ${uniprotId}.)`
      );
      return null;
    }

    const canonicalEquivalent =
      numbering?.status === "remapped" ? numbering.canonicalVariant : undefined;

    sendError(
      res,
      422,
      "UNPROCESSABLE_ENTITY",
      `Wild-type residue mismatch at position ${pos} for ${uniprotId}. Expected ${actualWt}, but query specified ${wt1Letter} (${wildType}). ` +
        (canonicalEquivalent
          ? `This notation is numbered on ${numbering?.basisId ?? "another isoform"} of this protein, not the canonical sequence: ` +
            `enter ${canonicalEquivalent} (the canonical-equivalent substitution) instead, or the genomic/cDNA coordinate.`
          : `This usually means the notation is numbered on a different protein isoform than the canonical ${uniprotId} sequence ` +
            "(a MANE Select notation can sit at a different position on the canonical isoform), or that the wild-type residue was mistyped. ") +
        "Qualify the notation with the protein it was reported on (e.g. NP_001032248.1:p.Lys281Asn, or Q9Y305-4:p.Lys281Asn) so the " +
        "numbering is mapped onto the canonical sequence, or enter the genomic/cDNA coordinate."
    );
    return null;
  }

  /**
   * The wild type MATCHES the canonical sequence — but for a gene whose MANE protein is numbered
   * differently, the same letters can also describe a DIFFERENT canonical residue (ACOT9: 16 of 400
   * indices, where the offset is 9). So the match is verified across every numbering before any
   * analysis is modelled:
   *   - two numberings consistent at DIFFERENT canonical positions → refuse; picking one would
   *     model an arbitrary residue;
   *   - verification impossible (UniProt unreachable) → accept, but say so, because a provider
   *     outage must not fail an otherwise valid query and must not be mistaken for a clean bill.
   */
  const numbering = await resolveGeneProteinNumbering({
    gene,
    notation: variant,
    canonicalAccession: uniprotId,
    // A bare notation is canonical- or MANE-numbered in practice, so the ambiguity check compares
    // exactly that pair: admitting every isoform of the gene multiplies the refusal set (ACOT9:
    // 14.8% of positions versus 3.4%) for numberings a report would not be using.
    basisScope: "mane",
  });

  if (numbering?.status === "ambiguous" && numbering.candidates?.length) {
    sendError(
      res,
      422,
      "AMBIGUOUS_PROTEIN_NUMBERING",
      buildAmbiguousNumberingMessage(variant, numbering.candidates) +
        ` Both are consistent with ${uniprotId} at position ${pos}; enter the genomic/cDNA coordinate ` +
        "to settle which protein these residue numbers belong to.",
      {
        notation: variant,
        candidates: numbering.candidates.map((candidate) => candidate.variant),
      }
    );
    return null;
  }

  const numberingVerified = numbering !== null && numbering.status === "canonical";
  const numberingWarning = numberingVerified
    ? undefined
    : `Numbering not verified for ${gene} ${variant}: ${
        numbering?.reason ??
        "the isoform model could not be reached"
      }. The residue was matched against the canonical ${uniprotId} sequence; if this notation was ` +
      "reported on a different isoform its position may refer to another residue. Qualify it with " +
      "the protein it was reported on (e.g. NP_001032248.1:p.Lys281Asn) or use the genomic/cDNA coordinate.";

  return {
    gene,
    variant,
    uniprotId,
    numberingVerified,
    numberingWarning,
    originalNotation,
    userDirections,
    acmgWeighting,
    // The schema defaults this to GRCh38, so it is always a concrete build by here.
    assembly: (req.body.assembly ?? "GRCh38") as GenomeAssembly,
    residueIndex,
    wildType,
    mutant,
    sequence,
    pos,
    wt1Letter,
    mut1Letter,
    biohubToken: sanitizeToken(req.headers["x-biohub-token"]) || sanitizeToken(req.body?.biohubToken) || sanitizeToken(process.env.BIOHUB_API_TOKEN),
    hfToken: (() => {
      const userHfToken = sanitizeToken(req.headers["x-hf-token"]) || sanitizeToken(req.body?.hfToken);
      if (userHfToken) return userHfToken;
      const clientGpnUrl = sanitizeUrl(req.headers["x-gpn-api-url"]) || sanitizeUrl(req.body?.gpnApiUrl);
      const isCustomGpnUrl = Boolean(
        clientGpnUrl &&
        !clientGpnUrl.includes(".huggingface.co") &&
        !clientGpnUrl.includes(".hf.space")
      );
      return !isCustomGpnUrl ? sanitizeToken(process.env.HF_TOKEN) : null;
    })(),
    gpnApiUrl: sanitizeUrl(req.headers["x-gpn-api-url"]) || sanitizeUrl(req.body?.gpnApiUrl) || sanitizeUrl(process.env.GPN_API_URL),
    alphagenomeApiKey: sanitizeToken(req.headers["x-alphagenome-key"]) || sanitizeToken(req.body?.alphagenomeApiKey) || sanitizeToken(process.env.ALPHAGENOME_API_KEY),
    alphagenomeApiUrl: sanitizeUrl(req.headers["x-alphagenome-url"]) || sanitizeUrl(req.body?.alphagenomeApiUrl) || sanitizeUrl(process.env.ALPHAGENOME_API_URL),
    saprotEngine: getEngine(req.body?.saprotEngine) || getEngine(req.headers["x-saprot-engine"])
  };
}
