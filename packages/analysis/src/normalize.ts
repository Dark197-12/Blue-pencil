/**
 * Text normalisation — the first thing that happens to an uploaded manuscript,
 * and the only place in the codebase allowed to worry about encoding oddities.
 *
 * The guiding rule is *lossless for anything we later measure*. Curly quotes,
 * ellipses and em dashes all survive: quotes delimit dialogue, and "…" and "—"
 * are themselves metrics (trailing off, interruption). We only fold away
 * differences that carry no meaning — line endings, exotic spaces, stray BOMs.
 */

/** Space-like characters that should behave as a plain space. */
const UNICODE_SPACES =
  /[   -   　   ​]/g;

/** Quote variants that carry no distinct meaning for us, mapped to canonical forms. */
const QUOTE_FOLDS: ReadonlyArray<readonly [RegExp, string]> = [
  [/[“‟«〝]/g, "“"], // “ ‟ « 〝  → “
  [/[”»〞]/g, "”"], //       ” »  〞 → ”
  [/[‘‛]/g, "‘"], //             ‘ ‛    → ‘
  [/[’ʼ]/g, "’"], //             ’ ʼ    → ’
  [/[„〟]/g, "„"], //             „ 〟   → „
];

export function normalizeText(input: string): string {
  let text = input;

  // Strip a byte-order mark if the file was saved with one.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  // Canonical composition, so "é" is one code point and not e + combining mark.
  text = text.normalize("NFC");

  // Windows and classic-Mac line endings.
  text = text.replace(/\r\n?/g, "\n");

  text = text.replace(UNICODE_SPACES, " ").replace(/\t/g, " ");

  for (const [pattern, replacement] of QUOTE_FOLDS) {
    text = text.replace(pattern, replacement);
  }

  // Trailing whitespace on a line is never meaningful and breaks blank-line
  // detection, which is how we find paragraph and scene boundaries.
  text = text.replace(/[ ]+$/gm, "");

  // Three or more blank lines usually means a scene break the author spaced out
  // by eye. Collapse to exactly two so the scene splitter sees one signal.
  text = text.replace(/\n{4,}/g, "\n\n\n");

  return text.trim() + "\n";
}

/**
 * Project Gutenberg wraps every text in a licence header and footer. They are
 * marked with sentinel lines, but the wording has drifted across decades of
 * releases, so match loosely and fall back to returning the text untouched.
 */
export function stripGutenbergBoilerplate(text: string): string {
  const start = /^\*\*\*\s*START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK.*?\*\*\*\s*$/im;
  const end = /^\*\*\*\s*END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK.*?\*\*\*\s*$/im;

  let body = text;

  const startMatch = start.exec(body);
  if (startMatch) body = body.slice(startMatch.index + startMatch[0].length);

  const endMatch = end.exec(body);
  if (endMatch) body = body.slice(0, endMatch.index);

  // Older transcriptions add a "Produced by ..." credit after the sentinel.
  body = body.replace(/^\s*Produced by .*?(?:\n\s*\n)/is, "");

  return body.trim();
}

/** Metadata Gutenberg records in its header, useful for pre-filling the import form. */
export interface GutenbergMeta {
  title?: string;
  author?: string;
  language?: string;
}

export function readGutenbergMeta(text: string): GutenbergMeta {
  const head = text.slice(0, 4000);
  const field = (name: string): string | undefined => {
    const match = new RegExp(`^${name}:\\s*(.+)$`, "im").exec(head);
    return match?.[1]?.trim();
  };

  const meta: GutenbergMeta = {};
  const title = field("Title");
  const author = field("Author");
  const language = field("Language");
  if (title) meta.title = title;
  if (author) meta.author = author;
  if (language) meta.language = language;
  return meta;
}

/** Words, counted the way a manuscript word count is counted. */
export function countWords(text: string): number {
  const matches = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
  return matches ? matches.length : 0;
}
