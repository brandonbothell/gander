/*
  Warnings:

  - The primary key for the `StreamMask` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The required column `id` was added to the `StreamMask` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_StreamMask" (
    "id" TEXT NOT NULL,
    "streamId" TEXT NOT NULL,
    "mask" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("id", "streamId")
);
INSERT INTO "new_StreamMask" ("mask", "streamId") SELECT "mask", "streamId" FROM "StreamMask";
DROP TABLE "StreamMask";
ALTER TABLE "new_StreamMask" RENAME TO "StreamMask";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
