import { PrismaClient } from '../../source/generated/prisma'

const prisma = new PrismaClient()

const mapping: Record<string, string> = {
  cam1: 'cmc53bic00000p03cfhifr28z',
  cam2: 'cmc549iag0000p0x8kxd7bbid',
}

async function migrate() {
  // UserLastSeenRecording
  await prisma.userLastSeenRecording.updateMany({
    where: { streamId: 'cam1' },
    data: { streamId: mapping.cam1 },
  })
  await prisma.userLastSeenRecording.updateMany({
    where: { streamId: 'cam2' },
    data: { streamId: mapping.cam2 },
  })

  // DeletedRecording
  await prisma.deletedRecording.updateMany({
    where: { streamId: 'cam1' },
    data: { streamId: mapping.cam1 },
  })
  await prisma.deletedRecording.updateMany({
    where: { streamId: 'cam2' },
    data: { streamId: mapping.cam2 },
  })

  // StreamMask
  await prisma.streamMask.updateMany({
    where: { streamId: 'cam1' },
    data: { streamId: mapping.cam1 },
  })
  await prisma.streamMask.updateMany({
    where: { streamId: 'cam2' },
    data: { streamId: mapping.cam2 },
  })

  // StreamState
  await prisma.streamState.updateMany({
    where: { streamId: 'cam1' },
    data: { streamId: mapping.cam1 },
  })
  await prisma.streamState.updateMany({
    where: { streamId: 'cam2' },
    data: { streamId: mapping.cam2 },
  })

  // MotionRecording
  await prisma.motionRecording.updateMany({
    where: { streamId: 'cam1' },
    data: { streamId: mapping.cam1 },
  })
  await prisma.motionRecording.updateMany({
    where: { streamId: 'cam2' },
    data: { streamId: mapping.cam2 },
  })

  console.log('Migration complete!')
  await prisma.$disconnect()
}

migrate().catch(e => {
  console.error(e)
  prisma.$disconnect()
  process.exit(1)
})
