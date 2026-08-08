import type { DialogueLine } from "./dialogue.js";

/**
 * Tier 2: inferring speakers from the shape of a conversation.
 *
 * When two people talk, their lines alternate. Given one line whose speaker the
 * prose named outright, the lines around it can be read off by parity. This is
 * the only inference available without understanding the words themselves.
 *
 * Two things bound how far it goes, both measured on Pride and Prejudice rather
 * than assumed:
 *
 *   Alternation is local, not scene-wide. A "scene" in a book with no scene
 *   breaks is a whole chapter, and chapters have a median of two but up to six
 *   speakers. Keying on scene participants covers 25% of unattributed lines;
 *   keying on the back-and-forth exchange itself covers about the same but is
 *   right for the right reasons, and degrades sensibly on modern manuscripts
 *   that do mark their scenes.
 *
 *   It needs two anchors. An exchange where the prose never names anyone, or
 *   names only one person, has nothing to alternate between. Most exchanges in
 *   Austen are like that — only 27 of 222 carry exactly two named speakers — so
 *   tier 2 recovers roughly a quarter of what is missing and no more. The rest
 *   is tier 3's problem.
 *
 * The parity rule is strict: an exchange whose anchors disagree about parity is
 * left alone entirely. Somebody spoke twice in a row, or a third person joined,
 * and a wrong speaker is far worse than an absent one — it silently attributes
 * one character's words to another, which is precisely the corruption the whole
 * tool exists to detect.
 */

export interface Anchored {
  line: DialogueLine;
  /** Character name, when already known from a speech tag. */
  speaker: string | null;
}

export interface AlternationResult {
  /** Index into the input array. */
  index: number;
  speaker: string;
  confidence: number;
}

/**
 * How often this method is right, measured against known answers by
 * `scripts/eval-attribution.mjs`: 258 correct of 343 on a corpus synthesised
 * from a labelled play at a novel-like tag density.
 *
 * This is a property of the method, not of the individual line. Scoring lines
 * individually — higher near a named line, lower once parity has been carried
 * further — measured as inverted rather than merely uninformative: the 0.72
 * band scored 71% against the 0.68 band's 80%. A confidence figure that does
 * not track correctness is worse than none, because every consumer treats it
 * as if it does.
 */
export const ALTERNATION_ACCURACY = 0.75;

export interface AlternationOptions {
  /**
   * Characters of narration allowed between two lines of the same exchange.
   * Around one paragraph: enough for an action beat, not enough for the
   * conversation to have moved on.
   */
  maxGap?: number;
}

/** Splits lines into runs of back-and-forth separated by narration. */
export function findExchanges(
  lines: ReadonlyArray<Anchored>,
  maxGap: number,
): Array<{ start: number; end: number }> {
  const exchanges: Array<{ start: number; end: number }> = [];
  if (lines.length === 0) return exchanges;

  let start = 0;
  for (let i = 1; i < lines.length; i++) {
    const gap = lines[i]!.line.start - lines[i - 1]!.line.end;
    if (gap > maxGap) {
      exchanges.push({ start, end: i });
      start = i;
    }
  }
  exchanges.push({ start, end: lines.length });
  return exchanges;
}

export function inferByAlternation(
  lines: ReadonlyArray<Anchored>,
  options: AlternationOptions = {},
): AlternationResult[] {
  const maxGap = options.maxGap ?? 300;
  const results: AlternationResult[] = [];

  for (const exchange of findExchanges(lines, maxGap)) {
    const slice = lines.slice(exchange.start, exchange.end);

    const anchors = slice
      .map((entry, i) => ({ i, speaker: entry.speaker }))
      .filter((a): a is { i: number; speaker: string } => a.speaker !== null);

    const speakers = [...new Set(anchors.map((a) => a.speaker))];
    if (speakers.length !== 2 || slice.length < 2) continue;

    const [first, second] = speakers as [string, string];
    const other = (name: string) => (name === first ? second : first);

    // Every anchor must agree about who speaks on even positions. One
    // disagreement means this is not a clean two-party exchange.
    const evenSpeaker = anchors[0]!.i % 2 === 0 ? anchors[0]!.speaker : other(anchors[0]!.speaker);
    const consistent = anchors.every((anchor) => {
      const predicted = anchor.i % 2 === 0 ? evenSpeaker : other(evenSpeaker);
      return predicted === anchor.speaker;
    });

    if (consistent) {
      for (let i = 0; i < slice.length; i++) {
        if (slice[i]!.speaker !== null) continue;

        results.push({
          index: exchange.start + i,
          speaker: i % 2 === 0 ? evenSpeaker : other(evenSpeaker),
          confidence: ALTERNATION_ACCURACY,
        });
      }
      continue;
    }

    /**
     * Parity broke somewhere in this exchange — on Pride and Prejudice that is
     * 20 of the 27 two-speaker exchanges, usually because a third person spoke
     * without ever being named. Carrying parity through anyway would assign
     * roughly 15% of the book at an unknown error rate.
     *
     * What still holds locally is that a line sitting *directly beside* a named
     * one is very unlikely to be that same person again. So only immediate
     * neighbours are used, and only when the two of them do not name different
     * people — that case is genuinely ambiguous and stays unattributed.
     */
    for (let i = 0; i < slice.length; i++) {
      if (slice[i]!.speaker !== null) continue;

      const previous = i > 0 ? slice[i - 1]!.speaker : null;
      const next = i < slice.length - 1 ? slice[i + 1]!.speaker : null;

      if (previous && next && previous !== next) continue; // ambiguous
      const neighbour = previous ?? next;
      if (!neighbour) continue;

      results.push({
        index: exchange.start + i,
        speaker: other(neighbour),
        confidence: ALTERNATION_ACCURACY,
      });
    }
  }

  return results;
}
