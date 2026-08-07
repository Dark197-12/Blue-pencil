import mammoth from "mammoth";
import JSZip from "jszip";
import { normalizeText, readGutenbergMeta, stripGutenbergBoilerplate } from "@bp/analysis";

/**
 * Turning an uploaded file into plain manuscript text.
 *
 * Everything downstream — chapter detection, dialogue extraction, every metric —
 * reads the single normalised string this produces, so format-specific mess is
 * confined here and nowhere else has to know what a .docx is.
 */

export type SourceFormat = "txt" | "md" | "docx" | "epub";

export interface ParsedManuscript {
  text: string;
  format: SourceFormat;
  /** Metadata recovered from the file, when it carries any. */
  title?: string;
  author?: string;
}

export class UnsupportedFileError extends Error {}
export class EmptyManuscriptError extends Error {}

const EXTENSIONS: Record<string, SourceFormat> = {
  txt: "txt",
  text: "txt",
  md: "md",
  markdown: "md",
  docx: "docx",
  epub: "epub",
};

export function formatFromFilename(filename: string): SourceFormat {
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  const format = EXTENSIONS[extension];
  if (!format) {
    throw new UnsupportedFileError(
      `Blue Pencil can’t read “.${extension}” files. Upload a .txt, .md, .docx or .epub.`,
    );
  }
  return format;
}

/** Strips tags from one XHTML document, keeping paragraph boundaries intact. */
function xhtmlToText(xhtml: string): string {
  return (
    xhtml
      .replace(/<\?xml[\s\S]*?\?>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, "")
      // Block-level closers become paragraph breaks so prose doesn't run together.
      .replace(/<\/(p|div|h[1-6]|li|blockquote|section|article)>/gi, "\n\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<hr\s*\/?>/gi, "\n\n* * *\n\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
      .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
      .replace(/&[a-z]+;/gi, " ")
  );
}

/**
 * EPUB is a zip of XHTML. The spine in the .opf package file gives reading
 * order — without it the documents come back in zip order, which is arbitrary
 * and can silently shuffle a novel's chapters.
 */
async function parseEpub(buffer: Buffer): Promise<Omit<ParsedManuscript, "format">> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new UnsupportedFileError("That .epub file couldn’t be opened. It may be corrupt.");
  }

  const container = await zip.file("META-INF/container.xml")?.async("string");
  const opfPath =
    (container && /full-path="([^"]+)"/i.exec(container)?.[1]) ??
    Object.keys(zip.files).find((name) => name.toLowerCase().endsWith(".opf"));

  if (!opfPath) throw new UnsupportedFileError("That .epub is missing its package file.");

  const opf = await zip.file(opfPath)?.async("string");
  if (!opf) throw new UnsupportedFileError("That .epub is missing its package file.");

  const basePath = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";

  const manifest = new Map<string, string>();
  for (const item of opf.matchAll(/<item\b[^>]*>/gi)) {
    const tag = item[0];
    const id = /\sid="([^"]+)"/i.exec(tag)?.[1];
    const href = /\shref="([^"]+)"/i.exec(tag)?.[1];
    if (id && href) manifest.set(id, decodeURIComponent(href));
  }

  const spine = [...opf.matchAll(/<itemref\b[^>]*idref="([^"]+)"[^>]*>/gi)].map((m) => m[1]!);
  const hrefs = spine.map((id) => manifest.get(id)).filter((href): href is string => Boolean(href));

  const documents = hrefs.length > 0
    ? hrefs
    : Object.keys(zip.files).filter((n) => /\.x?html?$/i.test(n)).sort();

  const parts: string[] = [];
  for (const href of documents) {
    const file = zip.file(basePath + href) ?? zip.file(href);
    const contents = await file?.async("string");
    if (contents) parts.push(xhtmlToText(contents));
  }

  const metadata: { title?: string; author?: string } = {};
  const title = /<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i.exec(opf)?.[1]?.trim();
  const author = /<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i.exec(opf)?.[1]?.trim();
  if (title) metadata.title = title;
  if (author) metadata.author = author;

  return { text: parts.join("\n\n"), ...metadata };
}

/** Markdown formatting is stripped, but ATX headings survive as chapter markers. */
function markdownToText(source: string): string {
  return source
    .replace(/^```[\s\S]*?^```/gm, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(?<![*_])([*_])(?!\s)(.+?)(?<!\s)\1(?![*_])/g, "$2")
    .replace(/`([^`]+)`/g, "$1");
}

export async function parseManuscript(
  buffer: Buffer,
  filename: string,
): Promise<ParsedManuscript> {
  const format = formatFromFilename(filename);

  let raw: string;
  const metadata: { title?: string; author?: string } = {};

  switch (format) {
    case "txt":
      raw = buffer.toString("utf8");
      break;

    case "md":
      raw = markdownToText(buffer.toString("utf8"));
      break;

    case "docx": {
      try {
        const result = await mammoth.extractRawText({ buffer });
        raw = result.value;
      } catch {
        throw new UnsupportedFileError("That .docx couldn’t be read. Try re-saving it from your word processor.");
      }
      break;
    }

    case "epub": {
      const parsed = await parseEpub(buffer);
      raw = parsed.text;
      if (parsed.title) metadata.title = parsed.title;
      if (parsed.author) metadata.author = parsed.author;
      break;
    }
  }

  // Gutenberg's licence wrapper would otherwise become chapter one.
  const gutenberg = readGutenbergMeta(raw);
  if (gutenberg.title && !metadata.title) metadata.title = gutenberg.title;
  if (gutenberg.author && !metadata.author) metadata.author = gutenberg.author;

  const text = normalizeText(stripGutenbergBoilerplate(raw));

  if (text.trim().length === 0) {
    throw new EmptyManuscriptError("That file has no readable text in it.");
  }

  return { text, format, ...metadata };
}
