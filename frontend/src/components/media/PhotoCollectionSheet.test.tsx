import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PhotoCollectionSheet } from "./PhotoCollectionSheet";

vi.mock("./AuthenticatedMediaImage", () => ({
  AuthenticatedMediaImage: ({ path, alt }: { path?: string; alt: string }) => (
    <div role="img" aria-label={alt} data-path={path} />
  ),
}));

const items = [
  {
    assetId: "photo-one",
    fileName: "one.jpg",
    status: "ready",
    capturedAt: "2026-08-25T10:00:00.000Z",
    thumbnailUrl: "/api/files/thumb-one",
    shortCaption: "Two people walking beside a lake",
    location: { latitude: 40.12345, longitude: 44.54321 },
  },
  {
    assetId: "photo-two",
    fileName: "two.jpg",
    status: "processing",
  },
];

describe("PhotoCollectionSheet", () => {
  it("shows compact photo knowledge and canonical asset links", () => {
    render(
      <MemoryRouter>
        <PhotoCollectionSheet
          open
          onOpenChange={vi.fn()}
          title="Photos at this location"
          description="Near the lake"
          items={items}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Photos at this location")).toBeTruthy();
    expect(screen.getByText("Near the lake")).toBeTruthy();
    expect(screen.getByText("2 photos")).toBeTruthy();
    expect(
      screen.getByText("Two people walking beside a lake"),
    ).toBeTruthy();
    expect(screen.getByText("No visual description yet.")).toBeTruthy();
    expect(screen.getByText("40.12345, 44.54321")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Open one.jpg" }).getAttribute("href"),
    ).toBe("/media?assetId=photo-one");
    expect(
      screen.getByRole("img", { name: "one.jpg" }).getAttribute("data-path"),
    ).toBe("/api/files/thumb-one");
  });

  it("distinguishes a partial list and exposes incremental loading", () => {
    const onLoadMore = vi.fn();
    render(
      <MemoryRouter>
        <PhotoCollectionSheet
          open
          onOpenChange={vi.fn()}
          title="Timeline photos"
          items={items}
          total={12}
          hasMore
          onLoadMore={onLoadMore}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("2 of 12 photos")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Load more photos" }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("reports an indeterminate truncated collection honestly", () => {
    render(
      <MemoryRouter>
        <PhotoCollectionSheet
          open
          onOpenChange={vi.fn()}
          title="Photos at this location"
          items={items}
          total={items.length}
          hasMore
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Showing 2 photos")).toBeTruthy();
    expect(
      screen.getByText("Additional photos may be available in this view."),
    ).toBeTruthy();
  });
});
