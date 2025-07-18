-- CreateTable
CREATE TABLE "User" (
    "username" TEXT NOT NULL PRIMARY KEY,
    "password" TEXT NOT NULL,
    "trustedIps" TEXT NOT NULL DEFAULT '[]'
);
