-- CreateTable
CREATE TABLE "Session" (
    "sid" TEXT NOT NULL PRIMARY KEY,
    "data" TEXT NOT NULL,
    "expires_at" DATETIME
);
