import { PrismaClient } from "@prisma/client";
import { env, isProduction } from "./env.js";

/**
 * `tsx watch` re-evaluates modules on every save, which would otherwise open a
 * new connection pool each time until Postgres refuses them. Caching the client
 * on globalThis keeps one pool across reloads.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: isProduction ? ["warn", "error"] : ["warn", "error"],
    datasources: { db: { url: env.DATABASE_URL } },
  });

if (!isProduction) globalForPrisma.prisma = prisma;
