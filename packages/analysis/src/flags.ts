import { METRIC_LABELS, type ComparableMetric } from "./metrics.js";
import { baselineExcludingScene, type Baseline, type SceneMeasurement } from "./baseline.js";

/**
 * Turning a deviation into something worth telling the author about.
 *
 * Two tests have to pass, and they catch different mistakes.
 *
 * Statistical: the scene must be far from the character's own normal range,
 * measured in their own units of variability.
 *
 * Practical: the difference must also be large enough to notice on the page.
 * The two are independent. A character who contracts 0.4 times per hundred
 * words where they usually manage 0.5 can be three standard deviations out
 * purely because their spread is small, and no reader would register the
 * change. Each metric therefore carries a minimum difference below which a
 * deviation is arithmetic rather than audible.
 *
 * The design is biased toward silence. False positives are more costly than
 * misses here: they train the author to dismiss flags without reading them.
 */

export type Severity = "notable" | "strong";

export interface FlagEvidence {
  metric: ComparableMetric;
  label: string;
  /** What this character usually does. */
  baseline: number;
  /** What they do in this scene. */
  observed: number;
  /** Deviations from their own normal range. */
  z: number;
  direction: "higher" | "lower";
}

export interface Flag {
  characterId: string;
  sceneId: string;
  chapterIndex: number;
  sceneIndex: number;
  severity: Severity;
  /** Largest deviation, used for ordering. */
  peakZ: number;
  evidence: FlagEvidence[];
  /** How much speech the judgement rests on, on each side. */
  sceneWordCount: number;
  baselineWordCount: number;
  baselineSceneCount: number;
  /** Plain-language summary, written for the author rather than the log. */
  summary: string;
}

export interface FlagOptions {
  /**
   * Deviations beyond this are candidates. 2.5 rather than 2 deliberately:
   * with fifteen metrics measured per scene, a threshold of 2 would raise
   * roughly one false flag per scene from noise alone.
   */
  threshold?: number;
  /** Deviations beyond this are called strong. */
  strongThreshold?: number;
  /** A scene needs this much speech from the character to be judged. */
  minSceneWords?: number;
  /** Metrics the author has switched off. */
  ignoredMetrics?: ReadonlyArray<ComparableMetric>;
}

/**
 * Smallest difference in each metric that a reader could plausibly notice.
 *
 * These are judgements, not measurements, and they are the main defence
 * against statistically-real-but-meaningless flags. Units match the metric:
 * words for sentence length, counts per 100 words or per 100 sentences for the
 * rates, grades for reading level.
 */
export const MINIMUM_EFFECT: Record<ComparableMetric, number> = {
  meanSentenceLength: 5,
  sentenceLengthVariation: 5,
  contractionRate: 2,
  polysyllabicRate: 4,
  latinateRate: 2,
  hedgeRate: 2,
  intensifierRate: 2,
  fillerRate: 2,
  profanityRate: 1,
  questionRate: 15,
  exclamationRate: 15,
  trailOffRate: 15,
  interruptionRate: 15,
  vocabularyRichness: 0.08,
  readingGrade: 2.5,
};

/** How each metric reads in a sentence, in each direction. */
const PHRASING: Record<ComparableMetric, { higher: string; lower: string }> = {
  meanSentenceLength: { higher: "speaking in much longer sentences", lower: "speaking in much shorter sentences" },
  sentenceLengthVariation: { higher: "varying sentence length far more", lower: "speaking far more evenly" },
  contractionRate: { higher: "contracting far more", lower: "barely contracting" },
  polysyllabicRate: { higher: "reaching for longer words", lower: "using plainer words" },
  latinateRate: { higher: "unusually formal", lower: "unusually plain" },
  hedgeRate: { higher: "hedging far more", lower: "far more direct" },
  intensifierRate: { higher: "far more emphatic", lower: "far more measured" },
  fillerRate: { higher: "using far more filler", lower: "using far less filler" },
  profanityRate: { higher: "swearing far more", lower: "swearing far less" },
  questionRate: { higher: "asking far more questions", lower: "asking far fewer questions" },
  exclamationRate: { higher: "exclaiming far more", lower: "exclaiming far less" },
  trailOffRate: { higher: "trailing off far more", lower: "trailing off far less" },
  interruptionRate: { higher: "cut short far more often", lower: "cut short far less often" },
  vocabularyRichness: { higher: "using a noticeably wider vocabulary", lower: "using a noticeably narrower vocabulary" },
  readingGrade: { higher: "speaking in a much more complex register", lower: "speaking in a much simpler register" },
};

function describe(name: string, evidence: ReadonlyArray<FlagEvidence>): string {
  const [first, second] = evidence;
  if (!first) return `${name} sounds unlike themselves here.`;

  const lead = PHRASING[first.metric][first.direction];
  if (!second) return `${name} is ${lead} here.`;

  const follow = PHRASING[second.metric][second.direction];
  return `${name} is ${lead} and ${follow} here.`;
}

export function findFlags(
  measurements: ReadonlyArray<SceneMeasurement>,
  baselines: ReadonlyArray<Baseline>,
  options: FlagOptions = {},
): Flag[] {
  const threshold = options.threshold ?? 2.5;
  const strongThreshold = options.strongThreshold ?? 3.5;
  const minSceneWords = options.minSceneWords ?? 60;
  const ignored = new Set(options.ignoredMetrics ?? []);

  const baselineFor = new Map(baselines.map((b) => [b.characterId, b]));
  const scenesFor = new Map<string, SceneMeasurement[]>();
  for (const measurement of measurements) {
    const list = scenesFor.get(measurement.characterId) ?? [];
    list.push(measurement);
    scenesFor.set(measurement.characterId, list);
  }

  const flags: Flag[] = [];

  for (const measurement of measurements) {
    if (measurement.wordCount < minSceneWords) continue;

    const baseline = baselineFor.get(measurement.characterId);
    if (!baseline?.isUsable) continue;

    // Judge the scene against the character's *other* scenes. Leaving it in
    // would let an extreme scene drag the mean toward itself and inflate the
    // spread, hiding the very deviation being looked for.
    const comparison = baselineExcludingScene(
      scenesFor.get(measurement.characterId) ?? [],
      measurement.sceneId,
      baseline.pooledSpread,
    );

    const evidence: FlagEvidence[] = [];

    for (const [metric, stats] of Object.entries(comparison) as Array<
      [ComparableMetric, NonNullable<Baseline["metrics"][ComparableMetric]>]
    >) {
      if (ignored.has(metric)) continue;

      const observed = measurement.metrics[metric];
      if (typeof observed !== "number" || !Number.isFinite(observed)) continue;

      const difference = observed - stats.mean;
      const audible = Math.abs(difference) >= MINIMUM_EFFECT[metric];

      /**
       * A character who has never varied on this metric has a spread of zero,
       * and dividing by it would give infinity for a difference of any size at
       * all. In that case there is no statistical question left to ask — the
       * only question is whether the change is big enough to hear, so the
       * practical test decides on its own.
       */
      const z = stats.spread > 0 ? difference / stats.spread : audible ? Math.sign(difference) * strongThreshold : 0;

      if (Math.abs(z) < threshold) continue;
      // The practical test: statistically far, but is it far enough to hear?
      if (!audible) continue;

      evidence.push({
        metric,
        label: METRIC_LABELS[metric],
        baseline: stats.mean,
        observed,
        z,
        direction: difference > 0 ? "higher" : "lower",
      });
    }

    if (evidence.length === 0) continue;

    evidence.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
    const peakZ = Math.abs(evidence[0]!.z);

    flags.push({
      characterId: measurement.characterId,
      sceneId: measurement.sceneId,
      chapterIndex: measurement.chapterIndex,
      sceneIndex: measurement.sceneIndex,
      // Several metrics moving together is a stronger signal than one moving
      // further, so both routes to "strong" are open.
      severity: peakZ >= strongThreshold || evidence.length >= 3 ? "strong" : "notable",
      peakZ,
      evidence,
      sceneWordCount: measurement.wordCount,
      // The scene being judged is not part of what it is judged against, so it
      // is not counted in the evidence either.
      baselineWordCount: baseline.wordCount - measurement.wordCount,
      baselineSceneCount: baseline.sceneCount - 1,
      summary: describe(baseline.name, evidence),
    });
  }

  return flags.sort((a, b) => b.peakZ - a.peakZ);
}
