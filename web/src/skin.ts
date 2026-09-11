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
  statusAlpha: { active: 1, superseded: 0.35, regretted: 0.8 },
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
  statusAlpha: { active: 1, superseded: 0.5, regretted: 0.85 },
  warn: { conflict: "#f87171", divergence: "#fbbf24", regret: "#f06a6a" },
};

export const tokens = (mode: Mode) => (mode === "dark" ? DARK : LIGHT);

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
