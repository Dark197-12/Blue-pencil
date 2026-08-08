import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../db.js";
import { HttpError, requireAuth } from "../app.js";
import { extractProjectDialogue } from "../ingest/dialogue.js";
import { reinferSpeakers } from "../ingest/reinfer.js";

async function ownedProject(userId: string, projectId: string) {
  const project = await prisma.project.findFirst({ where: { id: projectId, userId } });
  if (!project) throw new HttpError(404, "That manuscript doesn’t exist, or isn’t yours.");
  return project;
}

const mergeSchema = z.object({
  /** The character being folded away. */
  fromId: z.string(),
  /** The character it becomes part of. */
  intoId: z.string(),
});

const renameSchema = z.object({ name: z.string().trim().min(1).max(120) });

export async function castRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  /** Runs (or re-runs) dialogue extraction. Discards any manual attributions. */
  app.post<{ Params: { id: string } }>("/:id/dialogue/extract", async (request) => {
    const project = await ownedProject(request.currentUser!.id, request.params.id);
    if (!project.structureConfirmedAt) {
      throw new HttpError(400, "Confirm the chapter split first — dialogue is anchored to scenes.");
    }
    return extractProjectDialogue(project.id, project.sourceText);
  });

  /**
   * Re-runs speaker inference over dialogue that is already extracted, keeping
   * the cast and every hand-corrected line.
   *
   * This exists because the tiers arrived after some manuscripts did. A book
   * ingested when only speech tags were implemented would otherwise be stuck at
   * that coverage forever, or have to be re-extracted at the cost of the
   * author's own corrections.
   */
  app.post<{ Params: { id: string } }>("/:id/dialogue/reinfer", async (request) => {
    const project = await ownedProject(request.currentUser!.id, request.params.id);
    if (!project.structureConfirmedAt) {
      throw new HttpError(400, "Confirm the chapter split first — dialogue is anchored to scenes.");
    }
    return reinferSpeakers(project.id, project.sourceText);
  });

  app.get<{ Params: { id: string } }>("/:id/cast", async (request) => {
    const project = await ownedProject(request.currentUser!.id, request.params.id);

    const [characters, totals] = await Promise.all([
      prisma.character.findMany({
        where: { projectId: project.id, isArchived: false },
        orderBy: { name: "asc" },
      }),
      prisma.dialogueLine.groupBy({
        by: ["characterId"],
        where: { projectId: project.id },
        _count: { _all: true },
        _sum: { wordCount: true },
      }),
    ]);

    const stats = new Map(
      totals.map((row) => [row.characterId, { lines: row._count._all, words: row._sum.wordCount ?? 0 }]),
    );

    const unattributed = stats.get(null) ?? { lines: 0, words: 0 };
    const total = await prisma.dialogueLine.count({ where: { projectId: project.id } });

    const members = characters
      .map((character) => {
        const stat = stats.get(character.id) ?? { lines: 0, words: 0 };
        return {
          id: character.id,
          name: character.name,
          aliases: character.aliases,
          isConfirmed: character.isConfirmed,
          lineCount: stat.lines,
          wordCount: stat.words,
          /**
           * A character needs roughly this much dialogue before any voice
           * measurement is stable. Surfaced now so the author can see which
           * characters will actually be analysable.
           */
          hasEnoughForBaseline: stat.words >= 500,
        };
      })
      .sort((a, b) => b.wordCount - a.wordCount);

    return {
      totalLines: total,
      attributedLines: total - unattributed.lines,
      unattributedLines: unattributed.lines,
      members,
    };
  });

  app.patch<{ Params: { id: string; characterId: string } }>(
    "/:id/cast/:characterId",
    async (request) => {
      const project = await ownedProject(request.currentUser!.id, request.params.id);
      const { name } = renameSchema.parse(request.body);

      const character = await prisma.character.findFirst({
        where: { id: request.params.characterId, projectId: project.id },
      });
      if (!character) throw new HttpError(404, "That character isn’t part of this manuscript.");

      const clash = await prisma.character.findFirst({
        where: { projectId: project.id, name, NOT: { id: character.id } },
      });
      if (clash) throw new HttpError(409, `There is already a character called “${name}”.`);

      const updated = await prisma.character.update({
        where: { id: character.id },
        data: {
          name,
          // Keep the original spellings; the display name is just the label.
          aliases: character.aliases.includes(name) ? character.aliases : [name, ...character.aliases],
        },
      });
      return { character: { id: updated.id, name: updated.name, aliases: updated.aliases } };
    },
  );

  /** Folds one character into another, moving its lines and aliases across. */
  app.post<{ Params: { id: string } }>("/:id/cast/merge", async (request) => {
    const project = await ownedProject(request.currentUser!.id, request.params.id);
    const { fromId, intoId } = mergeSchema.parse(request.body);

    if (fromId === intoId) throw new HttpError(400, "A character can’t be merged into itself.");

    const [from, into] = await Promise.all([
      prisma.character.findFirst({ where: { id: fromId, projectId: project.id } }),
      prisma.character.findFirst({ where: { id: intoId, projectId: project.id } }),
    ]);
    if (!from || !into) throw new HttpError(404, "One of those characters isn’t in this manuscript.");

    await prisma.$transaction(async (tx) => {
      await tx.dialogueLine.updateMany({
        where: { projectId: project.id, characterId: from.id },
        data: { characterId: into.id },
      });
      await tx.character.update({
        where: { id: into.id },
        data: { aliases: [...new Set([...into.aliases, ...from.aliases])] },
      });
      await tx.character.delete({ where: { id: from.id } });
    });

    return { ok: true };
  });

  /** Removes a character; its lines fall back to unattributed. */
  app.delete<{ Params: { id: string; characterId: string } }>(
    "/:id/cast/:characterId",
    async (request, reply) => {
      const project = await ownedProject(request.currentUser!.id, request.params.id);
      const { count } = await prisma.character.deleteMany({
        where: { id: request.params.characterId, projectId: project.id },
      });
      if (count === 0) throw new HttpError(404, "That character isn’t part of this manuscript.");
      return reply.status(204).send();
    },
  );

  app.post<{ Params: { id: string } }>("/:id/cast/confirm", async (request) => {
    const project = await ownedProject(request.currentUser!.id, request.params.id);
    await prisma.character.updateMany({
      where: { projectId: project.id },
      data: { isConfirmed: true },
    });
    return { ok: true };
  });

  /** Dialogue lines within one chapter, for highlighting in the reader. */
  app.get<{ Params: { id: string; chapterId: string } }>(
    "/:id/chapters/:chapterId/dialogue",
    async (request) => {
      const project = await ownedProject(request.currentUser!.id, request.params.id);
      const chapter = await prisma.chapter.findFirst({
        where: { id: request.params.chapterId, projectId: project.id },
      });
      if (!chapter) throw new HttpError(404, "That chapter isn’t part of this manuscript.");

      const lines = await prisma.dialogueLine.findMany({
        where: {
          projectId: project.id,
          startOffset: { gte: chapter.startOffset, lt: chapter.endOffset },
        },
        orderBy: { startOffset: "asc" },
        include: { character: { select: { id: true, name: true } } },
      });

      return {
        lines: lines.map((line) => ({
          id: line.id,
          startOffset: line.startOffset,
          endOffset: line.endOffset,
          segments: line.segments,
          text: line.text,
          wordCount: line.wordCount,
          speakerRaw: line.speakerRaw,
          speakerKind: line.speakerKind,
          method: line.method,
          confidence: line.confidence,
          character: line.character,
        })),
      };
    },
  );
}
