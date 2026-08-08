import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from "fastify";

import { buildApp } from "../app.js";
import { prisma } from "../db.js";
import { hashPassword } from "../password.js";

/**
 * Helpers for exercising the API over `app.inject`, which runs a real request
 * through the real stack — routing, content-type parsing, cookies, auth hooks,
 * error handler — without opening a socket.
 *
 * A fresh app per test file rather than one shared instance. The rate limiter
 * keeps its counters in memory on the instance, so a shared app would let one
 * file's requests exhaust another file's allowance, and the failure would look
 * like a routing bug.
 */
export async function makeApp(): Promise<FastifyInstance> {
  const app = await buildApp();
  await app.ready();
  return app;
}

export interface TestUser {
  id: string;
  email: string;
  password: string;
  /** Ready to pass as a `cookie` header. */
  cookie: string;
}

let userCount = 0;

/**
 * Creates a user and signs them in, returning the session cookie.
 *
 * Signing in through the route rather than inserting a session row directly:
 * the cookie is signed, and a test that forges its own would stop exercising
 * the signing and unsigning that every other request depends on.
 */
export async function signUp(app: FastifyInstance, email?: string): Promise<TestUser> {
  const nth = ++userCount;
  const address = email ?? `user${nth}@example.test`;
  const password = "correct-horse-battery-staple";

  const response = await app.inject({
    method: "POST",
    url: "/api/auth/signup",
    payload: { email: address, password },
    /**
     * A distinct client address per user.
     *
     * The credential routes allow ten attempts a minute per IP, and every
     * injected request otherwise arrives from 127.0.0.1 — so the eleventh test
     * user in a file would be refused by the limiter rather than by anything
     * the test meant to exercise. Giving each their own address keeps the limit
     * real in production and out of the way here; the test that actually
     * covers it pins one address deliberately.
     */
    remoteAddress: `10.${(nth >> 16) & 0xff}.${(nth >> 8) & 0xff}.${nth & 0xff}`,
  });

  if (response.statusCode !== 201 && response.statusCode !== 200) {
    throw new Error(`sign-up failed (${response.statusCode}): ${response.body}`);
  }

  const cookie = response.headers["set-cookie"];
  const raw = Array.isArray(cookie) ? cookie[0]! : String(cookie);

  return {
    id: (response.json() as { user: { id: string } }).user.id,
    email: address,
    password,
    cookie: raw.split(";")[0]!,
  };
}

/**
 * Issues a request as a signed-in user.
 *
 * The return type is written out rather than inferred: inference names a type
 * from inside light-my-request's own package path, which does not survive
 * declaration emit.
 */
export function as(
  app: FastifyInstance,
  user: TestUser,
  options: InjectOptions,
): Promise<LightMyRequestResponse> {
  return app.inject({
    ...options,
    headers: { ...options.headers, cookie: user.cookie },
  });
}

/**
 * A manuscript with structure, dialogue and a cast already in place.
 *
 * Written straight to the database rather than driven through upload and
 * extraction. Those have their own tests; here they would be a slow, noisy
 * fixture, and a failure in extraction would fail every downstream test at once
 * rather than the one that covers it.
 */
export async function seedManuscript(
  userId: string,
  options: { title?: string } = {},
) {
  /**
   * Two characters, eight scenes each, with enough speech to clear every floor
   * in the analysis package: 60 words per character per scene before a scene is
   * measured at all, and 500 across the book before a baseline is usable.
   *
   * Ada speaks formally in every scene but the last, where she goes clipped —
   * that is the deviation the flag tests look for. Bram is clipped throughout,
   * so a correct detector never flags him.
   */
  const formal =
    "I am aware of the circumstances, and I would be grateful if you would refrain from that observation.";
  const clipped =
    "No. Not now. Go away. I said no. Leave it be. Not today. Please stop. I mean it. Go.";

  const sourceText = "Chapter 1\n\n" + `${formal}\n\n`.repeat(40);

  const project = await prisma.project.create({
    data: {
      userId,
      title: options.title ?? "A Test Manuscript",
      author: "Nobody",
      sourceText,
      wordCount: 800,
      sourceFormat: "txt",
      sourceFilename: "test.txt",
      structureParsedAt: new Date(),
      structureConfirmedAt: new Date(),
    },
  });

  const [ada, bram] = await Promise.all([
    prisma.character.create({
      data: { projectId: project.id, name: "Ada", aliases: ["Ada"], isConfirmed: true },
    }),
    prisma.character.create({
      data: { projectId: project.id, name: "Bram", aliases: ["Bram"], isConfirmed: true },
    }),
  ]);

  const chapter = await prisma.chapter.create({
    data: {
      projectId: project.id,
      index: 0,
      heading: "Chapter 1",
      ordinal: 1,
      startOffset: 0,
      endOffset: sourceText.length,
      wordCount: 800,
    },
  });

  const scenes = [];
  for (let i = 0; i < 8; i++) {
    scenes.push(
      await prisma.scene.create({
        data: {
          chapterId: chapter.id,
          index: i,
          startOffset: i * 100,
          endOffset: (i + 1) * 100,
          wordCount: 100,
          breakKind: i === 0 ? "chapter-start" : "separator",
        },
      }),
    );
  }

  // Ten lines a scene, alternating, so each character gets five — enough words
  // to be measured. Fewer and every scene falls under the floor and the
  // detector correctly reports nothing, which looks like a broken test.
  const rows = [];
  let offset = 0;
  for (const [index, scene] of scenes.entries()) {
    for (let line = 0; line < 10; line++) {
      const isAda = line % 2 === 0;
      const text = isAda && index < scenes.length - 1 ? formal : clipped;
      rows.push({
        projectId: project.id,
        sceneId: scene.id,
        startOffset: offset,
        endOffset: offset + 50,
        segments: [{ start: offset, end: offset + 50 }],
        text,
        wordCount: text.split(/\s+/).length,
        speakerRaw: isAda ? "Ada" : "Bram",
        speakerKind: "name",
        characterId: isAda ? ada.id : bram.id,
        method: "tag",
        confidence: 1,
      });
      offset += 100;
    }
  }
  await prisma.dialogueLine.createMany({ data: rows });

  return { project, chapter, scenes, characters: { ada, bram } };
}
