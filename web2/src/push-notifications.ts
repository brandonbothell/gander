import {
  PushNotifications,
  type Token,
  type ActionPerformed,
  type PushNotificationSchema,
} from '@capacitor/push-notifications'
import { Preferences } from '@capacitor/preferences'
import { Capacitor } from '@capacitor/core'
import { App } from '@capacitor/app'
import { API_BASE, authFetch } from './main'
import { MotionService } from './capacitor-plugins/motion-service'

export async function setupPushNotifications() {
  if (!Capacitor.isNativePlatform()) return

  try {
    const pushPermissions = await PushNotifications.requestPermissions()

    if (pushPermissions.receive === 'granted') {
      PushNotifications.addListener(
        'pushNotificationReceived',
        async (notification: PushNotificationSchema) => {
          console.log(
            'Push notification received: ' +
              JSON.stringify(notification, null, 2),
          )
        },
      )

      PushNotifications.addListener(
        'pushNotificationActionPerformed',
        (action: ActionPerformed) => {
          console.log(
            'Push notification action recieved:' +
              JSON.stringify(action, null, 2),
          )
        },
      )

      App.addListener('appStateChange', ({ isActive }) => {
        if (isActive) {
          console.log('App resumed')
        }
      })

      PushNotifications.register()

      const clientId = (await Preferences.get({ key: 'clientId' })).value

      return new Promise<void>((resolve, reject) => {
        let resolved = false
        PushNotifications.addListener('registration', async (token: Token) => {
          try {
            await authFetch(`${API_BASE}/api/subscribe`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ fcmToken: token.value, clientId }),
            })
            resolved = true
            await MotionService.startService()
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
