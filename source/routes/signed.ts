import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import childProcess from 'child_process'
import express from 'express'

import { SignedUrl, StreamMotionState } from '../types/stream'
import { StreamManager } from '../streamManager'
import { jwtAuth } from '../middleware/jwtAuth'
import { JWT_SECRET } from '../credentials'
import { rateLimit } from 'express-rate-limit'

export default function initializeSignedRoutes(
  app: express.Express,
  dynamicStreams: Record<string, StreamManager>,
  streamStates: Record<string, StreamMotionState>,
  streamThumbnailPromises: Record<string, Promise<{ success: boolean }> | null>,
) {
  const generateSignedLatestThumbUrlLimiter = rateLimit({
    validate: { ip: false },
    windowMs: 5 * 1000, // 5 seconds
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
  })

  // --- Endpoint to get a signed latest thumbnail URL for a stream ---
  app.get(
    '/api/signed-latest-thumb-url/:streamId',
    generateSignedLatestThumbUrlLimiter,
    jwtAuth,
    (req, res) => {
      const { streamId } = req.params
      if (!dynamicStreams[streamId]) {
        res.status(404).json({ error: 'Stream not found' })
        return
      }
      const url = createSignedLatestThumbUrl(streamId)
      res.json({ url })
    },
  )

  // --- Serve signed latest thumbnail for a stream, generating it from the latest HLS segment ---
  app.get(
    '/signed/recordings/:streamId/thumbnails/latest.jpg',
    async (req, res) => {
      const { streamId } = req.params
      const { expires, sig } = req.query
      if (
        typeof streamId !== 'string' ||
        typeof expires !== 'string' ||
        typeof sig !== 'string' ||
        !dynamicStreams[streamId] ||
        !verifySignedLatestThumbUrl(streamId, expires, sig)
      ) {
        res.status(403).send('Forbidden')
        return
      }

      const stream = dynamicStreams[streamId]

      fs.readdir(stream.config.hlsDir, async (err, files) => {
        if (err) {
          res.status(404).send('No segments')
          return
        }
        const tsFiles = files
          .filter((f) => /^segment_(\d+)\.ts$/.test(f))
          .sort((a, b) => {
            const aNum = parseInt(a.match(/^segment_(\d+)\.ts$/)![1], 10)
            const bNum = parseInt(b.match(/^segment_(\d+)\.ts$/)![1], 10)
            return bNum - aNum
          })

        if (tsFiles.length === 0) {
          res.status(404).send('No segments')
          return
        }

        const state = streamStates[streamId]

        // --- If motion detection is active, serve the latest segment_*_motion.jpg if it exists ---
        if (!state?.motionPaused) {
          // Find the latest segment_*_motion.jpg file
          const motionJpgs = files
            .filter((f) => /^segment_(\d+)_motion\.jpg$/.test(f))
            .sort((a, b) => {
              const aNum = parseInt(
                a.match(/^segment_(\d+)_motion\.jpg$/)![1],
                10,
              )
              const bNum = parseInt(
                b.match(/^segment_(\d+)_motion\.jpg$/)![1],
                10,
              )
              return bNum - aNum
            })
          if (motionJpgs.length > 0) {
            const latestMotionJpg = motionJpgs[0]
            const latestMotionJpgPath = path.join(
              stream.config.hlsDir,
              latestMotionJpg,
            )
            // Serve the motion jpg directly
            res.setHeader(
              'Cache-Control',
              'no-store, no-cache, must-revalidate, proxy-revalidate',
            )
            res.setHeader('Pragma', 'no-cache')
            res.setHeader('Expires', '0')
            res.sendFile(latestMotionJpgPath, (err) => {
              if (res.headersSent) return
              // @ts-expect-error types
              if (err && err.code !== 'ECONNABORTED') {
                res.status(404).json({ error: 'File not found' })
                console.error(
                  `[${streamId}] Failed to serve motion thumbnail file ${latestMotionJpg}:`,
                  JSON.stringify(err, null, 2),
                )
              }
            })
            return
          }
          // If no motion jpg exists, fall through to original logic
        }

        // --- Lock logic start ---
        // Only regenerate if thumbnail doesn't exist or is older than the segment
        let regenerate = !streamThumbnailPromises[streamId]
        const thumbName = 'latest.jpg'
        const thumbPath = path.join(stream.config.thumbDir, thumbName)

        if (regenerate) {
          const latestTs = tsFiles[0]
          const tsPath = path.join(stream.config.hlsDir, latestTs)
          try {
            const [thumbStat, tsStat] = await Promise.all([
              fs.promises.stat(thumbPath).catch(() => null),
              fs.promises.stat(tsPath),
            ])
            if (thumbStat && thumbStat.mtime > tsStat.mtime) {
              regenerate = false
            }
          } catch {
            /* ignore */
          }

          if (regenerate) {
            const ffmpegCmd = `ffmpeg -y -i "${tsPath}" -vf "select=eq(n\\,0),scale=160:90" -vframes 1 -update 1 "${thumbPath}"`
            streamThumbnailPromises[streamId] = new Promise<{
              success: boolean
            }>((resolve) => {
              childProcess.exec(ffmpegCmd, (err) => {
                if (err) {
                  console.error(
                    `[${streamId}] Failed to generate thumbnail from ${latestTs}:`,
                    err,
                  )
                  resolve({ success: false })
                } else resolve({ success: true })
              })
            })
          }
        }

        const awaited = await streamThumbnailPromises[streamId]

        if (regenerate && !awaited?.success) {
          res.status(500).send('Failed to generate thumbnail')
          return
        }

        // Reset the promise so it can be regenerated next time
        streamThumbnailPromises[streamId] = null
        res.setHeader(
          'Cache-Control',
          'no-store, no-cache, must-revalidate, proxy-revalidate',
        )
        res.setHeader('Pragma', 'no-cache')
        res.setHeader('Expires', '0')
        res.sendFile(thumbPath, (err) => {
          if (res.headersSent) return
          // @ts-expect-error types
          if (err && err.code !== 'ECONNABORTED') {
            res.status(404).json({ error: 'File not found' })
            console.error(
              `[${streamId}] Failed to serve thumbnail file ${thumbName}:`,
              JSON.stringify(err, null, 2),
            )
          }
        })
        // --- Lock logic end ---
      })
    },
  )

  const streamThumbnailLimiter = rateLimit({
    validate: { ip: false },
    windowMs: 1000, // 1 second
    max: 4,
    standardHeaders: true,
    legacyHeaders: false,
  })

  // --- Serve latest thumbnail for a stream, generating it from the latest HLS segment ---
  // This may not be a signed endpoint, but it goes here because it uses all of the same stuff
  app.get(
    '/recordings/:streamId/thumbnails/latest.jpg',
    streamThumbnailLimiter,
    jwtAuth,
    async (req, res) => {
      const { streamId } = req.params
      const stream = dynamicStreams[streamId]

      fs.readdir(stream.config.hlsDir, async (err, files) => {
        if (err) {
          res.status(404).send('No segments')
          return
        }
        const tsFiles = files
          .filter((f) => /^segment_(\d+)\.ts$/.test(f))
          .sort((a, b) => {
            const aNum = parseInt(a.match(/^segment_(\d+)\.ts$/)![1], 10)
            const bNum = parseInt(b.match(/^segment_(\d+)\.ts$/)![1], 10)
            return bNum - aNum
          })

        if (tsFiles.length === 0) {
          res.status(404).send('No segments')
          return
        }

        const state = streamStates[streamId]

        // --- If motion detection is active, serve the latest segment_*_motion.jpg if it exists ---
        if (!state?.motionPaused) {
          // Find the latest segment_*_motion.jpg file
          const motionJpgs = files
            .filter((f) => /^segment_(\d+)_motion\.jpg$/.test(f))
            .sort((a, b) => {
              const aNum = parseInt(
                a.match(/^segment_(\d+)_motion\.jpg$/)![1],
                10,
              )
              const bNum = parseInt(
                b.match(/^segment_(\d+)_motion\.jpg$/)![1],
                10,
              )
              return bNum - aNum
            })
          if (motionJpgs.length > 0) {
            const latestMotionJpg = motionJpgs[0]
            const latestMotionJpgPath = path.join(
              stream.config.hlsDir,
              latestMotionJpg,
            )
            // Serve the motion jpg directly
            res.setHeader(
              'Cache-Control',
              'no-store, no-cache, must-revalidate, proxy-revalidate',
            )
            res.setHeader('Pragma', 'no-cache')
            res.setHeader('Expires', '0')
            res.sendFile(latestMotionJpgPath, (err) => {
              if (res.headersSent) return
              // @ts-expect-error types
              if (err && err.code !== 'ECONNABORTED') {
                res.status(404).json({ error: 'File not found' })
                console.error(
                  `[${streamId}] Failed to serve motion thumbnail file ${latestMotionJpg}:`,
                  JSON.stringify(err, null, 2),
                )
              }
            })
            return
          }
          // If no motion jpg exists, fall through to original logic
        }

        // --- Lock logic start ---
        // Only regenerate if thumbnail doesn't exist or is older than the segment
        let regenerate = !streamThumbnailPromises[streamId]
        const thumbName = 'latest.jpg'
        const thumbPath = path.join(stream.config.thumbDir, thumbName)

        if (regenerate) {
          const latestTs = tsFiles[0]
          const tsPath = path.join(stream.config.hlsDir, latestTs)
          try {
            const [thumbStat, tsStat] = await Promise.all([
              fs.promises.stat(thumbPath).catch(() => null),
              fs.promises.stat(tsPath),
            ])
            if (thumbStat && thumbStat.mtime > tsStat.mtime) {
              regenerate = false
            }
          } catch {
            /* ignore */
          }

          if (regenerate) {
            const ffmpegCmd = `ffmpeg -y -i "${tsPath}" -vf "select=eq(n\\,0),scale=320:180" -vframes 1 "${thumbPath}"`
            streamThumbnailPromises[streamId] = new Promise<{
              success: boolean
            }>((resolve) => {
              childProcess.exec(ffmpegCmd, { windowsHide: true }, (err) => {
                if (err) {
                  console.error(
                    `[${streamId}] Failed to generate thumbnail from ${latestTs}:`,
                    err,
                  )
                  resolve({ success: false })
                } else resolve({ success: true })
              })
            })
          }
        }

        const awaited = await streamThumbnailPromises[streamId]

        if (regenerate && !awaited?.success) {
          res.status(500).send('Failed to generate thumbnail')
          return
        }

        // Reset the promise so it can be regenerated next time
        streamThumbnailPromises[streamId] = null
        res.setHeader(
          'Cache-Control',
          'no-store, no-cache, must-revalidate, proxy-revalidate',
        )
        res.setHeader('Pragma', 'no-cache')
        res.setHeader('Expires', '0')
        res.sendFile(thumbPath, (err) => {
          if (res.headersSent) return
          // @ts-expect-error types
          if (err && err.code !== 'ECONNABORTED') {
            res.status(404).json({ error: 'File not found' })
            console.error(
              `[${streamId}] Failed to serve thumbnail file ${thumbName}:`,
              JSON.stringify(err, null, 2),
            )
          }
        })
        // --- Lock logic end ---
      })
    },
  )

  const streamSignedUrlLimiter = rateLimit({
    validate: { ip: false },
    windowMs: 30 * 1000, // 30 seconds
    max: 8,
    standardHeaders: true,
    legacyHeaders: false,
  })

  // Endpoint to get a signed stream playlist URL for a specific stream
  app.get(
    '/api/signed-stream-url/:streamId',
    streamSignedUrlLimiter,
    jwtAuth,
    (req, res) => {
      const { streamId } = req.params
      if (!dynamicStreams[streamId]) {
        res.status(404).json({ error: 'Stream not found' })
        return
      }
      const url = createSignedStreamUrl(streamId)
      res.json({ url })
    },
  )

  const videoAndThumbnailSignedUrlLimiter = rateLimit({
    validate: { ip: false },
    windowMs: 2 * 1000, // 2 seconds
    max: 50,
    standardHeaders: true,
    legacyHeaders: false,
  })

  // Endpoint to get a signed URL for a video or thumbnail from a specific stream
  app.get(
    '/api/signed-url/:streamId',
    videoAndThumbnailSignedUrlLimiter,
    jwtAuth,
    (req, res) => {
      const { streamId } = req.params
      const { filename, type } = req.query
      if (
        typeof filename !== 'string' ||
        (type !== 'video' && type !== 'thumbnail')
      ) {
        res.status(400).json({ error: 'Invalid parameters' })
        return
      }
      const url = createSignedUrl(
        streamId,
        filename,
        type as 'video' | 'thumbnail',
      )
      res.json(url)
    },
  )

  const videosAndThumbnailsSignedUrlLimiter = rateLimit({
    validate: { ip: false },
    windowMs: 2 * 1000, // 2 seconds
    max: 2,
    standardHeaders: true,
    legacyHeaders: false,
  })

  app.get(
    '/api/signed-urls/:streamId',
    videosAndThumbnailsSignedUrlLimiter,
    jwtAuth,
    (req, res) => {
      const { streamId } = req.params
      const { type } = req.query
      const filenames = String(req.query.filenames).split(',')

      if (type !== 'video' && type !== 'thumbnail') {
        res.status(400).json({ error: 'Invalid parameters' })
        return
      }

      const urls = createSignedUrl(
        streamId,
        filenames,
        type as 'video' | 'thumbnail',
      )
      res.json(urls)
    },
  )

  // Serve video file via signed URL
  app.get('/signed/video/:streamId/:filename', (req, res) => {
    const { streamId, filename } = req.params
    const { expires, sig } = req.query
    if (
      typeof expires !== 'string' ||
      typeof sig !== 'string' ||
      !verifySignedUrl(streamId, filename, 'video', expires, sig)
    ) {
      res.status(403).send('Forbidden')
      return
    }
    const filePath = path.join(
      dynamicStreams[streamId].config.recordDir,
      filename,
    )
    if (!filePath.startsWith(dynamicStreams[streamId].config.recordDir)) {
      res.status(403).send('Forbidden')
      return
    }

    res.sendFile(filePath, (err) => {
      if (res.headersSent) return
      // @ts-expect-error types
      if (err && err.code !== 'ECONNABORTED') {
        res.status(404).json({ error: 'File not found' })
        console.error(
          `[${streamId}] Failed to serve recording file ${filename}:`,
          JSON.stringify(err, null, 2),
        )
      }
    })
  })

  app.get('/signed/thumbnail/:streamId/:filename', (req, res) => {
    const { streamId, filename } = req.params
    const { expires, sig } = req.query
    if (
      typeof expires !== 'string' ||
      typeof sig !== 'string' ||
      !verifySignedUrl(streamId, filename, 'thumbnail', expires, sig)
    ) {
      res.status(403).send('Forbidden')
      return
    }
    const thumbPath = path.join(
      dynamicStreams[streamId].config.thumbDir,
      filename,
    )
    if (!thumbPath.startsWith(dynamicStreams[streamId].config.thumbDir)) {
      res.status(403).send('Forbidden')
      return
    }

    if (!req.url.endsWith('latest.jpg')) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    }

    res.sendFile(thumbPath, (err) => {
      if (res.headersSent) return
      // @ts-expect-error types
      if (err && err.code !== 'ECONNABORTED') {
        res.status(404).json({ error: 'File not found' })
        console.error(
          `[${streamId}] Failed to serve thumbnail file ${filename}:`,
          JSON.stringify(err, null, 2),
        )
      }
    })
  })

  // Serve signed stream playlist for a specific stream
  app.get('/signed/stream/:streamId/stream.m3u8', (req, res) => {
    const { streamId } = req.params
    const { expires, sig } = req.query
    if (
      typeof streamId !== 'string' ||
      typeof expires !== 'string' ||
      typeof sig !== 'string' ||
      !dynamicStreams[streamId] ||
      !verifySignedStreamUrl(streamId, expires, sig)
    ) {
      res.status(403).send('Forbidden')
      return
    }
    const playlistPath = dynamicStreams[streamId].getPlaylistPath()
    fs.readFile(playlistPath, 'utf8', (err, data) => {
      if (err) {
        res.status(404).send('Not found')
        return
      }
      let lines = data.split('\n')
      if (!lines.some((line) => line.startsWith('#EXT-X-PLAYLIST-TYPE'))) {
        lines.splice(
          lines.findIndex((line) => line.startsWith('#EXTM3U')) + 1,
          0,
          '#EXT-X-PLAYLIST-TYPE:LIVE',
        )
      }
      if (!lines.some((line) => line.startsWith('#EXT-X-ALLOW-CACHE'))) {
        lines.splice(
          lines.findIndex((line) =>
            line.startsWith('#EXT-X-PLAYLIST-TYPE:LIVE'),
          ) + 1,
          0,
          '#EXT-X-ALLOW-CACHE:NO',
        )
      }
      lines = lines.filter((line) => !line.startsWith('#EXT-X-ENDLIST'))
      // Rewrite segment URLs to signed segment URLs for this stream
      const rewritten = lines
        .join('\n')
        .replace(
          /(segment_\d+\.ts)/g,
          (segment) =>
            `/signed/stream/${streamId}/${segment}?expires=${expires}&sig=${sig}`,
        )
      res.setHeader(
        'Cache-Control',
        'no-store, no-cache, must-revalidate, proxy-revalidate',
      )
      res.setHeader('Pragma', 'no-cache')
      res.setHeader('Expires', '0')
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Headers', '*')
      res.type('application/vnd.apple.mpegurl').send(rewritten)
    })
  })

  // Serve signed stream segment for a specific stream
  app.get('/signed/stream/:streamId/:segment', (req, res) => {
    const { streamId, segment } = req.params
    const { expires, sig } = req.query
    if (
      typeof streamId !== 'string' ||
      typeof segment !== 'string' ||
      typeof expires !== 'string' ||
      typeof sig !== 'string' ||
      !/^segment_\d+\.ts$/.test(segment) ||
      !dynamicStreams[streamId] ||
      !verifySignedStreamUrl(streamId, expires, sig)
    ) {
      res.status(403).send('Forbidden')
      return
    }
    const segmentPath = dynamicStreams[streamId].getSegmentPath(segment)
    res.setHeader(
      'Cache-Control',
      'no-store, no-cache, must-revalidate, proxy-revalidate',
    )
    res.setHeader('Pragma', 'no-cache')
    res.setHeader('Expires', '0')
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', '*')
    try {
      fs.createReadStream(segmentPath)
        .on('error', () => {
          res.type('text/html').status(404).send('Segment not found')
        })
        .pipe(res.type('video/MP2T'))
    } catch (err) {
      if (res.headersSent) return
      res.type('application/json').status(404).json({ error: 'File not found' })
      console.error(
        `[${streamId}] Failed to serve segment file ${segment}:`,
        JSON.stringify(err, null, 2),
      )
    }
  })
}

// --- Helper to create a signed latest thumbnail URL for a stream ---
function createSignedLatestThumbUrl(streamId: string, expiresInSeconds = 300) {
  const expires = Math.floor(Date.now() / 1000) + expiresInSeconds
  const secret = process.env.SIGNED_URL_SECRET ?? JWT_SECRET
  const data = `latest-thumb:${streamId}:${expires}`
  const sig = crypto.createHmac('sha256', secret).update(data).digest('hex')
  return `/signed/recordings/${streamId}/thumbnails/latest.jpg?expires=${expires}&sig=${sig}`
}

// --- Helper to verify a signed latest thumbnail URL for a stream ---
function verifySignedLatestThumbUrl(
  streamId: string,
  expires: string,
  sig: string,
) {
  const secret = process.env.SIGNED_URL_SECRET ?? JWT_SECRET
  const data = `latest-thumb:${streamId}:${expires}`
  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('hex')
  if (sig !== expectedSig) return false
  if (parseInt(expires) < Math.floor(Date.now() / 1000)) return false
  return true
}

// --- Helper to create a signed URL
function createSignedUrl<T extends string | string[]>(
  streamId: string,
  filename: T,
  type: 'video' | 'thumbnail',
  expiresInSeconds = 300,
): T extends string[] ? SignedUrl[] : SignedUrl {
  const isArray = Array.isArray(filename)
  const filenames: string | string[] = isArray ? filename : [filename]
  const result: SignedUrl[] = []

  for (const filename of filenames) {
    const expires = Math.floor(Date.now() / 1000) + expiresInSeconds
    const secret = process.env.SIGNED_URL_SECRET ?? JWT_SECRET
    const data = `${streamId}:${filename}:${type}:${expires}`
    const sig = crypto.createHmac('sha256', secret).update(data).digest('hex')

    if (!isArray) {
      return {
        filename,
        url: `/signed/${type}/${streamId}/${encodeURIComponent(filename)}?expires=${expires}&sig=${sig}`,
        expiresAt: expires,
      } as T extends string[] ? SignedUrl[] : SignedUrl
    }

    result.push({
      filename,
      url: `/signed/${type}/${streamId}/${encodeURIComponent(filename)}?expires=${expires}&sig=${sig}`,
      expiresAt: expires,
    })
  }

  return result as T extends string[] ? SignedUrl[] : SignedUrl
}

// Function to verify signed URL
function verifySignedUrl(
  streamId: string,
  filename: string,
  type: 'video' | 'thumbnail',
  expires: string,
  sig: string,
) {
  const secret = process.env.SIGNED_URL_SECRET ?? JWT_SECRET
  const data = `${streamId}:${filename}:${type}:${expires}`
  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('hex')
  if (sig !== expectedSig) return false
  if (parseInt(expires) < Math.floor(Date.now() / 1000)) return false
  return true
}

// --- Helper to create a signed stream playlist URL for a specific stream ---
function createSignedStreamUrl(streamId: string, expiresInSeconds = 300) {
  const expires = Math.floor(Date.now() / 1000) + expiresInSeconds
  const secret = process.env.SIGNED_URL_SECRET ?? JWT_SECRET
  const data = `stream:${streamId}:${expires}`
  const sig = crypto.createHmac('sha256', secret).update(data).digest('hex')
  return `/signed/stream/${streamId}/stream.m3u8?expires=${expires}&sig=${sig}`
}

// --- Helper to verify a signed stream playlist/segment URL ---
function verifySignedStreamUrl(streamId: string, expires: string, sig: string) {
  const secret = process.env.SIGNED_URL_SECRET ?? JWT_SECRET
  const data = `stream:${streamId}:${expires}`
  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('hex')
  if (sig !== expectedSig) return false
  if (parseInt(expires) < Math.floor(Date.now() / 1000)) return false
  return true
}
