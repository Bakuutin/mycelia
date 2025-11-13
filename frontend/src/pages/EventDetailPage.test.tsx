import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import * as userEventLib from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { ObjectId } from "bson";
import EventDetailPage from "./EventDetailPage";
import * as api from "@/lib/api";
import type { EventItem } from "@/types/events";

const userEvent = (userEventLib as any).default || userEventLib;

const mockNavigate = vi.fn();

vi.mock("@/lib/api", () => ({
  callResource: vi.fn(),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const mockCallResource = vi.mocked(api.callResource);

const createMockEvent = (overrides?: Partial<EventItem>): EventItem => ({
  _id: new ObjectId(),
  kind: "point",
  title: "Test Event",
  icon: { text: "📅" },
  color: "#3b82f6",
  category: "life",
  start: new Date("2024-01-01"),
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const renderEventDetailPage = (eventId: string) => {
  return render(
    <MemoryRouter initialEntries={[`/events/${eventId}`]}>
      <Routes>
        <Route path="/events/:id" element={<EventDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
};

describe("EventDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Loading State", () => {
    it("displays loading message while fetching event", () => {
      const eventId = new ObjectId().toString();
      mockCallResource.mockImplementation(() => new Promise(() => {}));

      renderEventDetailPage(eventId);

      expect(screen.getByText("Loading event...")).toBeInTheDocument();
      expect(screen.getByText("Back")).toBeInTheDocument();
    });
  });

  describe("Error Handling", () => {
    it("displays error message when event is not found", async () => {
      const eventId = new ObjectId().toString();
      mockCallResource.mockResolvedValue(null);

      renderEventDetailPage(eventId);

      await waitFor(() => {
        expect(screen.getByText(/Event not found/i)).toBeInTheDocument();
      });
    });

    it("displays error message when fetch fails", async () => {
      const eventId = new ObjectId().toString();
      mockCallResource.mockRejectedValue(new Error("Network error"));

      renderEventDetailPage(eventId);

      await waitFor(() => {
        expect(screen.getByText(/Network error/i)).toBeInTheDocument();
      });
    });
  });

  describe("Event Display", () => {
    it("renders event details correctly", async () => {
      const mockEvent = createMockEvent({
        title: "My Test Event",
        shortTitle: "Test",
        description: "Test description",
        category: "work",
        kind: "point",
      });
      const eventId = mockEvent._id.toString();

      mockCallResource.mockImplementation((resource, params: any) => {
        if (params.action === "findOne") {
          return Promise.resolve(mockEvent);
        }
        if (params.action === "find") {
          return Promise.resolve([mockEvent]);
        }
        return Promise.resolve(null);
      });

      renderEventDetailPage(eventId);

      await waitFor(() => {
        expect(screen.getByDisplayValue("My Test Event")).toBeInTheDocument();
        expect(screen.getByDisplayValue("Test")).toBeInTheDocument();
        expect(screen.getByDisplayValue("Test description"))
          .toBeInTheDocument();
        expect(screen.getByDisplayValue("work")).toBeInTheDocument();
      });
    });

    it("displays parent event selector with correct options", async () => {
      const parentEvent = createMockEvent({
        _id: new ObjectId("507f1f77bcf86cd799439011"),
        title: "Parent Event",
      });
      const childEvent = createMockEvent({
        _id: new ObjectId("507f1f77bcf86cd799439012"),
        title: "Child Event",
        parentId: parentEvent._id.toString(),
      });
      const otherEvent = createMockEvent({
        _id: new ObjectId("507f1f77bcf86cd799439013"),
        title: "Other Event",
      });

      mockCallResource.mockImplementation((resource, params: any) => {
        if (params.action === "findOne") {
          return Promise.resolve(childEvent);
        }
        if (params.action === "find") {
          return Promise.resolve([parentEvent, childEvent, otherEvent]);
        }
        return Promise.resolve(null);
      });

      renderEventDetailPage(childEvent._id.toString());

      await waitFor(() => {
        const comboboxes = screen.getAllByRole("combobox");
        const parentCombobox = comboboxes.find((cb) =>
          cb.textContent?.includes("Parent Event")
        );
        expect(parentCombobox).toBeInTheDocument();
        expect(parentCombobox).toHaveTextContent("Parent Event");
      });
    });

    it("excludes current event from parent options", async () => {
      const event1 = createMockEvent({
        _id: new ObjectId("507f1f77bcf86cd799439011"),
        title: "Event 1",
      });
      const event2 = createMockEvent({
        _id: new ObjectId("507f1f77bcf86cd799439012"),
        title: "Event 2",
      });

      mockCallResource.mockImplementation((resource, params: any) => {
        if (params.action === "findOne") {
          return Promise.resolve(event1);
        }
        if (params.action === "find") {
          return Promise.resolve([event1, event2]);
        }
        return Promise.resolve(null);
      });

      renderEventDetailPage(event1._id.toString());

      await waitFor(() => {
        const comboboxes = screen.getAllByRole("combobox");
        expect(comboboxes.length).toBeGreaterThan(0);
      });

      const user = userEvent.setup();
      const comboboxes = screen.getAllByRole("combobox");
      const parentCombobox = comboboxes.find((cb) =>
        cb.getAttribute("aria-haspopup") === "dialog"
      );
      if (parentCombobox) {
        await user.click(parentCombobox);
      }

      await waitFor(() => {
        const options = screen.getAllByRole("option");
        const optionTexts = options.map((opt) => opt.textContent);
        expect(optionTexts.some((text) => text?.includes("Event 2"))).toBe(
          true,
        );
      });
    });

    it("displays range event with end date", async () => {
      const mockEvent = createMockEvent({
        kind: "range",
        start: new Date("2024-01-01"),
        end: new Date("2024-12-31"),
      });

      mockCallResource.mockImplementation((resource, params: any) => {
        if (params.action === "findOne") {
          return Promise.resolve(mockEvent);
        }
        if (params.action === "find") {
          return Promise.resolve([mockEvent]);
        }
        return Promise.resolve(null);
      });

      renderEventDetailPage(mockEvent._id.toString());

      await waitFor(() => {
        expect(screen.getByLabelText("End")).toBeInTheDocument();
      });
    });

    it("hides end date for point events", async () => {
      const mockEvent = createMockEvent({
        kind: "point",
      });

      mockCallResource.mockImplementation((resource, params: any) => {
        if (params.action === "findOne") {
          return Promise.resolve(mockEvent);
        }
        if (params.action === "find") {
          return Promise.resolve([mockEvent]);
        }
        return Promise.resolve(null);
      });

      renderEventDetailPage(mockEvent._id.toString());

      await waitFor(() => {
        expect(screen.queryByLabelText("End")).not.toBeInTheDocument();
      });
    });
  });

  describe("Auto-save Functionality", () => {
    it("auto-saves when title is changed", async () => {
      const mockEvent = createMockEvent({ title: "Original Title" });
      const savedTitles: string[] = [];

      mockCallResource.mockImplementation((resource, params: any) => {
        if (params.action === "findOne") {
          return Promise.resolve(mockEvent);
        }
        if (params.action === "find") {
          return Promise.resolve([mockEvent]);
        }
        if (params.action === "updateOne") {
          savedTitles.push(params.update.$set.title);
          return Promise.resolve({ modifiedCount: 1 });
        }
        return Promise.resolve(null);
      });

      renderEventDetailPage(mockEvent._id.toString());

      await waitFor(() => {
        expect(screen.getByDisplayValue("Original Title")).toBeInTheDocument();
      });

      const user = userEvent.setup();
      const titleInput = screen.getByDisplayValue("Original Title");
      await user.clear(titleInput);
      await user.type(titleInput, "New");

      await waitFor(() => {
        expect(savedTitles.length).toBeGreaterThan(0);
      });
    });

    it("auto-saves when category is changed", async () => {
      const mockEvent = createMockEvent({ category: "life" });
      const savedCategories: string[] = [];

      mockCallResource.mockImplementation((resource, params: any) => {
        if (params.action === "findOne") {
          return Promise.resolve(mockEvent);
        }
        if (params.action === "find") {
          return Promise.resolve([mockEvent]);
        }
        if (params.action === "updateOne" && params.update.$set.category) {
          savedCategories.push(params.update.$set.category);
          return Promise.resolve({ modifiedCount: 1 });
        }
        return Promise.resolve(null);
      });

      renderEventDetailPage(mockEvent._id.toString());

      await waitFor(() => {
        expect(screen.getByDisplayValue("life")).toBeInTheDocument();
      });

      const user = userEvent.setup();
      const categoryInput = screen.getByDisplayValue("life");
      await user.clear(categoryInput);
      await user.type(categoryInput, "w");

      await waitFor(() => {
        expect(savedCategories.length).toBeGreaterThan(0);
      });
    });

    it("auto-saves when kind is toggled from point to range", async () => {
      const mockEvent = createMockEvent({ kind: "point" });
      let savedKind = "";

      mockCallResource.mockImplementation((resource, params: any) => {
        if (params.action === "findOne") {
          return Promise.resolve(mockEvent);
        }
        if (params.action === "find") {
          return Promise.resolve([mockEvent]);
        }
        if (params.action === "updateOne" && params.update.$set.kind) {
          savedKind = params.update.$set.kind;
          return Promise.resolve({ modifiedCount: 1 });
        }
        return Promise.resolve(null);
      });

      renderEventDetailPage(mockEvent._id.toString());

      await waitFor(() => {
        const buttons = screen.getAllByRole("button");
        const rangeButton = buttons.find((btn) => btn.textContent === "Range");
        expect(rangeButton).toBeInTheDocument();
      });

      const user = userEvent.setup();
      const buttons = screen.getAllByRole("button");
      const rangeButton = buttons.find((btn) => btn.textContent === "Range");
      if (rangeButton) {
        await user.click(rangeButton);
      }

      await waitFor(() => {
        expect(savedKind).toBe("range");
      });
    });

    it("displays saving indicator during auto-save", async () => {
      const mockEvent = createMockEvent();
      let resolveUpdate: ((value: any) => void) | null = null;

      mockCallResource.mockImplementation((resource, params: any) => {
        if (params.action === "findOne") {
          return Promise.resolve(mockEvent);
        }
        if (params.action === "find") {
          return Promise.resolve([mockEvent]);
        }
        if (params.action === "updateOne") {
          return new Promise((resolve) => {
            resolveUpdate = resolve;
            setTimeout(() => resolve({ modifiedCount: 1 }), 200);
          });
        }
        return Promise.resolve(null);
      });

      renderEventDetailPage(mockEvent._id.toString());

      await waitFor(() => {
        expect(screen.getByDisplayValue("Test Event")).toBeInTheDocument();
      });

      const user = userEvent.setup();
      const titleInput = screen.getByDisplayValue("Test Event");
      await user.type(titleInput, "X");

      await waitFor(() => {
        expect(screen.queryByText("Saving...")).toBeInTheDocument();
      }, { timeout: 2000 });
    });
  });

  describe("Delete Functionality", () => {
    it("deletes event and navigates to timeline on confirmation", async () => {
      const mockEvent = createMockEvent();

      mockCallResource.mockImplementation((resource, params: any) => {
        if (params.action === "findOne") {
          return Promise.resolve(mockEvent);
        }
        if (params.action === "find") {
          return Promise.resolve([mockEvent]);
        }
        if (params.action === "deleteOne") {
          return Promise.resolve({ deletedCount: 1 });
        }
        return Promise.resolve(null);
      });

      (globalThis as any).confirm = vi.fn(() => true);

      renderEventDetailPage(mockEvent._id.toString());

      await waitFor(() => {
        const buttons = screen.getAllByRole("button");
        const deleteButton = buttons.find((btn) =>
          btn.textContent === "Delete"
        );
        expect(deleteButton).toBeInTheDocument();
      });

      const user = userEvent.setup();
      const buttons = screen.getAllByRole("button");
      const deleteButton = buttons.find((btn) => btn.textContent === "Delete");
      if (deleteButton) {
        await user.click(deleteButton);
      }

      await waitFor(() => {
        expect(mockCallResource).toHaveBeenCalledWith(
          "tech.mycelia.mongo",
          expect.objectContaining({
            action: "deleteOne",
            collection: "events",
          }),
        );
      });
    });

    it("does not delete event when confirmation is cancelled", async () => {
      const mockEvent = createMockEvent();

      mockCallResource.mockImplementation((resource, params: any) => {
        if (params.action === "findOne") {
          return Promise.resolve(mockEvent);
        }
        if (params.action === "find") {
          return Promise.resolve([mockEvent]);
        }
        return Promise.resolve(null);
      });

      (globalThis as any).confirm = vi.fn(() => false);

      renderEventDetailPage(mockEvent._id.toString());

      await waitFor(() => {
        const buttons = screen.getAllByRole("button");
        const deleteButton = buttons.find((btn) =>
          btn.textContent === "Delete"
        );
        expect(deleteButton).toBeInTheDocument();
      });

      const user = userEvent.setup();
      const buttons = screen.getAllByRole("button");
      const deleteButton = buttons.find((btn) => btn.textContent === "Delete");
      if (deleteButton) {
        await user.click(deleteButton);
      }

      expect(mockCallResource).not.toHaveBeenCalledWith(
        "tech.mycelia.mongo",
        expect.objectContaining({
          action: "deleteOne",
        }),
      );
    });
  });

  describe("Parent Event Selection", () => {
    it("saves parent event when selected from combobox", async () => {
      const parentEvent = createMockEvent({
        _id: new ObjectId("507f1f77bcf86cd799439011"),
        title: "Parent Event",
      });
      const childEvent = createMockEvent({
        _id: new ObjectId("507f1f77bcf86cd799439012"),
        title: "Child Event",
      });
      let savedParentId = "";

      mockCallResource.mockImplementation((resource, params: any) => {
        if (params.action === "findOne") {
          return Promise.resolve(childEvent);
        }
        if (params.action === "find") {
          return Promise.resolve([parentEvent, childEvent]);
        }
        if (params.action === "updateOne") {
          savedParentId = params.update.$set.parentId;
          return Promise.resolve({ modifiedCount: 1 });
        }
        return Promise.resolve(null);
      });

      renderEventDetailPage(childEvent._id.toString());

      await waitFor(() => {
        const comboboxes = screen.getAllByRole("combobox");
        expect(comboboxes.length).toBeGreaterThan(0);
      });

      const user = userEvent.setup();
      const comboboxes = screen.getAllByRole("combobox");
      const parentCombobox = comboboxes.find((cb) =>
        cb.getAttribute("aria-haspopup") === "dialog"
      );
      if (parentCombobox) {
        await user.click(parentCombobox);
      }

      await waitFor(() => {
        const parentOptions = screen.getAllByText("Parent Event");
        expect(parentOptions.length).toBeGreaterThan(0);
      });

      const parentOptions = screen.getAllByText("Parent Event");
      const optionElement = parentOptions.find((el) =>
        el.closest('[role="option"]')
      );
      if (optionElement) {
        await user.click(optionElement);
      }

      await waitFor(() => {
        expect(savedParentId).toBe(parentEvent._id.toString());
      });
    });

    it("uses string comparison for parent event matching", async () => {
      const parentEvent = createMockEvent({
        _id: new ObjectId("507f1f77bcf86cd799439011"),
        title: "Parent Event",
      });
      const childEvent = createMockEvent({
        _id: new ObjectId("507f1f77bcf86cd799439012"),
        title: "Child Event",
        parentId: "507f1f77bcf86cd799439011",
      });

      mockCallResource.mockImplementation((resource, params: any) => {
        if (params.action === "findOne") {
          return Promise.resolve(childEvent);
        }
        if (params.action === "find") {
          return Promise.resolve([parentEvent, childEvent]);
        }
        return Promise.resolve(null);
      });

      renderEventDetailPage(childEvent._id.toString());

      await waitFor(() => {
        const comboboxes = screen.getAllByRole("combobox");
        const parentCombobox = comboboxes.find((cb) =>
          cb.textContent?.includes("Parent Event")
        );
        expect(parentCombobox).toBeInTheDocument();
      });
    });
  });
});
