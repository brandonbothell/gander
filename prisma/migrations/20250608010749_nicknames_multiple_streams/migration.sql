/*
  Warnings:

  - The primary key for the `Nickname` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The required column `id` was added to the `Nickname` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Nickname" (
    "id" INTEGER PRIMARY KEY,
    "streamId" TEXT NOT NULL DEFAULT 'cam1',
    "filename" TEXT NOT NULL,
    "nickname" TEXT NOT NULL
);
INSERT INTO "new_Nickname" ("filename", "nickname") SELECT "filename", "nickname" FROM "Nickname";
DROP TABLE "Nickname";
ALTER TABLE "new_Nickname" RENAME TO "Nickname";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
