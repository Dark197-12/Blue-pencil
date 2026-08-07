import { z } from "zod";

/**
 * Environment is validated once, at boot. A missing or malformed variable
 * should stop the process immediately with a readable message — not surface as
 * `undefined` three layers deep on the first request that happens to need it.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required."),
  SESSION_SECRET: z
    .string()
    .min(32, "SESSION_SECRET must be at least 32 characters. Generate one with:\n  node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""),
  WEB_ORIGIN: z.string().url().default("http://localhost:5173"),
  ANTHROPIC_API_KEY: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
  console.error(`\nInvalid environment.\n\n${lines.join("\n")}\n\nCopy .env.example to .env and fill it in.\n`);
  process.exit(1);
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === "production";
