import { ResearchGuideDrawer } from '../knowledge/ResearchGuideDrawer';

/** Compatibility entry point: existing model-info actions now open the shared guide drawer. */
export function ModelKnowledgeModal({ isOpen, onClose, modelKey }: {
  isOpen: boolean; onClose: () => void; modelKey: string | null; isDark?: boolean;
}) {
  return modelKey ? <ResearchGuideDrawer isOpen={isOpen} onClose={onClose} topic={modelKey} /> : null;
}
export default ModelKnowledgeModal;
