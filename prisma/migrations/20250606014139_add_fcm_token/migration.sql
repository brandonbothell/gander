-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PushSubscription" (
    "sid" TEXT NOT NULL PRIMARY KEY,
    "endpoint" TEXT,
    "expirationTime" TEXT,
    "p256dh" TEXT,
    "auth" TEXT,
    "fcmToken" TEXT
);
INSERT INTO "new_PushSubscription" ("auth", "endpoint", "expirationTime", "p256dh", "sid") SELECT "auth", "endpoint", "expirationTime", "p256dh", "sid" FROM "PushSubscription";
DROP TABLE "PushSubscription";
ALTER TABLE "new_PushSubscription" RENAME TO "PushSubscription";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
