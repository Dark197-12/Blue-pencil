import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  buildProfiles,
  findExamplesFor,
  voiceSimilarity,
  METRIC_LABELS,
  COMPARABLE_METRICS,
  type ComparableMetric,
} from "@bp/analysis";

import { prisma } from "../db.js";
import { HttpError, requireAuth, heavyRoute } from "../app.js";

async function ownedProject(userId: string, projectId: string) {
  const project = await prisma.project.findFirst({ where: { id: projectId, userId } });
  if (!project) throw new HttpError(404, "That manuscript doesn’t exist, or isn’t yours.");
  return project;
}

/**
 * Which attributions a voice profile is allowed to be built from.
 *
 * The default is deliberate. Measured against known answers, speech tags are
 * right 100% of the time and a person's own decision is right by definition,
 * while alternation is right about 75% and constraint elimination about 78%.
 * Worse, inference goes wrong in a specific direction: a misattributed line
 * almost always belongs to *the other person in the conversation* — exactly
 * the character this profile most needs to be distinguishable from. Feeding it
 * in blurs the very difference the tool exists to measure.
 *
 * `includeInferred` exists because a writer with a lightly-tagged manuscript
 * may prefer a rough profile to none, but it is opt-in and the interface says
 * what it costs.
 */
const querySchema = z.object({
  includeInferred: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

const RELIABLE_METHODS = ["tag", "manual"];

export async function voiceRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.get<{ Params: { id: string } }>("/:id/voice", heavyRoute, async (request) => {
    const project = await ownedProject(request.currentUser!.id, request.params.id);
    const { includeInferred } = querySchema.parse(request.query);

    const lines = await prisma.dialogueLine.findMany({
      where: {
        projectId: project.id,
        characterId: { not: null },
        ...(includeInferred ? {} : { method: { in: RELIABLE_METHODS } }),
      },
      orderBy: { startOffset: "asc" },
      select: { text: true, characterId: true },
    });

    const characters = await prisma.character.findMany({
      where: { projectId: project.id, isArchived: false },
      select: { id: true, name: true },
    });
    const nameOf = new Map(characters.map((c) => [c.id, c.name]));

    const speech = new Map<string, string[]>();
    for (const line of lines) {
      const name = line.characterId ? nameOf.get(line.characterId) : undefined;
      if (!name) continue;
      speech.set(name, [...(speech.get(name) ?? []), line.text]);
    }

    const profiles = buildProfiles(
      [...speech.entries()].map(([name, passages]) => ({ name, passages })),
    );

    // Only compare characters whose numbers are stable enough to mean anything.
    const comparable = profiles.filter((p) => p.isReliable);
    const similarity = comparable.map((a) => ({
      name: a.name,
      against: comparable
        .filter((b) => b.name !== a.name)
        .map((b) => ({ name: b.name, score: voiceSimilarity(a, b) }))
        .sort((x, y) => y.score - x.score),
    }));

    return {
      basis: includeInferred ? "all" : "reliable",
      /** How many lines the profiles were built from, and how many exist. */
      linesUsed: lines.length,
      metricLabels: METRIC_LABELS,
      metricKeys: COMPARABLE_METRICS,
      profiles: profiles
        .map((p) => ({
          name: p.name,
          isReliable: p.isReliable,
          metrics: p.metrics,
          z: p.z,
          signatureWords: p.signatureWords,
          /**
           * The lines behind each number the author is likely to question.
           *
           * Only the metrics where this character actually stands out get
           * examples — measuring all fifteen for every character would quote
           * most of the book to justify differences nobody would notice, and
           * cost a pass over every passage fifteen times over.
           */
          examples: findExamplesFor(
            speech.get(p.name) ?? [],
            (Object.entries(p.z) as Array<[ComparableMetric, number | undefined]>)
              .filter(([, z]) => typeof z === "number" && Math.abs(z) >= 1)
              .sort(([, a], [, b]) => Math.abs(b!) - Math.abs(a!))
              .slice(0, 5)
              .map(([metric]) => metric),
          ),
        }))
        .sort((a, b) => b.metrics.wordCount - a.metrics.wordCount),
      similarity,
    };
  });
}
