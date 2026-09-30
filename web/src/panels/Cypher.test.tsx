// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, runCypher } from "../api";
import type { GEdge, GNode } from "../classify";
import { SAVED } from "../savedQueries";
import { Cypher } from "./Cypher";

vi.mock("../api", async (orig) => ({
  ApiError: (await orig<typeof import("../api")>()).ApiError,
  runCypher: vi.fn(),
}));
const runMock = vi.mocked(runCypher);

const project: GNode = { id: 1, labels: ["Project"], props: { name: "precedent" } };
const tag: GNode = { id: 2, labels: ["Tag"], props: { name: "python" } };
const rel: GEdge = { id: "e1", src: 1, dst: 2, type: "TAGGED" };

const textarea = () => screen.getByLabelText("cypher query") as HTMLTextAreaElement;
const run = () => fireEvent.click(screen.getByRole("button", { name: "run" }));

beforeEach(() => {
  runMock.mockReset();
});
afterEach(cleanup);

describe("Cypher", () => {
  it("starts with the first saved query", () => {
    render(<Cypher onAdd={() => {}} />);
    expect(textarea().value).toBe(SAVED[0].cypher);
  });

  it("loads a saved query when picked", () => {
    render(<Cypher onAdd={() => {}} />);
    fireEvent.change(screen.getByLabelText("saved query"), { target: { value: "2" } });
    expect(textarea().value).toBe(SAVED[2].cypher);
  });

  it("runs the edited query and tabulates nodes, rels and scalars", async () => {
    runMock.mockResolvedValue({
      columns: ["p", "r", "t", "n"],
      rows: [
        [
          { kind: "node", node: project },
          { kind: "rel", rel },
          { kind: "node", node: tag },
          { kind: "scalar", value: 3 },
        ],
      ],
      truncated: false,
    });
    render(<Cypher onAdd={() => {}} />);
    fireEvent.change(textarea(), { target: { value: "MATCH (p) RETURN p" } });
    run();
    expect(screen.getByRole("button", { name: "running…" })).toBeTruthy();
    expect(await screen.findByText("-[TAGGED]->")).toBeTruthy();
    expect(runMock).toHaveBeenCalledWith("MATCH (p) RETURN p");
    expect(screen.getByRole("columnheader", { name: "t" })).toBeTruthy();
    expect(screen.getByText("precedent")).toBeTruthy();
    expect(screen.getByText("python")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("adds the result's nodes and edges to the canvas", async () => {
    runMock.mockResolvedValue({
      columns: ["p", "r", "t"],
      rows: [
        [
          { kind: "node", node: project },
          { kind: "rel", rel },
          { kind: "node", node: tag },
        ],
      ],
      truncated: false,
    });
    const onAdd = vi.fn();
    render(<Cypher onAdd={onAdd} />);
    run();
    fireEvent.click(await screen.findByRole("button", { name: "add 2 nodes to canvas" }));
    expect(onAdd).toHaveBeenCalledWith([project, tag], [rel]);
  });

  it("uses the singular for one node and hides the button for none", async () => {
    runMock.mockResolvedValueOnce({
      columns: ["p"],
      rows: [[{ kind: "node", node: project }]],
      truncated: false,
    });
    render(<Cypher onAdd={() => {}} />);
    run();
    expect(await screen.findByRole("button", { name: "add 1 node to canvas" })).toBeTruthy();

    runMock.mockResolvedValueOnce({
      columns: ["n"],
      rows: [[{ kind: "scalar", value: "x" }]],
      truncated: false,
    });
    run();
    await screen.findByText("x");
    expect(screen.queryByRole("button", { name: /to canvas/ })).toBeNull();
  });

  it("warns when rows were truncated", async () => {
    runMock.mockResolvedValue({ columns: [], rows: [], truncated: true });
    render(<Cypher onAdd={() => {}} />);
    run();
    expect((await screen.findByRole("status")).textContent).toContain("1000 rows");
  });

  it("shows the engine's own error from a 400 body", async () => {
    runMock.mockRejectedValue(
      new ApiError(400, JSON.stringify({ detail: { type: "SyntaxError", error: "bad token" } })),
    );
    render(<Cypher onAdd={() => {}} />);
    run();
    expect((await screen.findByRole("alert")).textContent).toBe("SyntaxError: bad token");
  });

  it("falls back to the raw message when the body is not the engine's", async () => {
    runMock.mockRejectedValue(new ApiError(503, "store busy"));
    render(<Cypher onAdd={() => {}} />);
    run();
    expect((await screen.findByRole("alert")).textContent).toBe("Error: ApiError: 503 store busy");
  });

  it("falls back to the raw message when the braces are not JSON", async () => {
    runMock.mockRejectedValue(new Error("500 {not json}"));
    render(<Cypher onAdd={() => {}} />);
    run();
    expect((await screen.findByRole("alert")).textContent).toBe("Error: Error: 500 {not json}");
  });

  it("falls back when the JSON has no engine error", async () => {
    runMock.mockRejectedValue(new ApiError(422, '{"detail":"nope"}'));
    render(<Cypher onAdd={() => {}} />);
    run();
    expect((await screen.findByRole("alert")).textContent).toBe(
      'Error: ApiError: 422 {"detail":"nope"}',
    );
  });

  it("clears a previous result when a run fails, and the error on the next success", async () => {
    runMock.mockResolvedValueOnce({ columns: ["n"], rows: [[{ kind: "scalar", value: 1 }]], truncated: false });
    render(<Cypher onAdd={() => {}} />);
    run();
    await screen.findByRole("columnheader", { name: "n" });

    runMock.mockRejectedValueOnce(new Error("boom"));
    run();
    await screen.findByRole("alert");
    expect(screen.queryByRole("table")).toBeNull();

    runMock.mockResolvedValueOnce({ columns: ["m"], rows: [], truncated: false });
    run();
    await screen.findByRole("columnheader", { name: "m" });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
