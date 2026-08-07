export {
  normalizeText,
  stripGutenbergBoilerplate,
  readGutenbergMeta,
  countWords,
  type GutenbergMeta,
} from "./normalize.js";

export { romanToInt, wordsToInt, parseOrdinal } from "./roman.js";

export {
  findChapterCandidates,
  detectChapters,
  detectScenes,
  splitParagraphs,
  type Chapter,
  type ChapterCandidate,
  type Scene,
  type Paragraph,
  type DetectOptions,
} from "./structure.js";
