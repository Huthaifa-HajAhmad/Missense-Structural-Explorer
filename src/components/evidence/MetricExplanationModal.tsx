import { ResearchGuideDrawer } from '../knowledge/ResearchGuideDrawer';

/** Metric and model explanations share one accessible reading surface. */
export function MetricExplanationModal({ selectedMetric, setSelectedMetric }: {
  selectedMetric: string | null; setSelectedMetric: (metric: string | null) => void;
}) {
  return selectedMetric ? <ResearchGuideDrawer isOpen topic={selectedMetric} onClose={() => setSelectedMetric(null)} /> : null;
}
