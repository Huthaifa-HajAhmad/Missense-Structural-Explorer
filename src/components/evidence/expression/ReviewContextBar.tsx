import { forwardRef, type ReactNode } from 'react';

/**
 * The folded "Review context" row: disease and systems at a glance, the frame when opened. `action`
 * sits beside the disclosure and wraps below it when space is limited.
 */
export const ReviewContextBar = forwardRef<HTMLDetailsElement, { disease: string; systemCount: number; action?: ReactNode; children: ReactNode }>(
  function ReviewContextBar({ disease, systemCount, action, children }, ref) {
    return <div className="xp-review" data-action={action ? '' : undefined}>
      <details ref={ref} className="xp-review-settings">
        <summary><strong>Review context</strong><span className="xp-review-disease">{disease}</span>
          <span>{systemCount ? `${systemCount} ${systemCount === 1 ? 'system' : 'systems'}` : 'All systems'}</span>
          <span className="xp-review-note">Your choices, not patient findings</span></summary>
        {children}
      </details>
      {action && <div className="xp-review__action">{action}</div>}
    </div>;
  });
