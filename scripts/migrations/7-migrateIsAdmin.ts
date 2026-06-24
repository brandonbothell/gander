import '@dotenvx/dotenvx/config'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '../../source/generated/prisma/client'
import config from '../../config.json'

const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

async function migrateIsAdmin() {
  console.log('Starting migration of isAdmin...')

  const users = await prisma.user.findMany()
  let migratedCount = 0

  for (const user of users) {
    try {
      const isAdmin =
        config.users.find((u) => u.username === user.username)?.isAdmin ?? false
      await prisma.user.update({
        where: { username: user.username },
        data: { isAdmin },
      })
      migratedCount++
      console.log(`Migrated isAdmin for user ${user.username} (${isAdmin})`)
    } catch (error) {
      console.error(`Error migrating isAdmin for user ${user.username}:`, error)
    }
  }

  console.log(
    `Migration completed. Migrated ${migratedCount} users' isAdmin flags.`,
  )
}

migrateIsAdmin()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
