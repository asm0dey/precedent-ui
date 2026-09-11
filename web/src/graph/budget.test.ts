import { describe, expect, it } from "vitest";
import { allocate } from "./budget";

describe("allocate", () => {
  it("takes every neighbour when the whole neighbourhood fits", () => {
    const d = [
      { type: "IN_PROJECT", dir: "out" as const, count: 1 },
      { type: "ABOUT", dir: "out" as const, count: 2 },
      { type: "CHOSE", dir: "out" as const, count: 3 },
      { type: "REJECTED", dir: "out" as const, count: 5 },
    ];
    const got = allocate(d, 100);
    expect(got.map((a) => a.take)).toEqual([1, 2, 3, 5]);
    expect(got.every((a) => a.take === a.count)).toBe(true);
  });

  it("spends the budget smallest type first", () => {
    const d = [
      { type: "TAGGED", dir: "in" as const, count: 4000 },
      { type: "ABOUT", dir: "out" as const, count: 2 },
    ];
    const got = allocate(d, 100);
    expect(got[0]).toMatchObject({ type: "ABOUT", take: 2 });
    expect(got[1]).toMatchObject({ type: "TAGGED", take: 98 });
  });

  it("reports what it left behind", () => {
    const got = allocate([{ type: "TAGGED", dir: "in", count: 4362 }], 100);
    expect(got[0].remaining).toBe(4262);
  });

  it("never returns a negative or over-budget take", () => {
    const got = allocate(
      [
        { type: "A", dir: "out", count: 60 },
        { type: "B", dir: "out", count: 60 },
        { type: "C", dir: "out", count: 60 },
      ],
      100,
    );
    expect(got.reduce((n, a) => n + a.take, 0)).toBe(100);
    expect(got.every((a) => a.take >= 0)).toBe(true);
  });
});
