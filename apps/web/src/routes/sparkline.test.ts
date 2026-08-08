import { describe, expect, it } from "vitest";
import {
  SPARKLINE_HEIGHT,
  SPARKLINE_WIDTH,
  sparklinePath,
  sparklinePoints,
} from "./sparkline";

describe("sparklinePoints", () => {
  it("spreads points evenly from edge to edge", () => {
    const xs = sparklinePoints([1, 2, 3, 4, 5]).map((p) => p.x);
    expect(xs[0]).toBe(0);
    expect(xs[4]).toBe(SPARKLINE_WIDTH);
    expect(xs[2]).toBe(SPARKLINE_WIDTH / 2);
  });

  it("puts the lowest value at the bottom and the highest at the top", () => {
    // SVG y grows downward, so a rising series must produce falling y.
    const ys = sparklinePoints([10, 20, 30]).map((p) => p.y);
    expect(ys[0]).toBe(SPARKLINE_HEIGHT);
    expect(ys[2]).toBe(0);
    expect(ys[1]).toBeCloseTo(SPARKLINE_HEIGHT / 2, 6);
  });

  it("scales to the series' own range, not to zero", () => {
    // A change from 12.0 to 12.4 is the whole point of an arc; anchoring the
    // axis at zero would render it as a flat line.
    const subtle = sparklinePoints([12, 12.2, 12.4]).map((p) => p.y);
    const dramatic = sparklinePoints([4, 17, 30]).map((p) => p.y);
    subtle.forEach((y, i) => expect(y).toBeCloseTo(dramatic[i]!, 6));
  });

  it("puts a flat series on the baseline instead of dividing by zero", () => {
    const ys = sparklinePoints([7, 7, 7]).map((p) => p.y);
    expect(ys.every(Number.isFinite)).toBe(true);
    expect(ys).toEqual([SPARKLINE_HEIGHT, SPARKLINE_HEIGHT, SPARKLINE_HEIGHT]);
  });

  it("centres a single point rather than pinning it to the left edge", () => {
    // With one value there is no interval to divide by.
    const [only] = sparklinePoints([5]);
    expect(only!.x).toBe(SPARKLINE_WIDTH / 2);
    expect(Number.isFinite(only!.y)).toBe(true);
  });

  it("handles an empty series", () => {
    expect(sparklinePoints([])).toEqual([]);
  });

  it("copes with negative values", () => {
    // z-scores and differences can both go below zero.
    const ys = sparklinePoints([-3, 0, 3]).map((p) => p.y);
    expect(ys[0]).toBe(SPARKLINE_HEIGHT);
    expect(ys[2]).toBe(0);
  });
});

describe("sparklinePath", () => {
  it("moves to the first point and lines to the rest", () => {
    const path = sparklinePath(sparklinePoints([0, 1]));
    expect(path.startsWith("M")).toBe(true);
    expect(path.split("L")).toHaveLength(2);
  });

  it("is empty for an empty series", () => {
    expect(sparklinePath([])).toBe("");
  });
});
