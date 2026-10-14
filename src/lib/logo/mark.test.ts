import { describe, expect, it } from "vitest";
import { cardBounds, LOGO, LOGO_COUNT } from "./mark";

describe("logo geometry", () => {
  it("centers the cards' visible shape in the tile, both ways", () => {
    const b = cardBounds(LOGO.cards, LOGO.width, LOGO.height, LOGO.gap);
    expect(b.cx).toBeCloseTo(50, 2);
    expect(b.cy).toBeCloseTo(50, 2);
  });
  it("keeps the whole mark inside the tile with an even margin", () => {
    const b = cardBounds(LOGO.cards, LOGO.width, LOGO.height, LOGO.gap);
    expect(b.x0).toBeGreaterThan(8);
    expect(b.y0).toBeGreaterThan(8);
    expect(100 - b.x1).toBeCloseTo(b.x0, 2);
    expect(100 - b.y1).toBeCloseTo(b.y0, 2);
  });
  it("deals from the center, with the ace last and on top", () => {
    expect(LOGO.cards).toHaveLength(LOGO_COUNT);
    expect(LOGO.deck).toEqual({ x: 50, y: 50 });
    expect(LOGO.cards.filter((c) => c.ace)).toHaveLength(1);
    expect(LOGO.cards.at(-1)?.ace).toBe(true);
  });
});
