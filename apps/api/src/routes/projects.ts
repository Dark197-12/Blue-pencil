import type { FastifyInstance } from "fastify";
import { createProjectSchema } from "@bp/schema";

import { prisma } from "../db.js";
import { HttpError, requireAuth } from "../app.js";

interface ProjectRow {
  id: string;
  title: string;
  author: string | null;
  wordCount: number;
  sourceFormat: string | null;
  sourceFilename: string | null;
  structureParsedAt: Date | null;
  structureConfirmedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const publicProject = (p: ProjectRow, chapterCount = 0) => ({
  id: p.id,
  title: p.title,
  author: p.author,
  wordCount: p.wordCount,
  sourceFormat: p.sourceFormat,
  sourceFilename: p.sourceFilename,
  structureParsedAt: p.structureParsedAt?.toISOString() ?? null,
  structureConfirmedAt: p.structureConfirmedAt?.toISOString() ?? null,
  chapterCount,
  createdAt: p.createdAt.toISOString(),
  updatedAt: p.updatedAt.toISOString(),
});

export async function projectRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.get("/", async (request) => {
    const projects = await prisma.project.findMany({
      where: { userId: request.currentUser!.id },
      orderBy: { updatedAt: "desc" },
      // sourceText is excluded deliberately — it is the whole manuscript, and
      // shipping it with every list request would be megabytes per row.
      select: {
        id: true,
        title: true,
        author: true,
        wordCount: true,
        sourceFormat: true,
        sourceFilename: true,
        structureParsedAt: true,
        structureConfirmedAt: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { chapters: true } },
      },
    });
    return { projects: projects.map((p) => publicProject(p, p._count.chapters)) };
  });

  app.post("/", async (request, reply) => {
    const body = createProjectSchema.parse(request.body);
    const project = await prisma.project.create({
      data: {
        userId: request.currentUser!.id,
        title: body.title,
        author: body.author ?? null,
      },
    });
    return reply.status(201).send({ project: publicProject(project) });
  });

  app.get<{ Params: { id: string } }>("/:id", async (request) => {
    const project = await prisma.project.findFirst({
      where: { id: request.params.id, userId: request.currentUser!.id },
      include: { _count: { select: { chapters: true } } },
    });
    if (!project) throw new HttpError(404, "That manuscript doesn’t exist, or isn’t yours.");
    return { project: publicProject(project, project._count.chapters) };
  });

  app.delete<{ Params: { id: string } }>("/:id", async (request, reply) => {
    // deleteMany scopes by userId in the same statement, so one user can never
    // delete another's project by guessing an id.
    const { count } = await prisma.project.deleteMany({
      where: { id: request.params.id, userId: request.currentUser!.id },
    });
    if (count === 0) throw new HttpError(404, "That manuscript doesn’t exist, or isn’t yours.");
    return reply.status(204).send();
  });
}
