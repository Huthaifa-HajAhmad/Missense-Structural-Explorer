import type { RegionKind } from "../../shared/residueRegions";

export interface TargetMutation {
  wt: string;
  pos: number;
  mut: string;
}

/** The queried variant's own scores, drawn apart from the residue summaries. */
export interface VariantScores {
  revel: number | null;
  am: number | null;
  gerp: number | null;
  phylop: number | null;
}

export interface DomainSpan {
  kind: RegionKind;
  name: string;
  start: number;
  end: number;
}
