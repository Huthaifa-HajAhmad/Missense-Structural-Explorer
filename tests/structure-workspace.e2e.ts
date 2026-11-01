import { readFileSync } from 'node:fs';
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { skipTour } from './support.js';

test('both 3D tabs keep a tall canvas and accessible guide across model modes', { timeout: 360_000 }, async ({ app, browser, screen }) => {
  // The viewer writes these after each finished load. A layout can look right while WebGL has failed, so every
  // mode must also show a completed draw of the number of structures it asked for.
  const readDraw = () => browser.evaluate(() => {
    const viewer = document.getElementById('molstar-viewer-container');
    return {
      structures: viewer?.dataset.drawnStructures ?? null,
      version: Number(viewer?.dataset.drawnVersion ?? '0'),
      // Mol* can finish building its data with a dead canvas, so also ask the graphics context itself.
      failed: /WebGL context lost|could not be drawn/i.test(document.querySelector('.s3d-viewer')?.textContent ?? '') ||
        (() => {
          const canvas = viewer?.querySelector('canvas');
          const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
          return !gl || gl.isContextLost();
        })(),
    };
  });
  const waitForDraw = async (structures: string, versionAbove: number | null) => {
    const deadline = Date.now() + 60_000;
    let draw = await readDraw();
    while (Date.now() < deadline && !draw.failed && !(draw.structures === structures && (versionAbove === null || draw.version > versionAbove))) {
      await new Promise(resolve => setTimeout(resolve, 250));
      draw = await readDraw();
    }
    return draw;
  };
  await skipTour(browser);
  await browser.setViewport({ width: 1753, height: 981 });
  await app.open('/');
  await expect(screen.getByRole('button', 'Run benchmark PAH p.Arg408Trp')).toBeVisible({ timeout: 90_000 });
  await browser.evaluate(async (pdb) => {
    // Local coordinates exercise rendering only; these are not new scientific predictions.
    const storePath = '/src/stores/useVariantAnalysisStore.ts';
    const { useVariantAnalysisStore: store } = await import(storePath);
    const mutant = pdb.split('\n').map((line: string) => line.startsWith('ATOM') && Number(line.slice(22, 26)) === 5 ? line.slice(0, 17) + 'VAL' + line.slice(20) : line).join('\n');
    store.setState({
      gene: 'SOD1', variant: 'p.Ala5Val', uniprotId: 'P00441', pdbText: pdb,
      pdbTextProvenance: { source: 'alphafold', afdbVersion: 'v6' }, selectedResidueIndex: 5,
      analysisState: { isLoading: false, error: null, result: { metadata: { gene: 'SOD1', variant: 'p.Ala5Val', uniprotId: 'P00441', residueIndex: 5, wildType: 'A', mutant: 'V', sequence: 'M'.repeat(154) } } },
      mutantPdb: mutant, foldingStatus: 'success', isFolding: false,
      foldingEnergetics: { structureProvenance: { source: 'alphafold', uniprotId: 'P00441' } },
      foldxReference: { state: 'ready', reason: null, provenance: { source: 'alphafold', uniprotId: 'P00441' } },
      foldxReferencePdb: pdb, foldxAlignedPdb: mutant,
      esmFoldWtPdb: pdb, esmFoldMutPdb: mutant, esmFoldAlignedPdb: mutant,
      esmFoldSingleStructure: false, esmFoldingError: null, isEsmFolding: false,
    });
    return true;
  }, readFileSync('tools/structure-focus/sod1-afdb.pdb', 'utf8'));
  await screen.getByRole('button', /^3D structure/).click();
  for (const family of ['AlphaFold & FoldX', 'ESMFold']) {
    await screen.getByRole('tab', family, { exact: true }).click();
    for (const mode of ['Wild type', 'Variant', 'Superposition']) {
      const before = await readDraw();
      const changesMode = await browser.evaluate((label: string) => document.querySelector('[data-testid="structure-modes"] [aria-checked="true"]')?.textContent?.trim() !== label, mode);
      await screen.getByRole('radio', mode, { exact: true }).click();
      await expect(screen.getByRole('radio', mode, { exact: true })).toHaveAttribute('aria-checked', 'true');
      await expect(screen.getByRole('button', 'Close-up')).toBeVisible();
      // A mode change loads other coordinates, so the draw counter must go up; a leftover draw cannot pass.
      const draw = await waitForDraw(mode === 'Superposition' ? '2' : '1', changesMode ? before.version : null);
      expect(draw.failed, `${family} ${mode}: the viewer reported a graphics failure`).toBe(false);
      expect(draw.structures, `${family} ${mode}: structures drawn`).toBe(mode === 'Superposition' ? '2' : '1');
      for (const width of [1753, 900, 390]) {
        await browser.setViewport({ width, height: 981 });
        expect(await browser.evaluate(() => {
          const canvas = document.querySelector('.structure-workspace__canvas')!.getBoundingClientRect();
          const stage = document.querySelector('.s3d-stage')!.getBoundingClientRect();
          return { tall: canvas.height >= 620 && stage.height >= 400, fits: document.documentElement.scrollWidth <= innerWidth, redundant: !!document.querySelector('.structure-workspace__header .workspace-selection, [data-testid="structure-sidechain-card"]') };
        })).toEqual({ tall: true, fits: true, redundant: false });
        if (width === 390) {
          await expect(screen.getByRole('button', 'Show canvas guide')).toBeVisible();
          await screen.getByRole('button', 'Show canvas guide').click();
          await expect(screen.getByRole('checkbox', 'Residue labels', { exact: true })).toBeVisible();
          await screen.getByRole('button', 'Hide canvas guide').click();
        }
        await app.screenshot(`structure-${family.startsWith('Alpha') ? 'af' : 'esm'}-${mode}-${width}`);
      }
      // Resizing and screenshots are what stress WebGL, so the canvas must still be healthy after them.
      const after = await readDraw();
      expect(after.failed, `${family} ${mode}: graphics failed after resizing`).toBe(false);
      expect(after.structures, `${family} ${mode}: structures still drawn after resizing`).toBe(mode === 'Superposition' ? '2' : '1');
      await browser.setViewport({ width: 1753, height: 981 });
    }
  }
});
