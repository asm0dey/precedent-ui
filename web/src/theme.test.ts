// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTheme } from "./theme";

const KEY = "precedent-ui-theme";

let listeners: ((e: MediaQueryListEvent) => void)[];
let systemDark: boolean;

beforeEach(() => {
  listeners = [];
  systemDark = false;
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: systemDark,
      addEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => listeners.push(fn),
      removeEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => {
        listeners = listeners.filter((l) => l !== fn);
      },
    })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useTheme", () => {
  it("follows the system when nothing is stored", () => {
    systemDark = true;
    const { result } = renderHook(() => useTheme());
    expect(result.current.pref).toBe("system");
    expect(result.current.resolved).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem(KEY)).toBe("system");
  });

  it("restores a stored preference over the system", () => {
    systemDark = true;
    localStorage.setItem(KEY, "light");
    const { result } = renderHook(() => useTheme());
    expect(result.current.pref).toBe("light");
    expect(result.current.resolved).toBe("light");
  });

  it("applies and stores an explicit choice", () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.set("dark"));
    expect(result.current.resolved).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem(KEY)).toBe("dark");
  });

  it("tracks a system change while on system", () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.resolved).toBe("light");
    act(() => listeners.forEach((l) => l({ matches: true } as MediaQueryListEvent)));
    expect(result.current.resolved).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("ignores a system change under an explicit choice", () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.set("light"));
    act(() => listeners.forEach((l) => l({ matches: true } as MediaQueryListEvent)));
    expect(result.current.resolved).toBe("light");
  });

  it("stops listening on unmount", () => {
    const { unmount } = renderHook(() => useTheme());
    expect(listeners).toHaveLength(1);
    unmount();
    expect(listeners).toHaveLength(0);
  });
});
