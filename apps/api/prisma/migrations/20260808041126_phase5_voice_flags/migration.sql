-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "flagThreshold" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
ADD COLUMN     "flagsComputedAt" TIMESTAMP(3),
ADD COLUMN     "ignoredMetrics" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "voice_flags" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "sceneId" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "peakZ" DOUBLE PRECISION NOT NULL,
    "evidence" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "sceneWordCount" INTEGER NOT NULL,
    "baselineWordCount" INTEGER NOT NULL,
    "baselineSceneCount" INTEGER NOT NULL,
    "dismissedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "voice_flags_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "voice_flags_projectId_peakZ_idx" ON "voice_flags"("projectId", "peakZ");

-- CreateIndex
CREATE INDEX "voice_flags_sceneId_idx" ON "voice_flags"("sceneId");

-- CreateIndex
CREATE UNIQUE INDEX "voice_flags_characterId_sceneId_key" ON "voice_flags"("characterId", "sceneId");

-- AddForeignKey
ALTER TABLE "voice_flags" ADD CONSTRAINT "voice_flags_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_flags" ADD CONSTRAINT "voice_flags_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_flags" ADD CONSTRAINT "voice_flags_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "scenes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
