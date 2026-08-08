import type { DialogueLine } from "./dialogue.js";
import { genderOfPronoun, type Gender } from "./gender.js";

/**
 * Tier 2.5: resolving a speaker by eliminating everyone it cannot be.
 *
 * Where alternation reads the shape of a conversation, this reads its content.
 * Three constraints, each free and each individually weak, which together
 * settle a surprising number of lines:
 *
 *   Gender. "said she" cannot be a man. 190 lines of Pride and Prejudice carry
 *   a bare pronoun tag and nothing else.
 *
 *   Address. A speaker does not address themselves. "My dear Mr. Bennet, have
 *   you heard…" says nothing about who is talking but rules out Mr. Bennet
 *   completely, and 274 unattributed lines name somebody.
 *
 *   Adjacency. The person who just finished speaking is rarely the next to
 *   speak without the prose saying so.
 *
 *   Presence. Only people the conversation has actually involved are
 *   candidates. Without this the constraints have twenty-one people to whittle
 *   down and almost never reach one.
 *
 * An answer is claimed only when exactly one candidate survives. Two survivors
 * is not a coin toss to be won — it is a line for the review queue.
 */

export interface CastInfo {
  name: string;
  aliases: ReadonlyArray<string>;
  gender: Gender;
}

export interface ConstraintInput {
  line: DialogueLine;
  /** Already-known speaker, from a tag or alternation. */
  speaker: string | null;
}

/**
 * Measured accuracy of this method — 57 correct of 73 against known answers
 * (see `scripts/eval-attribution.mjs`). As with alternation it is a property of
 * the method: scoring lines individually by how many constraints agreed
 * produced a number that ran backwards, 79% on one constraint and 0% on two.
 */
export const CONSTRAINT_ACCURACY = 0.78;

export interface ConstraintResult {
  index: number;
  speaker: string;
  confidence: number;
  /** Which constraints did the eliminating, for the review queue to show. */
  reasons: string[];
}

export interface ConstraintOptions {
  /** Lines either side that count as "the same conversation". */
  presenceWindow?: number;
  /** Characters of narration that still count as the same exchange. */
  maxGap?: number;
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, (ch) => `\\${ch}`);

/**
 * Names of characters mentioned inside a line of dialogue.
 *
 * No attempt is made to separate a vocative ("My dear Jane,") from a reference
 * ("Jane is coming"). Both rule the named person out as the speaker for the
 * same underlying reason — people rarely address or discuss themselves by name
 * — and telling them apart reliably needs a parser we do not have.
 */
export function namesMentioned(text: string, cast: ReadonlyArray<CastInfo>): Set<string> {
  const found = new Set<string>();

  for (const character of cast) {
    for (const alias of character.aliases) {
      // Short aliases produce false hits: "Mary" inside "Maryland", and any
      // three-letter name inside ordinary words.
      if (alias.length < 4) continue;
      if (new RegExp(`\\b${escapeRegExp(alias)}\\b`, "i").test(text)) {
        found.add(character.name);
        break;
      }
    }
  }

  return found;
}

export function resolveByConstraints(
  lines: ReadonlyArray<ConstraintInput>,
  cast: ReadonlyArray<CastInfo>,
  options: ConstraintOptions = {},
): ConstraintResult[] {
  const presenceWindow = options.presenceWindow ?? 6;
  const maxGap = options.maxGap ?? 600;
  const byName = new Map(cast.map((character) => [character.name, character]));
  const results: ConstraintResult[] = [];

  for (let i = 0; i < lines.length; i++) {
    const entry = lines[i]!;
    if (entry.speaker) continue;

    /**
     * Who is in this conversation — and only ever people who have actually
     * been heard to speak in it.
     *
     * Being *mentioned* nearby is not evidence of being present. The first
     * chapter of Pride and Prejudice discusses Mr. Bingley continuously while
     * he is nowhere near the house, so counting those as evidence of presence
     * mentions as presence and confidently assigned "My dear Mr. Bennet, have
     * you heard that Netherfield Park is let at last?" — Mrs. Bennet's line,
     * and the most famous opening in English fiction — to Bingley himself.
     *
     * Mentions are used for elimination further down, never for inclusion.
     */
    const present = new Set<string>();
    for (let j = Math.max(0, i - presenceWindow); j <= Math.min(lines.length - 1, i + presenceWindow); j++) {
      if (j === i) continue;
      const neighbour = lines[j]!;
      if (!neighbour.speaker) continue;

      // Stop at a break in the conversation: someone speaking five pages later
      // is not a candidate for this line.
      const gap =
        j < i
          ? entry.line.start - neighbour.line.end
          : neighbour.line.start - entry.line.end;
      if (gap > maxGap * Math.abs(j - i)) continue;

      present.add(neighbour.speaker);
    }

    if (present.size < 2) continue;

    let candidates = [...present];
    const reasons: string[] = [];

    // ---- gender -----------------------------------------------------------
    const pronounGender = entry.line.tag?.kind === "pronoun" ? genderOfPronoun(entry.line.tag.raw) : null;
    if (pronounGender) {
      const filtered = candidates.filter((name) => byName.get(name)?.gender === pronounGender);
      // Only apply it if the gender of the survivors is actually known —
      // otherwise an unresolved gender silently eliminates the right answer.
      if (filtered.length > 0 && filtered.length < candidates.length) {
        candidates = filtered;
        reasons.push(`the text says “${entry.line.tag!.raw}”`);
      }
    }

    // ---- address ----------------------------------------------------------
    const addressed = namesMentioned(entry.line.text, cast);
    if (addressed.size > 0) {
      const filtered = candidates.filter((name) => !addressed.has(name));
      if (filtered.length > 0 && filtered.length < candidates.length) {
        candidates = filtered;
        reasons.push(`speaks to ${[...addressed].join(" and ")}`);
      }
    }

    // ---- adjacency --------------------------------------------------------
    const previous = lines[i - 1];
    const gapBefore = previous ? entry.line.start - previous.line.end : Infinity;
    if (previous?.speaker && gapBefore <= maxGap) {
      const filtered = candidates.filter((name) => name !== previous.speaker);
      if (filtered.length > 0 && filtered.length < candidates.length) {
        candidates = filtered;
        reasons.push(`${previous.speaker} just spoke`);
      }
    }

    if (candidates.length !== 1 || reasons.length === 0) continue;

    results.push({
      index: i,
      speaker: candidates[0]!,
      confidence: CONSTRAINT_ACCURACY,
      reasons,
    });
  }

  return results;
}
