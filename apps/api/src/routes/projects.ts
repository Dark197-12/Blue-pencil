import type { FastifyInstance } from "fastify";
import { createProjectSchema } from "@bp/schema";

import { prisma } from "../db.js";
import { HttpError, requireAuth } from "../app.js";

const publicProject = (p: {
  id: string;
  title: string;
  author: string | null;
  wordCount: number;
  createdAt: Date;
  updatedAt: Date;
}) => ({
  id: p.id,
  title: p.title,
  author: p.author,
  wordCount: p.wordCount,
  createdAt: p.createdAt.toISOString(),
  updatedAt: p.updatedAt.toISOString(),
});

export async function projectRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.get("/", async (request) => {
    const projects = await prisma.project.findMany({
      where: { userId: request.currentUser!.id },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        author: true,
        wordCount: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return { projects: projects.map(publicProject) };
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
    });
    if (!project) throw new HttpError(404, "That manuscript doesn’t exist, or isn’t yours.");
    return { project: publicProject(project) };
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
