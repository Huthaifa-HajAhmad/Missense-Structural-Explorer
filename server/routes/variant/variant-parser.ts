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
import { AMINO_ACID_3_TO_1 } from "../../../src/aminoAcids.ts";
import { parseVariantCoordinate } from "../../../src/shared/variantCoordinate.ts";

export const analyzeVariantSchema = z.object({
  gene: z.string().min(1).max(100),
  variant: z.string().min(1).max(200),
  uniprotId: z.string().max(50).optional().default(""),
  acmgWeighting: z.enum(["standard", "conservative", "strict-structural"]).optional(),
  userDirections: z.string().max(1000).optional(),
  originalNotation: z.string().max(200).optional(),
  biohubToken: z.string().optional(),
  hfToken: z.string().optional(),
  nvidiaApiKey: z.string().optional(),
  evo2Key: z.string().optional(),
  saprotEngine: z.enum(["saprot-650m", "saprot-35m", "remote-hf"]).or(z.string()).optional(),
});

export interface ParsedVariantContext {
  gene: string;
  variant: string;
  uniprotId: string;
  originalNotation?: string;
  userDirections?: string;
  acmgWeighting: "standard" | "conservative" | "strict-structural";
  residueIndex: string;
  wildType: string;
  mutant: string;
  sequence: string;
  pos: number;
  wt1Letter: string;
  mut1Letter: string;
  biohubToken?: string | null;
  hfToken?: string | null;
  nvidiaApiKey?: string | null;
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
    sendError(
      res,
      422,
      "UNPROCESSABLE_ENTITY",
      `Wild-type residue mismatch at position ${pos} for ${uniprotId}. Expected ${actualWt}, but query specified ${wt1Letter} (${wildType}).`
    );
    return null;
  }

  const sanitizeToken = (val: unknown): string | null => {
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

  const getEngine = (val: unknown): string | undefined => {
    if (!val) return undefined;
    const raw = Array.isArray(val) ? val[0] : val;
    if (typeof raw !== "string") return undefined;
    const trimmed = raw.trim().toLowerCase();
    return trimmed === "local" || trimmed === "remote" ? trimmed : undefined;
  };

  return {
    gene,
    variant,
    uniprotId,
    originalNotation,
    userDirections,
    acmgWeighting,
    residueIndex,
    wildType,
    mutant,
    sequence,
    pos,
    wt1Letter,
    mut1Letter,
    biohubToken: sanitizeToken(req.headers["x-biohub-token"]) || sanitizeToken(req.body?.biohubToken) || sanitizeToken(process.env.BIOHUB_API_TOKEN),
    hfToken: sanitizeToken(req.headers["x-hf-token"]) || sanitizeToken(req.body?.hfToken) || sanitizeToken(process.env.HF_TOKEN),
    nvidiaApiKey: sanitizeToken(req.headers["x-nvidia-api-key"]) || sanitizeToken(req.headers["x-evo2-key"]) || sanitizeToken(req.body?.nvidiaApiKey) || sanitizeToken(req.body?.evo2Key) || sanitizeToken(process.env.NVIDIA_API_KEY) || sanitizeToken(process.env.EVO2_API_KEY),
    saprotEngine: getEngine(req.body?.saprotEngine) || getEngine(req.headers["x-saprot-engine"])
  };
}
