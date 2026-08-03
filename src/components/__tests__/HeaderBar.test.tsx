// @vitest-environment jsdom
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import HeaderBar from "../HeaderBar";

describe("HeaderBar Component Tests (C-7)", () => {
  it("should render correctly with default state", () => {
    render(<HeaderBar masterView="search" isBiophysicalLoading={false} isOffline={false} />);
    expect(screen.queryByText("Evidence")).not.toBeInTheDocument();
    expect(screen.queryByText("Computing…")).not.toBeInTheDocument();
    expect(screen.queryByText("OFFLINE")).not.toBeInTheDocument();
  });

  it("should display breadcrumb title when not on search view", () => {
    render(<HeaderBar masterView="evidence" isBiophysicalLoading={false} isOffline={false} />);
    expect(screen.getByText("Evidence")).toBeInTheDocument();
  });

  it("should render computing status when isBiophysicalLoading is true", () => {
    render(<HeaderBar masterView="evidence" isBiophysicalLoading={true} isOffline={false} />);
    expect(screen.getByText(/Computing/i)).toBeInTheDocument();
  });

  it("should display offline label when isOffline is true", () => {
    render(<HeaderBar masterView="evidence" isBiophysicalLoading={false} isOffline={true} />);
    expect(screen.getByText("OFFLINE")).toBeInTheDocument();
  });
});
