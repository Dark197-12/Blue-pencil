/**
 * Finding dialogue and, where the text says so outright, who spoke it.
 *
 * This is tier 1 of three. It only claims a speaker when the prose names one in
 * a speech tag — "…," said Elizabeth. That is the one case where attribution is
 * a fact rather than an inference, and it is worth keeping separate from the
 * guesswork so later phases can weight it accordingly.
 *
 * Two shapes in real prose drive most of the design:
 *
 *   Split utterances. `"My dear Mr. Bennet," said his lady, "have you heard…"`
 *   is one speech interrupted by its own tag. Treating the halves as two lines
 *   would double-count the speaker and cut sentences in half — which would then
 *   corrupt every sentence-length measurement built on top.
 *
 *   Relational speakers. Austen writes "said his lady", "cried her mother",
 *   "returned she" far more often than she writes a name. These cannot be
 *   resolved without context, so they are recorded verbatim and left
 *   unattributed rather than dropped — Phase 3 resolves them.
 */

export type QuoteStyle = "curly-double" | "straight-double" | "curly-single";

export interface Segment {
  start: number;
  end: number;
}

export type SpeakerKind = "name" | "pronoun" | "descriptor";

export interface SpeechTag {
  /** Exactly as written: "Elizabeth", "Mr. Bennet", "his wife", "she". */
  raw: string;
  kind: SpeakerKind;
  verb: string;
  /** Where the tag sits relative to the speech. */
  position: "before" | "after";
}

export interface DialogueLine {
  /** Quoted spans making up this one utterance, in order. */
  segments: Segment[];
  /** Offsets covering the utterance including any interrupting tag. */
  start: number;
  end: number;
  /** The spoken words only, tags and quote marks removed. */
  text: string;
  /** Present when a speech tag named someone. */
  tag: SpeechTag | null;
}

/**
 * Verbs that introduce speech. "Thought" is deliberately absent: it appears 112
 * times in Pride and Prejudice, almost always as ordinary narration ("she
 * thought it over"), and interior monologue is not dialogue for our purposes.
 */
const SPEECH_VERBS = [
  "said", "says", "asked", "asks", "replied", "replies", "answered", "answers",
  "cried", "cries", "exclaimed", "shouted", "called", "whispered", "murmured",
  "muttered", "remarked", "observed", "added", "returned", "continued",
  "repeated", "rejoined", "protested", "insisted", "declared", "demanded",
  "inquired", "enquired", "responded", "began", "went on", "put in",
  "admitted", "agreed", "offered", "urged", "warned", "snapped", "growled",
  "hissed", "sighed", "breathed", "ventured", "mused", "told", "explained",
  "suggested", "concluded", "interrupted", "countered", "confessed",
] as const;

const VERB_ALT = SPEECH_VERBS.join("|");

/** Titles that bind to the name after them: "Mr. Bennet", "Lady Catherine". */
const TITLE =
  "(?:Mr|Mrs|Ms|Miss|Dr|Prof|Rev|Sir|Lady|Lord|Aunt|Uncle|Colonel|Captain|Major|General|Sergeant|Father|Mother|Sister|Brother|King|Queen|Prince|Princess|Judge|Detective|Inspector|Officer|Sheriff)";

/** A capitalised name, optionally titled and optionally multi-word. */
const NAME = `(?:${TITLE}\\.?\\s+)?[A-Z][\\p{L}'’-]+(?:\\s+(?:de|van|von|del|della|di|la|le)\\s+[A-Z][\\p{L}'’-]+|\\s+[A-Z][\\p{L}'’-]+){0,2}`;

const PRONOUN = "(?:he|she|they|I|we|it)";

/**
 * "his wife", "her mother", "the old man", "my father".
 *
 * The stop list keeps the phrase to the noun itself. Without it a greedy match
 * swallows whatever follows — "said his lady to him one day" yields the speaker
 * "his lady to him", which Phase 3 then has to resolve as if it were a name.
 */
const DESCRIPTOR_STOP =
  "(?:to|of|in|at|for|with|and|but|as|on|from|by|when|who|that|which|after|before|while|then|there)";
const DESCRIPTOR = `(?:his|her|their|its|my|our|your|the)\\s+(?!${DESCRIPTOR_STOP}\\b)[a-z]+(?:\\s+(?!${DESCRIPTOR_STOP}\\b)[a-z]+)?`;

const QUOTE_PAIRS: Record<QuoteStyle, { open: string; close: string }> = {
  "curly-double": { open: "“", close: "”" },
  "straight-double": { open: '"', close: '"' },
  "curly-single": { open: "‘", close: "’" },
};

/**
 * Which quotation convention the manuscript uses. Getting this wrong finds no
 * dialogue at all, so it is measured from the text rather than assumed.
 */
export function detectQuoteStyle(text: string): QuoteStyle {
  const curlyDouble = (text.match(/“/g) ?? []).length;
  const straight = (text.match(/"/g) ?? []).length;
  const curlySingleOpen = (text.match(/‘/g) ?? []).length;

  if (curlyDouble >= 10 && curlyDouble >= curlySingleOpen) return "curly-double";
  if (curlySingleOpen >= 10 && curlySingleOpen > curlyDouble) return "curly-single";
  if (straight >= 10) return "straight-double";
  return "curly-double";
}

/** Locates quoted spans. Straight quotes have no direction, so they alternate. */
function findQuotedSpans(text: string, style: QuoteStyle): Segment[] {
  const { open, close } = QUOTE_PAIRS[style];
  const spans: Segment[] = [];

  if (open === close) {
    let openIndex: number | null = null;
    for (let i = 0; i < text.length; i++) {
      if (text[i] !== open) continue;
      if (openIndex === null) {
        openIndex = i;
      } else {
        spans.push({ start: openIndex, end: i + 1 });
        openIndex = null;
      }
    }
    return spans;
  }

  /**
   * Directional quotes do not nest — they continue.
   *
   * A speech running over several paragraphs opens each one with “ and closes
   * only at the very end. Pride and Prejudice has 32 more opening marks than
   * closing ones for exactly this reason. Counting depth treats each
   * continuation as a nested quote, so the depth never returns to zero and a
   * single "span" swallows the rest of the book — 646,326 characters, in the
   * version of this that shipped for about ten minutes.
   *
   * So there is no depth: an opening mark while a quote is already open ends
   * the previous span at the paragraph break and starts a new one.
   */
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (char === open) {
      if (start === -1) {
        start = i;
      } else {
        const paragraphBreak = text.lastIndexOf("\n\n", i);
        spans.push({ start, end: paragraphBreak > start ? paragraphBreak : i });
        start = i;
      }
    } else if (char === close && start !== -1) {
      spans.push({ start, end: i + 1 });
      start = -1;
    }
  }

  // A quote still open at the end of the text — close it at its paragraph end
  // so the utterance is not lost entirely.
  if (start !== -1) {
    const paragraphEnd = text.indexOf("\n\n", start);
    spans.push({ start, end: paragraphEnd === -1 ? text.length : paragraphEnd });
  }

  return spans;
}

/**
 * Manuscripts are hard-wrapped, so a name regularly straddles a line break:
 * "Mr.\nDarcy". Left as-is it becomes a separate speaker from "Darcy", and the
 * real character quietly loses attributions to a phantom one.
 */
function cleanName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

function classifySpeaker(raw: string): SpeakerKind {
  const token = raw.trim();
  if (new RegExp(`^${PRONOUN}$`, "iu").test(token)) return "pronoun";
  if (/^[A-Z]/u.test(token)) return "name";
  return "descriptor";
}

/**
 * Reads a speech tag from the text immediately after a closing quote.
 * Handles both `said Elizabeth` and `Elizabeth said`, with optional adverbs
 * ("said Lydia, stoutly") and trailing clauses ("said she, when the door was…").
 */
function tagAfter(following: string): SpeechTag | null {
  const inverted = new RegExp(
    `^[,;:—–-]?\\s*(?:${VERB_ALT})\\b\\s+(${NAME}|${PRONOUN}|${DESCRIPTOR})`,
    "u",
  );
  const normal = new RegExp(
    `^[,;:—–-]?\\s*(${NAME}|${PRONOUN}|${DESCRIPTOR})\\s+(?:${VERB_ALT})\\b`,
    "u",
  );

  const invertedMatch = inverted.exec(following);
  if (invertedMatch?.[1]) {
    const verb = new RegExp(`(${VERB_ALT})`, "u").exec(following)?.[1] ?? "said";
    const raw = cleanName(invertedMatch[1]);
    return { raw, kind: classifySpeaker(raw), verb, position: "after" };
  }

  const normalMatch = normal.exec(following);
  if (normalMatch?.[1]) {
    const verb = new RegExp(`(${VERB_ALT})`, "u").exec(following)?.[1] ?? "said";
    const raw = cleanName(normalMatch[1]);
    return { raw, kind: classifySpeaker(raw), verb, position: "after" };
  }

  return null;
}

/** Reads a tag sitting before an opening quote: `Elizabeth said, "…"`. */
function tagBefore(preceding: string): SpeechTag | null {
  const normal = new RegExp(
    `(${NAME}|${PRONOUN}|${DESCRIPTOR})\\s+(${VERB_ALT})\\b[^.?!"“”]{0,40}[,:—–-]?\\s*$`,
    "u",
  );
  const inverted = new RegExp(
    `(?:${VERB_ALT})\\s+(${NAME})[^.?!"“”]{0,40}[,:—–-]?\\s*$`,
    "u",
  );

  const match = normal.exec(preceding);
  if (match?.[1]) {
    const raw = cleanName(match[1]);
    return { raw, kind: classifySpeaker(raw), verb: match[2] ?? "said", position: "before" };
  }

  const invertedMatch = inverted.exec(preceding);
  if (invertedMatch?.[1]) {
    const verb = new RegExp(`(${VERB_ALT})`, "u").exec(preceding)?.[1] ?? "said";
    const raw = cleanName(invertedMatch[1]);
    return { raw, kind: classifySpeaker(raw), verb, position: "before" };
  }

  return null;
}

/** Strips quote marks and Gutenberg's `_emphasis_` markers from spoken text. */
function spokenText(text: string, segments: Segment[]): string {
  return segments
    .map((segment) => text.slice(segment.start, segment.end))
    .join(" ")
    .replace(/^[“”‘’"']|[“”‘’"']$/g, "")
    .replace(/[“”"]/g, "")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export interface ExtractOptions {
  quoteStyle?: QuoteStyle;
  /** Offset added to every position, for extracting within a slice. */
  offset?: number;
}

export function extractDialogue(text: string, options: ExtractOptions = {}): DialogueLine[] {
  const style = options.quoteStyle ?? detectQuoteStyle(text);
  const base = options.offset ?? 0;
  const spans = findQuotedSpans(text, style);
  const lines: DialogueLine[] = [];

  let index = 0;
  while (index < spans.length) {
    const first = spans[index]!;
    const segments: Segment[] = [first];
    let tag: SpeechTag | null = null;
    let end = first.end;

    // Look at what follows the closing quote, up to the end of the sentence.
    let between = text.slice(first.end, Math.min(first.end + 90, text.length));
    const paragraphBreak = between.indexOf("\n\n");
    if (paragraphBreak !== -1) between = between.slice(0, paragraphBreak);

    tag = tagAfter(between);

    // A split utterance: tag, then the speech resumes in a new quoted span that
    // continues the same sentence — signalled by a lowercase opening word.
    let cursor = index;
    while (cursor + 1 < spans.length) {
      const next = spans[cursor + 1]!;
      const gap = text.slice(spans[cursor]!.end, next.start);
      if (gap.includes("\n\n") || gap.length > 90) break;

      const resumesMidSentence = /^[“‘"']?\s*[a-z]/u.test(text.slice(next.start, next.start + 3));
      const gapIsTag = new RegExp(`\\b(?:${VERB_ALT})\\b`, "u").test(gap);
      if (!resumesMidSentence || !gapIsTag) break;

      segments.push(next);
      end = next.end;
      cursor++;
    }
    index = cursor;

    if (!tag) {
      const preceding = text.slice(Math.max(0, first.start - 120), first.start);
      const lastBreak = preceding.lastIndexOf("\n\n");
      tag = tagBefore(lastBreak === -1 ? preceding : preceding.slice(lastBreak));
    }

    const body = spokenText(text, segments);
    if (body.length > 0) {
      lines.push({
        segments: segments.map((s) => ({ start: s.start + base, end: s.end + base })),
        start: first.start + base,
        end: end + base,
        text: body,
        tag,
      });
    }

    index++;
  }

  return lines;
}
