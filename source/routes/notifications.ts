import webpush from 'web-push'
import admin from 'firebase-admin'
import express from 'express'
import { StreamManager } from '../streamManager'
import { jwtAuth } from '../middleware/jwtAuth'
import { io, prisma, RequestWithUser } from '../camera'
import { rateLimit } from 'express-rate-limit'

export default function initializeNotificationRoutes(app: express.Application) {
  const subscribeLimiter = rateLimit({
    validate: { ip: false },
    windowMs: 30 * 1000, // 30 seconds
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
  })

  const unsubscribeLimiter = rateLimit({
    validate: { ip: false },
    windowMs: 30 * 1000, // 30 seconds
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
  })

  app.post(
    '/api/subscribe',
    subscribeLimiter,
    jwtAuth,
    express.json(),
    async (req, res) => {
      const sid = getPushSubKey(req)
      const { endpoint, expirationTime, keys, fcmToken, clientId } = req.body

      if (clientId || fcmToken) {
        const upsert = {
          ...(clientId ? { clientId } : {}),
          ...(fcmToken ? { fcmToken } : {}),
        }
        await prisma.pushSubscription.upsert({
          where: { sid },
          update: upsert,
          create: { sid, ...upsert },
        })
        res.json({ success: true })
        return
      }

      if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
        res.status(400).json({ error: 'Invalid subscription' })
        return
      }
      await prisma.pushSubscription.upsert({
        where: { sid },
        update: {
          endpoint,
          expirationTime: expirationTime ?? null,
          p256dh: keys.p256dh,
          auth: keys.auth,
        },
        create: {
          sid,
          endpoint,
          expirationTime: expirationTime ?? null,
          p256dh: keys.p256dh,
          auth: keys.auth,
        },
      })
      res.json({ success: true })
    },
  )

  app.post(
    '/api/unsubscribe',
    unsubscribeLimiter,
    jwtAuth,
    express.json(),
    async (req, res) => {
      const sid = getPushSubKey(req)
      const sub = await prisma.pushSubscription.findUnique({ where: { sid } })

      if (!sub) {
        res.json({ success: true })
        return
      }

      if (req.body?.clientId) {
        await prisma.pushSubscription
          .update({
            where: { sid },
            data: { clientId: null },
          })
          .catch(() =>
            console.warn('[Socket] Failed to unsubscribe user from push.'),
          )
      } else if (req.body?.fcmToken) {
        // Unsubscribe from FCM only
        await prisma.pushSubscription
          .update({
            where: { sid },
            data: { fcmToken: null },
          })
          .catch(() =>
            console.warn('[FCM] Failed to unsubscribe user from push.'),
          )
      } else {
        // Unsubscribe from Web Push only
        await prisma.pushSubscription
          .update({
            where: { sid },
            data: {
              endpoint: null,
              expirationTime: null,
              p256dh: null,
              auth: null,
            },
          })
          .catch(() =>
            console.warn('[WebPush] Failed to unsubscribe user from push.'),
          )
      }

      // After update, check if both FCM and Web Push are now null
      const updated = await prisma.pushSubscription.findUnique({
        where: { sid },
      })
      if (
        !updated?.fcmToken &&
        !updated?.endpoint &&
        !updated?.p256dh &&
        !updated?.clientId &&
        !updated?.auth
      ) {
        await prisma.pushSubscription
          .delete({ where: { sid } })
          .catch(() =>
            console.warn(
              '[PushNotifications] Failed to delete unused push subscription.',
            ),
          )
      }

      res.json({ success: true })
    },
  )
}

/**
 * Send a notification for a specific stream.
 * @param streamId The ID of the stream to notify about.
 * @param custom Optional custom notification data.
 * @param username Optional username to target the notification.
 * @returns A promise that resolves when the notification has been sent.
 */
export async function notify(
  dynamicStreams: Record<string, StreamManager>,
  streamId: string,
  custom?: {
    title?: string
    body?: string
    icon?: string
    sound?: string
    channelId?: string
    tag?: string
    group?: string
  },
  username?: string,
) {
  let nickname
  if (!custom?.body) {
    ;({ nickname } = (await prisma.stream.findUnique({
      where: { id: streamId },
      select: { nickname: true },
    })) ?? { nickname: dynamicStreams[streamId]?.config.ffmpegInput })
  }
  const title = custom?.title ?? 'Motion Detected!'
  const body = custom?.body ?? `Motion was detected by ${nickname}.`
  const icon = custom?.icon ?? 'push_icon'
  const sound = custom?.sound
  const channelId = custom?.channelId
  const tag = custom?.tag
  const group = custom?.group || `stream_event_${streamId}`

  const subs = await prisma.pushSubscription.findMany(
    username ? { where: { sid: username } } : undefined,
  )
  for (const sub of subs) {
    // Web Push
    if (sub.endpoint && sub.p256dh && sub.auth) {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            expirationTime: sub.expirationTime
              ? Number(sub.expirationTime)
              : undefined,
            keys: {
              p256dh: sub.p256dh,
              auth: sub.auth,
            },
          },
          JSON.stringify({
            title,
            body,
            data: {
              streamUrl: `${process.env.VITE_BASE_URL || 'http://localhost:3000'}/stream/${streamId}`,
              cameraId: streamId,
              // ...other custom data
            },
          }),
        )
      } catch (err) {
        console.error('[Notify] Web Push notification error:', err)
        // Remove invalid web push subscription if 404
        if (
          typeof err === 'object' &&
          err !== null &&
          'statusCode' in err &&
          [404, 410].includes(err.statusCode as number) &&
          sub.sid
        ) {
          await prisma.pushSubscription
            .update({
              where: { sid: sub.sid },
              data: { endpoint: null, p256dh: null, auth: null },
            })
            .catch(() =>
              console.warn(
                '[Notify] [WebPush] Failed to delete unused push subscription.',
              ),
            )
        }
      }
    }
    // FCM or Socket Push
    if (sub.fcmToken || sub.clientId) {
      const withOptional = {
        ...(tag ? { tag } : {}),
        ...(channelId ? { channelId } : {}),
        ...(sound ? { sound } : {}),
        ...(icon ? { icon } : {}),
      }

      console.log('[Notify] Sending FCM/socket push')

      if (sub.clientId) {
        if (io.sockets.adapter.rooms.has(sub.clientId)) {
          console.log(`[Notify] Sending socket push to ${sub.sid}`)
          // Socket push
          // Emit notification data to the clientId group
          try {
            io.to(sub.clientId).emit('notification', {
              streamUrl: `${process.env.VITE_BASE_URL || 'http://localhost:3000'}/stream/${streamId}`,
              cameraId: streamId,
              title,
              body,
              withOptional,
            })
            console.log('[Notify] Sent socket push')
            return void 0
          } catch (err) {
            console.error('[Notify] Socket notification emit error', err)
          }
        } else {
          console.log(
            `[Notify] Client ID ${sub.clientId} is not connected via socket`,
          )
        }
      }

      if (sub.fcmToken) {
        console.log(`[Notify] Sending FCM push to ${sub.sid}`)
        // FCM push
        try {
          await admin.messaging().send({
            android: {
              data: {
                title,
                body,
                color: '#2196F3',
                visibility: 'public',
                sticky: 'false',
                localOnly: 'false',
                defaultLightSettings: 'true',
                eventTimestamp: new Date().getTime().toString(10),
                vibrateTimingsMillis: '0,500,500,500',
                ...withOptional,

                streamUrl: `${process.env.VITE_BASE_URL || 'http://localhost:3000'}/stream/${streamId}`,
                cameraId: streamId,
                ...(group ? { group } : {}),
                actions: title === 'Motion Detected!' ? 'true' : 'false',
              },
            },
            token: sub.fcmToken,
          })
          console.log('[Notify] Sent FCM push')
          /* android: {
            priority: 'high',
            notification: {
              title,
              body,
              icon,
              color: '#2196F3',
              sound,
              visibility: 'public',
              sticky: false,
              localOnly: false,
              defaultLightSettings: true,
              eventTimestamp: new Date(),
              vibrateTimingsMillis: [0, 500, 500, 500],
              ...withOptional,
              // clickAction: 'OPEN_STREAM',
            },
          }, */
        } catch (err) {
          if (!err || typeof err !== 'object' || !('code' in err)) {
            throw new Error(
              '[Notify] FCM notification error: No/invalid error object provided',
            )
          }

          if (err.code === 'messaging/server-unavailable') {
            console.warn('FCM server unavailable, retrying...')
            return setTimeout(() => {
              notify(dynamicStreams, streamId, custom, username)
            }, 5000) // Retry after 5 seconds
          } else if (
            err.code === 'messaging/registration-token-not-registered'
          ) {
            console.warn(
              `[Notify] Invalid FCM token, removing from subscription for ${sub.sid}`,
            )
            return prisma.pushSubscription
              .update({
                where: { sid: sub.sid },
                data: { fcmToken: null },
              })
              .catch(() =>
                console.warn(
                  '[Notify] [FCM] Failed to remove invalid token from user.',
                ),
              )
          }

          console.error('[Notify] FCM notification error:', err)
        }
      }
    }
  }
}

function getPushSubKey(req: RequestWithUser) {
  // Use username from JWT as the subscription key
  return req.user!.username
}
