import { randomUUID } from "node:crypto";

import { detectChapters, detectScenes, splitParagraphs } from "@bp/analysis";
import { prisma } from "../db.js";

/**
 * Persisting detected structure.
 *
 * Chapters and scenes are stored as offsets into Project.sourceText, never as
 * copies of it. That keeps one authoritative copy of the author's words, lets
 * structure be re-detected or hand-corrected without touching the prose, and
 * means a later parser fix can rebuild the split without a re-upload.
 */

/**
 * Replaces all structure for a project with a freshly detected split.
 *
 * Written as four bulk statements rather than a loop of creates, and the
 * difference is not a micro-optimisation. The loop version issued one round
 * trip per chapter — sixty-one for a novel — inside an interactive transaction,
 * which Prisma gives a five-second budget by default. On a database in the same
 * process as the developer that is imperceptible. On a hosted one an ocean
 * away it is sixty-one times the network latency, and the transaction expired
 * mid-way with "Transaction not found", which reads like a Prisma fault rather
 * than the arithmetic it is. Deployed, every upload would have failed.
 *
 * Ids are generated here because `createMany` cannot return them and the
 * scenes need to reference their chapter. They are opaque strings; nothing
 * depends on the format.
 */
export async function rebuildStructure(projectId: string, sourceText: string) {
  const chapters = detectChapters(sourceText);

  const chapterRows = chapters.map((chapter) => ({
    id: randomUUID(),
    projectId,
    index: chapter.index,
    heading: chapter.heading,
    ordinal: chapter.ordinal,
    startOffset: chapter.start,
    endOffset: chapter.end,
    wordCount: chapter.wordCount,
  }));

  const sceneRows = chapters.flatMap((chapter, i) =>
    detectScenes(sourceText, chapter.start, chapter.end).map((scene) => ({
      chapterId: chapterRows[i]!.id,
      index: scene.index,
      startOffset: scene.start,
      endOffset: scene.end,
      wordCount: scene.wordCount,
      breakKind: scene.breakKind,
    })),
  );

  await prisma.$transaction([
    // Scenes cascade from chapters.
    prisma.chapter.deleteMany({ where: { projectId } }),
    prisma.chapter.createMany({ data: chapterRows }),
    prisma.scene.createMany({ data: sceneRows }),
    prisma.project.update({
      where: { id: projectId },
      data: { structureParsedAt: new Date(), structureConfirmedAt: null },
    }),
  ]);

  return chapters.length;
}

/** Recomputes scenes and word counts for one chapter after its range changed. */
export async function refreshChapterScenes(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  chapterId: string,
  sourceText: string,
  startOffset: number,
  endOffset: number,
) {
  const scenes = detectScenes(sourceText, startOffset, endOffset);
  await tx.scene.deleteMany({ where: { chapterId } });
  await tx.scene.createMany({
    data: scenes.map((scene) => ({
      chapterId,
      index: scene.index,
      startOffset: scene.start,
      endOffset: scene.end,
      wordCount: scene.wordCount,
      breakKind: scene.breakKind,
    })),
  });
  return scenes.reduce((sum, scene) => sum + scene.wordCount, 0);
}

/**
 * Paragraphs of one chapter, each tagged with the scene it belongs to.
 *
 * A chapter's range begins at its heading line, because that is what makes the
 * ranges tile the manuscript with no gaps. The heading is returned separately
 * and rendered as a heading, so it is dropped here — otherwise it appears twice
 * in the reader, once styled and once as the opening paragraph.
 */
export function chapterParagraphs(
  sourceText: string,
  chapter: { startOffset: number; endOffset: number },
  scenes: ReadonlyArray<{ index: number; startOffset: number; endOffset: number }>,
) {
  const ordered = [...scenes].sort((a, b) => a.startOffset - b.startOffset);

  const newline = sourceText.indexOf("\n", chapter.startOffset);
  const headingEnd = newline === -1 || newline >= chapter.endOffset ? chapter.startOffset : newline;

  return splitParagraphs(sourceText, chapter.startOffset, chapter.endOffset)
    .filter((paragraph) => paragraph.start >= headingEnd)
    .map((paragraph) => {
      const scene = ordered.find(
        (s) => paragraph.start >= s.startOffset && paragraph.start < s.endOffset,
      );
      return {
        start: paragraph.start,
        end: paragraph.end,
        text: paragraph.text,
        isEditorialArtifact: paragraph.isEditorialArtifact,
        sceneIndex: scene?.index ?? 0,
      };
    });
}
