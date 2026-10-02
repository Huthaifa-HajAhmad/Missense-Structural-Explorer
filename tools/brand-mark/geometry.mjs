/**
 * The Missense & Fold mark, as geometry.
 *
 * A protein fold in the ribbon convention structural biologists read at a glance — an α-helix,
 * a loop over the top, a β-strand arrow coming back down — with one front turn of the helix in
 * the accent colour: the substituted residue, coloured into the chain rather than hung off it.
 *
 * Drawn in a 64×64 box (the tile adds 4 units of inset each side, viewBox -4 -4 72 72) from real
 * 3D curves. Crossings follow one rule: the strand in front is cut out of the one behind by a gap
 * in the tile colour, and the back half of each helix turn is a thinner, quieter stroke. No
 * outlines, no gradients, so it renders the same in every browser and at every size.
 *
 * Colours are passed in, so the same drawing can be emitted with CSS variables (the component)
 * or literal hex (the favicons). `small` is a separate drawing for 16–24px, not a scaled copy:
 * heavier line, wider gaps, a longer accent.
 */

const f = (n) => n.toFixed(2);
const lerp = (a, b, t) => a + (b - a) * t;

/** Points along a helix from A to B: [x, y, depth], depth in [-1, 1] (positive is in front). */
function helix({ A, B, turns, r, N = 220, ramp = 0.12 }) {
  const ax = [B[0] - A[0], B[1] - A[1]];
  const L = Math.hypot(...ax);
  const n = [-ax[1] / L, ax[0] / L];
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const th = Math.PI * 2 * turns * t;
    // the radius tapers in and out so the coil grows out of the chain and back into it
    const rr = r * Math.min(1, t / ramp, (1 - t) / ramp);
    pts.push([A[0] + ax[0] * t + n[0] * rr * Math.sin(th), A[1] + ax[1] * t + n[1] * rr * Math.sin(th), Math.cos(th)]);
  }
  return pts;
}

function bezier(P0, C1, C2, P3, z0, z1, N = 40) {
  const pts = [];
  for (let i = 1; i <= N; i++) {
    const t = i / N;
    const s = 1 - t;
    pts.push([
      s * s * s * P0[0] + 3 * s * s * t * C1[0] + 3 * s * t * t * C2[0] + t * t * t * P3[0],
      s * s * s * P0[1] + 3 * s * s * t * C1[1] + 3 * s * t * t * C2[1] + t * t * t * P3[1],
      lerp(z0, z1, t),
    ]);
  }
  return pts;
}

const pathD = (run) => "M" + run.map((p) => `${f(p[0])} ${f(p[1])}`).join(" L");

/** Back runs in the quiet tone first, then front runs, each over a gap cut in the tile colour. */
function tube(pts, w, c, gap, backScale) {
  const runs = [];
  let cur = null;
  let side = null;
  for (const p of pts) {
    const s = p[2] < 0 ? "back" : "front";
    if (s !== side) {
      if (cur) cur.push(p);
      cur = [p];
      runs.push({ side: s, pts: cur });
      side = s;
    } else {
      cur.push(p);
    }
  }
  const back = runs
    .filter((r) => r.side === "back")
    .map((r) => ({ tag: "path", d: pathD(r.pts), stroke: c.back, width: w * backScale, cap: "round" }));
  const front = runs
    .filter((r) => r.side === "front")
    .flatMap((r) => [
      { tag: "path", d: pathD(r.pts), stroke: c.bg, width: w + gap * 2, cap: "butt" },
      { tag: "path", d: pathD(r.pts), stroke: c.body, width: w, cap: "round" },
    ]);
  return [...back, ...front];
}

/** The β-strand: a solid arrow from s0 to s1, cut out of what lies behind it. */
function strand(s0, s1, c, { hw, hh, head, gap }) {
  const v = [s1[0] - s0[0], s1[1] - s0[1]];
  const L = Math.hypot(...v);
  const u = [v[0] / L, v[1] / L];
  const n = [-u[1], u[0]];
  const neck = [s1[0] - u[0] * head, s1[1] - u[1] * head];
  const P = [
    [s0[0] + n[0] * hw, s0[1] + n[1] * hw],
    [neck[0] + n[0] * hw, neck[1] + n[1] * hw],
    [neck[0] + n[0] * hh, neck[1] + n[1] * hh],
    s1,
    [neck[0] - n[0] * hh, neck[1] - n[1] * hh],
    [neck[0] - n[0] * hw, neck[1] - n[1] * hw],
    [s0[0] - n[0] * hw, s0[1] - n[1] * hw],
  ];
  return [{ tag: "polygon", d: "M" + P.map((p) => `${f(p[0])} ${f(p[1])}`).join(" L") + " Z", fill: c.body, stroke: c.bg, width: gap * 2 }];
}

/** The front helix crest nearest a fraction of the way along the coil. */
function frontCrest(h, at) {
  let best = null;
  h.forEach((p, i) => {
    const d = Math.abs(i / h.length - at);
    if (p[2] > 0.95 && (!best || d < best.d)) best = { i, d };
  });
  return best.i;
}

/** The substituted residue: a stretch of the chain itself, in the accent colour. */
function residue(pts, i0, span, w, c, gap) {
  const d = pathD(pts.slice(Math.max(0, i0 - span), i0 + span + 1));
  return [
    { tag: "path", d, stroke: c.bg, width: w + gap * 2, cap: "round" },
    { tag: "path", d, stroke: c.hit, width: w + 1.2, cap: "round" },
  ];
}

/**
 * The mark as a list of shapes, back to front.
 * @param {{bg: string, body: string, back: string, hit: string}} c tile, chain, back-of-coil and residue colours
 */
export function brandMarkShapes(c, { small = false } = {}) {
  const w = small ? 9.5 : 7.2;
  const gap = small ? 3.2 : 2.4;
  const turns = 2;
  // The axis leans ~25° off vertical: steeper and each front turn draws as a flat bar ("≡").
  const h = helix({ A: [6, 52], B: [27, 20], turns, r: small ? 9.5 : 9 });
  const end = h[h.length - 1];
  const loop = bezier(end, [27, 1], [50, 1], [50, 17], end[2] > 0 ? 1 : -0.2, 1);
  const chain = [...h, ...loop];
  const span = Math.round((h.length / turns) * (small ? 0.2 : 0.15));
  return [
    ...tube(chain, w, c, gap, small ? 0.7 : 0.62),
    ...strand([50, 17], [42, 57], c, small ? { hw: 5.6, hh: 11, head: 13, gap } : { hw: 4.8, hh: 10, head: 12.5, gap }),
    ...residue(chain, frontCrest(h, small ? 0.55 : 0.6), span, w, c, gap),
  ];
}

/* ── Output: polyline simplification (Ramer–Douglas–Peucker), then one decimal ── */

function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  const [x1, y1] = pts[0];
  const [x2, y2] = pts[pts.length - 1];
  const dx = x2 - x1;
  const dy = y2 - y1;
  const L = Math.hypot(dx, dy) || 1e-9;
  let dmax = 0;
  let idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const [x, y] = pts[i];
    const d = Math.abs(dy * x - dx * y + x2 * y1 - y2 * x1) / L;
    if (d > dmax) {
      dmax = d;
      idx = i;
    }
  }
  if (dmax > eps) return [...rdp(pts.slice(0, idx + 1), eps).slice(0, -1), ...rdp(pts.slice(idx), eps)];
  return [pts[0], pts[pts.length - 1]];
}

const num = (n) => {
  const s = n.toFixed(1);
  return s.endsWith(".0") ? s.slice(0, -2) : s;
};

/** Simplify a path to within 0.05 units (≈0.03px at 32px): visually identical, ~70% smaller. */
export function simplifyPath(d) {
  const closed = d.trim().endsWith("Z");
  const nums = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  const pts = [];
  for (let i = 0; i < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
  return "M" + rdp(pts, 0.05).map(([x, y]) => `${num(x)} ${num(y)}`).join(" ") + (closed ? " Z" : "");
}

export { num };
