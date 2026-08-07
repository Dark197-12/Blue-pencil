import type { DialogueLine } from "./dialogue.js";

/**
 * Turning speech-tag names into a proposed cast.
 *
 * Two jobs, both deliberately cautious:
 *
 *   Reject non-names. A capitalised word at the start of a sentence looks
 *   exactly like a name to a pattern — "By-and-by I says", "Everybody was
 *   quiet". A stop list catches the obvious classes, and a frequency floor
 *   catches the rest, because a real speaker speaks more than once.
 *
 *   Group aliases without merging distinct people. This is where a naive rule
 *   does real damage: in Pride and Prejudice, "Mr. Bennet", "Mrs. Bennet" and
 *   "Miss Bennet" are three different characters, and "Bingley" and "Miss
 *   Bingley" are a brother and sister. Anything keyed on the surname alone
 *   silently fuses a family into one person and every voice measurement
 *   downstream becomes meaningless. So merging happens only on evidence, and
 *   the merges it cannot prove are offered to the author as suggestions.
 */

export interface CastMember {
  /** The most frequent spelling, used as the display name. */
  name: string;
  /** Every spelling seen, most frequent first. */
  aliases: string[];
  /** Number of dialogue lines tagged with any of these spellings. */
  lineCount: number;
  /** Words spoken across those lines. */
  wordCount: number;
}

export interface AliasSuggestion {
  names: [string, string];
  reason: string;
}

export interface Cast {
  members: CastMember[];
  /** Pairs that may be the same person, for the author to confirm or reject. */
  suggestions: AliasSuggestion[];
  /** Mentions rejected as non-names, kept for transparency. */
  rejected: Array<{ name: string; count: number; reason: string }>;
}

const TITLES = new Set([
  "mr", "mrs", "ms", "miss", "dr", "prof", "rev", "sir", "lady", "lord",
  "aunt", "uncle", "colonel", "captain", "major", "general", "sergeant",
  "father", "mother", "sister", "brother", "king", "queen", "prince",
  "princess", "judge", "detective", "inspector", "officer", "sheriff",
]);

/** Titles that cannot refer to the same person. */
const GENDERED: Record<string, string> = {
  mr: "m", sir: "m", lord: "m", uncle: "m", father: "m", brother: "m",
  king: "m", prince: "m",
  mrs: "f", ms: "f", miss: "f", lady: "f", aunt: "f", mother: "f",
  sister: "f", queen: "f", princess: "f",
};

/**
 * Words that pattern-match as names but never are. Sentence-initial adverbs
 * and indefinite pronouns are the two classes that actually show up.
 */
const NOT_NAMES = new Set([
  "everybody", "everyone", "somebody", "someone", "nobody", "anybody", "anyone",
  "by-and-by", "well", "yes", "no", "oh", "ah", "but", "and", "so", "then",
  "there", "here", "now", "still", "however", "meanwhile", "afterwards",
  "presently", "conscience", "everything", "nothing", "something", "anything",
  "one", "both", "all", "none", "each", "either", "neither", "who", "what",
  "why", "how", "when", "where", "this", "that", "these", "those", "it",
  "god", "heaven", "lord",
]);

interface ParsedName {
  title: string | null;
  tokens: string[];
}

function parseName(raw: string): ParsedName {
  const cleaned = raw.trim().replace(/\s+/g, " ");
  const parts = cleaned.split(" ");
  const first = parts[0]?.replace(/\.$/, "").toLowerCase() ?? "";

  if (TITLES.has(first) && parts.length > 1) {
    return { title: first, tokens: parts.slice(1).map((t) => t.toLowerCase()) };
  }
  return { title: null, tokens: parts.map((t) => t.replace(/\.$/, "").toLowerCase()) };
}

/** True when two titles rule out the same person ("Mr." vs "Mrs."). */
function titlesConflict(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  if (a === b) return false;
  const genderA = GENDERED[a];
  const genderB = GENDERED[b];
  if (genderA && genderB && genderA !== genderB) return true;
  // "Miss Bennet" and "Mrs. Bennet" share a gender but are still not the same
  // person — one is married, the other is not.
  return true;
}

type Relation = "same" | "maybe" | "different";

/**
 * How two tagged names relate. Positive answers require evidence: an identical
 * name, or a given name that is the first word of a fuller form. Sharing only a
 * surname is explicitly *not* enough — that is the Bennet family trap.
 */
export function compareNames(a: string, b: string): Relation {
  const left = parseName(a);
  const right = parseName(b);

  const sameTokens =
    left.tokens.length === right.tokens.length &&
    left.tokens.every((token, i) => token === right.tokens[i]);

  if (sameTokens) {
    if (titlesConflict(left.title, right.title)) return "different";
    // One titled, one bare, same surname. "Mr. Bennet" and "Bennet" are
    // probably one person; "Miss Bingley" and "Bingley" are a sister and her
    // brother. Nothing in the names themselves decides it, so don't pretend.
    if ((left.title === null) !== (right.title === null)) return "maybe";
    return "same";
  }

  // "Elizabeth" against "Elizabeth Bennet": a bare given name extending into a
  // full name. Only when neither carries a title, since "Miss Bingley" against
  // "Bingley" is a sister and a brother, not one person.
  if (!left.title && !right.title) {
    const shorter = left.tokens.length <= right.tokens.length ? left.tokens : right.tokens;
    const longer = left.tokens.length <= right.tokens.length ? right.tokens : left.tokens;
    if (shorter.length === 1 && longer.length > 1 && shorter[0] === longer[0]) return "same";
    // Shares a surname only — could be family, could be one person shortened.
    if (shorter.length === 1 && longer.length > 1 && shorter[0] === longer[longer.length - 1]) {
      return "maybe";
    }
  }

  // A titled name against a bare one sharing the surname: "Mr. Bennet" and
  // "Bennet" probably match, but "Miss Bingley" and "Bingley" do not. Left to
  // the author.
  const leftSurname = left.tokens[left.tokens.length - 1];
  const rightSurname = right.tokens[right.tokens.length - 1];
  if (leftSurname && leftSurname === rightSurname && !titlesConflict(left.title, right.title)) {
    return "maybe";
  }

  return "different";
}

export interface BuildCastOptions {
  /**
   * A speaker must be tagged at least this many times to be proposed. One-off
   * capitalised words are almost always sentence-initial adverbs, not people.
   */
  minLines?: number;
}

const wordCountOf = (text: string) => (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;

export function buildCast(lines: DialogueLine[], options: BuildCastOptions = {}): Cast {
  const minLines = options.minLines ?? 2;

  const tallies = new Map<string, { lines: number; words: number }>();
  for (const line of lines) {
    if (line.tag?.kind !== "name") continue;
    const key = line.tag.raw.trim();
    const entry = tallies.get(key) ?? { lines: 0, words: 0 };
    entry.lines += 1;
    entry.words += wordCountOf(line.text);
    tallies.set(key, entry);
  }

  const rejected: Cast["rejected"] = [];
  const kept: Array<{ name: string; lines: number; words: number }> = [];

  for (const [name, tally] of tallies) {
    const bare = parseName(name);
    const lowered = name.toLowerCase().replace(/\.$/, "");

    if (NOT_NAMES.has(lowered) || (bare.tokens.length === 1 && NOT_NAMES.has(bare.tokens[0] ?? ""))) {
      rejected.push({ name, count: tally.lines, reason: "not a name" });
      continue;
    }
    if (tally.lines < minLines) {
      rejected.push({ name, count: tally.lines, reason: `tagged only ${tally.lines}×` });
      continue;
    }
    kept.push({ name, lines: tally.lines, words: tally.words });
  }

  kept.sort((a, b) => b.lines - a.lines);

  // Union-find over the names we can prove are the same person.
  const parent = new Map<string, string>();
  const find = (name: string): string => {
    const seen = parent.get(name);
    if (!seen || seen === name) return name;
    const root = find(seen);
    parent.set(name, root);
    return root;
  };
  const union = (a: string, b: string) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootB, rootA);
  };
  for (const entry of kept) parent.set(entry.name, entry.name);

  const suggestions: AliasSuggestion[] = [];
  for (let i = 0; i < kept.length; i++) {
    for (let j = i + 1; j < kept.length; j++) {
      const a = kept[i]!.name;
      const b = kept[j]!.name;
      const relation = compareNames(a, b);
      if (relation === "same") union(a, b);
      else if (relation === "maybe") {
        suggestions.push({ names: [a, b], reason: "These share a surname — same person, or family?" });
      }
    }
  }

  const groups = new Map<string, Array<{ name: string; lines: number; words: number }>>();
  for (const entry of kept) {
    const root = find(entry.name);
    const group = groups.get(root) ?? [];
    group.push(entry);
    groups.set(root, group);
  }

  const members: CastMember[] = [...groups.values()].map((group) => {
    const ordered = [...group].sort((a, b) => b.lines - a.lines);
    return {
      name: ordered[0]!.name,
      aliases: ordered.map((entry) => entry.name),
      lineCount: ordered.reduce((sum, entry) => sum + entry.lines, 0),
      wordCount: ordered.reduce((sum, entry) => sum + entry.words, 0),
    };
  });

  members.sort((a, b) => b.wordCount - a.wordCount);

  // Drop suggestions for pairs that turned out to be the same group anyway.
  const openSuggestions = suggestions.filter((s) => find(s.names[0]) !== find(s.names[1]));

  return {
    members,
    suggestions: openSuggestions,
    rejected: rejected.sort((a, b) => b.count - a.count),
  };
}
