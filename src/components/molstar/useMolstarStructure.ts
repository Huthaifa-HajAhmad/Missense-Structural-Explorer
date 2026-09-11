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
  active3dModelTab?: "alphafold2" | "esm3";
  viewMode?: "wildtype" | "mutant" | "superimposed";
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
  active3dModelTab = "alphafold2",
  viewMode,
  setLoading,
  setLoadError
}: UseMolstarStructureOptions) {
  const structureRef = useRef<any>(null);
  const structure2Ref = useRef<any>(null);
  const componentRefRef = useRef<any>(null);
  const componentRefRef2 = useRef<any>(null);
  const isStructureLoadingRef = useRef(false);
  const [structureReadyVersion, setStructureReadyVersion] = useState(0);

  const [plddtFilter, setPlddtFilter] = useState<"none" | "30" | "50" | "70">("none");
  const [templateSource, setTemplateSource] = useState<"experimental" | "alphafold" | null>(null);
  const [activePdbId, setActivePdbId] = useState<string | null>(null);
  const [viewerStyle, setViewerStyle] = useState<"confidence" | "biomolecular" | "esm3-allosteric" | "displacement">("confidence");
  const [pdbText, setPdbText] = useState<string | null>(null);
  const [bFactorMetadata, setBFactorMetadata] = useState<{ source: "alphafold" | "experimental" | "unknown"; semantic: "plddt" | "temperature_factor"; inherited: boolean } | null>(null);

  useEffect(() => {
    if (viewMode === "superimposed" && comparePdbData) {
      setViewerStyle("displacement");
    } else if (viewMode === "wildtype" || viewMode === "mutant" || !comparePdbData) {
      setViewerStyle((prev) => (prev === "displacement" ? "confidence" : prev));
    }
  }, [viewMode, comparePdbData]);

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
      isStructureLoadingRef.current = true;
      setLoading(true);
      setLoadError(null);
      setPdbText(null);
      setTemplateSource(null);

      try {
        await localPlugin.clear();
        if (!active) {
          isStructureLoadingRef.current = false;
          return;
        }
        structureRef.current = null;
        structure2Ref.current = null;
        componentRefRef.current = null;
        componentRefRef2.current = null;
        pocketComponentRefRef.current = [];

        let data: any = null;
        let fetchedPdbText: string | null = null;
        let currentSource: "alphafold" | "experimental" = "alphafold";

        if (customPdbData) {
          data = await localPlugin.builders.data.rawData({
            data: customPdbData,
            label: `${gene || 'Protein'} (${viewMode === 'mutant' ? 'Mutant' : 'Wild-Type'})`
          });
          fetchedPdbText = customPdbData;
          currentSource = (customPdbUrl || activePdbId) ? "experimental" : "alphafold";
          setTemplateSource(currentSource);
          setActivePdbId(activePdbId || null);
        } else if (customPdbUrl) {
          if (!isValidPdbUrl(customPdbUrl)) {
            throw new Error(`Invalid custom PDB URL (${customPdbUrl}). Only RCSB PDB, AlphaFold DB, or local API proxies are permitted.`);
          }
          const res = await fetchWithAuth(customPdbUrl);
          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            const errMsg = errData?.error?.message || errData?.message || (typeof errData?.error === "string" ? errData.error : null) || `Failed to fetch structure from ${customPdbUrl} (status ${res.status})`;
            throw new Error(errMsg);
          }
          const resData = await res.text();
          if (!resData || (!resData.includes("ATOM") && !resData.includes("HETATM") && !resData.includes("_atom_site"))) {
            throw new Error(`Invalid structure payload returned for ${customPdbUrl}.`);
          }
          fetchedPdbText = resData;
          currentSource = "experimental";
          setTemplateSource("experimental");
          const labelName = customPdbUrl.split("/").pop()?.replace(".pdb", "").replace(".ent", "").toUpperCase() || "PDB";
          setActivePdbId(labelName);
          data = await localPlugin.builders.data.rawData({
            data: resData,
            label: `${gene || 'Homolog'} (${labelName})`
          });
        } else if (esmFoldPdb && active3dModelTab === "esm3") {
          data = await localPlugin.builders.data.rawData({
            data: esmFoldPdb,
            label: `${gene || 'ESMFold'} (${variant || 'Structure'})`
          });
          fetchedPdbText = esmFoldPdb;
          currentSource = "alphafold";
          setTemplateSource("alphafold");
          setActivePdbId(null);
        } else if (uniprotId) {
          let res: Response;
          if (active3dModelTab === "alphafold2") {
            // Guarantee fetching the authentic full-length AlphaFold model directly
            const afRes = await fetchWithAuth(`/api/v1/alphafold-pdb/${encodeURIComponent(uniprotId)}`);
            if (afRes.ok) {
              res = afRes;
            } else {
              const match = variant ? variant.match(/\d+/) : null;
              const posQuery = match ? `?pos=${match[0]}` : "";
              res = await fetchWithAuth(`/api/v1/pdb/${encodeURIComponent(uniprotId)}${posQuery}`);
            }
          } else {
            const match = variant ? variant.match(/\d+/) : null;
            const posQuery = match ? `?pos=${match[0]}` : "";
            res = await fetchWithAuth(`/api/v1/pdb/${encodeURIComponent(uniprotId)}${posQuery}`);
          }

          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            let msg = errData?.error?.message || errData?.message || (typeof errData?.error === "string" ? errData.error : null) || `Structure fetch failed (status ${res.status})`;
            if (res.status === 404) {
              msg = `No PDB structure found for UniProt ID ${uniprotId}.`;
            }
            throw new Error(msg);
          }

          const sourceHeader = res.headers.get("X-Template-Source");
          const pdbHeader = res.headers.get("X-Template-PdbId");
          if (sourceHeader === "experimental" || sourceHeader === "homolog") {
            currentSource = "experimental";
            setTemplateSource("experimental");
            setActivePdbId(pdbHeader || null);
          } else {
            currentSource = "alphafold";
            setTemplateSource("alphafold");
            setActivePdbId(null);
          }

          const resData = await res.text();
          if (!resData || resData.trim().length === 0) {
            throw new Error(`Invalid structure payload returned for ${uniprotId}.`);
          }

          fetchedPdbText = resData;
          if (onPdbTextLoaded) onPdbTextLoaded(resData);
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
        const passingPlddtResidues = new Set<number>();
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

          if (fetchedPdbText && format === "pdb") {
            const lines = fetchedPdbText.split("\n");
            for (const line of lines) {
              if (line.startsWith("ATOM") || line.startsWith("HETATM")) {
                if (line.length >= 66) {
                  const bFactor = parseFloat(line.slice(60, 66).trim());
                  if (!isNaN(bFactor) && bFactor >= threshold) {
                    const resSeq = parseInt(line.slice(22, 26).trim(), 10);
                    if (!isNaN(resSeq)) {
                      passingPlddtResidues.add(resSeq);
                    }
                  }
                }
              }
            }
          }
        }

        if (viewerStyle === "biomolecular") {
          let reprTarget = targetStructure;
          if (targetStructure === structure) {
            const proteinComp = await localPlugin.builders.structure.tryCreateComponentStatic(targetStructure, 'protein');
            if (proteinComp) reprTarget = proteinComp;
          }
          await localPlugin.builders.structure.representation.addRepresentation(reprTarget, {
            type: 'cartoon',
            color: 'uniform',
            colorParams: { value: Color(0x00bcd4) }
          });
          if (!active) return;
          if (targetStructure === structure) {
            const nucleicComp = await localPlugin.builders.structure.tryCreateComponentStatic(targetStructure, 'nucleic');
            if (nucleicComp) {
              await localPlugin.builders.structure.representation.addRepresentation(nucleicComp, {
                type: 'cartoon',
                color: 'uniform',
                colorParams: { value: Color(0x888888) }
              });
              if (!active) return;
            }
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
            await localPlugin.builders.structure.representation.addRepresentation(targetStructure, {
              type: 'cartoon',
              color: 'uniform',
              colorParams: { value: Color(0x94a3b8) },
              typeParams: { alpha: 0.35 }
            });
            if (!active) return;
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
          if (currentSource === "alphafold" && plddtFilter !== "none" && passingPlddtResidues.size > 0) {
            const threshold = parseInt(plddtFilter, 10);
            const passingArray = Array.from(passingPlddtResidues);
            const mutantFilterExpr = MS.struct.generator.atomGroups({
              'residue-test': MS.core.set.has([
                MS.core.type.set(passingArray),
                MS.struct.atomProperty.macromolecular.auth_seq_id()
              ])
            });
            const filteredComponent2 = await localPlugin.builders.structure.tryCreateComponentFromExpression(
              structure2,
              mutantFilterExpr,
              'filtered-mutant-structure',
              { label: `Mutant pLDDT >= ${threshold}` }
            );
            if (!active) return;
            if (filteredComponent2) {
              targetStructure2 = filteredComponent2;
            }
          }

          if (viewerStyle === "displacement") {
            await localPlugin.builders.structure.representation.applyPreset(targetStructure2, 'auto', {
              theme: { globalName: 'backbone-displacement' }
            });
            if (!active) return;
          } else {
            await localPlugin.builders.structure.representation.applyPreset(targetStructure2, 'auto', {
              theme: { globalName: currentSource === 'experimental' ? 'bfactor-mobility' : 'plddt-confidence' }
            });
            if (!active) return;
          }
        }

        if (localPlugin.canvas3d?.camera) {
          try {
            localPlugin.canvas3d.camera.forceFull = true;
            localPlugin.canvas3d.camera.setState({ clipFar: false });
          } catch (e) {}
        }

        if (active) {
          isStructureLoadingRef.current = false;
          setLoading(false);
          setStructureReadyVersion((v) => v + 1);
        }
      } catch (err: any) {
        isStructureLoadingRef.current = false;
        if (!active) return;
        console.error("Structure rendering error:", err);
        setLoadError(err.message || "Failed to render protein structure.");
        setLoading(false);
      }
    }

    loadStructure();
    return () => {
      active = false;
      isStructureLoadingRef.current = false;
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
    esmFoldPdb,
    active3dModelTab,
    viewMode
  ]);

  // Residue focus & highlight effect
  useEffect(() => {
    if (!pluginCreated || !pluginRef.current || !structureRef.current) return;
    if (isStructureLoadingRef.current) return;
    const localPlugin = pluginRef.current;
    const structure = structureRef.current;
    const structure2 = structure2Ref.current;
    let active = true;

    async function applyResidueHighlight() {
      try {
        if (componentRefRef.current) {
          try {
            await localPlugin.managers.structure.hierarchy.remove([componentRefRef.current]);
          } catch (e) {}
          componentRefRef.current = null;
        }
        if (componentRefRef2.current) {
          try {
            await localPlugin.managers.structure.hierarchy.remove([componentRefRef2.current]);
          } catch (e) {}
          componentRefRef2.current = null;
        }

        if (pocketComponentRefRef.current.length > 0) {
          try {
            await localPlugin.managers.structure.hierarchy.remove(pocketComponentRefRef.current);
          } catch (e) {}
          pocketComponentRefRef.current = [];
        }

        // Verify structure ref is still present in Molstar state tree
        if (!active || !structure.ref || !localPlugin?.state?.data?.tree?.transforms?.has(structure.ref)) {
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

        if (!active || !structure.ref || !localPlugin?.state?.data?.tree?.transforms?.has(structure.ref)) return;

        const residueComponent = await localPlugin.builders.structure.tryCreateComponentFromExpression(
          structure,
          expression,
          'mutated-residue',
          { label: `Mutated Residue ${residueIndex}` }
        );

        if (!active) return;

        if (residueComponent) {
          componentRefRef.current = residueComponent.ref;

          await localPlugin.builders.structure.representation.addRepresentation(residueComponent, {
            type: 'ball-and-stick',
            color: 'uniform',
            colorParams: { value: comparePdbData ? 0x00bcd4 : residueColorHex },
            ...(neonHighContrast ? { typeParams: { sizeFactor: 1.8 } } : {})
          });

          if (!active) return;

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

          if (!active) return;

          if (showPolarContacts) {
            try {
              await localPlugin.builders.structure.representation.addRepresentation(residueComponent, {
                type: 'interactions',
                color: 'uniform',
                colorParams: { value: 0x38BDF8 }
              });
            } catch (intrErr) {}
          }

          if (!active) return;

          if (show3DLabels) {
            try {
              await localPlugin.builders.structure.representation.addRepresentation(residueComponent, {
                type: 'label',
                typeParams: {
                  level: 'residue',
                  background: true,
                  backgroundOpacity: neonHighContrast ? 1.0 : 0.9,
                  backgroundColor: 0x090d16,
                  borderWidth: 0.3,
                  residueScale: 1.5,
                  offsetX: 2.0,
                  offsetY: 2.0,
                  offsetZ: 1.5,
                  tether: true,
                  tetherLength: 1.8,
                  tetherBaseWidth: 0.35,
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

        if (
          active &&
          structure2 &&
          structure2.ref &&
          localPlugin?.state?.data?.tree?.transforms?.has(structure2.ref) &&
          compareResidueIndex !== null &&
          compareResidueIndex !== undefined
        ) {
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

          if (!active) return;

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
        if (active && showPocket && computedPocket && computedPocket.pocketResidues.length > 0) {
          const refs: any[] = [];
          for (const res of computedPocket.pocketResidues) {
            if (!active || !structure.ref || !localPlugin?.state?.data?.tree?.transforms?.has(structure.ref)) break;
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
          if (active) {
            pocketComponentRefRef.current = refs;
          }
        }

        if (!active) return;

        if (localPlugin.canvas3d?.camera) {
          try {
            localPlugin.canvas3d.camera.forceFull = true;
            localPlugin.canvas3d.camera.setState({ clipFar: false });
          } catch (e) {}
        }

        if (lociList.length > 0 && autoZoomOnSelect) {
          localPlugin.managers.structure.selection.clear();
          for (const loci of lociList) {
            localPlugin.managers.structure.selection.fromLoci('add', loci);
          }
          localPlugin.managers.camera.focusLoci(lociList, { durationMs: cameraDuration });
        }
      } catch (err: any) {
        const msg = err?.message || "";
        if (
          msg.includes("must be present in the tree") ||
          msg.includes("is not present in the tree") ||
          msg.includes("Cannot read properties of undefined")
        ) {
          console.warn("[Molstar Highlight Warning] Highlight cancelled due to structure state change:", msg);
        } else {
          console.error("Residue focus error:", err);
        }
      }
    }

    applyResidueHighlight();
    return () => {
      active = false;
    };
  }, [
    pluginCreated,
    structureReadyVersion,
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
    computedPocket
  ]);

  return {
    structureRef,
    structure2Ref,
    componentRefRef,
    componentRefRef2,
    plddtFilter, setPlddtFilter,
    templateSource, setTemplateSource,
    activePdbId, setActivePdbId,
    viewerStyle, setViewerStyle,
    pdbText, setPdbText,
    bFactorMetadata
  };
}
