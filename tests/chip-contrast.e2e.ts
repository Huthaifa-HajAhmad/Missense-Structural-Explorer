import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { skipTour } from './support.js';

/**
 * Every status chip tone keeps AA text contrast (4.5:1) on the surfaces it lands on: a plain panel and the accent-wash strip.
 * Measured on rendered colours (canvas-resolved, so color-mix and alpha are composited), in both themes.
 */

const measure = () => {
  const canvas = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
  const rgb = (cssColor: string, under: number[] = [255, 255, 255]): number[] => {
    canvas.clearRect(0, 0, 1, 1);
    canvas.fillStyle = `rgb(${under.join(',')})`; canvas.fillRect(0, 0, 1, 1);
    canvas.fillStyle = cssColor; canvas.fillRect(0, 0, 1, 1);
    return [...canvas.getImageData(0, 0, 1, 1).data].slice(0, 3);
  };
  const luminance = (c: number[]) => { const [r, g, b] = c.map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * r + .7152 * g + .0722 * b; };
  const contrast = (a: number[], b: number[]) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + .05) / (lo + .05); };
  const result: Record<string, number> = {};
  const lane = document.createElement('div');
  document.body.append(lane);
  for (const [surfaceName, surface] of [['panel', 'var(--cs-surface)'], ['wash', 'var(--cs-workbench-header-surface)']] as const) {
    const host = document.createElement('div');
    host.style.background = surface;
    lane.append(host);
    const base = rgb(getComputedStyle(host).backgroundColor);
    for (const tone of ['good', 'warn', 'warning', 'danger', 'high', 'medium', 'neutral', 'accent', 'muted']) {
      const chip = document.createElement('span');
      chip.className = 'ev-tier'; chip.dataset.tone = tone; chip.textContent = 'x';
      host.append(chip);
      const style = getComputedStyle(chip);
      const fill = rgb(style.backgroundColor, base);
      result[`${surfaceName}/${tone}`] = Math.round(contrast(rgb(style.color, fill), fill) * 100) / 100;
    }
  }
  lane.remove();
  return result;
};

test('status chips keep AA contrast on a panel and on the accent wash, in both themes', { tags: ['shell'] }, async ({ app, browser, screen }) => {
  await skipTour(browser);
  await browser.setViewport({ width: 1440, height: 900 });
  await app.open('/');
  const report = async () => browser.evaluate(measure);
  const light = await report();
  await screen.getByRole('button', 'Switch to dark mode').tap();
  const dark = await report();
  const failing = (theme: string, values: Record<string, number>) => Object.entries(values).filter(([, ratio]) => ratio < 4.5).map(([key, ratio]) => `${theme} ${key} ${ratio}`);
  expect([...failing('light', light), ...failing('dark', dark)], 'chip tones under 4.5:1').toEqual([]);
});

test('a dashed chip keeps its dashed outline, drawn in its own ink (report, unconfirmed and unapplied states)', { tags: ['shell'] }, async ({ app, browser }) => {
  await skipTour(browser);
  await app.open('/');
  const outlines = await browser.evaluate(() => {
    const variants: [string, string, string][] = [
      ['report-dashed', 'ev-tier rpt-chip--dashed', ''],
      ['unconfirmed', 'ev-tier', 'data-unconfirmed'],
      ['unapplied', 'ev-tier spl-verdict--unapplied', ''],
    ];
    return Object.fromEntries(variants.map(([name, classes, attribute]) => {
      const chip = document.createElement('span');
      chip.className = classes; chip.dataset.tone = 'accent'; chip.textContent = 'x';
      if (attribute) chip.setAttribute(attribute, 'true');
      document.body.append(chip);
      const style = getComputedStyle(chip);
      const result = `${style.borderTopStyle} ${style.borderTopColor}`;
      chip.remove();
      return [name, result];
    }));
  });
  for (const [name, outline] of Object.entries(outlines)) {
    expect(outline.startsWith('dashed ') && !outline.endsWith('rgba(0, 0, 0, 0)'), `${name}: ${outline}`).toBe(true);
  }
});
