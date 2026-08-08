import { describe, expect, it } from "vitest";
import { measureScenes, type CharacterScenes } from "./baseline.js";
import { findArcs, spearman } from "./arc.js";

/**
 * Speech that gets steadily longer-winded. `step` picks a point on the ramp,
 * so a series of scenes can be built with a known trend in it.
 */
const rung = (step: number) => {
  const clauses = [
    "I agree.",
    "I agree with you about the matter at hand.",
    "I agree with you about the matter at hand, and I have thought about it for some time.",
    "I agree with you about the matter at hand, and I have thought about it for some considerable time, though I would not wish to press the point unduly.",
  ];
  return clauses[Math.min(clauses.length - 1, step)]!;
};

/**
 * A scene of `n` utterances, all at the same point on the ramp. 40 rather than
 * a dozen because the bottom rung is two words long, and at a dozen the scene
 * fell under the 60-word floor and was never measured at all.
 */
const at = (step: number, n = 40) => Array.from({ length: n }, () => rung(step));

function character(name: string, scenes: string[][]): CharacterScenes {
  return {
    characterId: name,
    name,
    scenes: scenes.map((passages, i) => ({
      sceneId: `${name}-${i}`,
      chapterIndex: i,
      sceneIndex: 0,
      passages,
    })),
  };
}

function run(characters: CharacterScenes[], options = {}) {
  const measurements = measureScenes(characters);
  const names = new Map(characters.map((c) => [c.characterId, c.name]));
  return findArcs(measurements, names, options);
}

describe("spearman", () => {
  it("is 1 for a series that only rises", () => {
    expect(spearman([0, 1, 2, 3, 4], [2, 4, 9, 11, 30])).toBeCloseTo(1, 6);
  });

  it("is −1 for a series that only falls", () => {
    expect(spearman([0, 1, 2, 3, 4], [30, 11, 9, 4, 2])).toBeCloseTo(-1, 6);
  });

  it("ignores how big the steps are, only their order", () => {
    // The whole point of using ranks: one huge jump must not outrank
    // consistent direction.
    expect(spearman([0, 1, 2, 3], [1, 2, 3, 400])).toBeCloseTo(1, 6);
  });

  it("is 0 when nothing varies", () => {
    // Not NaN. A flat series correlates with nothing, and dividing by a zero
    // variance would otherwise poison every downstream comparison.
    expect(spearman([0, 1, 2, 3], [5, 5, 5, 5])).toBe(0);
  });

  it("averages tied ranks rather than inventing an order for them", () => {
    // Most rate metrics are zero in most scenes. If ties were broken by
    // position, this would come out as a perfect trend.
    expect(spearman([0, 1, 2, 3, 4, 5], [0, 0, 0, 0, 0, 1])).toBeLessThan(1);
    expect(spearman([0, 1, 2, 3, 4, 5], [0, 0, 0, 0, 0, 1])).toBeGreaterThan(0);
  });

  it("says nothing about a series too short to judge", () => {
    expect(spearman([0, 1], [3, 9])).toBe(0);
  });
});

describe("findArcs", () => {
  it("finds a character whose sentences lengthen across the book", () => {
    const arcs = run([character("Elena", [at(0), at(0), at(1), at(1), at(2), at(2), at(3), at(3)])]);
    const sentenceLength = arcs.find((a) => a.metric === "meanSentenceLength");

    expect(sentenceLength).toBeDefined();
    expect(sentenceLength!.direction).toBe("rising");
    expect(sentenceLength!.endLevel).toBeGreaterThan(sentenceLength!.startLevel);
    expect(sentenceLength!.summary).toContain("Elena");
  });

  it("finds the same trend backwards as falling", () => {
    const arcs = run([character("Elena", [at(3), at(3), at(2), at(2), at(1), at(1), at(0), at(0)])]);
    expect(arcs.find((a) => a.metric === "meanSentenceLength")!.direction).toBe("falling");
  });

  it("says nothing about a character who holds steady", () => {
    expect(run([character("Steady", Array.from({ length: 10 }, () => at(1)))])).toEqual([]);
  });

  it("says nothing when the scenes move up and down without direction", () => {
    const arcs = run([character("Erratic", [at(0), at(3), at(0), at(3), at(0), at(3), at(0), at(3)])]);
    expect(arcs).toEqual([]);
  });

  it("will not judge a character with too few scenes", () => {
    // Perfectly monotonic, and still not enough evidence to call it a trend.
    const arcs = run([character("Newcomer", [at(0), at(1), at(2), at(3)])]);
    expect(arcs).toEqual([]);
  });

  it("demands more of a short series than a long one", () => {
    // One scene out of order breaks a six-scene case but survives in a longer
    // one, because six scenes buy far less certainty.
    const short = run([character("Short", [at(0), at(1), at(3), at(2), at(3), at(3)])]);
    const long = run([
      character("Long", [at(0), at(0), at(1), at(3), at(1), at(2), at(2), at(3), at(3), at(3), at(3), at(3)]),
    ]);
    expect(short.some((a) => a.metric === "meanSentenceLength")).toBe(false);
    expect(long.some((a) => a.metric === "meanSentenceLength")).toBe(true);
  });

  it("ignores a trend too small to hear, however consistent", () => {
    // Strictly monotonic — rho is a perfect 1 — but the whole journey is under
    // a word of sentence length. Significance without size is not an arc.
    const base = "The matter is settled and there is nothing more to say.";
    const scenes = Array.from({ length: 10 }, (_, i) =>
      Array.from({ length: 12 }, (_, j) => (j === 0 && i > 0 ? `${base} Yes.` : base)),
    );
    expect(run([character("Metronome", scenes)])).toEqual([]);
  });

  it("reports the change between the first third and the last, not the ends", () => {
    const arcs = run([character("Elena", [at(0), at(0), at(1), at(1), at(2), at(2), at(3), at(3), at(3)])]);
    const arc = arcs.find((a) => a.metric === "meanSentenceLength")!;
    expect(arc.change).toBeCloseTo(arc.endLevel - arc.startLevel, 6);
    // Averaged over three scenes each side, so neither end is a single scene.
    expect(arc.startLevel).toBeLessThan(arc.points[arc.points.length - 1]!.value);
  });

  it("hands back the whole series so it can be drawn rather than asserted", () => {
    const arcs = run([character("Elena", [at(0), at(0), at(1), at(1), at(2), at(2), at(3), at(3)])]);
    const arc = arcs[0]!;
    expect(arc.points).toHaveLength(8);
    expect(arc.points.map((p) => p.chapterIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("orders scenes by position in the book, not by the order they arrived", () => {
    const shuffled: CharacterScenes = {
      characterId: "Elena",
      name: "Elena",
      // Same trend as the passing case, handed over back to front.
      scenes: [at(3), at(3), at(2), at(2), at(1), at(1), at(0), at(0)].map((passages, i) => ({
        sceneId: `s${i}`,
        chapterIndex: 7 - i,
        sceneIndex: 0,
        passages,
      })),
    };
    const arcs = findArcs(measureScenes([shuffled]), new Map([["Elena", "Elena"]]));
    expect(arcs.find((a) => a.metric === "meanSentenceLength")!.direction).toBe("rising");
  });

  it("can be told to ignore a metric", () => {
    const arcs = run([character("Elena", [at(0), at(0), at(1), at(1), at(2), at(2), at(3), at(3)])], {
      ignoredMetrics: ["meanSentenceLength"],
    });
    expect(arcs.map((a) => a.metric)).not.toContain("meanSentenceLength");
  });

  it("keeps each character's trends separate", () => {
    const arcs = run([
      character("Rising", [at(0), at(0), at(1), at(1), at(2), at(2), at(3), at(3)]),
      character("Falling", [at(3), at(3), at(2), at(2), at(1), at(1), at(0), at(0)]),
    ]);
    const rising = arcs.filter((a) => a.name === "Rising" && a.metric === "meanSentenceLength");
    const falling = arcs.filter((a) => a.name === "Falling" && a.metric === "meanSentenceLength");
    expect(rising[0]!.direction).toBe("rising");
    expect(falling[0]!.direction).toBe("falling");
  });
});
