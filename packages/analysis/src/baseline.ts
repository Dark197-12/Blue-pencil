import {
  COMPARABLE_METRICS,
  computeMetrics,
  type ComparableMetric,
  type Metrics,
} from "./metrics.js";

/**
 * Baselines: what a character normally sounds like, and how much they normally
 * vary.
 *
 * The naive version of this compares a scene against the character's overall
 * average and flags anything far from it. That flags almost everything, because
 * it has no idea how much a person's speech normally moves between scenes. A
 * character whose sentence length swings between 8 and 30 words across the book
 * is *consistently* variable; one who never leaves 14-16 is not. The same scene
 * at 25 words means something quite different for each.
 *
 * So a baseline is a distribution, not a number: the mean and spread of a
 * character's own per-scene values. A scene is judged against how far this
 * character normally strays, not against how far anyone might.
 *
 * That raises a second problem. A character in six scenes gives six numbers to
 * estimate a spread from, and a spread estimated from six numbers is itself
 * wildly uncertain — occasionally near zero by luck, at which point every scene
 * looks like a dramatic deviation. Partial pooling fixes it: each character's
 * own spread is blended toward the typical spread for that metric across the
 * whole cast, weighted by how many scenes they actually have. Characters with
 * plenty of evidence keep their own; thin ones borrow the cast's.
 */

export interface SceneSpeech {
  sceneId: string;
  /** Where this scene sits, for ordering and for showing the author. */
  chapterIndex: number;
  sceneIndex: number;
  passages: ReadonlyArray<string>;
}

export interface CharacterScenes {
  characterId: string;
  name: string;
  scenes: ReadonlyArray<SceneSpeech>;
}

export interface MetricBaseline {
  mean: number;
  /** Spread after pooling — what a deviation is measured against. */
  spread: number;
  /** The character's own spread, before pooling. Kept for transparency. */
  ownSpread: number;
  /** How much of the final spread came from this character rather than the cast. */
  ownWeight: number;
}

export interface Baseline {
  characterId: string;
  name: string;
  /** Scenes with enough speech to measure. */
  sceneCount: number;
  wordCount: number;
  metrics: Partial<Record<ComparableMetric, MetricBaseline>>;
  /** False when there is too little to judge anything against. */
  isUsable: boolean;
  /**
   * The cast-wide typical spread per metric, carried so a scene can be
   * re-scored against the character's *other* scenes without recomputing it.
   */
  pooledSpread: Partial<Record<ComparableMetric, number>>;
}

export interface SceneMeasurement {
  characterId: string;
  sceneId: string;
  chapterIndex: number;
  sceneIndex: number;
  wordCount: number;
  metrics: Metrics;
}

export interface BaselineOptions {
  /**
   * Words a character must speak in a scene before that scene is measured at
   * all. Below this the metrics are dominated by which sentences happened to
   * land there — a two-line exchange has a "mean sentence length" but it is
   * noise, not voice.
   */
  minSceneWords?: number;
  /** Scenes a character needs before they can be given a baseline. */
  minScenes?: number;
  /** Words a character needs overall. */
  minWords?: number;
  /**
   * Scene count at which a character's own spread is trusted half as much as
   * the cast's. More scenes than this and their own estimate dominates.
   */
  poolingStrength?: number;
}

const mean = (values: ReadonlyArray<number>) =>
  values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;

const sd = (values: ReadonlyArray<number>, average: number) => {
  if (values.length < 2) return 0;
  return Math.sqrt(values.reduce((s, v) => s + (v - average) ** 2, 0) / (values.length - 1));
};

const wordsIn = (passages: ReadonlyArray<string>) =>
  passages.reduce((sum, p) => sum + (p.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length, 0);

/** Measures each character in each scene they speak in. */
export function measureScenes(
  characters: ReadonlyArray<CharacterScenes>,
  options: BaselineOptions = {},
): SceneMeasurement[] {
  const minSceneWords = options.minSceneWords ?? 60;
  const measurements: SceneMeasurement[] = [];

  for (const character of characters) {
    for (const scene of character.scenes) {
      const wordCount = wordsIn(scene.passages);
      if (wordCount < minSceneWords) continue;
      measurements.push({
        characterId: character.characterId,
        sceneId: scene.sceneId,
        chapterIndex: scene.chapterIndex,
        sceneIndex: scene.sceneIndex,
        wordCount,
        metrics: computeMetrics(scene.passages),
      });
    }
  }

  return measurements;
}

/**
 * Builds a baseline per character from their per-scene measurements.
 *
 * The pooled spread for a metric is the median of every character's own
 * spread, rather than the mean — one erratic character would otherwise drag
 * the shared estimate up and make everybody else's flags harder to trigger.
 */
export function buildBaselines(
  characters: ReadonlyArray<CharacterScenes>,
  measurements: ReadonlyArray<SceneMeasurement>,
  options: BaselineOptions = {},
): Baseline[] {
  const minScenes = options.minScenes ?? 3;
  const minWords = options.minWords ?? 500;
  const poolingStrength = options.poolingStrength ?? 6;

  const byCharacter = new Map<string, SceneMeasurement[]>();
  for (const measurement of measurements) {
    const list = byCharacter.get(measurement.characterId) ?? [];
    list.push(measurement);
    byCharacter.set(measurement.characterId, list);
  }

  // Each character's own spread per metric, used to derive the pooled value.
  const ownSpreads = new Map<ComparableMetric, number[]>();
  for (const metric of COMPARABLE_METRICS) ownSpreads.set(metric, []);

  for (const [, scenes] of byCharacter) {
    if (scenes.length < minScenes) continue;
    for (const metric of COMPARABLE_METRICS) {
      const values = scenes
        .map((s) => s.metrics[metric])
        .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
      if (values.length < 2) continue;
      const spread = sd(values, mean(values));
      if (spread > 0) ownSpreads.get(metric)!.push(spread);
    }
  }

  const pooled = new Map<ComparableMetric, number>();
  for (const metric of COMPARABLE_METRICS) {
    const spreads = [...ownSpreads.get(metric)!].sort((a, b) => a - b);
    pooled.set(metric, spreads.length === 0 ? 0 : spreads[Math.floor(spreads.length / 2)]!);
  }

  return characters.map((character) => {
    const scenes = byCharacter.get(character.characterId) ?? [];
    const wordCount = scenes.reduce((sum, s) => sum + s.wordCount, 0);
    const metrics: Partial<Record<ComparableMetric, MetricBaseline>> = {};

    // Weight rises with evidence: at `poolingStrength` scenes the character's
    // own spread and the cast's count equally.
    const ownWeight = scenes.length / (scenes.length + poolingStrength);

    for (const metric of COMPARABLE_METRICS) {
      const values = scenes
        .map((s) => s.metrics[metric])
        .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
      if (values.length < 2) continue;

      const average = mean(values);
      const own = sd(values, average);
      const shared = pooled.get(metric) ?? 0;
      const spread = ownWeight * own + (1 - ownWeight) * shared;

      /**
       * A spread of zero is kept rather than discarded. It means this character
       * has never once varied on this metric, which is a strong statement about
       * them, not missing data — dropping it made a perfectly consistent
       * character impossible to flag however far they later strayed. What to do
       * about a division by zero is the flagging stage's problem, and it solves
       * it by falling back to whether the change is audible at all.
       */
      metrics[metric] = { mean: average, spread, ownSpread: own, ownWeight };
    }

    return {
      characterId: character.characterId,
      name: character.name,
      sceneCount: scenes.length,
      wordCount,
      metrics,
      isUsable: scenes.length >= minScenes && wordCount >= minWords,
      pooledSpread: Object.fromEntries(pooled) as Partial<Record<ComparableMetric, number>>,
    };
  });
}

/**
 * The baseline a single scene should be judged against: the character's other
 * scenes, with this one left out.
 *
 * Including a scene in the distribution it is being tested against hides
 * exactly the deviations worth finding. Seven identical scenes and one wildly
 * different one produce a mean pulled a seventh of the way toward the outlier
 * and a spread inflated by it — enough, in testing, to drop a doubling of
 * sentence length to 2.48 deviations and slip it under a 2.5 threshold. The
 * scene masks itself, and the more extreme it is the better it hides.
 */
export function baselineExcludingScene(
  own: ReadonlyArray<SceneMeasurement>,
  excludeSceneId: string,
  pooledSpread: Partial<Record<ComparableMetric, number>>,
  poolingStrength = 6,
): Partial<Record<ComparableMetric, MetricBaseline>> {
  const others = own.filter((m) => m.sceneId !== excludeSceneId);
  const result: Partial<Record<ComparableMetric, MetricBaseline>> = {};
  if (others.length < 2) return result;

  const ownWeight = others.length / (others.length + poolingStrength);

  for (const metric of COMPARABLE_METRICS) {
    const values = others
      .map((m) => m.metrics[metric])
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    if (values.length < 2) continue;

    const average = mean(values);
    const ownSpread = sd(values, average);
    const shared = pooledSpread[metric] ?? 0;

    result[metric] = {
      mean: average,
      spread: ownWeight * ownSpread + (1 - ownWeight) * shared,
      ownSpread,
      ownWeight,
    };
  }

  return result;
}
