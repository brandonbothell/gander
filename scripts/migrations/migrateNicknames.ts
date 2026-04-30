// scripts/migrateNicknames.ts
import path from 'path'
import fs from 'fs'
import { execSync } from 'child_process'
import { PrismaClient } from '../../source/generated/prisma'

const prisma = new PrismaClient()

const streams = [
  { id: 'cam1', recordDir: 'D:/Recordings/SecurityCam' },
  { id: 'cam2', recordDir: 'D:/Recordings/SecurityCam/cam2' }
]

// Helper to get duration in seconds using ffprobe
function getVideoDuration(filePath: string): number {
  try {
    const cmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`
    const output = execSync(cmd).toString().trim()
    return Math.round(Number(output))
  } catch (e) {
    console.error(`Failed to get duration for ${filePath}:`, e)
    return 0
  }
}

async function main() {
  for (const stream of streams) {
    const files = fs.readdirSync(stream.recordDir)
      .filter(f => f.endsWith('.mp4'))
      .sort((a, b) => a.localeCompare(b)) // Sort by filename
    for (const filename of files) {
      const filePath = path.join(stream.recordDir, filename)
      const duration = getVideoDuration(filePath)

      // Try to get nickname from old table
      const old = await prisma.nickname.findUnique({
        where: { streamId_filename: { streamId: stream.id, filename } }
      })
      await prisma.motionRecording.upsert({
        where: { streamId_filename: { streamId: stream.id, filename } },
        update: { nickname: old?.nickname ?? null, duration },
        create: {
          streamId: stream.id,
          filename,
          duration,
          nickname: old?.nickname ?? null,
        }
      })
    }
  }
  console.log('Migration complete!')
}

main().then(() => prisma.$disconnect())
