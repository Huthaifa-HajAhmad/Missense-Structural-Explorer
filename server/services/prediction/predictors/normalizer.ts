/**
 * Value parsing, coercion, and amino acid conversion utilities for predictor services.
 */

export function safeParseFloat(val: any): number | null {
  if (val === undefined || val === null || val === "." || val === "") return null;
  const num = parseFloat(String(val));
  return isNaN(num) ? null : num;
}

export function safeParseInt(val: any): number | null {
  if (val === undefined || val === null || val === "." || val === "") return null;
  const num = parseInt(String(val), 10);
  return isNaN(num) ? null : num;
}

const AA_MAP_3_TO_1: Record<string, string> = {
  ala: 'A', arg: 'R', asn: 'N', asp: 'D', cys: 'C', gln: 'Q', glu: 'E',
  gly: 'G', his: 'H', ile: 'I', leu: 'L', lys: 'K', met: 'M', phe: 'F',
  pro: 'P', ser: 'S', thr: 'T', trp: 'W', tyr: 'Y', val: 'V'
};

export function toSingleAa(aa: string): string {
  if (!aa) return "";
  return AA_MAP_3_TO_1[aa.toLowerCase()] || aa.toUpperCase();
}

export function getFirstOrVal(v: any): any {
  if (Array.isArray(v)) return v[0];
  if (typeof v === 'string' && v.includes(';')) return v.split(';')[0];
  return v;
}
