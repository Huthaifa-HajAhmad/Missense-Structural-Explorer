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

export const analyzeVariantSchema = z.object({
  gene: z.string().min(1).max(100),
  variant: z.string().min(1).max(200),
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
  residueIndex: string;
  wildType: string;
  mutant: string;
  sequence: string;
  pos: number;
  wt1Letter: string;
  mut1Letter: string;
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
