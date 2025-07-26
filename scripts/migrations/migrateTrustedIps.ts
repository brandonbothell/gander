// Create scripts/migrateTrustedIps.ts
import { PrismaClient } from '../../source/generated/prisma';

const prisma = new PrismaClient();

async function migrateTrustedIps() {
  console.log('Starting migration of trustedIps to device objects...');

  const users = await prisma.user.findMany();
  let migratedCount = 0;

  for (const user of users) {
    try {
      const trustedIps = JSON.parse(user.trustedIps || '[]');

      // Check if already migrated (first item is an object with ip property)
      if (trustedIps.length > 0 && typeof trustedIps[0] === 'object' && trustedIps[0].ip) {
        console.log(`User ${user.username} already migrated, skipping...`);
        continue;
      }

      // Convert string IPs to device objects
      const migratedIps = trustedIps.map((ip: string) => ({
        ip,
        deviceInfo: {
          userAgent: 'Unknown (migrated)',
          platform: 'Unknown',
          vendor: 'Unknown',
          language: 'Unknown',
          timezone: 'Unknown',
          screen: 'Unknown'
        },
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
        loginCount: 1
      }));

      await prisma.user.update({
        where: { username: user.username },
        data: { trustedIps: JSON.stringify(migratedIps) }
      });

      migratedCount++;
      console.log(`Migrated ${trustedIps.length} IPs for user ${user.username}`);
    } catch (error) {
      console.error(`Error migrating user ${user.username}:`, error);
    }
  }

  console.log(`Migration completed. Migrated ${migratedCount} users.`);
}

migrateTrustedIps()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
