// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getMeta } from "../api";
import { Legend } from "./Legend";

vi.mock("../api", () => ({
  getMeta: vi.fn(async () => ({
    labels: { Decision: 122, Project: 12, Lesson: 4 },
    edge_types: { CHOSE: 233, IN_PROJECT: 122, TAGGED: 50 },
    mtime: "1:1",
  })),
}));
const getMetaMock = vi.mocked(getMeta);

afterEach(cleanup);

const row = (name: string) => screen.getByText(name).closest("li") as HTMLElement;

describe("Legend", () => {
  it("shows each node kind with the count the store holds", async () => {
    render(<Legend mode="dark" />);
    expect(await screen.findByText("122")).toBeTruthy();
    expect(screen.getByText("Project")).toBeTruthy();
    expect(screen.getByText("233")).toBeTruthy();
  });

  it("hides node kinds the store has none of", async () => {
    render(<Legend mode="light" />);
    await screen.findByText("122");
    expect(screen.queryByText("Tag")).toBeNull();
    expect(screen.queryByText("Topic")).toBeNull();
  });

  it("counts regrets from lessons", async () => {
    render(<Legend mode="dark" />);
    await screen.findByText("122");
    expect(within(row("regretted")).getByText("4")).toBeTruthy();
  });

  it("totals the structural edge types under one row", async () => {
    render(<Legend mode="dark" />);
    await screen.findByText("122");
    expect(within(row("structure")).getByText("172")).toBeTruthy();
    expect(within(row("rejected")).getByText("0")).toBeTruthy();
  });

  it("shows the key without counts when the meta fetch fails", async () => {
    getMetaMock.mockRejectedValueOnce(new Error("503 busy"));
    render(<Legend mode="dark" />);
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText("Decision")).toBeNull();
    expect(row("chose").querySelector(".legend-count")?.textContent).toBe("");
    expect(within(row("regretted")).getByText("0")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("ignores a response that lands after unmount", async () => {
    let resolve!: (m: Awaited<ReturnType<typeof getMeta>>) => void;
    getMetaMock.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = render(<Legend mode="dark" />);
    unmount();
    resolve({ labels: { Decision: 1 }, edge_types: {}, mtime: "1:1" });
    await new Promise((r) => setTimeout(r, 0));
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});
