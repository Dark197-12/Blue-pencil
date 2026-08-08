import { METRIC_LABELS, COMPARABLE_METRICS, type ComparableMetric } from "./metrics.js";
import { MINIMUM_EFFECT } from "./flags.js";
import type { SceneMeasurement } from "./baseline.js";

/**
 * Arcs: a character's voice changing across the book, on purpose or otherwise.
 *
 * This is a different claim from a flag and needs a different test. A flag says
 * one scene sits far from the character's normal range; an arc says the normal
 * range itself moved. A character who is formal for twenty chapters and loose
 * for the next twenty produces no flags at all — every scene is close to its
 * neighbours — while being the most obvious voice change in the manuscript.
 *
 * The test is a rank correlation between where a scene falls in the book and
 * what the metric reads there. Rank rather than raw value on purpose: one
 * furious scene can drag a least-squares line into a trend that is not there,
 * and ranks are immune to that. What survives is monotonic drift — the thing a
 * reader experiences as a character changing.
 *
 * Two guards against reading tea leaves. The correlation must clear a critical
 * value for the number of scenes actually measured, which for a character in
 * six scenes is severe (0.886) and properly so. And the drift must be large
 * enough to hear, measured as the gap between the character's first third of
 * the book and their last — the same audibility floor the flags use, because
 * a change too small to notice is not an arc whether it is monotonic or not.
 */

export interface ArcPoint {
  sceneId: string;
  chapterIndex: number;
  sceneIndex: number;
  wordCount: number;
  value: number;
}

export interface Arc {
  characterId: string;
  name: string;
  metric: ComparableMetric;
  label: string;
  direction: "rising" | "falling";
  /** Spearman's rho: −1 to 1. How consistently the metric moves one way. */
  rho: number;
  /** Value averaged over the character's first third of scenes. */
  startLevel: number;
  /** …and over their last third. */
  endLevel: number;
  /** endLevel − startLevel, in the metric's own units. */
  change: number;
  sceneCount: number;
  wordCount: number;
  /** The whole series, so the interface can draw it rather than assert it. */
  points: ArcPoint[];
  summary: string;
}

export interface ArcOptions {
  /**
   * Scenes a character needs before a trend can be tested at all. Six is the
   * floor because it is the smallest n with a published critical value that
   * isn't 1.0 — below it, "perfectly monotonic" is the only detectable state
   * and it happens by chance far too often.
   */
  minScenes?: number;
  /** Multiplies the critical value. Above 1 is stricter. */
  strictness?: number;
  ignoredMetrics?: ReadonlyArray<ComparableMetric>;
}

/**
 * Critical values for Spearman's rho, two-tailed at p = 0.05, indexed by the
 * number of scenes.
 *
 * A table rather than the usual t approximation, which assumes a large sample
 * and is badly wrong at the sizes that actually occur here — a character in
 * eight scenes is normal in a novel, and the approximation would call a rho of
 * 0.71 significant where the exact value is 0.738.
 */
const RHO_CRITICAL: Record<number, number> = {
  6: 0.886, 7: 0.786, 8: 0.738, 9: 0.7, 10: 0.648,
  11: 0.618, 12: 0.587, 13: 0.56, 14: 0.538, 15: 0.521,
  16: 0.503, 17: 0.485, 18: 0.472, 19: 0.46, 20: 0.447,
};

function criticalRho(n: number): number {
  if (n < 6) return Infinity;
  // Beyond the table the normal approximation is sound, because by then the
  // sample is large enough for the assumption it rests on to hold.
  return RHO_CRITICAL[n] ?? 1.96 / Math.sqrt(n - 1);
}

/**
 * Ranks, with ties averaged.
 *
 * Ties matter more here than they might seem. Rates like profanity and filler
 * are zero in most scenes, so a naive ranking would impose an arbitrary order
 * on a dozen identical zeroes and manufacture a trend out of the sort order.
 */
function rank(values: ReadonlyArray<number>): number[] {
  const order = values.map((value, index) => ({ value, index }));
  order.sort((a, b) => a.value - b.value);

  const ranks = new Array<number>(values.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]!.value === order[i]!.value) j++;
    const shared = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[order[k]!.index] = shared;
    i = j + 1;
  }
  return ranks;
}

/**
 * Spearman's rho, computed as Pearson's r over ranks.
 *
 * The shortcut formula (1 − 6Σd²/n(n²−1)) is only correct without ties, and
 * ties are the common case here.
 */
export function spearman(xs: ReadonlyArray<number>, ys: ReadonlyArray<number>): number {
  if (xs.length !== ys.length || xs.length < 3) return 0;

  const rx = rank(xs);
  const ry = rank(ys);
  const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
  const mx = mean(rx);
  const my = mean(ry);

  let covariance = 0;
  let varX = 0;
  let varY = 0;
  for (let i = 0; i < rx.length; i++) {
    const dx = rx[i]! - mx;
    const dy = ry[i]! - my;
    covariance += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }

  // One of the series never varies, so nothing can correlate with it.
  if (varX === 0 || varY === 0) return 0;
  return covariance / Math.sqrt(varX * varY);
}

/** How each metric reads as a trend, in each direction. */
const PHRASING: Record<ComparableMetric, { rising: string; falling: string }> = {
  meanSentenceLength: { rising: "speaking in longer and longer sentences", falling: "speaking in shorter and shorter sentences" },
  sentenceLengthVariation: { rising: "varying their sentence length more and more", falling: "settling into an evener rhythm" },
  contractionRate: { rising: "loosening — contracting more as the book goes on", falling: "tightening up — contracting less as the book goes on" },
  polysyllabicRate: { rising: "reaching for longer words as the book goes on", falling: "reaching for plainer words as the book goes on" },
  latinateRate: { rising: "growing more formal", falling: "growing plainer" },
  hedgeRate: { rising: "hedging more and more", falling: "growing more direct" },
  intensifierRate: { rising: "growing more emphatic", falling: "growing more measured" },
  fillerRate: { rising: "using more filler as the book goes on", falling: "using less filler as the book goes on" },
  profanityRate: { rising: "swearing more as the book goes on", falling: "swearing less as the book goes on" },
  questionRate: { rising: "asking more and more questions", falling: "asking fewer and fewer questions" },
  exclamationRate: { rising: "exclaiming more and more", falling: "exclaiming less and less" },
  trailOffRate: { rising: "trailing off more and more", falling: "trailing off less and less" },
  interruptionRate: { rising: "cut short more and more often", falling: "cut short less and less often" },
  vocabularyRichness: { rising: "using a widening vocabulary", falling: "using a narrowing vocabulary" },
  readingGrade: { rising: "speaking in a steadily more complex register", falling: "speaking in a steadily simpler register" },
};

/**
 * Finds sustained trends in each character's voice across the book.
 *
 * Scenes are ordered by where they fall in the manuscript, not by when they
 * were measured, so the x-axis is the reader's experience of the book.
 */
export function findArcs(
  measurements: ReadonlyArray<SceneMeasurement>,
  names: ReadonlyMap<string, string>,
  options: ArcOptions = {},
): Arc[] {
  const minScenes = options.minScenes ?? 6;
  const strictness = options.strictness ?? 1;
  const ignored = new Set(options.ignoredMetrics ?? []);

  const byCharacter = new Map<string, SceneMeasurement[]>();
  for (const measurement of measurements) {
    const list = byCharacter.get(measurement.characterId) ?? [];
    list.push(measurement);
    byCharacter.set(measurement.characterId, list);
  }

  const arcs: Arc[] = [];

  for (const [characterId, unsorted] of byCharacter) {
    if (unsorted.length < minScenes) continue;

    const scenes = [...unsorted].sort(
      (a, b) => a.chapterIndex - b.chapterIndex || a.sceneIndex - b.sceneIndex,
    );
    const positions = scenes.map((_, i) => i);
    const threshold = criticalRho(scenes.length) * strictness;

    for (const metric of COMPARABLE_METRICS) {
      if (ignored.has(metric)) continue;

      const values = scenes.map((s) => s.metrics[metric]);
      if (values.some((v) => typeof v !== "number" || !Number.isFinite(v))) continue;
      const series = values as number[];

      const rho = spearman(positions, series);
      if (Math.abs(rho) < threshold) continue;

      // First and last third, so the reported change is between two averages
      // rather than between two single scenes that happen to sit at the ends.
      const third = Math.max(1, Math.floor(scenes.length / 3));
      const average = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
      const startLevel = average(series.slice(0, third));
      const endLevel = average(series.slice(-third));
      const change = endLevel - startLevel;

      if (Math.abs(change) < MINIMUM_EFFECT[metric]) continue;

      const direction = change > 0 ? "rising" : "falling";
      const name = names.get(characterId) ?? characterId;

      arcs.push({
        characterId,
        name,
        metric,
        label: METRIC_LABELS[metric],
        direction,
        rho,
        startLevel,
        endLevel,
        change,
        sceneCount: scenes.length,
        wordCount: scenes.reduce((sum, s) => sum + s.wordCount, 0),
        points: scenes.map((s, i) => ({
          sceneId: s.sceneId,
          chapterIndex: s.chapterIndex,
          sceneIndex: s.sceneIndex,
          wordCount: s.wordCount,
          value: series[i]!,
        })),
        summary: `${name} is ${PHRASING[metric][direction]}.`,
      });
    }
  }

  return arcs.sort((a, b) => Math.abs(b.rho) - Math.abs(a.rho));
}
