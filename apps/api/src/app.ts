import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ZodError } from "zod";

import { env, isProduction } from "./env.js";
import { SESSION_COOKIE, validateSession } from "./auth.js";
import { authRoutes } from "./routes/auth.js";
import { projectRoutes } from "./routes/projects.js";
import { manuscriptRoutes } from "./routes/manuscript.js";
import { castRoutes } from "./routes/cast.js";
import { attributionRoutes } from "./routes/attribution.js";
import { voiceRoutes } from "./routes/voice.js";
import { flagRoutes } from "./routes/flags.js";
import { arcRoutes } from "./routes/arcs.js";

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

/**
 * Route options for the handlers that re-measure a whole manuscript — parsing
 * an upload, re-running attribution, rebuilding profiles or flags.
 *
 * These are seconds of CPU each, not milliseconds, and unlike the read
 * endpoints they cannot be made cheap by an index. Twelve a minute is far more
 * than any editing session needs and far less than it takes to tie up the
 * process.
 */
export const heavyRoute = {
  config: { rateLimit: { max: 12, timeWindow: "1 minute" } },
} as const;

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

  /**
   * Rate limiting, keyed per session where there is one.
   *
   * Keying on IP alone is wrong for this app in both directions: several
   * writers behind one office address would share a budget, and a single
   * account can open several tabs. The session id is the closest thing to "one
   * person" available, and unauthenticated traffic falls back to IP because
   * that is all there is.
   *
   * The global allowance is deliberately loose. It exists to stop a runaway
   * client or a crawler, not to ration ordinary use — the queue screen fires a
   * request per keystroke-decision and a writer working quickly is exactly the
   * user this tool is for. The expensive routes are limited individually where
   * they are defined.
   */
  await app.register(rateLimit, {
    global: true,
    max: 600,
    timeWindow: "1 minute",
    keyGenerator: (request) => {
      const raw = request.cookies[SESSION_COOKIE];
      const unsigned = raw ? request.unsignCookie(raw) : null;
      return unsigned?.valid && unsigned.value ? `s:${unsigned.value}` : `ip:${request.ip}`;
    },
    /**
     * Returns an HttpError rather than a response object.
     *
     * Whatever this builds is handed to the error handler *as the error*. A
     * plain `{ error: { message } }` has no `statusCode` and is not an
     * `Error`, so it fell through every branch below and was reported as a
     * 500 — the limiter worked, set its Retry-After header, and then told the
     * client the server had broken. Returning the same type the rest of the
     * app throws puts it back on the one formatting path.
     */
    errorResponseBuilder: (_request, context) =>
      new HttpError(
        429,
        `That’s a lot of requests at once. Try again in ${Math.ceil(context.ttl / 1000)}s.`,
      ),
  });

  // A 200k-word manuscript is only ~1 MB of text, but .docx and .epub carry
  // embedded images. 25 MB is generous for prose and still bounded.
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024, files: 1 } });

  // Body-less POSTs (sign out) still carry a Content-Type from many HTTP
  // clients. Without a parser registered for it Fastify answers 415 before the
  // handler ever runs, so the request silently does nothing. Accept any content
  // type when the body is empty; reject it only when there is something we
  // genuinely cannot parse.
  /**
   * The catch-all below does not cover `application/json`, because Fastify
   * ships a parser for it and a built-in wins over a wildcard. That parser
   * rejects an empty body outright, so a body-less POST sent as JSON — which
   * is what most HTTP clients and curl default to — answered 400 and the
   * handler never ran. Replacing it keeps JSON parsing and its errors intact
   * while treating "no body at all" as exactly that.
   */
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_request, body: string, done) => {
    if (body.trim() === "") return done(null, undefined);
    try {
      done(null, JSON.parse(body));
    } catch {
      done(new Error("Send valid JSON."), undefined);
    }
  });

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

  /**
   * In production the built browser app is served from this same server.
   *
   * One origin rather than two. The session cookie then needs no `SameSite=None`
   * — which Safari and Brave restrict — CORS stops mattering, and the whole
   * thing is one deployable instead of two that must be kept in step.
   *
   * Skipped when the build is absent, which is the normal state in development:
   * Vite serves the app on its own port with hot reload, and this server should
   * not shadow it with a stale bundle.
   */
  const webDist = env.WEB_DIST ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../web/dist");
  const hasBuiltApp = existsSync(join(webDist, "index.html"));

  if (hasBuiltApp) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
  }

  app.setNotFoundHandler((request, reply) => {
    /**
     * Client-side routes are real URLs to the browser and unknown paths to the
     * server, so anything that is not an API call falls back to the app shell
     * and lets the router decide. `/api/*` keeps answering JSON: returning HTML
     * to a fetch that expected JSON turns a clear 404 into a parse error three
     * layers away.
     */
    const path = request.url.split("?")[0] ?? "";
    // A path with a file extension was asking for a file, not a page. Falling
    // back for those would answer a missing script with 200 and a page of
    // HTML, which reaches the browser as "Unexpected token '<'" — a parse
    // error pointing at the bundle instead of a 404 pointing at the deploy.
    const wantsFile = /\.[a-z0-9]+$/i.test(path);

    if (hasBuiltApp && request.method === "GET" && !path.startsWith("/api/") && !wantsFile) {
      return reply.type("text/html").sendFile("index.html");
    }

    reply.status(404).send({ error: { message: `No route for ${request.method} ${request.url}.` } });
  });

  app.get("/health", async () => ({ status: "ok", uptime: Math.round(process.uptime()) }));

  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(projectRoutes, { prefix: "/api/projects" });
  await app.register(manuscriptRoutes, { prefix: "/api/projects" });
  await app.register(castRoutes, { prefix: "/api/projects" });
  await app.register(attributionRoutes, { prefix: "/api/projects" });
  await app.register(voiceRoutes, { prefix: "/api/projects" });
  await app.register(flagRoutes, { prefix: "/api/projects" });
  await app.register(arcRoutes, { prefix: "/api/projects" });

  return app;
}
