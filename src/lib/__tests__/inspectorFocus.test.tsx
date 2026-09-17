// @vitest-environment jsdom
import React from "react";
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  INSPECTOR_FOCUS_EVENT,
  INSPECTOR_SECTIONS,
  requestInspectorFocus,
  revealInspectorSection,
  useInspectorFocus
} from "../inspectorFocus";

function FocusProbe({ onFocus }: { onFocus: (sectionId: string) => void }) {
  useInspectorFocus(onFocus);
  return null;
}

describe("requestInspectorFocus", () => {
  it("publishes the section id on the documented event", () => {
    const seen: string[] = [];
    const handler = (event: Event) => seen.push((event as CustomEvent<{ sectionId: string }>).detail.sectionId);

    window.addEventListener(INSPECTOR_FOCUS_EVENT, handler);
    requestInspectorFocus(INSPECTOR_SECTIONS.residueShiftNarrative);
    window.removeEventListener(INSPECTOR_FOCUS_EVENT, handler);

    expect(seen).toEqual([INSPECTOR_SECTIONS.residueShiftNarrative]);
  });

  it("is inert when nothing is listening", () => {
    // A producer must be shippable before its consumer exists.
    expect(() => requestInspectorFocus("no-such-section")).not.toThrow();
  });
});

describe("useInspectorFocus", () => {
  it("delivers focus requests to the inspector", () => {
    const onFocus = vi.fn();
    render(<FocusProbe onFocus={onFocus} />);

    act(() => {
      requestInspectorFocus(INSPECTOR_SECTIONS.residueShiftPocket);
    });

    expect(onFocus).toHaveBeenCalledWith(INSPECTOR_SECTIONS.residueShiftPocket);
  });

  it("stops listening once unmounted", () => {
    const onFocus = vi.fn();
    const { unmount } = render(<FocusProbe onFocus={onFocus} />);
    unmount();

    act(() => {
      requestInspectorFocus(INSPECTOR_SECTIONS.residueShiftNarrative);
    });

    expect(onFocus).not.toHaveBeenCalled();
  });

  it("ignores a request with no section id", () => {
    const onFocus = vi.fn();
    render(<FocusProbe onFocus={onFocus} />);

    act(() => {
      window.dispatchEvent(new CustomEvent(INSPECTOR_FOCUS_EVENT, { detail: {} }));
    });

    expect(onFocus).not.toHaveBeenCalled();
  });
});

describe("revealInspectorSection", () => {
  it("reports failure for a section that is not mounted", () => {
    expect(revealInspectorSection("missing-section")).toBe(false);
  });

  it("scrolls and focuses a mounted section", () => {
    const target = document.createElement("div");
    target.id = "target-section";
    target.tabIndex = -1;
    document.body.appendChild(target);

    const scrollIntoView = vi.fn();
    target.scrollIntoView = scrollIntoView;
    const focus = vi.spyOn(target, "focus");

    const container = document.createElement("div");
    container.appendChild(target);
    document.body.appendChild(container);

    expect(revealInspectorSection("target-section", container)).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    // Keyboard users must land on the revealed content, not merely see it scroll.
    expect(focus).toHaveBeenCalled();

    container.remove();
  });

  it("does not steal focus when the section lives outside the inspector body", () => {
    const target = document.createElement("div");
    target.id = "elsewhere";
    document.body.appendChild(target);
    target.scrollIntoView = vi.fn();
    const focus = vi.spyOn(target, "focus");

    const unrelated = document.createElement("div");
    document.body.appendChild(unrelated);

    expect(revealInspectorSection("elsewhere", unrelated)).toBe(true);
    expect(focus).not.toHaveBeenCalled();

    target.remove();
    unrelated.remove();
  });
});
