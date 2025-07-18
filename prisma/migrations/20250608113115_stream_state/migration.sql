-- CreateTable
CREATE TABLE "StreamState" (
    "streamId" TEXT NOT NULL PRIMARY KEY,
    "state" TEXT NOT NULL,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "StreamState_streamId_idx" ON "StreamState"("streamId");
