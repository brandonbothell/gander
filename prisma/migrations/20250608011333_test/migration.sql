/*
  Warnings:

  - The primary key for the `Nickname` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to alter the column `id` on the `Nickname` table. The data in that column could be lost. The data in that column will be cast from `String` to `Int`.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Nickname" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "streamId" TEXT NOT NULL DEFAULT 'cam1',
    "filename" TEXT NOT NULL,
    "nickname" TEXT NOT NULL
);
INSERT INTO "new_Nickname" ("filename", "id", "nickname", "streamId") SELECT "filename", "id", "nickname", "streamId" FROM "Nickname";
DROP TABLE "Nickname";
ALTER TABLE "new_Nickname" RENAME TO "Nickname";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
