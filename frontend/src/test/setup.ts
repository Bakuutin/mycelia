import "@testing-library/jest-dom";
import { afterEach, expect, vi } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});

(globalThis as any).confirm = vi.fn(() => true);

const rootWindow = globalThis.window ?? globalThis;

Object.defineProperty(rootWindow, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

(globalThis as any).ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

if (typeof Element !== "undefined") {
  Element.prototype.scrollIntoView = vi.fn();
}
