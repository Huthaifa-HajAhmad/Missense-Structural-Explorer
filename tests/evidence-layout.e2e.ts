import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { populationLabelWidth } from '../src/shared/evidenceComparison';
import { skipTour } from './support.js';

/**
 * Evidence layout contracts (design review of Population data, 1753x981): one hairline where two surfaces meet in the
 * inspector, the homozygote line inside the finding card in every view, one header rhythm across the tabs, the accent
 * strip token on the strips, and a chip that stays a quiet pill. Live: it drives a real PAH p.Arg408Trp analysis
 * (select with `--tag live`).
 */

const TABS = ['Population data', 'In-silico predictors', 'Residue shifts & pockets', 'Functional domains', 'Interfaces & PPI'];

test('evidence tabs keep one rule per seam, one header rhythm, and the homozygotes in the finding', { tags: ['live'], timeout: 240_000 }, async ({ app, browser, screen }) => {
  await skipTour(browser);
  await browser.setViewport({ width: 1753, height: 981 });
  await app.open('/');
  await screen.getByRole('button', 'Run benchmark PAH p.Arg408Trp').tap();
  await expect(screen.getByRole('button', /^Evidence .*Complete$/)).toBeVisible({ timeout: 180_000 });

  // A tab is ready when its own screen and the inspector rail are mounted and the fonts have loaded, not after a fixed delay.
  const ready = () => browser.evaluate(async () => {
    for (let i = 0; i < 100; i++) {
      if (document.querySelector('[data-evidence-screen] .screen-title') && document.querySelector('.inspector-body')) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    await document.fonts.ready;
    return true;
  });

  const measured: Record<string, { doubles: string[]; titleTop: number; gap: number | null; screens: number; strips: string[] }> = {};
  for (const tab of TABS) {
    await screen.getByRole('button', tab, { exact: true }).tap();
    await ready();
    measured[tab] = await browser.evaluate(() => {
      const rules: { y: number; x0: number; x1: number }[] = [];
      for (const el of document.querySelectorAll('.inspector-body *')) {
        const style = getComputedStyle(el); const box = el.getBoundingClientRect();
        if (box.width < 40 || parseFloat(style.borderLeftWidth) >= 1) continue;
        const shown = (color: string) => !/rgba\(0, 0, 0, 0\)|transparent/.test(color);
        if (parseFloat(style.borderTopWidth) >= 1 && style.borderTopStyle !== 'none' && shown(style.borderTopColor)) rules.push({ y: box.top, x0: box.left, x1: box.right });
        if (parseFloat(style.borderBottomWidth) >= 1 && style.borderBottomStyle !== 'none' && shown(style.borderBottomColor)) rules.push({ y: box.bottom, x0: box.left, x1: box.right });
      }
      rules.sort((a, b) => a.y - b.y);
      const doubles: string[] = [];
      for (let i = 1; i < rules.length; i++) {
        const apart = rules[i].y - rules[i - 1].y;
        const shared = Math.min(rules[i].x1, rules[i - 1].x1) - Math.max(rules[i].x0, rules[i - 1].x0);
        if (apart > 0.5 && apart <= 28 && shared > 40) doubles.push(`${Math.round(apart)}px apart`);
      }
      // The header's own gap to whatever the screen puts next (its tabs, or the finding card on Interfaces & PPI).
      const header = document.querySelector('[data-evidence-screen] > header');
      const description = header?.querySelector('.screen-tab-description');
      const next = header?.nextElementSibling;
      // Strip surfaces must wear the accent token, resolved through a probe so the test never hardcodes the hex.
      const probe = document.createElement('div'); probe.style.background = 'var(--cs-accent-wash)'; document.body.append(probe);
      const wash = getComputedStyle(probe).backgroundColor; probe.remove();
      const strips = [...document.querySelectorAll('[data-evidence-screen] thead, [data-evidence-screen] .viz-frame__head')]
        .filter(el => (el as HTMLElement).offsetParent !== null && getComputedStyle(el).backgroundColor !== wash)
        .map(el => `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}`);
      return {
        doubles,
        titleTop: Math.round(document.querySelector('.screen-title')!.getBoundingClientRect().top),
        gap: description && next ? Math.round(next.getBoundingClientRect().top - description.getBoundingClientRect().bottom) : null,
        screens: document.querySelectorAll('[data-evidence-screen]').length,
        strips,
      };
    });
  }

  for (const tab of TABS) {
    expect(measured[tab].screens, `${tab}: exactly one Evidence screen root declares itself`).toBe(1);
    expect(measured[tab].doubles, `${tab}: inspector hairlines stacked`).toEqual([]);
    expect(measured[tab].strips, `${tab}: table and chart-frame heads wear the accent strip`).toEqual([]);
    // The description's own margin used to stack on the 24px flex gap (about 50px before the next block).
    expect(measured[tab].gap! <= 28, `${tab}: ${measured[tab].gap}px under the description`).toBe(true);
  }
  // The title sits on one line across tabs; Interfaces & PPI used to drop ~50px because its guide button had its own row.
  expect(new Set(TABS.map(tab => measured[tab].titleTop)).size, `title tops ${TABS.map(tab => measured[tab].titleTop).join('/')}`).toBe(1);

  // Population data: the homozygote line sits in the finding card in the comparison AND the records view.
  await screen.getByRole('button', 'Population data', { exact: true }).tap();
  await ready();
  const placement = () => browser.evaluate(() => {
    const hom = document.querySelector('.pop-hero__hom');
    const hero = document.querySelector('.pop-hero');
    return { inHero: Boolean(hom && hero && hero.contains(hom)), strayFoot: document.querySelectorAll('.pop-screen > .evw-panel > p.pop-card__foot').length };
  });
  expect((await placement()).inHero, 'the homozygote line belongs to the finding card').toBe(true);
  expect((await placement()).strayFoot, 'no loose footer under the comparison card').toBe(0);
  await app.screenshot('population-layout');

  // The chart's label column must hold the widest realistic source name in the font it is actually drawn in.
  const longest = 'gnomAD (local dbNSFP, cohorts combined)';
  const drawn = await browser.evaluate((name: string) => {
    const label = document.querySelector('.evw-chart-canvas svg text');
    const style = getComputedStyle(label!);
    const context = document.createElement('canvas').getContext('2d')!;
    context.font = `12px ${style.fontFamily}`;
    return context.measureText(name).width;
  }, longest);
  // 12px label offset (`dx`) on top of the text itself, and the label column must not clip the name.
  expect(populationLabelWidth([longest]) >= drawn + 12, `label column ${populationLabelWidth([longest])}px vs ${Math.round(drawn)}px of text`).toBe(true);

  // Chips are quiet pills: a faint wash of their own ink, no drawn outline unless the state is dashed, and a status dot.
  const chip = await browser.evaluate(() => {
    const verdict = document.querySelector('[data-testid="verdict-chip"]')!;
    const style = getComputedStyle(verdict);
    const context = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
    const rgb = (color: string) => { context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1); return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3); };
    const fill = rgb(style.backgroundColor); const surface = rgb(getComputedStyle(document.body).getPropertyValue('--cs-surface').trim() || '#fff');
    return {
      dashed: verdict.hasAttribute('data-unconfirmed'),
      outline: style.borderTopColor, borderStyle: style.borderTopStyle,
      radius: parseFloat(style.borderTopLeftRadius),
      dot: verdict.classList.contains('chip-code') ? 'code' : getComputedStyle(verdict, '::before').content,
      drift: Math.max(...fill.map((value, i) => Math.abs(value - surface[i]))),
    };
  });
  if (chip.dashed) expect(chip.borderStyle === 'dashed' && chip.outline !== 'rgba(0, 0, 0, 0)', `an unconfirmed chip shows its dashed outline (${chip.borderStyle} ${chip.outline})`).toBe(true);
  else expect(chip.outline, 'no drawn outline on a verdict chip').toBe('rgba(0, 0, 0, 0)');
  expect(chip.radius >= 9, `pill radius ${chip.radius}`).toBe(true);
  expect(chip.dot === 'code' || chip.dot === '""', `status dot ${chip.dot}`).toBe(true);
  expect(chip.drift > 0 && chip.drift <= 40, `a faint wash off the surface, not an opaque box (${chip.drift})`).toBe(true);

  await screen.getByRole('tab', 'Clinical assertion').tap();
  await expect(screen.getByText(/^gnomAD homozygotes/)).toBeVisible();
  expect((await placement()).inHero, 'the homozygote line is still in the finding on the records view').toBe(true);

  await screen.getByRole('button', 'In-silico predictors', { exact: true }).tap();
  await ready();
  await app.screenshot('predictors-chips');
  await screen.getByRole('button', 'Switch to dark mode').tap();
  await screen.getByRole('button', 'Population data', { exact: true }).tap();
  await ready();
  await app.screenshot('population-chips-dark');
});
