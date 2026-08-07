import { buildApp } from "./app.js";
import { env } from "./env.js";
import { purgeExpiredSessions } from "./auth.js";
import { prisma } from "./db.js";

const app = await buildApp();

try {
  await prisma.$queryRaw`SELECT 1`;
} catch (error) {
  app.log.error(
    { err: error },
    "Could not reach the database. Check DATABASE_URL in .env and that migrations have run (pnpm db:migrate).",
  );
  process.exit(1);
}

const purged = await purgeExpiredSessions();
if (purged > 0) app.log.info(`purged ${purged} expired session(s)`);

await app.listen({ port: env.PORT, host: "0.0.0.0" });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    app.log.info(`${signal} received, shutting down`);
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  });
}
