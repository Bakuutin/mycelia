import { StrictMode } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { callResourceMock } = vi.hoisted(() => ({
  callResourceMock: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ callResource: callResourceMock }));
vi.mock("@/hooks/useObjectQueries", () => ({
  useDuplicateGroups: () => ({ data: [], isLoading: false }),
}));
vi.mock("@/hooks/useTagQueries", () => ({
  useAllTags: () => ({ data: [] }),
}));
vi.mock("@/components/dialogs/MergeObjectDialog", () => ({
  MergeObjectDialog: () => null,
}));

import ObjectsPage from "./ObjectsPage";

class ImmediateIntersectionObserver {
  static readonly instances = new Set<ImmediateIntersectionObserver>();
  private readonly observed = new Set<Element>();

  constructor(private readonly callback: IntersectionObserverCallback) {
    ImmediateIntersectionObserver.instances.add(this);
  }

  observe = vi.fn((target: Element) => {
    this.observed.add(target);
    queueMicrotask(() => {
      this.notifyTarget(target);
    });
  });
  unobserve = vi.fn((target: Element) => this.observed.delete(target));
  disconnect = vi.fn(() => {
    this.observed.clear();
    ImmediateIntersectionObserver.instances.delete(this);
  });
  takeRecords = () => [];
  root = null;
  rootMargin = "400px 0px";
  thresholds = [0];

  notifyVisible() {
    for (const target of this.observed) this.notifyTarget(target);
  }

  private notifyTarget(target: Element) {
    this.callback(
      [{ target, isIntersecting: true } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

function counts(overrides: Record<string, number> = {}) {
  return {
    person: 0,
    event: 0,
    relationship: 0,
    promise: 0,
    conversation: 0,
    tag: 0,
    place: 0,
    organization: 0,
    product: 0,
    project: 0,
    animal: 0,
    concept: 0,
    media: 0,
    other: 0,
    orphaned: 0,
    ...overrides,
  };
}

describe("ObjectsPage bounded card loading", () => {
  beforeEach(() => {
    callResourceMock.mockReset();
    ImmediateIntersectionObserver.instances.clear();
    globalThis.IntersectionObserver =
      ImmediateIntersectionObserver as unknown as typeof IntersectionObserver;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("uses listCards and never starts more than two visible sections concurrently", async () => {
    callResourceMock.mockImplementation((resource, body, options) => {
      if (body.action === "getCounts") {
        return Promise.resolve(
          counts({ conversation: 1, person: 1, event: 1 }),
        );
      }
      if (body.action === "listCards") {
        return new Promise((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      }
      return Promise.resolve({});
    });

    render(
      <StrictMode>
        <MemoryRouter>
          <ObjectsPage />
        </MemoryRouter>
      </StrictMode>,
    );

    await waitFor(() => {
      const listCalls = callResourceMock.mock.calls.filter(([, body]) =>
        body.action === "listCards"
      );
      expect(listCalls).toHaveLength(2);
    });

    const listCalls = callResourceMock.mock.calls.filter(([, body]) =>
      body.action === "listCards"
    );
    expect(new Set(listCalls.map(([, body]) => body.section)).size).toBe(2);
    expect(listCalls.every(([resource]) => resource === "objects")).toBe(true);
    expect(
      callResourceMock.mock.calls.some(([resource]) => resource === "mongo"),
    ).toBe(false);
    expect(
      listCalls.every(([, , options]) =>
        options?.signal instanceof AbortSignal
      ),
    ).toBe(true);
    expect(
      listCalls.find(([, body]) => body.section === "starred")?.[1].limit,
    ).toBe(9);
  });

  it("keeps a failed visible section idle until Retry is clicked", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let personCalls = 0;
    callResourceMock.mockImplementation((_resource, body) => {
      if (body.action === "getCounts") {
        return Promise.resolve(counts({ person: 1 }));
      }
      if (body.action === "listTagOptions" || body.section === "starred") {
        return Promise.resolve({ items: [], nextCursor: null, hasMore: false });
      }
      if (body.action === "listCards" && body.section === "person") {
        personCalls++;
        if (personCalls === 1) {
          return Promise.reject(new Error("temporary failure"));
        }
        return Promise.resolve({
          items: [{ _id: "person-1", name: "Ada", isPerson: true }],
          nextCursor: null,
          hasMore: false,
        });
      }
      return Promise.resolve({ items: [], nextCursor: null, hasMore: false });
    });

    const view = render(
      <MemoryRouter>
        <ObjectsPage />
      </MemoryRouter>,
    );

    await screen.findByText("Could not load people.");
    view.rerender(
      <MemoryRouter>
        <ObjectsPage />
      </MemoryRouter>,
    );
    await act(async () => {
      for (const observer of ImmediateIntersectionObserver.instances) {
        observer.notifyVisible();
      }
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(personCalls).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("Ada");
    expect(personCalls).toBe(2);
  });

  it("appends a 30-item cursor page instead of refetching the prefix", async () => {
    callResourceMock.mockImplementation((_resource, body) => {
      if (body.action === "getCounts") {
        return Promise.resolve(counts({ person: 31 }));
      }
      if (body.section === "starred") {
        return Promise.resolve({ items: [], nextCursor: null, hasMore: false });
      }
      if (body.section === "person" && !body.cursor) {
        return Promise.resolve({
          items: [{ _id: "person-1", name: "Ada", isPerson: true }],
          nextCursor: "opaque-next",
          hasMore: true,
        });
      }
      if (body.section === "person" && body.cursor === "opaque-next") {
        return Promise.resolve({
          items: [{ _id: "person-2", name: "Grace", isPerson: true }],
          nextCursor: null,
          hasMore: false,
        });
      }
      return Promise.resolve({ items: [], nextCursor: null, hasMore: false });
    });

    render(
      <MemoryRouter>
        <ObjectsPage />
      </MemoryRouter>,
    );

    const loadMore = await screen.findByRole(
      "button",
      { name: "Load more" },
      { timeout: 3_000 },
    );
    fireEvent.click(loadMore);

    await screen.findByText("Grace");
    const personCalls = callResourceMock.mock.calls.filter(([, body]) =>
      body.section === "person"
    );
    expect(personCalls).toHaveLength(2);
    expect(personCalls[1][1]).toEqual(expect.objectContaining({
      cursor: "opaque-next",
      limit: 30,
    }));
    expect(screen.getByText("Ada")).toBeInTheDocument();
  });

  it("keeps an empty bounded orphan page navigable", async () => {
    callResourceMock.mockImplementation((_resource, body) => {
      if (body.action === "getCounts") {
        return Promise.resolve(counts({ person: 46, orphaned: 1 }));
      }
      if (body.action === "listTagOptions" || body.section === "starred") {
        return Promise.resolve({ items: [], nextCursor: null, hasMore: false });
      }
      if (body.section === "person" && !body.cursor) {
        return Promise.resolve({
          items: [],
          nextCursor: "after-linked-candidates",
          hasMore: true,
        });
      }
      if (
        body.section === "person" &&
        body.cursor === "after-linked-candidates"
      ) {
        return Promise.resolve({
          items: [{ _id: "orphan-46", name: "Lonely", isPerson: true }],
          nextCursor: null,
          hasMore: false,
        });
      }
      return Promise.resolve({ items: [], nextCursor: null, hasMore: false });
    });

    render(
      <MemoryRouter initialEntries={["/objects?orphaned=true"]}>
        <ObjectsPage />
      </MemoryRouter>,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Continue searching" }),
    );
    await screen.findByText("Lonely");
    expect(
      callResourceMock.mock.calls.find(([, body]) =>
        body.cursor === "after-linked-candidates"
      )?.[1],
    ).toEqual(expect.objectContaining({ limit: 30 }));
  });

  it("polls a refreshing orphan count with bounded backoff until it is fresh", async () => {
    const timers: Array<{ callback: () => unknown; delay: number }> = [];
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout").mockImplementation(
      (
        callback: TimerHandler,
        delay?: number,
      ) => {
        if (typeof callback === "function") {
          timers.push({
            callback: callback as () => unknown,
            delay: Number(delay ?? 0),
          });
        }
        return timers.length;
      },
    );
    let getCountsCalls = 0;
    callResourceMock.mockImplementation((_resource, body) => {
      if (body.action === "getCounts") {
        getCountsCalls++;
        if (getCountsCalls <= 2) {
          return Promise.resolve({
            ...counts(),
            orphaned: null,
            orphanedLoading: true,
            meta: { orphaned: { status: "refreshing", asOf: null } },
          });
        }
        return Promise.resolve({
          ...counts(),
          orphaned: 7,
          orphanedLoading: false,
          meta: { orphaned: { status: "fresh", asOf: new Date() } },
        });
      }
      if (body.action === "listTagOptions" || body.action === "listCards") {
        return Promise.resolve({ items: [], nextCursor: null, hasMore: false });
      }
      return Promise.resolve({});
    });

    const { unmount } = render(
      <MemoryRouter>
        <ObjectsPage />
      </MemoryRouter>,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getCountsCalls).toBe(1);

    await act(async () => {
      const timer = timers.find((candidate) => candidate.delay === 2_000);
      expect(timer).toBeDefined();
      await timer?.callback();
    });
    expect(getCountsCalls).toBe(2);

    await act(async () => {
      const timer = timers.find((candidate) => candidate.delay === 4_000);
      expect(timer).toBeDefined();
      await timer?.callback();
    });
    expect(getCountsCalls).toBe(3);
    expect(screen.getByText("7")).toBeInTheDocument();

    const calls = callResourceMock.mock.calls.filter(([, body]) =>
      body.action === "getCounts"
    );
    expect(calls).toHaveLength(3);
    expect(calls.every(([, body]) => body.forceRefresh === false)).toBe(true);
    expect(
      calls.slice(1).every(([, , options]) =>
        options?.signal instanceof AbortSignal
      ),
    ).toBe(true);
    expect(timers.some((candidate) => candidate.delay === 8_000)).toBe(false);
    setTimeoutSpy.mockRestore();
    unmount();
  });

  it("aborts an in-flight orphan-count poll when the page unmounts", async () => {
    vi.useFakeTimers();
    let getCountsCalls = 0;
    let pollSignal: AbortSignal | undefined;
    callResourceMock.mockImplementation((_resource, body, options) => {
      if (body.action === "getCounts") {
        getCountsCalls++;
        if (getCountsCalls === 1) {
          return Promise.resolve({
            ...counts(),
            orphaned: null,
            orphanedLoading: true,
            meta: { orphaned: { status: "refreshing", asOf: null } },
          });
        }
        pollSignal = options?.signal;
        return new Promise((_resolve, reject) => {
          pollSignal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      }
      return Promise.resolve({ items: [], nextCursor: null, hasMore: false });
    });

    const { unmount } = render(
      <MemoryRouter>
        <ObjectsPage />
      </MemoryRouter>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(pollSignal).toBeInstanceOf(AbortSignal);

    unmount();
    expect(pollSignal?.aborted).toBe(true);
  });
});
