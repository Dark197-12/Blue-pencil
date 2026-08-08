import { countWords } from "./normalize.js";
import { parseOrdinal } from "./roman.js";

/**
 * Splitting a manuscript into chapters and scenes.
 *
 * Finding lines that look like chapter headings is the easy part. The hard part
 * is that real books are full of lines that look like chapter headings and
 * aren't — most commonly a table of contents, which lists every heading in the
 * book and would otherwise double the chapter count.
 *
 * Two signals separate the real ones, both measured rather than guessed:
 *
 *   1. Content gap. Contents entries sit a line or two apart; real chapters are
 *      thousands of words apart. In our own fixtures the separation is stark —
 *      ~15 words between contents entries, ~2,600 between real chapters.
 *   2. Numbering restarts. A contents block runs I…XLIII and then the body
 *      starts again at I. Where one run is a near-duplicate of another and
 *      carries almost none of the book's text, it is front matter.
 *
 * The second signal is deliberately conservative: a book genuinely structured
 * as "Part One, Chapter 1 … Part Two, Chapter 1" also restarts its numbering,
 * and throwing half of it away would be much worse than keeping a stray heading.
 */

export interface ChapterCandidate {
  /** Heading text as it appears, e.g. "CHAPTER IV." */
  heading: string;
  /** Chapter number if one could be parsed. Null for unnumbered headings. */
  ordinal: number | null;
  /** Offset of the first character of the heading line. */
  headingStart: number;
  /** Offset just past the heading line's newline. */
  contentStart: number;
}

export interface Chapter {
  index: number;
  heading: string;
  ordinal: number | null;
  /** Offsets into the normalised source text. */
  start: number;
  end: number;
  wordCount: number;
}

export interface Scene {
  index: number;
  start: number;
  end: number;
  wordCount: number;
  /** How the break preceding this scene was found. The first scene is "chapter-start". */
  breakKind: "chapter-start" | "separator" | "blank-run";
}

export interface DetectOptions {
  /**
   * A heading followed by less prose than this is treated as a contents entry.
   * 250 words is comfortably above a contents line and far below any real
   * chapter; the shortest chapter in our fixtures is over 400.
   */
  minChapterWords?: number;
}

interface HeadingPattern {
  re: RegExp;
  /** Capture group holding the chapter number, or -1 when the pattern has none. */
  ordinalGroup: number;
  /** Reject the line unless an ordinal could actually be parsed from it. */
  requiresOrdinal?: boolean;
  /** Reject unless the line stands alone between blank lines. */
  requiresIsolation?: boolean;
  /**
   * Capture group holding the display heading, when the raw line carries syntax
   * the reader shouldn't see — the leading "#" of a Markdown heading, say.
   */
  headingGroup?: number;
}

/**
 * The `(?=[\s.:)\]—–-]|$)` lookahead after the ordinal matters more than it
 * looks. Without it the numeral alternative matches a *prefix* of an ordinary
 * word — "ACT DROP" yields "D", which is a valid Roman 500, and the leftover
 * "ROP" is quietly swallowed by the title group. Requiring a boundary forces
 * the token to be the whole word.
 */
const HEADING_PATTERNS: ReadonlyArray<HeadingPattern> = [
  // "CHAPTER IV.", "Chapter 12 — The Kitchen", "Chap. 3", and P&P's "Chapter I.]"
  {
    re: /^\s{0,8}(?:chapter|chap\.?|part|book|act)\s+([ivxlcdm]+|\d{1,4}|[a-z]+(?:[-\s][a-z]+)?)(?=[\s.:)\]—–-]|$)\s*[.:)\]—–-]*\s*(.*)$/i,
    ordinalGroup: 1,
    requiresOrdinal: true,
  },
  // Markdown headings, for .md manuscripts. The "#" is syntax, not title.
  { re: /^\s{0,3}#{1,3}\s+(.+?)\s*$/, ordinalGroup: -1, headingGroup: 1 },
  // A bare roman numeral or number alone on its line. Only counted when it sits
  // by itself between blank lines — otherwise page numbers and stray references
  // ("149.") read as chapter openings.
  { re: /^\s{0,8}([ivxlcdm]{1,8})\s*\.?\s*$/i, ordinalGroup: 1, requiresOrdinal: true, requiresIsolation: true },
  { re: /^\s{0,8}(\d{1,3})\s*\.?\s*$/, ordinalGroup: 1, requiresOrdinal: true, requiresIsolation: true },
];

/** Lines made only of separator glyphs: "***", "* * *", "---", "· · ·", "#". */
const SCENE_SEPARATOR = /^\s{0,8}(?:[*#~_\-—–·•§⁂✱]\s*){1,12}$/;

/** A separator needs at least this many glyphs, unless it repeats one glyph. */
function isSceneSeparator(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 40) return false;
  if (!SCENE_SEPARATOR.test(line)) return false;
  const glyphs = trimmed.replace(/\s/g, "");
  // A single hyphen or a lone "#" is far more likely to be prose or a heading.
  return glyphs.length >= 3 || /^[*§⁂✱•]$/.test(glyphs);
}

interface Line {
  text: string;
  start: number;
  end: number;
}

function splitLines(text: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text[i] === "\n") {
      lines.push({ text: text.slice(start, i), start, end: i });
      start = i + 1;
    }
  }
  return lines;
}

export function findChapterCandidates(text: string): ChapterCandidate[] {
  const lines = splitLines(text);
  const candidates: ChapterCandidate[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.text.trim();
    if (!trimmed || trimmed.length > 90) continue;

    const isolated = !lines[i - 1]?.text.trim() && !lines[i + 1]?.text.trim();

    for (const { re, ordinalGroup, requiresOrdinal, requiresIsolation, headingGroup } of HEADING_PATTERNS) {
      const match = re.exec(line.text);
      if (!match) continue;

      const ordinal = ordinalGroup > 0 ? parseOrdinal(match[ordinalGroup] ?? "") : null;

      // "Chapter" patterns must actually yield a number, or a line of dialogue
      // beginning "Part of me wanted to leave" reads as a heading.
      if (requiresOrdinal && ordinal === null) continue;
      if (requiresIsolation && !isolated) continue;

      candidates.push({
        heading: (headingGroup ? match[headingGroup]?.trim() : undefined) || trimmed,
        ordinal,
        headingStart: line.start,
        contentStart: Math.min(line.end + 1, text.length),
      });
      break;
    }
  }

  return candidates;
}

/** Groups candidates into runs, starting a new run wherever numbering goes backwards. */
function splitIntoRuns(candidates: ChapterCandidate[]): ChapterCandidate[][] {
  const runs: ChapterCandidate[][] = [];
  let current: ChapterCandidate[] = [];
  let lastOrdinal = -Infinity;

  for (const candidate of candidates) {
    if (candidate.ordinal !== null) {
      if (candidate.ordinal <= lastOrdinal && current.length > 0) {
        runs.push(current);
        current = [];
      }
      lastOrdinal = candidate.ordinal;
    }
    current.push(candidate);
  }

  if (current.length > 0) runs.push(current);
  return runs;
}

export function detectChapters(text: string, options: DetectOptions = {}): Chapter[] {
  const minChapterWords = options.minChapterWords ?? 250;
  const candidates = findChapterCandidates(text);

  if (candidates.length === 0) {
    const wordCount = countWords(text);
    return wordCount === 0 ? [] : [{ index: 0, heading: "Untitled", ordinal: null, start: 0, end: text.length, wordCount }];
  }

  // Drop headings with too little prose after them. The final candidate runs to
  // the end of the book, so it is measured against the real remaining text.
  const substantial = candidates.filter((candidate, i) => {
    const next = candidates[i + 1];
    const end = next ? next.headingStart : text.length;
    return countWords(text.slice(candidate.contentStart, end)) >= minChapterWords;
  });

  const kept = substantial.length > 0 ? substantial : candidates;

  // Resolve numbering restarts. Only discard a run when it is dwarfed by another
  // — a genuine multi-part book restarts its numbering too, and must survive.
  const runs = splitIntoRuns(kept);
  let chosen = kept;

  if (runs.length > 1) {
    const weights = runs.map((run) => {
      const first = run[0]!;
      const runIndex = kept.indexOf(run[run.length - 1]!);
      const next = kept[runIndex + 1];
      const end = next ? next.headingStart : text.length;
      return countWords(text.slice(first.contentStart, end));
    });

    const total = weights.reduce((sum, w) => sum + w, 0);
    const heaviest = Math.max(...weights);
    const survivors = runs.filter((_, i) => weights[i]! >= heaviest * 0.1 || weights[i]! >= total * 0.1);
    chosen = survivors.flat();
  }

  return chosen.map((candidate, i) => {
    const next = chosen[i + 1];
    const end = next ? next.headingStart : text.length;
    return {
      index: i,
      heading: candidate.heading,
      ordinal: candidate.ordinal,
      start: candidate.headingStart,
      end,
      wordCount: countWords(text.slice(candidate.contentStart, end)),
    };
  });
}

/**
 * Splits a chapter into scenes. Explicit separator glyphs are the reliable
 * signal; a run of blank lines is a weaker one, used only when the author never
 * used a glyph anywhere in the chapter. Books that use neither come back as a
 * single scene, which is the honest answer rather than an invented split.
 */
export interface SceneOptions {
  /** Fragments below this many words are folded into a neighbour. */
  minSceneWords?: number;
  /**
   * Treat a run of blank lines as a scene break when the chapter contains no
   * separator glyph. Off by default, and deliberately so.
   *
   * Blank lines are not a reliable signal in practice. In Pride and Prejudice
   * they appear around every inset letter — the block-quoted correspondence is
   * followed by extra spacing before the narrative resumes — which invents a
   * scene break in the middle of a continuous scene. Typesetters leave extra
   * space for all sorts of reasons an author never intended as a beat.
   *
   * Under-splitting is the safe direction here: a missed break leaves a scene
   * slightly too long, whereas an invented one produces a short, spurious
   * "scene" that later phases would try to build voice statistics from. The
   * structure editor lets an author add any break the detector missed.
   */
  useBlankRuns?: boolean;
}

export function detectScenes(
  text: string,
  start = 0,
  end = text.length,
  options: SceneOptions = {},
): Scene[] {
  const { minSceneWords = 50, useBlankRuns = false } = options;
  const body = text.slice(start, end);
  const lines = splitLines(body);

  const breaks: Array<{ offset: number; kind: Scene["breakKind"] }> = [];
  let sawSeparator = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (isSceneSeparator(line.text)) {
      sawSeparator = true;
      breaks.push({ offset: start + Math.min(line.end + 1, body.length), kind: "separator" });
    }
  }

  if (!sawSeparator && useBlankRuns) {
    // Normalisation collapses runs of blank lines to exactly two, so three
    // consecutive newlines means extra space was left here deliberately.
    const blankRun = /\n[ \t]*\n[ \t]*\n/g;
    let match: RegExpExecArray | null;
    while ((match = blankRun.exec(body)) !== null) {
      breaks.push({ offset: start + match.index + match[0].length, kind: "blank-run" });
    }
  }

  const sorted = [...breaks].sort((a, b) => a.offset - b.offset);
  const boundaries = [start, ...sorted.map((b) => b.offset), end];

  interface Draft {
    start: number;
    end: number;
    wordCount: number;
    breakKind: Scene["breakKind"];
  }

  const drafts: Draft[] = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const sceneStart = boundaries[i]!;
    const sceneEnd = boundaries[i + 1]!;
    if (sceneEnd <= sceneStart) continue;

    drafts.push({
      start: sceneStart,
      end: sceneEnd,
      wordCount: countWords(text.slice(sceneStart, sceneEnd)),
      breakKind: i === 0 ? "chapter-start" : (sorted[i - 1]?.kind ?? "separator"),
    });
  }

  /**
   * Merge away fragments. A chapter heading, an "[Illustration]" line, or the
   * blank space a typesetter left around one is not a scene — but it sits
   * between blank lines and looks exactly like a break. Anything shorter than a
   * paragraph or two folds into its neighbour rather than becoming a scene that
   * later phases would try to build statistics from.
   */
  const merged: Draft[] = [];
  for (const draft of drafts) {
    const previous = merged[merged.length - 1];
    if (previous && (draft.wordCount < minSceneWords || previous.wordCount < minSceneWords)) {
      previous.end = draft.end;
      previous.wordCount += draft.wordCount;
      continue;
    }
    merged.push({ ...draft });
  }

  const scenes = merged
    .filter((draft) => draft.wordCount > 0)
    .map((draft, index) => ({
      index,
      start: draft.start,
      end: draft.end,
      wordCount: draft.wordCount,
      breakKind: index === 0 ? ("chapter-start" as const) : draft.breakKind,
    }));

  if (scenes.length === 0) {
    return [{ index: 0, start, end, wordCount: countWords(body), breakKind: "chapter-start" }];
  }

  // The merge pass must never lose text: scenes still tile the whole range.
  scenes[0]!.start = start;
  scenes[scenes.length - 1]!.end = end;

  return scenes;
}

export interface Region {
  start: number;
  end: number;
}

/**
 * Bracketed editorial blocks that transcribers add and authors never wrote —
 * `[Illustration: … ]` and copyright notices.
 *
 * These matter more than they look. A Gutenberg illustration block contains a
 * *caption*, and the caption is usually a line of dialogue quoted from the
 * surrounding chapter. Pride and Prejudice has 162 such blocks holding 62
 * quoted lines, 41 of which duplicate a real line elsewhere in the book. Left
 * in, they inflate the dialogue count and double-count those words in every
 * per-character measurement built on it.
 *
 * A block can span several paragraphs, so it is matched by bracket balance
 * rather than by line, with a length cap so one unclosed bracket cannot swallow
 * the rest of the manuscript.
 */
const EDITORIAL_OPENER = /\[\s*(?:illustration|frontispiece|_?copyright)/gi;
const MAX_EDITORIAL_REGION = 2000;

export function findEditorialRegions(text: string): Region[] {
  const regions: Region[] = [];
  const opener = new RegExp(EDITORIAL_OPENER.source, "gi");
  let match: RegExpExecArray | null;

  while ((match = opener.exec(text)) !== null) {
    const start = match.index;
    const limit = Math.min(text.length, start + MAX_EDITORIAL_REGION);

    let depth = 0;
    let balancedEnd = -1;
    for (let i = start; i < limit; i++) {
      const char = text[i];
      if (char === "[") depth++;
      else if (char === "]") {
        depth--;
        if (depth === 0) {
          balancedEnd = i + 1;
          break;
        }
      }
    }

    // Brackets that never balance mean a malformed block, not a licence to
    // suppress the next two thousand characters of the author's prose. Fall
    // back to the opening paragraph alone.
    let end: number;
    if (balancedEnd !== -1) {
      end = balancedEnd;
    } else {
      const paragraphEnd = text.indexOf("\n\n", start);
      end = paragraphEnd === -1 ? Math.min(text.length, limit) : paragraphEnd;
    }

    regions.push({ start, end });
    opener.lastIndex = Math.max(end, start + 1);
  }

  return regions;
}

/** True when an offset falls inside any of the (sorted, non-overlapping) regions. */
export function isInRegion(offset: number, regions: ReadonlyArray<Region>): boolean {
  let low = 0;
  let high = regions.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const region = regions[mid]!;
    if (offset < region.start) high = mid - 1;
    else if (offset >= region.end) low = mid + 1;
    else return true;
  }
  return false;
}

export interface Paragraph {
  start: number;
  end: number;
  text: string;
  /** Gutenberg leaves editorial inserts in the prose; they are not the author's. */
  isEditorialArtifact: boolean;
}

export function splitParagraphs(text: string, start = 0, end = text.length): Paragraph[] {
  const body = text.slice(start, end);
  const paragraphs: Paragraph[] = [];

  // Computed over the whole text, so a block that opens before this slice still
  // marks the paragraphs of it that fall inside.
  const regions = findEditorialRegions(text);

  const re = /[^\n]+(?:\n[^\n]+)*/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    const raw = match[0];
    const trimmed = raw.trim();
    if (!trimmed) continue;

    const offset = start + match.index;
    paragraphs.push({
      start: offset,
      end: offset + raw.length,
      text: trimmed.replace(/\n/g, " "),
      isEditorialArtifact: isInRegion(offset, regions) || /^\[.*\]$/.test(trimmed),
    });
  }

  return paragraphs;
}
