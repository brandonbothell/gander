import { PrismaClient } from '../source/generated/prisma';

const prisma = new PrismaClient();

const cams: Record<string, string> = {
  from: 'cmc53bic00000p03cfhifr28z',
  to: 'cmcs4vqkq0000p0ngn9dty48f',
};

async function migrate() {
  // MotionRecording
  await prisma.motionRecording.updateMany({
    where: { streamId: cams.from },
    data: { streamId: cams.to },
  });

  console.log('Migration complete!');
  await prisma.$disconnect();
}

migrate().catch(e => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
