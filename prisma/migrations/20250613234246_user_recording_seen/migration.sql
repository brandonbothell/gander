-- CreateTable
CREATE TABLE "UserLastSeenRecording" (
    "username" TEXT NOT NULL,
    "streamId" TEXT NOT NULL,
    "lastSeen" TEXT NOT NULL,

    PRIMARY KEY ("username", "streamId")
);
