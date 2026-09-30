// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getNode, type NodeDetail } from "../api";
import { Detail } from "./Detail";

vi.mock("../api", () => ({ getNode: vi.fn() }));
const getNodeMock = vi.mocked(getNode);

const decision = (props: Record<string, unknown> = {}): NodeDetail => ({
  id: 7,
  labels: ["Decision"],
  props: {
    title: "use sqlite",
    statement: "store in sqlite",
    rationale: "one file",
    scope: "project",
    status: "active",
    created: "2026-01-01",
    ...props,
  },
  caption: "use sqlite",
  key: null,
  degrees: [
    { type: "CHOSE", dir: "out", count: 2 },
    { type: "SUPERSEDES", dir: "in", count: 30 },
  ],
});

const props = (over: Partial<ComponentProps<typeof Detail>> = {}) => ({
  nodeId: 7,
  refreshedAt: 0,
  more: {},
  onExpand: vi.fn(),
  onOpenMenu: vi.fn(),
  menuOpen: false,
  ...over,
});

beforeEach(() => {
  getNodeMock.mockReset();
});
afterEach(cleanup);

describe("Detail", () => {
  it("shows the empty state with nothing selected", () => {
    render(<Detail {...props({ nodeId: null })} />);
    expect(screen.getByText("nothing selected")).toBeTruthy();
    expect(getNodeMock).not.toHaveBeenCalled();
  });

  it("renders a decision's statement, rationale and metadata", async () => {
    getNodeMock.mockResolvedValue(decision());
    render(<Detail {...props()} />);
    expect(await screen.findByRole("heading", { name: "use sqlite" })).toBeTruthy();
    expect(getNodeMock).toHaveBeenCalledWith(7);
    expect(screen.getByText("store in sqlite")).toBeTruthy();
    expect(screen.getByText("one file")).toBeTruthy();
    expect(screen.getByText("project")).toBeTruthy();
    expect(screen.getByText("2026-01-01")).toBeTruthy();
    expect(screen.queryByText("despite precedent")).toBeNull();
  });

  it("omits the rationale heading when there is none", async () => {
    getNodeMock.mockResolvedValue(decision({ rationale: undefined, statement: undefined }));
    render(<Detail {...props()} />);
    await screen.findByRole("heading", { name: "use sqlite" });
    expect(screen.queryByText("rationale")).toBeNull();
  });

  it("shows the despite-precedent note and fades a superseded decision", async () => {
    getNodeMock.mockResolvedValue(decision({ despite: "went with mysql", status: "superseded" }));
    const { container } = render(<Detail {...props()} />);
    expect(await screen.findByText("went with mysql")).toBeTruthy();
    expect(container.querySelector(".detail.superseded")).toBeTruthy();
  });

  it("skips decision fields for other labels", async () => {
    getNodeMock.mockResolvedValue({
      ...decision(),
      labels: ["Project"],
      caption: "precedent",
      props: { name: "precedent", statement: "not shown" },
    });
    render(<Detail {...props()} />);
    await screen.findByRole("heading", { name: "precedent" });
    expect(screen.queryByText("not shown")).toBeNull();
    expect(screen.queryByText("scope")).toBeNull();
  });

  it("expands by edge type and direction", async () => {
    getNodeMock.mockResolvedValue(decision());
    const p = props();
    render(<Detail {...p} />);
    fireEvent.click(await screen.findByText("CHOSE ▸ 2"));
    expect(p.onExpand).toHaveBeenCalledWith("CHOSE", "out");
    fireEvent.click(screen.getByText("◂ SUPERSEDES 30"));
    expect(p.onExpand).toHaveBeenCalledWith("SUPERSEDES", "in");
  });

  it("offers the next page from where the shown ones end", async () => {
    getNodeMock.mockResolvedValue(decision());
    const p = props({ more: { "7-SUPERSEDES-in": 10, "7-CHOSE-out": 0 } });
    render(<Detail {...p} />);
    fireEvent.click(await screen.findByText("+10 more"));
    expect(p.onExpand).toHaveBeenCalledWith("SUPERSEDES", "in", 20);
    expect(screen.getAllByText(/more$/)).toHaveLength(1);
  });

  it("opens the actions menu at the button", async () => {
    getNodeMock.mockResolvedValue(decision());
    const p = props({ menuOpen: true });
    render(<Detail {...p} />);
    const btn = await screen.findByRole("button", { name: /actions/ });
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(btn);
    expect(p.onOpenMenu).toHaveBeenCalledWith(0, 0);
  });

  it("falls back to empty when the fetch fails", async () => {
    getNodeMock.mockResolvedValueOnce(decision());
    const { rerender } = render(<Detail {...props()} />);
    await screen.findByRole("heading", { name: "use sqlite" });
    getNodeMock.mockRejectedValueOnce(new Error("404 gone"));
    rerender(<Detail {...props({ refreshedAt: 1 })} />);
    expect(await screen.findByText("nothing selected")).toBeTruthy();
    expect(getNodeMock).toHaveBeenCalledTimes(2);
  });

  it("clears when the selection is removed", async () => {
    getNodeMock.mockResolvedValue(decision());
    const { rerender } = render(<Detail {...props()} />);
    await screen.findByRole("heading", { name: "use sqlite" });
    rerender(<Detail {...props({ nodeId: null })} />);
    expect(screen.getByText("nothing selected")).toBeTruthy();
  });

  it("ignores a response for a node no longer selected", async () => {
    let resolveOld!: (d: NodeDetail) => void;
    getNodeMock.mockImplementationOnce(() => new Promise((r) => (resolveOld = r)));
    getNodeMock.mockResolvedValueOnce({ ...decision(), id: 8, caption: "use bun" });
    const { rerender } = render(<Detail {...props()} />);
    rerender(<Detail {...props({ nodeId: 8 })} />);
    await screen.findByRole("heading", { name: "use bun" });
    resolveOld(decision());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole("heading", { name: "use sqlite" })).toBeNull();
  });

  it("ignores a failure for a node no longer selected", async () => {
    let rejectOld!: (e: unknown) => void;
    getNodeMock.mockImplementationOnce(() => new Promise((_, r) => (rejectOld = r)));
    getNodeMock.mockResolvedValueOnce({ ...decision(), id: 8, caption: "use bun" });
    const { rerender } = render(<Detail {...props()} />);
    rerender(<Detail {...props({ nodeId: 8 })} />);
    await screen.findByRole("heading", { name: "use bun" });
    rejectOld(new Error("late"));
    await waitFor(() => expect(screen.getByRole("heading", { name: "use bun" })).toBeTruthy());
  });
});
