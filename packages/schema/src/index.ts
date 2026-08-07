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
  sourceFormat: z.string().nullable(),
  sourceFilename: z.string().nullable(),
  /** Null until a manuscript has been uploaded and split into chapters. */
  structureParsedAt: z.string().nullable(),
  /** Null until the author has reviewed and accepted that split. */
  structureConfirmedAt: z.string().nullable(),
  chapterCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Project = z.infer<typeof projectSchema>;

export const createProjectSchema = z.object({
  title: z.string().trim().min(1, "Give the manuscript a title.").max(200),
  author: z.string().trim().max(200).optional(),
});
export type CreateProject = z.infer<typeof createProjectSchema>;

// ----------------------------------------------------------- structure ----

export const sceneSchema = z.object({
  id: z.string(),
  index: z.number().int().nonnegative(),
  startOffset: z.number().int().nonnegative(),
  endOffset: z.number().int().nonnegative(),
  wordCount: z.number().int().nonnegative(),
  breakKind: z.enum(["chapter-start", "separator", "blank-run"]),
});
export type Scene = z.infer<typeof sceneSchema>;

export const chapterSchema = z.object({
  id: z.string(),
  index: z.number().int().nonnegative(),
  heading: z.string(),
  ordinal: z.number().int().nullable(),
  startOffset: z.number().int().nonnegative(),
  endOffset: z.number().int().nonnegative(),
  wordCount: z.number().int().nonnegative(),
  scenes: z.array(sceneSchema),
});
export type Chapter = z.infer<typeof chapterSchema>;

export const paragraphSchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  text: z.string(),
  /** Gutenberg-style editorial inserts, e.g. "[Illustration]". Not the author's prose. */
  isEditorialArtifact: z.boolean(),
  /** Index of the scene this paragraph falls in, within its chapter. */
  sceneIndex: z.number().int().nonnegative(),
});
export type Paragraph = z.infer<typeof paragraphSchema>;

/** Edits the author can make on the structure-confirmation screen. */
export const structureEditSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("rename"), chapterId: z.string(), heading: z.string().trim().min(1).max(200) }),
  /** Folds a chapter into the one before it. Rejected for the first chapter. */
  z.object({ op: z.literal("mergeWithPrevious"), chapterId: z.string() }),
  /** Splits a chapter at an absolute offset into the manuscript text. */
  z.object({ op: z.literal("splitAt"), chapterId: z.string(), offset: z.number().int().nonnegative() }),
]);
export type StructureEdit = z.infer<typeof structureEditSchema>;

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
