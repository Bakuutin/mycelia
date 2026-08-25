import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Slider } from "./slider";

describe("Slider", () => {
  it("renders one accessible thumb for each controlled value", () => {
    render(
      <Slider
        min={0}
        max={100}
        value={[20, 80]}
        thumbLabels={["Range start", "Range end"]}
      />,
    );

    expect(screen.getAllByRole("slider")).toHaveLength(2);
    expect(screen.getByRole("slider", { name: "Range start" })).not.toBeNull();
    expect(screen.getByRole("slider", { name: "Range end" })).not.toBeNull();
  });
});
