import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { prisma } from "../db.js";
import { as, makeApp, seedManuscript, signUp, type TestUser } from "../test/helpers.js";

/**
 * Every route that takes a project id must prove the project belongs to the
 * caller before it does anything at all.
 *
 * This is the one class of bug in the API worth real test effort. The check is
 * a single `userId` in a where clause, repeated in seven files, and leaving it
 * out fails silently: the route returns somebody else's manuscript with a 200
 * and nothing anywhere reports a problem. A new route added later is exactly
 * as likely to miss it, which is why this walks the surface rather than a
 * sample.
 *
 * The expected answer is 404, not 403. Distinguishing "not yours" from "does
 * not exist" would confirm to a stranger that a given project id is real.
 */

let app: FastifyInstance;
let owner: TestUser;
let intruder: TestUser;
let seeded: Awaited<ReturnType<typeof seedManuscript>>;

beforeAll(async () => {
  app = await makeApp();
});

afterAll(async () => {
  await app.close();
});

describe("project ownership", () => {
  /** Rebuilt per test, since the setup file truncates between them. */
  async function scene() {
    owner = await signUp(app);
    intruder = await signUp(app);
    seeded = await seedManuscript(owner.id);
    return { projectId: seeded.project.id };
  }

  it("lists only your own manuscripts", async () => {
    const { projectId } = await scene();

    const mine = await as(app, owner, { method: "GET", url: "/api/projects" });
    const theirs = await as(app, intruder, { method: "GET", url: "/api/projects" });

    expect(mine.json().projects.map((p: { id: string }) => p.id)).toContain(projectId);
    expect(theirs.json().projects).toEqual([]);
  });

  it("refuses every read route to a stranger", async () => {
    const { projectId } = await scene();
    const chapterId = seeded.chapter.id;

    const reads = [
      `/api/projects/${projectId}`,
      `/api/projects/${projectId}/structure`,
      `/api/projects/${projectId}/cast`,
      `/api/projects/${projectId}/chapters/${chapterId}`,
      `/api/projects/${projectId}/chapters/${chapterId}/dialogue`,
      `/api/projects/${projectId}/attribution/queue`,
      `/api/projects/${projectId}/attribution/stats`,
      `/api/projects/${projectId}/voice`,
      `/api/projects/${projectId}/flags`,
      `/api/projects/${projectId}/arcs`,
    ];

    for (const url of reads) {
      const response = await as(app, intruder, { method: "GET", url });
      expect(response.statusCode, url).toBe(404);
      // The body must not leak the manuscript's title either.
      expect(response.body, url).not.toContain("A Test Manuscript");
    }
  });

  it("refuses every write route to a stranger", async () => {
    const { projectId } = await scene();

    const writes: Array<[string, string, unknown]> = [
      ["POST", `/api/projects/${projectId}/dialogue/extract`, undefined],
      ["POST", `/api/projects/${projectId}/dialogue/reinfer`, undefined],
      ["POST", `/api/projects/${projectId}/structure/redetect`, undefined],
      ["POST", `/api/projects/${projectId}/structure/confirm`, undefined],
      ["POST", `/api/projects/${projectId}/cast/confirm`, undefined],
      ["POST", `/api/projects/${projectId}/flags/recompute`, undefined],
      ["PATCH", `/api/projects/${projectId}/flags/settings`, { flagThreshold: 3 }],
      ["DELETE", `/api/projects/${projectId}`, undefined],
    ];

    for (const [method, url, payload] of writes) {
      const response = await as(app, intruder, {
        method: method as "POST",
        url,
        ...(payload ? { payload } : {}),
      });
      expect(response.statusCode, `${method} ${url}`).toBe(404);
    }

    // Nothing was destroyed on the way past.
    expect(await prisma.project.count({ where: { id: projectId } })).toBe(1);
  });

  it("refuses to reassign a line through someone else's project", async () => {
    const { projectId } = await scene();
    const line = await prisma.dialogueLine.findFirst({ where: { projectId } });

    const response = await as(app, intruder, {
      method: "PATCH",
      url: `/api/projects/${projectId}/dialogue/${line!.id}`,
      payload: { characterId: null },
    });

    expect(response.statusCode).toBe(404);
    const after = await prisma.dialogueLine.findUnique({ where: { id: line!.id } });
    expect(after!.characterId).toBe(line!.characterId);
  });

  it("refuses to rename a character in someone else's cast", async () => {
    const { projectId } = await scene();

    const response = await as(app, intruder, {
      method: "PATCH",
      url: `/api/projects/${projectId}/cast/${seeded.characters.ada.id}`,
      payload: { name: "Renamed By A Stranger" },
    });

    expect(response.statusCode).toBe(404);
    const ada = await prisma.character.findUnique({ where: { id: seeded.characters.ada.id } });
    expect(ada!.name).toBe("Ada");
  });

  it("will not attach a character from another manuscript to a line", async () => {
    // The nastier shape: the caller owns both projects, so no ownership check
    // fires — but the character still belongs to a different book.
    const { projectId } = await scene();
    const other = await seedManuscript(owner.id, { title: "Another Manuscript" });
    const line = await prisma.dialogueLine.findFirst({ where: { projectId } });

    const response = await as(app, owner, {
      method: "PATCH",
      url: `/api/projects/${projectId}/dialogue/${line!.id}`,
      payload: { characterId: other.characters.ada.id },
    });

    expect(response.statusCode).toBe(404);
  });

  it("answers the same way for a project that does not exist", async () => {
    const { projectId } = await scene();

    const notYours = await as(app, intruder, { method: "GET", url: `/api/projects/${projectId}` });
    const notReal = await as(app, intruder, {
      method: "GET",
      url: "/api/projects/clzzzzzzzzzzzzzzzzzzzzzzzz",
    });

    expect(notYours.statusCode).toBe(notReal.statusCode);
    expect(notYours.json().error.message).toBe(notReal.json().error.message);
  });

  it("requires a session at all", async () => {
    const { projectId } = await scene();

    for (const url of [`/api/projects`, `/api/projects/${projectId}`]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode, url).toBe(401);
    }
  });

  it("takes the whole manuscript with the account", async () => {
    const { projectId } = await scene();
    expect(await prisma.dialogueLine.count({ where: { projectId } })).toBeGreaterThan(0);

    await prisma.user.delete({ where: { id: owner.id } });

    // Cascades are declared in the schema; this proves they are actually there.
    expect(await prisma.project.count({ where: { id: projectId } })).toBe(0);
    expect(await prisma.dialogueLine.count({ where: { projectId } })).toBe(0);
    expect(await prisma.character.count({ where: { projectId } })).toBe(0);
    expect(await prisma.chapter.count({ where: { projectId } })).toBe(0);
  });
});
