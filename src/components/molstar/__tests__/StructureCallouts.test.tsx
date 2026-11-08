// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { calloutWidth, layoutCallouts, StructureCallouts, type StructureCallout } from "../StructureCallouts";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const site = (over: Partial<StructureCallout> = {}): StructureCallout => ({
  key: "site", position: 159, on: "primary", kicker: "Variant site", title: "Ser159Cys", color: 0xc46849,
  facts: [{ label: "Fold", value: "Coil 140–170" }, { label: "Confidence", value: "43.3", note: "very low" }],
  frameLabel: "Frame variant residue Ser159", onFrame: vi.fn(), ...over,
});

/** A camera that puts every anchor at the canvas centre, and a canvas the same size as the stage. */
function fakePlugin() {
  const listeners: Array<() => void> = [];
  const canvas = document.createElement("canvas");
  canvas.width = 800;
  canvas.height = 600;
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON() {} });
  return {
    draw: () => listeners.forEach(l => l()),
    plugin: {
      canvas3d: {
        webgl: { gl: { canvas } },
        camera: { project: (out: number[]) => { out[0] = 400; out[1] = 300; out[2] = 0.5; out[3] = 1; return out; } },
        didDraw: { subscribe: (l: () => void) => { listeners.push(l); return { unsubscribe() {} }; } },
      },
    },
  };
}

describe("StructureCallouts", () => {
  it("offers one explicit frame action per residue", () => {
    const onFrame = vi.fn();
    render(<StructureCallouts plugin={null} readyVersion={1} anchorOf={() => null} callouts={[site({ onFrame })]} rightInset={0} />);
    fireEvent.click(screen.getByRole("button", { name: "Frame variant residue Ser159" }));
    expect(onFrame).toHaveBeenCalledTimes(1);
  });

  it("shows the residue's facts as labelled rows, not a paragraph", () => {
    render(<StructureCallouts plugin={null} readyVersion={1} anchorOf={() => null} callouts={[site()]} rightInset={0} />);
    const card = screen.getByTestId("structure-callouts").querySelector<HTMLElement>('[data-callout="site"]')!;
    expect([...card.querySelectorAll("dt")].map(dt => dt.textContent)).toEqual(["Fold", "Confidence"]);
    expect(card.textContent).toContain("Coil 140–170");
    expect(card.textContent).toContain("very low");
  });

  it("offers a return action only where one is given", () => {
    const onClear = vi.fn();
    render(<StructureCallouts plugin={null} readyVersion={1} anchorOf={() => null} rightInset={0}
      callouts={[site(), site({ key: "selected", kicker: "Selected residue", title: "Arg200", color: null, onClear, clearLabel: "Return to variant site" })]} />);
    expect(screen.getAllByRole("button", { name: "Return to variant site" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Return to variant site" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("draws the leader path to the projected Cα and puts the card in the right-hand column", () => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { cb(0); return 0; });
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    const { plugin, draw } = fakePlugin();
    render(<StructureCallouts plugin={plugin as any} readyVersion={1} anchorOf={() => [0, 0, 0] as any} callouts={[site()]} rightInset={0} />);
    const root = screen.getByTestId("structure-callouts");
    root.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON() {} });
    draw();
    const line = root.querySelector("path.s3d-callouts__line")!;
    expect(line.getAttribute("d")).toContain("L 400 300");
    expect(line.getAttribute("d")).toMatch(/^M 580 /);
    expect(root.querySelector<HTMLElement>('[data-callout="site"]')!.dataset.anchor).toBe("onscreen");
    expect(root.querySelector<HTMLElement>('[data-callout="site"]')!.dataset.placed).toBe("true");
  });

  it("drops the line and says so when the residue is outside the view", () => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { cb(0); return 0; });
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    const { plugin, draw } = fakePlugin();
    plugin.canvas3d.camera.project = (out: number[]) => { out[0] = 400; out[1] = 300; out[3] = -1; return out; };
    render(<StructureCallouts plugin={plugin as any} readyVersion={1} anchorOf={() => [0, 0, 0] as any} callouts={[site()]} rightInset={0} />);
    const root = screen.getByTestId("structure-callouts");
    root.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON() {} });
    draw();
    expect(root.querySelector<SVGPathElement>("path.s3d-callouts__line")!.style.display).toBe("none");
    expect(root.querySelector<HTMLElement>('[data-callout="site"]')!.dataset.anchor).toBe("offscreen");
  });

  it("calls a residue with no Cα missing, not out of view, and disables framing it", () => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { cb(0); return 0; });
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    const { plugin, draw } = fakePlugin();
    render(<StructureCallouts plugin={plugin as any} readyVersion={1} anchorOf={() => null} callouts={[site()]} rightInset={0} />);
    const root = screen.getByTestId("structure-callouts");
    root.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON() {} });
    draw();
    const card = root.querySelector<HTMLElement>('[data-callout="site"]')!;
    expect(card.dataset.anchor).toBe("missing");
    const button = screen.getByRole("button", { name: /No Cα at this residue/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });
});

describe("layoutCallouts", () => {
  const stage = { width: 1200, height: 800 };
  const insets = { left: 324, right: 0 };
  const width = calloutWidth(stage.width);

  it("scales the card width with the stage, within two bounds", () => {
    expect(calloutWidth(1200)).toBe(240);
    expect(calloutWidth(900)).toBe(208);
    expect(calloutWidth(2000)).toBe(240);
  });

  it("puts each card on its residue's side of the structure when both sides have room", () => {
    const placed = layoutCallouts([
      { key: "a", point: { x: 650, y: 300 }, height: 80 },
      { key: "b", point: { x: 800, y: 200 }, height: 80 },
    ], stage, insets, { left: 600, right: 900 });
    const a = placed.find(p => p.key === "a")!;
    const b = placed.find(p => p.key === "b")!;
    expect(a).toMatchObject({ side: "left", left: 344, lineX: 344 + width, top: 282, width });
    expect(b).toMatchObject({ side: "right", left: 916, lineX: 916, top: 182 });
  });

  it("stacks cards on one side without overlap, in anchor order", () => {
    const placed = layoutCallouts([
      { key: "low", point: { x: 1000, y: 210 }, height: 80 },
      { key: "high", point: { x: 1000, y: 200 }, height: 80 },
    ], stage, insets);
    expect(placed.map(p => [p.key, p.top])).toEqual([["high", 182], ["low", 270]]);
  });

  it("never covers the structure when only one side has room for a card", () => {
    // The structure fills 500–1000: the left gap is too narrow, so even a left residue goes right.
    const placed = layoutCallouts([{ key: "a", point: { x: 520, y: 300 }, height: 80 }], { width: 1500, height: 800 }, insets, { left: 500, right: 1000 });
    expect(placed[0].side).toBe("right");
  });

  it("uses the left column alone when the right one is blocked", () => {
    const placed = layoutCallouts([{ key: "a", point: { x: 1100, y: 300 }, height: 80 }], stage, insets, { left: 700, right: 1150 });
    expect(placed[0].side).toBe("left");
  });

  it("sends a residue that is out of view to the right column", () => {
    expect(layoutCallouts([{ key: "a", point: null, height: 80 }], stage, insets)[0]).toMatchObject({ side: "right", top: 12 });
  });

  it("slides a column up rather than running its last card off the stage", () => {
    const placed = layoutCallouts([
      { key: "a", point: { x: 1000, y: 700 }, height: 80 },
      { key: "b", point: { x: 1000, y: 760 }, height: 80 },
    ], { width: 1200, height: 700 }, insets);
    const b = placed.find(p => p.key === "b")!;
    expect(b.top + b.height).toBeLessThanOrEqual(700 - 12);
    expect(placed.find(p => p.key === "a")!.top).toBe(520);
  });

  it("never stacks two cards of one column on top of each other", () => {
    const placed = layoutCallouts([
      { key: "a", point: { x: 1000, y: 100 }, height: 80 },
      { key: "b", point: { x: 1000, y: 110 }, height: 80 },
      { key: "c", point: { x: 1000, y: 120 }, height: 80 },
    ], stage, insets);
    const tops = placed.map(p => p.top);
    for (let i = 1; i < tops.length; i++) expect(tops[i] - tops[i - 1]).toBeGreaterThanOrEqual(80);
  });
});
