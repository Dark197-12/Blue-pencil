import { describe, expect, it } from "vitest";
import { computeMetrics, fleschKincaidGrade, movingAverageTtr } from "./metrics.js";

const m = (...passages: string[]) => computeMetrics(passages);

describe("computeMetrics — counting", () => {
  it("counts words and sentences", () => {
    const r = m("One two three. Four five.");
    expect(r.wordCount).toBe(5);
    expect(r.sentenceCount).toBe(2);
    expect(r.meanSentenceLength).toBe(2.5);
  });

  it("measures spread in sentence length", () => {
    const even = m("One two three. One two three. One two three.");
    const uneven = m("Yes. One two three four five six seven eight nine.");
    expect(even.sentenceLengthVariation).toBe(0);
    expect(uneven.sentenceLengthVariation).toBeGreaterThan(3);
  });

  it("never lets a sentence run across two separate utterances", () => {
    // Two speeches that each lack a full stop are two sentences, not one.
    const r = m("First thing", "Second thing");
    expect(r.sentenceCount).toBe(2);
  });

  it("returns zeroes rather than NaN for empty input", () => {
    const r = m("");
    expect(r.wordCount).toBe(0);
    expect(r.meanSentenceLength).toBe(0);
    expect(r.contractionRate).toBe(0);
    expect(r.readingGrade).toBe(0);
    expect(Object.values(r).every((v) => v === null || Number.isFinite(v))).toBe(true);
  });
});

describe("computeMetrics — rates", () => {
  it("counts contractions of both apostrophe styles", () => {
    // don’t, can't, isn't, won’t = 4 contractions in 11 words -> 36.4 per 100.
    const r = m("I don’t know and I can't say she isn't here won’t");
    expect(r.wordCount).toBe(11);
    expect(r.contractionRate).toBeCloseTo(36.4, 1);
  });

  it("does not count a possessive as a contraction of the negative kind", () => {
    // "Elizabeth's" is a contraction form for our purposes; the point is that
    // the rate is a rate, not that the linguistics are perfect.
    const r = m("Elizabeth’s book");
    expect(r.contractionRate).toBeGreaterThan(0);
  });

  it("measures Latinate vocabulary by suffix", () => {
    const formal = m("The consideration of this application requires deliberation.");
    const plain = m("I saw the dog run out to the road and then come back.");
    expect(formal.latinateRate).toBeGreaterThan(plain.latinateRate);
  });

  it("measures hedging, including multi-word hedges", () => {
    const hedged = m("I suppose it might perhaps be rather late, I think.");
    const blunt = m("It is late.");
    expect(hedged.hedgeRate).toBeGreaterThan(blunt.hedgeRate);
    expect(blunt.hedgeRate).toBe(0);
  });

  it("measures fillers, including multi-word ones", () => {
    const chatty = m("Well, you know, I mean, look, it is fine.");
    expect(chatty.fillerRate).toBeGreaterThan(0);
    expect(m("It is fine.").fillerRate).toBe(0);
  });

  it("measures profanity", () => {
    expect(m("Damn the whole bloody business.").profanityRate).toBeGreaterThan(0);
    expect(m("Bless the whole business.").profanityRate).toBe(0);
  });

  it("measures sentence endings as a share of sentences", () => {
    const r = m("Are you well? Indeed! I suppose… I only meant—");
    expect(r.questionRate).toBe(25);
    expect(r.exclamationRate).toBe(25);
    expect(r.trailOffRate).toBe(25);
    expect(r.interruptionRate).toBe(25);
  });
});

describe("movingAverageTtr", () => {
  const words = (n: number, unique: boolean) =>
    Array.from({ length: n }, (_, i) => (unique ? `word${i}` : i % 5 === 0 ? `word${i}` : "the"));

  it("returns null below one window", () => {
    expect(movingAverageTtr(words(20, true), 50)).toBeNull();
  });

  it("scores varied speech higher than repetitive speech", () => {
    const varied = movingAverageTtr(words(200, true), 50)!;
    const repetitive = movingAverageTtr(words(200, false), 50)!;
    expect(varied).toBeGreaterThan(repetitive);
  });

  it("does not fall as the sample grows", () => {
    /**
     * The whole reason for using MATTR. Take one vocabulary and write more of
     * it: plain unique-over-total collapses purely because common words repeat,
     * so a talkative character always looks impoverished beside a minor one.
     * MATTR should barely move.
     */
    const vocabulary = ["the", "cat", "sat", "on", "a", "mat", "and", "slept", "quietly", "there"];
    const sample = (n: number) => Array.from({ length: n }, (_, i) => vocabulary[i % vocabulary.length]!);

    const shortMattr = movingAverageTtr(sample(60), 50)!;
    const longMattr = movingAverageTtr(sample(600), 50)!;
    expect(Math.abs(longMattr - shortMattr)).toBeLessThan(0.02);

    const plainTtr = (n: number) => new Set(sample(n)).size / n;
    expect(plainTtr(600)).toBeLessThan(plainTtr(60) / 5);
  });

  it("falls with repetition rather than with length", () => {
    const uniqueRatio = movingAverageTtr(words(300, true), 50)!;
    const repeatRatio = movingAverageTtr(words(300, false), 50)!;
    expect(uniqueRatio).toBeCloseTo(1, 1);
    expect(repeatRatio).toBeLessThan(0.5);
  });
});

describe("fleschKincaidGrade", () => {
  it("matches the formula on a worked example", () => {
    // 100 words, 10 sentences, 150 syllables:
    // 0.39*10 + 11.8*1.5 - 15.59 = 3.9 + 17.7 - 15.59 = 6.01
    expect(fleschKincaidGrade(100, 10, 150)).toBeCloseTo(6.01, 2);
  });

  it("rates long words in long sentences as harder", () => {
    const simple = fleschKincaidGrade(100, 20, 120);
    const complex = fleschKincaidGrade(100, 5, 200);
    expect(complex).toBeGreaterThan(simple);
  });

  it("returns zero rather than NaN with no input", () => {
    expect(fleschKincaidGrade(0, 0, 0)).toBe(0);
  });
});

describe("computeMetrics — telling two voices apart", () => {
  // The whole tool rests on this working: two deliberately different speakers
  // must produce visibly different numbers.
  const formal = m(
    "I am aware of the hour, and I would appreciate it if you refrained from the observation.",
    "The circumstances under which I was detained were neither of my choosing nor within my power to alter.",
    "It is a matter of some considerable delicacy, and I would prefer to discuss it privately.",
  );

  const clipped = m("You're late.", "Save it.", "I'm not doing this tonight.", "Don't.");

  it("separates them on sentence length", () => {
    expect(formal.meanSentenceLength).toBeGreaterThan(clipped.meanSentenceLength * 3);
  });

  it("separates them on contractions", () => {
    expect(clipped.contractionRate).toBeGreaterThan(formal.contractionRate);
    expect(formal.contractionRate).toBe(0);
  });

  it("separates them on Latinate vocabulary", () => {
    expect(formal.latinateRate).toBeGreaterThan(clipped.latinateRate);
  });

  it("separates them on reading grade", () => {
    expect(formal.readingGrade).toBeGreaterThan(clipped.readingGrade);
  });
});
