import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import * as userEventLib from "@testing-library/user-event";
import { ObjectId } from "bson";
import { ObjectSelectionDropdown } from "./ObjectSelectionDropdown";

const userEvent = (userEventLib as any).default || userEventLib;

let selectionObjects: any[] = [];
let selectedObject: any = undefined;

const createObjectMutation = {
  isPending: false,
  mutateAsync: vi.fn(),
};

vi.mock("@/hooks/useObjectQueries", () => ({
  useCreateObject: () => createObjectMutation,
  useObject: () => ({ data: selectedObject }),
  useObjectSelection: () => ({ data: selectionObjects }),
}));

vi.mock("@/components/ui/searchable-select-single", () => ({
  SearchableSelectSingle: ({
    options,
    onSearchChange,
    placeholder,
    emptyIndicator,
  }: {
    options: Array<{ label: string; value: string }>;
    onSearchChange?: (value: string) => void;
    placeholder?: string;
    emptyIndicator?: React.ReactNode | ((value: string) => React.ReactNode);
  }) => {
    const [search, setSearch] = React.useState("");
    const normalizedSearch = search.toLowerCase();
    const filteredOptions = normalizedSearch
      ? options.filter((option) =>
        option.label.toLowerCase().includes(normalizedSearch) ||
        option.value.toLowerCase().includes(normalizedSearch)
      )
      : options;

    return (
      <div>
        <input
          aria-label={placeholder ?? "Object selection"}
          value={search}
          onChange={(event) => {
            const nextValue = event.target.value;
            setSearch(nextValue);
            onSearchChange?.(nextValue);
          }}
        />
        {filteredOptions.length > 0
          ? (
            <ul>
              {filteredOptions.map((option) => (
                <li key={option.value}>{option.label}</li>
              ))}
            </ul>
          )
          : (
            <div>
              {typeof emptyIndicator === "function"
                ? emptyIndicator(search)
                : emptyIndicator}
            </div>
          )}
      </div>
    );
  },
}));

const renderDropdown = () =>
  render(
    <ObjectSelectionDropdown
      value=""
      onChange={vi.fn()}
      placeholder="Select target object..."
    />,
  );

describe("ObjectSelectionDropdown", () => {
  beforeEach(() => {
    selectionObjects = [
      {
        _id: new ObjectId("507f1f77bcf86cd799439011"),
        name: "Alpha Object",
        icon: { text: "🧠" },
      },
      {
        _id: new ObjectId("507f1f77bcf86cd799439012"),
        name: "Beta Object",
        icon: { text: "" },
      },
    ];
    selectedObject = undefined;
    createObjectMutation.mutateAsync.mockReset();
  });

  it("keeps matching objects visible while typing", async () => {
    const user = userEvent.setup();

    renderDropdown();

    await user.type(
      screen.getByLabelText(/select target object/i),
      "alp",
    );

    expect(screen.getByText("🧠 Alpha Object")).toBeInTheDocument();
    expect(screen.queryByText("Beta Object")).not.toBeInTheDocument();
    expect(screen.queryByText(/No objects found/i)).not.toBeInTheDocument();
  });

  it("does not show a create option when an exact object name already exists", async () => {
    const user = userEvent.setup();

    renderDropdown();

    await user.type(
      screen.getByLabelText(/select target object/i),
      "alpha object",
    );

    expect(screen.getByText("🧠 Alpha Object")).toBeInTheDocument();
    expect(screen.queryByText('➕ Create "alpha object"')).not.toBeInTheDocument();
  });
});
