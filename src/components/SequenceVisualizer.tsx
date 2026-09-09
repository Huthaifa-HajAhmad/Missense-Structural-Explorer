import React, { useState, useEffect, useMemo, memo } from "react";
import { Dna, HelpCircle, Check, Copy, ChevronLeft, ChevronRight, Settings, ChevronDown, ChevronUp, Atom } from "lucide-react";
import { useSettings } from "../context/SettingsContext";
import { useApiClient } from "../apiClient";
import { useVariantAnalysisStore } from "../stores/useVariantAnalysisStore";
import { AMINO_ACID_1_TO_3_TITLE } from "../aminoAcids";
import { NearestResidue } from "../types";
import { getNearestResidues } from "../data";
import { THRESHOLDS } from "../shared/thresholds";

interface SequenceVisualizerProps {
  uniprotId: string;
  variant: string;
  residueIndex: number | null;
  hoveredResidueIndex?: number | null;
  gene: string;
  theme?: "dark" | "light";
  onResidueClick?: (index: number) => void;
  seqColorScheme?: "chemical" | "hydrophobic" | "minimal";
  seqScrollStep?: number;
  predictorData?: any;
  conservationData?: any;
  landscapeData?: any[] | null;
  computedResiduesCache?: Record<string, NearestResidue[]>;
  disruptionPredictor?: any;
  uniprotFeatures?: any[];
  metricMode?: "mean" | "max";
  windowSize?: number;
}

import { AMINO_ACID_MAP_FULL, AMINO_ACID_MAP_3_TO_1, getSubstitutionGroup } from "./sequence/sequenceConstants";
import { SequenceRowGrid } from "./sequence/SequenceRowGrid";
import { ResidueDetailTooltip } from "./sequence/ResidueDetailTooltip";
import { HoveredResidueInfo } from "./sequence/types";


const SequenceVisualizer = memo(function SequenceVisualizer({ 
  uniprotId, 
  variant, 
  residueIndex, 
  hoveredResidueIndex: hoveredResidueIndexProp, 
  gene, 
  theme,
  onResidueClick,
  seqColorScheme: seqColorSchemeProp,
  seqScrollStep: seqScrollStepProp,
  predictorData,
  conservationData,
  landscapeData,
  computedResiduesCache,
  disruptionPredictor,
  uniprotFeatures,
  metricMode = "mean",
  windowSize = 31
}: SequenceVisualizerProps) {
  const { settings } = useSettings();
  const { fetchWithAuth } = useApiClient();
  const storeHoveredIndex = useVariantAnalysisStore(s => s.hoveredResidueIndex);
  const hoveredResidueIndex = hoveredResidueIndexProp !== undefined ? hoveredResidueIndexProp : storeHoveredIndex;
  const seqColorScheme = seqColorSchemeProp || settings.seqColorScheme;

  const [sequence, setSequence] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [hoveredResidue, setHoveredResidue] = useState<HoveredResidueInfo | null>(null);

  const landscapeMap = useMemo(() => {
    const map = new Map<number, any>();
    if (landscapeData && Array.isArray(landscapeData)) {
      landscapeData.forEach((item) => {
        if (item && typeof item.residx === "number") {
          map.set(item.residx, item);
        }
      });
    }
    return map;
  }, [landscapeData]);

  const getResidueBaseColor = (res: string) => {
    if (seqColorScheme === "minimal") {
      return "bg-cs-bg-subtle text-cs-text-muted border-cs-border hover:text-cs-text-primary hover:bg-cs-surface hover:border-cs-accent-clay hover:scale-105";
    }

    if (seqColorScheme === "hydrophobic") {
      const hydrophobs = ["I", "V", "L", "F", "C", "M", "A", "W"];
      const isHydro = hydrophobs.includes(res);
      if (isHydro) {
        return "bg-cs-good/10 text-cs-good border-cs-good/20 hover:bg-cs-good/20 hover:scale-105";
      }
    }

    // Default: "chemical" scheme
    const match = AMINO_ACID_MAP_FULL[res];
    if (!match) {
      return "bg-cs-surface-2 text-cs-text-muted border-transparent hover:bg-cs-surface hover:text-cs-text-primary hover:scale-105";
    }

    if (match.property.includes("Acidic")) {
      return "bg-cs-danger-soft text-cs-danger border-cs-danger/20 hover:bg-cs-danger/25 hover:scale-105";
    }
    if (match.property.includes("Basic")) {
      return "bg-cs-accent-mag-soft text-cs-accent-mag border-cs-accent-mag/20 hover:bg-cs-accent-mag/25 hover:scale-105";
    }
    if (match.property.includes("Polar")) {
      return "bg-cs-accent-clay/10 text-cs-accent-clay border-cs-accent-clay/20 hover:bg-cs-accent-clay/25 hover:scale-105";
    }
    if (match.property.includes("Hydrophobic")) {
      if (match.property.includes("Aromatic")) {
        return "bg-cs-warn-soft text-cs-warn border-cs-warn/20 hover:bg-cs-warn/25 hover:scale-105";
      }
      return "bg-cs-good-soft text-cs-good border-cs-good/20 hover:bg-cs-good/25 hover:scale-105";
    }
    if (match.property.includes("Small") || match.property.includes("Rigid")) {
      return "bg-cs-accent-clay/15 text-cs-accent-clay border-cs-accent-clay/30 hover:bg-cs-accent-clay/25 hover:scale-105";
    }
    return "bg-cs-surface-2 text-cs-text-muted border-transparent hover:bg-cs-surface hover:text-cs-text-primary hover:scale-105";
  };



  useEffect(() => {
    let active = true;
    const fetchSequence = async () => {
      if (!uniprotId) {
        setSequence("");
        setLoading(false);
        setError(null);
        return;
      }
      setLoading(true);
      setError(null);
      
      const cleanUniprot = uniprotId.trim().toUpperCase();
      if (!/^[A-Z0-9\-]+$/i.test(cleanUniprot)) {
        setError("Invalid UniProt ID identifier.");
        setLoading(false);
        return;
      }

      try {
        const response = await fetchWithAuth(`/api/v1/sequence/${encodeURIComponent(cleanUniprot)}`);
        if (!response.ok) {
          throw new Error(`Failed to retrieve sequence data: ${response.statusText}`);
        }
        const data = await response.json();
        if (active) {
          setSequence(data.sequence || "");
        }
      } catch (err: any) {
        if (active) {
          console.warn("Unable to fetch UniProt sequence:", err);
          setError("UniProt sequence data unavailable. Check network or server connection.");
          setSequence("");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    fetchSequence();
    return () => {
      active = false;
    };
  }, [uniprotId]);

  // Decode variant (e.g. p.Arg215Trp or p.R215W) to get target components
  const parseClinicalMutation = () => {
    const clean = variant.replace(/^p\./i, "");
    
    // Check 3-letter naming first (e.g. Arg215Trp)
    const match3 = clean.match(/^([a-zA-Z]{3})(\d+)([a-zA-Z]{3})$/);
    if (match3) {
      const wt3 = match3[1].toUpperCase();
      const pos = parseInt(match3[2], 10);
      const mut3 = match3[3].toUpperCase();
      return {
        wtCode3: match3[1],
        mutCode3: match3[3],
        wt: AMINO_ACID_MAP_3_TO_1[wt3] || wt3.charAt(0),
        pos,
        mut: AMINO_ACID_MAP_3_TO_1[mut3] || mut3.charAt(0)
      };
    }

    // Check 1-letter naming (e.g. R215W)
    const match1 = clean.match(/^([a-zA-Z])(\d+)([a-zA-Z])$/);
    if (match1) {
      return {
        wtCode3: null,
        mutCode3: null,
        wt: match1[1].toUpperCase(),
        pos: parseInt(match1[2], 10),
        mut: match1[3].toUpperCase()
      };
    }

    // Backup parse if customized text
    const targetIdx = residueIndex || parseInt(clean.replace(/\D/g, ""), 10) || 1;
    return {
      wtCode3: null,
      mutCode3: null,
      wt: "X",
      pos: targetIdx,
      mut: "Z"
    };
  };

  const mutation = parseClinicalMutation();
  const mutationIndex = mutation.pos; // 1-based index of residue

  // If we don't have a loaded sequence, or if mutation position is out of bounds,
  // we dynamically align using a mock/synthesized region centered perfectly
  const getAlignmentData = () => {
    if (!sequence) return { wildWindow: [], mutWindow: [], relativeStartIndex: 1 };

    const seqLen = sequence.length;
    const half = Math.floor(windowSize / 2);
    
    // Centralize window on target residue
    let startIdx = Math.max(0, mutationIndex - 1 - half);
    let endIdx = Math.min(seqLen, startIdx + windowSize);
    
    // Adjust if running near end boundary
    if (endIdx - startIdx < windowSize) {
      startIdx = Math.max(0, endIdx - windowSize);
    }

    const wildWindowSeq = sequence.slice(startIdx, endIdx);
    const wildArr = wildWindowSeq.split("");
    
    // Construct mutant sequence alignment side of the window
    const mutArr = [...wildArr];
    const targetOffset = mutationIndex - 1 - startIdx;
    if (targetOffset >= 0 && targetOffset < mutArr.length) {
      mutArr[targetOffset] = mutation.mut;
    }

    return {
      wildWindow: wildArr,
      mutWindow: mutArr,
      relativeStartIndex: startIdx + 1,
      targetOffset
    };
  };

  const { wildWindow, mutWindow, relativeStartIndex, targetOffset } = getAlignmentData();

  const handleCopyFasta = () => {
    if (!sequence) return;
    const fastaText = `>Wildtype_${uniprotId}_${gene}\n${sequence}\n>Mutant_${uniprotId}_${gene}_${variant}\n${
      sequence.substring(0, mutationIndex - 1) + mutation.mut + sequence.substring(mutationIndex)
    }`;
    navigator.clipboard.writeText(fastaText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getRevelScore = (pos: number) => {
    if (pos === mutationIndex && conservationData?.revel !== undefined && conservationData?.revel !== null) {
      const parsed = parseFloat(String(conservationData.revel));
      if (!isNaN(parsed)) return parsed;
    }
    const match = landscapeMap.get(pos);
    if (!match) return null;
    if (metricMode === "mean") {
      return match.revelMean !== undefined && match.revelMean !== null ? match.revelMean : null;
    }
    return match.revelMax !== undefined && match.revelMax !== null ? match.revelMax : null;
  };

  const getAmScore = (pos: number) => {
    if (pos === mutationIndex && predictorData?.amPathogenicity !== undefined && predictorData?.amPathogenicity !== null) {
      const parsed = parseFloat(String(predictorData.amPathogenicity));
      if (!isNaN(parsed)) return parsed;
    }
    const match = landscapeMap.get(pos);
    if (!match) return null;
    if (metricMode === "mean") {
      return match.amMean !== undefined && match.amMean !== null ? match.amMean : null;
    }
    return match.amMax !== undefined && match.amMax !== null ? match.amMax : null;
  };

  const getGerpScore = (pos: number) => {
    if (pos === mutationIndex && conservationData?.gerp !== undefined && conservationData?.gerp !== null) {
      const parsed = parseFloat(String(conservationData.gerp));
      if (!isNaN(parsed)) return parsed;
    }
    const match = landscapeMap.get(pos);
    return match?.gerp !== undefined && match?.gerp !== null ? match.gerp : null;
  };

  const getPhyloPScore = (pos: number) => {
    if (pos === mutationIndex && conservationData?.phylop !== undefined && conservationData?.phylop !== null) {
      const parsed = parseFloat(String(conservationData.phylop));
      if (!isNaN(parsed)) return parsed;
    }
    const match = landscapeMap.get(pos);
    return match?.phylop !== undefined && match?.phylop !== null ? match.phylop : null;
  };

  const getBiophysicalConsequence = (symbol: string, pos: number) => {
    const wtProp = AMINO_ACID_MAP_FULL[symbol]?.property || "Neutral";
    const isTarget = pos === mutationIndex;
    
    // Parse local features from uniprotFeatures prop
    const localFeatures = uniprotFeatures?.filter((f: any) => pos >= f.start && pos <= f.end) || [];
    const activeSite = localFeatures.find((f: any) => f.type.toLowerCase().includes("active") || f.type.toLowerCase().includes("binding") || f.type.toLowerCase().includes("metal"));
    const interfaceSite = localFeatures.find((f: any) => f.type.toLowerCase().includes("region") || f.type.toLowerCase().includes("site") || f.type.toLowerCase().includes("dimer") || f.type.toLowerCase().includes("interface"));

    if (isTarget) {
      const wt3 = AMINO_ACID_1_TO_3_TITLE[mutation.wt] || mutation.wt;
      const mut3 = AMINO_ACID_1_TO_3_TITLE[mutation.mut] || mutation.mut;
      return `Queried mutation site: Swapping wild-type ${wt3} (${wtProp}) with mutant ${mut3} changes the local microenvironment, potentially disrupting critical tertiary packing or pocket contacts.`;
    }
    if (activeSite) {
      return `Curated Site: Mutating this residue is highly likely to disrupt functional catalysis or ligand docking (annotated as ${activeSite.type}: ${activeSite.description}).`;
    }
    if (interfaceSite) {
      return `Curated Interface: This residue lies in a binding interface region (${interfaceSite.description}). Substitutions here present a high-risk of disrupting macromolecular assembly.`;
    }
    if (wtProp.includes("Hydrophobic")) {
      return `Buried Core: Hydrophobic residues at this position contribute to the packing of the protein core. Polar or charged mutations here will break packing and cause misfolding.`;
    }
    return `Boundary/Surface residue: Solvent-exposed residues are generally tolerant of missense changes unless they overlap with active sites or binding interfaces.`;
  };

  interface SubstitutionGroup {
    name: string;
    residues: string[];
    badgeColor: string;
    consequence: string;
    severity: "high" | "medium" | "low";
  }

  const getSubstitutionalConsequences = (symbol: string, pos: number): SubstitutionGroup[] => {
    const wtProp = AMINO_ACID_MAP_FULL[symbol]?.property || "Neutral";
    
    // Check if we have UniProt features for this position
    const localFeatures = uniprotFeatures?.filter((f: any) => pos >= f.start && pos <= f.end) || [];
    const isActiveSite = localFeatures.some((f: any) => f.type.toLowerCase().includes("active") || f.type.toLowerCase().includes("binding") || f.type.toLowerCase().includes("metal"));
    const isInterface = localFeatures.some((f: any) => f.type.toLowerCase().includes("region") || f.type.toLowerCase().includes("site") || f.type.toLowerCase().includes("dimer") || f.type.toLowerCase().includes("interface"));
    
    let burial: "core" | "surface" | "boundary" = "boundary";
    if (pos === mutationIndex && disruptionPredictor?.burialStatus) {
      burial = disruptionPredictor.burialStatus;
    } else if (wtProp.includes("Hydrophobic")) {
      burial = "core";
    } else {
      burial = "surface";
    }

    if (isActiveSite) {
      return [
        {
          name: "Charged (D, E, K, R, H)",
          residues: ["D", "E", "K", "R", "H"],
          badgeColor: "bg-red-500/10 text-red-400 border-red-500/20",
          consequence: "Severe catalytic disruption. Alters pocket electrostatics directly.",
          severity: "high"
        },
        {
          name: "Polar (S, T, N, Q, C)",
          residues: ["S", "T", "N", "Q", "C"],
          badgeColor: "bg-sky-500/10 text-sky-400 border-sky-500/20",
          consequence: "Disrupts hydrogen bonding network in catalytic cleft.",
          severity: "high"
        },
        {
          name: "Hydrophobic (A, V, I, L, M, F, Y, W)",
          residues: ["A", "V", "I", "L", "M", "F", "Y", "W"],
          badgeColor: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
          consequence: "Steric pocket occlusion. Blocks ligand entry / binding.",
          severity: "high"
        },
        {
          name: "Conformational (P, G)",
          residues: ["P", "G"],
          badgeColor: "bg-purple-500/10 text-purple-400 border-purple-500/20",
          consequence: "Collapses pocket geometry. Completely inactivates function.",
          severity: "high"
        }
      ];
    }

    if (isInterface) {
      return [
        {
          name: "Charged (D, E, K, R, H)",
          residues: ["D", "E", "K", "R", "H"],
          badgeColor: "bg-red-500/10 text-red-400 border-red-500/20",
          consequence: "Introduces charge repulsion, blocking complex assembly.",
          severity: "high"
        },
        {
          name: "Polar (S, T, N, Q, C)",
          residues: ["S", "T", "N", "Q", "C"],
          badgeColor: "bg-sky-500/10 text-sky-400 border-sky-500/20",
          consequence: "Alters hydrogen bonding contacts with binding partner.",
          severity: "medium"
        },
        {
          name: "Hydrophobic (A, V, I, L, M, F, Y, W)",
          residues: ["A", "V", "I", "L", "M", "F", "Y", "W"],
          badgeColor: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
          consequence: "Disrupts hydrophobic interface packing or causes steric overlap.",
          severity: "medium"
        },
        {
          name: "Conformational (P, G)",
          residues: ["P", "G"],
          badgeColor: "bg-purple-500/10 text-purple-400 border-purple-500/20",
          consequence: "Disrupts local secondary structure essential for docking.",
          severity: "high"
        }
      ];
    }

    if (burial === "core") {
      return [
        {
          name: "Charged (D, E, K, R, H)",
          residues: ["D", "E", "K", "R", "H"],
          badgeColor: "bg-red-500/10 text-red-400 border-red-500/20",
          consequence: "Severe packing crash. Introducing charges in the core causes misfolding.",
          severity: "high"
        },
        {
          name: "Polar (S, T, N, Q, C)",
          residues: ["S", "T", "N", "Q", "C"],
          badgeColor: "bg-sky-500/10 text-sky-400 border-sky-500/20",
          consequence: "Unsatisfied hydrogen bonds in core. Moderately destabilizing.",
          severity: "medium"
        },
        {
          name: "Hydrophobic (A, V, I, L, M, F, Y, W)",
          residues: ["A", "V", "I", "L", "M", "F", "Y", "W"],
          badgeColor: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
          consequence: "Conservative changes. Minor volume shifts are generally well-packed.",
          severity: "low"
        },
        {
          name: "Conformational (P, G)",
          residues: ["P", "G"],
          badgeColor: "bg-purple-500/10 text-purple-400 border-purple-500/20",
          consequence: "Backbone conformation breach. High risk of local sheet/helix collapse.",
          severity: "high"
        }
      ];
    }

    return [
      {
        name: "Charged (D, E, K, R, H)",
        residues: ["D", "E", "K", "R", "H"],
        badgeColor: "bg-red-500/10 text-red-400 border-red-500/20",
        consequence: "Highly tolerated on solvent-exposed protein surfaces.",
        severity: "low"
      },
      {
        name: "Polar (S, T, N, Q, C)",
        residues: ["S", "T", "N", "Q", "C"],
        badgeColor: "bg-sky-500/10 text-sky-400 border-sky-500/20",
        consequence: "Highly tolerated. Maintains polar solvent interactions.",
        severity: "low"
      },
      {
        name: "Hydrophobic (A, V, I, L, M, F, Y, W)",
        residues: ["A", "V", "I", "L", "M", "F", "Y", "W"],
        badgeColor: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
        consequence: "Surface hydrophobicity increase; may prompt aggregation.",
        severity: "low"
      },
      {
        name: "Conformational (P, G)",
        residues: ["P", "G"],
        badgeColor: "bg-purple-500/10 text-purple-400 border-purple-500/20",
        consequence: "Proline can disrupt loops. Glycine can introduce excessive flexibility.",
        severity: "medium"
      }
    ];
  };

  return (
    <div 
      id="sequence-alignment-visualizer" 
      className="flex flex-col gap-5 animate-fade-in text-cs-text-primary w-full p-6"
    >
      {/* Visualizer header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-cs-border-subtle transition-colors">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg border border-cs-border-subtle bg-cs-surface-2 transition">
            <Dna className="w-4 h-4 text-cs-accent-clay" />
          </div>
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider font-mono text-cs-text-primary">
              REVEL & AlphaMissense Local Pathogenicity Landscape
            </h3>
            <p className="text-xs mt-0.5 text-cs-text-muted">
              Visualizing missense constraint and pathogenicity scores across residues surrounding mutation position #{mutationIndex}
            </p>
          </div>
        </div>
      </div>

      {!sequence ? (
        <div className="text-center py-12 text-slate-500">
          <Dna className="w-10 h-10 mx-auto text-indigo-500 stroke-[1.5] mb-2 animate-pulse" />
          <p className="text-sm font-semibold font-mono uppercase tracking-wider text-indigo-500" style={{ color: "var(--cs-accent-clay)" }}>Pathogenicity Landscape Ready</p>
          <div className="w-16 h-[1px] bg-slate-800/10 dark:bg-slate-800/60 mx-auto my-3"></div>
          <p className="text-xs max-w-sm mx-auto mt-1 leading-relaxed" style={{ color: "var(--cs-text-muted)" }}>
            Select a variant above and press <strong style={{ color: "var(--cs-accent-clay)" }}>Analyze Mutation Effect</strong> to view REVEL, AlphaMissense, GERP++, and PhyloP scores surrounding your mutation of interest.
          </p>
        </div>
      ) : loading ? (
        <div className="h-28 flex flex-col items-center justify-center text-slate-400 text-xs">
          <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mb-2"></div>
          <span>Aligning protein sequence strings...</span>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          
          {/* Residue Row Grid & Threshold Legends */}
          <SequenceRowGrid
            wildWindow={wildWindow}
            relativeStartIndex={relativeStartIndex}
            mutationIndex={mutationIndex}
            residueIndex={residueIndex}
            hoveredResidueIndex={hoveredResidueIndex}
            mutation={mutation}
            landscapeMap={landscapeMap}
            metricMode={metricMode}
            getResidueBaseColor={getResidueBaseColor}
            getGerpScore={getGerpScore}
            getPhyloPScore={getPhyloPScore}
            getRevelScore={getRevelScore}
            getAmScore={getAmScore}
            onResidueClick={onResidueClick}
            hoveredResidue={hoveredResidue}
            setHoveredResidue={setHoveredResidue}
          />

          {/* Data Provenance Info Notes */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 border-t pt-2 border-cs-border-subtle mt-1 mb-2 px-1">
            <span className="text-[9px] font-sans italic text-cs-text-muted">
              * Note: For GERP++ and PhyloP, high conservation scores indicate high vulnerability to missense disruption.
            </span>
            <span className="text-[9px] font-mono tracking-wide text-cs-text-muted">
              Scores sourced from dbNSFP v4.4a via MyVariant.info REST API.
            </span>
          </div>

          {/* Interactive Residue Details & Substitutional Class Tooltip */}
          <ResidueDetailTooltip
            hoveredResidue={hoveredResidue}
            hoveredResidueIndex={hoveredResidueIndex}
            residueIndex={residueIndex}
            mutationIndex={mutationIndex}
            sequence={sequence}
            mutation={mutation}
            uniprotId={uniprotId}
            variant={variant}
            landscapeMap={landscapeMap}
            conservationData={conservationData}
            predictorData={predictorData}
            computedResiduesCache={computedResiduesCache}
            getGerpScore={getGerpScore}
            getPhyloPScore={getPhyloPScore}
            getBiophysicalConsequence={getBiophysicalConsequence}
            getSubstitutionalConsequences={getSubstitutionalConsequences}
          />

          {/* Note explaining metric calculation logic */}
          <div className="flex items-center gap-1.5 mt-2 px-1 text-[9.5px] font-sans text-cs-text-muted leading-tight">
            <span className="w-1.5 h-1.5 rounded-full bg-cs-accent-clay animate-pulse shrink-0" />
            <span>
              * <strong>Note</strong>: The queried variant residue position displays the direct variant score, whereas neighboring residues display positional aggregate metrics (Mean Intolerance or Peak Constraint).
            </span>
          </div>

        </div>
      )}
    </div>
  );
})

export default SequenceVisualizer;
