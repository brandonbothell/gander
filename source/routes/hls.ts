import fs from 'fs'
import { Application } from 'express'
import { StreamManager } from '../streamManager'
import { jwtAuth } from '../middleware/jwtAuth'
import { rateLimit } from 'express-rate-limit'

export default function initializeHlsRoutes(
  app: Application,
  dynamicStreams: Record<string, StreamManager>,
) {
  const hlsStreamLimiter = rateLimit({
    validate: { ip: false },
    windowMs: 10 * 1000, // 10 seconds
    max: 4,
    standardHeaders: true,
    legacyHeaders: false,
  })

  app.get(
    '/hls/:streamId/stream.m3u8',
    hlsStreamLimiter,
    jwtAuth,
    (req, res) => {
      const { streamId } = req.params
      const stream = dynamicStreams[streamId]
      if (!stream) {
        res.status(404).send('Stream not found')
        return
      }
      fs.readFile(stream.getPlaylistPath(), 'utf8', (err: any, data: any) => {
        if (err) {
          res.status(404).send('Not found')
          return
        }
        res.type('application/vnd.apple.mpegurl').send(data)
      })
    },
  )

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
}
