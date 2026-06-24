import '@dotenvx/dotenvx/config'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '../../source/generated/prisma/client'

const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

async function deleteTrustedIps() {
  console.log('Starting deletion of trustedIps...')

  const users = await prisma.user.findMany()
  let deletedCount = 0

  for (const user of users) {
    try {
      await prisma.user.update({
        where: { username: user.username },
        data: { trustedIps: '[]' },
      })
      deletedCount++
      console.log(`Deleted trusted IPs for user ${user.username}`)
    } catch (error) {
      console.error(
        `Error deleting trusted IPs for user ${user.username}:`,
        error,
      )
    }
  }

  console.log(
    `Migration completed. Deleted ${deletedCount} users' trusted IPs.`,
  )
}

deleteTrustedIps()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
