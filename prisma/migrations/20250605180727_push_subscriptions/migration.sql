-- CreateTable
CREATE TABLE "PushSubscription" (
    "sid" TEXT NOT NULL PRIMARY KEY,
    "endpoint" TEXT NOT NULL,
    "expirationTime" TEXT,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL
);
