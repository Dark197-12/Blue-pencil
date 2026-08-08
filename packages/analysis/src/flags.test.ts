import { describe, expect, it } from "vitest";
import { buildBaselines, measureScenes, type CharacterScenes } from "./baseline.js";
import { findFlags } from "./flags.js";

/** A scene of ordinary, even speech. */
const plain = (n: number) =>
  Array.from({ length: n }, () => "The matter is settled and there is nothing more to say about it.");

/** Long, formal, contraction-free speech. */
const formal = (n: number) =>
  Array.from(
    { length: n },
    () =>
      "I am aware of the circumstances, and I would appreciate it very much if you refrained entirely from the observation you appear determined to make.",
  );

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

/** Builds baselines and flags in one go, as the pipeline does. */
function run(characters: CharacterScenes[], options = {}) {
  const measurements = measureScenes(characters);
  const baselines = buildBaselines(characters, measurements);
  return { measurements, baselines, flags: findFlags(measurements, baselines, options) };
}

describe("baselines", () => {
  it("needs several scenes before it will judge anyone", () => {
    const { baselines } = run([character("Solo", [plain(12), plain(12)])]);
    expect(baselines[0]!.isUsable).toBe(false);
  });

  it("is usable once a character has enough scenes and words", () => {
    const { baselines } = run([character("Talker", [plain(12), plain(12), plain(12), plain(12)])]);
    expect(baselines[0]!.isUsable).toBe(true);
    expect(baselines[0]!.sceneCount).toBe(4);
  });

  it("ignores scenes with too little speech to measure", () => {
    const { baselines } = run([
      character("Talker", [plain(12), plain(12), plain(12), ["Yes."], plain(12)]),
    ]);
    // The one-word scene is not counted.
    expect(baselines[0]!.sceneCount).toBe(4);
  });

  it("trusts a character's own spread more the more scenes they have", () => {
    const few = run([character("Few", [plain(12), plain(12), plain(12)])]).baselines[0]!;
    const many = run([
      character("Many", Array.from({ length: 20 }, () => plain(12))),
    ]).baselines[0]!;

    const fewWeight = Object.values(few.metrics)[0]?.ownWeight ?? 0;
    const manyWeight = Object.values(many.metrics)[0]?.ownWeight ?? 0;
    expect(manyWeight).toBeGreaterThan(fewWeight);
    expect(manyWeight).toBeGreaterThan(0.7);
  });
});

describe("findFlags", () => {
  it("says nothing about a character who never changes", () => {
    const { flags } = run([
      character("Steady", Array.from({ length: 8 }, () => plain(12))),
    ]);
    expect(flags).toEqual([]);
  });

  it("flags a scene where a character speaks quite differently", () => {
    const scenes = [...Array.from({ length: 7 }, () => plain(12)), formal(8)];
    const { flags } = run([character("Elena", scenes)]);

    expect(flags.length).toBeGreaterThan(0);
    const flag = flags[0]!;
    expect(flag.sceneId).toBe("Elena-7");
    expect(flag.evidence.length).toBeGreaterThan(0);
    expect(flag.summary).toContain("Elena");
  });

  it("names the metric that moved and both its values", () => {
    const scenes = [...Array.from({ length: 7 }, () => plain(12)), formal(8)];
    const { flags } = run([character("Elena", scenes)]);
    const sentenceLength = flags[0]!.evidence.find((e) => e.metric === "meanSentenceLength");

    expect(sentenceLength).toBeDefined();
    expect(sentenceLength!.direction).toBe("higher");
    expect(sentenceLength!.observed).toBeGreaterThan(sentenceLength!.baseline);
  });

  it("reports how much speech the judgement rests on", () => {
    const scenes = [...Array.from({ length: 7 }, () => plain(12)), formal(8)];
    const { flags } = run([character("Elena", scenes)]);
    // The author needs to know whether this rests on a paragraph or a chapter.
    expect(flags[0]!.sceneWordCount).toBeGreaterThan(60);
    // Eight scenes, minus the one under judgement.
    expect(flags[0]!.baselineSceneCount).toBe(7);
    expect(flags[0]!.baselineWordCount).toBeGreaterThan(flags[0]!.sceneWordCount);
  });

  it("ignores a deviation too small to hear, however significant", () => {
    // A character who is metronomically consistent has a tiny spread, so a
    // trivial change is many deviations out. It is still trivial.
    const base = "The cat sat on the mat and then it slept there quietly.";
    const scenes = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => base));
    // One scene with a single extra short sentence: statistically miles out,
    // practically nothing.
    scenes[7] = [...scenes[7]!.slice(0, 7), `${base} Yes.`];

    const { flags } = run([character("Metronome", scenes)]);
    expect(flags).toEqual([]);
  });

  it("respects a raised threshold", () => {
    const scenes = [...Array.from({ length: 7 }, () => plain(12)), formal(8)];
    const loose = run([character("Elena", scenes)], { threshold: 2 }).flags;
    const strict = run([character("Elena", scenes)], { threshold: 8 }).flags;
    expect(strict.length).toBeLessThan(loose.length);
  });

  it("can be told to ignore a metric", () => {
    const scenes = [...Array.from({ length: 7 }, () => plain(12)), formal(8)];
    const { flags } = run([character("Elena", scenes)], {
      ignoredMetrics: ["meanSentenceLength"],
    });
    for (const flag of flags) {
      expect(flag.evidence.map((e) => e.metric)).not.toContain("meanSentenceLength");
    }
  });

  it("will not judge a character with no usable baseline", () => {
    // Two scenes is not a baseline, however different the second one is.
    const { flags } = run([character("Newcomer", [plain(12), formal(8)])]);
    expect(flags).toEqual([]);
  });

  it("calls several metrics moving together strong", () => {
    const scenes = [...Array.from({ length: 7 }, () => plain(12)), formal(8)];
    const { flags } = run([character("Elena", scenes)]);
    const flag = flags[0]!;
    if (flag.evidence.length >= 3) expect(flag.severity).toBe("strong");
  });

  it("orders the worst first", () => {
    const scenes = [
      ...Array.from({ length: 7 }, () => plain(12)),
      formal(8),
      [...plain(8), ...formal(3)],
    ];
    const { flags } = run([character("Elena", scenes)]);
    for (let i = 0; i < flags.length - 1; i++) {
      expect(flags[i]!.peakZ).toBeGreaterThanOrEqual(flags[i + 1]!.peakZ);
    }
  });
});
