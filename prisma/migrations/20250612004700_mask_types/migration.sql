-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_StreamMask" (
    "id" TEXT NOT NULL,
    "streamId" TEXT NOT NULL,
    "mask" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'fixed',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("id", "streamId")
);
INSERT INTO "new_StreamMask" ("createdAt", "id", "mask", "streamId") SELECT "createdAt", "id", "mask", "streamId" FROM "StreamMask";
DROP TABLE "StreamMask";
ALTER TABLE "new_StreamMask" RENAME TO "StreamMask";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
