import '@dotenvx/dotenvx/config'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '../../source/generated/prisma/client'

const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

const cams: Record<string, string> = {
  from: 'cmc53bic00000p03cfhifr28z',
  to: 'cmcs4vqkq0000p0ngn9dty48f',
}

async function migrate() {
  // MotionRecording
  await prisma.motionRecording.updateMany({
    where: { streamId: cams.from },
    data: { streamId: cams.to },
  })

  console.log('Migration complete!')
  await prisma.$disconnect()
}

migrate().catch((e) => {
  console.error(e)
  prisma.$disconnect()
  process.exit(1)
})
