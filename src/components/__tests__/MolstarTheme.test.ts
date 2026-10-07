import { describe, expect, it, vi } from "vitest";
import { resolveHierarchyComponent } from "../molstar/useMolstarStructure";

describe("Mol* theme component lookup", () => {
  it("resolves a builder selector to the hierarchy ref required by live theme updates", async () => {
    const selector = { ref: "polymer" };
    const component = { kind: "structure-component", cell: { transform: { ref: "polymer" } }, representations: [{}] };
    const updateRepresentationsTheme = vi.fn(async (components: unknown[]) => {
      for (const item of components as Array<{ representations: unknown[] }>) {
        for (const representation of item.representations) expect(representation).toBeTruthy();
      }
    });
    const plugin = { managers: { structure: {
      hierarchy: { current: { refs: new Map([["polymer", component]]) } },
      component: { updateRepresentationsTheme },
    } } };

    const resolved = resolveHierarchyComponent(plugin, selector);
    expect(resolved).toBe(component);
    expect(resolved).not.toBe(selector);
    await plugin.managers.structure.component.updateRepresentationsTheme([resolved]);
    expect(updateRepresentationsTheme).toHaveBeenCalledOnce();
  });

  it("refuses a selector without a hierarchy component instead of treating it as one", () => {
    const plugin = { managers: { structure: { hierarchy: { current: { refs: new Map() } } } } };
    expect(resolveHierarchyComponent(plugin, { ref: "missing" })).toBeNull();
  });
});
