import { useState, useRef, useEffect } from "react";
import { MolScriptBuilder as MS } from "molstar/lib/mol-script/language/builder";
import { Script } from "molstar/lib/mol-script/script";
import { StructureSelection } from "molstar/lib/mol-model/structure";
import { Color } from "molstar/lib/mol-util/color";
import { isValidPdbUrl } from "./molstarThemes";

export interface UseMolstarStructureOptions {
  pluginRef: React.MutableRefObject<any>;
  pluginCreated: boolean;
  uniprotId?: string | null;
  gene?: string | null;
  customPdbData?: string | null;
  customPdbUrl?: string | null;
  comparePdbData?: string | null;
  residueIndex?: number | null;
  compareResidueIndex?: number | null;
  showPolarContacts: boolean;
  show3DLabels: boolean;
  residueColorHex: number;
  neonHighContrast: boolean;
  autoZoomOnSelect: boolean;
  cameraDuration: number;
  showPocket: boolean;
  computedPocket: any;
  pocketComponentRefRef: React.MutableRefObject<any[]>;
  fetchWithAuth: (url: string, options?: any) => Promise<Response>;
  onPdbTextLoaded?: (pdbText: string) => void;
  variant?: string | null;
  esmFoldPdb?: string | null;
  esm3Eval?: any;
  setLoading: (loading: boolean) => void;
  setLoadError: (err: string | null) => void;
}

export function useMolstarStructure({
  pluginRef,
  pluginCreated,
  uniprotId,
  gene,
  customPdbData,
  customPdbUrl,
  comparePdbData,
  residueIndex,
  compareResidueIndex,
  showPolarContacts,
  show3DLabels,
  residueColorHex,
  neonHighContrast,
  autoZoomOnSelect,
  cameraDuration,
  showPocket,
  computedPocket,
  pocketComponentRefRef,
  fetchWithAuth,
  onPdbTextLoaded,
  variant,
  esmFoldPdb,
  esm3Eval,
  setLoading,
  setLoadError
}: UseMolstarStructureOptions) {
  const structureRef = useRef<any>(null);
  const structure2Ref = useRef<any>(null);
  const componentRefRef = useRef<any>(null);
  const componentRefRef2 = useRef<any>(null);

  const [plddtFilter, setPlddtFilter] = useState<"none" | "30" | "50" | "70">("none");
  const [templateSource, setTemplateSource] = useState<"experimental" | "alphafold" | null>(null);
  const [viewerStyle, setViewerStyle] = useState<"confidence" | "biomolecular" | "esm3-allosteric" | "displacement">("confidence");
  const [pdbText, setPdbText] = useState<string | null>(null);
  const [bFactorMetadata, setBFactorMetadata] = useState<{ source: "alphafold" | "experimental" | "unknown"; semantic: "plddt" | "temperature_factor"; inherited: boolean } | null>(null);

  useEffect(() => {
    if (comparePdbData) {
      setViewerStyle("displacement");
    }
  }, [comparePdbData]);

  // Determine B-factor metadata
  useEffect(() => {
    if (!pdbText) {
      setBFactorMetadata(null);
      return;
    }
    const upper = pdbText.toUpperCase();
    const isAlphaFoldHeader =
      upper.includes("ALPHAFOLD") ||
      upper.includes("AF-") ||
      upper.includes("COMPL_MODEL") ||
      upper.includes("CREATOR OF MODEL: ALPHAFOLD") ||
      upper.includes("MODEL FROM ALPHAFOLD");

    const lines = pdbText.split(/\r?\n/);
    let maxB = 0;
    let bCount = 0;
    for (let i = 0; i < lines.length && i < 2000; i++) {
      const line = lines[i];
      if (line.startsWith("ATOM") || line.startsWith("HETATM")) {
        if (line.length >= 66) {
          const bFactorStr = line.slice(60, 66).trim();
          const bFactor = parseFloat(bFactorStr);
          if (!isNaN(bFactor)) {
            if (bFactor > maxB) maxB = bFactor;
            bCount++;
          }
        }
      }
    }

    if (isAlphaFoldHeader || (maxB > 50 && maxB <= 100)) {
      setBFactorMetadata({ source: "alphafold", semantic: "plddt", inherited: true });
    } else if (maxB > 0 && maxB <= 50) {
      setBFactorMetadata({ source: "experimental", semantic: "temperature_factor", inherited: false });
    } else {
      setBFactorMetadata({ source: "unknown", semantic: "plddt", inherited: false });
    }
  }, [pdbText]);

  // Main structure loading effect
  useEffect(() => {
    if (!pluginCreated || !pluginRef.current) return;
    const localPlugin = pluginRef.current;
    let active = true;

    async function loadStructure() {
      setLoading(true);
      setLoadError(null);
      setPdbText(null);
      setTemplateSource(null);

      try {
        await localPlugin.clear();
        if (!active) return;
        structureRef.current = null;
        structure2Ref.current = null;
        componentRefRef.current = null;
        componentRefRef2.current = null;
        pocketComponentRefRef.current = [];

        let data: any = null;
        let fetchedPdbText: string | null = null;
        let currentSource: "alphafold" | "experimental" = "alphafold";

        if (esmFoldPdb) {
          data = await localPlugin.builders.data.rawData({
            data: esmFoldPdb,
            label: `${gene || 'ESMFold'} (${variant || 'Mutant'})`
          });
          fetchedPdbText = esmFoldPdb;
          currentSource = "alphafold";
          setTemplateSource("alphafold");
        } else if (customPdbUrl) {
          if (!isValidPdbUrl(customPdbUrl)) {
            throw new Error(`Invalid custom PDB URL (${customPdbUrl}). Only RCSB PDB, AlphaFold DB, or local API proxies are permitted.`);
          }
          const res = await fetchWithAuth(customPdbUrl);
          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.error || `Failed to fetch structure from ${customPdbUrl} (status ${res.status})`);
          }
          const resData = await res.text();
          if (!resData || (!resData.includes("ATOM") && !resData.includes("HETATM") && !resData.includes("_atom_site"))) {
            throw new Error(`Invalid structure payload returned for ${customPdbUrl}.`);
          }
          fetchedPdbText = resData;
          currentSource = "experimental";
          setTemplateSource("experimental");
          const labelName = customPdbUrl.split("/").pop()?.replace(".pdb", "").replace(".ent", "").toUpperCase() || "PDB";
          data = await localPlugin.builders.data.rawData({
            data: resData,
            label: `${gene || 'Homolog'} (${labelName})`
          });
        } else if (customPdbData) {
          data = await localPlugin.builders.data.rawData({
            data: customPdbData,
            label: `${gene || 'Custom'} (${uniprotId || 'PDB'})`
          });
          fetchedPdbText = customPdbData;
          currentSource = "alphafold";
          setTemplateSource("alphafold");
        } else if (uniprotId) {
          const match = variant ? variant.match(/\d+/) : null;
          const posQuery = match ? `?pos=${match[0]}` : "";
          const res = await fetchWithAuth(`/api/v1/pdb/${encodeURIComponent(uniprotId)}${posQuery}`);

          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            let msg = errData.error || `Structure fetch failed (status ${res.status})`;
            if (res.status === 404) {
              msg = `No PDB structure found for UniProt ID ${uniprotId}.`;
            }
            throw new Error(msg);
          }

          const sourceHeader = res.headers.get("X-Template-Source");
          if (sourceHeader === "experimental") {
            currentSource = "experimental";
            setTemplateSource("experimental");
          } else {
            currentSource = "alphafold";
            setTemplateSource("alphafold");
          }

          const resData = await res.text();
          if (!resData || resData.trim().length === 0) {
            throw new Error(`Invalid structure payload returned for ${uniprotId}.`);
          }

          fetchedPdbText = resData;
          data = await localPlugin.builders.data.rawData({
            data: resData,
            label: `${gene || 'Protein'} (${uniprotId})`
          });
        }

        if (!active) return;
        if (!data || (fetchedPdbText && !fetchedPdbText.includes("ATOM") && !fetchedPdbText.includes("HETATM") && !fetchedPdbText.includes("_atom_site"))) {
          throw new Error(`Structure payload for ${gene || uniprotId || 'protein'} did not contain valid 3D coordinates.`);
        }

        if (fetchedPdbText) {
          setPdbText(fetchedPdbText);
          if (onPdbTextLoaded) onPdbTextLoaded(fetchedPdbText);
        }

        const format = (fetchedPdbText && (fetchedPdbText.startsWith("data_") || fetchedPdbText.includes("_atom_site"))) ? "mmcif" : "pdb";
        const trajectory = await localPlugin.builders.structure.parseTrajectory(data, format);
        if (!active || !trajectory) return;
        const model = await localPlugin.builders.structure.createModel(trajectory);
        if (!active || !model) return;
        const structure = await localPlugin.builders.structure.createStructure(model);
        if (!active || !structure) return;
        structureRef.current = structure;

        let targetStructure = structure;
        if (currentSource === "alphafold" && plddtFilter !== "none") {
          const threshold = parseInt(plddtFilter, 10);
          const expression = MS.struct.generator.atomGroups({
            'atom-test': MS.core.rel.gre([
              MS.struct.atomProperty.macromolecular.B_iso_or_equiv(),
              threshold
            ])
          });
          const filteredComponent = await localPlugin.builders.structure.tryCreateComponentFromExpression(
            structure,
            expression,
            'filtered-structure',
            { label: `pLDDT >= ${threshold}` }
          );
          if (!active) return;
          if (filteredComponent) {
            targetStructure = filteredComponent;
          }
        }

        if (viewerStyle === "biomolecular") {
          const proteinComp = await localPlugin.builders.structure.tryCreateComponentStatic(targetStructure, 'protein');
          if (!active) return;
          if (proteinComp) {
            await localPlugin.builders.structure.representation.addRepresentation(proteinComp, {
              type: 'cartoon',
              color: 'uniform',
              colorParams: { value: Color(0x00bcd4) }
            });
            if (!active) return;
          }
          const nucleicComp = await localPlugin.builders.structure.tryCreateComponentStatic(targetStructure, 'nucleic');
          if (!active) return;
          if (nucleicComp) {
            await localPlugin.builders.structure.representation.addRepresentation(nucleicComp, {
              type: 'cartoon',
              color: 'uniform',
              colorParams: { value: Color(0x888888) }
            });
            if (!active) return;
          }
        } else if (viewerStyle === "esm3-allosteric") {
          await localPlugin.builders.structure.representation.applyPreset(targetStructure, 'auto', {
            theme: {
              globalName: 'esm3-allosteric',
              globalColorParams: {
                perturbationScores: esm3Eval?.perturbationScores || []
              }
            }
          });
          if (!active) return;
        } else if (viewerStyle === "displacement") {
          if (comparePdbData) {
            const proteinComp = await localPlugin.builders.structure.tryCreateComponentStatic(targetStructure, 'protein');
            if (!active) return;
            if (proteinComp) {
              await localPlugin.builders.structure.representation.addRepresentation(proteinComp, {
                type: 'cartoon',
                color: 'uniform',
                colorParams: { value: Color(0xd3d3d3) }
              });
              if (!active) return;
            }
          } else {
            await localPlugin.builders.structure.representation.applyPreset(targetStructure, 'auto', {
              theme: { globalName: 'backbone-displacement' }
            });
            if (!active) return;
          }
        } else {
          await localPlugin.builders.structure.representation.applyPreset(targetStructure, 'auto', {
            theme: { globalName: currentSource === 'experimental' ? 'bfactor-mobility' : 'plddt-confidence' }
          });
          if (!active) return;
        }

        // Explicitly create Ion (Zinc, Magnesium, Calcium, Iron, etc.) and Ligand representations
        try {
          // 1. Metal ions (Zinc, Magnesium, Calcium, Iron, Manganese, Copper, etc.)
          const metalIonExpr = MS.struct.generator.atomGroups({
            'atom-test': MS.core.logic.or([
              MS.core.rel.eq([MS.struct.atomProperty.macromolecular.auth_comp_id(), 'ZN']),
              MS.core.rel.eq([MS.struct.atomProperty.macromolecular.label_comp_id(), 'ZN']),
              MS.core.rel.eq([MS.struct.atomProperty.macromolecular.auth_comp_id(), 'MG']),
              MS.core.rel.eq([MS.struct.atomProperty.macromolecular.label_comp_id(), 'MG']),
              MS.core.rel.eq([MS.struct.atomProperty.macromolecular.auth_comp_id(), 'CA']),
              MS.core.rel.eq([MS.struct.atomProperty.macromolecular.label_comp_id(), 'CA']),
              MS.core.rel.eq([MS.struct.atomProperty.macromolecular.auth_comp_id(), 'FE']),
              MS.core.rel.eq([MS.struct.atomProperty.macromolecular.label_comp_id(), 'FE']),
              MS.core.rel.eq([MS.struct.atomProperty.macromolecular.auth_comp_id(), 'MN']),
              MS.core.rel.eq([MS.struct.atomProperty.macromolecular.label_comp_id(), 'MN']),
              MS.core.rel.eq([MS.struct.atomProperty.macromolecular.auth_comp_id(), 'CU']),
              MS.core.rel.eq([MS.struct.atomProperty.macromolecular.label_comp_id(), 'CU']),
              MS.core.rel.eq([MS.struct.atomProperty.macromolecular.auth_comp_id(), 'NA']),
              MS.core.rel.eq([MS.struct.atomProperty.macromolecular.label_comp_id(), 'NA']),
              MS.core.rel.eq([MS.struct.atomProperty.macromolecular.auth_comp_id(), 'K']),
              MS.core.rel.eq([MS.struct.atomProperty.macromolecular.label_comp_id(), 'K'])
            ])
          });
          const metalIonComp = await localPlugin.builders.structure.tryCreateComponentFromExpression(
            targetStructure,
            metalIonExpr,
            'metal-ions',
            { label: 'Metal Ions (Zinc / Ions)' }
          );
          if (!active) return;
          if (metalIonComp) {
            await localPlugin.builders.structure.representation.addRepresentation(metalIonComp, {
              type: 'spacefill',
              color: 'element-symbol'
            });
            if (!active) return;
          }

          // 2. Non-water Ligands and Prosthetic Groups
          const ligandExpr = MS.struct.generator.atomGroups({
            'atom-test': MS.core.logic.and([
              MS.struct.atomProperty.macromolecular.isHet(),
              MS.core.logic.not([
                MS.core.logic.or([
                  MS.core.rel.eq([MS.struct.atomProperty.macromolecular.auth_comp_id(), 'HOH']),
                  MS.core.rel.eq([MS.struct.atomProperty.macromolecular.label_comp_id(), 'HOH']),
                  MS.core.rel.eq([MS.struct.atomProperty.macromolecular.auth_comp_id(), 'WAT']),
                  MS.core.rel.eq([MS.struct.atomProperty.macromolecular.label_comp_id(), 'WAT']),
                  MS.core.rel.eq([MS.struct.atomProperty.macromolecular.auth_comp_id(), 'ZN']),
                  MS.core.rel.eq([MS.struct.atomProperty.macromolecular.label_comp_id(), 'ZN']),
                  MS.core.rel.eq([MS.struct.atomProperty.macromolecular.auth_comp_id(), 'MG']),
                  MS.core.rel.eq([MS.struct.atomProperty.macromolecular.label_comp_id(), 'MG']),
                  MS.core.rel.eq([MS.struct.atomProperty.macromolecular.auth_comp_id(), 'CA']),
                  MS.core.rel.eq([MS.struct.atomProperty.macromolecular.label_comp_id(), 'CA'])
                ])
              ])
            ])
          });
          const ligandComp = await localPlugin.builders.structure.tryCreateComponentFromExpression(
            targetStructure,
            ligandExpr,
            'ligands',
            { label: 'Ligands & Prosthetic Groups' }
          );
          if (!active) return;
          if (ligandComp) {
            await localPlugin.builders.structure.representation.addRepresentation(ligandComp, {
              type: 'ball-and-stick',
              color: 'element-symbol'
            });
            if (!active) return;
          }
        } catch (ionErr) {
          console.warn("[Mol* Ion/Ligand] Failed to add ion/ligand representation:", ionErr);
        }

        // Compare structure if present
        if (comparePdbData) {
          const data2 = await localPlugin.builders.data.rawData({
            data: comparePdbData,
            label: `${gene || 'Protein'} (Comparison Mutant)`
          });
          if (!active) return;
          const trajectory2 = await localPlugin.builders.structure.parseTrajectory(data2, "pdb");
          if (!active) return;
          const model2 = await localPlugin.builders.structure.createModel(trajectory2);
          if (!active) return;
          const structure2 = await localPlugin.builders.structure.createStructure(model2);
          if (!active) return;
          structure2Ref.current = structure2;

          let targetStructure2 = structure2;
          if (viewerStyle === "displacement") {
            await localPlugin.builders.structure.representation.applyPreset(targetStructure2, 'auto', {
              theme: { globalName: 'backbone-displacement' }
            });
            if (!active) return;
          } else {
            await localPlugin.builders.structure.representation.applyPreset(targetStructure2, 'auto', {
              theme: { globalName: templateSource === 'experimental' ? 'bfactor-mobility' : 'plddt-confidence' }
            });
            if (!active) return;
          }
        }

        if (active) {
          setLoading(false);
        }
      } catch (err: any) {
        if (!active) return;
        console.error("Structure rendering error:", err);
        setLoadError(err.message || "Failed to render protein structure.");
        setLoading(false);
      }
    }

    loadStructure();
    return () => {
      active = false;
    };
  }, [
    pluginCreated,
    uniprotId,
    gene,
    customPdbData,
    customPdbUrl,
    comparePdbData,
    plddtFilter,
    viewerStyle,
    esmFoldPdb
  ]);

  // Residue focus & highlight effect
  useEffect(() => {
    if (!pluginCreated || !pluginRef.current || !structureRef.current) return;
    const localPlugin = pluginRef.current;
    const structure = structureRef.current;
    const structure2 = structure2Ref.current;

    async function applyResidueHighlight() {
      try {
        if (componentRefRef.current) {
          try {
            await localPlugin.managers.structure.hierarchy.removeComponent([componentRefRef.current]);
          } catch (e) {}
          componentRefRef.current = null;
        }
        if (componentRefRef2.current) {
          try {
            await localPlugin.managers.structure.hierarchy.removeComponent([componentRefRef2.current]);
          } catch (e) {}
          componentRefRef2.current = null;
        }

        if (pocketComponentRefRef.current.length > 0) {
          try {
            await localPlugin.managers.structure.hierarchy.removeComponent(pocketComponentRefRef.current);
          } catch (e) {}
          pocketComponentRefRef.current = [];
        }

        // Verify structure ref is still present in Molstar state tree
        if (!structure.ref || !localPlugin.state.data.tree.transforms.has(structure.ref)) {
          return;
        }

        if (!residueIndex) {
          localPlugin.managers.structure.selection.clear();
          if (autoZoomOnSelect) {
            try {
              localPlugin.managers.camera.reset();
            } catch (camErr) {}
          }
          return;
        }

        let lociList: any[] = [];
        const expression = MS.struct.generator.atomGroups({
          'residue-test': MS.core.rel.eq([
            MS.struct.atomProperty.macromolecular.auth_seq_id(),
            residueIndex
          ])
        });

        const residueComponent = await localPlugin.builders.structure.tryCreateComponentFromExpression(
          structure,
          expression,
          'mutated-residue',
          { label: `Mutated Residue ${residueIndex}` }
        );

        if (residueComponent) {
          componentRefRef.current = residueComponent.ref;

          await localPlugin.builders.structure.representation.addRepresentation(residueComponent, {
            type: 'ball-and-stick',
            color: 'uniform',
            colorParams: { value: residueColorHex },
            ...(neonHighContrast ? { typeParams: { sizeFactor: 1.8 } } : {})
          });

          if (neonHighContrast) {
            // Translucent spacefill halo makes the mutated residue pop on
            // low-contrast displays without hiding neighbors.
            try {
              await localPlugin.builders.structure.representation.addRepresentation(residueComponent, {
                type: 'spacefill',
                typeParams: { alpha: 0.35 },
                color: 'uniform',
                colorParams: { value: residueColorHex }
              });
            } catch (haloErr) {}
          }

          if (showPolarContacts) {
            try {
              await localPlugin.builders.structure.representation.addRepresentation(residueComponent, {
                type: 'interactions',
                color: 'uniform',
                colorParams: { value: 0x38BDF8 }
              });
            } catch (intrErr) {}
          }

          if (show3DLabels) {
            try {
              await localPlugin.builders.structure.representation.addRepresentation(residueComponent, {
                type: 'label',
                typeParams: {
                  level: 'residue',
                  background: true,
                  backgroundOpacity: neonHighContrast ? 1.0 : 0.85,
                  backgroundColor: 0x090d16,
                  borderWidth: 0.2,
                  residueScale: 1.3,
                  offsetX: 2.0,
                  offsetY: 2.0,
                  offsetZ: 1.5,
                  tether: true,
                  tetherLength: 1.5,
                  tetherBaseWidth: 0.3,
                  attachment: 'bottom-left'
                }
              });
            } catch (labelErr) {}
          }

          try {
            const selection = Script.getStructureSelection(expression, structure.obj.data);
            const loci = StructureSelection.toLociWithSourceUnits(selection);
            lociList.push(loci);
          } catch (e) {}
        }

        if (structure2 && structure2.ref && localPlugin.state.data.tree.transforms.has(structure2.ref) && compareResidueIndex !== null && compareResidueIndex !== undefined) {
          const expression2 = MS.struct.generator.atomGroups({
            'residue-test': MS.core.rel.eq([
              MS.struct.atomProperty.macromolecular.auth_seq_id(),
              compareResidueIndex
            ])
          });

          const residueComponent2 = await localPlugin.builders.structure.tryCreateComponentFromExpression(
            structure2,
            expression2,
            'compare-mutated-residue',
            { label: `Compare Residue ${compareResidueIndex}` }
          );

          if (residueComponent2) {
            componentRefRef2.current = residueComponent2.ref;
            await localPlugin.builders.structure.representation.addRepresentation(residueComponent2, {
              type: 'ball-and-stick',
              color: 'uniform',
              colorParams: { value: 0xEC4899 }
            });
            try {
              const selection2 = Script.getStructureSelection(expression2, structure2.obj.data);
              const loci2 = StructureSelection.toLociWithSourceUnits(selection2);
              lociList.push(loci2);
            } catch (e) {}
          }
        }

        // Pocket highlights
        if (showPocket && computedPocket && computedPocket.pocketResidues.length > 0) {
          const refs: any[] = [];
          for (const res of computedPocket.pocketResidues) {
            try {
              const pExpression = MS.struct.generator.atomGroups({
                'residue-test': MS.core.rel.eq([
                  MS.struct.atomProperty.macromolecular.auth_seq_id(),
                  res.index
                ])
              });

              const pocketResComponent = await localPlugin.builders.structure.tryCreateComponentFromExpression(
                structure,
                pExpression,
                `pocket-res-${res.index}`,
                { label: `Pocket ${res.name}` }
              );

              if (pocketResComponent) {
                refs.push(pocketResComponent.ref);
                await localPlugin.builders.structure.representation.addRepresentation(pocketResComponent, {
                  type: 'ball-and-stick',
                  color: 'uniform',
                  colorParams: { value: 0xEAB308 }
                });
              }
            } catch (pErr) {}
          }
          pocketComponentRefRef.current = refs;
        }

        if (lociList.length > 0) {
          localPlugin.managers.structure.selection.clear();
          for (const loci of lociList) {
            localPlugin.managers.structure.selection.fromLoci('add', loci);
          }
          if (autoZoomOnSelect) {
            localPlugin.managers.camera.focusLoci(lociList, { durationMs: cameraDuration });
          }
        }
      } catch (err: any) {
        if (err?.message?.includes("is not present in the tree")) {
          console.warn("[Molstar Highlight Warning] Highlight cancelled due to structure state change:", err.message);
        } else {
          console.error("Residue focus error:", err);
        }
      }
    }

    applyResidueHighlight();
  }, [
    pluginCreated,
    residueIndex,
    compareResidueIndex,
    showPolarContacts,
    show3DLabels,
    residueColorHex,
    neonHighContrast,
    autoZoomOnSelect,
    cameraDuration,
    showPocket,
    computedPocket
  ]);

  return {
    structureRef,
    structure2Ref,
    componentRefRef,
    componentRefRef2,
    plddtFilter, setPlddtFilter,
    templateSource, setTemplateSource,
    viewerStyle, setViewerStyle,
    pdbText, setPdbText,
    bFactorMetadata
  };
}
