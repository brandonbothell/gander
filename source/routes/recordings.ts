import path from 'path'
import fs from 'fs/promises'
import express from 'express'
import { StreamManager } from '../streamManager'
import { jwtAuth } from '../middleware/jwtAuth'
import { MotionRecording, Prisma } from '../generated/prisma/client'
import { prisma, RequestWithUser } from '../camera'
import { rateLimit } from 'express-rate-limit'

export default function initializeRecordingRoutes(
  app: express.Application,
  dynamicStreams: Record<string, StreamManager>,
) {
  const getAllRecordingsLimiter = rateLimit({
    validate: { ip: false },
    windowMs: 60 * 1000, // 1 minute
    max: 2,
    standardHeaders: true,
    legacyHeaders: false,
  })

  const getPageRecordingsLimiter = rateLimit({
    validate: { ip: false },
    windowMs: 10 * 1000, // 10 seconds
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
  })

  const getLatestRecordingsLimiter = rateLimit({
    validate: { ip: false },
    windowMs: 10 * 1000, // 10 seconds
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
  })

  const getRecordingLimiter = rateLimit({
    validate: { ip: false },
    windowMs: 3000, // 3 seconds
    max: 2,
    standardHeaders: true,
    legacyHeaders: false,
  })

  const getRecordingNicknameLimiter = rateLimit({
    validate: { ip: false },
    windowMs: 3000, // 3 seconds
    max: 2,
    standardHeaders: true,
    legacyHeaders: false,
  })

  const setRecordingNicknameLimiter = rateLimit({
    validate: { ip: false },
    windowMs: 3000, // 3 seconds
    max: 2,
    standardHeaders: true,
    legacyHeaders: false,
  })

  const getRecordingNicknamesLimiter = rateLimit({
    validate: { ip: false },
    windowMs: 3000, // 3 seconds
    max: 2,
    standardHeaders: true,
    legacyHeaders: false,
  })

  const deleteRecordingsLimiter = rateLimit({
    validate: { ip: false },
    windowMs: 5 * 1000, // 5 seconds
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
  })

  const getDeletedRecordingsLimiter = rateLimit({
    validate: { ip: false },
    windowMs: 10 * 1000, // 10 seconds
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
  })

  const streamThumbnailsLimiter = rateLimit({
    validate: { ip: false },
    windowMs: 30 * 1000, // 30 seconds
    max: 50,
    standardHeaders: true,
    legacyHeaders: false,
  })

  // --- Get all recordings for a stream ---
  app.get(
    '/api/recordings/:streamId',
    getAllRecordingsLimiter,
    jwtAuth,
    async (req: RequestWithUser, res) => {
      const { streamId } = req.params
      const username = req.user!.username
      const { from, to } = req.query

      // Query from MotionRecording table
      const where: Prisma.MotionRecordingWhereInput = { streamId }
      if (from || to) {
        where.filename = {}
        if (from || to) where.recordedAt = {}
        if (from) {
          where.recordedAt = {}
          where.recordedAt.gte = String(from)
        }
        if (to) {
          if (!where.recordedAt) where.recordedAt = {}
          ;(
            where.recordedAt as unknown as Prisma.StringFilter<MotionRecording>
          ).lte = String(to)
        }
      }
      const recordings = await prisma.motionRecording.findMany({
        where,
        orderBy: { filename: 'desc' },
      })

      // Only update lastSeen if the newest file is newer than the current lastSeen
      if (recordings.length > 0) {
        try {
          const current = await prisma.userLastSeenRecording.findUnique({
            where: { username_streamId: { username, streamId } },
          })
          const currentLastSeen = current?.lastSeen
          if (
            !currentLastSeen ||
            recordings[0].filename.localeCompare(currentLastSeen) < 0
          ) {
            await prisma.userLastSeenRecording.upsert({
              where: { username_streamId: { username, streamId } },
              update: { lastSeen: recordings[0].filename },
              create: { username, streamId, lastSeen: recordings[0].filename },
            })
          }
        } catch (err) {
          console.error(
            `[${streamId}] [Recordings] Failed to update last seen recording for ${username}:`,
            err,
          )
        }
      }

      res.json(recordings)
    },
  )

  // --- Paginated recordings endpoint ---
  app.get(
    '/api/recordings/:streamId/:page',
    getPageRecordingsLimiter,
    jwtAuth,
    async (req: RequestWithUser, res) => {
      const { streamId, page } = req.params
      const username = req.user!.username
      const pageNum = Math.max(1, parseInt(page, 10) ?? 1)
      const PAGE_SIZE = 50

      const total = await prisma.motionRecording.count({ where: { streamId } })
      const recordings = await prisma.motionRecording.findMany({
        where: { streamId },
        orderBy: { filename: 'desc' },
        skip: (pageNum - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      })

      // Get current lastSeen to determine what deleted recordings to send
      const currentLastSeen = await prisma.userLastSeenRecording.findUnique({
        where: { username_streamId: { username, streamId } },
      })

      // Get deleted recordings that are newer than or equal to lastSeen
      let deletedRecordings: string[] = []
      if (currentLastSeen?.lastSeen) {
        const deleted = await prisma.deletedRecording.findMany({
          where: {
            streamId,
            filename: { gte: currentLastSeen.lastSeen }, // Include recordings from lastSeen onwards
          },
          select: { filename: true },
          orderBy: { filename: 'desc' },
        })
        deletedRecordings = deleted.map((d) => d.filename)
      } else {
        // If no lastSeen, send all deleted recordings
        const deleted = await prisma.deletedRecording.findMany({
          where: { streamId },
          select: { filename: true },
          orderBy: { filename: 'desc' },
        })
        deletedRecordings = deleted.map((d) => d.filename)
      }

      // Update lastSeen if we have recordings and they're newer
      if (recordings.length > 0) {
        try {
          if (
            !currentLastSeen?.lastSeen ||
            recordings[0].filename.localeCompare(currentLastSeen.lastSeen) > 0
          ) {
            await prisma.userLastSeenRecording.upsert({
              where: { username_streamId: { username, streamId } },
              update: { lastSeen: recordings[0].filename },
              create: { username, streamId, lastSeen: recordings[0].filename },
            })
          }
        } catch (err) {
          console.error(
            `[${streamId}] [Recordings] Failed to update last seen recording for ${username}:`,
            err,
          )
        }
      }

      res.json({
        total,
        recordings,
        deletedRecordings, // Include deleted recordings in response
      })
    },
  )

  // Latest recordings endpoint
  app.get(
    '/api/latest-recordings/:streamId',
    getLatestRecordingsLimiter,
    jwtAuth,
    async (req: RequestWithUser, res) => {
      const { streamId } = req.params
      const username = req.user!.username
      const seen = await prisma.userLastSeenRecording.findUnique({
        where: { username_streamId: { username, streamId } },
      })
      const lastSeen = seen?.lastSeen

      if (!lastSeen) {
        // If no lastSeen, throw an error
        res.status(400).json({ error: 'No last seen recording found' })
        return
      }

      // Only fetch new recordings (filenames greater than lastSeen)
      const recordings = await prisma.motionRecording.findMany({
        where: {
          streamId,
          ...(lastSeen && { filename: { gt: lastSeen } }),
        },
        orderBy: { filename: 'desc' },
        select: { filename: true },
      })

      const newRecordings = recordings.map((r) => r.filename)

      // Get deleted recordings since lastSeen
      let deletedRecordings: string[] = []
      if (lastSeen) {
        const deleted = await prisma.deletedRecording.findMany({
          where: {
            streamId,
            filename: { gt: lastSeen }, // Only new deletions since lastSeen
          },
          select: { filename: true },
          orderBy: { filename: 'desc' },
        })
        deletedRecordings = deleted.map((d) => d.filename)
      }

      res.json({
        recordings: newRecordings,
        deletedRecordings, // Include new deletions
      })

      // Update lastSeen to the newest file
      if (newRecordings.length > 0) {
        await prisma.userLastSeenRecording.upsert({
          where: { username_streamId: { username, streamId } },
          update: { lastSeen: newRecordings[0] },
          create: { username, streamId, lastSeen: newRecordings[0] },
        })
      }
    },
  )

  // --- Serve a recording file for a stream ---
  app.get(
    '/recordings/:streamId/file/:filename',
    getRecordingLimiter,
    jwtAuth,
    (req, res) => {
      const { streamId, filename } = req.params
      if (!/^[\w\-.]+\.mp4$/.test(filename)) {
        res.status(400).json({ error: 'Invalid filename' })
        return
      }
      const stream = dynamicStreams[streamId]
      if (!stream) {
        res.status(404).json({ error: 'Stream not found' })
        return
      }
      const filePath = path.join(stream.config.recordDir, filename)
      if (!filePath.startsWith(stream.config.recordDir)) {
        res.status(403).send('Forbidden')
        return
      }

      res.sendFile(filePath, (err) => {
        if (res.headersSent) return
        if (
          err &&
          typeof err === 'object' &&
          'code' in err &&
          err.code !== 'ECONNABORTED'
        ) {
          res.status(404).json({ error: 'File not found' })
          console.error(
            `[${streamId}] Failed to serve recording file ${filename}:`,
            JSON.stringify(err, null, 2),
          )
        }
      })
    },
  )

  // --- Nickname endpoints ---
  app.get(
    '/api/recordings/:streamId/:filename/nickname',
    getRecordingNicknameLimiter,
    jwtAuth,
    async (req, res) => {
      const { streamId, filename } = req.params
      const record = await prisma.motionRecording.findUnique({
        where: { streamId_filename: { filename, streamId } },
      })
      res.json({ nickname: record?.nickname ?? '' })
    },
  )

  app.post(
    '/api/recordings/:streamId/:filename/nickname',
    setRecordingNicknameLimiter,
    jwtAuth,
    express.json(),
    async (req, res) => {
      const { streamId, filename } = req.params
      const { nickname } = req.body
      await prisma.motionRecording
        .update({
          where: { streamId_filename: { filename, streamId } },
          data: { nickname },
        })
        .then(() => res.json({ success: true }))
        .catch(() =>
          res
            .status(500)
            .json({ success: false, error: 'Failed to save nickname' }),
        )
    },
  )

  app.get(
    '/api/recordings-nicknames/:streamId',
    getRecordingNicknamesLimiter,
    jwtAuth,
    async (req, res) => {
      const { streamId } = req.params
      const all = await prisma.motionRecording.findMany({
        where: { streamId, nickname: { not: null } },
        select: { filename: true, nickname: true },
      })
      res.json(all)
    },
  )

  // --- Serve thumbnails for a stream ---
  app.use(
    '/recordings/:streamId/thumbnails',
    streamThumbnailsLimiter,
    jwtAuth,
    (req, res, next) => {
      const { streamId } = req.params
      const stream = dynamicStreams[streamId]
      if (!stream) {
        res.status(404).send('Stream not found')
        return
      }
      // Only set cache-control for non-latest.jpg
      if (!req.url.endsWith('latest.jpg')) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
      }
      express.static(stream.config.thumbDir)(req, res, next)
    },
  )

  // --- Delete a recording file for a stream ---
  app.delete(
    '/api/recordings/:streamId/:filename',
    deleteRecordingsLimiter,
    jwtAuth,
    async (req, res) => {
      const { streamId, filename } = req.params
      if (!/^[\w\-.]+\.mp4$/.test(filename)) {
        res.status(400).json({ error: 'Invalid filename' })
        return
      }
      const stream = dynamicStreams[streamId]
      if (!stream) {
        res.status(404).json({ error: 'Stream not found' })
        return
      }
      const filePath = path.join(stream.config.recordDir, filename)
      const thumbPath = path.join(
        stream.config.thumbDir,
        filename.replace(/\.mp4$/, '.jpg'),
      )
      if (
        !filePath.startsWith(stream.config.recordDir) ||
        !thumbPath.startsWith(stream.config.thumbDir)
      ) {
        res.status(403).send('Forbidden')
        return
      }

      try {
        await Promise.all([
          fs.rm(filePath, { force: true, recursive: true }),
          fs.rm(thumbPath, { force: true, recursive: true }),
        ])
      } catch (_) {
        res.status(500).json({ error: 'Failed to delete file' })
      }

      try {
        await Promise.all([
          prisma.motionRecording.delete({
            where: { streamId_filename: { streamId, filename } },
          }),
          prisma.deletedRecording.create({
            data: { streamId, filename },
          }),
        ])
      } catch {
        res.status(500).json({
          error: 'Deleted file, but failed to delete recording from database',
        })
        return
      }

      res.json({ success: true })
    },
  )

  // --- Bulk delete for a stream ---
  app.post(
    '/api/recordings/:streamId/bulk-delete',
    deleteRecordingsLimiter,
    jwtAuth,
    express.json(),
    async (req, res) => {
      const { streamId } = req.params
      const { filenames } = req.body
      if (
        !Array.isArray(filenames) ||
        filenames.some((f) => !/^[\w\-.]+\.mp4$/.test(f))
      ) {
        res.status(400).json({ error: 'Invalid filenames' })
        return
      }
      const stream = dynamicStreams[streamId]
      if (!stream) {
        res.status(404).json({ error: 'Stream not found' })
        return
      }
      const results: { [filename: string]: boolean } = {}
      for (const filename of filenames) {
        const filePath = path.join(stream.config.recordDir, filename)
        const thumbPath = path.join(
          stream.config.thumbDir,
          filename.replace(/\.mp4$/, '.jpg'),
        )
        if (
          !filePath.startsWith(stream.config.recordDir) ||
          !thumbPath.startsWith(stream.config.thumbDir)
        ) {
          res.status(403).send('Forbidden')
          return
        }

        try {
          await Promise.all([
            fs.rm(filePath, { force: true, recursive: true }),
            fs.rm(thumbPath, { force: true, recursive: true }),
          ])
        } catch (_) {
          results[filename] = false
        }

        try {
          await Promise.all([
            prisma.motionRecording.delete({
              where: { streamId_filename: { streamId, filename } },
            }),
            prisma.deletedRecording.create({
              data: { streamId, filename },
            }),
          ])
          results[filename] = true
        } catch {
          results[filename] = false
        }
      }

      res.json({ success: true, results })
    },
  )

  // --- Deleted recordings endpoint ---
  app.get(
    '/api/deleted-recordings/:streamId',
    getDeletedRecordingsLimiter,
    jwtAuth,
    async (req, res) => {
      const { streamId } = req.params

      // Return all deleted recordings after sync
      const deleted = await prisma.deletedRecording.findMany({
        where: { streamId },
        orderBy: { deletedAt: 'desc' },
      })

      res.json(deleted.map((d) => d.filename))
    },
  )
}
