// @vitest-environment jsdom
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import HeaderBar from "../HeaderBar";

describe("HeaderBar Component Tests (C-7)", () => {
  it("should render correctly with default state", () => {
    render(<HeaderBar masterView="search" isBiophysicalLoading={false} isOffline={false} isSearchOpen={false} setIsSearchOpen={() => {}} />);
    expect(screen.queryByText("Evidence")).not.toBeInTheDocument();
    expect(screen.queryByText("Computing…")).not.toBeInTheDocument();
    expect(screen.queryByText("OFFLINE")).not.toBeInTheDocument();
  });

  it("should display breadcrumb title when not on search view", () => {
    render(<HeaderBar masterView="evidence" isBiophysicalLoading={false} isOffline={false} isSearchOpen={false} setIsSearchOpen={() => {}} />);
    expect(screen.getByText("Evidence")).toBeInTheDocument();
  });

  it("should render computing status when isBiophysicalLoading is true", () => {
    render(<HeaderBar masterView="evidence" isBiophysicalLoading={true} isOffline={false} isSearchOpen={false} setIsSearchOpen={() => {}} />);
    expect(screen.getByText(/Computing/i)).toBeInTheDocument();
  });

  it("should display offline label when isOffline is true", () => {
    render(<HeaderBar masterView="evidence" isBiophysicalLoading={false} isOffline={true} isSearchOpen={false} setIsSearchOpen={() => {}} />);
    expect(screen.getByText("OFFLINE")).toBeInTheDocument();
  });

  it("should display integrated error alert in header when error prop is provided", () => {
    render(
      <HeaderBar 
        masterView="evidence" 
        isBiophysicalLoading={false} 
        isOffline={false} 
        isSearchOpen={false} 
        setIsSearchOpen={() => {}} 
        error="Unauthorized: API Key Missing"
      />
    );
    expect(screen.getByText(/Unauthorized: API Key Missing/i)).toBeInTheDocument();
  });

  it("should render theme toggle and settings actions in the header", () => {
    render(<HeaderBar masterView="evidence" isBiophysicalLoading={false} isOffline={false} isSearchOpen={false} setIsSearchOpen={() => {}} />);
    expect(screen.getByRole("button", { name: /switch to (light|dark) mode/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open settings/i })).toBeInTheDocument();
  });

  it("should reflect the dark theme state on the toggle", () => {
    const { rerender } = render(<HeaderBar masterView="evidence" isBiophysicalLoading={false} isOffline={false} isSearchOpen={false} setIsSearchOpen={() => {}} isDark={false} />);
    expect(screen.getByRole("button", { name: /switch to dark mode/i })).toBeInTheDocument();
    rerender(<HeaderBar masterView="evidence" isBiophysicalLoading={false} isOffline={false} isSearchOpen={false} setIsSearchOpen={() => {}} isDark={true} />);
    expect(screen.getByRole("button", { name: /switch to light mode/i })).toBeInTheDocument();
  });
});
