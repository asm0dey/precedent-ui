export type Mode = "light" | "dark";

const LIGHT = {
  bg: "#ffffff",
  text: "#14161a",
  edge: "#9aa3ad",
  labelColor: {
    Decision: "#2f6fd0",
    Project: "#1f9d63",
    Tag: "#b8860b",
    Topic: "#7a4fbf",
    Option: "#6b7280",
    Principle: "#c2410c",
    Lesson: "#b91c1c",
  } as Record<string, string>,
  statusAlpha: { active: 1, superseded: 0.35, regretted: 0.8 } as Record<string, number>,
  // `conflict` is deliberately unused on the canvas: a CONFLICT (a live
  // Decision CHOSE an option another live Decision REJECTED) is not a property
  // of one node or one edge, so it cannot be drawn from what the canvas holds.
  // It is surfaced by `precedent check` and by the saved conflicts query in the
  // Cypher console instead — see the spec's skin section. The token is kept so
  // the two palettes stay symmetric if that ever changes.
  warn: { conflict: "#dc2626", divergence: "#d97706", regret: "#b91c1c" },
  // CHOSE and REJECTED are the graph's whole point — what was taken and what
  // was turned down — so they are the one pair that must never read as the same
  // grey line. Everything structural (IN_PROJECT, TAGGED, ABOUT, SUPERSEDES)
  // stays neutral so the verdict edges carry the eye.
  verdict: { CHOSE: "#1f9d63", REJECTED: "#c2410c" } as Record<string, string>,
};

const DARK: typeof LIGHT = {
  bg: "#14161a",
  text: "#e8eaed",
  edge: "#5b636d",
  labelColor: {
    Decision: "#7aa9f0",
    Project: "#5bd39a",
    Tag: "#e0b45a",
    Topic: "#b28df0",
    Option: "#a1a8b3",
    Principle: "#f08a4b",
    Lesson: "#f06a6a",
  } as Record<string, string>,
  // superseded needs a *higher* alpha on a dark ground to read as faded
  // rather than as invisible.
  statusAlpha: { active: 1, superseded: 0.5, regretted: 0.85 } as Record<string, number>,
  warn: { conflict: "#f87171", divergence: "#fbbf24", regret: "#f06a6a" },
  verdict: { CHOSE: "#5bd39a", REJECTED: "#f08a4b" } as Record<string, string>,
};

export const tokens = (mode: Mode) => (mode === "dark" ? DARK : LIGHT);

/**
 * Ink for the label sigma draws on a hovered node.
 *
 * Not theme-dependent on purpose: sigma's hover renderer fills that label's
 * background with a hardcoded `#FFF` and exposes no setting for it, so the
 * text sitting on it has to stay dark in both themes. Theming it alongside
 * the other labels would make hovered labels white-on-white.
 */
export const HOVER_LABEL_INK = LIGHT.text;
export type Tokens = typeof LIGHT;

/** `#rrggbb` + alpha → the `rgba(...)` form sigma's colour parser accepts.
 * Returned unchanged at full opacity, and for any colour that is not a plain
 * six-digit hex. */
export function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (alpha >= 1 || !m) return hex;
  const n = Number.parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** The node's drawn colour: its label's colour, faded by status — except a
 * `regretted` Decision, which takes the regret warning colour so it reads as a
 * warning rather than as a slightly dimmer Decision. Status is a graph
 * attribute; the colour is resolved here at render time, so switching theme
 * never rewrites graph data. */
export function nodePaint(t: Tokens, nodeLabel: string | undefined, status: string | undefined) {
  const base =
    status === "regretted" ? t.warn.regret : (t.labelColor[nodeLabel ?? ""] ?? t.edge);
  return withAlpha(base, t.statusAlpha[status ?? "active"] ?? 1);
}

/**
 * Edge colour by relationship.
 *
 * Three groups: the verdict edges (what a decision took and what it turned
 * down), the warning edges (a deliberate divergence, a regret), and everything
 * structural, which stays neutral.
 */
export const edgePaint = (t: Tokens, edgeType: string | undefined) => {
  const verdict = t.verdict[edgeType ?? ""];
  if (verdict) return verdict;
  if (edgeType === "DIVERGES_FROM") return t.warn.divergence;
  if (edgeType === "REGRETS") return t.warn.regret;
  return t.edge;
};

/** Every relationship the skin gives a colour to, for the legend. */
export const EDGE_LEGEND = (t: Tokens): { type: string; color: string; hint: string }[] => [
  { type: "CHOSE", color: t.verdict.CHOSE, hint: "what the decision took" },
  { type: "REJECTED", color: t.verdict.REJECTED, hint: "what it turned down" },
  { type: "DIVERGES_FROM", color: t.warn.divergence, hint: "a knowing exception" },
  { type: "REGRETS", color: t.warn.regret, hint: "judged a mistake later" },
  { type: "IN_PROJECT · ABOUT · TAGGED · SUPERSEDES", color: t.edge, hint: "structure" },
];

export const CAPTION_FIELD: Record<string, string> = {
  Decision: "title",
  Project: "name",
  Tag: "name",
  Topic: "name",
  Option: "name",
  Principle: "statement",
  Lesson: "statement",
};

export const captionOf = (n: { labels: string[]; props: Record<string, unknown> }) => {
  const field = CAPTION_FIELD[n.labels[0]];
  const v = field ? n.props[field] : undefined;
  if (v === undefined) return n.labels[0];
  // Caption fields are scalars; an object would caption as "[object Object]".
  return typeof v === "object" && v !== null ? JSON.stringify(v) : String(v as string | number | boolean);
};

/** Canvas labels are clipped: a full decision title runs several label-grid
 * cells wide and paints over its neighbours. The hovered node and the detail
 * panel still show it whole. */
export const CANVAS_LABEL_MAX = 28;
export const clip = (s: string) =>
  s.length > CANVAS_LABEL_MAX ? `${s.slice(0, CANVAS_LABEL_MAX - 1).trimEnd()}…` : s;
