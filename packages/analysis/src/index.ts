export {
  measureScenes,
  buildBaselines,
  baselineExcludingScene,
  type Baseline,
  type MetricBaseline,
  type SceneMeasurement,
  type CharacterScenes,
  type SceneSpeech,
  type BaselineOptions,
} from "./baseline.js";

export {
  findFlags,
  MINIMUM_EFFECT,
  type Flag,
  type FlagEvidence,
  type FlagOptions,
  type Severity,
} from "./flags.js";

export {
  buildProfiles,
  findSignatureWords,
  voiceSimilarity,
  type VoiceProfile,
  type SignatureWord,
  type CharacterSpeech,
  type ProfileOptions,
} from "./profile.js";

export {
  computeMetrics,
  movingAverageTtr,
  fleschKincaidGrade,
  COMPARABLE_METRICS,
  METRIC_LABELS,
  type Metrics,
  type ComparableMetric,
} from "./metrics.js";

export {
  splitSentences,
  tokenizeWords,
  countSyllables,
  countSyllablesIn,
  type Sentence,
} from "./tokenize.js";

export {
  resolveByConstraints,
  namesMentioned,
  type CastInfo,
  type ConstraintInput,
  type ConstraintResult,
  type ConstraintOptions,
} from "./constraints.js";

export {
  inferGenders,
  genderOfPronoun,
  type Gender,
  type GenderEvidence,
  type InferGenderOptions,
} from "./gender.js";

export {
  inferByAlternation,
  findExchanges,
  type Anchored,
  type AlternationResult,
  type AlternationOptions,
} from "./alternation.js";

export {
  normalizeText,
  stripGutenbergBoilerplate,
  readGutenbergMeta,
  countWords,
  type GutenbergMeta,
} from "./normalize.js";

export { romanToInt, wordsToInt, parseOrdinal } from "./roman.js";

export {
  buildCast,
  compareNames,
  type Cast,
  type CastMember,
  type AliasSuggestion,
  type BuildCastOptions,
} from "./characters.js";

export {
  detectQuoteStyle,
  extractDialogue,
  type DialogueLine,
  type Segment,
  type SpeechTag,
  type SpeakerKind,
  type QuoteStyle,
  type ExtractOptions,
} from "./dialogue.js";

export {
  findChapterCandidates,
  detectChapters,
  detectScenes,
  splitParagraphs,
  findEditorialRegions,
  isInRegion,
  type Chapter,
  type ChapterCandidate,
  type Scene,
  type Paragraph,
  type Region,
  type DetectOptions,
} from "./structure.js";

export {
  findArcs,
  spearman,
  type Arc,
  type ArcPoint,
  type ArcOptions,
} from "./arc.js";

export {
  inferAddressees,
  measureContexts,
  findContextShifts,
  type ContextLine,
  type AddressedLine,
  type AddresseeBasis,
  type ContextMeasurement,
  type ContextShift,
  type ContextEvidence,
  type ContextOptions,
} from "./context.js";
