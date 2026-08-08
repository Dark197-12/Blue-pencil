import type { FastifyInstance } from "fastify";
import { credentialsSchema } from "@bp/schema";
import { Prisma } from "@prisma/client";

import { prisma } from "../db.js";
import { HttpError, requireAuth } from "../app.js";
import {
  SESSION_COOKIE,
  createSession,
  deleteSession,
  hashPassword,
  sessionCookieOptions,
  verifyPassword,
} from "../auth.js";
import { isProduction } from "../env.js";

const publicUser = (user: { id: string; email: string; createdAt: Date }) => ({
  id: user.id,
  email: user.email,
  createdAt: user.createdAt.toISOString(),
});

export async function authRoutes(app: FastifyInstance) {
  const cookieOptions = sessionCookieOptions(isProduction);

  /**
   * Sign-up and sign-in are limited far harder than anything else, and by IP
   * rather than by session — there is no session yet, and the attack these
   * guard against is precisely someone working through passwords without one.
   * Ten a minute is beyond any honest typist and nowhere near a useful rate
   * for guessing.
   */
  const credentialLimit = {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
  };

  app.post("/signup", credentialLimit, async (request, reply) => {
    const { email, password } = credentialsSchema.parse(request.body);

    const passwordHash = await hashPassword(password);

    let user;
    try {
      user = await prisma.user.create({ data: { email, passwordHash } });
    } catch (error) {
      // Unique constraint on email. Reported per-field so the form can point at it.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new HttpError(409, "That email is already registered.", {
          email: "That email is already registered.",
        });
      }
      throw error;
    }

    const session = await createSession(user.id, request.headers["user-agent"]);
    reply.setCookie(SESSION_COOKIE, session.id, cookieOptions);
    return reply.status(201).send({ user: publicUser(user) });
  });

  app.post("/signin", credentialLimit, async (request, reply) => {
    const { email, password } = credentialsSchema.parse(request.body);

    const user = await prisma.user.findUnique({ where: { email } });

    // Hash even when the user is missing, so a wrong email and a wrong password
    // take the same time and the endpoint doesn't leak which accounts exist.
    const ok = user
      ? await verifyPassword(password, user.passwordHash)
      : await verifyPassword(password, await hashPassword("decoy-password-value"));

    if (!user || !ok) throw new HttpError(401, "That email and password don’t match.");

    const session = await createSession(user.id, request.headers["user-agent"]);
    reply.setCookie(SESSION_COOKIE, session.id, cookieOptions);
    return reply.send({ user: publicUser(user) });
  });

  app.post("/signout", { preHandler: requireAuth }, async (request, reply) => {
    if (request.currentSessionId) await deleteSession(request.currentSessionId);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return reply.status(204).send();
  });

  /** Used by the web app on boot to decide between the app and the sign-in screen. */
  app.get("/me", async (request, reply) => {
    const raw = request.cookies[SESSION_COOKIE];
    if (!raw) return reply.send({ user: null });

    const unsigned = request.unsignCookie(raw);
    if (!unsigned.valid || !unsigned.value) return reply.send({ user: null });

    const { validateSession } = await import("../auth.js");
    const session = await validateSession(unsigned.value);
    if (!session) return reply.send({ user: null });

    return reply.send({ user: publicUser(session.user) });
  });
}
