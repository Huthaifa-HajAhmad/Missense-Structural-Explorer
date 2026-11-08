import { useEffect, useLayoutEffect, useRef } from "react";
import { CornerUpLeft, Crosshair } from "lucide-react";
import { Vec4, type Vec3 } from "molstar/lib/mol-math/linear-algebra";
import type { PluginContext } from "molstar/lib/mol-plugin/context";
import type { CalloutFact } from "../../shared/structureSelection";
import { hexColour } from "../../shared/colorHex";

export interface StructureCallout {
  key: string;
  /** Residue number on the drawn structure (UniProt numbering; only passed when it is verified). */
  position: number;
  /** Anchor on the primary structure or on the superposed variant. */
  on: "primary" | "variant";
  /** Chain of the anchored residue, so a multi-chain model cannot anchor the wrong copy. */
  chain?: string | null;
  /** "Variant site", "Selected": the role, printed above the name. */
  kicker: string;
  title: string;
  /** Drawn colour of the residue's sticks; null for element colours. */
  color: number | null;
  /** Second colour of a superposed pair. */
  secondaryColor?: number | null;
  facts: CalloutFact[];
  frameLabel: string;
  onFrame: () => void;
  onClear?: () => void;
  clearLabel?: string;
}

interface Props {
  plugin: PluginContext | null;
  /** Bumps on every finished load, so anchors are re-read for new coordinates. */
  readyVersion: number;
  anchorOf: (position: number, on: "primary" | "variant", chain?: string | null) => Vec3 | null | undefined;
  callouts: StructureCallout[];
  /** Space kept free on the right (the pocket panel), in CSS pixels. */
  rightInset: number;
  /** Space kept free on the left (the guide and legend column), in CSS pixels. */
  leftInset?: number;
}

const EDGE = 12;
const GAP = 8;
/** Where the leader line leaves the card when the title cannot be measured. */
const LINE_Y = 18;
/** Space kept between a card and the structure's projected extent. */
const BODY_GAP = 16;
const MIN_WIDTH = 208;
const MAX_WIDTH = 240;

/** Card width for a stage: 21% of it, within the two bounds. Narrow stages get a narrower card. */
export function calloutWidth(stageWidth: number): number {
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(stageWidth * 0.21)));
}

export interface CalloutPlacement {
  key: string;
  left: number;
  top: number;
  width: number;
  height: number;
  side: "left" | "right";
  lineX: number;
  lineY: number;
}

/**
 * Puts each card beside the structure, never over it when there is room: a side is used only when
 * the gap between the structure's projected extent (`body`) and that edge fits a card. Each column
 * sits as close to the structure as it can without covering it, so leader lines stay short. With
 * room on both sides, a card goes to its residue's side of the structure's centre. Each column then
 * stacks top to bottom in the order of the anchors, and slides up as a column if the stack would
 * overflow the bottom. A residue out of view goes to the right column, where its card says so.
 */
export function layoutCallouts(
  items: ReadonlyArray<{ key: string; point: { x: number; y: number } | null; height: number }>,
  stage: { width: number; height: number },
  insets: { left: number; right: number },
  body: { left: number; right: number } | null = null,
): CalloutPlacement[] {
  const width = calloutWidth(stage.width);
  const leftX = insets.left + EDGE;
  const rightX = Math.max(leftX, stage.width - insets.right - width - EDGE);
  // A column may move in from the edge towards the structure; it never crosses it.
  const leftCol = body ? Math.max(leftX, Math.min(body.left - width - BODY_GAP, rightX - width - GAP)) : leftX;
  const rightCol = body ? Math.min(rightX, Math.max(body.right + BODY_GAP, leftX + width + GAP)) : rightX;
  const leftFits = Boolean(body) && leftCol + width <= body!.left - GAP;
  const rightFits = body ? rightCol >= body.right + GAP : true;
  const centre = body ? (body.left + body.right) / 2 : 0;
  const sorted = [...items].sort((a, b) => (a.point?.y ?? Infinity) - (b.point?.y ?? Infinity));
  const floors = { left: EDGE, right: EDGE };
  const placed = sorted.map(item => {
    const side: "left" | "right" = leftFits && item.point && (!rightFits || item.point.x < centre) ? "left" : "right";
    const columnX = side === "left" ? leftCol : rightCol;
    const top = Math.max(floors[side], Math.min((item.point?.y ?? floors[side]) - LINE_Y, stage.height - item.height - EDGE));
    floors[side] = top + item.height + GAP;
    return { key: item.key, left: columnX, top, width, height: item.height, side, lineX: side === "left" ? columnX + width : columnX, lineY: top + LINE_Y };
  });
  return clampColumns(placed, stage.height);
}

/** Slides a column up when its stack would run off the bottom, keeping the cards' order. */
function clampColumns(placed: CalloutPlacement[], height: number): CalloutPlacement[] {
  const out = placed.map(p => ({ ...p }));
  for (const side of ["left", "right"] as const) {
    const column = out.filter(p => p.side === side);
    if (column.length === 0) continue;
    const bottom = Math.max(...column.map(p => p.top + p.height));
    const overflow = bottom - (height - EDGE);
    if (overflow <= 0) continue;
    const firstTop = Math.min(...column.map(p => p.top));
    const shift = Math.min(overflow, Math.max(0, firstTop - EDGE));
    for (const p of column) {
      p.top -= shift;
      p.lineY -= shift;
    }
  }
  return out;
}



/**
 * Cards beside the structure, each tied to its residue by a leader line, like a figure callout.
 *
 * The anchor is the residue's Cα in Mol*'s world space, projected through the live camera on every
 * redraw. Positions are written straight to the DOM: a camera drag redraws many times a second and
 * must not re-render React. A residue behind the camera or outside the canvas keeps its card but
 * drops its line, and the card says so. A residue with no Cα in the model says that instead: the
 * two states are not the same and the frame button is disabled for the second.
 */
export function StructureCallouts({ plugin, readyVersion, anchorOf, callouts, rightInset, leftInset = 0 }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  const lineRefs = useRef(new Map<string, SVGPathElement>());
  const haloRefs = useRef(new Map<string, SVGPathElement>());
  const dotRefs = useRef(new Map<string, SVGCircleElement>());
  const frameRefs = useRef(new Map<string, HTMLButtonElement>());
  const anchorsRef = useRef(new Map<string, Vec3 | null>());
  const sizesRef = useRef(new Map<string, { key: string; width: number; height: number }>());
  const contentKey = callouts.map(c => `${c.key}:${c.kicker}:${c.title}:${c.facts.map(f => `${f.label}=${f.value}${f.note ?? ""}`).join(",")}`).join("|");
  const signature = callouts.map(c => `${c.key}:${c.on}:${c.position}:${c.chain ?? ""}`).join("|");

  // Re-read anchors when the set or the coordinates change (the camera does not move them).
  useLayoutEffect(() => {
    const next = new Map<string, Vec3 | null>();
    for (const c of callouts) {
      const anchor = anchorOf(c.position, c.on, c.chain);
      if (anchor !== undefined) next.set(c.key, anchor);
    }
    anchorsRef.current = next;
    sizesRef.current.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, readyVersion]);

  useEffect(() => {
    const canvas3d = plugin?.canvas3d;
    const root = rootRef.current;
    if (!canvas3d || !root) return;
    const out = Vec4();
    let frame = 0;

    const place = () => {
      frame = 0;
      const stage = root.getBoundingClientRect();
      // Mol*'s canvas is an HTMLCanvasElement in the browser; the union also covers OffscreenCanvas.
      const canvasEl = canvas3d.webgl?.gl?.canvas as HTMLCanvasElement | undefined;
      const box = canvasEl?.getBoundingClientRect();
      if (!box || box.width === 0) return;
      const ratio = canvasEl!.height / box.height || 1;
      const width = calloutWidth(stage.width);
      const points = new Map<string, { x: number; y: number } | null>();
      const states = new Map<string, "onscreen" | "offscreen" | "missing" | "unread">();
      for (const c of callouts) {
        const anchor = anchorsRef.current.get(c.key);
        if (anchor === undefined) { states.set(c.key, "unread"); points.set(c.key, null); continue; }
        if (anchor === null) { states.set(c.key, "missing"); points.set(c.key, null); continue; }
        canvas3d.camera.project(out, anchor);
        // project() writes the clip w into the fourth slot (mol-canvas3d/camera/util): the Vec4 buffer
        // is deliberate, and w > 0 is what separates "in front of the camera" from "behind it".
        const w = out[3];
        const x = out[0] / ratio + box.left - stage.left;
        const y = (canvasEl!.height - out[1]) / ratio + box.top - stage.top;
        const inside = w > 0 && x >= 0 && x <= stage.width && y >= 0 && y <= stage.height;
        points.set(c.key, inside ? { x, y } : null);
        states.set(c.key, inside ? "onscreen" : "offscreen");
      }
      // Apply the anchor state before measuring: its chip can wrap the kicker line, and a measured
      // height taken before the state is shown would be one line short.
      for (const c of callouts) {
        const card = cardRefs.current.get(c.key);
        if (!card) continue;
        const state = states.get(c.key) ?? "unread";
        if (card.dataset.anchor !== state) card.dataset.anchor = state;
        const chip = card.querySelector<HTMLElement>(".s3d-callout__offscreen-chip");
        if (chip) {
          const chipText = state === "offscreen" ? "Off canvas"
            : state === "missing" ? "No Cα in model"
              : state === "unread" ? "Position unavailable"
                : "Off canvas";
          if (chip.textContent !== chipText) chip.textContent = chipText;
        }
        // Measure once per content, width and anchor-state change, never per animation frame: reading
        // offsetHeight in the draw loop forces a style flush of the whole stage on every camera frame.
        const key = `${c.key}:${contentKey}:${width}:${state}`;
        const cached = sizesRef.current.get(c.key);
        if (cached?.key === key) continue;
        card.style.width = `${width}px`;
        sizesRef.current.set(c.key, { key, width, height: card.offsetHeight });
      }
      // The structure's visible bounding sphere, projected: its horizontal extent on the stage.
      const sphere = canvas3d.boundingSphereVisible;
      let body: { left: number; right: number } | null = null;
      if (sphere && sphere.radius > 0) {
        canvas3d.camera.project(out, sphere.center);
        const cx = out[0] / ratio + box.left - stage.left;
        const r = sphere.radius / canvas3d.camera.getPixelSize(sphere.center) / ratio;
        if (out[3] > 0 && Number.isFinite(r)) body = { left: cx - r, right: cx + r };
      }
      const items = callouts.map(c => ({ key: c.key, point: points.get(c.key) ?? null, height: sizesRef.current.get(c.key)?.height ?? 0 }));
      for (const placed of layoutCallouts(items, stage, { left: leftInset, right: rightInset }, body)) {
        const card = cardRefs.current.get(placed.key);
        if (!card) continue;
        card.style.transform = `translate(${placed.left}px, ${placed.top}px)`;
        const p = points.get(placed.key);
        const state = states.get(placed.key) ?? "unread";
        if (card.dataset.side !== placed.side) card.dataset.side = placed.side;
        if (card.dataset.placed !== "true") card.dataset.placed = "true";
        const frameButton = frameRefs.current.get(placed.key);
        if (frameButton) {
          const callout = callouts.find(c => c.key === placed.key);
          const label = callout?.frameLabel ?? "Frame this residue";
          const ariaLabel = state === "missing"
            ? `No Cα at this residue in the model. ${label} is unavailable.`
            : state === "unread"
              ? `Residue position not available on this model. ${label} is unavailable.`
              : state === "offscreen" ? `Out of view. ${label}` : label;
          frameButton.disabled = state === "missing" || state === "unread";
          if (frameButton.getAttribute("aria-label") !== ariaLabel) frameButton.setAttribute("aria-label", ariaLabel);
        }
        const line = lineRefs.current.get(placed.key);
        const halo = haloRefs.current.get(placed.key);
        const dot = dotRefs.current.get(placed.key);
        if (!line || !dot) continue;
        const show = Boolean(p);
        line.style.display = show ? "" : "none";
        if (halo) halo.style.display = show ? "" : "none";
        dot.style.display = show ? "" : "none";
        if (!p) continue;
        // Meet the card at the title's vertical centre when it can be measured; a wrapped kicker then
        // cannot leave the line pointing at whitespace. A 14 px elbow keeps the last segment readable.
        const title = card.querySelector<HTMLElement>(".s3d-callout__title");
        const lineY = title && title.offsetHeight > 0 ? placed.top + title.offsetTop + title.offsetHeight / 2 : placed.lineY;
        const elbowX = placed.lineX + (placed.side === "left" ? 14 : -14);
        const d = `M ${placed.lineX} ${lineY} L ${elbowX} ${lineY} L ${p.x} ${p.y}`;
        line.setAttribute("d", d);
        halo?.setAttribute("d", d);
        dot.setAttribute("cx", String(p.x));
        dot.setAttribute("cy", String(p.y));
      }
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(place); };
    // Place before the first paint of the subscription: cards must never sit at the stage origin,
    // and a static screenshot must be able to see where they went.
    place();
    const sub = canvas3d.didDraw.subscribe(schedule);
    const resize = new ResizeObserver(schedule);
    resize.observe(root);
    return () => {
      sub.unsubscribe();
      resize.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plugin, signature, readyVersion, rightInset, leftInset, contentKey]);

  if (callouts.length === 0) return null;
  return (
    <div ref={rootRef} className="s3d-callouts" data-testid="structure-callouts" role="group" aria-label="Residue callouts">
      <svg className="s3d-callouts__lines" aria-hidden="true">
        {callouts.map(c => (
          <g key={c.key}>
            <path ref={el => { if (el) haloRefs.current.set(c.key, el); else haloRefs.current.delete(c.key); }} className="s3d-callouts__halo" />
            <path ref={el => { if (el) lineRefs.current.set(c.key, el); else lineRefs.current.delete(c.key); }} className="s3d-callouts__line" />
            <circle ref={el => { if (el) dotRefs.current.set(c.key, el); else dotRefs.current.delete(c.key); }} r={3} className="s3d-callouts__dot" style={{ stroke: c.color === null ? "var(--cs-text-secondary)" : hexColour(c.color) }} />
          </g>
        ))}
      </svg>
      {callouts.map(c => (
        <div
          key={c.key}
          ref={el => { if (el) cardRefs.current.set(c.key, el); else cardRefs.current.delete(c.key); }}
          className="s3d-callout"
          data-callout={c.key}
          data-role={c.key === "site" ? "site" : "selected"}
          style={{ width: MAX_WIDTH }}
        >
          <div className="s3d-callout__head">
            <span className="s3d-callout__kicker">
              <span
                className="s3d-callout__swatch"
                data-colour={c.color === null ? "none" : undefined}
                style={c.color === null ? undefined : { background: c.secondaryColor != null ? `linear-gradient(90deg, ${hexColour(c.color)} 50%, ${hexColour(c.secondaryColor)} 50%)` : hexColour(c.color) }}
                aria-hidden="true"
              />
              {c.kicker}
              <span className="s3d-callout__offscreen-chip" aria-hidden="true">Off canvas</span>
            </span>
            <span className="s3d-callout__actions">
              <button
                ref={el => { if (el) frameRefs.current.set(c.key, el); else frameRefs.current.delete(c.key); }}
                type="button"
                className="s3d-callout__icon"
                onClick={c.onFrame}
                aria-label={c.frameLabel}
                title="Frame this residue"
              >
                <Crosshair aria-hidden="true" />
              </button>
              {c.onClear && (
                <button type="button" className="s3d-callout__icon" onClick={c.onClear} aria-label={c.clearLabel ?? "Clear"} title={c.clearLabel}>
                  <CornerUpLeft aria-hidden="true" />
                </button>
              )}
            </span>
          </div>
          <span className="s3d-callout__title">{c.title}</span>
          {c.facts.length > 0 && (
            <dl className="s3d-callout__facts">
              {c.facts.map(f => (
                <div key={f.label}>
                  <dt>{f.label}</dt>
                  <dd><span className="s3d-callout__num">{f.value}</span>{f.note && <span className="s3d-callout__qual">{f.note}</span>}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      ))}
    </div>
  );
}
