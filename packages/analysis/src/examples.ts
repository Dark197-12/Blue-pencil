import { computeMetrics, type ComparableMetric, type Metrics } from "./metrics.js";

/**
 * The lines behind a number.
 *
 * Every measure in this tool is an assertion about someone's writing, and an
 * assertion a writer cannot check is worth very little. "Mr. Collins averages
 * 28.9 words per sentence" is a fact about a spreadsheet; the sentence that
 * runs to sixty-one words is a fact about the book, and it is the one that
 * tells an author what to do next.
 *
 * So each metric can name the passages that most exemplify it, at both ends.
 * Both ends matter: the top of the list shows what the number is made of, and
 * the bottom shows whether it is a consistent habit or one outlier dragging an
 * average. A character whose "longest sentences" and "shortest sentences" are
 * nine words apart has a different problem from one where they differ by fifty.
 */

export interface Example {
  /** Index into the passages that were measured. */
  index: number;
  text: string;
  /** This passage's own value for the metric. */
  value: number;
  wordCount: number;
}

export interface ExampleOptions {
  /** How many to return at each end. */
  count?: number;
  /**
   * Words a passage needs before it can be quoted as evidence.
   *
   * A three-word passage has a mean sentence length, and it is always either
   * the highest or the lowest in the cast — not because the character speaks
   * that way but because one sentence is the entire sample. Quoting it as
   * evidence would be worse than quoting nothing, because it looks like proof.
   */
  minWords?: number;
}

/** Metrics counted per sentence rather than per word need sentences to exist. */
const PER_SENTENCE: ReadonlySet<ComparableMetric> = new Set([
  "questionRate",
  "exclamationRate",
  "trailOffRate",
  "interruptionRate",
  "meanSentenceLength",
  "sentenceLengthVariation",
]);

interface MeasuredPassage {
  index: number;
  text: string;
  metrics: Metrics;
}

/**
 * Measures each passage once.
 *
 * The cost of this module is tokenisation, so passages are measured once and
 * ranked per metric afterwards. Measuring inside the per-metric loop instead
 * tokenises the whole cast's dialogue once per requested metric, which
 * accounted for roughly a third of the voice endpoint's response time.
 */
function measurePassages(
  passages: ReadonlyArray<string>,
  minWords: number,
): MeasuredPassage[] {
  const measured: MeasuredPassage[] = [];
  passages.forEach((text, index) => {
    const metrics = computeMetrics([text]);
    if (metrics.wordCount < minWords) return;
    measured.push({ index, text, metrics });
  });
  return measured;
}

/**
 * Ranks a character's passages by how strongly each shows each requested
 * metric, measuring every passage only once.
 *
 * Returns the extremes at both ends, highest first. A passage that cannot be
 * measured on a metric — no sentences, or too few words to be meaningful — is
 * omitted rather than scored as zero, which would collect silent passages at
 * the bottom of every ranking.
 */
export function findExamples(
  passages: ReadonlyArray<string>,
  metrics: ReadonlyArray<ComparableMetric>,
  options: ExampleOptions = {},
): Partial<Record<ComparableMetric, { high: Example[]; low: Example[] }>> {
  const measured = measurePassages(passages, options.minWords ?? 12);
  const count = options.count ?? 2;

  return Object.fromEntries(
    metrics.map((metric) => [metric, rank(measured, metric, count)]),
  ) as Partial<Record<ComparableMetric, { high: Example[]; low: Example[] }>>;
}

function rank(
  measured: ReadonlyArray<MeasuredPassage>,
  metric: ComparableMetric,
  count: number,
): { high: Example[]; low: Example[] } {
  const scored: Example[] = [];

  for (const passage of measured) {
    if (PER_SENTENCE.has(metric) && passage.metrics.sentenceCount < 1) continue;

    const value = passage.metrics[metric];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;

    scored.push({
      index: passage.index,
      text: passage.text,
      value,
      wordCount: passage.metrics.wordCount,
    });
  }

  if (scored.length === 0) return { high: [], low: [] };

  const byValue = [...scored].sort((a, b) => b.value - a.value || b.wordCount - a.wordCount);

  /**
   * With few passages the two ends would overlap and the same line would be
   * offered as evidence both for and against. Half the list each, at most.
   */
  const room = Math.min(count, Math.floor(byValue.length / 2));
  if (room === 0) return { high: byValue.slice(0, 1), low: [] };

  return {
    high: byValue.slice(0, room),
    // Ascending, so the most extreme low sits first and reads like the high list.
    low: byValue.slice(-room).reverse(),
  };
}
