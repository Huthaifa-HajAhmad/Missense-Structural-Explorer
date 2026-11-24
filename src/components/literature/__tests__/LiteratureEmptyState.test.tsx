// @vitest-environment jsdom
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LiteratureEmptyState } from "../LiteratureEmptyState";

const base = {
  loadingFirst: false, gene: "PAH", forms: null, total: 0, isNarrowingFilter: true,
  activeFilter: "R408W", executedFilter: "", scope: "gene" as const,
  tierFilter: "all" as const, tagFilters: [], groupFilter: "all" as const, onClearScreeningFilters: () => {},
};

describe("LiteratureEmptyState", () => {
  it("does not say 'none of the 0 loaded papers' before anything has loaded", () => {
    render(<LiteratureEmptyState {...base} total={0} />);
    expect(screen.queryByText(/None of the 0/)).toBeNull();
    expect(screen.getByText(/No papers are loaded yet/)).toBeInTheDocument();
    expect(screen.getByText(/Press Enter to search Europe PMC/)).toBeInTheDocument();
  });

  it("keeps the narrowing statement, with the count, once papers are loaded", () => {
    render(<LiteratureEmptyState {...base} total={12} />);
    expect(screen.getByText(/None of the 12 loaded papers match/)).toBeInTheDocument();
  });
});
