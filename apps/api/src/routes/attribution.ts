import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../db.js";
import { HttpError, requireAuth } from "../app.js";

async function ownedProject(userId: string, projectId: string) {
  const project = await prisma.project.findFirst({ where: { id: projectId, userId } });
  if (!project) throw new HttpError(404, "That manuscript doesn’t exist, or isn’t yours.");
  return project;
}

const queueQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  /** Skip this many — the queue is stable, so a plain offset is enough. */
  offset: z.coerce.number().int().min(0).default(0),
  /** unattributed | uncertain | all */
  filter: z.enum(["unattributed", "uncertain", "all"]).default("unattributed"),
});

const assignSchema = z.object({
  /** Null clears the attribution and returns the line to the queue. */
  characterId: z.string().nullable(),
});

/**
 * Orders the speaker choices so the likely one is first — and, since the queue
 * is meant to be worked by keyboard, so the number keys mean something.
 *
 * Who spoke nearby is the strongest signal, but it is often unavailable: the
 * whole of Pride and Prejudice's first chapter names nobody, because Austen
 * writes "said his lady" throughout. Falling back to how much each character
 * speaks overall beats falling back to the alphabet.
 */
function rankCandidates(
  cast: Array<{ id: string; name: string; totalLines: number }>,
  nearby: Array<string | null>,
) {
  const frequency = new Map<string, number>();
  for (const id of nearby) {
    if (id) frequency.set(id, (frequency.get(id) ?? 0) + 1);
  }
  return [...cast]
    .map((character) => ({ ...character, nearbyCount: frequency.get(character.id) ?? 0 }))
    .sort(
      (a, b) =>
        b.nearbyCount - a.nearbyCount ||
        b.totalLines - a.totalLines ||
        a.name.localeCompare(b.name),
    );
}

export async function attributionRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  /**
   * The review queue: lines the machine could not resolve, or resolved without
   * much confidence, ordered so the least certain come first.
   */
  app.get<{ Params: { id: string } }>("/:id/attribution/queue", async (request) => {
    const project = await ownedProject(request.currentUser!.id, request.params.id);
    const { limit, offset, filter } = queueQuerySchema.parse(request.query);

    const where =
      filter === "unattributed"
        ? { projectId: project.id, characterId: null }
        : filter === "uncertain"
          ? { projectId: project.id, OR: [{ characterId: null }, { confidence: { lt: 0.7 } }] }
          : { projectId: project.id };

    const [total, lines, cast] = await Promise.all([
      prisma.dialogueLine.count({ where }),
      prisma.dialogueLine.findMany({
        where,
        // Nulls first, then least confident: the queue puts the work that most
        // needs a human at the top.
        orderBy: [{ confidence: { sort: "asc", nulls: "first" } }, { startOffset: "asc" }],
        skip: offset,
        take: limit,
        include: { character: { select: { id: true, name: true } } },
      }),
      prisma.character.findMany({
        where: { projectId: project.id, isArchived: false },
        select: { id: true, name: true, _count: { select: { attributions: true } } },
      }),
    ]);

    const castWithTotals = cast.map((character) => ({
      id: character.id,
      name: character.name,
      totalLines: character._count.attributions,
    }));

    const source = project.sourceText;

    const items = await Promise.all(
      lines.map(async (line) => {
        // Enough surrounding prose to judge who is speaking, cut at paragraph
        // boundaries so the excerpt does not start mid-sentence.
        const from = Math.max(0, line.startOffset - 600);
        const to = Math.min(source.length, line.endOffset + 400);
        const before = source.slice(from, line.startOffset);
        const after = source.slice(line.endOffset, to);

        const neighbours = await prisma.dialogueLine.findMany({
          where: {
            projectId: project.id,
            startOffset: { gte: line.startOffset - 3000, lte: line.startOffset + 3000 },
            NOT: { id: line.id },
          },
          select: { characterId: true },
          take: 40,
        });

        return {
          id: line.id,
          startOffset: line.startOffset,
          text: line.text,
          wordCount: line.wordCount,
          speakerRaw: line.speakerRaw,
          speakerKind: line.speakerKind,
          method: line.method,
          confidence: line.confidence,
          character: line.character,
          context: {
            before: before.slice(before.indexOf("\n\n") + 2).replace(/\s+/g, " ").trim(),
            after: after.replace(/\s+/g, " ").trim(),
          },
          candidates: rankCandidates(
            castWithTotals,
            neighbours.map((n) => n.characterId),
          ).slice(0, 8),
        };
      }),
    );

    return { total, offset, limit, filter, items };
  });

  /** Sets or clears the speaker by hand. Manual answers are never overwritten. */
  app.patch<{ Params: { id: string; lineId: string } }>(
    "/:id/dialogue/:lineId",
    async (request) => {
      const project = await ownedProject(request.currentUser!.id, request.params.id);
      const { characterId } = assignSchema.parse(request.body);

      const line = await prisma.dialogueLine.findFirst({
        where: { id: request.params.lineId, projectId: project.id },
      });
      if (!line) throw new HttpError(404, "That line isn’t part of this manuscript.");

      if (characterId) {
        const character = await prisma.character.findFirst({
          where: { id: characterId, projectId: project.id },
        });
        if (!character) throw new HttpError(404, "That character isn’t in this manuscript.");
      }

      const updated = await prisma.dialogueLine.update({
        where: { id: line.id },
        data: {
          characterId,
          method: characterId ? "manual" : null,
          // A person's answer is the ground truth everything else is measured
          // against, so it carries full confidence.
          confidence: characterId ? 1 : null,
        },
        include: { character: { select: { id: true, name: true } } },
      });

      return {
        line: {
          id: updated.id,
          character: updated.character,
          method: updated.method,
          confidence: updated.confidence,
        },
      };
    },
  );

  /** Headline numbers for the progress bar above the queue. */
  app.get<{ Params: { id: string } }>("/:id/attribution/stats", async (request) => {
    const project = await ownedProject(request.currentUser!.id, request.params.id);

    const [total, byMethod] = await Promise.all([
      prisma.dialogueLine.count({ where: { projectId: project.id } }),
      prisma.dialogueLine.groupBy({
        by: ["method"],
        where: { projectId: project.id },
        _count: { _all: true },
      }),
    ]);

    const countFor = (method: string | null) =>
      byMethod.find((row) => row.method === method)?._count._all ?? 0;

    const uncertain = await prisma.dialogueLine.count({
      where: { projectId: project.id, characterId: { not: null }, confidence: { lt: 0.7 } },
    });

    return {
      total,
      tag: countFor("tag"),
      alternation: countFor("alternation"),
      closure: countFor("closure"),
      constraints: countFor("constraints"),
      llm: countFor("llm"),
      manual: countFor("manual"),
      unattributed: countFor(null),
      /** Attributed, but by an inference worth a second look. */
      uncertain,
    };
  });
}
