import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, BookOpen, Check, Copy, ExternalLink, X } from 'lucide-react';
import { GUIDE_ALIASES, RESEARCH_GUIDES, resolveResearchGuide } from '../../shared/researchGuides';
import { METRIC_EXPLANATIONS } from '../evidence/MetricExplanations';
import { EXPLANATION_TEACHING, type TeachingFigure } from '../../shared/explanationTeaching';
import { CALIBRATION_SOURCES, PP3_BP4_CALIBRATION, calibrationBands, type CalibratedToolKey } from '../../shared/thresholds/calibration';

const CALIBRATED_TOPICS: Record<string, CalibratedToolKey> = { am: 'alphaMissense', revel: 'revel', bayesdel: 'bayesdel', cadd: 'cadd', esm1b: 'esm1b', phylop: 'phylop', gerp: 'gerp' };

function Teaching({ figure }: { figure: TeachingFigure }) {
  return <section className="rgd-section rgd-teaching" aria-label={figure.heading}>
    <h3>{figure.heading}</h3>
    {figure.kind === 'flow' ? <ol className="rgd-flow">{figure.steps.map(step => <li key={step.label}><strong>{step.label}</strong><p>{step.text}</p></li>)}</ol>
      : figure.kind === 'comparison' ? <><dl className="rgd-compare">{figure.columns.map(column => <div key={column.label}><dt>{column.label}</dt><dd>{column.text}</dd></div>)}</dl><p className="rgd-figure-note">{figure.note}</p></>
      : <><dl className="rgd-example">{figure.values.map(value => <div key={value.label}><dt>{value.label}</dt><dd>{value.value}</dd></div>)}</dl><p className="rgd-figure-note">{figure.explanation}</p></>}
  </section>;
}

interface Props { isOpen: boolean; onClose: () => void; topic: string; context?: string }

/** Native modal dialog supplies top-layer stacking, background inertness, Escape and focus containment.
 * It is portalled outside clipped evidence panels. Help never modifies the analysed variant. */
export function ResearchGuideDrawer(props: Props) {
  return props.isOpen ? <OpenGuide key={props.topic} {...props} /> : null;
}

function OpenGuide({ topic, onClose, context }: Props) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const backdropPress = useRef(false);
  const [topicHistory, setTopicHistory] = useState([{ key: topic, scroll: 0 }]);
  const copyEpoch = useRef(0);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const current = topicHistory[topicHistory.length - 1];
  const key = current.key;
  const canonicalKey = GUIDE_ALIASES[key] ?? key;
  const guide = resolveResearchGuide(key);
  const legacy = METRIC_EXPLANATIONS[canonicalKey];
  const figure = EXPLANATION_TEACHING[canonicalKey];
  const calibrationKey = CALIBRATED_TOPICS[canonicalKey];
  const calibrated = calibrationKey ? PP3_BP4_CALIBRATION[calibrationKey] : undefined;
  const calibrationSource = calibrated ? CALIBRATION_SOURCES[calibrated.source] : undefined;
  const reference = guide?.source ?? (legacy ? { label: legacy.citation ?? legacy.paperTitle, url: legacy.paperUrl } : undefined);
  const title = guide?.title ?? 'Explanation unavailable';

  useLayoutEffect(() => {
    const element = dialog.current!;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element.showModal();
    heading.current?.focus();
    return () => {
      element.close();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    body.current?.scrollTo?.({ top: current.scroll });
    heading.current?.focus({ preventScroll: true });
    setCopyState('idle');
    return () => { copyEpoch.current += 1; };
  }, [current]);
  const openTopic = (next: string) => {
    const scroll = body.current?.scrollTop ?? 0;
    setTopicHistory(previous => [...previous.slice(0, -1), { ...previous[previous.length - 1], scroll }, { key: next, scroll: 0 }]);
  };
  const outside = (event: React.PointerEvent<HTMLDialogElement> | React.MouseEvent<HTMLDialogElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.target === event.currentTarget && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom);
  };
  const copy = async () => {
    if (!reference) return;
    const epoch = ++copyEpoch.current;
    try { await navigator.clipboard.writeText(`${reference.label}\n${reference.url}`); if (copyEpoch.current === epoch) setCopyState('copied'); }
    catch { if (copyEpoch.current === epoch) setCopyState('failed'); }
  };

  return createPortal(<dialog ref={dialog} className="rgd-drawer" aria-labelledby={`${id}-title`} aria-modal="true"
    onCancel={event => { event.preventDefault(); onClose(); }}
    onPointerDown={event => { backdropPress.current = outside(event); }}
    onClick={event => { if (backdropPress.current && outside(event)) onClose(); backdropPress.current = false; }}>
    <header className="rgd-header">
      <div className="rgd-eyebrow"><BookOpen size={16} aria-hidden="true" /> {guide?.group ?? 'Explanation'}</div>
      <button type="button" className="rgd-icon" aria-label="Close explanation" onClick={onClose}><X size={20} aria-hidden="true" /></button>
      <h2 id={`${id}-title`} ref={heading} tabIndex={-1}>{title}</h2>
      <p>{guide?.question ?? 'An explanation for this subject has not been supplied.'}</p>
      {topicHistory.length > 1 && <nav className="rgd-navigation" aria-label="Explanation navigation"><button type="button" className="rgd-link" onClick={() => setTopicHistory(previous => previous.slice(0, -1))}><ArrowLeft size={15} aria-hidden="true" /> Back to {resolveResearchGuide(topicHistory[topicHistory.length - 2].key)?.title ?? 'previous explanation'}</button></nav>}
    </header>
    <div className="rgd-body" ref={body}>
      {guide ? <>
        {context && topicHistory.length === 1 && <p className="rgd-context">{context}</p>}
        <section className="rgd-lead" aria-label="In plain language"><p>{guide.answer}</p></section>
        {figure && <Teaching figure={figure} />}
        <section className="rgd-section"><h3>How to read it here</h3><p>{guide.reading}</p></section>
        {calibrated && calibrationSource && <details className="rgd-section rgd-calibration"><summary>Published evidence bands</summary>
          <p>These bands describe the published calibration. The inspector shows whether this run actually counted the tool. The strongest threshold passed determines the calibrated strength.</p>
          <table><caption>{guide.title} · {calibrationSource.short}</caption><thead><tr><th scope="col">Direction</th><th scope="col">Strength</th><th scope="col">Score</th></tr></thead><tbody>
            {calibrationBands(calibrationKey).map(band => <tr key={band.code}><td>{band.direction === 'PP3' ? 'Pathogenic evidence' : 'Benign evidence'}</td><td>{band.strength.replace('VeryStrong', 'Very strong')}</td><td>{(band.direction === 'PP3') === (calibrated.orientation === 'higher') ? '≥' : '≤'} {band.threshold}</td></tr>)}
          </tbody></table>
          <a href={`https://doi.org/${calibrationSource.doi}`} target="_blank" rel="noreferrer">{calibrationSource.short} · calibration source (opens in a new tab)</a>
        </details>}
        <section className="rgd-section rgd-limit"><h3>What this cannot tell you</h3><p>{guide.limit}</p></section>
        <section className="rgd-section"><h3>What to check next</h3><p>{guide.next}</p></section>
        {guide.related.length > 0 && (() => {
          const validRelated = guide.related
            .map(key => ({ key, target: resolveResearchGuide(key) }))
            .filter((item): item is { key: string; target: NonNullable<ReturnType<typeof resolveResearchGuide>> } => Boolean(item.target));
          if (validRelated.length === 0) return null;
          return <section className="rgd-section"><h3>Related concepts</h3><div className="rgd-related">{validRelated.map(({ key, target }) =>
            <button type="button" key={key} className="rgd-link" onClick={() => openTopic(key)}>{target.title}<ArrowRight size={14} aria-hidden="true" /></button>)}</div></section>;
        })()}
        <section className="rgd-section rgd-source"><h3>Method & sources</h3>
          <p className="rgd-source-note">This guide explains the method. Your selected source record identifies the model, input and version that supplied this analysis.</p>
          {reference ? <><a href={reference.url} target="_blank" rel="noreferrer">{reference.label}<ExternalLink size={14} aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span></a>
            <button type="button" className="rgd-link" onClick={copy}>{copyState === 'copied' ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />} Copy reference</button>
            <span role="status">{copyState === 'copied' ? 'Reference copied.' : copyState === 'failed' ? 'Could not copy. You can select the reference link instead.' : ''}</span></>
            : <p>Workspace guidance. The source records and inspector provide the references for each returned reading.</p>}
        </section>
      </> : <section className="rgd-section"><p>No interpretation has been supplied for this topic. This does not change the underlying evidence. Inspect its source record for the returned value and provenance.</p></section>}
    </div>
    <footer className="rgd-footer"><span>Understand the result. Keep its limits in view.</span><button type="button" className="rgd-close" onClick={onClose}>Return to workspace</button></footer>
  </dialog>, document.body);
}
