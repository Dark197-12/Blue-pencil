import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import { ZodError } from "zod";

import { env, isProduction } from "./env.js";
import { SESSION_COOKIE, validateSession } from "./auth.js";
import { authRoutes } from "./routes/auth.js";
import { projectRoutes } from "./routes/projects.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Set by `requireAuth`. Absent on unauthenticated routes. */
    currentUser?: { id: string; email: string };
    currentSessionId?: string;
  }
}

/** Thrown anywhere in a handler to produce a clean JSON error response. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export async function requireAuth(request: FastifyRequest, _reply: FastifyReply) {
  const raw = request.cookies[SESSION_COOKIE];
  if (!raw) throw new HttpError(401, "You need to sign in to do that.");

  const unsigned = request.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value) throw new HttpError(401, "Your session is no longer valid.");

  const session = await validateSession(unsigned.value);
  if (!session) throw new HttpError(401, "Your session has expired. Sign in again.");

  request.currentUser = { id: session.user.id, email: session.user.email };
  request.currentSessionId = session.id;
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: isProduction
      ? true
      : { transport: undefined, level: "info" },
    trustProxy: isProduction,
  });

  await app.register(cors, { origin: env.WEB_ORIGIN, credentials: true });
  await app.register(cookie, { secret: env.SESSION_SECRET });

  // Body-less POSTs (sign out) still carry a Content-Type from many HTTP
  // clients. Without a parser registered for it Fastify answers 415 before the
  // handler ever runs, so the request silently does nothing. Accept any content
  // type when the body is empty; reject it only when there is something we
  // genuinely cannot parse.
  app.addContentTypeParser("*", { parseAs: "buffer" }, (_request, body: Buffer, done) => {
    if (body.length === 0) return done(null, undefined);
    // A non-empty body in a type we don't parse. Fastify handles errors raised
    // here itself and always answers 400 — it ignores both a thrown HttpError
    // and a `statusCode` property — so don't bother dressing this up as a 415.
    done(new Error("Send JSON."), undefined);
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) {
      return reply
        .status(error.status)
        .send({ error: { message: error.message, ...(error.fields ? { fields: error.fields } : {}) } });
    }

    if (error instanceof ZodError) {
      const fields: Record<string, string> = {};
      for (const issue of error.issues) {
        const key = issue.path.join(".") || "_";
        if (!fields[key]) fields[key] = issue.message;
      }
      return reply.status(400).send({ error: { message: "Check the highlighted fields.", fields } });
    }

    // Fastify's own errors (bad JSON body, unsupported media type) carry a
    // statusCode. Pass 4xx through; anything else is ours to own.
    const status = (error as { statusCode?: unknown }).statusCode;
    if (typeof status === "number" && status >= 400 && status < 500) {
      const message = error instanceof Error ? error.message : "That request wasn’t valid.";
      return reply.status(status).send({ error: { message } });
    }

    request.log.error({ err: error }, "unhandled error");
    return reply.status(500).send({ error: { message: "Something went wrong on our side." } });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({ error: { message: `No route for ${request.method} ${request.url}.` } });
  });

  app.get("/health", async () => ({ status: "ok", uptime: Math.round(process.uptime()) }));

  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(projectRoutes, { prefix: "/api/projects" });

  return app;
}
