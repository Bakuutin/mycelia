import { render, screen } from "@testing-library/react";
import * as userEventLib from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DateRangePicker } from "./DateRangePicker";

const userEvent = (userEventLib as any).default || userEventLib;

describe("DateRangePicker", () => {
  it("keeps navigation and scrollable month/year dropdowns inside the dialog", async () => {
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

    expect(screen.getByRole("dialog", { name: "Audio range" })).not.toBeNull();
    expect(screen.getByText("Exact time")).not.toBeNull();
    expect(screen.getAllByRole("combobox").length).toBeGreaterThanOrEqual(2);
    const scrollContainer = view.container.ownerDocument.querySelector(
      '[data-slot="date-range-picker-scroll"]',
    ) as HTMLDivElement;
    expect(scrollContainer.className).toContain("overflow-y-auto");

    const month = screen.getByRole("combobox", { name: "Choose the Month" });
    expect(month.textContent).toContain("Aug");
    await user.click(screen.getByRole("button", {
      name: "Go to the Next Month",
    }));
    expect(month.textContent).toContain("Sep");

    const year = screen.getByRole("combobox", { name: "Choose the Year" });
    await user.click(year);
    await user.click(screen.getByRole("option", { name: "2025" }));
    expect(year.textContent).toContain("2025");
    expect(screen.getByRole("dialog", { name: "Audio range" })).not.toBeNull();

    const timeInputs = document.querySelectorAll('input[type="time"]');
    expect(timeInputs).toHaveLength(2);
    expect(timeInputs[0]?.getAttribute("step")).toBe("60");
    expect(screen.queryByText("End date")).toBeNull();

    scrollContainer.scrollTop = 120;
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(view.container.querySelector("button")!);
    expect(
      view.container.ownerDocument.querySelector<HTMLDivElement>(
        '[data-slot="date-range-picker-scroll"]',
      )?.scrollTop,
    ).toBe(0);
  });

  it("edits the explicitly selected Start or End boundary", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <DateRangePicker
        label="Audio range"
        value={{
          start: new Date("2026-08-24T00:41:00.000Z"),
          end: new Date("2026-08-25T00:41:00.000Z"),
        }}
        onChange={onChange}
        timeZone="Asia/Yerevan"
      />,
    );

    await user.click(screen.getByRole("button"));
    const start = screen.getByRole("button", { name: /^Start / });
    const end = screen.getByRole("button", { name: /^End / });
    expect(start.getAttribute("aria-pressed")).toBe("true");

    await user.click(start);
    await user.click(screen.getByRole("button", {
      name: /Sunday, August 23rd, 2026/,
    }));
    expect(start.textContent).toContain("Aug 23, 2026");
    expect(end.getAttribute("aria-pressed")).toBe("true");

    await user.click(end);
    await user.click(screen.getByRole("button", {
      name: /Sunday, August 30th, 2026/,
    }));
    expect(end.textContent).toContain("Aug 30, 2026");

    await user.click(screen.getByRole("button", { name: "Apply range" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].start.toISOString()).toBe(
      "2026-08-23T00:41:00.000Z",
    );
    expect(onChange.mock.calls[0][0].end.toISOString()).toBe(
      "2026-08-30T00:41:00.000Z",
    );
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
