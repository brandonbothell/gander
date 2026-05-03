import webpush from 'web-push'
import admin from 'firebase-admin'
import express from 'express'
import { StreamManager } from '../streamManager'
import { jwtAuth } from '../middleware/jwtAuth'
import { io, prisma, RequestWithUser } from '../camera'
import { rateLimit } from 'express-rate-limit'
import { logNotify } from '../logMotion'

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
      logNotify(
        `[Notify] [WebPush] Sending notification to '${sub.sid}'`,
        'info',
      )
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
        logNotify(`[Notify] [WebPush] Notification error: ${err}`, 'error')
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
              logNotify(
                '[Notify] [WebPush] Failed to delete unused push subscription.',
                'warn',
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

      if (sub.clientId) {
        logNotify(
          `[Notify] [Socket] Sending push notification to '${sub.sid}'`,
          'info',
        )
        if (io.sockets.adapter.rooms.has(sub.clientId)) {
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
            continue
          } catch (err) {
            logNotify(
              `[Notify] Socket notification emit error: ${err}`,
              'error',
            )
          }
        }
      }

      if (sub.fcmToken) {
        logNotify(
          `[Notify] [FCM] Sending push notification to '${sub.sid}'`,
          'info',
        )
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
            logNotify(
              '[Notify] FCM notification error: No/invalid error object provided',
              'error',
            )
            return
          }

          if (err.code === 'messaging/server-unavailable') {
            console.warn('FCM server unavailable, retrying...')
            return setTimeout(() => {
              notify(dynamicStreams, streamId, custom, username)
            }, 5000) // Retry after 5 seconds
          } else if (
            err.code === 'messaging/registration-token-not-registered'
          ) {
            logNotify(
              `[Notify] Invalid FCM token, removing from subscription for ${sub.sid}`,
              'warn',
            )
            return prisma.pushSubscription
              .update({
                where: { sid: sub.sid },
                data: { fcmToken: null },
              })
              .catch(() =>
                logNotify(
                  '[Notify] [FCM] Failed to remove invalid token from user.',
                  'warn',
                ),
              )
          }

          logNotify(`[Notify] FCM notification error: ${err}`, 'error')
        }
      }
    }
  }
}

function getPushSubKey(req: RequestWithUser) {
  // Use username from JWT as the subscription key
  return req.user!.username
}
