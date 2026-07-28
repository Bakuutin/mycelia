import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TimeZoneSelect } from "./TimeZoneSelect";
import { useSettingsStore } from "@/stores/settingsStore";

describe("TimeZoneSelect", () => {
  beforeEach(() => {
    useSettingsStore.setState({ favoriteTimeZones: [] });
  });

  it("finds a time zone by city alias and returns the matched place", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onPlaceSelect = vi.fn();
    render(
      <TimeZoneSelect
        value="UTC"
        onChange={onChange}
        onPlaceSelect={onPlaceSelect}
      />,
    );

    await user.click(screen.getByRole("combobox"));
    await user.type(
      screen.getByPlaceholderText("Search city or time zone…"),
      "Metz",
    );
    await user.click(screen.getByText("Paris · Europe/Paris"));

    expect(onChange).toHaveBeenCalledWith("Europe/Paris");
    expect(onPlaceSelect).toHaveBeenCalledWith("Metz");
  });

  it("stores starred time zones as favorites", async () => {
    const user = userEvent.setup();
    render(<TimeZoneSelect value="UTC" onChange={() => {}} />);

    await user.click(screen.getByRole("combobox"));
    await user.type(
      screen.getByPlaceholderText("Search city or time zone…"),
      "Bangkok",
    );
    await user.click(screen.getByRole("button", {
      name: "Add Bangkok to favorites",
    }));

    expect(useSettingsStore.getState().favoriteTimeZones).toContain(
      "Asia/Bangkok",
    );
  });
});
