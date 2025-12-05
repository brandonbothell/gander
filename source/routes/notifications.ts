import { prisma, RequestWithUser } from '../camera';
import express from 'express';
import { jwtAuth } from '../middleware/jwtAuth';
import { StreamManager } from '../streamManager';
import * as admin from 'firebase-admin';
import webpush from 'web-push';

export default function initializeNotificationRoutes(app: express.Application) {
  app.post('/api/subscribe', jwtAuth, express.json(), async (req, res) => {
    const sid = getPushSubKey(req);
    const { endpoint, expirationTime, keys, fcmToken } = req.body;

    if (fcmToken) {
      await prisma.pushSubscription.upsert({
        where: { sid },
        update: { fcmToken },
        create: { sid, fcmToken },
      });
      res.json({ success: true });
      return;
    }

    if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
      res.status(400).json({ error: 'Invalid subscription' });
      return;
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
    });
    res.json({ success: true });
  });

  app.post('/api/unsubscribe', jwtAuth, express.json(), async (req, res) => {
    const sid = getPushSubKey(req);
    const sub = await prisma.pushSubscription.findUnique({ where: { sid } });

    if (!sub) {
      res.json({ success: true });
      return;
    }

    if (req.body && req.body.fcmToken) {
      // Unsubscribe from FCM only
      await prisma.pushSubscription
        .update({
          where: { sid },
          data: { fcmToken: null },
        })
        .catch(() => {});
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
        .catch(() => {});
    }

    // After update, check if both FCM and Web Push are now null
    const updated = await prisma.pushSubscription.findUnique({
      where: { sid },
    });
    if (
      !updated?.fcmToken &&
      !updated?.endpoint &&
      !updated?.p256dh &&
      !updated?.auth
    ) {
      await prisma.pushSubscription.delete({ where: { sid } }).catch(() => {});
    }

    res.json({ success: true });
  });
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
    title?: string;
    body?: string;
    icon?: string;
    sound?: string;
    channelId?: string;
    tag?: string;
    group?: string;
  },
  username?: string,
) {
  let nickname;
  if (!custom?.body)
    ({ nickname } = (await prisma.stream.findUnique({
      where: { id: streamId },
      select: { nickname: true },
    })) ?? { nickname: dynamicStreams[streamId]?.config.ffmpegInput });
  const title = custom?.title ?? 'Motion Detected!';
  const body = custom?.body ?? `Motion was detected by ${nickname}.`;
  const icon = custom?.icon ?? 'push_icon';
  const sound = custom?.sound ?? 'default';
  const channelId = custom?.channelId;
  const tag = custom?.tag;
  const group = custom?.group || `stream_event_${streamId}`;

  const subs = await prisma.pushSubscription.findMany(
    username ? { where: { sid: username } } : undefined,
  );
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
        );
      } catch (err) {
        console.error('Web Push notification error:', err);
        // Remove invalid web push subscription if 404
        if (
          typeof err === 'object' &&
          err !== null &&
          'statusCode' in err &&
          err.statusCode === 404 &&
          sub.sid
        ) {
          await prisma.pushSubscription
            .update({
              where: { sid: sub.sid },
              data: { endpoint: null, p256dh: null, auth: null },
            })
            .catch(() => {});
        }
      }
    }
    // FCM Push
    if (sub.fcmToken) {
      try {
        const withOptional = {
          ...(tag ? { tag } : {}),
          ...(channelId ? { channelId } : {}),
        };
        await admin.messaging().send({
          android: {
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
              notificationCount: 1,
              vibrateTimingsMillis: [0, 500, 500, 500],
              ...withOptional,
              // clickAction: 'OPEN_STREAM',
            },
          },
          token: sub.fcmToken,
          data: {
            streamUrl: `${process.env.VITE_BASE_URL || 'http://localhost:3000'}/stream/${streamId}`,
            cameraId: streamId,
            ...(group ? { group } : {}),
            // ...other custom data
          },
        });
      } catch (err) {
        if (!err || typeof err !== 'object' || !('code' in err))
          throw new Error(
            'FCM notification error: No/invalid error object provided',
          );

        if (err.code === 'messaging/server-unavailable') {
          console.warn('FCM server unavailable, retrying...');
          return setTimeout(() => {
            notify(dynamicStreams, streamId, custom, username);
          }, 5000); // Retry after 5 seconds
        } else if (err.code === 'messaging/registration-token-not-registered') {
          console.warn(
            `Invalid FCM token, removing from subscription for ${sub.sid}`,
          );
          return prisma.pushSubscription
            .update({
              where: { sid: sub.sid },
              data: { fcmToken: null },
            })
            .catch(() => {});
        }

        console.error('FCM notification error:', err);
      }
    }
  }
}

function getPushSubKey(req: RequestWithUser) {
  // Use username from JWT as the subscription key
  return req.user!.username;
}
