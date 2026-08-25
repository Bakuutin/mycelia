import { render, screen } from "@testing-library/react";
import * as userEventLib from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DateRangePicker } from "./DateRangePicker";

const userEvent = (userEventLib as any).default || userEventLib;

describe("DateRangePicker", () => {
  it("uses one range trigger with month and year dropdowns", async () => {
    const user = userEvent.setup();
    const view = render(
      <DateRangePicker
        label="Audio range"
        value={{
          start: new Date("2026-08-24T00:41:00.000Z"),
          end: new Date("2026-08-25T00:41:00.000Z"),
        }}
        onChange={vi.fn()}
        timeZone="Asia/Yerevan"
      />,
    );

    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(view.container.querySelector('input[type="date"]')).toBeNull();

    await user.click(screen.getByRole("button"));

    expect(screen.getByText("Exact time")).not.toBeNull();
    expect(screen.getAllByRole("combobox").length).toBeGreaterThanOrEqual(2);
    const timeInputs = document.querySelectorAll('input[type="time"]');
    expect(timeInputs).toHaveLength(2);
    expect(timeInputs[0]?.getAttribute("step")).toBe("60");
    expect(screen.queryByText("End date")).toBeNull();
  });

  it("keeps seconds opt-in for precision workflows", async () => {
    const user = userEvent.setup();
    render(
      <DateRangePicker
        value={{
          start: new Date("2026-08-24T00:41:38.000Z"),
          end: new Date("2026-08-25T00:41:38.000Z"),
        }}
        onChange={vi.fn()}
        precision="second"
        timeZone="Asia/Yerevan"
      />,
    );

    await user.click(screen.getByRole("button"));

    const timeInputs = document.querySelectorAll('input[type="time"]');
    expect(timeInputs[0]?.getAttribute("step")).toBe("1");
    expect((timeInputs[0] as HTMLInputElement).value).toBe("04:41:38");
  });
});
