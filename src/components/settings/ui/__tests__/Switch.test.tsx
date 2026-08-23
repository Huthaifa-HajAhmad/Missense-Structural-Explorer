// @vitest-environment jsdom
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Switch } from "../Switch";

describe("Switch primitive", () => {
  it("exposes switch semantics with the label as accessible name", () => {
    render(
      <Switch label="Reduce motion" checked={false} onChange={() => {}} />
    );
    const toggle = screen.getByRole("switch");
    expect(toggle).toHaveAccessibleName("Reduce motion");
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  it("reflects checked state and fires onChange on click", () => {
    const onChange = vi.fn();
    const { rerender } = render(<Switch label="High contrast" checked onChange={onChange} />);

    const toggle = screen.getByRole("switch");
    expect(toggle).toHaveAttribute("aria-checked", "true");
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(false);
    expect(onChange).toHaveBeenCalledTimes(1);

    rerender(<Switch label="High contrast" checked={false} onChange={onChange} />);
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
  });

  it("can be disabled", () => {
    render(<Switch label="Locked" checked={false} onChange={() => {}} disabled />);
    expect(screen.getByRole("switch")).toBeDisabled();
  });
});
