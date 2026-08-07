-- CreateTable
CREATE TABLE "characters" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "aliases" TEXT[],
    "isConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "characters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dialogue_lines" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sceneId" TEXT,
    "startOffset" INTEGER NOT NULL,
    "endOffset" INTEGER NOT NULL,
    "segments" JSONB NOT NULL,
    "text" TEXT NOT NULL,
    "wordCount" INTEGER NOT NULL DEFAULT 0,
    "speakerRaw" TEXT,
    "speakerKind" TEXT,
    "characterId" TEXT,
    "method" TEXT,
    "confidence" DOUBLE PRECISION,

    CONSTRAINT "dialogue_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "characters_projectId_idx" ON "characters"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "characters_projectId_name_key" ON "characters"("projectId", "name");

-- CreateIndex
CREATE INDEX "dialogue_lines_projectId_startOffset_idx" ON "dialogue_lines"("projectId", "startOffset");

-- CreateIndex
CREATE INDEX "dialogue_lines_projectId_characterId_idx" ON "dialogue_lines"("projectId", "characterId");

-- CreateIndex
CREATE INDEX "dialogue_lines_sceneId_idx" ON "dialogue_lines"("sceneId");

-- AddForeignKey
ALTER TABLE "characters" ADD CONSTRAINT "characters_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dialogue_lines" ADD CONSTRAINT "dialogue_lines_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dialogue_lines" ADD CONSTRAINT "dialogue_lines_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "scenes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dialogue_lines" ADD CONSTRAINT "dialogue_lines_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "characters"("id") ON DELETE SET NULL ON UPDATE CASCADE;
