import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password.js";

describe("password hashing", () => {
  it("verifies a correct password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    await expect(verifyPassword("correct horse battery staple", hash)).resolves.toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    await expect(verifyPassword("correct horse battery stapler", hash)).resolves.toBe(false);
  });

  it("produces a different hash each time for the same password", async () => {
    const [a, b] = await Promise.all([hashPassword("same password"), hashPassword("same password")]);
    expect(a).not.toBe(b);
  });

  it("records its parameters so they can be raised later", async () => {
    const hash = await hashPassword("whatever");
    expect(hash.split("$").slice(0, 4)).toEqual(["scrypt", "16384", "8", "1"]);
  });

  it("treats equivalent Unicode forms as the same password", async () => {
    // "é" written as one code point vs. e + combining acute.
    const hash = await hashPassword("café password");
    await expect(verifyPassword("café password", hash)).resolves.toBe(true);
  });

  it("returns false for a malformed stored hash rather than throwing", async () => {
    await expect(verifyPassword("x", "not-a-real-hash")).resolves.toBe(false);
    await expect(verifyPassword("x", "")).resolves.toBe(false);
  });
});
