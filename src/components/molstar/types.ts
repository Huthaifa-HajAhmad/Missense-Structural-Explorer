export interface MolstarToolbarProps {
  comparePdbData: string | null;
  customPdbData: string | null;
  mutantStatus?: string | null;
  active3dModelTab?: "alphafold2" | "esm3";
  customPdbUrl: string | null;
  pdbSource: string | null;
  pdbId: string | null;
  uniprotId: string | null;
  gene: string | null;
  residueIndex: number | null;
  focusOnPocketResidue: (resIndex: number) => void;
  viewerStyle: "confidence" | "biomolecular" | "esm3-allosteric" | "displacement";
  setViewerStyle: (style: "confidence" | "biomolecular" | "esm3-allosteric" | "displacement") => void;
  templateSource: "experimental" | "alphafold" | null;
  plddtFilter: "none" | "30" | "50" | "70";
  setPlddtFilter: (val: "none" | "30" | "50" | "70") => void;
  isPocketPanelOpen: boolean;
  setIsPocketPanelOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  setShowPocket: (show: boolean | ((prev: boolean) => boolean)) => void;
  captureMenuOpen: boolean;
  setCaptureMenuOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  captureMenuRef: React.RefObject<HTMLDivElement | null>;
  handleDownloadCapture: () => void;
  handleCopyCapture: () => void;
  isFullscreen: boolean;
  handleToggleFullscreen: () => void;
}

export interface MolstarInfoOverlayProps {
  isPocketPanelOpen: boolean;
  setIsPocketPanelOpen: (val: boolean) => void;
  pocketPosition: { x: number; y: number };
  handlePocketMouseDown: (e: React.MouseEvent) => void;
  residueIndex: number | null;
  isPocketLoading: boolean;
  pocketError: string | null;
  computedPocket: any;
  showPocket: boolean;
  setShowPocket: (val: boolean | ((prev: boolean) => boolean)) => void;
  disruptionWarning: { title: string; description: string } | null;
  isAlertClosed: boolean;
  setIsAlertClosed: (val: boolean) => void;
  alertPosition: { x: number; y: number };
  isDragging: boolean;
  handleMouseDown: (e: React.MouseEvent) => void;
}
