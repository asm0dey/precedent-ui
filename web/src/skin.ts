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
  const n = parseInt(m[1], 16);
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

/** Edge types the precedent skin draws as warnings. */
export const edgePaint = (t: Tokens, edgeType: string | undefined) =>
  edgeType === "DIVERGES_FROM"
    ? t.warn.divergence
    : edgeType === "REGRETS"
      ? t.warn.regret
      : t.edge;

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
  return v === undefined ? n.labels[0] : String(v);
};
