// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { search, type Hit } from "../api";
import { Search } from "./Search";

vi.mock("../api", () => ({ search: vi.fn() }));
const searchMock = vi.mocked(search);

const hit = (id: number, caption: string): Hit => ({
  id,
  labels: ["Decision"],
  caption,
  sub: "precedent",
  degree: 3,
});

const input = () => screen.getByLabelText("Search the decision graph");
const type = (v: string) => fireEvent.change(input(), { target: { value: v } });

beforeEach(() => {
  searchMock.mockReset();
});
afterEach(cleanup);

describe("Search", () => {
  it("lists hits for a query after the debounce", async () => {
    searchMock.mockResolvedValue([hit(1, "use sqlite")]);
    render(<Search onPick={() => {}} />);
    type("sql");
    expect(searchMock).not.toHaveBeenCalled();
    expect(await screen.findByText("use sqlite")).toBeTruthy();
    expect(searchMock).toHaveBeenCalledWith("sql");
    expect(screen.getByText("precedent · 3 edges")).toBeTruthy();
  });

  it("debounces a burst of typing into one request", async () => {
    searchMock.mockResolvedValue([]);
    render(<Search onPick={() => {}} />);
    type("s");
    type("sq");
    type("sql");
    await waitFor(() => expect(searchMock).toHaveBeenCalledTimes(1));
    expect(searchMock).toHaveBeenCalledWith("sql");
  });

  it("hands the picked hit to onPick", async () => {
    const h = hit(2, "use bun");
    searchMock.mockResolvedValue([h]);
    const onPick = vi.fn();
    render(<Search onPick={onPick} />);
    type("bun");
    fireEvent.click(await screen.findByText("use bun"));
    expect(onPick).toHaveBeenCalledWith(h);
  });

  it("shows the error when the search fails", async () => {
    searchMock.mockRejectedValue(new Error("503 busy"));
    render(<Search onPick={() => {}} />);
    type("x");
    expect(await screen.findByText("Error: 503 busy")).toBeTruthy();
  });

  it("clears hits and error when the query is blanked", async () => {
    searchMock.mockResolvedValue([hit(1, "use sqlite")]);
    render(<Search onPick={() => {}} />);
    type("sql");
    await screen.findByText("use sqlite");
    type("   ");
    expect(screen.queryByText("use sqlite")).toBeNull();
    await new Promise((r) => setTimeout(r, 250));
    expect(searchMock).toHaveBeenCalledTimes(1);
  });

  it("drops a response that arrives after a newer query started", async () => {
    let resolveOld!: (h: Hit[]) => void;
    searchMock.mockImplementationOnce(() => new Promise((r) => (resolveOld = r)));
    searchMock.mockResolvedValueOnce([hit(2, "new result")]);
    render(<Search onPick={() => {}} />);
    type("old");
    await waitFor(() => expect(searchMock).toHaveBeenCalledTimes(1));
    type("new");
    expect(await screen.findByText("new result")).toBeTruthy();
    resolveOld([hit(1, "stale result")]);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText("stale result")).toBeNull();
    expect(screen.getByText("new result")).toBeTruthy();
  });

  it("drops a failure that arrives after a newer query started", async () => {
    let rejectOld!: (e: unknown) => void;
    searchMock.mockImplementationOnce(() => new Promise((_, r) => (rejectOld = r)));
    searchMock.mockResolvedValueOnce([hit(2, "new result")]);
    render(<Search onPick={() => {}} />);
    type("old");
    await waitFor(() => expect(searchMock).toHaveBeenCalledTimes(1));
    type("new");
    await screen.findByText("new result");
    rejectOld(new Error("late"));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText("Error: late")).toBeNull();
  });
});
