// @vitest-environment jsdom
/**
 * SplicingRecords.test.tsx — the channel table says how many decimals it keeps, so a reader does not
 * take 0.011 and the summary's 0.01 for two different numbers.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SplicingRecords } from "../SplicingRecords";

describe("SplicingRecords", () => {
  it("says the table keeps three decimals and the summaries round to two", () => {
    render(<SplicingRecords rows={[]} />);
    expect(screen.getByText(/keep three decimals; the summaries round to two/)).toBeTruthy();
  });
});
