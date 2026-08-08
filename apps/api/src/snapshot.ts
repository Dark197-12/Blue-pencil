import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { snapshotName } from "@bp/schema";

import { buildApp } from "./app.js";
import { prisma } from "./db.js";

/**
 * Freezes the demo manuscript into static JSON.
 *
 * Every read endpoint in this API is a pure function of a stored manuscript —
 * given the same rows it returns the same answer, forever. So a deployment with
 * no server can still show the whole analysis, if somebody records the answers
 * first.
 *
 * The recording is made by driving the real application through `app.inject`
 * rather than by querying the database and reassembling the shapes by hand. It
 * costs nothing and it removes the only real risk in the exercise: a snapshot
 * that quietly disagrees with what the server would have said. Whatever the
 * route does — grouping, sorting, the analysis package, the field names — is
 * what lands on disk, because it is the route that produced it.
 *
 *   pnpm --filter @bp/api snapshot
 */

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "../../web/public/demo");

async function main() {
  const app = await buildApp();
  await app.ready();

  const project = await prisma.project.findFirst({
    where: { title: "Pride and Prejudice" },
    orderBy: { updatedAt: "desc" },
  });
  if (!project) throw new Error("No seeded manuscript found. Run `pnpm seed:demo` first.");

  // A session, so the injected requests pass `requireAuth` exactly as a
  // browser's would. Removed again at the end: it must not outlive the build.
  const session = await prisma.session.create({
    data: {
      id: `snapshot-${Date.now()}`,
      userId: project.userId,
      expiresAt: new Date(Date.now() + 3_600_000),
      userAgent: "snapshot",
    },
  });
  const cookie = `bp_session=${app.signCookie(session.id)}`;

  const chapters = await prisma.chapter.findMany({
    where: { projectId: project.id },
    orderBy: { index: "asc" },
    select: { id: true },
  });

  const urls = [
    "/api/auth/me",
    "/api/projects",
    `/api/projects/${project.id}`,
    `/api/projects/${project.id}/structure`,
    `/api/projects/${project.id}/cast`,
    `/api/projects/${project.id}/attribution/stats`,
    `/api/projects/${project.id}/voice?includeInferred=false`,
    `/api/projects/${project.id}/voice?includeInferred=true`,
    `/api/projects/${project.id}/flags?status=open`,
    `/api/projects/${project.id}/flags?status=dismissed`,
    `/api/projects/${project.id}/arcs`,
    /**
     * The review queue, at the exact limit the interface asks for. Worth
     * recording even though the demo cannot accept an answer: the screen is
     * where most of the attribution work actually happens, and a reviewer
     * should see it rather than read that it exists.
     */
    `/api/projects/${project.id}/attribution/queue?filter=unattributed&limit=20`,
    `/api/projects/${project.id}/attribution/queue?filter=uncertain&limit=20`,
    ...chapters.flatMap((chapter) => [
      `/api/projects/${project.id}/chapters/${chapter.id}`,
      `/api/projects/${project.id}/chapters/${chapter.id}/dialogue`,
    ]),
  ];

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  let bytes = 0;

  for (const url of urls) {
    const response = await app.inject({ method: "GET", url, headers: { cookie } });
    if (response.statusCode !== 200) {
      throw new Error(`${url} answered ${response.statusCode}: ${response.body.slice(0, 200)}`);
    }
    const name = snapshotName(url);
    writeFileSync(join(OUT, name), response.body);
    bytes += response.body.length;
  }

  /**
   * The demo has no sign-in, so the browser needs to know which project to open
   * without being told. Recorded here rather than hardcoded in the web app,
   * because the id is generated when the manuscript is seeded.
   */
  writeFileSync(
    join(OUT, "manifest.json"),
    JSON.stringify(
      {
        projectId: project.id,
        title: project.title,
        author: project.author,
        wordCount: project.wordCount,
        chapterCount: chapters.length,
        capturedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );

  await prisma.session.delete({ where: { id: session.id } });
  await app.close();

  process.stdout.write(
    `${urls.length + 1} files, ${(bytes / 1024 / 1024).toFixed(1)} MB -> apps/web/public/demo\n`,
  );
}

main()
  .catch((error) => {
    process.exitCode = 1;
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  })
  .finally(() => prisma.$disconnect());
