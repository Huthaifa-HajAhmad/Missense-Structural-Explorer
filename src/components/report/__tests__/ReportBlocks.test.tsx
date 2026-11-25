// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReportBlockCard } from "../ReportBlocks";
import { blankBlock, type ReportTable } from "../../../shared/reportModel";

const noop = () => {};

function renderTable(table: ReportTable) {
  const block = { ...blankBlock("stability"), table };
  render(<ReportBlockCard block={block} editing={false} onToggle={noop} onStartEdit={noop} onStopEdit={noop} onEdit={noop} onRevert={noop} onKeepMine={noop} />);
}

describe("ReportBlockCard tables", () => {
  it("folds only the column the table names, under the table's own label", () => {
    renderTable({ headers: ["A", "B", "C"], rows: [["a", "long note", "c"]], detail: { column: 1, label: "Why" } });
    expect(screen.getByText("Why").closest("summary")).not.toBeNull();
    expect(screen.getByText("long note").closest("details")).not.toBeNull();
    expect(screen.getByText("c").closest("details")).toBeNull();
  });

  it("folds nothing in a five-column table that names no column", () => {
    renderTable({ headers: ["A", "B", "C", "D", "E"], rows: [["a", "b", "c", "d", "e"]] });
    expect(document.querySelector("details")).toBeNull();
  });

  it("shows the table's short list first, and the rest on request, with the table's own labels", () => {
    renderTable({ headers: ["Code", "State"], rows: [["PP3", "x"], ["PM2", "y"], ["PS3", "z"]], shortList: { rows: 1, more: "More rows", less: "Fewer rows" } });
    expect(screen.getAllByRole("row")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "More rows" }));
    expect(screen.getAllByRole("row")).toHaveLength(4);
    expect(screen.getByRole("button", { name: "Fewer rows" })).toHaveAttribute("aria-expanded", "true");
  });

  it("shows every row, with no toggle, when the table names no short list", () => {
    renderTable({ headers: ["Code", "State"], rows: [["PP3", "Not met"], ["PM2", "Not met"]] });
    expect(screen.getAllByRole("row")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: /Show/ })).toBeNull();
  });
});
