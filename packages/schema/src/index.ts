import { z } from "zod";

/**
 * Contracts shared by the API and the web app. The API validates incoming
 * requests against these; the web app imports the inferred types so a change
 * here is a compile error on both sides rather than a runtime surprise.
 */

// ---------------------------------------------------------------- auth ----

export const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address.");

/**
 * 12 characters and nothing else. Composition rules (one upper, one digit, a
 * symbol) push people toward `Password1!` — length is what actually helps.
 */
export const passwordSchema = z
  .string()
  .min(12, "Use at least 12 characters.")
  .max(200, "That password is too long.");

export const credentialsSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});
export type Credentials = z.infer<typeof credentialsSchema>;

export const userSchema = z.object({
  id: z.string(),
  email: z.string(),
  createdAt: z.string(),
});
export type User = z.infer<typeof userSchema>;

// ------------------------------------------------------------ projects ----

/** One manuscript. A user may have many; each is analysed independently. */
export const projectSchema = z.object({
  id: z.string(),
  title: z.string(),
  author: z.string().nullable(),
  wordCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Project = z.infer<typeof projectSchema>;

export const createProjectSchema = z.object({
  title: z.string().trim().min(1, "Give the manuscript a title.").max(200),
  author: z.string().trim().max(200).optional(),
});
export type CreateProject = z.infer<typeof createProjectSchema>;

// -------------------------------------------------------------- errors ----

/** Every non-2xx response from the API has this shape. */
export const apiErrorSchema = z.object({
  error: z.object({
    message: z.string(),
    /** Present when the failure was per-field, keyed by field name. */
    fields: z.record(z.string()).optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
