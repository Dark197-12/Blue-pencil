import { describe, expect, it } from "vitest";
import { findExamples, type Example, type ExampleOptions } from "./examples.js";
import type { ComparableMetric } from "./metrics.js";

/** Examples for one metric, which is all any of these tests need. */
const examplesOf = (
  passages: ReadonlyArray<string>,
  metric: ComparableMetric,
  options: ExampleOptions = {},
): { high: Example[]; low: Example[] } =>
  findExamples(passages, [metric], options)[metric] ?? { high: [], low: [] };

const long =
  "I am aware of the circumstances that have brought us here today, and I would be exceedingly grateful if you would refrain entirely from making the observation you appear so determined to make.";
// Long enough to clear the 12-word evidence floor, short enough per sentence
// to sit at the bottom of a sentence-length ranking.
const short = "No. Not now. Go away. I said no. Please just go. Leave me be now.";
const middling = "The matter is settled and there is nothing further to say about it today.";

describe("findExamples", () => {
  it("puts the passage that most shows the metric first", () => {
    const { high } = examplesOf([short, middling, long], "meanSentenceLength", { count: 1 });
    expect(high[0]!.text).toBe(long);
  });

  it("returns the other end too, so a habit can be told from an outlier", () => {
    const { high, low } = examplesOf([short, middling, long], "meanSentenceLength", { count: 1 });
    expect(high[0]!.text).toBe(long);
    expect(low[0]!.text).toBe(short);
  });

  it("never offers the same passage as evidence for both ends", () => {
    const passages = [short, long];
    const { high, low } = examplesOf(passages, "meanSentenceLength", { count: 3 });
    const overlap = high.filter((h) => low.some((l) => l.index === h.index));
    expect(overlap).toEqual([]);
  });

  it("refuses to quote a passage too short to mean anything", () => {
    // "Yes." has a mean sentence length, and it is the lowest in any cast —
    // because one sentence is the whole sample, not because of how anyone
    // speaks.
    const { high, low } = examplesOf(["Yes.", long, middling], "meanSentenceLength");
    for (const example of [...high, ...low]) expect(example.text).not.toBe("Yes.");
  });

  it("reports each passage's own value, not the character's average", () => {
    const { high } = examplesOf([short, long], "meanSentenceLength", { count: 1 });
    // The long passage is one sentence of about thirty words.
    expect(high[0]!.value).toBeGreaterThan(25);
  });

  it("finds contractions where they actually are", () => {
    const contracted = "You're late again and I can't pretend that it doesn't matter to me now.";
    const plain = "You are late again and I cannot pretend that it does not matter to me now.";
    const { high, low } = examplesOf([plain, contracted], "contractionRate", { count: 1 });
    expect(high[0]!.text).toBe(contracted);
    expect(low[0]!.text).toBe(plain);
  });

  it("says nothing when there is nothing long enough to quote", () => {
    expect(examplesOf(["Yes.", "No.", "Perhaps."], "meanSentenceLength")).toEqual({
      high: [],
      low: [],
    });
  });

  it("returns one example rather than none when there is only one candidate", () => {
    const { high, low } = examplesOf(["Yes.", long], "meanSentenceLength", { count: 2 });
    expect(high).toHaveLength(1);
    expect(low).toEqual([]);
  });

  it("keeps the index of the passage it quoted", () => {
    const { high } = examplesOf([short, middling, long], "meanSentenceLength", { count: 1 });
    expect(high[0]!.index).toBe(2);
  });

  it("handles a metric no passage registers on", () => {
    const { high, low } = examplesOf([long, middling], "profanityRate", { count: 1 });
    // Everything is zero, so the ranking is arbitrary but must not crash or
    // invent a difference.
    expect(high[0]!.value).toBe(0);
    expect(low[0]!.value).toBe(0);
  });
});
