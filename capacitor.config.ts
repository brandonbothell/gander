import '@dotenvx/dotenvx/config'
import path from 'path'
import os from 'os'
import fs from 'fs'
import type { CapacitorConfig } from '@capacitor/cli'
import { isLocalIPv4 } from './web2/src/util'

const apiBaseUrl =
  process.env.CLIENT_ANDROID_ENV === 'development'
    ? `http://${getLocalIp() || 'localhost'}:${process.env.PORT ?? 3000}`
    : (process.env.CLIENT_ANDROID_API_BASE_URL ??
      process.env.CLIENT_API_BASE_URL)

const appBaseUrl = process.env.ANDROID_APP_BASE_URL

const appHostname =
  process.env.CLIENT_ANDROID_ENV === 'development'
    ? getLocalIp() || 'localhost'
    : (process.env.ANDROID_HOSTNAME ?? 'localhost')

const config: CapacitorConfig = {
  appId: process.env.ANDROID_APP_ID,
  appName: 'Gander',
  webDir: './web2/dist',
  server: {
    // @ts-ignore
    baseUrl: apiBaseUrl,
    url: appBaseUrl,
    hostname: appHostname,
    cleartext: process.env.CLIENT_ANDROID_ENV === 'development', // Allow cleartext traffic in development
    androidScheme:
      process.env.CLIENT_ANDROID_ENV === 'development' ? 'http' : 'https',
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: false,
      backgroundColor: '#292929',
      showSpinner: true,
      androidSpinnerStyle: 'large',
      spinnerColor: '#999999',
    },
    CapacitorHttp: {
      enabled: true,
    },
    LiveUpdate: {
      publicKey: loadPublicKeyBase64('live-update-public-key.pub.pem'),
    },
  },
}

export function getLocalIp() {
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

function loadPublicKeyBase64(pemFilename: string): string {
  const pemPath = path.resolve(__dirname, pemFilename)

  if (!fs.existsSync(pemPath)) {
    console.warn(
      `No public key found at: ${pemFilename}. Live update will be disabled.`,
    )
  }

  const pemContent = fs.readFileSync(pemPath, 'utf8')

  return pemContent
    .replace(/-----BEGIN PUBLIC KEY-----/g, '')
    .replace(/-----END PUBLIC KEY-----/g, '')
    .replace(/\s+/g, '')
}

export default config
