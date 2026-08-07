-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "sourceFilename" TEXT,
ADD COLUMN     "sourceFormat" TEXT,
ADD COLUMN     "structureConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "structureParsedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "chapters" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "heading" TEXT NOT NULL,
    "ordinal" INTEGER,
    "startOffset" INTEGER NOT NULL,
    "endOffset" INTEGER NOT NULL,
    "wordCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "chapters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scenes" (
    "id" TEXT NOT NULL,
    "chapterId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "startOffset" INTEGER NOT NULL,
    "endOffset" INTEGER NOT NULL,
    "wordCount" INTEGER NOT NULL DEFAULT 0,
    "breakKind" TEXT NOT NULL DEFAULT 'chapter-start',

    CONSTRAINT "scenes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chapters_projectId_startOffset_idx" ON "chapters"("projectId", "startOffset");

-- CreateIndex
CREATE UNIQUE INDEX "chapters_projectId_index_key" ON "chapters"("projectId", "index");

-- CreateIndex
CREATE INDEX "scenes_chapterId_startOffset_idx" ON "scenes"("chapterId", "startOffset");

-- CreateIndex
CREATE UNIQUE INDEX "scenes_chapterId_index_key" ON "scenes"("chapterId", "index");

-- AddForeignKey
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "chapters"("id") ON DELETE CASCADE ON UPDATE CASCADE;
