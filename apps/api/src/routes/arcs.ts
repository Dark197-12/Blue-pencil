import type { FastifyInstance } from "fastify";
import {
  buildBaselines,
  findArcs,
  findContextShifts,
  inferAddressees,
  measureContexts,
  measureScenes,
  type CharacterScenes,
  type ContextLine,
} from "@bp/analysis";

import { prisma } from "../db.js";
import { HttpError, requireAuth, heavyRoute } from "../app.js";
import { isReliableMethod } from "./attribution-quality.js";

async function ownedProject(userId: string, projectId: string) {
  const project = await prisma.project.findFirst({ where: { id: projectId, userId } });
  if (!project) throw new HttpError(404, "That manuscript doesn’t exist, or isn’t yours.");
  return project;
}

/**
 * How each character's voice moves — across the book, and across the people
 * they speak to.
 *
 * Both answers are computed on request rather than stored. Unlike a flag,
 * neither carries a decision the author has made, so there is nothing to
 * preserve and nothing that can go stale against the attributions.
 */
export async function arcRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.get<{ Params: { id: string } }>("/:id/arcs", heavyRoute, async (request) => {
    const project = await ownedProject(request.currentUser!.id, request.params.id);

    const [lines, characters, scenes] = await Promise.all([
      prisma.dialogueLine.findMany({
        where: { projectId: project.id, sceneId: { not: null } },
        orderBy: { startOffset: "asc" },
        select: {
          text: true,
          characterId: true,
          sceneId: true,
          method: true,
          startOffset: true,
        },
      }),
      prisma.character.findMany({
        where: { projectId: project.id, isArchived: false },
        select: { id: true, name: true },
      }),
      prisma.scene.findMany({
        where: { chapter: { projectId: project.id } },
        select: {
          id: true,
          index: true,
          chapter: { select: { id: true, index: true, heading: true } },
        },
      }),
    ]);

    const names = new Map(characters.map((c) => [c.id, c.name]));
    const sceneMeta = new Map(
      scenes.map((s) => [
        s.id,
        { chapterIndex: s.chapter.index, sceneIndex: s.index, heading: s.chapter.heading, chapterId: s.chapter.id },
      ]),
    );

    // ------------------------------------------------------------- arcs --
    // Measured from reliable attributions only: a trend built on guesses is a
    // trend in the guessing.
    const grouped = new Map<string, Map<string, string[]>>();
    for (const line of lines) {
      if (!line.characterId || !line.sceneId || !isReliableMethod(line.method)) continue;
      if (!sceneMeta.has(line.sceneId)) continue;
      const perScene = grouped.get(line.characterId) ?? new Map<string, string[]>();
      perScene.set(line.sceneId, [...(perScene.get(line.sceneId) ?? []), line.text]);
      grouped.set(line.characterId, perScene);
    }

    const input: CharacterScenes[] = characters
      .filter((c) => grouped.has(c.id))
      .map((c) => ({
        characterId: c.id,
        name: c.name,
        scenes: [...grouped.get(c.id)!.entries()].map(([sceneId, passages]) => {
          const meta = sceneMeta.get(sceneId)!;
          return { sceneId, chapterIndex: meta.chapterIndex, sceneIndex: meta.sceneIndex, passages };
        }),
      }));

    const measurements = measureScenes(input);
    const baselines = buildBaselines(input, measurements);
    const arcs = findArcs(measurements, names);

    // --------------------------------------------------------- contexts --
    // Every line goes in, including unattributed ones, so a scene with an
    // unknown speaker is not mistaken for a private conversation.
    const contextLines: ContextLine[] = lines
      .filter((line) => line.sceneId !== null && sceneMeta.has(line.sceneId))
      .map((line) => ({
        sceneId: line.sceneId!,
        characterId: line.characterId,
        text: line.text,
        offset: line.startOffset,
        isReliable: isReliableMethod(line.method),
      }));

    const addressed = inferAddressees(contextLines);
    const contexts = measureContexts(addressed);
    const shifts = findContextShifts(contexts, baselines, names);

    /**
     * How many scenes have every line accounted for.
     *
     * This is the number that actually gates the relationship analysis, and it
     * is worth reporting on its own because it is the one the author can move.
     * A scene with a single unidentified line cannot be called a private
     * conversation, so partial attribution buys nothing here — unlike the arcs,
     * where every attributed line helps a little.
     */
    const linesPerScene = new Map<string, { total: number; known: number }>();
    for (const line of lines) {
      if (!line.sceneId || !sceneMeta.has(line.sceneId)) continue;
      const counts = linesPerScene.get(line.sceneId) ?? { total: 0, known: 0 };
      counts.total++;
      if (line.characterId) counts.known++;
      linesPerScene.set(line.sceneId, counts);
    }
    const scenesWithDialogue = [...linesPerScene.values()];
    const scenesFullyAttributed = scenesWithDialogue.filter((c) => c.known === c.total).length;

    /** Everything measured, so the interface can show what was possible. */
    const scenesPerCharacter = new Map<string, number>();
    for (const measurement of measurements) {
      scenesPerCharacter.set(
        measurement.characterId,
        (scenesPerCharacter.get(measurement.characterId) ?? 0) + 1,
      );
    }

    return {
      coverage: {
        linesTotal: lines.length,
        linesMeasurable: lines.filter((l) => l.characterId && isReliableMethod(l.method)).length,
        linesAddressed: addressed.length,
        /** Characters with the six scenes an arc needs. */
        arcEligible: [...scenesPerCharacter.values()].filter((n) => n >= 6).length,
        relationships: contexts.length,
        scenesWithDialogue: scenesWithDialogue.length,
        scenesFullyAttributed,
      },
      characters: [...scenesPerCharacter.entries()]
        .map(([id, sceneCount]) => ({
          id,
          name: names.get(id) ?? id,
          sceneCount,
          isArcEligible: sceneCount >= 6,
        }))
        .sort((a, b) => b.sceneCount - a.sceneCount),
      arcs,
      relationships: contexts
        .map((c) => ({
          speakerId: c.speakerId,
          speakerName: names.get(c.speakerId) ?? c.speakerId,
          addresseeId: c.addresseeId,
          addresseeName: names.get(c.addresseeId) ?? c.addresseeId,
          wordCount: c.wordCount,
          lineCount: c.lineCount,
          sceneCount: c.scenes.length,
          metrics: c.metrics,
        }))
        .sort((a, b) => b.wordCount - a.wordCount),
      shifts,
    };
  });
}
