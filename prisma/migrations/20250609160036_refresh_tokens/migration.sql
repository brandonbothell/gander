-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "username" TEXT NOT NULL PRIMARY KEY,
    "jwts" TEXT NOT NULL DEFAULT '[]',
    "refreshTokens" TEXT NOT NULL DEFAULT '[]',
    "trustedIps" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_User" ("createdAt", "jwts", "trustedIps", "username") SELECT "createdAt", "jwts", "trustedIps", "username" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
