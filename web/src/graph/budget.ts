export type Degree = { type: string; dir: "out" | "in"; count: number };
export type Alloc = Degree & { take: number; remaining: number };

/**
 * Spend an expand-all budget across edge types, smallest type first.
 *
 * Smallest-first because it more often yields a whole neighbourhood than an
 * arbitrary slice of the single biggest type: a Decision expands completely,
 * so double-click means what it looks like it means.
 */
export function allocate(degrees: Degree[], budget = 100): Alloc[] {
  let left = budget;
  return [...degrees]
    .sort((a, b) => a.count - b.count || a.type.localeCompare(b.type))
    .map((d) => {
      const take = Math.max(0, Math.min(left, d.count));
      left -= take;
      return { ...d, take, remaining: d.count - take };
    });
}
