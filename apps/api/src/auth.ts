import { randomBytes } from "node:crypto";
import { prisma } from "./db.js";

export { hashPassword, verifyPassword } from "./password.js";

export const SESSION_COOKIE = "bp_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

/**
 * Sessions live in the database and the cookie carries only an opaque id, so
 * signing out on the server genuinely ends the session — unlike a
 * self-contained JWT, which stays valid until it expires no matter what.
 */
export async function createSession(userId: string, userAgent?: string) {
  return prisma.session.create({
    data: {
      id: randomBytes(32).toString("base64url"),
      userId,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      userAgent: userAgent?.slice(0, 255) ?? null,
    },
  });
}

export async function validateSession(sessionId: string) {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { user: true },
  });

  if (!session) return null;

  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }

  return session;
}

export async function deleteSession(sessionId: string) {
  await prisma.session.delete({ where: { id: sessionId } }).catch(() => undefined);
}

/** Housekeeping for expired rows. Called on boot; cheap enough to leave in. */
export async function purgeExpiredSessions() {
  const { count } = await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return count;
}

/**
 * `sameSite: "lax"` in every environment, because the browser app and the API
 * are served from one origin.
 *
 * An earlier version sent `SameSite=None` in production, which is what a split
 * deployment would need — and which Safari and Brave increasingly refuse,
 * producing sign-outs that only reproduce on someone else's machine. Serving
 * the built app from this same server removes the need entirely. Ports do not
 * affect SameSite, so the development setup on :5173 and :3001 is same-site
 * too and behaves identically.
 */
export const sessionCookieOptions = (secure: boolean) =>
  ({
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    signed: true,
    maxAge: SESSION_TTL_MS / 1000,
  }) as const;
