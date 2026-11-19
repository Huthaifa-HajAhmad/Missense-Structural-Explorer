// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NewVersionBanner } from "../NewVersionBanner";

describe("NewVersionBanner", () => {
  it("shows nothing while the page is current", () => {
    render(<NewVersionBanner stale={false} onReload={() => {}} />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("tells the reader a new version is ready and reloads only when asked", () => {
    const onReload = vi.fn();
    render(<NewVersionBanner stale onReload={onReload} />);
    expect(screen.getByRole("status").textContent).toContain("A new version of Missense & Fold is available");
    expect(onReload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it("can be dismissed, and stays dismissed", () => {
    const { rerender } = render(<NewVersionBanner stale onReload={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("status")).toBeNull();
    rerender(<NewVersionBanner stale onReload={() => {}} />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
