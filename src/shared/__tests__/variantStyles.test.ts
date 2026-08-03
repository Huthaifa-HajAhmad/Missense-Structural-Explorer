import { describe, it, expect } from "vitest";
import { getVariantStyles } from "../variantStyles.ts";

describe("variantStyles Helper Unit Tests (C-7)", () => {
  it("should return unified styling classes using CSS variables", () => {
    const styles = getVariantStyles(true);
    expect(styles.classRoot).toContain("bg-cs-bg");
    expect(styles.classCard).toContain("bg-cs-surface");
    expect(styles.classInput).toContain("bg-cs-surface-2");
  });
});
