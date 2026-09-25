import React, { useState, useMemo, useCallback, memo } from "react";
import { Dna } from "lucide-react";
import { useSettings } from "../context/SettingsContext";
import { useProteinSequence } from "../hooks/useProteinSequence";
import { useVariantAnalysisStore } from "../stores/useVariantAnalysisStore";
import { parseGenomicCoordinateString } from "../shared/contracts";

interface SequenceVisualizerProps {
  uniprotId: string;
  variant: string;
  residueIndex: number | null;
  hoveredResidueIndex?: number | null;
  onResidueClick?: (index: number) => void;
  onSelectGenomicVariant?: (variant: any) => void;
  seqColorScheme?: "chemical" | "hydrophobic" | "minimal";
  predictorData?: any;
  conservationData?: any;
  landscapeData?: any[] | null;
  metricMode?: "mean" | "max";
  windowSize?: number;
}

import { AMINO_ACID_MAP_FULL, AMINO_ACID_MAP_3_TO_1 } from "./sequence/sequenceConstants";
import { SequenceRowGrid } from "./sequence/SequenceRowGrid";
import { GenomicSaturationHeatmap } from "./sequence/GenomicSaturationHeatmap";
import { HoveredResidueInfo } from "./sequence/types";


const SequenceVisualizer = memo(function SequenceVisualizer({ 
  uniprotId, 
  variant, 
  residueIndex, 
  hoveredResidueIndex: hoveredResidueIndexProp, 
  onResidueClick,
  onSelectGenomicVariant,
  seqColorScheme: seqColorSchemeProp,
  predictorData,
  conservationData,
  landscapeData,
  metricMode = "mean",
  windowSize = 31
}: SequenceVisualizerProps) {
  const { settings } = useSettings();
  const storeHoveredIndex = useVariantAnalysisStore(s => s.hoveredResidueIndex);
  const hoveredResidueIndex = hoveredResidueIndexProp !== undefined ? hoveredResidueIndexProp : storeHoveredIndex;
  const seqColorScheme = seqColorSchemeProp || settings.seqColorScheme;

  const { sequence, isLoading: loading } = useProteinSequence(uniprotId);
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

    // Fallback: genomic/cDNA notation or free text carries no residue token. Stripping
    // non-digits from e.g. "20-23369727-C-T" yields a nonsense position (2023369727), so fall
    // back to the app-resolved residue index and mark the target unknown (pos 0) otherwise.
    return {
      wtCode3: null,
      mutCode3: null,
      wt: "",
      pos: residueIndex && residueIndex > 0 ? residueIndex : 0,
      mut: ""
    };
  };

  const mutation = useMemo(() => parseClinicalMutation(), [variant, residueIndex]);
  const mutationIndex = mutation.pos; // 1-based index of residue

  // If we don't have a loaded sequence, or if mutation position is out of bounds,
  // we dynamically align using a mock/synthesized region centered perfectly
  const { wildWindow, relativeStartIndex } = useMemo(() => {
    if (!sequence) return { wildWindow: [] as string[], relativeStartIndex: 1 };

    const seqLen = sequence.length;
    const half = Math.floor(windowSize / 2);

    // Unknown target (genomic notation without a resolved residue) centers on the sequence
    const target = mutationIndex > 0 ? Math.min(mutationIndex, seqLen) : Math.ceil(seqLen / 2);
    let startIdx = Math.max(0, target - 1 - half);
    let endIdx = Math.min(seqLen, startIdx + windowSize);

    // Adjust if running near end boundary
    if (endIdx - startIdx < windowSize) {
      startIdx = Math.max(0, endIdx - windowSize);
    }

    return {
      wildWindow: sequence.slice(startIdx, endIdx).split(""),
      relativeStartIndex: startIdx + 1
    };
  }, [sequence, mutationIndex, windowSize]);

  const parsedGenomic = useMemo(
    () => parseGenomicCoordinateString(predictorData?.gnomadVariantId || variant),
    [predictorData?.gnomadVariantId, variant]
  );

  const handleSelectGenomicVariant = useCallback((v: any) => {
    if (onSelectGenomicVariant) {
      onSelectGenomicVariant(v);
    }
    useVariantAnalysisStore.getState().setSelectedGenomicVariant(v);
  }, [onSelectGenomicVariant]);

  /*
   * These getters are dependencies of the density-track memo in SequenceRowGrid. As plain
   * closures they would be new every render and the memo would never hold.
   */
  const getRevelScore = useCallback(
    (pos: number) => {
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
    },
    [mutationIndex, conservationData, landscapeMap, metricMode]
  );

  const getAmScore = useCallback(
    (pos: number) => {
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
    },
    [mutationIndex, predictorData, landscapeMap, metricMode]
  );

  const getGerpScore = useCallback(
    (pos: number) => {
      if (pos === mutationIndex && conservationData?.gerp !== undefined && conservationData?.gerp !== null) {
        const parsed = parseFloat(String(conservationData.gerp));
        if (!isNaN(parsed)) return parsed;
      }
      const match = landscapeMap.get(pos);
      return match?.gerp !== undefined && match?.gerp !== null ? match.gerp : null;
    },
    [mutationIndex, conservationData, landscapeMap]
  );

  const getPhyloPScore = useCallback(
    (pos: number) => {
      if (pos === mutationIndex && conservationData?.phylop !== undefined && conservationData?.phylop !== null) {
        const parsed = parseFloat(String(conservationData.phylop));
        if (!isNaN(parsed)) return parsed;
      }
      const match = landscapeMap.get(pos);
      return match?.phylop !== undefined && match?.phylop !== null ? match.phylop : null;
    },
    [mutationIndex, conservationData, landscapeMap]
  );

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
              {mutationIndex > 0
                ? `Visualizing missense constraint and pathogenicity scores across residues surrounding mutation position #${mutationIndex}`
                : "Visualizing missense constraint and pathogenicity scores across the queried residue window"}
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

          {/* Tier 3: AlphaGenome Genomic Saturation Mutagenesis Heatmap & 1D Intolerance Track */}
          <GenomicSaturationHeatmap
            chrom={parsedGenomic?.chrom || conservationData?.spliceProximity?.chrom || null}
            genomicPos={parsedGenomic?.pos || conservationData?.spliceProximity?.genomicPos || null}
            genomicAlt={parsedGenomic?.alt || null}
            spliceProximity={conservationData?.spliceProximity}
            mutationIndex={mutationIndex}
            residueIndex={residueIndex}
            hoveredResidueIndex={hoveredResidueIndex}
            onResidueClick={onResidueClick}
            onSelectGenomicVariant={handleSelectGenomicVariant}
            metricMode={metricMode}
          />

          {/* Data Provenance & Methodology Notes Footer */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-t pt-2.5 border-cs-border-subtle/80 mt-1 px-1">
            <div className="flex items-center gap-1.5 text-[9.5px] font-sans text-cs-text-muted leading-tight">
              <span className="w-1.5 h-1.5 rounded-full bg-cs-accent-clay shrink-0" />
              <span>
                Target mutation displays direct variant scores; neighboring residues display aggregate metrics ({metricMode === "mean" ? "Mean Intolerance" : "Peak Intolerance"}).
              </span>
            </div>
            <div className="flex items-center gap-2.5 text-[9px] font-mono text-cs-text-muted">
              <span>* High GERP++ &amp; PhyloP = High Vulnerability</span>
              <span>•</span>
              <span>dbNSFP v4.4a</span>
            </div>
          </div>

        </div>
      )}
    </div>
  );
})

export default SequenceVisualizer;
