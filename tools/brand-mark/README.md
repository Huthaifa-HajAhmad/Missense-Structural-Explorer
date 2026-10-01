# Brand mark

`node tools/brand-mark/build.mjs --png`

The Missense & Fold mark is a protein fold in the ribbon convention: an α-helix, a loop over the
top and a β-strand arrow coming back down. One front turn of the helix is drawn in the accent
colour. That turn is the substituted residue, coloured into the chain rather than hung off it.

`geometry.mjs` draws it from real 3D curves in a 64×64 box. The tile adds 4 units of inset on each
side, so the viewBox is `-4 -4 72 72`. Where two strands cross, the one in front is cut out of the
one behind with a gap in the tile colour. The back half of each helix turn is a thinner, paler
stroke. Nothing uses outlines or gradients.

There are two drawings, not one drawing scaled:

| | Used at | Difference |
| --- | --- | --- |
| large | 32px and up (sidebar, About, touch icon) | 7.2-unit line, 2.4-unit gaps |
| small | below 32px (favicon, tab) | 9.5-unit line, 3.2-unit gaps, longer accent. Thin strokes vanish at 16px |

## Outputs (all generated, do not hand-edit)

| File | Colours |
| --- | --- |
| `src/components/ui/BrandMark.tsx` | CSS variables `--bm-bg / --bm-body / --bm-back / --bm-hit`, defaulting to the clay tile. `--bm-bg` must match the container's background, because the crossing gaps are painted in it. |
| `public/favicon.svg` | Literal hex, rounded clay tile, small drawing |
| `public/favicon-32.png` | Rounded tile, transparent corners (`--png`) |
| `public/apple-touch-icon.png` | 180px full-bleed square, since iOS rounds the corners itself (`--png`) |

`--png` needs a Chromium-based browser. It tries `$GEOMETRY_BROWSER`, then `$CHROME_PATH`, then the
usual Edge and Chrome install paths. Paths are simplified (Ramer–Douglas–Peucker, 0.05 units) and
rounded to one decimal place. The result is visually identical to the dense curves and about 70%
smaller.
