import { buildCast, extractDialogue, type DialogueLine } from "@bp/analysis";
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
  const lines = extractDialogue(sourceText);
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

      const rows = lines.map((line: DialogueLine) => {
        const characterId = line.tag?.kind === "name" ? (characterIds.get(line.tag.raw) ?? null) : null;
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
          // Only a speech tag naming someone counts as tier-1 attribution.
          method: characterId ? "tag" : null,
          confidence: characterId ? 0.95 : null,
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
  const attributed = await prisma.dialogueLine.count({
    where: { projectId, characterId: { not: null } },
  });

  return {
    lineCount: lines.length,
    characterCount: cast.members.length,
    attributedCount: attributed,
    /** Tagged with a name that did not survive into the cast. */
    unresolvedNameTags: namedTags - attributed,
    suggestions: cast.suggestions,
    rejected: cast.rejected.slice(0, 20),
  };
}
