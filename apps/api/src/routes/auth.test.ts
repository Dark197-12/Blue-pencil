import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { prisma } from "../db.js";
import { as, makeApp, signUp } from "../test/helpers.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await makeApp();
});

afterAll(async () => {
  await app.close();
});

describe("sign-up", () => {
  it("creates an account and signs the new user in", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { email: "new@example.test", password: "correct-horse-battery" },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().user.email).toBe("new@example.test");
    expect(response.headers["set-cookie"]).toBeDefined();
  });

  it("never returns the password hash", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { email: "quiet@example.test", password: "correct-horse-battery" },
    });
    expect(response.body).not.toContain("passwordHash");
    expect(response.json().user.passwordHash).toBeUndefined();
  });

  it("refuses an email that is already registered", async () => {
    const payload = { email: "twice@example.test", password: "correct-horse-battery" };
    await app.inject({ method: "POST", url: "/api/auth/signup", payload });
    const second = await app.inject({ method: "POST", url: "/api/auth/signup", payload });

    expect(second.statusCode).toBeGreaterThanOrEqual(400);
    expect(await prisma.user.count({ where: { email: payload.email } })).toBe(1);
  });

  it("rejects a password too short to be worth hashing", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { email: "short@example.test", password: "abc" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.fields).toBeDefined();
  });
});

describe("sign-in", () => {
  it("accepts the right password and rejects the wrong one", async () => {
    const user = await signUp(app, "signin@example.test");

    const good = await app.inject({
      method: "POST",
      url: "/api/auth/signin",
      payload: { email: user.email, password: user.password },
    });
    expect(good.statusCode).toBe(200);

    const bad = await app.inject({
      method: "POST",
      url: "/api/auth/signin",
      payload: { email: user.email, password: "not-the-password" },
    });
    expect(bad.statusCode).toBe(401);
  });

  it("says the same thing whether the email exists or not", async () => {
    // Different messages here would let anyone enumerate registered addresses.
    const user = await signUp(app, "enumerate@example.test");

    const wrongPassword = await app.inject({
      method: "POST",
      url: "/api/auth/signin",
      payload: { email: user.email, password: "not-the-password" },
    });
    const noSuchUser = await app.inject({
      method: "POST",
      url: "/api/auth/signin",
      payload: { email: "nobody@example.test", password: "not-the-password" },
    });

    expect(wrongPassword.statusCode).toBe(noSuchUser.statusCode);
    expect(wrongPassword.json().error.message).toBe(noSuchUser.json().error.message);
  });
});

describe("session", () => {
  it("identifies the signed-in user, and nobody otherwise", async () => {
    const user = await signUp(app);

    const anonymous = await app.inject({ method: "GET", url: "/api/auth/me" });
    expect(anonymous.json().user).toBeNull();

    const identified = await as(app, user, { method: "GET", url: "/api/auth/me" });
    expect(identified.json().user.email).toBe(user.email);
  });

  /**
   * Sign-out sends no body, but clients still attach a Content-Type. Without a
   * parser registered for that combination Fastify answers before the handler
   * runs, leaving the session in place while the interface reports otherwise.
   */
  it("signs out even when the request carries a content-type and no body", async () => {
    const user = await signUp(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/signout",
      headers: { cookie: user.cookie, "content-type": "application/json" },
    });

    expect(response.statusCode).toBeLessThan(300);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
  });

  it("really ends the session on the server, not just in the browser", async () => {
    const user = await signUp(app);
    await as(app, user, { method: "POST", url: "/api/auth/signout" });

    // Replaying the same cookie must fail: an opaque server-side session is the
    // whole reason for not using a self-contained token.
    const replayed = await as(app, user, { method: "GET", url: "/api/auth/me" });
    expect(replayed.json().user).toBeNull();
  });

  it("refuses a forged cookie", async () => {
    const user = await signUp(app);
    const session = await prisma.session.findFirst({ where: { userId: user.id } });

    // The raw id, unsigned — what an attacker who guessed one would send.
    const forged = await app.inject({
      method: "GET",
      url: "/api/projects",
      headers: { cookie: `bp_session=${session!.id}` },
    });
    expect(forged.statusCode).toBe(401);
  });

  it("rejects an expired session", async () => {
    const user = await signUp(app);
    await prisma.session.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const response = await as(app, user, { method: "GET", url: "/api/projects" });
    expect(response.statusCode).toBe(401);
    // …and the dead row is cleared rather than left to accumulate.
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
  });
});
