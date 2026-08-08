import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

/**
 * Creates the test database if it is missing, then brings it up to the current
 * migration.
 *
 * `migrate deploy` rather than `migrate dev`: deploy applies existing
 * migrations and nothing else, so a test run can never invent a migration or
 * prompt for one. If the schema has drifted, the tests should fail rather than
 * quietly rewrite the developer's migration history.
 */
export default async function setup() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set for tests.");

  const parsed = new URL(url);
  const databaseName = parsed.pathname.slice(1);
  if (!databaseName.endsWith("_test")) {
    // A guard, not a convention. The suite truncates every table it can reach,
    // and pointing that at a development database would be unrecoverable.
    throw new Error(
      `Refusing to run tests against "${databaseName}" — the test database name must end in _test.`,
    );
  }

  // Connect to the server's default database to issue CREATE DATABASE.
  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });

  try {
    const existing = await admin.$queryRawUnsafe<Array<{ datname: string }>>(
      "SELECT datname FROM pg_database WHERE datname = $1",
      databaseName,
    );
    if (existing.length === 0) {
      // Identifiers cannot be parameterised, and the name came from our own
      // connection string rather than from input.
      await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
    }
  } finally {
    await admin.$disconnect();
  }

  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
    shell: process.platform === "win32",
  });
}
