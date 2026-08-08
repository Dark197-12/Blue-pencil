import {
  closeTwoHanders,
  inferByAlternation,
  inferGenders,
  resolveByConstraints,
  type DialogueLine,
} from "@bp/analysis";
import { prisma } from "../db.js";

/**
 * Re-running speaker inference over dialogue that has already been extracted.
 *
 * Re-extracting would do the same job, but it deletes every dialogue line and
 * character first — and with them every correction the author has made by hand
 * and the cast they confirmed. That is unacceptable for what is meant to be a
 * routine operation: a manuscript ingested before a tier existed should be able
 * to benefit from it without the author redoing their work.
 *
 * So this re-infers in place. Nothing is extracted, no offsets move, and the
 * cast is left exactly as it is.
 *
 * Two kinds of attribution are treated as ground truth and used as anchors:
 * speech tags, which measured 100% correct, and the author's own answers, which
 * are correct by definition. Everything previously written by inference is
 * cleared and worked out again, because a tier's answer is only as good as the
 * tiers that ran before it and stale guesses would anchor new ones.
 */
export async function reinferSpeakers(projectId: string, sourceText: string) {
  const [rows, characters] = await Promise.all([
    prisma.dialogueLine.findMany({
      where: { projectId },
      orderBy: { startOffset: "asc" },
      select: {
        id: true,
        startOffset: true,
        endOffset: true,
        text: true,
        sceneId: true,
        speakerRaw: true,
        speakerKind: true,
        characterId: true,
        method: true,
      },
    }),
    prisma.character.findMany({
      where: { projectId, isArchived: false },
      select: { id: true, name: true, aliases: true },
    }),
  ]);

  const nameOfId = new Map(characters.map((c) => [c.id, c.name]));
  const idOfName = new Map(characters.map((c) => [c.name, c.id]));
  const nameOfAlias = new Map<string, string>();
  for (const character of characters) {
    for (const alias of character.aliases) nameOfAlias.set(alias, character.name);
  }

  /**
   * The tiers want `DialogueLine`s. Only the fields they read are reconstructed
   * — position, text, and the speech tag — because segments and quote spans
   * play no part in working out who spoke.
   */
  const anchored = rows.map((row) => {
    const isGroundTruth = row.method === "tag" || row.method === "manual";
    const speaker = isGroundTruth && row.characterId ? (nameOfId.get(row.characterId) ?? null) : null;

    return {
      line: {
        start: row.startOffset,
        end: row.endOffset,
        text: row.text,
        segments: [],
        tag: row.speakerRaw
          ? { raw: row.speakerRaw, kind: (row.speakerKind ?? "name") as "name" }
          : null,
      } as unknown as DialogueLine,
      speaker,
      sceneId: row.sceneId,
      /** Kept so a manual answer is never overwritten, whatever a tier says. */
      isGroundTruth,
    };
  });

  const inferred = new Map<number, { characterId: string; confidence: number; method: string }>();

  const claim = (index: number, speaker: string, confidence: number, method: string) => {
    if (anchored[index]!.isGroundTruth || inferred.has(index)) return;
    const id = idOfName.get(speaker);
    if (!id) return;
    inferred.set(index, { characterId: id, confidence, method });
    // Later tiers read what earlier ones established.
    anchored[index]!.speaker = speaker;
  };

  for (const result of inferByAlternation(anchored)) {
    claim(result.index, result.speaker, result.confidence, "alternation");
  }

  // Tier 2.2 runs on what alternation could not reach, and needs its answers in
  // place: a scene alternation has partly filled is far likelier to show its
  // two speakers.
  for (const result of closeTwoHanders(anchored)) {
    claim(result.index, result.speaker, result.confidence, "closure");
  }

  const genders = inferGenders(
    sourceText,
    characters.map((c) => ({ name: c.name, aliases: c.aliases })),
  );
  const castInfo = characters.map((character) => ({
    name: character.name,
    aliases: character.aliases,
    gender: genders.get(character.name)?.gender ?? null,
  }));

  for (const result of resolveByConstraints(anchored, castInfo)) {
    claim(result.index, result.speaker, result.confidence, "constraints");
  }

  // Speech tags that never resolved to a cast member are re-checked too: the
  // author may have merged or renamed a character since extraction.
  const updates: Array<{ id: string; characterId: string | null; method: string | null; confidence: number | null }> = [];

  rows.forEach((row, index) => {
    if (anchored[index]!.isGroundTruth) {
      if (row.method !== "tag") return;
      // A tag whose name now maps to a different character.
      const name = row.speakerRaw ? nameOfAlias.get(row.speakerRaw) : undefined;
      const id = name ? idOfName.get(name) : undefined;
      if (id && id !== row.characterId) {
        updates.push({ id: row.id, characterId: id, method: "tag", confidence: 1 });
      }
      return;
    }

    const guess = inferred.get(index);
    const characterId = guess?.characterId ?? null;
    const method = guess?.method ?? null;

    // Only write rows that actually changed.
    if (row.characterId === characterId && row.method === method) return;
    updates.push({ id: row.id, characterId, method, confidence: guess?.confidence ?? null });
  });

  /**
   * Grouped into one statement per distinct outcome, rather than one per row.
   *
   * Every changed line receives one of a small set of answers — a character, a
   * method, and that method's accuracy — so a thousand updates collapse into a
   * few dozen `WHERE id IN (...)`. One update per row is one network round trip
   * per row, which against a hosted database exceeds any workable transaction
   * timeout.
   */
  const groups = new Map<string, { data: (typeof updates)[number]; ids: string[] }>();
  for (const update of updates) {
    const key = `${update.characterId}|${update.method}|${update.confidence}`;
    const group = groups.get(key) ?? { data: update, ids: [] };
    group.ids.push(update.id);
    groups.set(key, group);
  }

  await prisma.$transaction(
    [...groups.values()].map((group) =>
      prisma.dialogueLine.updateMany({
        where: { id: { in: group.ids } },
        data: {
          characterId: group.data.characterId,
          method: group.data.method,
          confidence: group.data.confidence,
        },
      }),
    ),
  );

  const byMethod = await prisma.dialogueLine.groupBy({
    by: ["method"],
    where: { projectId },
    _count: { _all: true },
  });
  const countFor = (method: string | null) =>
    byMethod.find((row) => row.method === method)?._count._all ?? 0;

  return {
    lineCount: rows.length,
    changed: updates.length,
    byMethod: {
      tag: countFor("tag"),
      manual: countFor("manual"),
      alternation: countFor("alternation"),
      closure: countFor("closure"),
      constraints: countFor("constraints"),
      unattributed: countFor(null),
    },
  };
}
