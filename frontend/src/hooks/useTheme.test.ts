import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useTheme } from "./useTheme";
import { useSettingsStore } from "@/stores/settingsStore";

describe("useTheme", () => {
  beforeEach(() => {
    useSettingsStore.setState({ theme: "light" });
    document.documentElement.classList.remove("light", "dark");
  });

  it("returns current theme and setTheme function", () => {
    const { result } = renderHook(() => useTheme());

    expect(result.current.theme).toBe("light");
    expect(typeof result.current.setTheme).toBe("function");
  });

  it("applies light theme class to document root", () => {
    useSettingsStore.setState({ theme: "light" });
    renderHook(() => useTheme());

    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("applies dark theme class to document root", () => {
    useSettingsStore.setState({ theme: "dark" });
    renderHook(() => useTheme());

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("light")).toBe(false);
  });

  it("applies system theme based on media query", () => {
    const matchMediaMock = vi.fn().mockImplementation((query) => ({
      matches: query === "(prefers-color-scheme: dark)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    window.matchMedia = matchMediaMock;

    useSettingsStore.setState({ theme: "system" });
    renderHook(() => useTheme());

    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("changes theme when setTheme is called", () => {
    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.setTheme("dark");
    });

    expect(result.current.theme).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("light")).toBe(false);
  });

  it("removes previous theme class when changing theme", () => {
    useSettingsStore.setState({ theme: "light" });
    const { rerender } = renderHook(() => useTheme());

    expect(document.documentElement.classList.contains("light")).toBe(true);

    act(() => {
      useSettingsStore.setState({ theme: "dark" });
    });
    rerender();

    expect(document.documentElement.classList.contains("light")).toBe(false);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("updates theme when store changes", () => {
    const { result, rerender } = renderHook(() => useTheme());

    expect(result.current.theme).toBe("light");

    act(() => {
      useSettingsStore.setState({ theme: "dark" });
    });
    rerender();

    expect(result.current.theme).toBe("dark");
  });
});
