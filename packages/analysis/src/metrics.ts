import { countSyllablesIn, splitSentences, tokenizeWords } from "./tokenize.js";

/**
 * Measuring a character's voice.
 *
 * Each metric is a pure function of the words a character speaks. Two rules
 * shape the whole file:
 *
 *   Everything is a rate, never a total. A character with twice as much
 *   dialogue is not twice as formal, and comparing raw counts across a cast
 *   would rank people by how much they talk.
 *
 *   Nothing is length-biased. The obvious measure of vocabulary richness —
 *   unique words over total words — falls as a sample grows, purely
 *   arithmetically, so on raw counts every minor character looks richer than
 *   the protagonist. That one is handled explicitly below.
 */

export interface Metrics {
  wordCount: number;
  sentenceCount: number;

  /** Mean words per sentence. */
  meanSentenceLength: number;
  /**
   * Standard deviation of sentence length. Often more telling than the mean:
   * a character who alternates one-word snaps with long speeches has a very
   * different voice from one who is uniformly medium.
   */
  sentenceLengthVariation: number;

  /** Contractions per 100 words. */
  contractionRate: number;
  /** Words of three or more syllables, per 100 words. */
  polysyllabicRate: number;
  /** Words of Latin or French origin by suffix, per 100 words. */
  latinateRate: number;
  /** Hedges and qualifiers ("perhaps", "rather", "I suppose"), per 100 words. */
  hedgeRate: number;
  /** Intensifiers ("very", "extremely", "quite"), per 100 words. */
  intensifierRate: number;
  /** Filler and discourse markers ("well", "you know", "I mean"), per 100 words. */
  fillerRate: number;
  /** Profanity, per 100 words. */
  profanityRate: number;

  /** Questions per 100 sentences. */
  questionRate: number;
  /** Exclamations per 100 sentences. */
  exclamationRate: number;
  /** Sentences trailing off, per 100 sentences. */
  trailOffRate: number;
  /** Sentences cut short, per 100 sentences. */
  interruptionRate: number;

  /**
   * Vocabulary richness, corrected for sample size — see `movingAverageTtr`.
   * Null when there is too little speech to measure it honestly.
   */
  vocabularyRichness: number | null;

  /** Flesch-Kincaid grade level of the character's speech. */
  readingGrade: number;
}

const CONTRACTIONS =
  /\b(?:\w+['’](?:s|t|d|ll|re|ve|m)|(?:ain|can|don|won|shan|isn|aren|wasn|weren|hasn|haven|hadn|doesn|didn|couldn|wouldn|shouldn|mustn|needn|daren)['’]t)\b/giu;

/** Suffixes that mark a word as Latin- or French-derived rather than Germanic. */
const LATINATE_SUFFIX =
  /(?:tion|sion|ment|ance|ence|ity|ology|ular|ary|ory|ious|eous|able|ible|ate|ise|ize|fy|ficent|itude|escence)$/i;

const HEDGES = new Set([
  "perhaps", "maybe", "possibly", "probably", "rather", "somewhat", "quite",
  "apparently", "seemingly", "presumably", "arguably", "supposedly",
  "approximately", "roughly", "generally", "usually", "sometimes", "often",
  "believe", "suppose", "imagine", "think", "guess", "reckon", "seems",
  "might", "may", "could", "would", "should", "sort", "kind",
]);

const INTENSIFIERS = new Set([
  "very", "extremely", "incredibly", "utterly", "absolutely", "completely",
  "totally", "entirely", "thoroughly", "exceedingly", "immensely", "vastly",
  "terribly", "awfully", "dreadfully", "remarkably", "particularly",
  "especially", "truly", "really", "so", "such", "most", "highly", "deeply",
]);

const FILLERS = new Set([
  "well", "oh", "ah", "um", "uh", "er", "hmm", "look", "listen", "say",
  "anyway", "anyhow", "actually", "basically", "literally", "honestly",
  "obviously", "clearly", "frankly", "indeed", "why", "nay",
]);

/**
 * Kept deliberately mild and short. The point is to measure how often a
 * character swears relative to the rest of the cast, and a longer list would
 * mostly add words that are ordinary in other senses.
 */
const PROFANITY = new Set([
  "damn", "damned", "damnation", "hell", "bloody", "bastard", "bugger",
  "blast", "blasted", "devil", "christ", "god", "goddamn", "shit", "fuck",
  "fucking", "arse", "ass", "crap", "piss", "bitch",
]);

const MULTIWORD_HEDGES = [
  "i suppose", "i think", "i believe", "i imagine", "i daresay", "i expect",
  "sort of", "kind of", "more or less", "in a way", "if you like",
];

const MULTIWORD_FILLERS = [
  "you know", "i mean", "you see", "of course", "after all", "to be sure",
];

const per = (count: number, total: number, scale = 100) =>
  total === 0 ? 0 : (count / total) * scale;

/**
 * Moving-average type-token ratio.
 *
 * Plain unique/total is the usual measure of vocabulary richness and it cannot
 * be compared between speakers: as a sample grows the ratio falls no matter
 * how varied the writing is, because common words repeat. On Pride and
 * Prejudice that alone would rank a maid with forty words as having richer
 * vocabulary than Elizabeth.
 *
 * MATTR fixes it by averaging the ratio over a fixed-size sliding window, so
 * every character is measured on the same amount of text. Below one window it
 * returns null rather than an incomparable number.
 */
export function movingAverageTtr(words: ReadonlyArray<string>, window = 50): number | null {
  if (words.length < window) return null;

  const lower = words.map((w) => w.toLowerCase());
  const counts = new Map<string, number>();
  let distinct = 0;

  const add = (word: string) => {
    const next = (counts.get(word) ?? 0) + 1;
    counts.set(word, next);
    if (next === 1) distinct++;
  };
  const remove = (word: string) => {
    const next = (counts.get(word) ?? 0) - 1;
    if (next <= 0) {
      counts.delete(word);
      distinct--;
    } else {
      counts.set(word, next);
    }
  };

  for (let i = 0; i < window; i++) add(lower[i]!);

  let total = distinct / window;
  let windows = 1;

  for (let i = window; i < lower.length; i++) {
    add(lower[i]!);
    remove(lower[i - window]!);
    total += distinct / window;
    windows++;
  }

  return total / windows;
}

/** Flesch-Kincaid grade level. Standard formula. */
export function fleschKincaidGrade(words: number, sentences: number, syllables: number): number {
  if (words === 0 || sentences === 0) return 0;
  return 0.39 * (words / sentences) + 11.8 * (syllables / words) - 15.59;
}

function countMultiword(haystack: string, phrases: ReadonlyArray<string>): number {
  let count = 0;
  for (const phrase of phrases) {
    const pattern = new RegExp(`\\b${phrase.replace(/ /g, "\\s+")}\\b`, "gi");
    count += (haystack.match(pattern) ?? []).length;
  }
  return count;
}

/**
 * Measures one body of speech. `passages` is every utterance by one character;
 * they are measured together but sentences never run across the boundary
 * between two separate utterances.
 */
export function computeMetrics(passages: ReadonlyArray<string>): Metrics {
  const sentences = passages.flatMap((passage) => splitSentences(passage));
  const words = passages.flatMap((passage) => tokenizeWords(passage));
  const lower = words.map((w) => w.toLowerCase());
  const joined = passages.join(" ").toLowerCase();

  const wordCount = words.length;
  const sentenceCount = sentences.length;

  const lengths = sentences.map((s) => tokenizeWords(s.text).length);
  const meanLength = lengths.length === 0 ? 0 : lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const variance =
    lengths.length < 2
      ? 0
      : lengths.reduce((sum, n) => sum + (n - meanLength) ** 2, 0) / (lengths.length - 1);

  const contractions = (passages.join(" ").match(CONTRACTIONS) ?? []).length;
  const polysyllabic = words.filter((w) => countSyllablesIn([w]) >= 3).length;
  const latinate = words.filter((w) => w.length > 4 && LATINATE_SUFFIX.test(w)).length;

  const hedges = lower.filter((w) => HEDGES.has(w)).length + countMultiword(joined, MULTIWORD_HEDGES);
  const intensifiers = lower.filter((w) => INTENSIFIERS.has(w)).length;
  const fillers = lower.filter((w) => FILLERS.has(w)).length + countMultiword(joined, MULTIWORD_FILLERS);
  const profanity = lower.filter((w) => PROFANITY.has(w)).length;

  const endings = sentences.map((s) => s.ending);
  const syllables = countSyllablesIn(words);

  return {
    wordCount,
    sentenceCount,
    meanSentenceLength: meanLength,
    sentenceLengthVariation: Math.sqrt(variance),
    contractionRate: per(contractions, wordCount),
    polysyllabicRate: per(polysyllabic, wordCount),
    latinateRate: per(latinate, wordCount),
    hedgeRate: per(hedges, wordCount),
    intensifierRate: per(intensifiers, wordCount),
    fillerRate: per(fillers, wordCount),
    profanityRate: per(profanity, wordCount),
    questionRate: per(endings.filter((e) => e === "question").length, sentenceCount),
    exclamationRate: per(endings.filter((e) => e === "exclamation").length, sentenceCount),
    trailOffRate: per(endings.filter((e) => e === "trailed-off").length, sentenceCount),
    interruptionRate: per(endings.filter((e) => e === "interrupted").length, sentenceCount),
    vocabularyRichness: movingAverageTtr(words),
    readingGrade: fleschKincaidGrade(wordCount, sentenceCount, syllables),
  };
}

/** The metric keys that can be compared across characters. */
export const COMPARABLE_METRICS = [
  "meanSentenceLength",
  "sentenceLengthVariation",
  "contractionRate",
  "polysyllabicRate",
  "latinateRate",
  "hedgeRate",
  "intensifierRate",
  "fillerRate",
  "profanityRate",
  "questionRate",
  "exclamationRate",
  "trailOffRate",
  "interruptionRate",
  "vocabularyRichness",
  "readingGrade",
] as const satisfies ReadonlyArray<keyof Metrics>;

export type ComparableMetric = (typeof COMPARABLE_METRICS)[number];

/** Human labels, used in the interface and in explanations of a flag. */
export const METRIC_LABELS: Record<ComparableMetric, string> = {
  meanSentenceLength: "Sentence length",
  sentenceLengthVariation: "Sentence length variation",
  contractionRate: "Contractions",
  polysyllabicRate: "Long words",
  latinateRate: "Latinate vocabulary",
  hedgeRate: "Hedging",
  intensifierRate: "Intensifiers",
  fillerRate: "Filler words",
  profanityRate: "Profanity",
  questionRate: "Questions",
  exclamationRate: "Exclamations",
  trailOffRate: "Trailing off",
  interruptionRate: "Being cut short",
  vocabularyRichness: "Vocabulary richness",
  readingGrade: "Reading grade",
};
