import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import * as userEventLib from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ObjectId } from "bson";
import { RelationshipsPanel } from "./RelationshipsPanel";
import { TooltipProvider } from "@/components/ui/tooltip";

const userEvent = (userEventLib as any).default || userEventLib;
const createObjectMutation = {
  isPending: false,
  mutateAsync: vi.fn(),
};

vi.mock("@/hooks/useObjectQueries.ts", () => ({
  getRelationships: () => ({ data: [] }),
  useCreateObject: () => createObjectMutation,
  useDeleteObject: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useObjectReferenceCounts: () => ({
    data: { referencesTo: 1, referencesFrom: 2, total: 3 },
  }),
}));

vi.mock("@/components/ObjectSelectionDropdown", () => ({
  ObjectSelectionDropdown: ({
    onChange,
    placeholder,
  }: {
    onChange: (value: string) => void;
    placeholder?: string;
  }) => (
    <button type="button" onClick={() => onChange("507f1f77bcf86cd799439012")}>
      {placeholder}
    </button>
  ),
}));

vi.mock("@/components/ui/emoji-picker", () => ({
  EmojiPickerButton: () => <div>Emoji Picker</div>,
}));

vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: () => ({ timeFormat: "gregorian-local-natural" }),
}));

vi.mock("@/hooks/useNow", () => ({
  useNow: () => new Date("2026-03-19T12:00:00.000Z"),
}));

const renderRelationshipsPanel = () => {
  const object = {
    _id: new ObjectId("507f1f77bcf86cd799439011"),
    name: "Source Object",
  } as any;

  return render(
    <TooltipProvider>
      <MemoryRouter>
        <RelationshipsPanel object={object} />
      </MemoryRouter>
    </TooltipProvider>,
  );
};

describe("RelationshipsPanel", () => {
  beforeEach(() => {
    createObjectMutation.mutateAsync.mockReset();
    createObjectMutation.mutateAsync.mockResolvedValue({
      insertedId: new ObjectId("507f1f77bcf86cd799439099"),
    });
  });

  it("opens the create form in a dialog and closes it on cancel", async () => {
    const user = userEvent.setup();

    renderRelationshipsPanel();

    await user.click(screen.getByRole("button", { name: /create relationship/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("New Relationship")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^cancel$/i }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("submits from the dialog and resets the form after success", async () => {
    const user = userEvent.setup();

    renderRelationshipsPanel();

    await user.click(screen.getByRole("button", { name: /create relationship/i }));
    await user.type(screen.getByLabelText(/relationship name/i), "works with");
    await user.click(screen.getByRole("button", { name: /select target object/i }));
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => {
      expect(createObjectMutation.mutateAsync).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /create relationship/i }));
    expect(screen.getByLabelText(/relationship name/i)).toHaveValue("");
  });
});
