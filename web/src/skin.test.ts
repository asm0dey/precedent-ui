import { describe, expect, it } from "vitest";
import { CANVAS_LABEL_MAX, clip, edgePaint, nodePaint, tokens, withAlpha } from "./skin";

const light = tokens("light");
const dark = tokens("dark");

describe("withAlpha", () => {
  it("returns the hex unchanged at full opacity", () => {
    expect(withAlpha("#2f6fd0", 1)).toBe("#2f6fd0");
  });

  it("converts to the rgba form sigma's colour parser accepts", () => {
    expect(withAlpha("#2f6fd0", 0.35)).toBe("rgba(47, 111, 208, 0.35)");
  });

  it("leaves a colour it cannot parse alone", () => {
    expect(withAlpha("rebeccapurple", 0.5)).toBe("rebeccapurple");
  });
});

describe("nodePaint", () => {
  it("paints an active node its label's colour, undimmed", () => {
    expect(nodePaint(light, "Decision", "active")).toBe(light.labelColor.Decision);
  });

  it("treats a node with no status as active", () => {
    expect(nodePaint(light, "Project", undefined)).toBe(light.labelColor.Project);
  });

  it("fades a superseded node", () => {
    expect(nodePaint(light, "Decision", "superseded")).toBe("rgba(47, 111, 208, 0.35)");
  });

  it("fades superseded less on a dark ground, so it reads faded and not invisible", () => {
    expect(dark.statusAlpha.superseded).toBeGreaterThan(light.statusAlpha.superseded);
  });

  it("gives a regretted node the regret warning colour, not its label's", () => {
    const got = nodePaint(light, "Decision", "regretted");
    expect(got).not.toContain("47, 111, 208");
    expect(got).toBe("rgba(185, 28, 28, 0.8)");
  });
});

describe("edgePaint", () => {
  it("warns on DIVERGES_FROM and REGRETS", () => {
    expect(edgePaint(light, "DIVERGES_FROM")).toBe(light.warn.divergence);
    expect(edgePaint(light, "REGRETS")).toBe(light.warn.regret);
  });

  it("separates what was chosen from what was rejected", () => {
    // The graph's whole point. These two must never resolve to the same colour,
    // and neither may fall back to the neutral structural grey.
    expect(edgePaint(light, "CHOSE")).toBe(light.verdict.CHOSE);
    expect(edgePaint(light, "REJECTED")).toBe(light.verdict.REJECTED);
    expect(edgePaint(light, "CHOSE")).not.toBe(edgePaint(light, "REJECTED"));
    expect(edgePaint(light, "CHOSE")).not.toBe(light.edge);
    expect(edgePaint(light, "REJECTED")).not.toBe(light.edge);
  });

  it("leaves structural edges neutral", () => {
    for (const type of ["IN_PROJECT", "TAGGED", "ABOUT", "SUPERSEDES", undefined]) {
      expect(edgePaint(light, type)).toBe(light.edge);
    }
  });

  it("gives both themes a distinct verdict pair", () => {
    for (const t of [light, dark]) {
      expect(t.verdict.CHOSE).not.toBe(t.verdict.REJECTED);
      expect(t.verdict.CHOSE).not.toBe(t.edge);
      expect(t.verdict.REJECTED).not.toBe(t.edge);
    }
  });
});

describe("clip", () => {
  it("leaves a short label alone and caps a long one at CANVAS_LABEL_MAX", () => {
    expect(clip("bun")).toBe("bun");
    const long = clip("Ship as a GraalVM native musl binary on Alpaquita, non-root");
    expect(long.length).toBe(CANVAS_LABEL_MAX);
    expect(long.endsWith("…")).toBe(true);
  });
});
