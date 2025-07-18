-- CreateTable
CREATE TABLE "DeletedRecording" (
    "streamId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "deletedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("streamId", "filename")
);
