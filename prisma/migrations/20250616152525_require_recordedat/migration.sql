/*
  Warnings:

  - Made the column `recordedAt` on table `MotionRecording` required. This step will fail if there are existing NULL values in that column.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_MotionRecording" (
    "streamId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "duration" INTEGER NOT NULL,
    "nickname" TEXT,
    "recordedAt" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("streamId", "filename")
);
INSERT INTO "new_MotionRecording" ("duration", "filename", "nickname", "recordedAt", "streamId", "updatedAt") SELECT "duration", "filename", "nickname", "recordedAt", "streamId", "updatedAt" FROM "MotionRecording";
DROP TABLE "MotionRecording";
ALTER TABLE "new_MotionRecording" RENAME TO "MotionRecording";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
