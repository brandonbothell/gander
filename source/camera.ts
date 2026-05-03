import '@dotenvx/dotenvx/config'
import path from 'path'
import http from 'http'
import fs from 'fs'
import webpush from 'web-push'
import { Server as SocketIOServer } from 'socket.io'
import jwt from 'jsonwebtoken'
import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import * as chokidar from 'chokidar'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import config from '../config.json'
import { StreamMotionState } from './types/stream'
import { TrustedDevice } from './types/deviceInfo'
import { StreamManager } from './streamManager'
import initializeStreamRoutes from './routes/streams'
import initializeSignedRoutes from './routes/signed'
import initializeRecordingRoutes from './routes/recordings'
import initializeNotificationRoutes, { notify } from './routes/notifications'
import initializeMotionRoutes, {
  checkDiskSpaceAndPurge,
  flushMotionSegmentsWithRetry,
  saveMotionSegmentsWithRetry,
} from './routes/motion'
import initializeMaskRoutes from './routes/masks'
import initializeAuthRoutes from './routes/auth'
import { detectMotion, cleanFrameCache, debugLog } from './motionDetector'
import { jwtAuth } from './middleware/jwtAuth'
import { logAuth, logMotion } from './logMotion'
import { PrismaClient } from './generated/prisma/client'
import { initializeCredentials, JWT_SECRET } from './credentials'
import { initializeConsole } from './console'
import open from 'open'
import { rateLimit } from 'express-rate-limit'

initializeConsole()
initializeCredentials()

const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL })
export const prisma = new PrismaClient({ adapter })

// Motion logging setup
const apiStartTime = new Date().toISOString().replace(/[:.]/g, '-')
export const motionLogPath = path.join(__dirname, '..', 'logs', 'motion')
export const authLogPath = path.join(__dirname, '..', 'logs', 'auth')

// Ensure logs directory exists
const logsDir = path.dirname(motionLogPath)
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true })
}

// --- Configuration ---
const app = express()

// --- Constants ---
const MOTION_RECORDING_TIMEOUT_SECONDS = {
  normal: 45,
  cameraMovement: 30, // shorter timeout for camera movement to avoid long recordings
}

/**
 * Number of recent video segments to buffer.
 *
 * This constant determines how many of the most recent video segments
 * should be kept in memory or storage for quick access or processing.
 * Adjust this value based on memory constraints and application requirements.
 */
const RECENT_SEGMENT_BUFFER = 6
const STARTUP_GRACE_PERIOD = 10 // seconds

const streamThumbnailPromises: Record<
  string,
  Promise<{ success: boolean }> | null
> = {}

// In-memory map of StreamManagers
const dynamicStreams: Record<string, StreamManager> = {}

export interface RequestWithUser extends express.Request {
  user?: { username: string }
}

const streamStates: Record<string, StreamMotionState> = {}

const watchers = new Map<string, chokidar.FSWatcher>()

export async function setupStreamMotionMonitoring(streamId?: string) {
  const setupMotionMonitoring = async (streamId: string) => {
    logMotion(
      `[${streamId}] Monitoring started at ${new Date().toLocaleString()}`,
    )

    if (!streamStates[streamId]) {
      const persistedStates = await loadPersistedStreamStates()
      streamStates[streamId] = {
        notificationSent: false,
        motionRecordingActive: false,
        motionRecordingTimeoutAt: 0,
        motionSegments: [],
        flushingSegments: [],
        recentSegments: [],
        flushedSegments: [],
        motionPaused: persistedStates[streamId]?.motionPaused ?? false,
        startupTime: Date.now(),
        savingInProgress: false,
        currentSaveProcess: null,
        saveRetryCount: 0,
        startedRecordingAt: 0,
        lastSegmentProcessAt: 0,
        recordingTitle: `motion_${new Date().toISOString().replace(/[:.]/g, '-')}.mp4`,
        flushRecordings: [],
        nextFlushNumber: 1,
        cleaningUp: false,
        cancelFlush: false,
        lowSpaceNotified: false,
        lastNotifiedRestartCooldownAt: 0,
        currentRecordingMotionTimestamps: [],
      }
    }

    // --- Motion Detection Watcher ---
    watchers.set(
      streamId,
      chokidar
        .watch(dynamicStreams[streamId].config.hlsDir, { ignoreInitial: true })
        .on('add', (segmentPath) => {
          if (!/segment_\d+\.ts$/.test(path.basename(segmentPath))) return
          const state = streamStates[streamId]

          // --- Throttle segment processing to avoid busy loop ---
          const now = Date.now()
          const MIN_SEGMENT_PROCESS_INTERVAL = 300 // ms
          if (
            state.lastSegmentProcessAt &&
            now - state.lastSegmentProcessAt < MIN_SEGMENT_PROCESS_INTERVAL
          ) {
            if (now - state.lastSegmentProcessAt > 0) {
              debugLog(
                `[${streamId}] Throttling segment processing: last at ${now - state.lastSegmentProcessAt}ms ago`,
              )
            }
            return
          }
          state.lastSegmentProcessAt = now

          state.recentSegments.push(segmentPath)
          if (state.recentSegments.length > RECENT_SEGMENT_BUFFER) {
            const expiredSegment = state.recentSegments.shift()
            if (
              expiredSegment &&
              ((state.motionRecordingActive && !state.savingInProgress) ||
                state.flushedSegments.includes(expiredSegment))
            ) {
              safeUnlinkWithRetry(expiredSegment)
            }
          }
          setTimeout(async () => {
            if (state.motionPaused) return
            const now = Date.now()
            if ((now - state.startupTime) / 1000 < STARTUP_GRACE_PERIOD) {
              return
            }
            const motionStatus = await detectMotion(
              streamStates,
              streamId,
              segmentPath,
            )
            if (motionStatus.motion) {
              // --- If motion is detected and we're not currently recording ---
              if (!state.motionRecordingActive) {
                // If we're currently saving, cancel the save and continue recording
                if (state.savingInProgress && state.currentSaveProcess) {
                  logMotion(
                    `[${streamId}] New motion detected while saving, canceling save operation`,
                  )
                  state.currentSaveProcess.kill('SIGTERM')
                  state.savingInProgress = false
                  state.currentSaveProcess = null
                  state.saveRetryCount = 0
                } else {
                  // Motion was detected and we're not currently recording/saving
                  // Start a new recording
                  state.nextFlushNumber = 1
                  state.recordingTitle = `motion_${new Date().toISOString().replace(/[:.]/g, '-')}.mp4`
                  state.startedRecordingAt = now
                  state.notificationSent = false
                }

                state.motionRecordingActive = true
                state.recentSegments.forEach((recentPath) => {
                  if (!state.motionSegments.includes(recentPath)) {
                    state.motionSegments.push(recentPath)
                  }
                })

                if (state.flushTimer) clearInterval(state.flushTimer)
                // Start periodic flush
                state.flushTimer = setInterval(() => {
                  flushMotionSegmentsWithRetry(
                    streamStates,
                    dynamicStreams,
                    streamId,
                  )
                }, 10000) // flush every 10 seconds
              } else {
                state.currentRecordingMotionTimestamps.push(
                  state.currentRecordingMotionTimestamps.length
                    ? state.lastSegmentProcessAt! - state.startedRecordingAt
                    : Math.max(0, now - state.startedRecordingAt - 1000),
                )
                logMotion(
                  `Updated motion timestamps in state: ${JSON.stringify(state.currentRecordingMotionTimestamps)}`,
                )
              }

              // --- If motion is detected, add the segment to motion segments ---
              if (!state.motionSegments.includes(segmentPath)) {
                state.motionSegments.push(segmentPath)
              }

              // Log motion event
              logMotion(
                `[${streamId}] Detected at ${new Date().toLocaleString()} in segment: ${path.basename(segmentPath)}`,
              )

              // --- Notify only once per motion event ---
              if (!state.notificationSent) {
                notify(dynamicStreams, streamId, {
                  channelId: 'motion_event_channel',
                  sound: 'motion_alert',
                  group: `motion_event_${streamId}`,
                })
                state.notificationSent = true
              }

              // --- Set motion recording timeout ---
              let motionRecordingTimeoutMs =
                MOTION_RECORDING_TIMEOUT_SECONDS[
                  motionStatus.aboveCameraMovementThreshold
                    ? 'cameraMovement'
                    : 'normal'
                ] * 1000

              if (
                state.motionRecordingTimeoutAt > 0 &&
                Date.now() + motionRecordingTimeoutMs <
                  state.motionRecordingTimeoutAt
              ) {
                // If the new timeout is shorter than the current one, keep the current timeout
                motionRecordingTimeoutMs =
                  state.motionRecordingTimeoutAt - Date.now()
              }

              if (state.motionTimeout) clearTimeout(state.motionTimeout)
              state.motionTimeout = setTimeout(() => {
                // --- Save motion segments and reset state (segment and save state is reset in saveMotionSegments) ---
                saveMotionSegmentsWithRetry(
                  streamStates,
                  dynamicStreams,
                  streamId,
                )
                state.motionRecordingActive = false
                state.motionRecordingTimeoutAt = 0
                if (state.flushTimer) {
                  clearInterval(state.flushTimer)
                  state.flushTimer = undefined
                }
                state.motionTimeout = undefined
              }, motionRecordingTimeoutMs)
              state.motionRecordingTimeoutAt =
                Date.now() + motionRecordingTimeoutMs
            } else if (state.motionRecordingActive) {
              if (!state.motionSegments.includes(segmentPath)) {
                state.motionSegments.push(segmentPath)
              }
            }
          }, 300)
        }),
    )

    console.log(
      `[${streamId}] Watcher set up for ${dynamicStreams[streamId].config.hlsDir}`,
    )
  }

  if (streamId) {
    await setupMotionMonitoring(streamId)
  } else {
    const promises = []
    for (const streamId in dynamicStreams) {
      promises.push(setupMotionMonitoring(streamId))
    }
    await Promise.all(promises)
  }

  setInterval(() => cleanFrameCache(dynamicStreams, streamStates), 5000)
}

export function stopStreamMotionMonitoring(streamId?: string) {
  const stopMotionMonitoring = (streamId: string) => {
    logMotion(
      `[${streamId}] Stopping motion monitoring at ${new Date().toLocaleString()}`,
    )
    if (watchers.has(streamId)) {
      watchers.get(streamId)?.close()
      watchers.delete(streamId)
    }
    if (streamStates[streamId]) {
      const state = streamStates[streamId]
      if (state.flushTimer) clearInterval(state.flushTimer)
      if (state.motionTimeout) clearTimeout(state.motionTimeout)
      persistStreamState(streamId).finally(() => {
        delete streamStates[streamId]
      })
    }
  }

  if (streamId && dynamicStreams[streamId]) {
    stopMotionMonitoring(streamId)
  } else {
    for (const streamId in dynamicStreams) {
      stopMotionMonitoring(streamId)
    }
  }
}

export function saveMotionSegments(streamId: string) {
  return saveMotionSegmentsWithRetry(streamStates, dynamicStreams, streamId)
}

// Load streams from DB on startup
async function loadStreamsFromDb() {
  return prisma.stream
    .findMany()
    .catch((err) => {
      console.error('[Initialize DB] Failed to load streams', err)
      throw err
    })
    .then(async (dbStreams) => {
      for (const s of dbStreams!) {
        if (!dynamicStreams[s.id]) {
          dynamicStreams[s.id] = await createStreamManager(s)
          try {
            dynamicStreams[s.id].startFFmpeg().catch((err) => {
              console.warn(
                `[${s.id}] FFmpeg failed to start:`,
                err?.message || err,
              )
            })
          } catch (err) {
            console.error(`[${s.id}] Error starting FFmpeg:`, err)
          }
        }
      }

      // --- Monitor for FFmpeg cooldowns and alert ---
      setInterval(() => {
        for (const streamId in dynamicStreams) {
          const stream = dynamicStreams[streamId]
          const state = streamStates[streamId]
          const now = Date.now()
          if (
            stream &&
            stream.getFFmpegCooldownUntil() &&
            now < stream.getFFmpegCooldownUntil() &&
            now - state.lastNotifiedRestartCooldownAt > 5 * 60 * 1000 // 5 minutes
          ) {
            state.lastNotifiedRestartCooldownAt = now
            logMotion(
              `[${streamId}] FFmpeg restart cooldown active until ${new Date(stream.getFFmpegCooldownUntil()).toLocaleTimeString()}`,
              'warn',
            )
            notify(dynamicStreams, streamId, {
              title: 'Stream Restart Cooldown',
              body: `Stream ${streamId} is in FFmpeg restart cooldown due to repeated failures.`,
              tag: `server_event_${streamId}`,
              group: `stream_event_${streamId}`,
            })
          }
        }
      }, 60000) // Check every minute

      // Periodic disk-space check: run every 60 seconds
      const diskSpaceCheck = () => {
        for (const sId in dynamicStreams) {
          if (!dynamicStreams[sId]) continue
          checkDiskSpaceAndPurge(streamStates, dynamicStreams, sId).catch(
            (err) => {
              console.error(`[DiskCheck] Error checking disk for ${sId}:`, err)
            },
          )
        }
      }
      diskSpaceCheck() // Initial check on startup
      setInterval(() => {
        diskSpaceCheck()
      }, 60 * 1000)

      // Periodically remove old HLS segments (runs independent of motion monitoring)
      const SEGMENT_RETENTION_SECONDS = 300 // 5 minutes
      async function cleanupOldStreamSegments() {
        const retentionMs = SEGMENT_RETENTION_SECONDS * 1000
        const now = Date.now()

        for (const streamId of Object.keys(dynamicStreams)) {
          const stream = dynamicStreams[streamId]
          if (!stream) continue
          const dir = stream.config.hlsDir
          let files: string[] = []
          try {
            files = await fs.promises.readdir(dir)
          } catch {
            continue
          }

          const segmentFiles = files.filter((f) => /^segment_\d+\.ts$/.test(f))
          for (const fname of segmentFiles) {
            const fullPath = path.join(dir, fname)

            try {
              const stat = await fs.promises.stat(fullPath)
              const age = now - stat.mtimeMs

              // Skip files that are still recent enough
              if (age <= retentionMs) continue

              // Avoid deleting files that are currently referenced by motion state
              const state = streamStates[streamId]
              const isReferenced =
                state &&
                ((state.recentSegments || []).includes(fullPath) ||
                  (state.motionSegments || []).includes(fullPath) ||
                  (state.flushingSegments || []).includes(fullPath))
              if (isReferenced) continue

              // Delete the segment and its associated motion thumbnail if present
              await safeUnlinkWithRetry(fullPath)

              const motionJpg = fullPath.replace(/\.ts$/, '_motion.jpg')
              try {
                await fs.promises.access(motionJpg)
                const mjStat = await fs.promises.stat(motionJpg)
                if (now - mjStat.mtimeMs > retentionMs) {
                  await safeUnlinkWithRetry(motionJpg)
                }
              } catch {
                // not present — ignore
              }
            } catch {
              // ignore individual file errors and continue
            }
          }
        }
      }

      // Run immediately and then every minute
      cleanupOldStreamSegments().catch(() => {
        /* ignore */
      })
      setInterval(
        () =>
          cleanupOldStreamSegments().catch(() => {
            /* ignore */
          }),
        60 * 1000,
      )

      setInterval(() => cleanFrameCache(dynamicStreams, streamStates), 5000)
    })
}

const httpServer = http.createServer(app)
export const io = new SocketIOServer(httpServer, {
  cors: { origin: '*' },
})

loadStreamsFromDb()
  .then(cleanupExpiredTokensAndDevices)
  .then(() => setupStreamMotionMonitoring())
  .then(() => {
    // --- Start server ---
    setInterval(syncDeletedRecordings, 1000 * 60 * 60) // Sync deleted recordings every hour

    // Use HTTP with an nginx reverse proxy in production or plain HTTP for development
    const port = process.env.PORT ?? 3000

    io.use((socket, next) => {
      const { token } = socket.handshake.auth

      try {
        const payload = jwt.verify(token, JWT_SECRET) as {
          username: string
        }
        socket.data.username = payload.username
        return next()
      } catch {
        console.warn(
          `[Socket] User attempted connecting with invalid token: '${token}'`,
        )
        return next(new Error('Invalid or expired token'))
      }
    })

    io.on('connection', (socket) => {
      const clientId = socket.handshake.auth.clientId
      if (clientId) {
        socket.join(clientId)
      }
    })

    httpServer.listen(port, () => {
      console.debug(`HTTP server running on http://localhost:${port}`)
      if (process.env.API_ENV === 'production') return
      setTimeout(() => {
        open(`http://localhost:${port}`)
      }, 1500)
    })
  })

/**
 * Periodically clean up expired JWTs, refresh tokens, and old trusted devices.
 * - Runs every hour.
 * - Removes expired JWTs and refresh tokens from users.
 * - Removes trusted devices not seen in 7+ days.
 */
async function cleanupExpiredTokensAndDevices() {
  const now = Date.now()
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

  const users = await prisma.user.findMany()
  for (const user of users) {
    let changed = false

    // --- JWTs ---
    let jwts: string[] = []
    try {
      jwts = JSON.parse(user.jwts ?? '[]')
    } catch {
      jwts = []
    }
    const validJwts = jwts.filter((token) => {
      try {
        const decoded = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload
        return decoded && decoded.exp && decoded.exp * 1000 > now
      } catch {
        return false
      }
    })
    if (validJwts.length !== jwts.length) changed = true

    // --- Refresh Tokens ---
    let refreshTokens: string[] = []
    try {
      refreshTokens = JSON.parse(user.refreshTokens ?? '[]')
    } catch {
      refreshTokens = []
    }
    const validRefreshTokens = refreshTokens.filter((token) => {
      try {
        const decoded = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload
        return decoded && decoded.exp && decoded.exp * 1000 > now
      } catch {
        return false
      }
    })
    if (validRefreshTokens.length !== refreshTokens.length) changed = true

    // --- Trusted Devices ---
    let trustedDevices: TrustedDevice[] = []
    try {
      trustedDevices = JSON.parse(user.trustedIps ?? '[]')
    } catch {
      trustedDevices = []
    }
    const filteredDevices = trustedDevices.filter((device) => {
      const lastSeen = new Date(device.lastSeen).getTime()
      return !isNaN(lastSeen) && now - lastSeen < SEVEN_DAYS_MS
    })
    if (filteredDevices.length !== trustedDevices.length) changed = true

    if (changed) {
      await prisma.user
        .update({
          where: { username: user.username },
          data: {
            jwts: JSON.stringify(validJwts),
            refreshTokens: JSON.stringify(validRefreshTokens),
            trustedIps: JSON.stringify(filteredDevices),
          },
        })
        .catch(() => {
          logAuth(
            `[Cleanup] Failed to update valid JWTs of '${user.username}'.`,
            'warn',
          )
        })

      console.log(
        `[Cleanup] Updated user ${user.username} - removed ${
          jwts.length -
          validJwts.length +
          (refreshTokens.length - validRefreshTokens.length)
        } expired tokens and ${trustedDevices.length - filteredDevices.length} old devices.`,
      )
    }
  }

  // Run every hour
  setTimeout(cleanupExpiredTokensAndDevices, 60 * 60 * 1000)
}

app.use(cookieParser(JWT_SECRET))

// --- CORS ---
app.use(
  cors({
    origin: (origin, callback) => {
      const allowedOrigins = (
        process.env.API_ENV === 'production' ? [] : ['http://localhost:3000']
      ).concat(config.domains ?? [])
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true)
      } else {
        console.error(`[CORS] Denied request from origin: ${origin}`)
        callback(new Error(`[CORS] Denied request from origin: ${origin}`))
      }
    },
    credentials: true,
  }),
)

app.use(express.json())

app.set('trust proxy', () => true)

const hlsStreamLimiter = rateLimit({
  validate: { ip: false },
  windowMs: 10 * 1000, // 10 seconds
  max: 4,
  standardHeaders: true,
  legacyHeaders: false,
})

app.get('/hls/:streamId/stream.m3u8', hlsStreamLimiter, jwtAuth, (req, res) => {
  const { streamId } = req.params
  const stream = dynamicStreams[streamId]
  if (!stream) {
    res.status(404).send('Stream not found')
    return
  }
  fs.readFile(stream.getPlaylistPath(), 'utf8', (err, data) => {
    if (err) {
      res.status(404).send('Not found')
      return
    }
    res.type('application/vnd.apple.mpegurl').send(data)
  })
})

const hlsSegmentLimiter = rateLimit({
  validate: { ip: false },
  windowMs: 1000, // 1 second
  max: 2,
  standardHeaders: true,
  legacyHeaders: false,
})

app.get(
  '/hls/:streamId/:segment',
  hlsSegmentLimiter,
  jwtAuth,
  async (req, res) => {
    const { streamId, segment } = req.params
    const stream = dynamicStreams[streamId]
    if (!stream || !/^segment_\d+\.ts$/.test(segment)) {
      res.status(404).send('Not found')
      return
    }

    try {
      const segmentPath = stream.getSegmentPath(segment)
      fs.createReadStream(segmentPath)
        .on('error', () => {
          res.type('text/html').status(404).send('Segment not found')
        })
        .pipe(res.type('video/MP2T'))
    } catch {
      res.type('text/html').status(404).send('Segment not found')
      return
    }
  },
)

process.on('SIGINT', () => cleanExit())
process.on('SIGTERM', () => cleanExit())
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err)
  process.exit(1)
})
process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err)
  process.exit(1)
})

const thumbnailLimiter = rateLimit({
  validate: { ip: false },
  windowMs: 30 * 1000, // 30 seconds
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
})

// --- Static & API Routes ---
app.use(express.static(path.join(__dirname, '..', 'web', 'dist')))
app.use(
  '/recordings/thumbnails',
  thumbnailLimiter,
  jwtAuth,
  express.static(path.join(config.recordingsDirectory, 'thumbnails')),
)
app.get(/^\/(?!hls|api|recordings|signed|sounds).*/, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'web', 'dist', 'index.html'))
})

app.get(/^\/recordings(\/[^/]+)(\/[^/]+)?$/, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'web', 'dist', 'index.html'))
})

app.get('/api/vapid-public-key', (req, res) => {
  res.json({ publicKey: config.vapid.publicKey })
})

webpush.setVapidDetails(
  config.vapid.email,
  config.vapid.publicKey,
  config.vapid.privateKey,
)

// Route initialization
initializeMotionRoutes(app, streamStates, dynamicStreams)
initializeAuthRoutes(app, dynamicStreams)
initializeNotificationRoutes(app)
initializeRecordingRoutes(app, dynamicStreams)
initializeMaskRoutes(app)
initializeStreamRoutes(app, dynamicStreams)
initializeSignedRoutes(
  app,
  dynamicStreams,
  streamStates,
  streamThumbnailPromises,
)

// --- Safe unlink function ---
export async function safeUnlinkWithRetry(filePath: string, retries = 3) {
  const RETRY_DELAY_MS = 1000
  if (retries <= 0) {
    logMotion(
      `[safeUnlinkWithRetry] Giving up deleting ${filePath} after retries`,
      'warn',
    )
    return
  }
  return fs.promises
    .rm(filePath, { force: true, recursive: true })
    .catch((error) => {
      if (error) {
        if (error.code === 'ENOENT' || error.code === 'EPERM') {
          // File was already deleted by another process, which is fine
          return
        }

        if (error.code === 'EBUSY') {
          setTimeout(
            () => safeUnlinkWithRetry(filePath, retries - 1),
            RETRY_DELAY_MS,
          )
          logMotion(
            `[safeUnlinkWithRetry] Failed to delete file ${filePath} (EBUSY), will retry (${retries - 1} left)`,
            'warn',
          )
          return
        }
      }
    })
}

// Helper: Create StreamManager instance for a stream
export async function createStreamManager(stream: {
  id: string
  ffmpegInput: string
  rtspUser: string | null
  rtspPass: string | null
}) {
  // Use unique folders for each stream
  const hlsDir = path.join(__dirname, '..', `hls_${stream.id}`)
  const recordDir = path.join(config.recordingsDirectory, stream.id)
  const flushDir = path.join(recordDir, 'flush')
  const thumbDir = path.join(recordDir, 'thumbnails')
  const persistedStates = await loadPersistedStreamStates()

  streamStates[stream.id] = {
    notificationSent: false,
    motionRecordingActive: false,
    motionRecordingTimeoutAt: 0,
    motionSegments: [],
    flushingSegments: [],
    recentSegments: [],
    flushedSegments: [],
    motionPaused: persistedStates[stream.id]?.motionPaused ?? false,
    startupTime: Date.now(),
    savingInProgress: false,
    currentSaveProcess: null,
    saveRetryCount: 0,
    startedRecordingAt: 0,
    lastSegmentProcessAt: 0,
    recordingTitle: `motion_${new Date().toISOString().replace(/[:.]/g, '-')}.mp4`,
    flushRecordings: [],
    nextFlushNumber: 1,
    cleaningUp: false,
    cancelFlush: false,
    lowSpaceNotified: false,
    lastNotifiedRestartCooldownAt: 0,
    currentRecordingMotionTimestamps: [],
  }

  return new StreamManager(
    {
      id: stream.id,
      hlsDir,
      recordDir,
      thumbDir,
      flushDir,
      ffmpegInput: stream.ffmpegInput,
      rtspUser: stream.rtspUser ?? undefined,
      rtspPass: stream.rtspPass ?? undefined,
    },
    streamStates[stream.id],
  )
}

async function loadPersistedStreamStates() {
  const all = await prisma.streamState.findMany()
  const persisted: Record<string, StreamMotionState> = {}
  for (const row of all) {
    try {
      persisted[row.streamId] = JSON.parse(row.state)
    } catch {
      console.error(
        `[loadPersistedStreamStates] Failed to parse persisted state for stream ${row.streamId}`,
      )
    }
  }
  return persisted
}

// --- Persist stream state to database ---
export async function persistStreamState(streamId: string) {
  const state = streamStates[streamId]
  if (!state) return
  // Only persist what you need (here, just motionPaused, but you can add more)
  const toPersist = { motionPaused: state.motionPaused }
  await prisma.streamState.upsert({
    where: { streamId },
    update: { state: JSON.stringify(toPersist), updatedAt: new Date() },
    create: { streamId, state: JSON.stringify(toPersist) },
  })
}

async function syncDeletedRecordings() {
  for (const streamId in dynamicStreams) {
    if (!dynamicStreams[streamId]) continue // Skip if stream is not active
    try {
      const stream = dynamicStreams[streamId]
      if (stream) {
        // Get all recordings from DB that aren't already marked as deleted
        const allDbRecordings = await prisma.motionRecording.findMany({
          where: { streamId },
          select: { filename: true },
        })

        const existingDeleted = await prisma.deletedRecording.findMany({
          where: { streamId },
          select: { filename: true },
        })

        const deletedSet = new Set(existingDeleted.map((d) => d.filename))
        const missingRecordings: string[] = []

        // Check which files are missing from the filesystem
        for (const recording of allDbRecordings) {
          if (!deletedSet.has(recording.filename)) {
            const filePath = path.join(
              stream.config.recordDir,
              recording.filename,
            )
            try {
              await fs.promises.access(filePath)
            } catch {
              missingRecordings.push(recording.filename)
            }
          }
        }

        // Add missing recordings to deleted table
        if (missingRecordings.length > 0) {
          console.log(
            `[${streamId}] Syncing ${missingRecordings.length} deleted recordings to database`,
          )

          await prisma.deletedRecording.createMany({
            data: missingRecordings.map((filename) => ({ streamId, filename })),
          })

          // Also remove them from the motion recordings table
          await prisma.motionRecording.deleteMany({
            where: {
              streamId,
              filename: { in: missingRecordings },
            },
          })
        }
      }
    } catch (error) {
      console.error(`[${streamId}] Error syncing deleted recordings:`, error)
      // Continue with the request even if sync fails
    }
  }
}

// --- Clean Exit Handler ---
async function cleanExit() {
  console.log('\nExiting... Cleaning up.')

  // Rename log files
  console.log('Renaming log files...')
  try {
    fs.renameSync(
      `${motionLogPath}-latest.log`,
      `${motionLogPath}-${apiStartTime}.log`,
    )
    fs.renameSync(
      `${authLogPath}-latest.log`,
      `${authLogPath}-${apiStartTime}.log`,
    )
  } catch (error) {
    console.error('Failed to rename log files:', error)
  }

  // First, save any pending motion segments before cleaning up directories
  for (const streamId of Object.keys(dynamicStreams)) {
    const state = streamStates[streamId]
    if (state?.motionTimeout) clearTimeout(state.motionTimeout)

    // Cancel any ongoing save operations
    if (state?.savingInProgress && state.currentSaveProcess) {
      console.log(`[${streamId}] [cleanExit] Canceling ongoing save operation`)
      state.currentSaveProcess.kill('SIGTERM')
    }

    // Save any pending segments BEFORE stopping FFmpeg and cleaning directories
    if (state?.motionSegments.length > 0 || state.flushRecordings.length > 0) {
      logMotion(
        `[${streamId}] [cleanExit] Saving ${state.motionSegments.length || state.flushRecordings.length} pending segments`,
      )
      try {
        await saveMotionSegmentsWithRetry(
          streamStates,
          dynamicStreams,
          streamId,
        )
      } catch (error) {
        console.error(
          `[${streamId}] [cleanExit] Failed to save pending segments:`,
          error,
        )
      }
    }
  }

  // Then stop FFmpeg processes and clean up directories
  for (const streamId of Object.keys(dynamicStreams)) {
    dynamicStreams[streamId].destroy()
    console.log(`[Cleanup] Stopped FFmpeg for stream ${streamId}`)
    await new Promise((res) => setTimeout(res, 1000))

    try {
      if (fs.existsSync(dynamicStreams[streamId].config.hlsDir)) {
        fs.rmSync(dynamicStreams[streamId].config.hlsDir, {
          recursive: true,
          force: true,
        })
        console.log(
          '[Cleanup] Deleted HLS directory:',
          dynamicStreams[streamId].config.hlsDir,
        )
      }
    } catch (e) {
      console.warn('[Cleanup] Failed to delete HLS directory:', e)
    }
  }

  process.exit(0)
}
