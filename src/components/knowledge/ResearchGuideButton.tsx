import { useState } from 'react';
import { BookOpen } from 'lucide-react';
import { ResearchGuideDrawer } from './ResearchGuideDrawer';

export function ResearchGuideButton({ topic, label = 'Reading guide', iconOnly = false, className = 'rgd-trigger', context }: {
  topic: string; label?: string; iconOnly?: boolean; className?: string; context?: string;
}) {
  const [open, setOpen] = useState(false);
  return <><button type="button" className={className} data-explanation-topic={topic} aria-label={label} title={iconOnly ? label : undefined} aria-haspopup="dialog" onClick={() => setOpen(true)}>
    <BookOpen size={16} aria-hidden="true" />{!iconOnly && <span>{label}</span>}
  </button><ResearchGuideDrawer isOpen={open} topic={topic} context={context} onClose={() => setOpen(false)} /></>;
}
