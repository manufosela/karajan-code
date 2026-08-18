import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Badge } from "./Badge";

describe("Badge", () => {
  it("renders its children", () => {
    render(<Badge>Relevant</Badge>);

    expect(screen.getByText("Relevant")).toBeInTheDocument();
  });

  it("applies the default variant when none is given", () => {
    render(<Badge>Plain</Badge>);

    expect(screen.getByText("Plain").className).toContain("border");
  });

  it("merges a custom className", () => {
    render(<Badge className="custom-class">Styled</Badge>);

    expect(screen.getByText("Styled").className).toContain("custom-class");
  });

  describe("bucket variant", () => {
    it("renders a coloured dot alongside the label", () => {
      const { container } = render(
        <Badge variant="bucket" bucket="adopt">
          Adopt
        </Badge>
      );

      expect(container.querySelector(".bg-bucket-adopt")).not.toBeNull();
    });

    it("falls back to the default variant when no bucket is supplied", () => {
      const { container } = render(<Badge variant="bucket">No bucket</Badge>);

      expect(container.querySelector("span span")).toBeNull();
      expect(screen.getByText("No bucket")).toBeInTheDocument();
    });

    it("still renders an unknown bucket rather than breaking the row", () => {
      // Bucket ids come from the active Radar Profile, so the frontend meets
      // ids it has no palette for.
      render(
        <Badge variant="bucket" bucket="core_platform">
          Core platform
        </Badge>
      );

      expect(screen.getByText("Core platform")).toBeInTheDocument();
    });
  });

  describe("score variant", () => {
    it("applies the colour for the given score band", () => {
      render(
        <Badge variant="score" scoreColor="green">
          9.1
        </Badge>
      );

      expect(screen.getByText("9.1").className).toContain("emerald");
    });

    it("falls back to the default variant without a scoreColor", () => {
      render(<Badge variant="score">7.0</Badge>);

      expect(screen.getByText("7.0")).toBeInTheDocument();
    });
  });

  describe("status variant", () => {
    it("applies the colour for the given status", () => {
      render(
        <Badge variant="status" statusColor="orange">
          Follow up
        </Badge>
      );

      expect(screen.getByText("Follow up").className).toContain("orange");
    });

    it("falls back to the default variant without a statusColor", () => {
      render(<Badge variant="status">Pending</Badge>);

      expect(screen.getByText("Pending")).toBeInTheDocument();
    });
  });
});
