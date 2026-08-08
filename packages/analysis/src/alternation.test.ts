import { describe, expect, it } from "vitest";
import type { DialogueLine } from "./dialogue.js";
import { findExchanges, inferByAlternation, type Anchored } from "./alternation.js";

/** Builds a line at a given offset; `gap` is the narration before it. */
function build(specs: Array<{ speaker: string | null; gap?: number }>): Anchored[] {
  let offset = 0;
  return specs.map((spec) => {
    offset += spec.gap ?? 20;
    const line: DialogueLine = {
      segments: [{ start: offset, end: offset + 40 }],
      start: offset,
      end: offset + 40,
      text: "some words",
      tag: null,
    };
    offset += 40;
    return { line, speaker: spec.speaker };
  });
}

describe("findExchanges", () => {
  it("keeps close lines together", () => {
    const lines = build([{ speaker: null }, { speaker: null }, { speaker: null }]);
    expect(findExchanges(lines, 300)).toEqual([{ start: 0, end: 3 }]);
  });

  it("splits on a long stretch of narration", () => {
    const lines = build([{ speaker: null }, { speaker: null, gap: 900 }, { speaker: null }]);
    expect(findExchanges(lines, 300)).toEqual([
      { start: 0, end: 1 },
      { start: 1, end: 3 },
    ]);
  });
});

describe("inferByAlternation", () => {
  it("fills a ping-pong exchange from two anchors", () => {
    const lines = build([
      { speaker: "Elena" },
      { speaker: null },
      { speaker: null },
      { speaker: "Marcus" },
    ]);
    const results = inferByAlternation(lines);
    expect(results.map((r) => [r.index, r.speaker])).toEqual([
      [1, "Marcus"],
      [2, "Elena"],
    ]);
  });

  it("works outward from anchors in the middle", () => {
    const lines = build([
      { speaker: null },
      { speaker: "Elena" },
      { speaker: "Marcus" },
      { speaker: null },
    ]);
    const results = inferByAlternation(lines);
    expect(results.map((r) => [r.index, r.speaker])).toEqual([
      [0, "Marcus"],
      [3, "Elena"],
    ]);
  });

  it("falls back to immediate neighbours when the parity contradicts itself", () => {
    // Marcus speaks at 1 and again at 2, so parity cannot be carried through
    // the exchange. Index 3 still sits directly after a named line, and the
    // person who just spoke is unlikely to be the person speaking next.
    const lines = build([
      { speaker: "Elena" },
      { speaker: "Marcus" },
      { speaker: "Marcus" },
      { speaker: null },
    ]);
    const results = inferByAlternation(lines);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ index: 3, speaker: "Elena" });
    // Lower confidence than a clean parity run.
    expect(results[0]!.confidence).toBeLessThan(0.7);
  });

  it("refuses a line whose two neighbours name different people", () => {
    // Elena, Elena, ?, Marcus — parity has already broken, and the blank works
    // as neither speaker without someone talking twice in a row. Ambiguous.
    const lines = build([
      { speaker: "Elena" },
      { speaker: "Elena" },
      { speaker: null },
      { speaker: "Marcus" },
    ]);
    expect(inferByAlternation(lines)).toEqual([]);
  });

  it("does nothing with only one named speaker", () => {
    const lines = build([{ speaker: "Elena" }, { speaker: null }, { speaker: null }]);
    expect(inferByAlternation(lines)).toEqual([]);
  });

  it("does nothing with three named speakers", () => {
    const lines = build([
      { speaker: "Elena" },
      { speaker: "Marcus" },
      { speaker: "Nadia" },
      { speaker: null },
    ]);
    expect(inferByAlternation(lines)).toEqual([]);
  });

  it("never overwrites a speaker the prose named", () => {
    const lines = build([{ speaker: "Elena" }, { speaker: "Marcus" }, { speaker: null }]);
    const results = inferByAlternation(lines);
    expect(results.map((r) => r.index)).toEqual([2]);
  });

  it("does not carry parity across a narration break", () => {
    const lines = build([
      { speaker: "Elena" },
      { speaker: "Marcus" },
      { speaker: null, gap: 2000 },
    ]);
    // The third line is its own exchange with no anchors at all.
    expect(inferByAlternation(lines)).toEqual([]);
  });

  it("lowers confidence the further it carries the parity", () => {
    // Anchors at both ends: Elena on even, Marcus on odd.
    const lines = build([
      { speaker: "Elena" },
      { speaker: null },
      { speaker: null },
      { speaker: null },
      { speaker: null },
      { speaker: "Marcus" },
    ]);
    const results = inferByAlternation(lines);
    expect(results).toHaveLength(4);
    const adjacent = results[0]!.confidence;
    const distant = results[Math.floor(results.length / 2)]!.confidence;
    expect(distant).toBeLessThan(adjacent);
    expect(Math.min(...results.map((r) => r.confidence))).toBeGreaterThanOrEqual(0.45);
  });

  it("assigns the alternating speaker across a full exchange", () => {
    const lines = build([
      { speaker: "Elena" },
      { speaker: null },
      { speaker: null },
      { speaker: null },
      { speaker: "Elena" },
      { speaker: "Marcus" },
    ]);
    // Elena on even indices, Marcus on odd — consistent with both anchors.
    const results = inferByAlternation(lines);
    expect(results.map((r) => [r.index, r.speaker])).toEqual([
      [1, "Marcus"],
      [2, "Elena"],
      [3, "Marcus"],
    ]);
  });
});
