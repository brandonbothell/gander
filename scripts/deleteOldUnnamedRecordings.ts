import { PrismaClient } from '../source/generated/prisma';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

// List your streams and their recording directories here
const streams = [
  {
    id: 'cmc549iag0000p0x8kxd7bbid',
    recordDir: 'D:/Recordings/SecurityCam/cmc549iag0000p0x8kxd7bbid',
  },
  {
    id: 'cmcs4vqkq0000p0ngn9dty48f',
    recordDir: 'D:/Recordings/SecurityCam/cmcs4vqkq0000p0ngn9dty48f',
  },
];

// Helper to get the latest recordedAt date across all streams
async function getLastRecordingDay(): Promise<string | null> {
  let latest: string | null = null;
  for (const stream of streams) {
    const rec = await prisma.motionRecording.findFirst({
      where: { streamId: stream.id },
      orderBy: { recordedAt: 'desc' },
      select: { recordedAt: true },
    });
    if (rec && (!latest || rec.recordedAt > latest)) {
      latest = rec.recordedAt;
    }
  }
  return latest;
}

async function main() {
  const lastRecordingDay = await getLastRecordingDay();
  if (!lastRecordingDay) {
    console.log('No recordings found.');
    return;
  }
  let totalDeleted = 0;

  for (const stream of streams) {
    // Find all recordings before the last recording day and with no nickname
    const oldRecordings = await prisma.motionRecording.findMany({
      where: {
        streamId: stream.id,
        recordedAt: { lt: lastRecordingDay },
        OR: [{ nickname: null }, { nickname: '' }],
      },
    });

    for (const rec of oldRecordings) {
      const filePath = path.join(stream.recordDir, rec.filename);

      // Add to DeletedRecording table
      await prisma.deletedRecording
        .create({
          data: {
            streamId: stream.id,
            filename: rec.filename,
            // deletedAt will default to now()
          },
        })
        .catch(() => {});

      // Delete from DB
      await prisma.motionRecording.delete({
        where: {
          streamId_filename: { streamId: stream.id, filename: rec.filename },
        },
      });

      // Delete from filesystem if exists
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
          console.log(`Deleted: ${filePath}`);
        } catch (e) {
          console.error(`Failed to delete file: ${filePath}`, e);
        }
      } else {
        console.log(`File not found (DB entry deleted): ${filePath}`);
      }
      totalDeleted++;
    }
  }

  console.log(
    `Done. Deleted ${totalDeleted} recordings before ${lastRecordingDay}.`,
  );
}

main().then(() => prisma.$disconnect());
