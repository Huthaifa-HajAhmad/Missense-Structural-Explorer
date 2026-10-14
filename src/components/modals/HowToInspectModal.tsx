import { ResearchGuideDrawer } from '../knowledge/ResearchGuideDrawer';

export function HowToInspectModal({ isOpen, onClose, selectedResidueIndex, gene }: {
  isOpen: boolean; onClose: () => void; isDark: boolean; selectedResidueIndex: number | null; gene: string;
}) {
  const selection = selectedResidueIndex == null ? '' : ` · selected residue ${selectedResidueIndex}`;
  return <ResearchGuideDrawer isOpen={isOpen} onClose={onClose} topic="structure_guide" context={`${gene || 'Structure exploration'}${selection}`} />;
}
export default HowToInspectModal;
