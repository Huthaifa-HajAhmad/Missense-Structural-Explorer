// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProseEditor } from "../ReportProseEditor";
import { blankBlock } from "../../../shared/reportModel";

function open(text = "Drafted reading.", over: Partial<ReturnType<typeof blankBlock>> = {}) {
  const block = { ...blankBlock("notes"), text, drafted: text, evidenceId: "ev-1", ...over };
  const onChange = vi.fn();
  const onDone = vi.fn();
  const onCancel = vi.fn();
  render(<ProseEditor block={block} onChange={onChange} onDone={onDone} onCancel={onCancel} />);
  return { onChange, onDone, onCancel, area: screen.getByRole("textbox", { name: "Edit Author's notes" }) as HTMLTextAreaElement };
}

describe("ProseEditor", () => {
  it("saves the typed text with the draft it was based on, so a later change to the draft can mark it stale", () => {
    const { onChange, onDone, area } = open("Drafted reading.");
    fireEvent.change(area, { target: { value: "My reading." } });
    fireEvent.click(screen.getByRole("button", { name: "Save text" }));
    expect(onChange).toHaveBeenCalledWith("My reading.", "Drafted reading.", "ev-1");
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("discards the typed text on Cancel without calling onChange", () => {
    const { onChange, onCancel, area } = open();
    fireEvent.change(area, { target: { value: "Throw this away." } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("wraps the selection in bold markers", () => {
    const { area } = open("plain words");
    area.setSelectionRange(0, 5);
    fireEvent.click(screen.getByRole("button", { name: "Bold" }));
    expect(area.value).toBe("**plain** words");
  });

  it("turns each selected line into a bullet once, without doubling an existing bullet", () => {
    const { area } = open("one\n- two\nthree");
    area.setSelectionRange(0, area.value.length);
    fireEvent.click(screen.getByRole("button", { name: "Bulleted list" }));
    expect(area.value).toBe("- one\n- two\n- three");
  });
});
