import '@dotenvx/dotenvx/config'
import os from 'os'
import type { CapacitorConfig } from '@capacitor/cli'
import { isLocalIPv4 } from './web2/src/util'
import localConfig from './config.json'

const apiBaseUrl =
  process.env.CLIENT_ANDROID_ENV === 'development'
    ? `http://${getLocalIp() || 'localhost'}:${process.env.PORT ?? 3000}`
    : (process.env.CLIENT_ANDROID_API_BASE_URL ??
      process.env.CLIENT_API_BASE_URL)

const appBaseUrl =
  process.env.CLIENT_ANDROID_ENV === 'development'
    ? `http://${getLocalIp() || 'localhost'}:${process.env.PORT ?? 3000}`
    : process.env.ANDROID_APP_BASE_URL

const config: CapacitorConfig = {
  appId: localConfig.appId,
  appName: localConfig.appName,
  webDir: './web2/dist',
  server: {
    // @ts-ignore
    baseUrl: apiBaseUrl,
    url: appBaseUrl,
    cleartext: process.env.CLIENT_ANDROID_ENV === 'development', // Allow cleartext traffic in development
  },
}

function getLocalIp() {
  let ip = ''

  try {
    const interfaces = os.networkInterfaces()

    for (const [_name, interface_] of Object.entries(interfaces)) {
      if (interface_?.length) {
        for (const iface of interface_) {
          if (iface.family === 'IPv4' && isLocalIPv4(iface.address)) {
            ip = iface.address
            break
          }
        }
      }
    }
  } catch (err) {
    console.log(err)
    return ip
  }

  return ip
}

export default config
