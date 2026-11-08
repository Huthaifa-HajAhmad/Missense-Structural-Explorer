import { describe, it, expect } from "vitest";
import { fitContextOntoTemplate } from "../structureContext";
import { readCaTrace } from "../coordinateText";

const NAMES = ["ALA", "GLY", "SER", "LEU", "VAL", "LYS", "GLU", "ASP", "THR", "ILE", "PHE", "ARG"];

function atom(serial: number, res: string, seq: number, p: [number, number, number], b: number): string {
  return `ATOM  ${String(serial).padStart(5)}  CA  ${res} A${String(seq).padStart(4)}    ${p.map(v => v.toFixed(3).padStart(8)).join("")}  1.00${b.toFixed(2).padStart(6)}           C`;
}

/** A helix-like spiral, so the fit has a real shape to find. */
function spiral(from: number, to: number, move: (p: [number, number, number]) => [number, number, number], names = NAMES): string {
  const lines: string[] = [];
  for (let seq = from; seq <= to; seq += 1) {
    const t = seq * 0.6;
    lines.push(atom(seq, names[seq % names.length], seq, move([2.3 * Math.cos(t), 2.3 * Math.sin(t), 1.5 * seq * 0.6]), 80 + (seq % 7)));
  }
  return lines.join("\n");
}

const identity = (p: [number, number, number]) => p;
/** Rotate 90° about z, then shift: a different frame for the same shape. */
const otherFrame = (p: [number, number, number]): [number, number, number] => [-p[1] + 30, p[0] - 12, p[2] + 7];

describe("fitContextOntoTemplate", () => {
  it("moves a full-length model onto a fragment that sits in another frame, keeping the B column", () => {
    const full = spiral(1, 60, identity);
    const fragment = spiral(20, 40, otherFrame);
    const fit = fitContextOntoTemplate(full, fragment)!;
    expect(fit.matched).toBe(21);
    expect(fit.rmsd).toBeLessThan(0.01);
    expect(fit.covered).toEqual({ start: 20, end: 40 });
    expect(fit.contextResidues).toBe(60);

    const moved = readCaTrace(fit.pdb);
    const target = readCaTrace(fragment);
    expect(moved.residues).toHaveLength(60);
    // A residue inside the covered range now sits where the fragment has it.
    const i = moved.residues.indexOf(30);
    const j = target.residues.indexOf(30);
    for (const axis of [0, 1, 2]) expect(moved.coords[3 * i + axis]).toBeCloseTo(target.coords[3 * j + axis], 2);
    expect(moved.bFactors[i]).toBeCloseTo(80 + (30 % 7), 5);
  });

  it("has no context to add when the template spans the whole model", () => {
    expect(fitContextOntoTemplate(spiral(1, 60, identity), spiral(1, 60, otherFrame))).toBeNull();
    expect(fitContextOntoTemplate(spiral(1, 60, identity), spiral(1, 55, otherFrame))).toBeNull();
  });

  it("refuses a fit on too few shared residues", () => {
    expect(fitContextOntoTemplate(spiral(1, 60, identity), spiral(20, 25, otherFrame))).toBeNull();
  });

  it("refuses files whose residue names disagree at the shared numbers", () => {
    const shifted = spiral(1, 60, identity, [...NAMES].reverse());
    expect(fitContextOntoTemplate(shifted, spiral(20, 40, otherFrame))).toBeNull();
  });

  it("refuses a fold that does not superpose", () => {
    const flat = (p: [number, number, number]): [number, number, number] => [p[2], p[0] * 6, p[1]];
    expect(fitContextOntoTemplate(spiral(1, 60, identity), spiral(20, 40, flat))).toBeNull();
  });
});
