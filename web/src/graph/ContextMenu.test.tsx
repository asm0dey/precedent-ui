// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Degree } from "../api";
import { ContextMenu } from "./ContextMenu";

afterEach(cleanup);

const DEGREES: Degree[] = [
  { type: "CHOSE", dir: "out", count: 3 },
  { type: "SUPERSEDES", dir: "in", count: 1 },
];

function open(overrides: Partial<Parameters<typeof ContextMenu>[0]> = {}) {
  const onAction = vi.fn();
  const onClose = vi.fn();
  const props = {
    at: { x: 10, y: 20 },
    nodeId: 7,
    degrees: DEGREES,
    caption: "Use bun",
    onAction,
    onClose,
    ...overrides,
  };
  const view = render(<ContextMenu {...props} />);
  return { ...view, props, onAction, onClose };
}

const labels = () => screen.getAllByRole("menuitem").map((el) => el.textContent);

describe("ContextMenu", () => {
  it("renders nothing while closed", () => {
    const { container } = open({ at: null });
    expect(container.innerHTML).toBe("");
  });

  it("lists a row per degree, then the fixed actions, under their headings", () => {
    open();
    const menu = screen.getByRole("menu", { name: "Actions for Use bun" });
    expect(menu.style.left).toBe("10px");
    expect(menu.style.top).toBe("20px");
    expect(menu.dataset.nodeId).toBe("7");
    expect(labels()).toEqual([
      "CHOSE ▸ 3",
      "◂ SUPERSEDES 1",
      "all",
      "this node + 1 hop",
      "this node + 2 hops",
      "this node + 3 hops",
      "pin / unpin",
      "hide",
      "copy domain key",
    ]);
    expect(screen.getByText("expand").getAttribute("role")).toBe("presentation");
    expect(screen.getByText("keep only").getAttribute("role")).toBe("presentation");
    expect(screen.getAllByRole("separator")).toHaveLength(3);
    expect(screen.getByText("this node + 1 hop").title).toBe("drop everything more than 1 hop away");
    expect(screen.getByText("this node + 3 hops").title).toBe("drop everything more than 3 hops away");
  });

  it("focuses the first item on open", () => {
    open();
    expect(document.activeElement?.textContent).toBe("CHOSE ▸ 3");
  });

  it("moves focus with the arrow keys and wraps at both ends", async () => {
    const user = userEvent.setup();
    open();
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement?.textContent).toBe("◂ SUPERSEDES 1");
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(document.activeElement?.textContent).toBe("copy domain key");
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement?.textContent).toBe("CHOSE ▸ 3");
  });

  it("activates the focused item with Enter or Space", async () => {
    const user = userEvent.setup();
    const { onAction } = open();
    await user.keyboard("{Enter}");
    expect(onAction).toHaveBeenLastCalledWith({ kind: "expand", degree: DEGREES[0] });
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown} ");
    expect(onAction).toHaveBeenLastCalledWith({ kind: "collapse", depth: 1 });
    expect(onAction).toHaveBeenCalledTimes(2);
  });

  it("maps each item to its action on click", async () => {
    const user = userEvent.setup();
    const { onAction } = open();
    await user.click(screen.getByText("all"));
    await user.click(screen.getByText("this node + 2 hops"));
    await user.click(screen.getByText("pin / unpin"));
    await user.click(screen.getByText("hide"));
    await user.click(screen.getByText("copy domain key"));
    await user.click(screen.getByText("◂ SUPERSEDES 1"));
    expect(onAction.mock.calls.map((c) => c[0])).toEqual([
      { kind: "expand-all" },
      { kind: "collapse", depth: 2 },
      { kind: "pin" },
      { kind: "hide" },
      { kind: "copy-key" },
      { kind: "expand", degree: DEGREES[1] },
    ]);
  });

  it("closes on Escape, on leaving it with the mouse, and on a click outside", async () => {
    const user = userEvent.setup();
    const { onClose, onAction } = open();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.mouseLeave(screen.getByRole("menu"));
    expect(onClose).toHaveBeenCalledTimes(2);

    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(3);

    // A mousedown inside the menu is a click on an item, not a dismissal.
    fireEvent.mouseDown(screen.getByText("hide"));
    expect(onClose).toHaveBeenCalledTimes(3);
    expect(onAction).not.toHaveBeenCalled();
  });

  it("ignores keys it does not handle", async () => {
    const user = userEvent.setup();
    const { onAction, onClose } = open();
    await user.keyboard("a");
    expect(onAction).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement?.textContent).toBe("CHOSE ▸ 3");
  });

  it("stops listening for outside clicks once closed", () => {
    const { rerender, props, onClose } = open();
    rerender(<ContextMenu {...props} at={null} />);
    fireEvent.mouseDown(document.body);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("gives focus back to whatever held it before the menu opened", () => {
    const button = document.createElement("button");
    document.body.appendChild(button);
    button.focus();
    try {
      const { rerender, props } = open({ at: null });
      rerender(<ContextMenu {...props} at={{ x: 0, y: 0 }} />);
      expect(document.activeElement?.getAttribute("role")).toBe("menuitem");
      rerender(<ContextMenu {...props} at={null} />);
      expect(document.activeElement).toBe(button);
    } finally {
      button.remove();
    }
  });

  it("still works with no degrees to expand", () => {
    open({ degrees: [] });
    expect(labels()[0]).toBe("all");
    expect(document.activeElement?.textContent).toBe("all");
  });
});
