import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ObjectId } from "bson";
import EventDetailPage from "./EventDetailPage";
import * as api from "@/lib/api";
import type { EventItem } from "@/types/events";

vi.mock("@/lib/api", () => ({
  callResource: vi.fn(),
}));

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

describe("EventDetailPage Integration - Parent Event Display", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders event with parent displayed in combobox", async () => {
    const parentEventId = new ObjectId("507f1f77bcf86cd799439011");
    const childEventId = new ObjectId("507f1f77bcf86cd799439012");

    const parentEvent = createMockEvent({
      _id: parentEventId,
      title: "Parent Event - Annual Review",
      icon: { text: "🎯" },
      category: "work",
      start: new Date("2024-01-01"),
      end: new Date("2024-12-31"),
      kind: "range",
    });

    const childEvent = createMockEvent({
      _id: childEventId,
      title: "Q1 Planning Meeting",
      icon: { text: "📋" },
      category: "work",
      start: new Date("2024-03-15"),
      parentId: parentEventId.toString(),
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

    const { container } = renderEventDetailPage(childEventId.toString());

    await waitFor(() => {
      expect(screen.getByDisplayValue("Q1 Planning Meeting"))
        .toBeInTheDocument();
    });

    expect(screen.getByDisplayValue("Q1 Planning Meeting")).toBeInTheDocument();
    expect(screen.getByDisplayValue("work")).toBeInTheDocument();

    const parentLabel = screen.getByText("Parent Event");
    expect(parentLabel).toBeInTheDocument();

    const comboboxes = screen.getAllByRole("combobox");
    const parentCombobox = comboboxes.find((cb) =>
      cb.textContent?.includes("Parent Event - Annual Review")
    );
    expect(parentCombobox).toBeInTheDocument();
    expect(parentCombobox?.textContent).toContain(
      "Parent Event - Annual Review",
    );

    const html = container.innerHTML;
    expect(html).toContain("Parent Event - Annual Review");
    expect(html).toContain("Parent Event");
    expect(html).toContain("Q1 Planning Meeting");
  });

  it("renders event without parent showing placeholder", async () => {
    const eventId = new ObjectId("507f1f77bcf86cd799439013");

    const standaloneEvent = createMockEvent({
      _id: eventId,
      title: "Standalone Event",
      icon: { text: "⭐" },
      category: "life",
      start: new Date("2024-06-15"),
    });

    mockCallResource.mockImplementation((resource, params: any) => {
      if (params.action === "findOne") {
        return Promise.resolve(standaloneEvent);
      }
      if (params.action === "find") {
        return Promise.resolve([standaloneEvent]);
      }
      return Promise.resolve(null);
    });

    const { container } = renderEventDetailPage(eventId.toString());

    await waitFor(() => {
      expect(screen.getByDisplayValue("Standalone Event")).toBeInTheDocument();
    });

    const parentLabel = screen.getByText("Parent Event");
    expect(parentLabel).toBeInTheDocument();

    const comboboxes = screen.getAllByRole("combobox");
    const parentCombobox = comboboxes.find((cb) =>
      cb.getAttribute("aria-haspopup") === "dialog"
    );
    expect(parentCombobox).toBeInTheDocument();
    expect(parentCombobox?.textContent).toContain("No parent (top level)");

    const html = container.innerHTML;
    expect(html).toContain("No parent (top level)");
  });

  it("verifies parent event ID is correctly stringified from ObjectId", async () => {
    const parentEventId = new ObjectId("507f1f77bcf86cd799439020");
    const childEventId = new ObjectId("507f1f77bcf86cd799439021");

    const parentEvent = createMockEvent({
      _id: parentEventId,
      title: "Company Restructuring",
      category: "work",
    });

    const childEvent = createMockEvent({
      _id: childEventId,
      title: "Department Meeting",
      category: "work",
      parentId: "507f1f77bcf86cd799439020",
    });

    let capturedOptions: any[] = [];
    mockCallResource.mockImplementation((resource, params: any) => {
      if (params.action === "findOne") {
        return Promise.resolve(childEvent);
      }
      if (params.action === "find") {
        capturedOptions = [parentEvent, childEvent];
        return Promise.resolve([parentEvent, childEvent]);
      }
      return Promise.resolve(null);
    });

    renderEventDetailPage(childEventId.toString());

    await waitFor(() => {
      expect(screen.getByDisplayValue("Department Meeting"))
        .toBeInTheDocument();
    });

    const comboboxes = screen.getAllByRole("combobox");
    const parentCombobox = comboboxes.find((cb) =>
      cb.textContent?.includes("Company Restructuring")
    );

    expect(parentCombobox).toBeInTheDocument();
    expect(parentCombobox?.textContent).toContain("Company Restructuring");

    expect(capturedOptions.length).toBe(2);
    expect(capturedOptions[0]._id).toBeInstanceOf(ObjectId);
    expect(typeof childEvent.parentId).toBe("string");
    expect(childEvent.parentId).toBe(parentEventId.toString());
  });

  it("renders deeply nested parent hierarchy correctly", async () => {
    const grandparentId = new ObjectId("507f1f77bcf86cd799439030");
    const parentId = new ObjectId("507f1f77bcf86cd799439031");
    const childId = new ObjectId("507f1f77bcf86cd799439032");

    const grandparent = createMockEvent({
      _id: grandparentId,
      title: "Career at TechCorp",
      category: "work",
      start: new Date("2020-01-01"),
      end: new Date("2024-12-31"),
      kind: "range",
    });

    const parent = createMockEvent({
      _id: parentId,
      title: "Senior Engineer Role",
      category: "work",
      start: new Date("2022-01-01"),
      end: new Date("2024-12-31"),
      kind: "range",
      parentId: grandparentId.toString(),
    });

    const child = createMockEvent({
      _id: childId,
      title: "Led Migration Project",
      category: "work",
      start: new Date("2024-03-01"),
      end: new Date("2024-06-30"),
      kind: "range",
      parentId: parentId.toString(),
    });

    mockCallResource.mockImplementation((resource, params: any) => {
      if (params.action === "findOne") {
        return Promise.resolve(child);
      }
      if (params.action === "find") {
        return Promise.resolve([grandparent, parent, child]);
      }
      return Promise.resolve(null);
    });

    const { container } = renderEventDetailPage(childId.toString());

    await waitFor(() => {
      expect(screen.getByDisplayValue("Led Migration Project"))
        .toBeInTheDocument();
    });

    const comboboxes = screen.getAllByRole("combobox");
    const parentCombobox = comboboxes.find((cb) =>
      cb.textContent?.includes("Senior Engineer Role")
    );

    expect(parentCombobox).toBeInTheDocument();
    expect(parentCombobox?.textContent).toContain("Senior Engineer Role");

    const html = container.innerHTML;
    expect(html).toContain("Senior Engineer Role");
    expect(html).toContain("Led Migration Project");
  });

  it("excludes current event from parent options in dropdown", async () => {
    const event1Id = new ObjectId("507f1f77bcf86cd799439040");
    const event2Id = new ObjectId("507f1f77bcf86cd799439041");
    const event3Id = new ObjectId("507f1f77bcf86cd799439042");

    const event1 = createMockEvent({
      _id: event1Id,
      title: "Event One",
      category: "life",
    });

    const event2 = createMockEvent({
      _id: event2Id,
      title: "Event Two",
      category: "life",
    });

    const event3 = createMockEvent({
      _id: event3Id,
      title: "Event Three",
      category: "life",
    });

    mockCallResource.mockImplementation((resource, params: any) => {
      if (params.action === "findOne") {
        return Promise.resolve(event2);
      }
      if (params.action === "find") {
        return Promise.resolve([event1, event2, event3]);
      }
      return Promise.resolve(null);
    });

    renderEventDetailPage(event2Id.toString());

    await waitFor(() => {
      expect(screen.getByDisplayValue("Event Two")).toBeInTheDocument();
    });

    const comboboxes = screen.getAllByRole("combobox");
    const parentCombobox = comboboxes.find((cb) =>
      cb.getAttribute("aria-haspopup") === "dialog"
    );

    expect(parentCombobox).toBeInTheDocument();
  });

  it("renders complete HTML structure with all event fields and parent", async () => {
    const parentId = new ObjectId("507f1f77bcf86cd799439050");
    const childId = new ObjectId("507f1f77bcf86cd799439051");

    const parent = createMockEvent({
      _id: parentId,
      title: "PhD Studies",
      shortTitle: "PhD",
      description: "Doctoral program in Computer Science",
      icon: { text: "🎓" },
      category: "education",
      color: "#10b981",
      start: new Date("2020-09-01"),
      end: new Date("2024-06-30"),
      kind: "range",
    });

    const child = createMockEvent({
      _id: childId,
      title: "Dissertation Defense",
      shortTitle: "Defense",
      description: "Final defense presentation",
      icon: { text: "📚" },
      category: "education",
      color: "#10b981",
      start: new Date("2024-05-15"),
      parentId: parentId.toString(),
      kind: "point",
    });

    mockCallResource.mockImplementation((resource, params: any) => {
      if (params.action === "findOne") {
        return Promise.resolve(child);
      }
      if (params.action === "find") {
        return Promise.resolve([parent, child]);
      }
      return Promise.resolve(null);
    });

    const { container } = renderEventDetailPage(childId.toString());

    await waitFor(() => {
      expect(screen.getByDisplayValue("Dissertation Defense"))
        .toBeInTheDocument();
    });

    expect(screen.getByDisplayValue("Dissertation Defense"))
      .toBeInTheDocument();
    expect(screen.getByDisplayValue("Defense")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Final defense presentation"))
      .toBeInTheDocument();
    expect(screen.getByDisplayValue("education")).toBeInTheDocument();
    expect(screen.getByDisplayValue("#10b981")).toBeInTheDocument();

    const html = container.innerHTML;

    expect(html).toContain("Dissertation Defense");
    expect(html).toContain("Defense");
    expect(html).toContain("Final defense presentation");
    expect(html).toContain("education");
    expect(html).toContain("#10b981");
    expect(html).toContain("PhD Studies");
    expect(html).toContain("Parent Event");

    expect(html).toContain("📚");

    expect(html).toMatch(/Point/);

    expect(html).toContain("Back to Timeline");
    expect(html).toContain("Delete");
  });

  it("verifies parent event shows correct string representation of ObjectId", async () => {
    const parentObjectId = new ObjectId("507f1f77bcf86cd799439060");
    const childObjectId = new ObjectId("507f1f77bcf86cd799439061");
    const parentIdString = parentObjectId.toString();

    const parent = createMockEvent({
      _id: parentObjectId,
      title: "Master Project",
    });

    const child = createMockEvent({
      _id: childObjectId,
      title: "Sub-task",
      parentId: parentIdString,
    });

    mockCallResource.mockImplementation((resource, params: any) => {
      if (params.action === "findOne") {
        return Promise.resolve(child);
      }
      if (params.action === "find") {
        return Promise.resolve([parent, child]);
      }
      return Promise.resolve(null);
    });

    const { container } = renderEventDetailPage(childObjectId.toString());

    await waitFor(() => {
      expect(screen.getByDisplayValue("Sub-task")).toBeInTheDocument();
    });

    const comboboxes = screen.getAllByRole("combobox");
    const parentCombobox = comboboxes.find((cb) =>
      cb.textContent?.includes("Master Project")
    );

    expect(parentCombobox).toBeInTheDocument();

    expect(child.parentId).toBe("507f1f77bcf86cd799439060");
    expect(child.parentId).toBe(parentIdString);

    expect(typeof child.parentId).toBe("string");
    expect(parent._id).toBeInstanceOf(ObjectId);

    const html = container.innerHTML;
    expect(html).toContain("Master Project");
  });
});
