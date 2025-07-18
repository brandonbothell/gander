/*
  Warnings:

  - The primary key for the `Nickname` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `id` on the `Nickname` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Nickname" (
    "streamId" TEXT NOT NULL DEFAULT 'cam1',
    "filename" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,

    PRIMARY KEY ("streamId", "filename")
);
INSERT INTO "new_Nickname" ("filename", "nickname", "streamId") SELECT "filename", "nickname", "streamId" FROM "Nickname";
DROP TABLE "Nickname";
ALTER TABLE "new_Nickname" RENAME TO "Nickname";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
