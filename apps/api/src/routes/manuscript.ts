import type { FastifyInstance } from "fastify";
import { countWords } from "@bp/analysis";
import { structureEditSchema } from "@bp/schema";

import { prisma } from "../db.js";
import { HttpError, requireAuth } from "../app.js";
import { EmptyManuscriptError, UnsupportedFileError, parseManuscript } from "../ingest/parse.js";
import { chapterParagraphs, rebuildStructure, refreshChapterScenes } from "../ingest/structure.js";

/** Loads a project the current user owns, or 404s. Never leaks another user's ids. */
async function ownedProject(userId: string, projectId: string) {
  const project = await prisma.project.findFirst({ where: { id: projectId, userId } });
  if (!project) throw new HttpError(404, "That manuscript doesn’t exist, or isn’t yours.");
  return project;
}

const publicChapter = (c: {
  id: string;
  index: number;
  heading: string;
  ordinal: number | null;
  startOffset: number;
  endOffset: number;
  wordCount: number;
  scenes: Array<{
    id: string;
    index: number;
    startOffset: number;
    endOffset: number;
    wordCount: number;
    breakKind: string;
  }>;
}) => ({
  id: c.id,
  index: c.index,
  heading: c.heading,
  ordinal: c.ordinal,
  startOffset: c.startOffset,
  endOffset: c.endOffset,
  wordCount: c.wordCount,
  scenes: c.scenes.map((s) => ({
    id: s.id,
    index: s.index,
    startOffset: s.startOffset,
    endOffset: s.endOffset,
    wordCount: s.wordCount,
    breakKind: s.breakKind,
  })),
});

export async function manuscriptRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  // ------------------------------------------------------------- upload ---

  app.post<{ Params: { id: string } }>("/:id/upload", async (request, reply) => {
    const project = await ownedProject(request.currentUser!.id, request.params.id);

    const file = await request.file();
    if (!file) throw new HttpError(400, "No file was attached to that upload.");

    let buffer: Buffer;
    try {
      buffer = await file.toBuffer();
    } catch {
      throw new HttpError(413, "That file is larger than the 25 MB limit.");
    }

    let parsed;
    try {
      parsed = await parseManuscript(buffer, file.filename);
    } catch (error) {
      if (error instanceof UnsupportedFileError || error instanceof EmptyManuscriptError) {
        throw new HttpError(400, error.message);
      }
      throw error;
    }

    const wordCount = countWords(parsed.text);

    await prisma.project.update({
      where: { id: project.id },
      data: {
        sourceText: parsed.text,
        wordCount,
        sourceFormat: parsed.format,
        sourceFilename: file.filename,
        // Adopt metadata from the file only where the author left the field blank.
        title: project.title.trim() ? project.title : (parsed.title ?? project.title),
        author: project.author ?? parsed.author ?? null,
      },
    });

    const chapterCount = await rebuildStructure(project.id, parsed.text);

    return reply.status(201).send({
      wordCount,
      chapterCount,
      format: parsed.format,
      detected: { title: parsed.title ?? null, author: parsed.author ?? null },
    });
  });

  // ---------------------------------------------------------- structure ---

  app.get<{ Params: { id: string } }>("/:id/structure", async (request) => {
    const project = await ownedProject(request.currentUser!.id, request.params.id);

    const chapters = await prisma.chapter.findMany({
      where: { projectId: project.id },
      orderBy: { index: "asc" },
      include: { scenes: { orderBy: { index: "asc" } } },
    });

    return {
      structureParsedAt: project.structureParsedAt?.toISOString() ?? null,
      structureConfirmedAt: project.structureConfirmedAt?.toISOString() ?? null,
      wordCount: project.wordCount,
      chapters: chapters.map(publicChapter),
    };
  });

  /** Re-runs detection from scratch, discarding any hand edits. */
  app.post<{ Params: { id: string } }>("/:id/structure/redetect", async (request) => {
    const project = await ownedProject(request.currentUser!.id, request.params.id);
    if (!project.sourceText) throw new HttpError(400, "Upload a manuscript first.");
    const chapterCount = await rebuildStructure(project.id, project.sourceText);
    return { chapterCount };
  });

  app.post<{ Params: { id: string } }>("/:id/structure/confirm", async (request) => {
    const project = await ownedProject(request.currentUser!.id, request.params.id);
    if (!project.structureParsedAt) throw new HttpError(400, "There’s no structure to confirm yet.");
    const updated = await prisma.project.update({
      where: { id: project.id },
      data: { structureConfirmedAt: new Date() },
    });
    return { structureConfirmedAt: updated.structureConfirmedAt?.toISOString() ?? null };
  });

  /**
   * Hand corrections. Chapters must stay contiguous and cover the whole text,
   * so every edit reindexes the chapters after it rather than leaving a hole.
   */
  app.patch<{ Params: { id: string } }>("/:id/structure", async (request) => {
    const project = await ownedProject(request.currentUser!.id, request.params.id);
    const edit = structureEditSchema.parse(request.body);

    const chapters = await prisma.chapter.findMany({
      where: { projectId: project.id },
      orderBy: { index: "asc" },
    });

    const target = chapters.find((c) => c.id === edit.chapterId);
    if (!target) throw new HttpError(404, "That chapter isn’t part of this manuscript.");

    const sourceText = project.sourceText;

    if (edit.op === "rename") {
      await prisma.chapter.update({ where: { id: target.id }, data: { heading: edit.heading } });
      return { ok: true };
    }

    if (edit.op === "mergeWithPrevious") {
      const previous = chapters[target.index - 1];
      if (!previous) throw new HttpError(400, "The first chapter has nothing before it to merge into.");

      await prisma.$transaction(async (tx) => {
        await tx.chapter.delete({ where: { id: target.id } });

        const wordCount = await refreshChapterScenes(
          tx,
          previous.id,
          sourceText,
          previous.startOffset,
          target.endOffset,
        );
        await tx.chapter.update({
          where: { id: previous.id },
          data: { endOffset: target.endOffset, wordCount },
        });

        // Close the gap left in the index sequence.
        for (const later of chapters.filter((c) => c.index > target.index)) {
          await tx.chapter.update({ where: { id: later.id }, data: { index: later.index - 1 } });
        }
      });

      return { ok: true };
    }

    // splitAt
    const { offset } = edit;
    if (offset <= target.startOffset || offset >= target.endOffset) {
      throw new HttpError(400, "That split point is outside the chapter.");
    }

    await prisma.$transaction(async (tx) => {
      // Shift later chapters up first; the unique (projectId, index) constraint
      // means the new chapter's slot has to be free before it can be inserted.
      const later = chapters.filter((c) => c.index > target.index).sort((a, b) => b.index - a.index);
      for (const chapter of later) {
        await tx.chapter.update({ where: { id: chapter.id }, data: { index: chapter.index + 1 } });
      }

      const firstWordCount = await refreshChapterScenes(tx, target.id, sourceText, target.startOffset, offset);
      await tx.chapter.update({
        where: { id: target.id },
        data: { endOffset: offset, wordCount: firstWordCount },
      });

      const created = await tx.chapter.create({
        data: {
          projectId: project.id,
          index: target.index + 1,
          heading: sourceText.slice(offset, offset + 80).split("\n")[0]?.trim() || "Untitled",
          ordinal: null,
          startOffset: offset,
          endOffset: target.endOffset,
          wordCount: 0,
        },
      });

      const secondWordCount = await refreshChapterScenes(tx, created.id, sourceText, offset, target.endOffset);
      await tx.chapter.update({ where: { id: created.id }, data: { wordCount: secondWordCount } });
    });

    return { ok: true };
  });

  // ------------------------------------------------------------ content ---

  app.get<{ Params: { id: string; chapterId: string } }>("/:id/chapters/:chapterId", async (request) => {
    const project = await ownedProject(request.currentUser!.id, request.params.id);

    const chapter = await prisma.chapter.findFirst({
      where: { id: request.params.chapterId, projectId: project.id },
      include: { scenes: { orderBy: { index: "asc" } } },
    });
    if (!chapter) throw new HttpError(404, "That chapter isn’t part of this manuscript.");

    return {
      chapter: publicChapter(chapter),
      paragraphs: chapterParagraphs(project.sourceText, chapter, chapter.scenes),
    };
  });
}
