import { afterAll, beforeEach } from "vitest";
import { prisma } from "../db.js";

/**
 * Empties the database before every test.
 *
 * Truncating `users` alone is enough: every other table hangs off it through a
 * cascading foreign key, directly or through projects. Listing the tables
 * individually would be a second copy of the schema, and one that silently
 * stops covering anything added later.
 */
beforeEach(async () => {
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "users" RESTART IDENTITY CASCADE`);
});

afterAll(async () => {
  await prisma.$disconnect();
});
