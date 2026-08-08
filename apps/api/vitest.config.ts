import { config as loadEnv } from "dotenv";
import { defineConfig } from "vitest/config";

/**
 * Route tests run against a real Postgres, not a mocked Prisma.
 *
 * These handlers are thin over the database: they check ownership, group rows,
 * and hand the result to the analysis package. Mocking Prisma would assert that
 * the code calls the functions it calls, which is not a fact about the system.
 * The bugs actually worth catching here — a route that forgets `userId` in its
 * where clause, a cascade that does not fire, a unique constraint that does —
 * only exist against a real database.
 *
 * A separate database rather than the development one, because the suite
 * truncates between tests and nobody should lose their working manuscript to a
 * stray `pnpm test`.
 */
loadEnv();

const developmentUrl = process.env.DATABASE_URL ?? "";
const testUrl =
  process.env.TEST_DATABASE_URL ??
  // Same server and credentials, different database.
  developmentUrl.replace(/\/([^/?]+)(\?|$)/, "/$1_test$2");

/**
 * Set here as well as in `test.env`, because the two run in different places.
 * `test.env` reaches the worker processes that execute the tests; globalSetup
 * runs in this process, and without this line it would create and migrate the
 * *development* database while the tests talked to the test one.
 */
process.env.DATABASE_URL = testUrl;

export default defineConfig({
  test: {
    env: { DATABASE_URL: testUrl, NODE_ENV: "test" },
    globalSetup: ["./src/test/global-setup.ts"],
    setupFiles: ["./src/test/setup.ts"],
    /**
     * One database, so one worker. Parallel files would truncate each other's
     * rows mid-test and fail in ways that look like real bugs.
     */
    fileParallelism: false,
    poolOptions: { forks: { singleFork: true } },
    // Migrating and building an app per file costs a few seconds up front.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
