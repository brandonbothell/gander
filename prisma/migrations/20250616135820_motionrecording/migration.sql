-- CreateTable
CREATE TABLE "MotionRecording" (
    "streamId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "duration" INTEGER NOT NULL,
    "nickname" TEXT,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("streamId", "filename")
);
