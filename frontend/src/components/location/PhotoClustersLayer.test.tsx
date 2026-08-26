import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  PhotoClustersLayer,
  shouldOpenPhotoCluster,
} from "./PhotoClustersLayer";

const mocks = vi.hoisted(() => ({
  zoom: 18,
  maxZoom: 18,
  fitBounds: vi.fn(),
  callResource: vi.fn(),
  toastError: vi.fn(),
  toastDismiss: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ callResource: mocks.callResource }));
vi.mock("sonner", () => ({
  toast: {
    error: mocks.toastError,
    dismiss: mocks.toastDismiss,
  },
}));
vi.mock("react-leaflet", () => ({
  useMap: () => ({
    getBounds: () => ({
      getWest: () => 44,
      getSouth: () => 40,
      getEast: () => 45,
      getNorth: () => 41,
    }),
    getZoom: () => mocks.zoom,
    getMaxZoom: () => mocks.maxZoom,
    fitBounds: mocks.fitBounds,
    latLngToContainerPoint: () => ({ x: 100, y: 100 }),
  }),
  useMapEvents: vi.fn(),
  Marker: forwardRef((props: any, ref) => {
    const elementRef = useRef<HTMLButtonElement | null>(null);
    const marker = useMemo(() => ({
      getElement: () => elementRef.current,
      on: vi.fn(),
      off: vi.fn(),
    }), []);
    useImperativeHandle(ref, () => marker, [marker]);
    const activate = () => props.eventHandlers?.click?.({ target: marker });
    return (
      <button
        ref={elementRef}
        type="button"
        data-marker={props.alt}
        data-keyboard={String(Boolean(props.keyboard))}
        title={props.title}
        onClick={activate}
        onKeyDown={(event) => {
          props.eventHandlers?.keydown?.({
            target: marker,
            originalEvent: event,
          });
        }}
      >
        📷 2
      </button>
    );
  }),
}));
vi.mock("@/components/media/PhotoCollectionSheet", () => ({
  PhotoCollectionSheet: (props: any) =>
    props.open
      ? (
        <section aria-label={props.title}>
          <div>{props.description}</div>
          {props.items.map((item: any) => (
            <div key={item.assetId}>{item.shortCaption ?? item.fileName}</div>
          ))}
          {props.hasMore && (
            <div>Additional photos may be available in this view.</div>
          )}
          <button type="button" onClick={() => props.onOpenChange(false)}>
            Close photo list
          </button>
        </section>
      )
      : null,
}));

const points = [
  {
    assetId: "photo-one",
    fileName: "one.jpg",
    status: "ready",
    capturedAt: "2026-08-25T10:00:00.000Z",
    thumbnailUrl: "/api/files/one",
    shortCaption: "A person beside a lake",
    latitude: 40.1,
    longitude: 44.5,
  },
  {
    assetId: "photo-two",
    fileName: "two.jpg",
    status: "processing",
    capturedAt: "2026-08-25T10:01:00.000Z",
    shortCaption: "A nearby mountain path",
    latitude: 40.1001,
    longitude: 44.5001,
  },
];

async function renderLayer(options?: { truncated?: boolean }) {
  mocks.callResource.mockResolvedValueOnce({
    points,
    totalPlaced: points.length,
    unplacedLocationCount: 0,
    truncated: options?.truncated ?? false,
  });
  render(<PhotoClustersLayer />);
  return await screen.findByRole("button", {
    name: /2 photos near this location/i,
  });
}

describe("PhotoClustersLayer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.zoom = 18;
    mocks.maxZoom = 18;
  });

  it("zooms a merged low-zoom marker to its bounded cluster", async () => {
    mocks.zoom = 12;
    mocks.maxZoom = 18;
    mocks.fitBounds.mockClear();
    const marker = await renderLayer();
    await waitFor(() => expect(mocks.fitBounds).toHaveBeenCalled());
    mocks.fitBounds.mockClear();

    expect(marker.getAttribute("data-keyboard")).toBe("true");
    expect(marker.getAttribute("aria-label")).toContain(
      "2 photos near this location",
    );
    expect(marker.getAttribute("title")).toContain(
      "Zoom in to separate photos",
    );
    fireEvent.click(marker);

    expect(mocks.fitBounds).toHaveBeenCalledTimes(1);
    expect(mocks.fitBounds.mock.calls[0][1]).toMatchObject({
      maxZoom: 16,
      padding: [48, 48],
    });
    expect(screen.queryByLabelText(/photos at this location/i)).toBeNull();
  });

  it("opens a close cluster with mouse, Space, and Enter and restores focus", async () => {
    mocks.zoom = 18;
    mocks.maxZoom = 18;
    mocks.fitBounds.mockClear();
    const marker = await renderLayer();
    await waitFor(() => expect(mocks.fitBounds).toHaveBeenCalled());
    mocks.fitBounds.mockClear();

    fireEvent.keyDown(marker, { key: " " });
    expect(
      screen.getByLabelText("2 photos at this location"),
    ).toBeTruthy();
    expect(screen.getByText("A person beside a lake")).toBeTruthy();
    expect(screen.getByText("A nearby mountain path")).toBeTruthy();
    expect(mocks.fitBounds).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Close photo list" }));
    await waitFor(() => expect(document.activeElement).toBe(marker));
    fireEvent.keyDown(marker, { key: "Enter" });
    expect(
      screen.getByLabelText("2 photos at this location"),
    ).toBeTruthy();
  });

  it("warns when the bounded viewport response is truncated", async () => {
    mocks.zoom = 18;
    mocks.maxZoom = 18;
    const marker = await renderLayer({ truncated: true });
    fireEvent.click(marker);

    expect(screen.getByLabelText("Photos at this location")).toBeTruthy();
    expect(
      screen.getByText(/Showing the latest loaded photos near/i),
    ).toBeTruthy();
    expect(
      screen.getByText("Additional photos may be available in this view."),
    ).toBeTruthy();
  });

  it("catches viewport errors and exposes a retry action", async () => {
    mocks.zoom = 18;
    mocks.callResource.mockRejectedValueOnce(new Error("Map request failed"));
    render(<PhotoClustersLayer />);

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledTimes(1));
    const options = mocks.toastError.mock.calls[0][1];
    expect(options).toMatchObject({
      id: "photo-map-load-error",
      description: "Map request failed",
      action: { label: "Retry" },
    });

    mocks.callResource.mockResolvedValueOnce({
      points: [],
      totalPlaced: 0,
      unplacedLocationCount: 0,
      truncated: false,
    });
    options.action.onClick();
    await waitFor(() => expect(mocks.callResource).toHaveBeenCalledTimes(2));
  });
});

describe("shouldOpenPhotoCluster", () => {
  it("opens singles and terminal clusters but keeps distant clusters zoomable", () => {
    expect(shouldOpenPhotoCluster(1, 2, 18)).toBe(true);
    expect(shouldOpenPhotoCluster(2, 12, 18)).toBe(false);
    expect(shouldOpenPhotoCluster(2, 16, 18)).toBe(true);
    expect(shouldOpenPhotoCluster(2, 15, 15)).toBe(true);
  });
});
