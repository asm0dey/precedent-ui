import { describe, expect, it } from "vitest";
import { edgePaint, nodePaint, tokens, withAlpha } from "./skin";

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

  it("leaves every other edge type the default edge colour", () => {
    expect(edgePaint(light, "CHOSE")).toBe(light.edge);
    expect(edgePaint(light, undefined)).toBe(light.edge);
  });
});
