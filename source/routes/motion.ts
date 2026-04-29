import {
  persistStreamState,
  prisma,
  safeUnlinkWithRetry,
  StreamMotionState,
  saveMotionSegments as saveMotionSegmentsCamera,
} from '../camera'
import { logMotion } from '../logMotion'
import { jwtAuth } from '../middleware/jwtAuth'
import express, { Express } from 'express'
import rateLimit from 'express-rate-limit'
import { clearMotionHistory } from '../motionDetector'
import { StreamManager } from '../streamManager'
import * as fs from 'fs'
import path from 'path'
import { recordingsLowSpaceThresholdMb } from '../../config.json'
import { exec } from 'child_process'
import { notify } from './notifications'

export default function initializeMotionRoutes(
  app: Express,
  streamStates: Record<string, StreamMotionState>,
  dynamicStreams: Record<string, StreamManager>,
) {
  const setMotionPauseLimiter = rateLimit({
    validate: { ip: false },
    windowMs: 60 * 1000, // 1 minute
    max: 40, // limit each IP to 20 pause/resume requests per minute
    standardHeaders: true,
    legacyHeaders: false,
  })

  const getMotionPauseLimiter = rateLimit({
    validate: { ip: false },
    windowMs: 60 * 1000, // 1 minute
    max: 50, // limit each IP to 20 pause/resume requests per minute
    standardHeaders: true,
    legacyHeaders: false,
  })

  const motionStatusLimiter = rateLimit({
    validate: { ip: false },
    windowMs: 5000, // 5 seconds
    max: 16, // limit each IP to 8 status requests in 5 seconds
    standardHeaders: true,
    legacyHeaders: false,
  })

  // --- Motion status ---
  app.get('/api/motion-status', motionStatusLimiter, jwtAuth, (req, res) => {
    const states: {
      [streamId: string]: {
        recording: boolean
        secondsLeft: number
        saving: boolean
        startedRecordingAt: number
        lowDiskSpace: boolean
      }
    } = {}
    for (const streamId in streamStates) {
      const state = streamStates[streamId]
      if (!state) {
        states[streamId] = {
          recording: false,
          secondsLeft: 0,
          saving: false,
          startedRecordingAt: 0,
          lowDiskSpace: false,
        }
        continue
      }
      let secondsLeft = 0
      if (state.motionRecordingActive && state.motionRecordingTimeoutAt) {
        secondsLeft = Math.max(
          0,
          Math.ceil((state.motionRecordingTimeoutAt - Date.now()) / 1000),
        )
      }
      states[streamId] = {
        recording: state.motionRecordingActive,
        secondsLeft,
        saving: state.savingInProgress ?? false,
        startedRecordingAt: state.startedRecordingAt,
        lowDiskSpace: state.lowSpaceNotified,
      }
    }
    res.json(states)
  })

  // --- Get or set motion pause state ---
  app.get('/api/motion-pause', getMotionPauseLimiter, jwtAuth, (_, res) => {
    res.json(
      Object.fromEntries(
        Object.entries(streamStates).map(([streamId, state]) => [
          streamId,
          state.motionPaused,
        ]),
      ),
    )
  })

  app.post(
    '/api/motion-pause/:streamId',
    setMotionPauseLimiter,
    jwtAuth,
    express.json(),
    async (req, res) => {
      const { streamId } = req.params
      if (
        streamId === '__proto__' ||
        streamId === 'constructor' ||
        streamId === 'prototype'
      ) {
        res.status(400).json({ paused: false })
        return
      }

      const state = streamStates[streamId]
      if (!state) {
        res.status(404).json({ paused: false })
        return
      }

      state.motionPaused = !!req.body.paused
      clearMotionHistory(streamId) // <-- clear motion/movement history
      await persistStreamState(streamId) // <-- persist to DB

      const { nickname } = (await prisma.stream.findUnique({
        where: { id: streamId },
        select: { nickname: true },
      })) || { nickname: dynamicStreams[streamId].config.ffmpegInput }

      if (state.motionPaused) {
        if (state.motionRecordingActive) {
          if (state.motionTimeout) {
            clearTimeout(state.motionTimeout)
            state.motionTimeout = undefined
          }
          if (state.flushTimer) {
            clearInterval(state.flushTimer)
            state.flushTimer = undefined
          }

          if (state.flushingSegments.length > 0) {
            // Wait for flush to complete before pausing
            state.cancelFlush = true
            const waitForFlush = new Promise<void>((resolveFlush) => {
              const checkFlush = setInterval(() => {
                if (
                  state.flushingSegments.length === 0 &&
                  !state.savingInProgress
                ) {
                  clearInterval(checkFlush)
                  resolveFlush()
                }
              }, 1000)
            })
            await waitForFlush
          }

          if (!state.savingInProgress && !state.currentSaveProcess) {
            // Save any pending segments before pausing
            if (
              state.motionSegments.length > 0 ||
              state.flushRecordings.length > 0
            ) {
              saveMotionSegmentsCamera(streamId)
            }
          }

          // Pause motion recording
          state.motionRecordingActive = false
          state.motionRecordingTimeoutAt = 0
        }

        await notify(dynamicStreams, streamId, {
          title: 'Motion Recording Paused',
          body: `Motion recording has been paused for ${nickname}.`,
          channelId: 'motion_event_low_channel',
          tag: `motion_pause_${streamId}`,
          group: `motion_pause_${streamId}`,
        })
      } else {
        await notify(dynamicStreams, streamId, {
          title: 'Motion Recording Resumed',
          body: `Motion recording has been resumed for ${nickname}.`,
          channelId: 'motion_event_low_channel',
          tag: `motion_pause_${streamId}`,
          group: `motion_resume_${streamId}`,
        })
      }

      res.json({ paused: state.motionPaused })
    },
  )
}

// Enhanced save function with retry logic
export async function saveMotionSegmentsWithRetry(
  streamStates: Record<string, StreamMotionState>,
  dynamicStreams: Record<string, StreamManager>,
  streamId: string,
  retryAttempt: number = 0,
): Promise<void> {
  const state = streamStates[streamId]
  const maxRetries = 2

  try {
    await saveMotionSegments(streamStates, dynamicStreams, streamId)
    state.saveRetryCount = 0 // Reset retry count on success
  } catch (error) {
    logMotion(
      `[${streamId}] Motion save attempt ${retryAttempt + 1} failed: ${error}`,
    )

    if (retryAttempt < maxRetries) {
      const delay = Math.min(1000 * Math.pow(2, retryAttempt), 5000) // Exponential backoff, max 5 seconds
      logMotion(
        `[${streamId}] Retrying save in ${delay}ms (attempt ${retryAttempt + 2}/${maxRetries + 1})`,
      )

      setTimeout(() => {
        saveMotionSegmentsWithRetry(
          streamStates,
          dynamicStreams,
          streamId,
          retryAttempt + 1,
        )
      }, delay)
    } else {
      logMotion(
        `[${streamId}] Failed to save motion segments after ${maxRetries + 1} attempts, giving up`,
      )
      // Reset state even on failure
      state.savingInProgress = false
      state.currentSaveProcess = null
      state.saveRetryCount = 0
      state.motionSegments = []
    }
  }
}

// --- Flush motion segments periodically ---
export async function flushMotionSegmentsWithRetry(
  streamStates: Record<string, StreamMotionState>,
  dynamicStreams: Record<string, StreamManager>,
  streamId: string,
  retryAttempt: number = 0,
): Promise<void> {
  const state = streamStates[streamId]
  const maxRetries = 2

  try {
    await flushMotionSegments(streamStates, dynamicStreams, streamId)
    state.saveRetryCount = 0
  } catch (error) {
    logMotion(
      `[${streamId}] Motion flush attempt ${retryAttempt + 1} failed: ${error}`,
    )

    if (retryAttempt < maxRetries) {
      const delay = Math.min(1000 * Math.pow(2, retryAttempt), 5000)
      logMotion(
        `[${streamId}] Retrying flush in ${delay}ms (attempt ${retryAttempt + 2}/${maxRetries + 1})`,
      )
      setTimeout(() => {
        flushMotionSegmentsWithRetry(
          streamStates,
          dynamicStreams,
          streamId,
          retryAttempt + 1,
        )
      }, delay)
    } else {
      logMotion(
        `[${streamId}] Failed to flush motion segments after ${maxRetries + 1} attempts, giving up`,
      )
      state.saveRetryCount = 0
      state.motionSegments = []
    }
  }
}

// Helper: get free bytes on disk (POSIX df or Windows wmic)
async function getFreeBytesForPath(dir: string): Promise<number> {
  return new Promise((resolve) => {
    const platform = process.platform
    if (platform === 'win32') {
      try {
        const root = path.parse(path.resolve(dir)).root.replace(/\\/g, '') // e.g. C:
        exec(
          `wmic logicaldisk where "DeviceID='${root}'" get FreeSpace /value`,
          { windowsHide: true },
          (err, stdout) => {
            if (err || !stdout) return resolve(0)
            const m = stdout.match(/FreeSpace=(\d+)/)
            if (!m) return resolve(0)
            resolve(Number(m[1]))
          },
        )
      } catch {
        resolve(0)
      }
    } else {
      // posix df -k -> kilobytes
      exec(`df -k "${dir}"`, (err, stdout) => {
        if (err || !stdout) return resolve(0)
        const lines = stdout.trim().split('\n')
        if (lines.length < 2) return resolve(0)
        const cols = lines[1].split(/\s+/)
        // df output: Filesystem 1K-blocks Used Available Use% Mounted on
        const availKb = Number(cols[3] ?? 0)
        resolve(availKb * 1024)
      })
    }
  })
}

function thresholdBytes(): number {
  const mb = Number(recordingsLowSpaceThresholdMb ?? 1024)
  return Math.max(0, mb) * 1024 * 1024
}

// Exported helper to be called periodically or before saves.
// Returns true when low space was detected (and segments were purged).
export async function checkDiskSpaceAndPurge(
  streamStates: Record<string, StreamMotionState>,
  dynamicStreams: Record<string, StreamManager>,
  streamId: string,
): Promise<boolean> {
  const state = streamStates[streamId]
  const stream = dynamicStreams[streamId]
  if (!state || !stream) return false

  const free = await getFreeBytesForPath(stream.config.recordDir)
  if (free <= 0) return false // couldn't determine; don't act

  if (free < thresholdBytes()) {
    // notify once per stream
    if (!state.lowSpaceNotified) {
      state.lowSpaceNotified = true
      logMotion(
        `[${streamId}] Low disk space detected (${Math.round(free / (1024 * 1024))}MB) - purging motion segments and pausing saving`,
        'warn',
      )
      await notify(dynamicStreams, streamId, {
        title: 'Low Disk Space - Motion Saving Paused',
        body: `Host low on disk space (${Math.round(free / (1024 * 1024))}MB). Motion segments will be deleted instead of saved.`,
        channelId: 'motion_event_low_channel',
        tag: `low_space_${streamId}`,
        group: `low_space_${streamId}`,
      })
    }

    // Immediately delete pending segments / flushed files to avoid consuming space.
    try {
      const toDelete: string[] = [
        ...state.motionSegments,
        ...state.flushedSegments,
        ...state.flushRecordings,
      ].filter(Boolean)
      // clear arrays first so other logic doesn't try to use them
      state.motionSegments = []
      state.flushedSegments = []
      state.flushRecordings = []
      state.savingInProgress = false
      if (state.currentSaveProcess) {
        try {
          state.currentSaveProcess.kill('SIGTERM')
        } catch {
          // ignore failure to kill save process
        }
        state.currentSaveProcess = null
      }
      for (const p of toDelete) {
        if (typeof p === 'string') await safeUnlinkWithRetry(p)
      }
    } catch (e) {
      logMotion(`[${streamId}] Error purging files on low disk: ${e}`, 'error')
    }
    return true
  } else {
    // if space recovered, reset notification flag to allow future alerts
    if (state.lowSpaceNotified) state.lowSpaceNotified = false
    return false
  }
}

// Insert check before flushMotionSegments starts (early return on low space)
async function flushMotionSegments(
  streamStates: Record<string, StreamMotionState>,
  dynamicStreams: Record<string, StreamManager>,
  streamId: string,
): Promise<void> {
  const state = streamStates[streamId]
  const stream = dynamicStreams[streamId]

  // Check disk space and purge if low - do not attempt to flush when low
  const low = await checkDiskSpaceAndPurge(
    streamStates,
    dynamicStreams,
    streamId,
  )
  if (low) {
    logMotion(`[${streamId}] Skipping flush due to low disk space`)
    return
  }

  if (state.cancelFlush) {
    logMotion(`[${streamId}] Flush operation was canceled`)
    state.cancelFlush = false
    state.flushingSegments = []
    return
  }

  if (state.savingInProgress) {
    state.flushingSegments = ['dummy'] // Prevent further saves while flushing
    setTimeout(() => {
      flushMotionSegments(streamStates, dynamicStreams, streamId)
    }, 1000)
    return
  }

  if (state.motionSegments.length === 0) return

  state.flushingSegments = [...new Set(state.motionSegments)]
  state.motionSegments = []

  const flushNumber = state.nextFlushNumber++
  const existingSegmentsPromises = state.flushingSegments.map(
    async (segmentPath) => {
      return {
        segmentPath,
        exists: await fs.promises
          .access(segmentPath)
          .then(() => true)
          .catch(() => false),
      }
    },
  )
  const existingSegments = (await Promise.all(existingSegmentsPromises))
    .filter((seg) => seg.exists)
    .sort((a, b) =>
      path.basename(a.segmentPath).localeCompare(path.basename(b.segmentPath)),
    )

  if (existingSegments.length === 0) {
    logMotion(`[${streamId}] No existing segments to flush`)
    return
  }

  const listFile = path.join(
    stream.config.flushDir,
    `concat_list_flush_${flushNumber}.txt`,
  )
  const flushOutFile = path.join(
    stream.config.flushDir,
    `${state.recordingTitle}_flush_${flushNumber}.ts`,
  )

  await fs.promises.writeFile(
    listFile,
    existingSegments
      .map((seg) => `file '${seg.segmentPath.replace(/\\/g, '/')}'`)
      .join('\n'),
  )

  const ffmpegConcatCmd = `ffmpeg -y -f concat -safe 0 -i "${listFile}" -c copy "${flushOutFile}"`

  if (state.cancelFlush) {
    logMotion(`[${streamId}] Flush operation was canceled`)
    state.cancelFlush = false
    state.motionSegments = state.flushingSegments // Restore segments
    state.flushingSegments = []
    return
  }

  logMotion(
    `[${streamId}] Flushing ${existingSegments.length} segments to ${path.basename(flushOutFile)}`,
  )

  await new Promise<void>((resolve, reject) => {
    exec(ffmpegConcatCmd, async (err) => {
      await safeUnlinkWithRetry(listFile)
      if (err) {
        logMotion(`[${streamId}] FFmpeg flush failed: ${err}`, 'error')
        state.motionSegments = state.flushingSegments // Restore segments on error
        state.flushingSegments = []
        state.cancelFlush = false
        reject(err)
        return
      }
      // Remove flushed segments except recent ones
      const promises = state.flushingSegments.map((segment) => {
        state.flushedSegments.push(segment)
        if (
          !state.recentSegments.includes(segment) &&
          !state.motionSegments.includes(segment)
        ) {
          return safeUnlinkWithRetry(segment)
        }
      })
      await Promise.all(promises)
      state.flushingSegments = []
      state.cancelFlush = false
      state.flushRecordings.push(flushOutFile)
      resolve()
    })
  })
}

// --- Modified saveMotionSegments ---
async function saveMotionSegments(
  streamStates: Record<string, StreamMotionState>,
  dynamicStreams: Record<string, StreamManager>,
  streamId: string,
): Promise<void> {
  const state = streamStates[streamId]
  const stream = dynamicStreams[streamId]

  // If low disk space, purge and skip save
  const low = await checkDiskSpaceAndPurge(
    streamStates,
    dynamicStreams,
    streamId,
  )
  if (low) {
    logMotion(`[${streamId}] Skipping save due to low disk space`)
    // ensure state cleaned
    state.savingInProgress = false
    state.currentSaveProcess = null
    state.motionSegments = []
    state.flushedSegments = []
    state.flushRecordings = []
    return
  }

  if (state.savingInProgress) {
    logMotion(
      `[${streamId}] Save operation already in progress, rescheduling`,
      'warn',
    )
    setTimeout(
      () => saveMotionSegments(streamStates, dynamicStreams, streamId),
      1000,
    )
    return
  }

  if (state.flushingSegments.length > 0) {
    console.warn(
      `[${streamId}] Flush and save operations called simultaneously, cancelling flush and rescheduling save`,
    )
    state.cancelFlush = true
    setTimeout(
      () => saveMotionSegments(streamStates, dynamicStreams, streamId),
      1000,
    )
    return
  }

  state.savingInProgress = true

  // Gather flushed recordings
  const flushedFiles = [...new Set(state.flushRecordings)]
  const existingFlushedPromises = flushedFiles
    .sort((a, b) => {
      const getNum = (fname: string) =>
        parseInt(fname.match(/_flush_(\d+)\.ts$/)?.[1] || '0', 10)
      return getNum(a) - getNum(b)
    })
    .map(async (filePath) => {
      return {
        filePath,
        exists: await fs.promises
          .access(filePath)
          .then(() => true)
          .catch(() => false),
      }
    })
  const existingFlushedFiles = (await Promise.all(existingFlushedPromises))
    .filter((f) => f.exists)
    .map((f) => f.filePath)

  // Gather unflushed segments
  const uniqueSegments = [...new Set(state.motionSegments)]
  const existingSegmentsPromises = uniqueSegments.map(async (segmentPath) => {
    return {
      segmentPath,
      exists: await fs.promises
        .access(segmentPath)
        .then(() => true)
        .catch(() => false),
    }
  })
  const existingSegments = (await Promise.all(existingSegmentsPromises))
    .filter((seg) => seg.exists)
    .sort((a, b) =>
      path.basename(a.segmentPath).localeCompare(path.basename(b.segmentPath)),
    )
    .map((seg) => seg.segmentPath)

  // Build concat list: flushed files first, then remaining segments
  const concatList: string[] = [
    ...existingFlushedFiles.map((f) => `file '${f.replace(/\\/g, '/')}'`),
    ...existingSegments.map((seg) => `file '${seg.replace(/\\/g, '/')}'`),
  ]

  if (concatList.length === 0) {
    logMotion(`[${streamId}] No segments or flushed files to save`)
    state.savingInProgress = false
    state.motionSegments = []
    state.flushedSegments = []
    return
  }

  const listFile = path.join(stream.config.hlsDir, 'concat_list.txt')
  await fs.promises.writeFile(listFile, concatList.join('\n'))

  const outFile = path.join(stream.config.recordDir, state.recordingTitle)
  const thumbFile = path.join(
    stream.config.thumbDir,
    path.basename(outFile).replace(/\.mp4$/, '.jpg'),
  )
  const ffmpegConcatCmd = `ffmpeg -y -f concat -safe 0 -i "${listFile}" -c copy "${outFile}"`

  logMotion(
    `[${streamId}] Saving ${concatList.length} items (${
      existingFlushedFiles.length
    } flushed + ${existingSegments.length} segments) to ${path.basename(outFile)}`,
  )

  return new Promise<void>((resolve) => {
    const ffmpegProcess = exec(ffmpegConcatCmd, async (err) => {
      if (ffmpegProcess.killed) {
        logMotion(`[${streamId}] Save operation was canceled`)
        state.savingInProgress = false
        state.currentSaveProcess = null
        await safeUnlinkWithRetry(listFile)
        resolve()
        return
      }

      if (err) {
        logMotion(`[${streamId}] FFmpeg concat failed: ${err}`, 'error')
        state.savingInProgress = false
        state.currentSaveProcess = null
        state.motionSegments = []
        state.flushedSegments = []
        state.flushRecordings = []
        state.nextFlushNumber = 1
        state.notificationSent = false
        state.startedRecordingAt = 0
        await safeUnlinkWithRetry(listFile)
        resolve()
        return
      }

      // Generate thumbnail
      const seek = 7
      const thumbProcess = exec(
        `ffmpeg -y -i "${outFile}" -ss ${seek.toFixed(2)} -vframes 1 -update 1 "${thumbFile}"`,
        async () => {
          // Clean up segments and flushed files
          const promises = [
            state.flushedSegments.concat(existingSegments).map((segment) => {
              if (!state.recentSegments.includes(segment)) {
                return safeUnlinkWithRetry(segment)
              }
            }),
            ...existingFlushedFiles.map((f) => safeUnlinkWithRetry(f)),
            safeUnlinkWithRetry(listFile),
          ]
          await Promise.all(promises)

          logMotion(`[${streamId}] Cleared flushDir and saved segments`)
          state.motionSegments = []
          state.flushRecordings = []
          state.flushedSegments = []
          state.nextFlushNumber = 1
          state.notificationSent = false
          state.startedRecordingAt = 0
          state.savingInProgress = false
          state.currentSaveProcess = null

          // Save to DB as before...
          try {
            const duration = await getVideoDuration(outFile)
            const filename = path.basename(outFile)
            const recordedAt =
              filename.match(/(\d{4}-\d{2}-\d{2})T/)?.[1] ||
              new Date().toISOString().slice(0, 10)

            await prisma.motionRecording.upsert({
              where: { streamId_filename: { streamId, filename } },
              update: { duration, updatedAt: new Date() },
              create: {
                streamId,
                filename,
                duration,
                recordedAt,
                updatedAt: new Date(),
              },
            })

            logMotion(
              `[${streamId}] Successfully saved ${filename} (${duration}s, ${concatList.length} items)`,
            )
          } catch (e) {
            logMotion(
              `[${streamId}] Failed to upsert MotionRecording: ${e}`,
              'error',
            )
          }
          resolve()
        },
      )

      thumbProcess.on('exit', () => {
        state.currentSaveProcess = null
      })

      state.currentSaveProcess = thumbProcess
    })

    state.currentSaveProcess = ffmpegProcess

    const saveTimeout = setTimeout(() => {
      if (state.currentSaveProcess && !state.currentSaveProcess.killed) {
        logMotion(`[${streamId}] Save operation timed out, killing process`)
        state.currentSaveProcess.kill('SIGTERM')
        state.motionSegments = []
        state.flushRecordings = []
        state.nextFlushNumber = 1
        state.notificationSent = false
        state.startedRecordingAt = 0
        state.savingInProgress = false
        state.currentSaveProcess = null
        resolve()
      }
    }, 60000)

    ffmpegProcess.on('exit', () => {
      clearTimeout(saveTimeout)
    })
  })
}

async function getVideoDuration(filePath: string): Promise<number> {
  const cmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`
  return new Promise((resolve) => {
    exec(cmd, (err, output) => {
      if (err) {
        console.error(`Failed to get duration for ${filePath}:`, err)
        return resolve(0)
      }
      resolve(Math.round(Number(output)))
    })
  })
}
