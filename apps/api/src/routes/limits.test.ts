import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { as, makeApp, signUp } from "../test/helpers.js";

/**
 * Rate limiting, and the shape of what it returns.
 *
 * The limit firing is the easy half. The half worth a test is what the client
 * receives: the limiter originally worked perfectly — counted correctly, set
 * Retry-After — and then the error handler answered 500, because
 * `errorResponseBuilder` returns a plain object which is neither an `Error` nor
 * carries a `statusCode`, so it fell through every branch and was treated as an
 * internal fault. A limiter that reports itself as a server error is worse than
 * none: it tells the client to retry, and tells the operator they have a bug.
 */

let app: FastifyInstance;

beforeAll(async () => {
  app = await makeApp();
});

afterAll(async () => {
  await app.close();
});

/** A fixed address, so the attempts all land in one bucket. */
const FROM = "203.0.113.7";

describe("credential rate limiting", () => {
  it("allows a reasonable number of attempts and then refuses", async () => {
    const statuses: number[] = [];

    for (let i = 0; i < 14; i++) {
      const response = await app.inject({
        method: "POST",
        url: "/api/auth/signin",
        payload: { email: "nobody@example.test", password: "not-the-password" },
        remoteAddress: FROM,
      });
      statuses.push(response.statusCode);
    }

    expect(statuses.filter((s) => s === 401).length).toBe(10);
    expect(statuses.filter((s) => s === 429).length).toBe(4);
  });

  it("answers 429 in the application's own error shape, not 500", async () => {
    for (let i = 0; i < 11; i++) {
      await app.inject({
        method: "POST",
        url: "/api/auth/signin",
        payload: { email: "nobody@example.test", password: "not-the-password" },
        remoteAddress: "203.0.113.8",
      });
    }

    const limited = await app.inject({
      method: "POST",
      url: "/api/auth/signin",
      payload: { email: "nobody@example.test", password: "not-the-password" },
      remoteAddress: "203.0.113.8",
    });

    expect(limited.statusCode).toBe(429);
    expect(limited.headers["retry-after"]).toBeDefined();
    // The same envelope every other error in this API uses.
    expect(limited.json().error.message).toMatch(/try again/i);
    expect(limited.json().error.message).not.toMatch(/went wrong on our side/i);
  });

  it("does not let one address exhaust another's allowance", async () => {
    for (let i = 0; i < 12; i++) {
      await app.inject({
        method: "POST",
        url: "/api/auth/signin",
        payload: { email: "nobody@example.test", password: "not-the-password" },
        remoteAddress: "203.0.113.9",
      });
    }

    const elsewhere = await app.inject({
      method: "POST",
      url: "/api/auth/signin",
      payload: { email: "nobody@example.test", password: "not-the-password" },
      remoteAddress: "203.0.113.10",
    });

    expect(elsewhere.statusCode).toBe(401);
  });

  it("leaves ordinary browsing alone while credentials are being throttled", async () => {
    const user = await signUp(app);

    for (let i = 0; i < 12; i++) {
      await app.inject({
        method: "POST",
        url: "/api/auth/signin",
        payload: { email: "nobody@example.test", password: "not-the-password" },
        remoteAddress: FROM,
      });
    }

    // The tight limit belongs to the credential routes, not to the whole API.
    const listing = await as(app, user, { method: "GET", url: "/api/projects" });
    expect(listing.statusCode).toBe(200);
  });
});
