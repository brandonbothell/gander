import {
  PushNotifications,
  type Token,
  type PushNotificationSchema,
  type ActionPerformed,
} from '@capacitor/push-notifications'
import { LocalNotifications } from '@capacitor/local-notifications'
import { App } from '@capacitor/app'
import { MotionService } from './plugins/motionService'
import { API_BASE, authFetch } from './main'

export async function subscribeToWebPush() {
  if (!navigator.serviceWorker) {
    return console.warn('Service Worker not supported')
  }

  const keyRes = await authFetch(`${API_BASE}/api/vapid-public-key`)
  const { publicKey } = await keyRes.json()

  function urlBase64ToUint8Array(base64String: string) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
    const base64 = (base64String + padding)
      .replace(/-/g, '+')
      .replace(/_/g, '/')
    const rawData = window.atob(base64)
    const outputArray = new Uint8Array(rawData.length)
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i)
    }
    return outputArray
  }

  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  })
  await authFetch(`${API_BASE}/api/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sub),
  })
}

export async function setupPushNotifications() {
  try {
    const pushPermissions = await PushNotifications.requestPermissions()

    if (pushPermissions.receive === 'granted') {
      PushNotifications.addListener(
        'pushNotificationReceived',
        async (notification: PushNotificationSchema) => {
          console.log('Push notification received:', notification)
        },
      )

      PushNotifications.addListener(
        'pushNotificationActionPerformed',
        (action: ActionPerformed) => {
          console.log('Push notification action recieved:', action)
          const url = action.notification.data?.streamUrl
          if (url) {
            window.location.href = url
          }
        },
      )

      LocalNotifications.addListener(
        'localNotificationActionPerformed',
        (event) => {
          console.log('Local notification tapped:', event)
          const url = event.notification.extra?.streamUrl
          if (url) {
            window.location.href = url
          }
        },
      )

      App.addListener('appStateChange', ({ isActive }) => {
        if (isActive) {
          console.log('App resumed')
        }
      })

      PushNotifications.register()

      return new Promise<void>((resolve, reject) => {
        let resolved = false
        PushNotifications.addListener('registration', async (token: Token) => {
          try {
            await authFetch(`${API_BASE}/api/subscribe`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ fcmToken: token.value }),
            })
            await MotionService.startService()
            resolved = true
            resolve()
          } catch (err) {
            PushNotifications.removeAllListeners()
            if (err) {
              console.error('Push registration error:', err)
            }
            reject(err)
          }
        })

        setTimeout(() => {
          if (!resolved) {
            reject(new Error('Push registration timed out'))
          }
        }, 15000)
      })
    } else {
      return Promise.reject('Push permissions not granted')
    }
  } catch (err) {
    return Promise.reject(
      'Push error: ' + (err instanceof Error ? err.message : String(err)),
    )
  }
}
