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
