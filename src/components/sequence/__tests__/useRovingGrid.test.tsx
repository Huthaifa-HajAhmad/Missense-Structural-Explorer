// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useRovingGrid } from "../useRovingGrid";

function Grid({ cells }: { cells: string[] }) {
  const grid = useRovingGrid<HTMLDivElement>();
  return (
    <div ref={grid.ref} onFocus={grid.onFocus} onKeyDown={grid.onKeyDown}>
      {cells.map((rc) => (
        <button key={rc} data-rc={rc} aria-label={rc} />
      ))}
    </div>
  );
}

describe("useRovingGrid", () => {
  it("keeps one tab stop and moves between rows even where a row has no cell in the same column", () => {
    // Row 0 has bins at columns 5 only; row 1 at 3 and 7 — the old exact-column lookup dead-ended.
    render(<Grid cells={["0:5", "1:3", "1:7"]} />);
    expect(screen.getAllByRole("button").filter((b) => b.tabIndex === 0)).toHaveLength(1);
    const top = screen.getByLabelText("0:5");
    top.focus();
    fireEvent.keyDown(top, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByLabelText("1:3"));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(top);
  });

  it("skips horizontal gaps and does nothing past the last row", () => {
    render(<Grid cells={["0:0", "0:3"]} />);
    const first = screen.getByLabelText("0:0");
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(document.activeElement).toBe(screen.getByLabelText("0:3"));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByLabelText("0:3"));
  });
});
