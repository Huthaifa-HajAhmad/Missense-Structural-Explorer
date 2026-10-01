import { describe, it, expect } from "vitest";
import {
  nextCompactState,
  COMPACT_ENTER_PX,
  COMPACT_EXIT_PX,
  COMPACT_MIN_TRAVEL_PX,
} from "../useCompactOnScroll";

describe("nextCompactState", () => {
  const tall = { scrollHeight: 3000, clientHeight: 800 };

  it("collapses only past the entry depth", () => {
    expect(nextCompactState(false, COMPACT_ENTER_PX, tall.scrollHeight, tall.clientHeight)).toBe(false);
    expect(nextCompactState(false, COMPACT_ENTER_PX + 1, tall.scrollHeight, tall.clientHeight)).toBe(true);
  });

  it("holds the compact state between the two thresholds (no flicker)", () => {
    expect(nextCompactState(true, COMPACT_EXIT_PX + 20, tall.scrollHeight, tall.clientHeight)).toBe(true);
    expect(nextCompactState(false, COMPACT_EXIT_PX + 20, tall.scrollHeight, tall.clientHeight)).toBe(false);
  });

  it("expands again once back near the top", () => {
    expect(nextCompactState(true, COMPACT_EXIT_PX, tall.scrollHeight, tall.clientHeight)).toBe(false);
  });

  it("never collapses a page too short to absorb the height it would give back", () => {
    const shortTravel = 800 + COMPACT_MIN_TRAVEL_PX;
    expect(nextCompactState(false, 200, shortTravel, 800)).toBe(false);
    expect(nextCompactState(false, 200, shortTravel + 1, 800)).toBe(true);
  });
});
