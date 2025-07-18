/*
  Warnings:

  - You are about to drop the column `data` on the `Session` table. All the data in the column will be lost.
  - You are about to drop the column `expires_at` on the `Session` table. All the data in the column will be lost.
  - Added the required column `expired` to the `Session` table without a default value. This is not possible if the table is not empty.
  - Added the required column `sess` to the `Session` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Session" (
    "sid" TEXT NOT NULL PRIMARY KEY,
    "expired" TEXT NOT NULL,
    "sess" TEXT NOT NULL
);
INSERT INTO "new_Session" ("sid") SELECT "sid" FROM "Session";
DROP TABLE "Session";
ALTER TABLE "new_Session" RENAME TO "Session";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
