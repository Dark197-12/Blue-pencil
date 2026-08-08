/**
 * Splitting dialogue into sentences, words and syllables.
 *
 * Everything measured about a character's voice is counted on top of this, so
 * a mistake here does not produce an obviously wrong number — it produces a
 * plausible one. Sentence length in particular is the single most-used metric
 * in the tool, and it is exactly a count of these two things divided.
 *
 * Dialogue is harder to split than narration. It is full of abbreviations
 * ("Mr. Bennet"), it breaks off mid-sentence ("I only meant—"), it trails away
 * ("I suppose…"), and it runs several sentences into one utterance. Each of
 * those is handled deliberately below rather than left to a period-and-space
 * rule.
 */

/** Abbreviations whose full stop does not end a sentence. */
const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "rev", "hon", "st", "jr", "sr",
  "col", "gen", "capt", "lt", "sgt", "maj", "adm", "gov", "sen", "rep",
  // "no" is deliberately absent. It would cover "No. 5", but in dialogue
  // `He said "no." Then he left.` is far commoner, and treating it as an
  // abbreviation silently welds two sentences into one.
  "vs", "etc", "eg", "ie", "cf", "al", "inc", "ltd", "co", "vol",
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
  "mon", "tue", "wed", "thu", "fri", "sat", "sun",
]);

export interface Sentence {
  text: string;
  /** Offset within the input string. */
  start: number;
  end: number;
  /** How the sentence finished. */
  ending: "statement" | "question" | "exclamation" | "trailed-off" | "interrupted" | "unterminated";
}

/**
 * Splits a passage of speech into sentences.
 *
 * The two endings that matter beyond punctuation type are trailing off ("…")
 * and being cut short ("—"). Both are voice characteristics in their own right
 * — a character who is forever interrupted sounds different from one who is
 * not — so they are recorded rather than normalised away.
 */
export function splitSentences(text: string): Sentence[] {
  const sentences: Sentence[] = [];
  const trimmed = text.trim();
  if (!trimmed) return sentences;

  let start = 0;
  let i = 0;

  const push = (end: number, ending: Sentence["ending"]) => {
    const body = text.slice(start, end).trim();
    if (body) {
      sentences.push({ text: body, start, end, ending });
    }
    start = end;
  };

  while (i < text.length) {
    const char = text[i]!;

    // Trailing off: "I suppose…" or "I suppose..."
    if (char === "…" || (char === "." && text.slice(i, i + 3) === "...")) {
      const width = char === "…" ? 1 : 3;
      let end = i + width;
      // Absorb a closing quote or bracket that belongs to this sentence.
      while (end < text.length && /["'”’)\]]/.test(text[end]!)) end++;
      push(end, "trailed-off");
      i = end;
      continue;
    }

    // Cut short: "I only meant—"
    if (char === "—" || char === "–" || text.slice(i, i + 2) === "--") {
      const width = text.slice(i, i + 2) === "--" ? 2 : 1;
      const rest = text.slice(i + width).trim();
      // A dash mid-sentence ("the thing — whatever it was — moved") is not an
      // ending; only one at the very end of the speech is an interruption.
      if (rest.length === 0) {
        push(i + width, "interrupted");
        i += width;
        continue;
      }
      i += width;
      continue;
    }

    if (char === "?" || char === "!") {
      let end = i + 1;
      // Runs like "?!" or "!!!" are one ending.
      while (end < text.length && /[?!]/.test(text[end]!)) end++;
      const questionish = text.slice(i, end).includes("?");
      while (end < text.length && /["'”’)\]]/.test(text[end]!)) end++;
      push(end, questionish ? "question" : "exclamation");
      i = end;
      continue;
    }

    if (char === ".") {
      // Look back at the word this stop belongs to.
      const before = text.slice(start, i);
      const lastWord = /([\p{L}]+)$/u.exec(before)?.[1]?.toLowerCase() ?? "";

      // "Mr." — not an ending. A single initial ("J. R. R.") likewise.
      if (ABBREVIATIONS.has(lastWord) || lastWord.length === 1) {
        i++;
        continue;
      }

      // A decimal point, not a full stop.
      if (/\d/.test(text[i - 1] ?? "") && /\d/.test(text[i + 1] ?? "")) {
        i++;
        continue;
      }

      let end = i + 1;
      while (end < text.length && /["'”’)\]]/.test(text[end]!)) end++;
      push(end, "statement");
      i = end;
      continue;
    }

    i++;
  }

  if (start < text.length && text.slice(start).trim()) {
    push(text.length, "unterminated");
  }

  return sentences;
}

/**
 * Words, as a person counting a manuscript would count them.
 *
 * Hyphenated compounds and contractions are one word each: "well-worn" and
 * "don't" are single choices by the writer, and splitting them would inflate
 * word counts and deflate average word length for no good reason.
 */
export function tokenizeWords(text: string): string[] {
  // Gutenberg marks emphasis with underscores; they are not part of the word.
  const cleaned = text.replace(/_/g, "");
  return cleaned.match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu) ?? [];
}

const VOWEL_GROUPS = /[aeiouy]+/g;

/**
 * Estimates syllables in a word.
 *
 * Used only by readability scores, which are themselves approximations, so a
 * heuristic is appropriate — but the common failure cases are handled, because
 * an undercount on every long word would bias the score in one direction
 * rather than adding noise.
 */
export function countSyllables(word: string): number {
  const clean = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!clean) return 0;
  if (clean.length <= 3) return 1;

  let working = clean;

  // "-ed" is usually silent ("walked") unless it follows t or d ("wanted").
  working = working.replace(/(?<![td])ed$/, "").replace(/(?<![td])es$/, "");

  // A trailing "e" is normally silent ("nine", "make"). The exception is a
  // consonant followed by "le", where the e carries its own syllable —
  // "table" and "little" are two syllables, not one.
  if (!/[^aeiou]le$/.test(working)) {
    working = working.replace(/e$/, "");
  }

  if (!working) working = clean;

  const groups = working.match(VOWEL_GROUPS);
  return Math.max(1, groups ? groups.length : 0);
}

export function countSyllablesIn(words: ReadonlyArray<string>): number {
  return words.reduce((sum, word) => sum + countSyllables(word), 0);
}
