import {
  COMPARABLE_METRICS,
  computeMetrics,
  type ComparableMetric,
  type Metrics,
} from "./metrics.js";
import { tokenizeWords } from "./tokenize.js";

/**
 * Turning per-character measurements into a comparable profile.
 *
 * A raw metric is not much use on its own: nobody knows whether 13.8 words per
 * sentence is long. It becomes meaningful only against the rest of the cast,
 * so every metric is also expressed as a z-score — how many standard
 * deviations from the cast mean — and that is what the interface shows.
 *
 * The cast average is computed from the characters themselves, not from some
 * external corpus, because the question a writer is asking is "does this person
 * sound different from the others in *my* book".
 */

export interface CharacterSpeech {
  name: string;
  /** Every utterance attributed to this character, in order. */
  passages: ReadonlyArray<string>;
}

export interface SignatureWord {
  word: string;
  /** How often this character says it. */
  count: number;
  /** Rate per 1,000 words, so characters of different sizes compare. */
  rate: number;
  /**
   * How distinctive it is: this character's rate against the rest of the cast's.
   * 3 means they say it three times as often as everyone else.
   */
  distinctiveness: number;
}

export interface VoiceProfile {
  name: string;
  metrics: Metrics;
  /** Metric values as standard deviations from the cast mean. */
  z: Partial<Record<ComparableMetric, number>>;
  signatureWords: SignatureWord[];
  /** False when there is too little speech for the numbers to be stable. */
  isReliable: boolean;
}

export interface ProfileOptions {
  /**
   * Words of dialogue below which a profile is marked unreliable.
   *
   * Sentence-length variance and vocabulary richness need a few hundred words
   * before they settle; under this a character's numbers move a lot with each
   * new line, and flagging them as inconsistent would be measuring the sample
   * size rather than the voice.
   */
  minWords?: number;
  /** How many signature words to keep per character. */
  signatureCount?: number;
  /** A word must be said at least this often to be a signature. */
  minSignatureCount?: number;
}

/**
 * Words too common to be anyone's signature. Kept short on purpose: a long
 * stop list would remove exactly the function words — "shall", "must",
 * "perhaps" — that most distinguish one speaker from another.
 */
const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "of", "to", "in", "on", "at",
  "for", "with", "by", "from", "as", "is", "was", "are", "were", "be", "been",
  "am", "it", "its", "this", "that", "these", "those", "there", "here",
  "i", "you", "he", "she", "we", "they", "me", "him", "her", "us", "them",
  "my", "your", "his", "our", "their", "mine", "yours", "hers", "ours",
  "not", "no", "yes", "do", "does", "did", "have", "has", "had", "will",
  "s", "t", "d", "ll", "re", "ve", "m",
]);

function mean(values: ReadonlyArray<number>): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

function standardDeviation(values: ReadonlyArray<number>, average: number): number {
  if (values.length < 2) return 0;
  const variance = values.reduce((sum, v) => sum + (v - average) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * Words this character says far more than the rest of the cast.
 *
 * This is a ratio of rates rather than classical TF-IDF. TF-IDF asks how many
 * *documents* a term appears in, which in a cast of twenty is a very coarse
 * signal — a word either appears in most characters' speech or almost none.
 * Comparing how *often* each says it is both finer and easier to explain: "she
 * says 'obviously' three times as much as anyone else" is a sentence a writer
 * can act on.
 */
export function findSignatureWords(
  own: ReadonlyArray<string>,
  others: ReadonlyArray<string>,
  options: ProfileOptions = {},
): SignatureWord[] {
  const limit = options.signatureCount ?? 8;
  const minCount = options.minSignatureCount ?? 3;

  const countWords = (passages: ReadonlyArray<string>) => {
    const counts = new Map<string, number>();
    let total = 0;
    for (const passage of passages) {
      for (const word of tokenizeWords(passage)) {
        const key = word.toLowerCase();
        if (STOP_WORDS.has(key) || key.length < 2) continue;
        counts.set(key, (counts.get(key) ?? 0) + 1);
        total++;
      }
    }
    return { counts, total };
  };

  const mine = countWords(own);
  const rest = countWords(others);
  if (mine.total === 0) return [];

  const results: SignatureWord[] = [];

  for (const [word, count] of mine.counts) {
    if (count < minCount) continue;

    const myRate = count / mine.total;
    const theirRate = (rest.counts.get(word) ?? 0) / Math.max(1, rest.total);

    // Smoothing: a word nobody else uses would otherwise divide by zero and
    // rank every hapax above every genuinely characteristic word.
    const smoothing = 1 / Math.max(1, rest.total);
    const distinctiveness = myRate / (theirRate + smoothing);

    if (distinctiveness <= 1.5) continue;
    results.push({ word, count, rate: myRate * 1000, distinctiveness });
  }

  return results
    .sort((a, b) => b.distinctiveness - a.distinctiveness || b.count - a.count)
    .slice(0, limit);
}

/** Builds a profile for every character, with each metric scored against the cast. */
export function buildProfiles(
  speech: ReadonlyArray<CharacterSpeech>,
  options: ProfileOptions = {},
): VoiceProfile[] {
  const minWords = options.minWords ?? 500;

  const measured = speech.map((character) => ({
    name: character.name,
    passages: character.passages,
    metrics: computeMetrics(character.passages),
  }));

  // Only characters with enough speech shape the cast average. Otherwise a
  // handful of one-line servants drag the mean toward their own noise.
  const reliable = measured.filter((c) => c.metrics.wordCount >= minWords);
  const basis = reliable.length >= 2 ? reliable : measured;

  const stats = new Map<ComparableMetric, { mean: number; sd: number; usable: boolean }>();
  for (const metric of COMPARABLE_METRICS) {
    const values = basis
      .map((c) => c.metrics[metric])
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    const average = mean(values);
    const sd = standardDeviation(values, average);

    /**
     * A metric almost nobody registers on cannot be scored.
     *
     * In a cast of four where three never swear and one says "Good God" once,
     * the standard deviation is tiny and that single oath lands at +1.5σ — a
     * headline finding manufactured out of one word. The distribution has to
     * have some spread across several characters before a deviation from it
     * means anything.
     */
    const nonZero = values.filter((v) => v !== 0).length;
    const usable = sd > 0 && nonZero >= 2;

    stats.set(metric, { mean: average, sd, usable });
  }

  return measured.map((character) => {
    const z: Partial<Record<ComparableMetric, number>> = {};
    for (const metric of COMPARABLE_METRICS) {
      const value = character.metrics[metric];
      const stat = stats.get(metric);
      if (typeof value !== "number" || !stat || !stat.usable) continue;
      z[metric] = (value - stat.mean) / stat.sd;
    }

    const others = measured
      .filter((other) => other.name !== character.name)
      .flatMap((other) => other.passages);

    return {
      name: character.name,
      metrics: character.metrics,
      z,
      signatureWords: findSignatureWords(character.passages, others, options),
      isReliable: character.metrics.wordCount >= minWords,
    };
  });
}

/**
 * How similar two voices are, 0–100.
 *
 * Distance is the root-mean-square difference in z-scores, so it is in units of
 * "standard deviations of this cast" and does not care that sentence length is
 * counted in words and contractions per hundred.
 *
 * The mapping from distance to score decays exponentially rather than
 * linearly. A linear `1 - distance/2` looks reasonable and is not: genuinely
 * distinct characters sit three or four standard deviations apart, so
 * everything past two clamps to zero and the ranking is destroyed — Mr.
 * Collins scored exactly as similar to Darcy as to Mrs. Bennet, which is the
 * one comparison this function exists to get right. Decay keeps every pair
 * ordered no matter how far apart they are.
 */
export function voiceSimilarity(a: VoiceProfile, b: VoiceProfile): number {
  const shared = COMPARABLE_METRICS.filter(
    (metric) => typeof a.z[metric] === "number" && typeof b.z[metric] === "number",
  );

  // Nothing measurable tells them apart, so nothing tells them apart.
  if (shared.length === 0) return 100;

  const sumSquares = shared.reduce((sum, metric) => sum + (a.z[metric]! - b.z[metric]!) ** 2, 0);
  const distance = Math.sqrt(sumSquares / shared.length);

  return Math.round(100 * Math.exp(-distance / 1.5));
}
