import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  buildBaselines,
  findFlags,
  measureScenes,
  COMPARABLE_METRICS,
  METRIC_LABELS,
  type CharacterScenes,
  type ComparableMetric,
  type Flag,
} from "@bp/analysis";
import type { Prisma } from "@prisma/client";

import { prisma } from "../db.js";
import { HttpError, requireAuth } from "../app.js";

async function ownedProject(userId: string, projectId: string) {
  const project = await prisma.project.findFirst({ where: { id: projectId, userId } });
  if (!project) throw new HttpError(404, "That manuscript doesn’t exist, or isn’t yours.");
  return project;
}

const metricSchema = z.enum(COMPARABLE_METRICS as unknown as [ComparableMetric, ...ComparableMetric[]]);

const settingsSchema = z.object({
  /**
   * Sensitivity, in standard deviations. Bounded on both sides: below 2 the
   * fifteen metrics measured per scene produce roughly one false flag per
   * scene from noise alone, and above 4 nothing survives, which is a worse
   * failure because it looks like a clean manuscript.
   */
  flagThreshold: z.number().min(2).max(4).optional(),
  ignoredMetrics: z.array(metricSchema).optional(),
});

const listQuerySchema = z.object({
  /** open | dismissed | all */
  status: z.enum(["open", "dismissed", "all"]).default("open"),
});

const dismissSchema = z.object({
  /** True marks the difference intentional; false restores the flag. */
  dismissed: z.boolean(),
});

/**
 * Which attributions a flag may be built from.
 *
 * The same rule as the voice profiles, and for a sharper reason. Inference is
 * right about three quarters of the time, and when it is wrong the line
 * usually belongs to the other person in the conversation. A handful of the
 * interlocutor's lines landing in one scene is precisely the pattern this
 * detector is built to notice — so on inferred data it would reliably flag its
 * own mistakes and dress them up as a craft problem.
 */
const RELIABLE_METHODS = ["tag", "manual"];

/** Recomputes every flag for a project, preserving what the author dismissed. */
async function recomputeFlags(projectId: string, threshold: number, ignoredMetrics: string[]) {
  const [lines, characters] = await Promise.all([
    prisma.dialogueLine.findMany({
      where: {
        projectId,
        characterId: { not: null },
        sceneId: { not: null },
        method: { in: RELIABLE_METHODS },
      },
      orderBy: { startOffset: "asc" },
      select: { text: true, characterId: true, sceneId: true },
    }),
    prisma.character.findMany({
      where: { projectId, isArchived: false },
      select: { id: true, name: true },
    }),
  ]);

  const scenes = await prisma.scene.findMany({
    where: { chapter: { projectId } },
    select: { id: true, index: true, chapter: { select: { index: true } } },
  });
  const sceneMeta = new Map(scenes.map((s) => [s.id, { chapterIndex: s.chapter.index, sceneIndex: s.index }]));

  // character → scene → the lines they speak there.
  const grouped = new Map<string, Map<string, string[]>>();
  for (const line of lines) {
    if (!line.characterId || !line.sceneId || !sceneMeta.has(line.sceneId)) continue;
    const perScene = grouped.get(line.characterId) ?? new Map<string, string[]>();
    perScene.set(line.sceneId, [...(perScene.get(line.sceneId) ?? []), line.text]);
    grouped.set(line.characterId, perScene);
  }

  const input: CharacterScenes[] = characters
    .filter((c) => grouped.has(c.id))
    .map((c) => ({
      characterId: c.id,
      name: c.name,
      scenes: [...grouped.get(c.id)!.entries()].map(([sceneId, passages]) => ({
        sceneId,
        ...sceneMeta.get(sceneId)!,
        passages,
      })),
    }));

  const measurements = measureScenes(input);
  const baselines = buildBaselines(input, measurements);
  const flags = findFlags(measurements, baselines, {
    threshold,
    ignoredMetrics: ignoredMetrics as ComparableMetric[],
  });

  // Prisma's Json input type demands an index signature, which an interface
  // array does not carry. The shape is plain data either way.
  const asJson = (evidence: Flag["evidence"]) => evidence as unknown as Prisma.InputJsonValue;

  const keep = new Set(flags.map((f) => `${f.characterId}:${f.sceneId}`));
  const existing = await prisma.voiceFlag.findMany({
    where: { projectId },
    select: { id: true, characterId: true, sceneId: true },
  });
  const stale = existing
    .filter((row) => !keep.has(`${row.characterId}:${row.sceneId}`))
    .map((row) => row.id);

  await prisma.$transaction([
    // Flags that no longer hold are gone, dismissed or not — a dismissal
    // records a judgement about a difference, and the difference is no longer
    // there to judge.
    prisma.voiceFlag.deleteMany({ where: { id: { in: stale } } }),
    ...flags.map((flag) =>
      prisma.voiceFlag.upsert({
        where: { characterId_sceneId: { characterId: flag.characterId, sceneId: flag.sceneId } },
        // No `dismissedAt` in either branch: an untouched flag stays open and a
        // dismissed one stays dismissed, while its numbers are brought current.
        create: {
          projectId,
          characterId: flag.characterId,
          sceneId: flag.sceneId,
          severity: flag.severity,
          peakZ: flag.peakZ,
          evidence: asJson(flag.evidence),
          summary: flag.summary,
          sceneWordCount: flag.sceneWordCount,
          baselineWordCount: flag.baselineWordCount,
          baselineSceneCount: flag.baselineSceneCount,
        },
        update: {
          severity: flag.severity,
          peakZ: flag.peakZ,
          evidence: asJson(flag.evidence),
          summary: flag.summary,
          sceneWordCount: flag.sceneWordCount,
          baselineWordCount: flag.baselineWordCount,
          baselineSceneCount: flag.baselineSceneCount,
        },
      }),
    ),
    prisma.project.update({ where: { id: projectId }, data: { flagsComputedAt: new Date() } }),
  ]);

  return { flagCount: flags.length, baselines };
}

export async function flagRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  /** Runs detection. Called after attribution changes, or when settings do. */
  app.post<{ Params: { id: string } }>("/:id/flags/recompute", async (request) => {
    const project = await ownedProject(request.currentUser!.id, request.params.id);
    const { flagCount } = await recomputeFlags(
      project.id,
      project.flagThreshold,
      project.ignoredMetrics,
    );
    return { flagCount };
  });

  /**
   * The inbox. Every flag carries its own evidence and the size of the
   * evidence, because the author is being asked to overrule a statistic and
   * cannot do that on a verdict alone.
   */
  app.get<{ Params: { id: string } }>("/:id/flags", async (request) => {
    let project = await ownedProject(request.currentUser!.id, request.params.id);
    const { status } = listQuerySchema.parse(request.query);

    // First visit: run detection rather than showing an empty inbox behind a
    // button, which reads as "nothing wrong" when it means "nothing looked at".
    if (!project.flagsComputedAt) {
      await recomputeFlags(project.id, project.flagThreshold, project.ignoredMetrics);
      project = await ownedProject(request.currentUser!.id, request.params.id);
    }

    const rows = await prisma.voiceFlag.findMany({
      where: {
        projectId: project.id,
        ...(status === "open"
          ? { dismissedAt: null }
          : status === "dismissed"
            ? { dismissedAt: { not: null } }
            : {}),
      },
      orderBy: { peakZ: "desc" },
      include: {
        character: { select: { id: true, name: true } },
        scene: {
          select: {
            id: true,
            index: true,
            startOffset: true,
            endOffset: true,
            chapter: { select: { id: true, index: true, heading: true } },
          },
        },
      },
    });

    const dismissedCount = await prisma.voiceFlag.count({
      where: { projectId: project.id, dismissedAt: { not: null } },
    });

    return {
      computedAt: project.flagsComputedAt,
      settings: {
        flagThreshold: project.flagThreshold,
        ignoredMetrics: project.ignoredMetrics,
      },
      metricLabels: METRIC_LABELS,
      metricKeys: COMPARABLE_METRICS,
      dismissedCount,
      flags: rows.map((row) => ({
        id: row.id,
        severity: row.severity,
        peakZ: row.peakZ,
        summary: row.summary,
        evidence: row.evidence,
        sceneWordCount: row.sceneWordCount,
        baselineWordCount: row.baselineWordCount,
        baselineSceneCount: row.baselineSceneCount,
        dismissedAt: row.dismissedAt,
        character: row.character,
        scene: {
          id: row.scene.id,
          index: row.scene.index,
          startOffset: row.scene.startOffset,
          endOffset: row.scene.endOffset,
          chapter: row.scene.chapter,
        },
      })),
    };
  });

  /** Marks a difference intentional, or takes that back. */
  app.patch<{ Params: { id: string; flagId: string } }>(
    "/:id/flags/:flagId",
    async (request) => {
      const project = await ownedProject(request.currentUser!.id, request.params.id);
      const { dismissed } = dismissSchema.parse(request.body);

      const flag = await prisma.voiceFlag.findFirst({
        where: { id: request.params.flagId, projectId: project.id },
      });
      if (!flag) throw new HttpError(404, "That flag isn’t part of this manuscript.");

      const updated = await prisma.voiceFlag.update({
        where: { id: flag.id },
        data: { dismissedAt: dismissed ? new Date() : null },
      });

      return { flag: { id: updated.id, dismissedAt: updated.dismissedAt } };
    },
  );

  /** Sensitivity and which metrics count. Changing either re-runs detection. */
  app.patch<{ Params: { id: string } }>("/:id/flags/settings", async (request) => {
    const project = await ownedProject(request.currentUser!.id, request.params.id);
    const settings = settingsSchema.parse(request.body);

    const updated = await prisma.project.update({
      where: { id: project.id },
      data: settings,
    });

    const { flagCount } = await recomputeFlags(
      updated.id,
      updated.flagThreshold,
      updated.ignoredMetrics,
    );

    return {
      settings: {
        flagThreshold: updated.flagThreshold,
        ignoredMetrics: updated.ignoredMetrics,
      },
      flagCount,
    };
  });
}
