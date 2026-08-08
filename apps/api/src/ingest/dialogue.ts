import {
  buildCast,
  extractDialogue,
  inferByAlternation,
  inferGenders,
  resolveByConstraints,
  type DialogueLine,
} from "@bp/analysis";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";

/**
 * Extracting dialogue and proposing a cast.
 *
 * Runs once the author has confirmed the chapter split, because dialogue lines
 * are anchored to scenes and the scene boundaries have to be settled first.
 */

const wordCountOf = (text: string) => (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;

export async function extractProjectDialogue(projectId: string, sourceText: string) {
  /**
   * Extraction runs chapter by chapter, not over the whole file.
   *
   * Front matter is full of quotation marks that are not dialogue. Pride and
   * Prejudice opens with a scholarly preface quoting Walt Whitman, which yields
   * 89 "utterances" like "loving by allowance" — junk that would sit at the top
   * of the review queue and inflate every denominator.
   *
   * Working per chapter also stops a conversation being carried across a
   * chapter break, which alternation would otherwise treat as one exchange.
   */
  const chapters = await prisma.chapter.findMany({
    where: { projectId },
    orderBy: { startOffset: "asc" },
    select: { startOffset: true, endOffset: true },
  });

  const lines =
    chapters.length > 0
      ? chapters.flatMap((chapter) =>
          extractDialogue(sourceText.slice(chapter.startOffset, chapter.endOffset), {
            offset: chapter.startOffset,
          }),
        )
      : extractDialogue(sourceText);

  const cast = buildCast(lines);

  // Scene lookup, so each line can be anchored to where it happens.
  const scenes = await prisma.scene.findMany({
    where: { chapter: { projectId } },
    select: { id: true, startOffset: true, endOffset: true },
    orderBy: { startOffset: "asc" },
  });

  const sceneFor = (offset: number): string | null => {
    let low = 0;
    let high = scenes.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const scene = scenes[mid]!;
      if (offset < scene.startOffset) high = mid - 1;
      else if (offset >= scene.endOffset) low = mid + 1;
      else return scene.id;
    }
    return null;
  };

  await prisma.$transaction(
    async (tx) => {
      await tx.dialogueLine.deleteMany({ where: { projectId } });
      await tx.character.deleteMany({ where: { projectId } });

      const characterIds = new Map<string, string>();
      for (const member of cast.members) {
        const created = await tx.character.create({
          data: { projectId, name: member.name, aliases: member.aliases },
        });
        // Every alias resolves to the same character.
        for (const alias of member.aliases) characterIds.set(alias, created.id);
      }

      /**
       * Tier 2 runs over the tier-1 result: alternation needs named lines to
       * anchor to, so it can only work once the speech tags are resolved.
       */
      const nameOf = new Map<string, string>();
      for (const member of cast.members) {
        for (const alias of member.aliases) nameOf.set(alias, member.name);
      }
      const idOfName = new Map<string, string>();
      for (const member of cast.members) {
        const id = characterIds.get(member.name);
        if (id) idOfName.set(member.name, id);
      }

      const anchored = lines.map((line) => ({
        line,
        speaker: line.tag?.kind === "name" ? (nameOf.get(line.tag.raw) ?? null) : null,
      }));

      const inferred = new Map<number, { characterId: string; confidence: number; method: string }>();

      for (const result of inferByAlternation(anchored)) {
        const id = idOfName.get(result.speaker);
        if (!id) continue;
        inferred.set(result.index, {
          characterId: id,
          confidence: result.confidence,
          method: "alternation",
        });
        // Constraints run after, and read the speakers alternation just found.
        anchored[result.index]!.speaker = result.speaker;
      }

      /**
       * Tier 2.5 eliminates candidates using gender, who the line addresses,
       * and who just spoke. It needs alternation's answers in place first,
       * because its whole notion of who is present comes from lines whose
       * speaker is already known.
       */
      const genders = inferGenders(sourceText, cast.members);
      const castInfo = cast.members.map((member) => ({
        name: member.name,
        aliases: member.aliases,
        gender: genders.get(member.name)?.gender ?? null,
      }));

      for (const result of resolveByConstraints(anchored, castInfo)) {
        const id = idOfName.get(result.speaker);
        if (!id || inferred.has(result.index)) continue;
        inferred.set(result.index, {
          characterId: id,
          confidence: result.confidence,
          method: "constraints",
        });
      }

      const rows = lines.map((line: DialogueLine, index: number) => {
        const tagged = line.tag?.kind === "name" ? (characterIds.get(line.tag.raw) ?? null) : null;
        const guess = tagged ? null : inferred.get(index);
        const characterId = tagged ?? guess?.characterId ?? null;
        return {
          projectId,
          sceneId: sceneFor(line.start),
          startOffset: line.start,
          endOffset: line.end,
          // Prisma types Json columns as InputJsonValue, which a typed array
          // does not structurally satisfy even though it serialises fine.
          segments: line.segments as unknown as Prisma.InputJsonValue,
          text: line.text,
          wordCount: wordCountOf(line.text),
          speakerRaw: line.tag?.raw ?? null,
          speakerKind: line.tag?.kind ?? null,
          characterId,
          /**
           * `confidence` is how often the *method* is right, measured against
           * known answers by scripts/eval-attribution.mjs — not a per-line
           * score. Speech tags were 176 of 176; alternation 258 of 343;
           * constraints 57 of 73. Phase 5 should build voice baselines from
           * tags and manual answers only, because a quarter of the inferred
           * lines belong to the other person in the conversation, which is
           * exactly the character a baseline most needs to be kept apart from.
           */
          method: tagged ? "tag" : (guess?.method ?? null),
          confidence: tagged ? 1 : (guess?.confidence ?? null),
        };
      });

      // createMany in chunks: a novel yields thousands of rows, and a single
      // statement with that many parameters exceeds Postgres' limit.
      for (let i = 0; i < rows.length; i += 500) {
        await tx.dialogueLine.createMany({ data: rows.slice(i, i + 500) });
      }
    },
    { timeout: 120_000 },
  );

  // Count what actually resolved to a character, not what merely carried a name
  // tag. Some tagged names are rejected from the cast — a one-off capitalised
  // word, say — and those lines stay unattributed. Reporting the tag count here
  // would overstate coverage and disagree with the cast screen.
  const namedTags = lines.filter((l) => l.tag?.kind === "name").length;
  const byMethod = await prisma.dialogueLine.groupBy({
    by: ["method"],
    where: { projectId },
    _count: { _all: true },
  });
  const countFor = (method: string) =>
    byMethod.find((row) => row.method === method)?._count._all ?? 0;

  const fromTags = countFor("tag");
  const fromAlternation = countFor("alternation");
  const fromConstraints = countFor("constraints");

  return {
    lineCount: lines.length,
    characterCount: cast.members.length,
    attributedCount: fromTags + fromAlternation + fromConstraints,
    byMethod: { tag: fromTags, alternation: fromAlternation, constraints: fromConstraints },
    /** Tagged with a name that did not survive into the cast. */
    unresolvedNameTags: namedTags - fromTags,
    suggestions: cast.suggestions,
    rejected: cast.rejected.slice(0, 20),
  };
}
