import '@dotenvx/dotenvx/config'
import os from 'os'
import type { CapacitorConfig } from '@capacitor/cli'
import { isLocalIPv4 } from './web2/src/util'
import localConfig from './config.json'

const baseUrl =
  process.env.VITE_BASE_URL ??
  (process.env.CAPACITOR_ENV === 'development'
    ? `http://${getLocalIp() || 'localhost'}:${process.env.PORT ?? 3000}`
    : undefined)

const config: CapacitorConfig = {
  appId: localConfig.appId,
  appName: localConfig.appName,
  webDir: './web2/dist',
  server: {
    // @ts-ignore
    baseUrl: baseUrl,
    url: process.env.CAPACITOR_SERVER_URL ?? baseUrl,
    cleartext: process.env.CAPACITOR_ENV === 'development', // Allow cleartext traffic in development
  },
}

function getLocalIp() {
  let ip = ''

  try {
    const interfaces = os.networkInterfaces()

    for (const [name, interfacee] of Object.entries(interfaces)) {
      if (interfacee?.length) {
        for (const iface of interfacee) {
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
