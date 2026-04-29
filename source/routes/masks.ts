import { prisma } from '../camera'
import { jwtAuth } from '../middleware/jwtAuth'
import express from 'express'
import rateLimit from 'express-rate-limit'

export default function initializeMaskRoutes(app: express.Application) {
  const getMasksLimiter = rateLimit({
    windowMs: 30 * 1000, // 30 seconds
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
  })

  const postMasksLimiter = rateLimit({
    windowMs: 30 * 1000, // 30 seconds
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
  })

  const patchMasksLimiter = rateLimit({
    windowMs: 15 * 1000, // 15 seconds
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
  })

  const deleteMasksLimiter = rateLimit({
    windowMs: 5000, // 5 seconds
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
  })

  // --- Serve masks for a stream ---
  app.get(
    '/api/masks/:streamId',
    getMasksLimiter,
    jwtAuth,
    async (req, res) => {
      const { streamId } = req.params
      const masks = await prisma.streamMask.findMany({ where: { streamId } })
      res.json(masks)
    },
  )

  // --- Create and delete masks for a stream ---
  app.post(
    '/api/masks/:streamId',
    postMasksLimiter,
    jwtAuth,
    express.json(),
    async (req, res) => {
      const { streamId } = req.params
      const { mask } = req.body
      if (
        !mask ||
        (mask.type && mask.type !== 'fixed' && mask.type !== 'relative') ||
        !['x', 'y', 'w', 'h'].every((k) => Number.isInteger(mask[k]))
      ) {
        res.status(400).json({ success: false, error: 'Invalid mask data' })
        return
      }
      const orderedMask = {
        x: mask.x,
        y: mask.y,
        w: mask.w,
        h: mask.h,
      }
      await prisma.streamMask
        .create({
          data: {
            streamId,
            mask: JSON.stringify(orderedMask),
            ...(typeof mask.type !== 'undefined' ? { type: mask.type } : {}),
          },
        })
        .then((newMask) => res.json({ success: true, mask: newMask }))
        .catch(() =>
          res
            .status(500)
            .json({ success: false, error: 'Failed to save mask' }),
        )
    },
  )

  app.patch(
    '/api/masks/:streamId/:maskId',
    patchMasksLimiter,
    jwtAuth,
    express.json(),
    async (req, res) => {
      const { streamId, maskId } = req.params
      const { mask } = req.body
      if (
        !mask ||
        (mask.type && mask.type !== 'fixed' && mask.type !== 'conditional') ||
        !['x', 'y', 'w', 'h'].every((k) => Number.isInteger(mask[k]))
      ) {
        console.log(
          `[PATCH] Invalid mask data for stream ${streamId}, maskId ${maskId}:`,
          mask,
        )
        res.status(400).json({ success: false, error: 'Invalid mask data' })
        return
      }
      const orderedMask = {
        x: mask.x,
        y: mask.y,
        w: mask.w,
        h: mask.h,
      }
      try {
        const updated = await prisma.streamMask.update({
          where: { id_streamId: { streamId, id: maskId } },
          data: {
            mask: JSON.stringify(orderedMask),
            updatedAt: new Date(),
            ...(typeof mask.type !== 'undefined' ? { type: mask.type } : {}),
          },
        })
        res.json({ success: true, mask: updated })
      } catch (_) {
        res.status(500).json({ success: false, error: 'Failed to update mask' })
      }
    },
  )

  app.delete(
    '/api/masks/:streamId/:maskId',
    deleteMasksLimiter,
    jwtAuth,
    express.json(),
    async (req, res) => {
      const { streamId, maskId } = req.params
      await prisma.streamMask
        .delete({ where: { id_streamId: { streamId, id: maskId } } })
        .then(() => res.json({ success: true }))
        .catch(() =>
          res
            .status(500)
            .json({ success: false, error: 'Failed to delete mask' }),
        )
    },
  )
}
