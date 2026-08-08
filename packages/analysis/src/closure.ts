import { findExchanges, type Anchored, type AlternationResult } from "./alternation.js";

/**
 * Tier 2.2: closing out a conversation that only two people speak in.
 *
 * Tier 2 works inside an exchange — a run of back-and-forth uninterrupted by
 * narration — and needs two named speakers inside that run to have anything to
 * alternate between. That is a severe requirement. In Pride and Prejudice only
 * 27 of 222 exchanges carry two named speakers, so most of the book's dialogue
 * has nothing to anchor to and stays unattributed.
 *
 * But identity and parity are two different questions, and they can be answered
 * at different scales. *Who is in this conversation* holds over a whole
 * encounter: if only two people are named across it, a third would be
 * remarkable. *Who speaks on this line* is local, because narration between
 * exchanges is exactly where somebody leaves or arrives.
 *
 * So this tier takes identity from the conversation and parity from the
 * exchange. That unlocks the common case tier 2 must refuse: an exchange
 * containing a single named speaker. On its own that names nobody to alternate
 * with — but if only two people are talking, the other party is known, and one
 * anchor fixes the whole run.
 *
 * The same strictness applies as everywhere else. A conversation naming three
 * speakers is left alone rather than guessed at. An exchange whose anchors
 * disagree about parity is skipped, because somebody spoke twice in a row and
 * carrying parity through would silently hand one character's words to another.
 *
 * What it is worth depends entirely on the book, and by more than expected. On
 * a dialogue-heavy corpus it claims 185 lines; on Pride and Prejudice, 24.
 * Austen writes crowded rooms, and tier 2 has already taken the clean
 * two-handers before this tier sees them. Contemporary fiction, which leans far
 * harder on unbroken two-person scenes, is the case this helps.
 */

export interface SceneAnchored extends Anchored {
  /** Which scene the line falls in. Lines with no scene are ignored. */
  sceneId: string | null;
}

export interface ClosureOptions {
  /** Characters of narration that separate one exchange from the next. */
  maxGap?: number;
  /**
   * Times each of the two speakers must be named in the scene before the scene
   * is treated as a two-hander.
   *
   * This guards the tier's characteristic failure. A servant who says one
   * named line — "Lady Bracknell and Miss Fairfax," announced Lane — makes a
   * three-person scene look like a two-hander, and the real interlocutor, who
   * is never named in that scene, gets all their lines handed to the servant.
   * Every wrong answer in the first measured run had exactly that shape.
   * Requiring both parties to be named more than once asks for evidence of a
   * conversation rather than of a presence.
   *
   * Measured, it is worth far less than those samples implied: accuracy moves
   * from 79.0% to 79.2% and two lines of coverage are lost. The guard is kept
   * because the failure it describes is real and cheap to exclude, but it is
   * not what holds this tier back, and raising it past 2 changes nothing at
   * all.
   */
  minAnchorsPerSpeaker?: number;
  /**
   * Characters of narration that end a conversation, as distinct from the
   * smaller gap that merely ends an exchange.
   *
   * Scene scope is too coarse. Books that mark no scene breaks get one scene
   * per chapter, and an Austen chapter runs to thousands of words with the
   * whole family in it, so "exactly two speakers in this scene" almost never
   * holds. A conversation is the better unit: a run of exchanges close enough
   * together to be one encounter, ending the moment a third name appears, so a
   * crowded chapter contributes its two-handed stretches instead of nothing.
   *
   * Measured, the distance itself does nothing — 1000, 2000 and 4000 give
   * identical results, because blocks are ended by a third speaker long before
   * they are ended by narration. Moving from scene scope to conversation scope
   * bought 15.9 points of coverage on the eval corpus and three lines on Pride
   * and Prejudice, which is a fair summary of how book-dependent this tier is.
   */
  conversationGap?: number;
}

/**
 * Splits a scene into conversations: runs of consecutive lines naming at most
 * two speakers and separated by no more than `conversationGap` of narration.
 *
 * Returns index ranges into `scene`.
 */
function findConversations(
  scene: ReadonlyArray<SceneAnchored>,
  conversationGap: number,
): Array<{ start: number; end: number }> {
  const blocks: Array<{ start: number; end: number }> = [];
  let start = 0;
  let named = new Set<string>();

  for (let i = 0; i < scene.length; i++) {
    const speaker = scene[i]!.speaker;
    const gap = i > 0 ? scene[i]!.line.start - scene[i - 1]!.line.end : 0;

    // A third name, or too much narration, and this is a different encounter.
    const introducesThird = speaker !== null && !named.has(speaker) && named.size >= 2;
    if (i > start && (introducesThird || gap > conversationGap)) {
      blocks.push({ start, end: i });
      start = i;
      named = new Set();
    }

    if (speaker !== null) named.add(speaker);
  }

  if (start < scene.length) blocks.push({ start, end: scene.length });
  return blocks;
}

/**
 * How often this method is right: 145 of 185, measured against known answers
 * by `scripts/eval-attribution.mjs`.
 *
 * Like the other tiers this is a property of the method rather than of the
 * line, because per-line confidence was measured and found to be not merely
 * uninformative but inverted.
 *
 * 78% is squarely inference-grade — better than alternation's 75%, nowhere near
 * a speech tag's 100% — and that decides what it may be used for. It does not
 * qualify a line to be measured as somebody's voice, because a fifth of these
 * lines belong to the other person in the conversation, which is exactly the
 * character any voice comparison most needs kept separate. It does qualify a
 * line to say *who was in the room*, where that same error is nearly harmless:
 * handing a line to the wrong party of a two-hander still names a party who
 * was there.
 *
 * That split is the whole value of the tier. On the eval corpus it lifts
 * coverage from 67.5% to 83.4% and end-to-end accuracy from 56.0% to 67.8%,
 * costing 1.5 points of precision (82.9% to 81.4%). Some of that is taken from
 * tier 2.5 rather than added: constraints falls from 57 correct to 16, because
 * what reaches it afterwards is the harder remainder.
 */
export const CLOSURE_ACCURACY = 0.78;

/**
 * Fills in unattributed lines in scenes where exactly two characters speak.
 *
 * Returns only lines it is willing to claim; everything else is left for the
 * next tier or for the author.
 */
export function closeTwoHanders(
  lines: ReadonlyArray<SceneAnchored>,
  options: ClosureOptions = {},
): AlternationResult[] {
  const maxGap = options.maxGap ?? 300;
  const minAnchors = options.minAnchorsPerSpeaker ?? 2;
  const conversationGap = options.conversationGap ?? 2000;
  const results: AlternationResult[] = [];

  // Group by scene, keeping each line's index in the original array.
  const byScene = new Map<string, number[]>();
  lines.forEach((entry, index) => {
    if (entry.sceneId === null) return;
    byScene.set(entry.sceneId, [...(byScene.get(entry.sceneId) ?? []), index]);
  });

  for (const [, indices] of byScene) {
    const scene = indices.map((index) => lines[index]!);

    for (const block of findConversations(scene, conversationGap)) {
      const conversation = scene.slice(block.start, block.end);

      // Identity, decided at conversation scope.
      const anchorCounts = new Map<string, number>();
      for (const entry of conversation) {
        if (entry.speaker === null) continue;
        anchorCounts.set(entry.speaker, (anchorCounts.get(entry.speaker) ?? 0) + 1);
      }

      const speakers = [...anchorCounts.keys()];
      if (speakers.length !== 2) continue;
      if (speakers.some((name) => (anchorCounts.get(name) ?? 0) < minAnchors)) continue;

      const [first, second] = speakers as [string, string];
      const other = (name: string) => (name === first ? second : first);

      // Parity, decided at exchange scope.
      for (const exchange of findExchanges(conversation, maxGap)) {
        const slice = conversation.slice(exchange.start, exchange.end);
        if (slice.length < 2) continue;

        const anchors = slice
          .map((entry, i) => ({ i, speaker: entry.speaker }))
          .filter((a): a is { i: number; speaker: string } => a.speaker !== null);

        // No anchor in this run: the conversation says who the two people are
        // but nothing says which of them starts, and a coin flip would be
        // wrong half the time.
        if (anchors.length === 0) continue;

        const evenSpeaker =
          anchors[0]!.i % 2 === 0 ? anchors[0]!.speaker : other(anchors[0]!.speaker);

        const consistent = anchors.every((anchor) => {
          const predicted = anchor.i % 2 === 0 ? evenSpeaker : other(evenSpeaker);
          return predicted === anchor.speaker;
        });
        if (!consistent) continue;

        for (let i = 0; i < slice.length; i++) {
          if (slice[i]!.speaker !== null) continue;
          results.push({
            index: indices[block.start + exchange.start + i]!,
            speaker: i % 2 === 0 ? evenSpeaker : other(evenSpeaker),
            confidence: CLOSURE_ACCURACY,
          });
        }
      }
    }
  }

  return results;
}
